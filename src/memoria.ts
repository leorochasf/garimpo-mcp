/**
 * Memória de acórdãos (ADR-0010): os acórdãos que o site devolveu, guardados por 24 h desde a obtenção sob o id
 * "tribunal:id-do-site" de cada cópia, na subpasta de memória da pasta de dados, visíveis por todas as janelas.
 *
 * - É descartável: falha ao gravar ou ler nunca derruba a ferramenta; a janela guarda também consigo, enquanto está
 *   aberta. A gravação em disco corre por trás da resposta: milhares de arquivos levariam segundos no Windows.
 * - Formato desconhecido é ignorado e nunca apagado (outra versão pode usá-lo); cada versão do formato tem a sua
 *   pasta, para uma versão não sobrescrever a memória da outra.
 * - Limpeza ao encontrar um vencido e numa varredura ao iniciar; teto de espaço, apagando o mais antigo primeiro.
 *   Só toca arquivos de acórdão guardado desta pasta: nunca a proteção, PDFs ou recibos.
 * - `GARIMPO_SEM_MEMORIA=1` volta a guardar só na janela, enquanto está aberta (sem disco e sem vencimento, como antes).
 */

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Acordao } from "./busca.js";

/** Validade de um acórdão na memória, contada da obtenção no site; a leitura não renova. */
const VALIDADE_MS = 24 * 3_600_000;
/** Teto de espaço da memória em disco. */
const TETO_MEMORIA_BYTES = 200 * 1024 * 1024;
const FORMATO = "garimpo-memoria-acordao";
const VERSAO = 1;
const NOME_DE_ARQUIVO = /^[0-9a-f]{32}\.json$/;

export interface Guardado {
  acordao: Acordao;
  /** Instante da obtenção no site (ms desde 1970, UTC). */
  obtidoEm: number;
}

export interface OpcoesMemoria {
  /** Pasta de dados; sem ela, a memória fica só na janela, enquanto está aberta. */
  dados?: string;
  agora?: () => number;
  tetoBytes?: number;
}

interface ArquivoGuardado {
  arquivo: string;
  obtidoEm: number;
  bytes: number;
}

export class Memoria {
  private readonly sessao = new Map<string, Guardado>();
  private readonly pasta?: string;
  private readonly agora: () => number;
  private readonly teto: number;
  /** Espaço estimado em disco (gravações de outras janelas só entram na próxima varredura). */
  private ocupado = 0;
  /** A varredura em andamento: roda por trás, sem atrasar nenhuma resposta. */
  private varrendo?: Promise<void>;
  /** As gravações em disco, uma leva depois da outra, por trás das respostas. */
  private gravando = Promise.resolve();

  constructor({ dados, agora = Date.now, tetoBytes = TETO_MEMORIA_BYTES }: OpcoesMemoria = {}) {
    this.pasta = dados && join(dados, "memoria", `acordaos-${VERSAO}`);
    this.agora = agora;
    this.teto = tetoBytes;
    this.limpar();
  }

  /**
   * Guarda cada acórdão sob o id de cada cópia, para que qualquer um deles leia a ementa e peça o inteiro teor. Na
   * janela vale na hora; no disco, assim que a gravação por trás terminar.
   */
  lembrar(acordaos: readonly { ids: readonly string[]; registro: Acordao }[]): void {
    const obtidoEm = this.agora();
    const guardados = acordaos.flatMap(({ ids, registro }) => ids.map((id) => ({ id, acordao: registro, obtidoEm })));
    for (const { id, ...guardado } of guardados) this.sessao.set(id, guardado);
    if (!this.pasta || !guardados.length) return;
    const pasta = this.pasta;
    this.gravando = this.gravando.then(async () => {
      try {
        await mkdir(pasta, { recursive: true });
        // Em lotes: a busca ampla pode trazer milhares de acórdãos de uma vez.
        for (let i = 0; i < guardados.length; i += 16) {
          await Promise.all(
            guardados.slice(i, i + 16).map(async (g) => {
              const texto = JSON.stringify({ formato: FORMATO, versao: VERSAO, ...g });
              if (await gravar(pasta, nomeDoArquivo(g.id), texto)) this.ocupado += Buffer.byteLength(texto);
            }),
          );
        }
      } catch {
        // Memória é descartável: a janela já guardou.
      }
      if (this.ocupado > this.teto) this.limpar();
    });
  }

  /** O acórdão guardado e válido, de qualquer janela; vencido ou ausente = undefined (e o vencido é apagado). */
  async obter(id: string): Promise<Guardado | undefined> {
    const daJanela = this.sessao.get(id);
    if (!this.pasta) return daJanela;
    const arquivo = join(this.pasta, nomeDoArquivo(id));
    let lido = await lerGuardado(arquivo);
    if (lido && lido.id === id && !this.valido(lido.obtidoEm)) {
      await descartar(arquivo, lido.obtidoEm);
      // Outra janela pode ter gravado uma versão nova no meio: o descarte a devolve ao lugar.
      lido = await lerGuardado(arquivo);
    }
    if (lido && lido.id === id && this.valido(lido.obtidoEm)) return { acordao: lido.acordao, obtidoEm: lido.obtidoEm };
    return daJanela && this.valido(daJanela.obtidoEm) ? daJanela : undefined;
  }

  private valido(obtidoEm: number): boolean {
    return this.agora() - obtidoEm < VALIDADE_MS;
  }

  /** Começa uma varredura por trás, se nenhuma estiver em andamento. */
  private limpar(): void {
    this.varrendo ??= this.varrer().finally(() => (this.varrendo = undefined));
  }

  /** Apaga os vencidos e, acima do teto, os mais antigos até 90% dele (folga para não varrer a cada gravação). */
  private async varrer(): Promise<void> {
    if (!this.pasta) return;
    const pasta = this.pasta;
    const antes = this.ocupado;
    try {
      const nomes = (await readdir(pasta).catch(() => [] as string[])).filter((n) => NOME_DE_ARQUIVO.test(n));
      const validos: ArquivoGuardado[] = [];
      for (const nome of nomes) {
        const arquivo = join(pasta, nome);
        const lido = await lerGuardado(arquivo);
        if (!lido) continue;
        if (this.valido(lido.obtidoEm)) validos.push({ arquivo, obtidoEm: lido.obtidoEm, bytes: lido.bytes });
        else await descartar(arquivo, lido.obtidoEm);
      }
      let ocupado = validos.reduce((soma, r) => soma + r.bytes, 0);
      if (ocupado > this.teto) {
        for (const r of validos.sort((x, y) => x.obtidoEm - y.obtidoEm)) {
          if (ocupado <= this.teto * 0.9) break;
          if (await descartar(r.arquivo, r.obtidoEm)) ocupado -= r.bytes;
        }
      }
      // Mais o que esta janela gravou enquanto a varredura corria.
      this.ocupado = ocupado + this.ocupado - antes;
    } catch {
      // Limpeza é só arrumação: falhar não impede nada.
    }
  }
}

/** "obtido do site em 08/10/2026 14:03 (hora local, UTC-03:00)": hora local da máquina, com o fuso. */
export function obtidoDoSite(obtidoEm: number): string {
  const d = new Date(obtidoEm);
  const dois = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const fuso = -d.getTimezoneOffset();
  return (
    `obtido do site em ${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${dois(d.getHours())}:${dois(d.getMinutes())} (hora local, UTC${fuso < 0 ? "-" : "+"}${dois(fuso / 60)}:${dois(fuso % 60)})`
  );
}

/** O id fica dentro do arquivo; o nome é o hash dele, para caber em qualquer sistema de arquivos. */
function nomeDoArquivo(id: string): string {
  return `${createHash("sha256").update(id).digest("hex").slice(0, 32)}.json`;
}

/** Acórdão guardado neste formato e versão; qualquer outra coisa (outra versão, arquivo estranho, ilegível) = undefined. */
async function lerGuardado(arquivo: string) {
  let bruto: Buffer;
  try {
    bruto = await readFile(arquivo);
  } catch {
    return undefined;
  }
  try {
    const r = JSON.parse(bruto.toString("utf8"));
    const reconhecido =
      r?.formato === FORMATO &&
      r.versao === VERSAO &&
      typeof r.id === "string" &&
      Number.isFinite(r.obtidoEm) &&
      typeof r.acordao?.id === "string" &&
      typeof r.acordao.ementa === "string";
    return reconhecido ? { id: r.id as string, obtidoEm: r.obtidoEm as number, acordao: r.acordao as Acordao, bytes: bruto.length } : undefined;
  } catch {
    return undefined;
  }
}

/** Grava por temporário + renomeação: quem lê vê o arquivo anterior ou o novo, nunca pela metade. */
async function gravar(pasta: string, nome: string, texto: string): Promise<boolean> {
  const temporario = join(pasta, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporario, texto, { flag: "wx" });
    await insistir(() => rename(temporario, join(pasta, nome)));
    return true;
  } catch {
    await rm(temporario, { force: true }).catch(() => {});
    return false;
  }
}

/**
 * Apaga o acórdão guardado que foi julgado pela obtenção `visto`, sem apagar uma versão nova que outra janela tenha
 * gravado no meio: tira o arquivo do lugar, confere o que tirou e, se for outra versão ou algo que esta versão não
 * entende, devolve-o (se nada mais novo ocupou o lugar nesse meio-tempo). Diz se apagou.
 */
async function descartar(arquivo: string, visto: number): Promise<boolean> {
  const descarte = `${arquivo}.${randomUUID()}.descarte`;
  try {
    await insistir(() => rename(arquivo, descarte));
  } catch {
    return false;
  }
  const tirado = await lerGuardado(descarte);
  const apagar = tirado?.obtidoEm === visto;
  if (!apagar) await link(descarte, arquivo).catch(() => {});
  await rm(descarte, { force: true }).catch(() => {});
  return apagar;
}

/** No Windows, renomear sobre um arquivo que outra janela está lendo falha por instantes: tenta de novo por ~1 s. */
async function insistir<T>(fazer: () => Promise<T>): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await fazer();
    } catch (e) {
      const codigo = (e as NodeJS.ErrnoException).code;
      if (!(codigo === "EPERM" || codigo === "EACCES" || codigo === "EBUSY") || tentativa >= 20) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
