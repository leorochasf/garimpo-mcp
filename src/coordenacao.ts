/**
 * Coordenação entre janelas (ADR-0008 e ADR-0009): todas as janelas do Garimpo do mesmo usuário dividem as 2
 * vagas e a pausa por host (TSE) por arquivos comuns na subpasta de proteção da pasta de dados.
 *
 * - Vaga = arquivo criado só se não existir, com o PID dono e a identificação da aquisição. Liberar = apagar,
 *   conferindo que ainda é a mesma aquisição. Arquivo de vaga incompleto ou ilegível nunca é vaga livre.
 * - Vaga (ou trava) alheia só é retomada quando o PID dono comprovadamente não existe; tempo nunca libera.
 * - A pausa por host é reservada sob uma trava curta, com a vaga já ocupada: duas janelas não saem juntas.
 * - O disjuntor de cada serviço (disjuntor.ts) fica no mesmo estado e é decidido e gravado sob a mesma trava.
 * - Estado ilegível, sem permissão ou de versão mais nova = rede parada, com o caminho e a instrução.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import {
  aplicarResultado,
  type Chamada,
  decidirSaida,
  type Disjuntor,
  disjuntorValido,
  type Ordem,
  type Pausa,
  type Resultado,
  type Saida,
} from "./disjuntor.js";

/** Libera a vaga ocupada (termina quando ela está livre); chamar mais de uma vez não faz nada. */
export type Liberar = () => Promise<void>;

/** Tempo já gasto esperando vaga numa mesma chamada: a desistência conta o total, não cada espera. */
export interface ContaDeEspera {
  esperadoMs: number;
}

/** Uma chamada que quer sair: o host (pausa por host), o serviço (disjuntor) e quem ela é. */
export interface PedidoDeSaida {
  host: string;
  intervaloMs: number;
  servico: string;
  chamada: Chamada;
  /** Falso quando a ferramenta em andamento já fez a sua chamada de prova. */
  provaPermitida: boolean;
}

/** O que o cliente pede à coordenação. Implementada em arquivos (produção) ou em memória (testes do cliente). */
export interface Coordenacao {
  /** Ocupa uma das vagas, esperando se preciso. */
  ocupar(conta: ContaDeEspera, sinal?: AbortSignal): Promise<Liberar>;
  /** Sem vaga e sem gravar nada: o que o disjuntor do serviço diz agora ("sai" = pode ocupar uma vaga). */
  conferir(p: PedidoDeSaida, agora: () => number): Promise<Ordem>;
  /**
   * Com a vaga já ocupada: decide pelo disjuntor do serviço e pela pausa do host. Se a chamada sai, registra a
   * saída (instante no host, chamada de prova); senão, não registra nada.
   */
  reservarSaida(p: PedidoDeSaida, agora: () => number): Promise<Ordem>;
  /** Anota no disjuntor do serviço o resultado de uma chamada que saiu; devolve a pausa em vigor, se houver. */
  anotar(servico: string, chamada: Chamada, saida: Saida, r: Resultado, agora: () => number): Promise<Pausa | undefined>;
}

const MAXIMO_DE_VAGAS = 2;
/** Espera máxima por vaga numa chamada, somadas todas as esperas dela. */
const ESPERA_MAXIMA_POR_VAGA_MS = 3 * 60_000;
const INTERVALO_DE_CONFERENCIA_MS = 250;
const FORMATO_ESTADO = "garimpo-protecao";
/** 1: vagas e pausas (B3-01); 2: mais os disjuntores. A 1 é lida e gravada de volta como 2. */
const VERSAO_ESTADO = 2;

/** A rede está parada: nenhuma chamada sai até o usuário agir. A leitura local continua. */
export class RedeParadaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedeParadaError";
  }
}

/** Pasta de dados por usuário; `GARIMPO_DADOS` troca a pasta inteira. Nunca a pasta temporária do sistema. */
export function pastaDeDados(): string {
  if (process.env.GARIMPO_DADOS) return process.env.GARIMPO_DADOS;
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "garimpo");
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "garimpo");
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "garimpo");
}

/** O que não precisa de rede continua: o mesmo que o README diz da rede parada. */
const LEMBRETE_LEITURA =
  "O que não precisa de rede continua funcionando: buscas guardadas e ementas dentro das 24 h da memória, PDF já " +
  "baixado na pasta de destino (obter_inteiro_teor) e leitura de PDF (ler_inteiro_teor).";

const semPermissao = (caminho: string) =>
  new RedeParadaError(
    `Rede parada: o Garimpo não tem permissão para ler ou gravar o estado compartilhado de proteção (${caminho}). ` +
      "Nenhuma chamada ao site ou aos tribunais sai até isso ser resolvido. Corrija a permissão de acesso a esse " +
      `caminho para o seu usuário; não apague o arquivo. ${LEMBRETE_LEITURA}`,
  );

const ilegivel = (caminho: string) =>
  new RedeParadaError(
    `Rede parada: o estado compartilhado de proteção do Garimpo está ilegível (${caminho}). Nenhuma chamada ao site ` +
      "ou aos tribunais sai até você agir. Para sair: feche todas as instâncias do Garimpo (todas as janelas do " +
      "Claude que o usam) e mova só este arquivo para outra pasta. Isso apaga o histórico de pausa: as pausas em " +
      `andamento deixam de valer. ${LEMBRETE_LEITURA}`,
  );

const versaoMaisNova = (caminho: string) =>
  new RedeParadaError(
    `Rede parada nesta janela: o estado compartilhado de proteção (${caminho}) foi gravado por uma versão mais nova ` +
      "do Garimpo, que esta janela não entende. Atualize o Garimpo e reinicie esta janela; não apague nem mova o " +
      `arquivo, que as janelas atualizadas continuam usando. ${LEMBRETE_LEITURA}`,
  );

const vagasEsgotadas = (pasta: string) =>
  new Error(
    `O Garimpo esperou ${ESPERA_MAXIMA_POR_VAGA_MS / 60_000} min por uma vaga de chamada e desistiu: as vagas ` +
      `compartilhadas continuam ocupadas ou não puderam ser verificadas (${pasta}). Nada foi liberado. Outra janela ` +
      "do Garimpo pode estar fazendo chamadas longas; tente mais tarde. Se nenhuma estiver, feche todas as instâncias " +
      "do Garimpo (todas as janelas do Claude que o usam) antes de qualquer remoção manual de arquivo dessa pasta; " +
      "na dúvida, reinicie a máquina.",
  );

const codigo = (e: unknown) => (e as NodeJS.ErrnoException)?.code;
const ehPermissao = (e: unknown) => codigo(e) === "EACCES" || codigo(e) === "EPERM";

/**
 * Erros passageiros do Windows (antivírus ou indexador segurando o arquivo, apagamento ainda pendente): tenta de
 * novo por até ~2 s antes de tratar o erro como permissão de verdade.
 */
async function insistir<T>(fazer: () => Promise<T>): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await fazer();
    } catch (e) {
      const passageiro = ehPermissao(e) || codigo(e) === "EBUSY";
      if (!passageiro || tentativa >= 40) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

interface Dono {
  pid: number;
  maquina: string;
  aquisicao: string;
}

const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function conteudoDeDono(aquisicao: string): string {
  return JSON.stringify({ pid: process.pid, maquina: hostname(), aquisicao, desde: new Date().toISOString() });
}

/** Dono gravado num arquivo de vaga ou trava; incompleto ou ilegível = undefined (nunca "livre"). */
async function lerDono(caminho: string): Promise<Dono | "ausente" | undefined> {
  let texto: string;
  try {
    texto = await insistir(() => readFile(caminho, "utf8"));
  } catch (e) {
    return codigo(e) === "ENOENT" ? "ausente" : undefined;
  }
  try {
    const d = JSON.parse(texto);
    const valido =
      Number.isInteger(d?.pid) && d.pid > 0 && typeof d.maquina === "string" && ID_VALIDO.test(d.aquisicao);
    return valido ? { pid: d.pid, maquina: d.maquina, aquisicao: d.aquisicao } : undefined;
  } catch {
    return undefined;
  }
}

/** Só a inexistência comprovada do processo conta; PID existente, sem acesso ou de outra máquina mantém a posse. */
function donoMorto(d: { pid: number; maquina: string }): boolean {
  if (d.maquina !== hostname() || d.pid === process.pid) return false;
  try {
    process.kill(d.pid, 0);
    return false;
  } catch (e) {
    return codigo(e) === "ESRCH";
  }
}

/**
 * Cria o arquivo só se ele não existir, já com o conteúdo inteiro: grava um temporário e o liga ao nome final
 * (a ligação falha se o nome existir, também no Windows). Sem suporte a ligação, cria exclusivo direto.
 */
async function criarExclusivo(pasta: string, caminho: string, conteudo: string): Promise<boolean> {
  const temporario = join(pasta, `.tmp-${randomUUID()}`);
  await insistir(() => writeFile(temporario, conteudo, { flag: "wx" }));
  try {
    return await insistir(async () => {
      try {
        await link(temporario, caminho);
        return true;
      } catch (e) {
        if (codigo(e) === "EEXIST") return false;
        try {
          await writeFile(caminho, conteudo, { flag: "wx" });
          return true;
        } catch (e2) {
          if (codigo(e2) === "EEXIST") return false;
          throw e2;
        }
      }
    });
  } finally {
    await rm(temporario, { force: true }).catch(() => {});
  }
}

/** Arquivos de vaga e trava ocupados por este processo, apagados na saída normal dele. */
const ocupadosPorEsteProcesso = new Map<string, string>();
let limpezaNaSaida = false;

function registrarOcupado(caminho: string, aquisicao: string): void {
  ocupadosPorEsteProcesso.set(caminho, aquisicao);
  if (limpezaNaSaida) return;
  limpezaNaSaida = true;
  process.once("exit", () => {
    for (const [arquivo, id] of ocupadosPorEsteProcesso) {
      try {
        if (JSON.parse(readFileSync(arquivo, "utf8")).aquisicao === id) unlinkSync(arquivo);
      } catch {
        // Sem como conferir: fica para ser retomado quando este PID não existir mais.
      }
    }
  });
}

interface Estado {
  formato: string;
  versao: number;
  /** Última saída por host com pausa (ms no relógio comum). */
  pausas: Record<string, number>;
  /** Disjuntor por serviço; o de um serviço fechado pela prova fica, para a geração não voltar a zero. */
  disjuntores: Record<string, Disjuntor>;
}

export interface OpcoesCoordenacao {
  /** Pasta de dados (padrão: `pastaDeDados()`); a proteção fica na subpasta "protecao". */
  pasta?: string;
  /** Relógio comum a todas as janelas (ms). */
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

/** A coordenação em arquivos comuns, usada por padrão por todos os clientes do processo. */
export class CoordenacaoEmArquivo implements Coordenacao {
  private readonly protecao: string;
  private readonly estado: string;
  private readonly agora: () => number;
  private readonly dormir: (ms: number) => Promise<void>;
  /** Acorda quem espera vaga neste processo assim que uma vaga daqui é liberada. */
  private avisarLiberacao: () => void = () => {};
  private liberacao = this.novaLiberacao();

  constructor(opcoes: OpcoesCoordenacao = {}) {
    this.protecao = join(opcoes.pasta ?? pastaDeDados(), "protecao");
    this.estado = join(this.protecao, "estado.json");
    this.agora = opcoes.agora ?? Date.now;
    this.dormir = opcoes.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async ocupar(conta: ContaDeEspera, sinal?: AbortSignal): Promise<Liberar> {
    await this.prepararPasta();
    let antes = this.agora();
    const contar = () => {
      const agora = this.agora();
      conta.esperadoMs += Math.max(0, agora - antes);
      antes = agora;
    };
    for (;;) {
      const liberar = await this.tentarVagas();
      if (liberar) {
        contar();
        return liberar;
      }
      await this.lerEstado();
      contar();
      if (conta.esperadoMs >= ESPERA_MAXIMA_POR_VAGA_MS) throw vagasEsgotadas(this.protecao);
      if (sinal?.aborted) throw sinal.reason;
      await Promise.race([this.dormir(INTERVALO_DE_CONFERENCIA_MS), this.liberacao]);
    }
  }

  async conferir(p: PedidoDeSaida, agora: () => number): Promise<Ordem> {
    const estado = await this.lerEstado();
    return decidirSaida(estado.disjuntores[p.servico], p.chamada, agora(), p.provaPermitida, donoMorto).ordem;
  }

  async reservarSaida(p: PedidoDeSaida, agora: () => number): Promise<Ordem> {
    const decidir = (estado: Estado, instante: number) =>
      decidirSaida(estado.disjuntores[p.servico], p.chamada, instante, p.provaPermitida, donoMorto);
    // Sem nada a gravar (saída comum sem pausa de host, ou chamada que não sai), basta ler.
    const previa = decidir(await this.lerEstado(), agora());
    if (previa.ordem.tipo !== "sai" || (!previa.novo && p.intervaloMs <= 0)) return previa.ordem;
    return this.comTrava(async () => {
      const estado = await this.lerEstado(true);
      const instante = agora();
      const { ordem, novo } = decidir(estado, instante);
      if (ordem.tipo !== "sai") return ordem;
      if (p.intervaloMs > 0) {
        const ultima = estado.pausas[p.host];
        // Relógio que voltou não prende a chamada além de uma pausa inteira.
        const falta = ultima === undefined ? 0 : Math.min(p.intervaloMs, ultima + p.intervaloMs - instante);
        if (falta > 0) return { tipo: "espera", ms: falta, motivo: "host" };
        estado.pausas[p.host] = instante;
      }
      if (novo) estado.disjuntores[p.servico] = novo;
      await this.gravarEstado(estado);
      return ordem;
    });
  }

  async anotar(servico: string, chamada: Chamada, saida: Saida, r: Resultado, agora: () => number) {
    return this.comTrava(async () => {
      const estado = await this.lerEstado(true);
      const atual = estado.disjuntores[servico];
      const novo = aplicarResultado(atual, chamada, saida, r, agora(), servico);
      if (novo && novo !== atual) {
        estado.disjuntores[servico] = novo;
        await this.gravarEstado(estado);
      }
      return novo?.pausa;
    });
  }

  private novaLiberacao(): Promise<void> {
    return new Promise<void>((r) => (this.avisarLiberacao = r));
  }

  private async prepararPasta(): Promise<void> {
    try {
      await mkdir(this.protecao, { recursive: true });
    } catch (e) {
      throw ehPermissao(e) ? semPermissao(this.protecao) : ilegivel(this.protecao);
    }
  }

  /** Tenta ocupar uma vaga livre (ou de dono comprovadamente morto) sem esperar. */
  private async tentarVagas(): Promise<Liberar | undefined> {
    for (let i = 1; i <= MAXIMO_DE_VAGAS; i++) {
      const caminho = join(this.protecao, `vaga-${i}.json`);
      const aquisicao = await this.criar(caminho);
      if (aquisicao) return this.liberador(caminho, aquisicao);
    }
    return undefined;
  }

  /** Cria o arquivo de posse; se o dono atual comprovadamente morreu, retoma e tenta de novo. */
  private async criar(caminho: string): Promise<string | undefined> {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const aquisicao = randomUUID();
      try {
        if (await criarExclusivo(this.protecao, caminho, conteudoDeDono(aquisicao))) {
          registrarOcupado(caminho, aquisicao);
          return aquisicao;
        }
      } catch (e) {
        throw ehPermissao(e) ? semPermissao(this.protecao) : e;
      }
      const dono = await lerDono(caminho);
      if (dono === "ausente") continue;
      if (!dono || !donoMorto(dono)) return undefined;
      await this.retomar(caminho, dono.aquisicao);
    }
    return undefined;
  }

  /**
   * Apaga a posse de um dono morto. Só quem criar a marca de retomada daquela aquisição apaga, e só se o arquivo
   * ainda for dela: duas janelas nunca apagam juntas nem levam a posse nova de uma terceira.
   */
  private async retomar(caminho: string, aquisicaoMorta: string, profundidade = 0): Promise<void> {
    if (profundidade > 8) return;
    const marca = `${caminho}.retomada-${aquisicaoMorta}`;
    const minha = randomUUID();
    if (!(await criarExclusivo(this.protecao, marca, conteudoDeDono(minha)))) {
      const outro = await lerDono(marca);
      if (outro && outro !== "ausente" && donoMorto(outro)) await this.retomar(marca, outro.aquisicao, profundidade + 1);
      return;
    }
    try {
      const atual = await lerDono(caminho);
      if (atual && atual !== "ausente" && atual.aquisicao === aquisicaoMorta) await insistir(() => rm(caminho));
    } finally {
      await this.soltar(marca, minha);
    }
  }

  /** Apaga o arquivo de posse só se ainda for desta aquisição (nunca a posse nova de outro). */
  private async soltar(caminho: string, aquisicao: string): Promise<void> {
    ocupadosPorEsteProcesso.delete(caminho);
    const dono = await lerDono(caminho);
    if (dono && dono !== "ausente" && dono.aquisicao === aquisicao) {
      await insistir(() => rm(caminho)).catch(() => {});
    }
  }

  private liberador(caminho: string, aquisicao: string): Liberar {
    let liberada: Promise<void> | undefined;
    return () =>
      (liberada ??= this.soltar(caminho, aquisicao).finally(() => {
        const avisar = this.avisarLiberacao;
        this.liberacao = this.novaLiberacao();
        avisar();
      }));
  }

  /** Trava curta para ler e gravar o estado; a de dono morto é retomada, a de dono vivo é esperada. */
  private async comTrava<T>(fazer: () => Promise<T>): Promise<T> {
    await this.prepararPasta();
    const trava = join(this.protecao, "trava.json");
    const inicio = this.agora();
    let aquisicao: string | undefined;
    while (!(aquisicao = await this.criar(trava))) {
      if (this.agora() - inicio >= ESPERA_MAXIMA_POR_VAGA_MS) throw vagasEsgotadas(this.protecao);
      await this.dormir(10);
    }
    try {
      return await fazer();
    } finally {
      await this.soltar(trava, aquisicao);
    }
  }

  /** Lê e confere o estado; ausente = primeiro uso, inicializado sob a trava (nunca sem ela). */
  private async lerEstado(sobTrava = false): Promise<Estado> {
    let texto: string;
    try {
      texto = await insistir(() => readFile(this.estado, "utf8"));
    } catch (e) {
      if (codigo(e) === "ENOENT") {
        if (!sobTrava) return this.comTrava(() => this.lerEstado(true));
        const novo: Estado = { formato: FORMATO_ESTADO, versao: VERSAO_ESTADO, pausas: {}, disjuntores: {} };
        await this.gravarEstado(novo);
        return novo;
      }
      throw ehPermissao(e) ? semPermissao(this.estado) : ilegivel(this.estado);
    }
    let estado: { formato?: unknown; versao?: unknown; pausas?: unknown; disjuntores?: unknown };
    try {
      estado = JSON.parse(texto);
    } catch {
      throw ilegivel(this.estado);
    }
    if (estado?.formato !== FORMATO_ESTADO || !Number.isInteger(estado.versao)) throw ilegivel(this.estado);
    const versao = estado.versao as number;
    if (versao > VERSAO_ESTADO) throw versaoMaisNova(this.estado);
    const { pausas } = estado;
    const disjuntores = versao === 1 ? {} : estado.disjuntores;
    const valido =
      versao >= 1 &&
      typeof pausas === "object" &&
      pausas !== null &&
      Object.values(pausas).every((v) => Number.isFinite(v)) &&
      typeof disjuntores === "object" &&
      disjuntores !== null &&
      Object.values(disjuntores).every(disjuntorValido);
    if (!valido) throw ilegivel(this.estado);
    return { ...estado, versao: VERSAO_ESTADO, pausas, disjuntores } as Estado;
  }

  /** Grava por temporário + renomeação: quem lê vê o estado anterior ou o novo, nunca pela metade. */
  private async gravarEstado(estado: Estado): Promise<void> {
    const temporario = join(this.protecao, `.tmp-${randomUUID()}`);
    try {
      await insistir(() => writeFile(temporario, JSON.stringify(estado), { flag: "wx" }));
      await insistir(() => rename(temporario, this.estado));
    } catch (e) {
      await rm(temporario, { force: true }).catch(() => {});
      throw ehPermissao(e) ? semPermissao(this.estado) : e;
    }
  }
}

let padrao: CoordenacaoEmArquivo | undefined;

/** A coordenação do processo, criada no primeiro uso (lê `GARIMPO_DADOS` nessa hora). */
export function coordenacaoPadrao(): CoordenacaoEmArquivo {
  return (padrao ??= new CoordenacaoEmArquivo());
}
