/**
 * Coordenação entre janelas (ADR-0008 e ADR-0009): todas as janelas do Garimpo do mesmo usuário dividem as 2
 * vagas e a pausa por host (TSE) por arquivos comuns na subpasta de proteção da pasta de dados.
 *
 * - Vaga = arquivo criado só se não existir, com o PID dono e a identificação da aquisição. Liberar = apagar,
 *   conferindo que ainda é a mesma aquisição. Arquivo de vaga incompleto ou ilegível nunca é vaga livre.
 * - Vaga (ou trava) alheia só é retomada quando o PID dono comprovadamente não existe; tempo nunca libera.
 * - A pausa por host é reservada sob uma trava curta, com a vaga já ocupada: duas janelas não saem juntas.
 * - O disjuntor de cada serviço (disjuntor.ts) fica no mesmo estado e é decidido e gravado sob a mesma trava; o
 *   freio preventivo (freio.ts) também, com a reserva do restante feita junto da saída. O orçamento por janela, o limite
 *   próprio de fonte sem restante informado, conta as saídas no mesmo estado e sob a mesma trava.
 * - Estado ilegível, sem permissão ou de versão mais nova = rede parada, com o caminho e a instrução.
 */

import { AsyncLocalStorage } from "node:async_hooks";
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
import {
  anotarOrcamento,
  anotarRestante,
  type ConfigOrcamento,
  decidirFreio,
  decidirOrcamento,
  type Freio,
  freioValido,
  type Orcamento,
  orcamentoValido,
  RESERVA_DO_FREIO,
  type RestanteLido,
  temFreio,
} from "./freio.js";
import { diaEHora } from "./memoria.js";

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
  /** Limite próprio do Garimpo para o serviço (orçamento por janela); ausente = sem orçamento. */
  orcamento?: ConfigOrcamento;
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
  /** Anota no disjuntor do serviço o resultado de uma chamada que saiu; devolve a pausa em vigor, se houver, com as aberturas. */
  anotar(
    servico: string,
    chamada: Chamada,
    saida: Saida,
    r: Resultado,
    agora: () => number,
  ): Promise<(Pausa & { aberturas: number }) | undefined>;
  /** Anota no freio do serviço (só os que têm freio) o restante que a resposta informou, ou a falta de resposta. */
  anotarFreio(servico: string, chamada: Chamada, lido: RestanteLido, agora: () => number): Promise<void>;
}

const MAXIMO_DE_VAGAS = 2;
/** Espera máxima por vaga numa chamada, somadas todas as esperas dela. */
const ESPERA_MAXIMA_POR_VAGA_MS = 3 * 60_000;
const INTERVALO_DE_CONFERENCIA_MS = 250;
const FORMATO_ESTADO = "garimpo-protecao";
/**
 * 1: vagas e pausas; 2: mais os disjuntores e freios; 3: mais os orçamentos (I-04/I-05).
 * As versões 1/2 são migradas sem perder pausas. A 3 impede que janelas antigas ignorem os novos limites.
 */
const VERSAO_ESTADO = 3;

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
 * novo por até ~10 s antes de tratar o erro como permissão de verdade (com a máquina carregada, o antivírus segura
 * o arquivo por mais de 2 s).
 */
export async function insistir<T>(fazer: () => Promise<T>): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await fazer();
    } catch (e) {
      const passageiro = ehPermissao(e) || codigo(e) === "EBUSY";
      if (!passageiro || tentativa >= 200) throw e;
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

/** A ferramenta em andamento, anotada no histórico de recusas (só o nome dela, nunca os argumentos). */
const ferramentaAtual = new AsyncLocalStorage<string>();

/** Roda o pedido de uma ferramenta: as recusas que ele levar ficam no histórico com o nome dela. */
export function naFerramenta<T>(nome: string, fazer: () => T): T {
  return ferramentaAtual.run(nome, fazer);
}

/**
 * O que aconteceu com um serviço: o primeiro 429/503 (pediu-espera), a recusa final (recusou; recusou-a-prova quando
 * foi a chamada de prova, a única que sai depois da pausa), o adiamento pedido pelo serviço (adiou) ou a nova tentativa
 * ou a prova aceita (aceitou: o serviço voltou).
 */
export type TipoDeOcorrencia = "pediu-espera" | "recusou" | "recusou-a-prova" | "adiou" | "aceitou";
const TIPOS_DE_OCORRENCIA: readonly TipoDeOcorrencia[] = ["pediu-espera", "recusou", "recusou-a-prova", "adiou", "aceitou"];

/** Uma linha do histórico curto: só números de controle, nunca termo de busca, endereço ou número de processo. */
export interface Ocorrencia {
  servico: string;
  /** Instante (ms no relógio comum). */
  em: number;
  tipo: TipoDeOcorrencia;
  /** O nome da ferramenta em andamento, se houver. */
  ferramenta?: string;
}

/** Teto do histórico por serviço: ficam as mais recentes de cada um, e um serviço não expulsa as linhas de outro. */
export const HISTORICO_MAXIMO_POR_SERVICO = 10;

function comTeto(historico: readonly Ocorrencia[]): Ocorrencia[] {
  const contagem = new Map<string, number>();
  const ficam: Ocorrencia[] = [];
  for (let i = historico.length - 1; i >= 0; i--) {
    const n = (contagem.get(historico[i].servico) ?? 0) + 1;
    contagem.set(historico[i].servico, n);
    if (n <= HISTORICO_MAXIMO_POR_SERVICO) ficam.push(historico[i]);
  }
  return ficam.reverse();
}

function ocorrenciaDe(r: Resultado, saida: Saida): TipoDeOcorrencia | undefined {
  switch (r.tipo) {
    case "aceita":
      return "aceitou";
    case "pede-espera":
      return "pediu-espera";
    case "adia":
      return "adiou";
    case "recusa-final":
      return saida.papel === "prova" ? "recusou-a-prova" : "recusou";
    default:
      return undefined;
  }
}

function ocorrenciaValida(o: unknown): o is Ocorrencia {
  const x = o as Ocorrencia;
  return (
    typeof x === "object" &&
    x !== null &&
    typeof x.servico === "string" &&
    Number.isFinite(x.em) &&
    TIPOS_DE_OCORRENCIA.includes(x.tipo) &&
    (x.ferramenta === undefined || typeof x.ferramenta === "string")
  );
}

interface Estado {
  formato: string;
  versao: number;
  /** Última saída por host com pausa (ms no relógio comum). */
  pausas: Record<string, number>;
  /** Disjuntor por serviço; o de um serviço fechado pela prova fica, para a geração não voltar a zero. */
  disjuntores: Record<string, Disjuntor>;
  /** Freio preventivo por serviço (freio.ts). */
  freios?: Record<string, Freio>;
  /** Orçamento por janela por serviço (freio.ts): o limite próprio de chamadas do Garimpo. */
  orcamentos?: Record<string, Orcamento>;
  /** Histórico curto do que mudou o disjuntor de cada serviço (só os campos de `Ocorrencia`). */
  historico?: Ocorrencia[];
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
  /** Última vez que esta janela não conseguiu anotar um resultado no estado; `depois`: gravou com sucesso desde então. */
  private falhaAoGravar?: { em: number; motivo: string; depois?: true };

  constructor(opcoes: OpcoesCoordenacao = {}) {
    this.protecao = join(opcoes.pasta ?? pastaDeDados(), "protecao");
    this.estado = join(this.protecao, "estado.json");
    this.agora = opcoes.agora ?? Date.now;
    this.dormir = opcoes.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async ocupar(conta: ContaDeEspera, sinal?: AbortSignal): Promise<Liberar> {
    let antes = this.agora();
    const contar = () => {
      const agora = this.agora();
      conta.esperadoMs += Math.max(0, agora - antes);
      antes = agora;
    };
    for (;;) {
      const liberar = await this.comPasta(() => this.tentarVagas());
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
    const instante = agora();
    const ordem = decidirSaida(estado.disjuntores[p.servico], p.chamada, instante, p.provaPermitida, donoMorto).ordem;
    if (ordem.tipo !== "sai") return ordem;
    if (p.orcamento) {
      const doOrcamento = decidirOrcamento(estado.orcamentos?.[p.servico], p.orcamento, instante).ordem;
      if (doOrcamento.tipo !== "sai") return ordemDoFreio(doOrcamento, ordem);
    }
    if (!temFreio(p.servico)) return ordem;
    return ordemDoFreio(decidirFreio(estado.freios?.[p.servico], p.chamada, instante, donoMorto).ordem, ordem);
  }

  async reservarSaida(p: PedidoDeSaida, agora: () => number): Promise<Ordem> {
    const decidir = (estado: Estado, instante: number) =>
      decidirSaida(estado.disjuntores[p.servico], p.chamada, instante, p.provaPermitida, donoMorto);
    // Sem nada a gravar (saída comum sem pausa de host nem freio, ou chamada que não sai), basta ler.
    const previa = decidir(await this.lerEstado(), agora());
    const freio = temFreio(p.servico);
    if (previa.ordem.tipo !== "sai" || (!previa.novo && p.intervaloMs <= 0 && !freio && !p.orcamento)) return previa.ordem;
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
      }
      let orcamento: Orcamento | undefined;
      if (p.orcamento) {
        const o = decidirOrcamento(estado.orcamentos?.[p.servico], p.orcamento, instante);
        if (o.ordem.tipo !== "sai") return ordemDoFreio(o.ordem, ordem);
        orcamento = o.novo;
      }
      if (freio) {
        const atual = estado.freios?.[p.servico];
        const f = decidirFreio(atual, p.chamada, instante, donoMorto);
        if (f.novo && f.novo !== atual) estado.freios = { ...estado.freios, [p.servico]: f.novo };
        if (f.ordem.tipo !== "sai") {
          // A pausa que começa agora vale para todas as janelas, mesmo esta chamada não saindo.
          if (f.novo !== atual) await this.gravarEstado(estado);
          return ordemDoFreio(f.ordem, ordem);
        }
      }
      if (orcamento) estado.orcamentos = { ...estado.orcamentos, [p.servico]: orcamento };
      if (p.intervaloMs > 0) estado.pausas[p.host] = instante;
      if (novo) estado.disjuntores[p.servico] = novo;
      await this.gravarEstado(estado);
      return ordem;
    });
  }

  async anotar(servico: string, chamada: Chamada, saida: Saida, r: Resultado, agora: () => number) {
    return this.lembrarFalha(() => this.comTrava(async () => {
      const estado = await this.lerEstado(true);
      const atual = estado.disjuntores[servico];
      const novo = aplicarResultado(atual, chamada, saida, r, agora(), servico);
      const orcamento = estado.orcamentos?.[servico];
      const novoOrcamento =
        r.tipo === "aceita" || r.tipo === "erro"
          ? anotarOrcamento(orcamento, r.tipo)
          : r.tipo === "pede-espera" || r.tipo === "recusa-final"
            ? anotarOrcamento(orcamento, "recusa")
            : orcamento;
      if (novoOrcamento && novoOrcamento !== orcamento) estado.orcamentos = { ...estado.orcamentos, [servico]: novoOrcamento };
      if (novoOrcamento !== orcamento && !(novo && novo !== atual)) await this.gravarEstado(estado);
      if (novo && novo !== atual) {
        estado.disjuntores[servico] = novo;
        const tipo = ocorrenciaDe(r, saida);
        if (tipo) {
          const ferramenta = ferramentaAtual.getStore();
          const ocorrencia: Ocorrencia = { servico, em: agora(), tipo, ...(ferramenta && { ferramenta }) };
          estado.historico = comTeto([...(estado.historico ?? []), ocorrencia]);
        }
        await this.gravarEstado(estado);
      }
      return novo?.pausa && { ...novo.pausa, aberturas: novo.aberturas };
    }));
  }

  async anotarFreio(servico: string, chamada: Chamada, lido: RestanteLido, agora: () => number): Promise<void> {
    if (!temFreio(servico)) return;
    await this.lembrarFalha(() => this.comTrava(async () => {
      const estado = await this.lerEstado(true);
      const atual = estado.freios?.[servico];
      const novo = anotarRestante(atual, chamada, lido, agora());
      if (novo && novo !== atual) {
        estado.freios = { ...estado.freios, [servico]: novo };
        await this.gravarEstado(estado);
      }
    }));
  }

  /**
   * "Por que parou?" sem chamar ninguém: lê o estado guardado (sem criá-lo) e explica, fonte por fonte, a pausa, o
   * restante informado e as ocorrências das últimas 24 h. Estado ilegível vira a resposta de rede parada, sem erro.
   */
  async diagnosticar(): Promise<DiagnosticoDosFreios> {
    const agora = this.agora();
    const avisoDeGravacao = this.falhaAoGravar && avisoDeFalha(this.falhaAoGravar);
    let estado: Estado | undefined;
    try {
      estado = await this.lerEstadoGuardado();
    } catch (e) {
      if (!(e instanceof RedeParadaError)) throw e;
      return { semRede: SEM_REDE, redeParada: true, resumo: e.message, ...(avisoDeGravacao && { avisoDeGravacao }) };
    }
    return { ...explicar(estado, agora), ...(avisoDeGravacao && { avisoDeGravacao }) };
  }

  /** Guarda a última falha ao anotar um resultado (ele não chegou ao estado): o diagnóstico avisa. */
  private async lembrarFalha<T>(fazer: () => Promise<T>): Promise<T> {
    try {
      return await fazer();
    } catch (e) {
      this.falhaAoGravar = { em: this.agora(), motivo: (e as Error).message };
      throw e;
    }
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

  /**
   * Faz a operação direto; só se a pasta de proteção faltar (ou não for pasta) é que a prepara e repete uma vez. Evita
   * um mkdir em cada vaga e em cada trava, e o resultado é o mesmo: a pasta é recriada e a falta de acesso aparece igual.
   */
  private async comPasta<T>(fazer: () => Promise<T>): Promise<T> {
    try {
      return await fazer();
    } catch (e) {
      if (codigo(e) !== "ENOENT" && codigo(e) !== "ENOTDIR") throw e;
      await this.prepararPasta();
      return fazer();
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
    const trava = join(this.protecao, "trava.json");
    const inicio = this.agora();
    let aquisicao: string | undefined;
    while (!(aquisicao = await this.comPasta(() => this.criar(trava)))) {
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
    const guardado = await this.lerEstadoGuardado();
    if (guardado) return guardado;
    if (!sobTrava) return this.comTrava(() => this.lerEstado(true));
    const novo: Estado = { formato: FORMATO_ESTADO, versao: VERSAO_ESTADO, pausas: {}, disjuntores: {}, orcamentos: {} };
    await this.gravarEstado(novo);
    return novo;
  }

  /** O estado como está no disco, conferido; ausente = undefined, sem criar pasta, trava nem estado. */
  private async lerEstadoGuardado(): Promise<Estado | undefined> {
    let texto: string;
    try {
      texto = await insistir(() => readFile(this.estado, "utf8"));
    } catch (e) {
      if (codigo(e) === "ENOENT") return undefined;
      throw ehPermissao(e) ? semPermissao(this.estado) : ilegivel(this.estado);
    }
    let estado: {
      formato?: unknown;
      versao?: unknown;
      pausas?: unknown;
      disjuntores?: unknown;
      freios?: unknown;
      orcamentos?: unknown;
      historico?: unknown;
    };
    try {
      estado = JSON.parse(texto);
    } catch {
      throw ilegivel(this.estado);
    }
    if (estado?.formato !== FORMATO_ESTADO || !Number.isInteger(estado.versao)) throw ilegivel(this.estado);
    const versao = estado.versao as number;
    if (versao > VERSAO_ESTADO) throw versaoMaisNova(this.estado);
    const { pausas, freios, orcamentos, historico } = estado;
    const disjuntores = versao === 1 ? {} : estado.disjuntores;
    const valido =
      versao >= 1 &&
      typeof pausas === "object" &&
      pausas !== null &&
      Object.values(pausas).every((v) => Number.isFinite(v)) &&
      typeof disjuntores === "object" &&
      disjuntores !== null &&
      Object.values(disjuntores).every(disjuntorValido) &&
      (freios === undefined || (typeof freios === "object" && freios !== null && Object.values(freios).every(freioValido))) &&
      ((orcamentos === undefined && versao < 3) ||
        (typeof orcamentos === "object" && orcamentos !== null && !Array.isArray(orcamentos) && Object.values(orcamentos).every(orcamentoValido)));
    if (!valido) throw ilegivel(this.estado);
    // O histórico só serve ao diagnóstico: linha que esta versão não entende é descartada, nunca para a rede.
    const lido = { ...estado, versao: VERSAO_ESTADO, pausas, disjuntores, orcamentos: orcamentos ?? {} } as Estado;
    if (historico !== undefined) lido.historico = Array.isArray(historico) ? historico.filter(ocorrenciaValida) : [];
    return lido;
  }

  /** Grava por temporário + renomeação: quem lê vê o estado anterior ou o novo, nunca pela metade. */
  private async gravarEstado(estado: Estado): Promise<void> {
    const temporario = join(this.protecao, `.tmp-${randomUUID()}`);
    try {
      await insistir(() => writeFile(temporario, JSON.stringify(estado), { flag: "wx" }));
      await insistir(() => rename(temporario, this.estado));
      if (this.falhaAoGravar) this.falhaAoGravar.depois = true;
    } catch (e) {
      await rm(temporario, { force: true }).catch(() => {});
      throw ehPermissao(e) ? semPermissao(this.estado) : e;
    }
  }
}

/** A resposta do diagnostico_dos_freios, em linguagem de leigo. */
export interface DiagnosticoDosFreios {
  semRede: string;
  resumo: string;
  redeParada?: true;
  fontes?: FonteNoDiagnostico[];
  ultimas24h?: { servico: string; quando: string; oQueHouve: string; ferramenta?: string }[];
  avisoDeGravacao?: string;
}

const EM_ANDAMENTO = "nova tentativa em andamento";

export interface FonteNoDiagnostico {
  servico: string;
  situacao: string;
  ate?: string;
  explicacao: string;
  /** Pausas por recusa seguidas, sem chamada de prova aceita (a dobra da pausa). */
  pausasSeguidas?: number;
  indicioDeRecusaSistematica?: true;
  /** A mensagem dada quando a recusa aconteceu, guardada como estava; a leitura de agora fica em `explicacao`. */
  mensagemDaRecusa?: string;
  restanteInformado?: number;
  reservaDoFreio?: number;
}

const SEM_REDE =
  "Esta resposta não chamou nenhuma fonte: só leu o estado de proteção guardado neste computador, comum a todas as " +
  "janelas do Garimpo.";
const DIA_MS = 24 * 60 * 60_000;

/**
 * Limiar do indício de recusa sistemática, do autor de origem e ainda sem ajuste próprio (ticket b15/23): nas últimas
 * 24 h, depois da última chamada aceita, ao menos 2 recusas finais, uma delas na chamada de prova, que é uma única
 * chamada depois da pausa (pouco tráfego). Um sucesso no meio desfaz.
 */
export const RECUSAS_PARA_INDICIO = 2;

export function indicioDeRecusaSistematica(historico: readonly Ocorrencia[], servico: string, agora: number): boolean {
  const doServico = historico.filter((o) => o.servico === servico);
  const depoisDoSucesso = doServico.slice(doServico.map((o) => o.tipo).lastIndexOf("aceitou") + 1);
  const recusas = depoisDoSucesso
    .filter((o) => o.em >= agora - DIA_MS && (o.tipo === "recusou" || o.tipo === "recusou-a-prova"));
  return recusas.length >= RECUSAS_PARA_INDICIO && recusas.some((o) => o.tipo === "recusou-a-prova");
}

const O_QUE_HOUVE: Record<TipoDeOcorrencia, string> = {
  "pediu-espera": "pediu para esperar (primeiro 429/503); o Garimpo esperou para fazer uma única nova tentativa",
  recusou: "recusa final: a fonte foi pausada em todas as janelas",
  "recusou-a-prova": "recusou a chamada de prova feita depois da pausa: a pausa recomeçou, dobrada",
  adiou: "pediu para esperar mais que o teto do Garimpo (não é recusa): a fonte ficou adiada",
  aceitou: "aceitou de novo a chamada: a fonte voltou",
};

function explicar(estado: Estado | undefined, agora: number): DiagnosticoDosFreios {
  const historico = estado?.historico ?? [];
  const recentes = historico.filter((o) => o.em >= agora - DIA_MS);
  const fontes: FonteNoDiagnostico[] = [];
  for (const [servico, d] of Object.entries(estado?.disjuntores ?? {})) {
    const fonte = fonteDoDisjuntor(servico, d, historico, agora);
    if (fonte) fontes.push(fonte);
  }
  for (const [servico, f] of Object.entries(estado?.freios ?? {})) {
    if (f.pausaAte !== undefined) fontes.push(fonteDoFreio(servico, f, f.pausaAte, agora));
  }
  for (const [servico, o] of Object.entries(estado?.orcamentos ?? {})) {
    if (o.usadas >= o.limite && agora < o.fim) fontes.push(fonteDoOrcamento(servico, o));
  }
  const sistematicas = fontes.filter((f) => f.indicioDeRecusaSistematica).map((f) => f.servico);
  const recusas = recentes.filter((o) => o.tipo === "recusou" || o.tipo === "recusou-a-prova").length;
  // Com `ate`, a pausa está em vigor; sem ele, venceu e a próxima chamada é a que confere se a fonte voltou.
  const paradas = fontes.filter((f) => f.ate).map((f) => f.servico);
  const emAndamento = fontes.filter((f) => f.situacao === EM_ANDAMENTO).map((f) => f.servico);
  const aguardando = fontes.filter((f) => !f.ate && f.situacao !== EM_ANDAMENTO).map((f) => f.servico);
  const resumo =
    (paradas.length
      ? `Fontes com chamadas paradas agora: ${paradas.join(", ")} (detalhes em "fontes").`
      : aguardando.length || emAndamento.length
        ? ""
        : "Nenhuma fonte está pausada agora: as chamadas podem sair.") +
    (aguardando.length
      ? `${paradas.length ? " " : ""}Pausa vencida, aguardando a chamada de prova (o próximo pedido a faz): ` +
        `${aguardando.join(", ")} (detalhes em "fontes").`
      : "") +
    (emAndamento.length
      ? `${paradas.length || aguardando.length ? " " : ""}Nova tentativa em andamento (as outras chamadas esperam a ` +
        `decisão dela; não precisa repetir): ${emAndamento.join(", ")} (detalhes em "fontes").`
      : "") +
    (sistematicas.length
      ? ` Indício de recusa sistemática em: ${sistematicas.join(", ")} (esperar provavelmente não resolve).`
      : "") +
    (recusas ? ` Recusas finais nas últimas 24 h: ${recusas}.` : "");
  return {
    semRede: SEM_REDE,
    resumo,
    fontes,
    ultimas24h: recentes
      .slice()
      .reverse()
      .map((o) => ({
        servico: o.servico,
        quando: diaEHora(o.em),
        oQueHouve: O_QUE_HOUVE[o.tipo],
        ...(o.ferramenta && { ferramenta: o.ferramenta }),
      })),
  };
}

function fonteDoDisjuntor(
  servico: string,
  d: Disjuntor,
  historico: readonly Ocorrencia[],
  agora: number,
): FonteNoDiagnostico | undefined {
  if (d.pausa) {
    // O próprio disjuntor basta, mesmo com as recusas fora das últimas 24 h ou sem linhas da fonte no histórico
    // (estado de versão anterior): 2 aberturas seguidas só acontecem com a chamada de prova recusada, sem prova
    // aceita no meio.
    const indicio = indicioDeRecusaSistematica(historico, servico, agora) || d.aberturas >= RECUSAS_PARA_INDICIO;
    const vigente = agora < d.pausa.ate;
    const leitura = indicio
      ? `Indício de recusa sistemática: ao menos ${RECUSAS_PARA_INDICIO} recusas seguidas, uma delas na chamada de ` +
        "prova (uma única chamada, depois da pausa), sem nenhuma chamada aceita no meio. Parece que a fonte recusa o " +
        "programa, não uma rajada sua: esperar a pausa provavelmente não resolve, mesmo que a mensagem da recusa peça " +
        "para esperar e tentar de novo. Não insista; se precisar do conteúdo, consulte a fonte pelo navegador. É " +
        "indício, não certeza."
      : "Parece uma rajada: a pausa costuma passar." +
        (vigente ? " Insistir antes da hora não adianta, a chamada nem sai." : "");
    return {
      servico,
      situacao: vigente ? "pausada" : "aguardando a chamada de prova",
      ...(vigente && { ate: diaEHora(d.pausa.ate) }),
      explicacao:
        (vigente
          ? `Disjuntor aberto por recusa: nenhuma chamada a esta fonte sai, em todas as janelas, até ` +
            `${diaEHora(d.pausa.ate)}. Depois, uma única chamada de prova confere se ela voltou a aceitar. `
          : "A pausa venceu: o próximo pedido seu faz a chamada de prova; aceita, as chamadas voltam; recusada, a " +
            "pausa recomeça dobrada. ") +
        leitura,
      ...(d.aberturas > 0 && { pausasSeguidas: d.aberturas }),
      ...(indicio && { indicioDeRecusaSistematica: true as const }),
      mensagemDaRecusa: `Mensagem de quando a recusa aconteceu (a leitura de agora está em "explicacao"): ${d.pausa.aviso}`,
    };
  }
  if (d.adiada && agora < d.adiada.ate) {
    return {
      servico,
      situacao: "adiada pela fonte",
      ate: diaEHora(d.adiada.ate),
      explicacao:
        `Não é recusa: a fonte pediu para esperar até ${diaEHora(d.adiada.ate)}. Depois, a primeira chamada é a ` +
        "nova tentativa.",
    };
  }
  if (d.espera && agora < d.espera.ate) {
    return {
      servico,
      situacao: "esperando a nova tentativa",
      ate: diaEHora(d.espera.ate),
      explicacao:
        "A fonte pediu para esperar (429/503). Todas as janelas esperam; só a chamada recusada faz a única nova " +
        "tentativa. Recusada de novo, a fonte é pausada.",
    };
  }
  if (d.espera && !donoMorto(d.espera.dono)) {
    // Vencida a espera, a única nova tentativa segue em andamento (dono vivo): as outras chamadas continuam
    // esperando a decisão dela (decidirSaida), então a fonte não está liberada nem aguarda a chamada de prova.
    return {
      servico,
      situacao: EM_ANDAMENTO,
      explicacao:
        "A fonte pediu para esperar (429/503) e o prazo passou; a única nova tentativa ainda está em andamento em " +
        "outra chamada. As outras chamadas esperam a decisão dela, sem você precisar repetir nada: aceita, as " +
        "chamadas voltam; recusada de novo, a fonte é pausada.",
    };
  }
  return undefined;
}

function fonteDoFreio(servico: string, f: Freio, pausaAte: number, agora: number): FonteNoDiagnostico {
  const vigente = agora < pausaAte;
  return {
    servico,
    situacao: vigente ? "pausa preventiva" : "aguardando a chamada que confere o limite",
    ...(vigente && { ate: diaEHora(pausaAte) }),
    explicacao:
      "Não é recusa: a própria fonte informa quantos pedidos restam, e o restante chegou à reserva de segurança do " +
      "Garimpo (passar do limite bloqueia o IP por horas). " +
      (vigente
        ? `Nenhuma chamada sai até ${diaEHora(pausaAte)}; depois, a primeira confere o limite antes de liberar as outras.`
        : "A pausa venceu: o próximo pedido seu faz uma única chamada, que confere o limite antes de liberar as outras."),
    ...(f.restante !== undefined && { restanteInformado: f.restante }),
    reservaDoFreio: RESERVA_DO_FREIO,
  };
}

function fonteDoOrcamento(servico: string, o: Orcamento): FonteNoDiagnostico {
  return {
    servico,
    situacao: "pausa preventiva",
    ate: diaEHora(o.fim),
    explicacao: o.diario
      ? `Não é recusa: além do restante que a fonte informa, o Garimpo usa um limite diário próprio (${o.limite} ` +
        "chamadas por dia de Brasília, somadas em todas as janelas), porque o aviso de restante não garante que a fonte " +
        `não bloqueie por horas. O limite de hoje foi usado: nenhuma chamada sai até ${diaEHora(o.fim)} (meia-noite de ` +
        "Brasília)."
      :
      `Não é recusa: esta fonte não informa quantas chamadas restam, e o Garimpo usa um limite próprio (${o.limite} ` +
      `chamadas por janela de tempo, somadas em todas as janelas) para não chegar à recusa. O limite desta janela foi ` +
      `usado: nenhuma chamada sai até ${diaEHora(o.fim)}. Cada recusa da fonte alarga a janela; chamadas aceitas ` +
      "seguidas voltam a afrouxá-la.",
  };
}

function avisoDeFalha(f: { em: number; motivo: string; depois?: true }): string {
  return (
    `Em ${diaEHora(f.em)}, esta janela não conseguiu gravar no estado de proteção o resultado de uma chamada (por ` +
    `exemplo, uma recusa): as outras janelas podem não saber dessa recusa nem da pausa. Motivo: ${f.motivo}` +
    (f.depois ? " Desde então, gravações seguintes desta janela funcionaram; aquela recusa continua sem registro." : "")
  );
}

/** A ordem do freio na linguagem do cliente; "sai" mantém a ordem do disjuntor. */
export function ordemDoFreio(f: ReturnType<typeof decidirFreio>["ordem"], ordem: Ordem): Ordem {
  if (f.tipo === "freio") return f;
  if (f.tipo === "espera") return { tipo: "espera", ms: f.ms, motivo: "freio" };
  return ordem;
}

let padrao: CoordenacaoEmArquivo | undefined;

/** A coordenação do processo, criada no primeiro uso (lê `GARIMPO_DADOS` nessa hora). */
export function coordenacaoPadrao(): CoordenacaoEmArquivo {
  return (padrao ??= new CoordenacaoEmArquivo());
}
