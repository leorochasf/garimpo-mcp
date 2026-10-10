/**
 * Memória (ADR-0010): os acórdãos que o site devolveu, guardados por 24 h desde a obtenção sob o id
 * "tribunal:id-do-site" de cada cópia, e as buscas diretas com resposta utilizável (inclusive vazia), sob o sha256
 * dos parâmetros, sem o texto da busca em claro; e as consultas reduzidas a outras fontes (DataJud), sob o sha256 do
 * pedido; na subpasta de memória da pasta de dados, visíveis por todas as janelas.
 * Do Falcão (ADR-0018), também o texto integral do repositório oficial de cada acórdão, já convertido do HTML, com os
 * nomes que o texto traz, só para leitura e conferência pedidas (nunca vai a lista, cabeçalho nem busca guardada).
 *
 * - É descartável: falha ao gravar ou ler nunca derruba a ferramenta; a janela guarda também consigo, enquanto está
 *   aberta. A gravação em disco corre por trás da resposta: milhares de arquivos levariam segundos no Windows.
 *   Falha nas buscas não é silenciosa: a leitura de busca guardada que falha (erro que não é "ausente") dá
 *   FalhaNaMemoriaError (a de acórdão pelo id segue como ausente), e a última leva
 *   de gravação que falhou vira o aviso de `avisoDeGravacao`, até uma leva seguinte dar certo.
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
const FORMATO_CONSULTA = "garimpo-memoria-consulta";
const FORMATO_TEXTO = "garimpo-memoria-texto";
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
  /**
   * A tese firmada que o site informou para cada qualificado, na mesma ordem (null = nenhuma): com ela, a busca
   * guardada refaz o enquadramento com as tabelas da janela que responde. Busca guardada antes disso não a tem.
   */
  tesesDoSite?: (string | null)[];
  avisos: string[];
  /** Só no Falcão: o total que a fonte informou (10000 = "10.000 ou mais"). */
  totalNaFonte?: number;
}

/** O texto integral do repositório oficial de um acórdão do Falcão, convertido do HTML. */
export interface TextoIntegral {
  id: string;
  texto: string;
  /** O HTML parecia cortado: o texto nunca é apresentado como completo. */
  indicioDeCorte: boolean;
}

export interface TextoGuardado extends TextoIntegral {
  /** Instante da obtenção na fonte (ms desde 1970, UTC). */
  obtidoEm: number;
}

export interface BuscaGuardada {
  busca: BuscaNaMemoria;
  /** Instante em que a busca foi feita no site (ms desde 1970, UTC). */
  obtidoEm: number;
}

/**
 * A resposta reduzida de uma fonte além do site (DataJud, DJEN, portais de precedentes), como a ferramenta a mostra: nunca a resposta bruta.
 * Guardada sob o sha256 do pedido, sem o número do processo em claro no nome.
 */
export type FonteDaConsulta = "datajud" | "djen" | "precedentes";

export interface ConsultaGuardada {
  fonte: FonteDaConsulta;
  dado: unknown;
  /** Instante em que a consulta foi feita na fonte (ms desde 1970, UTC). */
  obtidoEm: number;
}

/** A memória em disco falhou ao ler (erro que não é "ausente"); a mensagem é o código do erro. */
export class FalhaNaMemoriaError extends Error {
  constructor(codigo: string) {
    super(codigo);
    this.name = "FalhaNaMemoriaError";
  }
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
  private readonly consultasDaSessao = new Map<string, ConsultaGuardada>();
  private readonly textosDaSessao = new Map<string, TextoGuardado>();
  private readonly pasta?: string;
  private readonly pastaDeBuscas?: string;
  private readonly pastaDeConsultas?: string;
  private readonly pastaDeTextos?: string;
  private readonly agora: () => number;
  private readonly teto: number;
  /** Espaço estimado em disco (gravações de outras janelas só entram na próxima varredura). */
  private ocupado = 0;
  /** A varredura em andamento: roda por trás, sem atrasar nenhuma resposta. */
  private varrendo?: Promise<void>;
  /** As gravações em disco, uma leva depois da outra, por trás das respostas. */
  private gravando = Promise.resolve();
  /** Código do erro da última leva de gravação, se ela falhou. */
  private falhaDeGravacao?: string;

  constructor({ dados, agora = Date.now, tetoBytes = TETO_MEMORIA_BYTES }: OpcoesMemoria = {}) {
    this.pasta = dados && join(dados, "memoria", `acordaos-${VERSAO}`);
    this.pastaDeBuscas = dados && join(dados, "memoria", `buscas-${VERSAO}`);
    this.pastaDeConsultas = dados && join(dados, "memoria", `consultas-${VERSAO}`);
    this.pastaDeTextos = dados && join(dados, "memoria", `textos-${VERSAO}`);
    this.agora = agora;
    this.teto = tetoBytes;
    this.limpar();
  }

  /**
   * Guarda cada acórdão sob o id de cada cópia, para que qualquer um deles leia a ementa e peça o inteiro teor. Na
   * janela vale na hora; no disco, assim que a gravação por trás terminar. Com `obtidoEm`, regrava um acórdão já
   * guardado sem lhe dar 24 h a mais.
   */
  lembrar(acordaos: readonly { ids: readonly string[]; registro: Acordao }[], obtidoEm = this.agora()): void {
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
    const ler = () => lerGuardado(arquivo).catch(() => undefined);
    let lido = await ler();
    if (lido && lido.id === id && !this.valido(lido.obtidoEm)) {
      await descartar(arquivo, lido.obtidoEm, lerGuardado);
      // Outra janela pode ter gravado uma versão nova no meio: o descarte a devolve ao lugar.
      lido = await ler();
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
   * Falha ao ler o disco, sem a busca guardada na janela = FalhaNaMemoriaError.
   */
  async obterBusca(chave: string): Promise<BuscaGuardada | undefined> {
    if (!this.pastaDeBuscas) return undefined;
    const arquivo = join(this.pastaDeBuscas, `${chave}.json`);
    let lida: Awaited<ReturnType<typeof lerBusca>>;
    let falha: unknown;
    try {
      lida = await lerBusca(arquivo);
      if (lida && !this.valido(lida.obtidoEm)) {
        await descartar(arquivo, lida.obtidoEm, lerBusca);
        lida = await lerBusca(arquivo);
      }
    } catch (e) {
      falha = e;
    }
    const guardada = [lida, this.buscasDaSessao.get(chave)]
      .filter((b): b is BuscaGuardada => b !== undefined && this.valido(b.obtidoEm))
      .sort((x, y) => y.obtidoEm - x.obtidoEm)[0];
    if (!guardada && falha) throw new FalhaNaMemoriaError(codigoDoErro(falha));
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

  /** Guarda a consulta reduzida a uma fonte sob a chave (sha256 do pedido). Sem pasta de dados, não guarda. */
  guardarConsulta(chave: string, fonte: FonteDaConsulta, dado: unknown): void {
    if (!this.pastaDeConsultas) return;
    const guardada: ConsultaGuardada = { fonte, dado, obtidoEm: this.agora() };
    this.consultasDaSessao.set(chave, guardada);
    const texto = JSON.stringify({ formato: FORMATO_CONSULTA, versao: VERSAO, ...guardada });
    this.agendar(this.pastaDeConsultas, [{ nome: `${chave}.json`, texto }]);
  }

  /**
   * A consulta guardada e válida, de qualquer janela (a mais recente), da fonte pedida e no formato que `valida`
   * reconhece; falha de leitura ou outro formato = ausente (é descartável).
   */
  async obterConsulta(
    chave: string,
    fonte: FonteDaConsulta,
    valida: (dado: unknown) => boolean,
  ): Promise<ConsultaGuardada | undefined> {
    if (!this.pastaDeConsultas) return undefined;
    const arquivo = join(this.pastaDeConsultas, `${chave}.json`);
    let lida = await lerConsulta(arquivo).catch(() => undefined);
    if (lida && !this.valido(lida.obtidoEm)) {
      await descartar(arquivo, lida.obtidoEm, lerConsulta);
      lida = await lerConsulta(arquivo).catch(() => undefined);
    }
    const guardada = [lida?.consulta, this.consultasDaSessao.get(chave)]
      .filter((c): c is ConsultaGuardada => c !== undefined && this.valido(c.obtidoEm) && c.fonte === fonte && valida(c.dado))
      .sort((x, y) => y.obtidoEm - x.obtidoEm)[0];
    return guardada;
  }

  /** Guarda o texto integral de cada acórdão do Falcão, com o instante de agora (24 h, como os acórdãos). */
  lembrarTextos(textos: readonly TextoIntegral[], obtidoEm = this.agora()): void {
    const guardados = textos.map((t) => ({ ...t, obtidoEm }));
    for (const g of guardados) this.textosDaSessao.set(g.id, g);
    if (!this.pastaDeTextos || !guardados.length) return;
    this.agendar(
      this.pastaDeTextos,
      guardados.map((g) => ({ nome: nomeDoArquivo(g.id), texto: JSON.stringify({ formato: FORMATO_TEXTO, versao: VERSAO, ...g }) })),
    );
  }

  /** O texto integral guardado e válido, de qualquer janela; vencido ou ausente = undefined (e o vencido é apagado). */
  async obterTexto(id: string): Promise<TextoGuardado | undefined> {
    const daJanela = this.textosDaSessao.get(id);
    if (this.pastaDeTextos) {
      const arquivo = join(this.pastaDeTextos, nomeDoArquivo(id));
      let lido = await lerTexto(arquivo).catch(() => undefined);
      if (lido && lido.id === id && !this.valido(lido.obtidoEm)) {
        await descartar(arquivo, lido.obtidoEm, lerTexto);
        lido = await lerTexto(arquivo).catch(() => undefined);
      }
      if (lido && lido.id === id && this.valido(lido.obtidoEm)) return lido.guardado;
    }
    return daJanela && this.valido(daJanela.obtidoEm) ? daJanela : undefined;
  }

  /** O aviso de que a última leva de gravação em disco falhou; undefined se deu certo (ou ainda não houve). */
  avisoDeGravacao(): string | undefined {
    if (!this.falhaDeGravacao || !this.pasta) return undefined;
    return (
      `A memória do Garimpo não conseguiu gravar no disco (${this.falhaDeGravacao}, em ${join(this.pasta, "..")}): ` +
      "as buscas seguem indo ao site normalmente, e o que esta janela guarda vale só nela, enquanto estiver aberta, " +
      "não nas outras janelas."
    );
  }

  private valido(obtidoEm: number): boolean {
    return this.agora() - obtidoEm < VALIDADE_MS;
  }

  /** Grava por trás das respostas, uma leva depois da outra; acima do teto, começa a limpeza. */
  private agendar(pasta: string, registros: { nome: string; texto: string }[]): void {
    this.gravando = this.gravando.then(async () => {
      let falha: string | undefined;
      try {
        await mkdir(pasta, { recursive: true });
        // Em lotes: a busca ampla pode trazer milhares de acórdãos de uma vez.
        for (let i = 0; i < registros.length; i += 16) {
          await Promise.all(
            registros.slice(i, i + 16).map(async ({ nome, texto }) => {
              const erro = await gravar(pasta, nome, texto);
              if (erro) falha ??= erro;
              else this.ocupado += Buffer.byteLength(texto);
            }),
          );
        }
      } catch (e) {
        // Memória é descartável: a janela já guardou; a falha vira aviso nas respostas seguintes.
        falha = codigoDoErro(e);
      }
      this.falhaDeGravacao = falha;
      if (this.ocupado > this.teto) this.limpar();
    });
  }

  /** Começa uma varredura por trás, se nenhuma estiver em andamento. */
  private limpar(): void {
    this.varrendo ??= this.varrer().finally(() => (this.varrendo = undefined));
  }

  /** Apaga os vencidos e, acima do teto, os mais antigos até 90% dele (folga para não varrer a cada gravação). */
  private async varrer(): Promise<void> {
    if (!this.pasta || !this.pastaDeBuscas || !this.pastaDeTextos) return;
    const antes = this.ocupado;
    try {
      const validos: ArquivoGuardado[] = [];
      for (const [pasta, nomeValido, ler] of [
        [this.pasta, NOME_DE_ARQUIVO, lerGuardado],
        [this.pastaDeBuscas, NOME_DE_BUSCA, lerBusca],
        [this.pastaDeConsultas!, NOME_DE_BUSCA, lerConsulta],
        [this.pastaDeTextos, NOME_DE_ARQUIVO, lerTexto],
      ] as const) {
        const nomes = (await readdir(pasta).catch(() => [] as string[])).filter((n) => nomeValido.test(n));
        for (const nome of nomes) {
          const arquivo = join(pasta, nome);
          const lido = await ler(arquivo).catch(() => undefined);
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
export function dataEHora(instante: number): string {
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

/**
 * Arquivo da memória neste formato e versão, com o instante da obtenção; ausente ou qualquer outra coisa = undefined.
 * Erro de leitura que não é "ausente" (sem permissão, pasta no lugar do arquivo…) passa adiante.
 */
async function lerRegistro(arquivo: string, formato: string) {
  let bruto: Buffer;
  try {
    bruto = await readFile(arquivo);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
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
    ...(Array.isArray(r.tesesDoSite) &&
      r.tesesDoSite.length === r.qualificados.length &&
      r.tesesDoSite.every((t: unknown) => t === null || typeof t === "string") && { tesesDoSite: r.tesesDoSite }),
    avisos: r.avisos,
    ...(Number.isInteger(r.totalNaFonte) && { totalNaFonte: r.totalNaFonte }),
  };
  return { busca, obtidoEm: lido.obtidoEm, bytes: lido.bytes };
}

/** Consulta guardada neste formato e versão; qualquer outra coisa = undefined. */
async function lerConsulta(arquivo: string) {
  const lido = await lerRegistro(arquivo, FORMATO_CONSULTA);
  const r = lido?.r;
  if (!lido || typeof r.fonte !== "string" || r.dado === undefined) return undefined;
  const consulta: ConsultaGuardada = { fonte: r.fonte as FonteDaConsulta, dado: r.dado, obtidoEm: lido.obtidoEm };
  return { consulta, obtidoEm: lido.obtidoEm, bytes: lido.bytes };
}

/** Texto integral guardado neste formato e versão; qualquer outra coisa = undefined. */
async function lerTexto(arquivo: string) {
  const lido = await lerRegistro(arquivo, FORMATO_TEXTO);
  const r = lido?.r;
  if (!lido || typeof r?.id !== "string" || typeof r.texto !== "string" || typeof r.indicioDeCorte !== "boolean") {
    return undefined;
  }
  const guardado: TextoGuardado = { id: r.id, texto: r.texto, indicioDeCorte: r.indicioDeCorte, obtidoEm: lido.obtidoEm };
  return { id: r.id as string, obtidoEm: lido.obtidoEm, bytes: lido.bytes, guardado };
}

/**
 * Grava por temporário + renomeação: quem lê vê o arquivo anterior ou o novo, nunca pela metade. Devolve o código do
 * erro, se falhou.
 */
async function gravar(pasta: string, nome: string, texto: string): Promise<string | undefined> {
  const temporario = join(pasta, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporario, texto, { flag: "wx" });
    await insistir(() => rename(temporario, join(pasta, nome)));
    return undefined;
  } catch (e) {
    await rm(temporario, { force: true }).catch(() => {});
    return codigoDoErro(e);
  }
}

function codigoDoErro(e: unknown): string {
  return (e as NodeJS.ErrnoException)?.code ?? "erro desconhecido";
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
  const tirado = await ler(descarte).catch(() => undefined);
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
