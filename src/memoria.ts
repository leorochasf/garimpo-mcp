/**
 * Memória (ADR-0010): os acórdãos que o site devolveu, guardados por 24 h desde a obtenção sob o id
 * "tribunal:id-do-site" de cada cópia, e as buscas diretas com resposta utilizável (inclusive vazia), sob o sha256
 * dos parâmetros, sem o texto da busca em claro; na subpasta de memória da pasta de dados, visíveis por todas as janelas.
 *
 * - É descartável: falha ao gravar ou ler nunca derruba a ferramenta; a janela guarda também consigo, enquanto está
 *   aberta. A gravação em disco corre por trás da resposta: milhares de arquivos levariam segundos no Windows.
 * - Formato desconhecido é ignorado e nunca apagado (outra versão pode usá-lo); cada versão do formato tem a sua
 *   pasta, para uma versão não sobrescrever a memória da outra.
 * - Limpeza ao encontrar um vencido e numa varredura ao iniciar; teto de espaço (acórdãos e buscas somados), apagando
 *   o mais antigo primeiro. Só toca arquivos de acórdão e de busca guardados desta versão: nunca a proteção, PDFs ou
 *   recibos.
 * - `GARIMPO_SEM_MEMORIA=1` volta a guardar só os acórdãos na janela, enquanto está aberta (sem disco e sem
 *   vencimento, como antes); buscas não são guardadas.
 */

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Acordao, Qualificado } from "./busca.js";

/** Validade de um acórdão ou de uma busca na memória, contada da obtenção no site; a leitura não renova. */
const VALIDADE_MS = 24 * 3_600_000;
/** Teto de espaço da memória em disco. */
const TETO_MEMORIA_BYTES = 200 * 1024 * 1024;
const FORMATO = "garimpo-memoria-acordao";
const FORMATO_BUSCA = "garimpo-memoria-busca";
const VERSAO = 1;
const NOME_DE_ARQUIVO = /^[0-9a-f]{32}\.json$/;
const NOME_DE_BUSCA = /^[0-9a-f]{64}\.json$/;

export interface Guardado {
  acordao: Acordao;
  /** Instante da obtenção no site (ms desde 1970, UTC). */
  obtidoEm: number;
}

/**
 * A resposta utilizável de uma busca direta, como fica guardada: sem nenhum campo que ecoe a entrada (texto, filtros,
 * limite, tribunal; o cabeçalho de cobertura é refeito com os parâmetros). Cada acórdão vai com os ids de todas as
 * cópias, para voltar à memória de acórdãos da janela.
 */
export interface BuscaNaMemoria {
  /** Registros que o site devolveu, antes de juntar cópias. */
  registrosDoSite: number;
  acordaos: { ids: readonly string[]; registro: Acordao }[];
  qualificados: Qualificado[];
  avisos: string[];
}

export interface BuscaGuardada {
  busca: BuscaNaMemoria;
  /** Instante em que a busca foi feita no site (ms desde 1970, UTC). */
  obtidoEm: number;
}

export interface OpcoesMemoria {
  /** Pasta de dados; sem ela, a memória fica só na janela, enquanto está aberta. */
  dados?: string;
  agora?: () => number;
  tetoBytes?: number;
}

/** Lê um arquivo da memória deste formato e versão; qualquer outra coisa = undefined. */
type Leitor = (arquivo: string) => Promise<{ obtidoEm: number; bytes: number } | undefined>;

interface ArquivoGuardado {
  arquivo: string;
  obtidoEm: number;
  bytes: number;
  ler: Leitor;
}

export class Memoria {
  private readonly sessao = new Map<string, Guardado>();
  /** As buscas desta janela, valendo na hora (a gravação em disco corre por trás). */
  private readonly buscasDaSessao = new Map<string, BuscaGuardada>();
  private readonly pasta?: string;
  private readonly pastaDeBuscas?: string;
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
    this.pastaDeBuscas = dados && join(dados, "memoria", `buscas-${VERSAO}`);
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
    this.agendar(
      this.pasta,
      guardados.map((g) => ({ nome: nomeDoArquivo(g.id), texto: JSON.stringify({ formato: FORMATO, versao: VERSAO, ...g }) })),
    );
  }

  /** O acórdão guardado e válido, de qualquer janela; vencido ou ausente = undefined (e o vencido é apagado). */
  async obter(id: string): Promise<Guardado | undefined> {
    const daJanela = this.sessao.get(id);
    if (!this.pasta) return daJanela;
    const arquivo = join(this.pasta, nomeDoArquivo(id));
    let lido = await lerGuardado(arquivo);
    if (lido && lido.id === id && !this.valido(lido.obtidoEm)) {
      await descartar(arquivo, lido.obtidoEm, lerGuardado);
      // Outra janela pode ter gravado uma versão nova no meio: o descarte a devolve ao lugar.
      lido = await lerGuardado(arquivo);
    }
    if (lido && lido.id === id && this.valido(lido.obtidoEm)) return { acordao: lido.acordao, obtidoEm: lido.obtidoEm };
    return daJanela && this.valido(daJanela.obtidoEm) ? daJanela : undefined;
  }

  /**
   * Guarda a resposta utilizável de uma busca direta sob a chave (sha256 dos parâmetros), com o instante de agora.
   * Sem pasta de dados (`GARIMPO_SEM_MEMORIA=1`), não guarda.
   */
  guardarBusca(chave: string, busca: BuscaNaMemoria): void {
    if (!this.pastaDeBuscas) return;
    const guardada = { busca, obtidoEm: this.agora() };
    this.buscasDaSessao.set(chave, guardada);
    const texto = JSON.stringify({ formato: FORMATO_BUSCA, versao: VERSAO, obtidoEm: guardada.obtidoEm, ...busca });
    this.agendar(this.pastaDeBuscas, [{ nome: `${chave}.json`, texto }]);
  }

  /**
   * A busca guardada e válida, de qualquer janela (a mais recente); vencida ou ausente = undefined (e a vencida é
   * apagada). Os acórdãos dela voltam à memória da janela com a data em que foram obtidos, nunca com a de hoje.
   */
  async obterBusca(chave: string): Promise<BuscaGuardada | undefined> {
    if (!this.pastaDeBuscas) return undefined;
    const arquivo = join(this.pastaDeBuscas, `${chave}.json`);
    let lida = await lerBusca(arquivo);
    if (lida && !this.valido(lida.obtidoEm)) {
      await descartar(arquivo, lida.obtidoEm, lerBusca);
      lida = await lerBusca(arquivo);
    }
    const guardada = [lida, this.buscasDaSessao.get(chave)]
      .filter((b): b is BuscaGuardada => b !== undefined && this.valido(b.obtidoEm))
      .sort((x, y) => y.obtidoEm - x.obtidoEm)[0];
    if (!guardada) return undefined;
    for (const { ids, registro } of guardada.busca.acordaos) {
      for (const id of ids) {
        if (!((this.sessao.get(id)?.obtidoEm ?? -Infinity) >= guardada.obtidoEm)) {
          this.sessao.set(id, { acordao: registro, obtidoEm: guardada.obtidoEm });
        }
      }
    }
    return { busca: guardada.busca, obtidoEm: guardada.obtidoEm };
  }

  private valido(obtidoEm: number): boolean {
    return this.agora() - obtidoEm < VALIDADE_MS;
  }

  /** Grava por trás das respostas, uma leva depois da outra; acima do teto, começa a limpeza. */
  private agendar(pasta: string, registros: { nome: string; texto: string }[]): void {
    this.gravando = this.gravando.then(async () => {
      try {
        await mkdir(pasta, { recursive: true });
        // Em lotes: a busca ampla pode trazer milhares de acórdãos de uma vez.
        for (let i = 0; i < registros.length; i += 16) {
          await Promise.all(
            registros.slice(i, i + 16).map(async ({ nome, texto }) => {
              if (await gravar(pasta, nome, texto)) this.ocupado += Buffer.byteLength(texto);
            }),
          );
        }
      } catch {
        // Memória é descartável: a janela já guardou.
      }
      if (this.ocupado > this.teto) this.limpar();
    });
  }

  /** Começa uma varredura por trás, se nenhuma estiver em andamento. */
  private limpar(): void {
    this.varrendo ??= this.varrer().finally(() => (this.varrendo = undefined));
  }

  /** Apaga os vencidos e, acima do teto, os mais antigos até 90% dele (folga para não varrer a cada gravação). */
  private async varrer(): Promise<void> {
    if (!this.pasta || !this.pastaDeBuscas) return;
    const antes = this.ocupado;
    try {
      const validos: ArquivoGuardado[] = [];
      for (const [pasta, nomeValido, ler] of [
        [this.pasta, NOME_DE_ARQUIVO, lerGuardado],
        [this.pastaDeBuscas, NOME_DE_BUSCA, lerBusca],
      ] as const) {
        const nomes = (await readdir(pasta).catch(() => [] as string[])).filter((n) => nomeValido.test(n));
        for (const nome of nomes) {
          const arquivo = join(pasta, nome);
          const lido = await ler(arquivo);
          if (!lido) continue;
          if (this.valido(lido.obtidoEm)) validos.push({ arquivo, obtidoEm: lido.obtidoEm, bytes: lido.bytes, ler });
          else await descartar(arquivo, lido.obtidoEm, ler);
        }
      }
      let ocupado = validos.reduce((soma, r) => soma + r.bytes, 0);
      if (ocupado > this.teto) {
        for (const r of validos.sort((x, y) => x.obtidoEm - y.obtidoEm)) {
          if (ocupado <= this.teto * 0.9) break;
          if (await descartar(r.arquivo, r.obtidoEm, r.ler)) ocupado -= r.bytes;
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
  return `obtido do site em ${dataEHora(obtidoEm)}`;
}

/** "fotografia da busca feita no site em 08/10/2026 14:03 (hora local, UTC-03:00)": a marca da busca guardada. */
export function fotografiaDaBusca(obtidoEm: number): string {
  return `fotografia da busca feita no site em ${dataEHora(obtidoEm)}`;
}

/** "08/10/2026 14:03 (hora local, UTC-03:00)". */
function dataEHora(instante: number): string {
  const fuso = -new Date(instante).getTimezoneOffset();
  return `${diaEHora(instante)} (hora local, UTC${fuso < 0 ? "-" : "+"}${dois(fuso / 60)}:${dois(fuso % 60)})`;
}

/** "08/10/2026 14:03", na hora local da máquina, sem o fuso: só onde o espaço é curto. */
export function diaEHora(instante: number): string {
  const d = new Date(instante);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

function dois(n: number): string {
  return String(Math.floor(Math.abs(n))).padStart(2, "0");
}

/** O id fica dentro do arquivo; o nome é o hash dele, para caber em qualquer sistema de arquivos. */
function nomeDoArquivo(id: string): string {
  return `${createHash("sha256").update(id).digest("hex").slice(0, 32)}.json`;
}

/** Arquivo da memória neste formato e versão, com o instante da obtenção; qualquer outra coisa = undefined. */
async function lerRegistro(arquivo: string, formato: string) {
  let bruto: Buffer;
  try {
    bruto = await readFile(arquivo);
  } catch {
    return undefined;
  }
  try {
    const r = JSON.parse(bruto.toString("utf8"));
    if (r?.formato !== formato || r.versao !== VERSAO || !Number.isFinite(r.obtidoEm)) return undefined;
    return { r, obtidoEm: r.obtidoEm as number, bytes: bruto.length };
  } catch {
    return undefined;
  }
}

/** Acórdão guardado neste formato e versão; qualquer outra coisa (outra versão, arquivo estranho, ilegível) = undefined. */
async function lerGuardado(arquivo: string) {
  const lido = await lerRegistro(arquivo, FORMATO);
  const r = lido?.r;
  const reconhecido = typeof r?.id === "string" && typeof r.acordao?.id === "string" && typeof r.acordao.ementa === "string";
  return lido && reconhecido
    ? { id: r.id as string, obtidoEm: lido.obtidoEm, acordao: r.acordao as Acordao, bytes: lido.bytes }
    : undefined;
}

/** Busca guardada neste formato e versão; qualquer outra coisa = undefined. */
async function lerBusca(arquivo: string) {
  const lido = await lerRegistro(arquivo, FORMATO_BUSCA);
  const r = lido?.r;
  const reconhecido =
    Number.isInteger(r?.registrosDoSite) &&
    Array.isArray(r.acordaos) &&
    r.acordaos.every(
      (a: { ids?: unknown; registro?: { id?: unknown; ementa?: unknown } }) =>
        Array.isArray(a?.ids) && typeof a.registro?.id === "string" && typeof a.registro.ementa === "string",
    ) &&
    Array.isArray(r.qualificados) &&
    Array.isArray(r.avisos);
  if (!lido || !reconhecido) return undefined;
  const busca: BuscaNaMemoria = {
    registrosDoSite: r.registrosDoSite,
    acordaos: r.acordaos,
    qualificados: r.qualificados,
    avisos: r.avisos,
  };
  return { busca, obtidoEm: lido.obtidoEm, bytes: lido.bytes };
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
 * Apaga o registro guardado (acórdão ou busca) que foi julgado pela obtenção `visto`, sem apagar uma versão nova que
 * outra janela tenha gravado no meio: tira o arquivo do lugar, confere o que tirou e, se for outra versão ou algo que
 * esta versão não entende, devolve-o (se nada mais novo ocupou o lugar nesse meio-tempo). Diz se apagou.
 */
async function descartar(arquivo: string, visto: number, ler: Leitor): Promise<boolean> {
  const descarte = `${arquivo}.${randomUUID()}.descarte`;
  try {
    await insistir(() => rename(arquivo, descarte));
  } catch {
    return false;
  }
  const tirado = await ler(descarte);
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
