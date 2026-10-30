/**
 * Cliente HTTP com as travas de uso responsável (CLAUDE.md, regra 3):
 * - no máximo 2 chamadas simultâneas NO TOTAL das janelas do Garimpo do usuário (JurisprudênciaIA e tribunais
 *   somados), pelas vagas compartilhadas em arquivo (coordenacao.ts);
 * - em 429/503, espera o que o servidor pediu (Retry-After) e tenta UMA vez; as outras chamadas ao mesmo serviço,
 *   em todas as janelas, esperam essa decisão sem ocupar vaga;
 * - recusa final (nova recusa, 403, desafio anti-robô por cabeçalho ou pela página, resposta corrompida pelo filtro,
 *   pedido acima do teto) abre o disjuntor do serviço para todas as janelas: as chamadas a ele falham na hora até a
 *   pausa vencer, e então sai uma só chamada de prova (disjuntor.ts);
 * - identificação por fonte: User-Agent honesto identificando o Garimpo; só o Falcão (ADR-0018), o portal do STF
 *   (ADR-0020) e o portal de jurisprudência do TJTO (ADR-0021), que recusam quem não se apresenta como navegador,
 *   recebem UA de navegador fixo por versão e cabeçalhos de navegador;
 * - intervalo mínimo entre chamadas ao mesmo host (opcional, ex.: TSE; sempre 1 s no Falcão), também entre janelas; a
 *   espera dessa pausa não ocupa vaga;
 * - opcional (DJEN): pedido de espera acima do teto vira adiamento, não recusa: a chamada volta na hora com o
 *   instante permitido e o serviço fica adiado para todas as janelas, sem abrir nem dobrar o disjuntor;
 * - freio preventivo no Falcão (freio.ts): para antes do bloqueio, pelo restante que ele informa, em todas as janelas.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  type ContaDeEspera,
  type Coordenacao,
  coordenacaoPadrao,
  type Liberar,
  ordemDoFreio,
  type PedidoDeSaida,
} from "./coordenacao.js";
import {
  aplicarResultado,
  type Chamada,
  decidirSaida,
  type Disjuntor,
  esperaMinimaDe,
  novaChamada,
  type Ordem,
  type Pausa,
  type Resultado,
  type Saida,
  servicoDe,
} from "./disjuntor.js";
import { htmlParaTexto } from "./html.js";
import { dataEHora } from "./memoria.js";
import {
  anotarOrcamento,
  anotarRestante,
  type ConfigOrcamento,
  decidirFreio,
  decidirOrcamento,
  type Freio,
  lerRestante,
  type Orcamento,
  type RestanteLido,
  temFreio,
} from "./freio.js";

export const VERSAO = "1.2.1";
export const USER_AGENT = `Garimpo/${VERSAO} (cliente MCP local e nao oficial de pesquisa de jurisprudencia)`;

/** Host do Falcão (CSJT), a única fonte que recebe UA de navegador (ADR-0018). */
export const HOST_FALCAO = "jurisprudencia.jt.jus.br";
/** UA de navegador fixo por versão do Garimpo (Firefox 139, o da prova do B12); muda só com nova versão. */
export const UA_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0";

/**
 * Portal do STF: recusa (403) o UA do Garimpo; o dono autorizou o UA de navegador nele (ADR-0020). Só os
 * precedentes ao vivo usam esse host.
 */
export const HOST_PORTAL_STF = "portal.stf.jus.br";

/** Portal de jurisprudência do TJTO: recusa (403) o UA do Garimpo; o dono autorizou o UA de navegador nele (ADR-0021). */
export const HOST_TJTO = "jurisprudencia.tjto.jus.br";

/**
 * Marcas estruturais do documento do eproc que o portal do TJTO entrega (prova de 2026-10-11): seções com
 * data-nome "identificacao_processo" e "ementa". Página de erro, de aviso ou de desafio não as tem.
 */
const MARCAS_DO_DOCUMENTO_TJTO = [
  /<section[^>]*\sdata-nome=["']identificacao_processo["']/i,
  /<section[^>]*\sdata-nome=["']ementa["']/i,
];

/** Texto útil mínimo do documento do TJTO (caracteres): um acórdão com ementa, relatório e voto passa disso com folga. */
const MINIMO_TEXTO_TJTO = 500;

/**
 * A página é o acórdão do TJTO? Tem as marcas estruturais do documento do eproc e texto útil mínimo. A mesma regra
 * vale no cliente (página que não é o acórdão é procurada inteira por desafio) e no extrator (só o acórdão é entregue).
 */
export function ehDocumentoTjto(html: string): boolean {
  return MARCAS_DO_DOCUMENTO_TJTO.every((marca) => marca.test(html)) && htmlParaTexto(html).length >= MINIMO_TEXTO_TJTO;
}

/** Charset de quem não declara nenhum (cabeçalho nem <meta>), por host: o portal do TJTO usa ISO-8859-1 (prova de 2026-10-11). */
const CHARSET_PADRAO_POR_HOST: Record<string, string> = { [HOST_TJTO]: "iso-8859-1" };

/** Decodifica a resposta de um host: Content-Type, depois <meta>, depois o padrão do host (UTF-8 fora da lista). */
export function decodificarDoHost(bytes: Uint8Array, contentType: string, host: string): string {
  return decodificar(bytes, contentType, CHARSET_PADRAO_POR_HOST[host]);
}

/** Cabeçalhos de identificação por host; host fora daqui vai com o UA honesto. Cada fonte nova acrescenta o seu. */
const IDENTIFICACAO_POR_HOST: Record<string, Record<string, string>> = {
  [HOST_FALCAO]: {
    "User-Agent": UA_NAVEGADOR,
    Origin: `https://${HOST_FALCAO}`,
    Referer: `https://${HOST_FALCAO}/jurisprudencia-nacional/`,
    Accept: "application/json, text/plain, */*",
  },
  [HOST_PORTAL_STF]: {
    "User-Agent": UA_NAVEGADOR,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9",
  },
  [HOST_TJTO]: {
    "User-Agent": UA_NAVEGADOR,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9",
  },
};

/** Intervalo mínimo por host que vale em todo cliente, somado ao das opções (ms). */
const INTERVALO_POR_HOST: Record<string, number> = { [HOST_FALCAO]: 1_000 };

/**
 * Limite próprio de chamadas por janela de tempo, por serviço, para fonte que não informa quanto resta (G-05, DQ-25).
 * Números iniciais conservadores e sem prova: o uso real ajusta. Serviço fora daqui não tem orçamento.
 */
const ORCAMENTO_DE_FONTE_SEM_RESTANTE: ConfigOrcamento = { chamadas: 30, largurasMs: [5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000] };
/** Falcão (serviço "jt"): teto diário do Garimpo, por dia civil de Brasília (G-01, DQ-01); número inicial conservador, sem prova. */
export const TETO_DIARIO_DO_FALCAO = 50;
const ORCAMENTO_POR_SERVICO: Record<string, ConfigOrcamento> = {
  jt: { chamadas: TETO_DIARIO_DO_FALCAO, largurasMs: [], diario: true },
  "stf-precedentes": ORCAMENTO_DE_FONTE_SEM_RESTANTE,
  "stj-precedentes": ORCAMENTO_DE_FONTE_SEM_RESTANTE,
  tse: ORCAMENTO_DE_FONTE_SEM_RESTANTE,
};

/** O site ou o tribunal negou a chamada. Nunca é contornada. */
export class RecusaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /**
     * Só quando o disjuntor do serviço está aberto: o instante em que a pausa acaba, os segundos que faltam agora e
     * as aberturas seguidas (2 ou mais = a chamada de prova já foi recusada).
     */
    readonly pausa?: { ate: number; segundos: number; aberturas: number },
  ) {
    super(message);
    this.name = "RecusaError";
  }
}

/** O serviço respondeu com erro HTTP que não é recusa nem pedido de espera (ex.: 401, 404, 500). */
export class ErroHttp extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ErroHttp";
  }
}

/** O serviço pediu para esperar até `ate` (não é recusa): a chamada não foi feita. */
export class AdiadaError extends Error {
  constructor(
    message: string,
    readonly ate: number,
  ) {
    super(message);
    this.name = "AdiadaError";
  }
}

/**
 * O freio preventivo parou a chamada antes de sair: não é recusa do serviço, é o Garimpo evitando o bloqueio do IP.
 * `ate` = a partir de quando pode tentar de novo (sem promessa de liberação).
 */
export class PausaPreventivaError extends Error {
  constructor(
    message: string,
    readonly ate: number,
    /** Segundos que faltavam para `ate` quando o erro nasceu. */
    readonly segundos?: number,
  ) {
    super(message);
    this.name = "PausaPreventivaError";
  }
}

/** A resposta veio num formato que o Garimpo não reconhece. */
export class FormatoInesperadoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatoInesperadoError";
  }
}

/** Vagas em memória, só deste objeto, com fila de espera, pausa por host e disjuntores. Só testes do cliente usam. */
export class Vagas implements Coordenacao {
  private ativas = 0;
  private fila: (() => void)[] = [];
  private ultimaPorHost = new Map<string, number>();
  private disjuntores = new Map<string, Disjuntor>();
  private freios = new Map<string, Freio>();
  private orcamentos = new Map<string, Orcamento>();

  constructor(private readonly max: number) {}

  async ocupar(): Promise<Liberar> {
    if (this.ativas < this.max) this.ativas++;
    else await new Promise<void>((r) => this.fila.push(r));
    let liberada = false;
    return async () => {
      if (liberada) return;
      liberada = true;
      const proximo = this.fila.shift();
      if (proximo) proximo();
      else this.ativas--;
    };
  }

  async conferir(p: PedidoDeSaida, agora: () => number): Promise<Ordem> {
    const instante = agora();
    const ordem = decidirSaida(this.disjuntores.get(p.servico), p.chamada, instante, p.provaPermitida, () => false).ordem;
    if (ordem.tipo !== "sai") return ordem;
    if (p.orcamento) {
      const doOrcamento = decidirOrcamento(this.orcamentos.get(p.servico), p.orcamento, instante).ordem;
      if (doOrcamento.tipo !== "sai") return ordemDoFreio(doOrcamento, ordem);
    }
    if (!temFreio(p.servico)) return ordem;
    return ordemDoFreio(decidirFreio(this.freios.get(p.servico), p.chamada, instante, () => false).ordem, ordem);
  }

  async reservarSaida(p: PedidoDeSaida, agora: () => number): Promise<Ordem> {
    const instante = agora();
    const disjuntor = this.disjuntores.get(p.servico);
    const { ordem, novo } = decidirSaida(disjuntor, p.chamada, instante, p.provaPermitida, () => false);
    if (ordem.tipo !== "sai") return ordem;
    const ultima = this.ultimaPorHost.get(p.host);
    const falta = ultima === undefined || p.intervaloMs <= 0 ? 0 : ultima + p.intervaloMs - instante;
    if (falta > 0) return { tipo: "espera", ms: falta, motivo: "host" };
    let orcamento: Orcamento | undefined;
    if (p.orcamento) {
      const o = decidirOrcamento(this.orcamentos.get(p.servico), p.orcamento, instante);
      if (o.ordem.tipo !== "sai") return ordemDoFreio(o.ordem, ordem);
      orcamento = o.novo;
    }
    if (temFreio(p.servico)) {
      const f = decidirFreio(this.freios.get(p.servico), p.chamada, instante, () => false);
      if (f.novo) this.freios.set(p.servico, f.novo);
      if (f.ordem.tipo !== "sai") return ordemDoFreio(f.ordem, ordem);
    }
    if (orcamento) this.orcamentos.set(p.servico, orcamento);
    if (p.intervaloMs > 0) this.ultimaPorHost.set(p.host, instante);
    if (novo) this.disjuntores.set(p.servico, novo);
    return ordem;
  }

  async anotar(servico: string, chamada: Chamada, saida: Saida, r: Resultado, agora: () => number) {
    const novo = aplicarResultado(this.disjuntores.get(servico), chamada, saida, r, agora(), servico);
    if (novo) this.disjuntores.set(servico, novo);
    const orcamento = r.tipo === "aceita" || r.tipo === "erro" ? r.tipo : r.tipo === "pede-espera" || r.tipo === "recusa-final" ? "recusa" : undefined;
    const doOrcamento = orcamento && anotarOrcamento(this.orcamentos.get(servico), orcamento);
    if (doOrcamento) this.orcamentos.set(servico, doOrcamento);
    return novo?.pausa && { ...novo.pausa, aberturas: novo.aberturas };
  }

  async anotarFreio(servico: string, chamada: Chamada, lido: RestanteLido, agora: () => number) {
    if (!temFreio(servico)) return;
    const novo = anotarRestante(this.freios.get(servico), chamada, lido, agora());
    if (novo) this.freios.set(servico, novo);
  }
}

/** A ferramenta em andamento: cada uma faz no máximo uma chamada de prova (a busca ampla faz muitas chamadas). */
const ferramenta = new AsyncLocalStorage<{ provaFeita: boolean }>();

/** Roda uma ferramenta que faz várias chamadas: dentro dela, só uma pode ser chamada de prova. */
export function umaProvaPorFerramenta<T>(fazer: () => Promise<T>): Promise<T> {
  return ferramenta.run({ provaFeita: false }, fazer);
}

export interface OpcoesCliente {
  /** Nome de quem responde, usado nas mensagens ("o JurisprudênciaIA", "o STJ"). */
  nome: string;
  /** Vagas de concorrência; padrão: as compartilhadas entre as janelas (2 no total). Só testes trocam. */
  vagas?: Coordenacao;
  /** Espera antes da nova tentativa quando não há Retry-After (ms). */
  esperaPadraoMs?: number;
  /** Status adicionais que usam a mesma espera e única nova tentativa de 429/503 (gerador dos Espelhos: 504). */
  statusAdicionaisDeEspera?: readonly number[];
  /** Teto da espera, mesmo que o servidor peça mais (ms). */
  esperaMaximaMs?: number;
  /** Pedido acima do teto adia o serviço (não é recusa) em vez de abrir o disjuntor (DJEN). */
  adiaAcimaDoTeto?: boolean;
  /** Intervalo mínimo entre chamadas ao mesmo host (ms), por host. */
  intervaloMinimoPorHost?: Record<string, number>;
  /** Limite próprio de chamadas por janela, por serviço, somado ao da tabela do Garimpo (a opção vence). Só testes trocam. */
  orcamentoPorServico?: Record<string, ConfigOrcamento>;
  /** Prazo máximo de cada chamada, do envio ao fim da leitura do corpo (ms). */
  prazoMs?: number;
  fetch?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  agora?: () => number;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Espera máxima pela decisão de outra chamada (nova tentativa ou prova), somada à espera por vaga. */
const ESPERA_MAXIMA_PELA_DECISAO_MS = 3 * 60_000;

/** "O STJ" → "ao STJ". */
const ao = (nome: string) => (nome.startsWith("O ") ? `ao ${nome.slice(2)}` : `a ${nome}`);

/** Hora de retorno, arredondada para o minuto seguinte (nunca antes da pausa vencer); com a data se não for hoje. */
function horaDeRetorno(ate: number, agora: number): string {
  const d = new Date(Math.ceil(ate / 60_000) * 60_000);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date(agora).toDateString() ? hora : `${d.toLocaleDateString("pt-BR")} ${hora}`;
}

/** Corpo curto o bastante para ser o aviso de recusa do TSE (bytes). */
const LIMITE_AVISO = 2_000;

/**
 * Uma ida ao servidor: fetch e leitura do corpo sob um só AbortController e um só prazo.
 * Encerra exatamente uma vez — corpo lido até o fim, erro, cancelamento pelo chamador ou prazo — e então
 * desarma o prazo, aborta o fetch (o que fecha a conexão) e devolve a vaga ao dono, se houver.
 */
class Ida {
  readonly controle = new AbortController();
  resposta!: Response;
  /** "Excesso de requisições" no começo do corpo. */
  excesso = false;
  private readonly relogio: ReturnType<typeof setTimeout>;
  private leitor?: ReadableStreamDefaultReader<Uint8Array>;
  /** Começo do corpo já lido (aviso do TSE), guardado para quem ler depois. */
  private lidos: Uint8Array[] = [];
  private fim = false;
  private encerrada = false;
  private dono = () => {};

  /** `host`: o da URL pedida, que escolhe o charset de quem não declara nenhum. */
  constructor(prazoMs: number, estouro: Error, private readonly host = "") {
    this.relogio = setTimeout(() => this.controle.abort(estouro), prazoMs);
    this.relogio.unref?.();
    this.controle.signal.addEventListener("abort", () => this.encerrar(), { once: true });
  }

  encerrar(): void {
    if (this.encerrada) return;
    this.encerrada = true;
    clearTimeout(this.relogio);
    this.controle.abort();
    (this.leitor ?? this.resposta?.body)?.cancel().catch(() => {});
    this.dono();
  }

  /**
   * O TSE responde "Excesso de requisições" no corpo, às vezes com status 200. Só o começo do corpo de texto
   * é lido (até LIMITE_AVISO bytes, mais o pedaço em curso) e fica guardado para quem ler a resposta.
   */
  async lerAviso(limite = LIMITE_AVISO, mesmoMaior = false): Promise<void> {
    const r = this.resposta;
    const tipo = r.headers.get("content-type") ?? "";
    if (!tipo.includes("text") && !tipo.includes("json") && !tipo.includes("xhtml")) return;
    // `mesmoMaior`: lê o começo (até o limite) também de corpo declarado maior que ele.
    if ((!mesmoMaior && Number(r.headers.get("content-length")) > limite) || !r.body) return;
    const leitor = (this.leitor = r.body.getReader());
    let total = 0;
    while (!this.fim && total <= limite) {
      const { done, value } = await ler(leitor, this.controle.signal);
      if (done) this.fim = true;
      else {
        this.lidos.push(value);
        total += value.length;
      }
    }
    this.excesso = this.fim && total <= LIMITE_AVISO && /excesso de requisi/i.test(this.textoLido());
  }

  /** O corpo inteiro, se a leitura do começo chegou ao fim; senão, undefined. */
  corpoPequeno(): string | undefined {
    return this.fim ? this.textoLido() : undefined;
  }

  /** O que foi lido do corpo (inteiro ou só o começo), decodificado. */
  textoLido(): string {
    const bytes = Buffer.concat(this.lidos);
    return decodificarDoHost(bytes, this.resposta.headers.get("content-type") ?? "", this.host);
  }

  /** O `userMessage` de um corpo JSON curto (recusa do Falcão), já limpo; qualquer outra coisa = undefined. */
  async lerMensagemDoServico(): Promise<string | undefined> {
    try {
      await this.lerAviso();
      if (!this.fim) return undefined;
      const valor = JSON.parse(this.textoLido())?.userMessage;
      return typeof valor === "string" ? textoExternoLimpo(valor) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Entrega a resposta ao chamador; a vaga (dono) só volta quando a ida se encerrar. */
  entregar(dono: () => void): Response {
    this.dono = dono;
    const r = this.resposta;
    if (!r.body) {
      this.encerrar();
      return r;
    }
    const leitor = (this.leitor ??= r.body.getReader());
    // Cancelado o corpo, uma leitura em curso termina sem dados: quem encerra é o cancelamento.
    let cancelado = false;
    const corpo = new ReadableStream<Uint8Array>({
      pull: async (c) => {
        try {
          const guardado = this.lidos.shift();
          if (guardado) return c.enqueue(guardado);
          if (!this.fim) {
            const { done, value } = await ler(leitor, this.controle.signal);
            if (cancelado) return;
            if (!done) return c.enqueue(value);
          }
          c.close();
          this.encerrar();
        } catch (e) {
          if (cancelado) return;
          this.encerrar();
          throw e;
        }
      },
      // A vaga volta quando o cancelamento termina; se ele nunca terminar, o prazo a devolve.
      cancel: async (motivo) => {
        cancelado = true;
        await leitor.cancel(motivo);
        this.encerrar();
      },
    });
    return new Response(corpo, { status: r.status, statusText: r.statusText, headers: r.headers });
  }
}

/** Lê um pedaço do corpo; o abort (prazo) interrompe a leitura mesmo que o corpo nunca reaja. */
function ler(
  leitor: ReadableStreamDefaultReader<Uint8Array>,
  sinal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (sinal.aborted) return Promise.reject(sinal.reason);
  return new Promise((resolver, rejeitar) => {
    const aoAbortar = () => rejeitar(sinal.reason);
    sinal.addEventListener("abort", aoAbortar, { once: true });
    leitor
      .read()
      .then(resolver, rejeitar)
      .finally(() => sinal.removeEventListener("abort", aoAbortar));
  });
}

/** 429/503 ou aviso de excesso: o serviço pede para esperar. */
const pedeEspera = (ida: Ida, adicionais: readonly number[] = []) =>
  ida.resposta.status === 429 || ida.resposta.status === 503 || adicionais.includes(ida.resposta.status) || ida.excesso;

export class Cliente {
  private readonly vagas: Coordenacao;
  private readonly fetchFn: typeof fetch;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly agora: () => number;

  constructor(private readonly opcoes: OpcoesCliente) {
    this.vagas = opcoes.vagas ?? coordenacaoPadrao();
    this.fetchFn = opcoes.fetch ?? fetch;
    this.esperar = opcoes.esperar ?? dormir;
    this.agora = opcoes.agora ?? Date.now;
  }

  /**
   * Faz a chamada respeitando as travas. Devolve a resposta já aceita (2xx; ou 3xx, se o chamador pediu
   * redirect "manual" para validar cada salto).
   * A vaga de concorrência só é liberada quando o corpo é lido até o fim, falha, é cancelado ou estoura o prazo.
   */
  async requisitar(url: string, init: RequestInit = {}): Promise<Response> {
    const host = new URL(url).host;
    const servico = servicoDe(url);
    const chamada = novaChamada();
    const conta: ContaDeEspera = { esperadoMs: 0 };
    /** A saída que levou um 429/503: a próxima ida é a sua única nova tentativa. */
    let recusada: Saida | undefined;
    for (;;) {
      let vaga: Liberar;
      let saida: Saida;
      try {
        ({ vaga, saida } = await this.vagaParaSair(host, servico, chamada, conta, init.signal));
      } catch (e) {
        const desistiu: Resultado = { tipo: "desistiu" };
        if (recusada) await this.vagas.anotar(servico, chamada, recusada, desistiu, this.agora).catch(() => {});
        throw e;
      }
      let ida: Ida;
      try {
        ida = await this.ir(url, init, servico, chamada);
      } catch (e) {
        void vaga();
        if (e instanceof RecusaError) throw await this.abrir(servico, chamada, saida, e, 0);
        await this.anotar(servico, chamada, saida, { tipo: "erro" });
        throw e;
      }
      if (pedeEspera(ida, this.opcoes.statusAdicionaisDeEspera)) {
        const { status } = ida.resposta;
        const pedidaMs = this.esperaPedida(ida.resposta);
        ida.encerrar();
        await vaga();
        const teto = this.opcoes.esperaMaximaMs ?? 30_000;
        if (pedidaMs > teto && this.opcoes.adiaAcimaDoTeto && saida.papel === "normal" && !recusada) {
          const ate = this.agora() + pedidaMs;
          const aviso =
            `${this.opcoes.nome} pediu para esperar até ${dataEHora(ate)} (HTTP ${status}); o Garimpo não insiste antes ` +
            "disso. Não é recusa: depois desse instante, a primeira chamada é a nova tentativa.";
          await this.vagas.anotar(servico, chamada, saida, { tipo: "adia", ate, aviso }, this.agora);
          throw new AdiadaError(aviso, ate);
        }
        if (pedidaMs > teto) {
          const erro = new RecusaError(
            `${this.opcoes.nome} pediu para esperar ${Math.ceil(pedidaMs / 1000)} s antes de nova chamada (HTTP ${status}), ` +
              `mais que o teto de ${Math.round(teto / 1000)} s do Garimpo. O Garimpo parou em vez de tentar mais cedo. ` +
              "Espere esse tempo e tente de novo.",
            status,
          );
          throw await this.abrir(servico, chamada, saida, erro, pedidaMs);
        }
        // A tentativa que vem depois de um adiamento não tem a recusa anterior nesta chamada, mas é a segunda.
        if (saida.papel === "prova" || saida.papel === "tentativa" || recusada) {
          const erro = new RecusaError(
            saida.papel === "prova"
              ? `${this.opcoes.nome} recusou a chamada de prova (HTTP ${status}), feita depois de uma pausa por recusa.`
              : `${this.opcoes.nome} recusou a chamada duas vezes seguidas (HTTP ${status}). ` +
                  "O Garimpo parou para não sobrecarregar o serviço. Espere alguns minutos e tente de novo.",
            status,
          );
          throw await this.abrir(servico, chamada, saida, erro, 0);
        }
        recusada = saida;
        const espera = Math.max(pedidaMs, esperaMinimaDe(servico));
        await this.vagas.anotar(servico, chamada, saida, { tipo: "pede-espera", ms: espera }, this.agora);
        // Sem vaga. Se outra chamada já registrou a espera, a nova tentativa é dela: esta espera também a decisão.
        await this.esperar(espera);
        continue;
      }
      const { status, ok } = ida.resposta;
      const redirectManual = init.redirect === "manual" && status >= 300 && status < 400;
      try {
        if (!ok && !redirectManual) {
          await this.anotar(servico, chamada, saida, { tipo: "erro" });
          throw new ErroHttp(`${this.opcoes.nome} respondeu com erro HTTP ${status} para ${url}.`, status);
        }
        await this.anotar(servico, chamada, saida, { tipo: "aceita" });
      } catch (e) {
        ida.encerrar();
        void vaga();
        throw e;
      }
      return ida.entregar(vaga);
    }
  }

  /**
   * Vaga ocupada e saída autorizada agora pelo disjuntor do serviço e pela pausa do host. As esperas (decisão de
   * outra chamada, pausa do host) não ocupam vaga; ao voltar delas, tudo é conferido de novo.
   */
  private async vagaParaSair(
    host: string,
    servico: string,
    chamada: Chamada,
    conta: ContaDeEspera,
    sinal?: AbortSignal | null,
  ): Promise<{ vaga: Liberar; saida: Saida }> {
    const intervaloMs = Math.max(this.opcoes.intervaloMinimoPorHost?.[host] ?? 0, INTERVALO_POR_HOST[host] ?? 0);
    for (;;) {
      if (sinal?.aborted) throw sinal.reason;
      const provaPermitida = !ferramenta.getStore()?.provaFeita;
      const orcamento = this.orcamentoDe(servico);
      const pedido: PedidoDeSaida = { host, intervaloMs, servico, chamada, provaPermitida, ...(orcamento && { orcamento }) };
      // Antes da vaga: serviço pausado falha na hora, mesmo com as vagas ocupadas por chamadas a outros serviços.
      let ordem = await this.vagas.conferir(pedido, this.agora);
      if (ordem.tipo === "sai") {
        const vaga = await this.vagas.ocupar(conta, sinal ?? undefined);
        try {
          ordem = await this.vagas.reservarSaida(pedido, this.agora);
        } catch (e) {
          void vaga();
          throw e;
        }
        if (ordem.tipo === "sai") {
          const atual = ferramenta.getStore();
          if (ordem.saida.papel === "prova" && atual) atual.provaFeita = true;
          return { vaga, saida: ordem.saida };
        }
        await vaga();
      }
      if (ordem.tipo === "pausado") {
        throw new RecusaError(
          `Esta chamada não foi feita: as chamadas ${ao(this.opcoes.nome)} estão pausadas em todas as janelas do ` +
            `Garimpo até ${horaDeRetorno(ordem.ate, this.agora())}, por causa de uma recusa. ${ordem.aviso}`,
          undefined,
          { ...this.pausaAte(ordem.ate), aberturas: ordem.aberturas },
        );
      }
      if (ordem.tipo === "adiado") {
        throw new AdiadaError(
          `Esta chamada não foi feita: ${this.opcoes.nome} pediu para esperar até ${dataEHora(ordem.ate)}, para todas ` +
            "as janelas do Garimpo. Não é recusa: depois desse instante, a primeira chamada é a nova tentativa.",
          ordem.ate,
        );
      }
      if (ordem.tipo === "freio" && ordem.por === "dia") {
        throw new PausaPreventivaError(
          `Esta chamada não foi feita: as chamadas ${ao(this.opcoes.nome)} estão em pausa preventiva em todas as ` +
            "janelas do Garimpo. Este é o limite diário do próprio Garimpo, que já foi usado: mesmo quando o serviço " +
            "informa que ainda há saldo, passar do limite pode bloquear o IP por horas. Não é recusa do serviço. O " +
            `dia recomeça à meia-noite de Brasília; pode tentar a partir de ${horaDeRetorno(ordem.ate, this.agora())}.`,
          ordem.ate,
          this.pausaAte(ordem.ate).segundos,
        );
      }
      if (ordem.tipo === "freio" && ordem.por === "janela") {
        throw new PausaPreventivaError(
          `Esta chamada não foi feita: as chamadas ${ao(this.opcoes.nome)} estão em pausa preventiva em todas as ` +
            "janelas do Garimpo. Ele não informa quantas chamadas restam; este é o limite de chamadas do próprio " +
            "Garimpo por janela de tempo, que já foi usado, para não chegar à recusa. Não é recusa do serviço. Pode " +
            `tentar a partir de ${horaDeRetorno(ordem.ate, this.agora())}.`,
          ordem.ate,
          this.pausaAte(ordem.ate).segundos,
        );
      }
      if (ordem.tipo === "freio") {
        throw new PausaPreventivaError(
          `Esta chamada não foi feita: as chamadas ${ao(this.opcoes.nome)} estão em pausa preventiva em todas as ` +
            "janelas do Garimpo. O limite de pedidos que ele informa chegou à reserva de segurança do Garimpo, e " +
            "passar do limite bloqueia o IP por horas. Não é recusa do serviço. Pode tentar a partir de " +
            `${horaDeRetorno(ordem.ate, this.agora())}; a primeira chamada depois disso confere o limite antes de ` +
            "liberar as outras, sem garantia de liberação.",
          ordem.ate,
          this.pausaAte(ordem.ate).segundos,
        );
      }
      if (ordem.tipo === "sem-prova") {
        throw new Error(
          `Esta chamada não foi feita: a pausa das chamadas ${ao(this.opcoes.nome)} venceu, mas esta ferramenta já ` +
            "fez a sua chamada de prova, que falhou sem recusa; cada ferramenta faz no máximo uma. Tente de novo em " +
            "alguns segundos.",
        );
      }
      if (ordem.motivo === "host") {
        await this.esperar(ordem.ms);
        continue;
      }
      const antes = this.agora();
      await this.esperar(ordem.ms);
      conta.esperadoMs += Math.max(0, this.agora() - antes);
      if (conta.esperadoMs >= ESPERA_MAXIMA_PELA_DECISAO_MS) {
        const decisao =
          ordem.motivo === "freio"
            ? `a chamada que confere o limite depois da pausa preventiva (feita por outra chamada) não terminou em`
            : `${this.opcoes.nome} pediu uma pausa e a decisão (a nova tentativa ou a chamada de prova de outra ` +
              "chamada) não veio em";
        throw new Error(
          `Esta chamada não foi feita: ${decisao} ${ESPERA_MAXIMA_PELA_DECISAO_MS / 60_000} min. Tente mais tarde.`,
        );
      }
    }
  }

  /** A recusa final abre o disjuntor do serviço; a mensagem ganha a hora de retorno. */
  private async abrir(servico: string, chamada: Chamada, saida: Saida, erro: RecusaError, pausaPedidaMs: number) {
    let pausa: (Pausa & { aberturas: number }) | undefined;
    try {
      const resultado: Resultado = { tipo: "recusa-final", pausaPedidaMs, aviso: erro.message };
      pausa = await this.vagas.anotar(servico, chamada, saida, resultado, this.agora);
    } catch {
      return erro; // estado inacessível: a próxima chamada já para a rede e diz por quê
    }
    if (!pausa) return erro;
    return new RecusaError(
      `${erro.message} As chamadas ${ao(this.opcoes.nome)} ficam pausadas em todas as janelas do Garimpo até ` +
        `${horaDeRetorno(pausa.ate, this.agora())}; depois disso, uma única chamada de prova confere se o serviço ` +
        "voltou a aceitar.",
      erro.status,
      { ...this.pausaAte(pausa.ate), aberturas: pausa.aberturas },
    );
  }

  private pausaAte(ate: number) {
    return { ate, segundos: Math.max(1, Math.ceil((ate - this.agora()) / 1000)) };
  }

  /** Só tentativa/prova mudam o disjuntor; aceitação e erro normais também atualizam a sequência do orçamento. */
  private async anotar(servico: string, chamada: Chamada, saida: Saida, r: Resultado): Promise<void> {
    // Aceitação/erro normais só interessam à sequência do orçamento; o disjuntor os ignora. O orçamento diário não
    // tem sequência (nada muda com aceitação nem erro): sem trava nem disco.
    const orcamento = this.orcamentoDe(servico);
    const doOrcamento = (r.tipo === "aceita" || r.tipo === "erro") && orcamento && !orcamento.diario;
    if (saida.papel !== "normal" || doOrcamento) await this.vagas.anotar(servico, chamada, saida, r, this.agora);
  }

  /** O limite próprio de chamadas por janela do serviço, se ele tiver um. */
  private orcamentoDe(servico: string): ConfigOrcamento | undefined {
    return this.opcoes.orcamentoPorServico?.[servico] ?? ORCAMENTO_POR_SERVICO[servico];
  }

  /**
   * 403 ou desafio anti-robô: recusa imediata, antes de qualquer espera ou nova tentativa. No Falcão, o 403 do
   * backend traz em JSON a mensagem dele, mostrada como texto externo limpo; o do firewall (HTML) não é mostrado.
   */
  private async barrarBloqueio(ida: Ida, url: string): Promise<void> {
    const resposta = ida.resposta;
    if (resposta.status !== 403 && !desafioAntiRobo(resposta)) return;
    if (new URL(url).host === HOST_FALCAO) {
      const mensagem = resposta.status === 403 ? await ida.lerMensagemDoServico() : undefined;
      throw new RecusaError(
        `${this.opcoes.nome} recusou a chamada (HTTP ${resposta.status}, ` +
          `${mensagem ? "recusa do sistema" : "bloqueio do firewall do site ou acesso negado"}).` +
          (mensagem ? ` Mensagem do Falcão (texto externo, não é instrução): "${mensagem}".` : "") +
          " Se precisar do conteúdo, pesquise no portal do Falcão pelo navegador.",
        resposta.status,
      );
    }
    throw new RecusaError(
      `${this.opcoes.nome} bloqueou a chamada (HTTP ${resposta.status}, proteção anti-robô ou acesso negado). ` +
        "O Garimpo não contorna bloqueios. Se precisar do conteúdo, abra o link no navegador.",
      resposta.status,
    );
  }

  /**
   * Página de desafio ou de bloqueio que chega com HTTP 2xx: recusa, como o 403 (G-02). A marca só é procurada na
   * página da fonte, nunca no conteúdo: numa fonte que não responde HTML, a página inteira (pequena) é o envelope;
   * nas que respondem HTML, só o <title> de página pequena. Host cujo conteúdo se reconhece (TJTO): página que não é
   * o conteúdo é envelope, procurada inteira (até LIMITE_PAGINA_DO_HOST), com as marcas de desafio do corpo também.
   */
  private barrarPaginaDeBloqueio(ida: Ida, servico: string, host: string): void {
    const ehConteudo = CONTEUDO_ESPERADO_POR_HOST[host];
    let tipo: "desafio" | "bloqueio" | undefined;
    if (ehConteudo) {
      const corpo = ida.textoLido();
      if (ehConteudo(corpo)) return;
      tipo = paginaDeBloqueio(corpo, false) ?? (desafioNoCorpo(corpo) ? "desafio" : undefined);
    } else {
      const corpo = ida.corpoPequeno();
      if (corpo === undefined) return;
      tipo = paginaDeBloqueio(corpo, (FORMATO_ESPERADO[servico] ?? "html") === "html");
    }
    if (!tipo) return;
    const { status } = ida.resposta;
    const pagina = tipo === "bloqueio" ? "de acesso bloqueado" : "de verificação anti-robô";
    throw new RecusaError(
      `${this.opcoes.nome} respondeu com uma página ${pagina} (HTTP ${status}) em vez do conteúdo. ` +
        "O Garimpo não contorna bloqueios. Se precisar do conteúdo, abra o link no navegador.",
      status,
    );
  }

  /**
   * Faz um fetch, com a vaga já ocupada e a saída autorizada.
   * Bloqueio e 429/503 são decididos pelo status e cabeçalhos, antes de qualquer leitura do corpo;
   * só as demais respostas têm o começo do corpo lido em busca do aviso de excesso.
   */
  private async ir(url: string, init: RequestInit, servico: string, chamada: Chamada): Promise<Ida> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", USER_AGENT);
    for (const [nome, valor] of Object.entries(IDENTIFICACAO_POR_HOST[new URL(url).host] ?? {})) headers.set(nome, valor);
    const prazoMs = this.opcoes.prazoMs ?? 120_000;
    const estouro = new Error(
      `${this.opcoes.nome} não respondeu em ${Math.ceil(prazoMs / 1000)} s; o Garimpo desistiu da chamada. Tente mais tarde.`,
    );
    const host = new URL(url).host;
    const ida = new Ida(prazoMs, estouro, host);
    // O freio do serviço anota o restante de toda resposta, ou a falta dela (a liberação não fica presa).
    const anotarFreio = (lido: RestanteLido) =>
      temFreio(servico) ? this.vagas.anotarFreio(servico, chamada, lido, this.agora) : Promise.resolve();
    try {
      ida.resposta = await this.fetchFn(url, { ...init, headers, signal: ida.controle.signal }).catch((e: Error) => {
        if (ida.controle.signal.reason === estouro) throw estouro;
        // Cabeçalho que o parser do Node rejeita (HPE_*): é o filtro anti-robô corrompendo a resposta (G-03).
        const codigo = erroDoParser(e);
        if (codigo) {
          throw new RecusaError(
            `${this.opcoes.nome} mandou uma resposta corrompida, que o Node recusou (${codigo}): sinal de ` +
              "filtro anti-robô. O Garimpo não contorna bloqueios. Se precisar do conteúdo, abra o link no navegador.",
          );
        }
        throw new Error(`Não foi possível falar com ${this.opcoes.nome} (${e.message}). Verifique a conexão.`);
      });
      await anotarFreio(lerRestante(ida.resposta.headers));
      await this.barrarBloqueio(ida, url);
      if (!pedeEspera(ida, this.opcoes.statusAdicionaisDeEspera)) {
        const html = ida.resposta.ok && /html/i.test(ida.resposta.headers.get("content-type") ?? "");
        if (html && CONTEUDO_ESPERADO_POR_HOST[host]) await ida.lerAviso(LIMITE_PAGINA_DO_HOST, true);
        else await ida.lerAviso(html ? LIMITE_PAGINA_PEQUENA : LIMITE_AVISO);
        if (html) this.barrarPaginaDeBloqueio(ida, servico, host);
      }
      return ida;
    } catch (e) {
      ida.encerrar();
      // Sem resposta (rede, prazo, fetch que falha antes de sair): a liberação do freio não fica presa.
      if (!ida.resposta) await anotarFreio("sem-resposta").catch(() => {});
      throw e;
    }
  }

  /**
   * Espera pedida pelo serviço: Retry-After (ou o x-rate-limit-retry-after-seconds do Falcão) em segundos ou em data
   * HTTP; sem ele, o padrão.
   */
  private esperaPedida(resposta: Response): number {
    const lidas = ["retry-after", "x-rate-limit-retry-after-seconds"].flatMap((nome) => {
      const valor = resposta.headers.get(nome)?.trim();
      if (valor && /^\d+$/.test(valor)) return [Number(valor) * 1000];
      if (valor && Number.isFinite(Date.parse(valor))) return [Math.max(0, Date.parse(valor) - this.agora())];
      return [];
    });
    // Os dois cabeçalhos com valores diferentes: vale a espera maior.
    return lidas.length ? Math.max(...lidas) : (this.opcoes.esperaPadraoMs ?? 5_000);
  }
}

/**
 * Texto de um serviço externo mostrado ao usuário: puro (sem HTML nem crases), curto, sem endereço, e-mail, sequência
 * longa de dígitos (CPF, CNPJ, número de processo) nem código longo que possa ser segredo.
 */
export function textoExternoLimpo(texto: string, maximo = 200): string {
  const limpo = texto
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[endereço retirado]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[e-mail retirado]")
    .replace(/\d[\d.\-/]{9,}\d/g, "[número retirado]")
    .replace(/(?<![\w-])(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{20,}(?![\w-])/g, "[código retirado]")
    .replace(/[`<>{}\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return limpo.length > maximo ? `${limpo.slice(0, maximo - 1).trimEnd()}…` : limpo;
}

/** Corpo HTML pequeno o bastante para ser página de desafio ou de bloqueio (bytes); maior que isso, é conteúdo. */
const LIMITE_PAGINA_PEQUENA = 64 * 1024;

/**
 * O que cada serviço responde quando aceita (pelo nome no disjuntor). Fora daqui, o formato varia ou é HTML (inteiro
 * teor dos tribunais, portais de precedentes): a marca de bloqueio só vale no <title>. Cada fonte nova declara o seu.
 */
const FORMATO_ESPERADO: Record<string, "json" | "html" | "pdf"> = {
  jurisprudenciaia: "json",
  datajud: "json",
  djen: "json",
  jt: "json",
  // eSAJ do TJCE: aceita com PDF; página de texto no lugar dele é envelope (captcha dos eSAJs de outros tribunais).
  tjce: "pdf",
};

/** Hosts cujo conteúdo se reconhece no HTML: o que não é o conteúdo é envelope, procurado inteiro por desafio. */
const CONTEUDO_ESPERADO_POR_HOST: Record<string, (html: string) => boolean> = { [HOST_TJTO]: ehDocumentoTjto };

/**
 * Teto do que se lê do corpo HTML desses hosts antes de entregar (bytes): o acórdão do TJTO tem ~174 KB (prova de
 * 2026-10-11). Acima disso, só o começo é examinado; se ele não é o acórdão, o extrator também não o entrega.
 */
const LIMITE_PAGINA_DO_HOST = 4 * 1024 * 1024;

/** Marcas fortes, sem acento e em minúsculas: valem na página inteira (não verificadas ao vivo). */
const MARCAS_DE_BLOQUEIO: [RegExp, "desafio" | "bloqueio"][] = [
  [/pagina bloqueada|acesso bloqueado/, "bloqueio"],
  [/verificacao de seguranca/, "desafio"],
  // Instrução do captcha do eSAJ (TJAL, TJAM e TJAC em 29/10/2026), sem título; só vale onde a página nunca é conteúdo.
  [/digite o codigo da figura/, "desafio"],
];

/** Marcas fracas: "captcha" aparece até em script de reCAPTCHA de página normal, então só valem no <title>. */
const MARCAS_SO_NO_TITULO = /captcha|just a moment/;

/**
 * Marcas de desafio que só valem no envelope (página que não é o conteúdo esperado do host): no texto, sem acento e
 * em minúsculas; e no HTML cru, o widget do Turnstile e o script do desafio do Cloudflare.
 */
const MARCAS_DE_DESAFIO_NO_TEXTO = /captcha|just a moment|verify you are human/;
const MARCAS_DE_DESAFIO_NO_HTML = /cf-turnstile|\/cdn-cgi\/challenge-platform\//i;

/** O envelope tem marca de desafio no corpo ou no título? */
function desafioNoCorpo(html: string): boolean {
  return (
    MARCAS_DE_DESAFIO_NO_TEXTO.test(`${normal(htmlParaTexto(html))}\n${normal(tituloDaPagina(html))}`) ||
    MARCAS_DE_DESAFIO_NO_HTML.test(html)
  );
}

/** Sem acento e em minúsculas, para comparar com as marcas. */
function normal(t: string): string {
  return t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Carregador do desafio do F5 (TSPD), que pode vir sem título. Só fora das fontes HTML. */
const CARREGADOR_DE_DESAFIO = /src=["'][^"']*\/tspd\//;

/** Título maior que isso é ementa-título de conteúdo, não de página de desafio. */
const LIMITE_TITULO = 80;

/** Texto do <title> do <head> (ou, sem <head>, de antes do <body>), com entidades decodificadas; "" se não houver. */
function tituloDaPagina(html: string): string {
  const topo = html.split(/<body[\s>]/i)[0] ?? "";
  const titulo = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(topo)?.[1] ?? "";
  return htmlParaTexto(titulo);
}

/**
 * A página é de desafio ou de bloqueio? As marcas fortes valem na página inteira (entidades decodificadas) só nas
 * fontes que não respondem HTML (`soTitulo` falso), onde a página nunca é conteúdo; "captcha" e "just a moment" valem
 * só no <title> curto, em qualquer fonte.
 */
function paginaDeBloqueio(html: string, soTitulo: boolean): "desafio" | "bloqueio" | undefined {
  const titulo = tituloDaPagina(html);
  const noTitulo = titulo.length <= LIMITE_TITULO ? normal(titulo) : "";
  const onde = soTitulo ? noTitulo : `${normal(htmlParaTexto(html))}\n${noTitulo}`;
  for (const [marca, tipo] of MARCAS_DE_BLOQUEIO) if (marca.test(onde)) return tipo;
  if (MARCAS_SO_NO_TITULO.test(noTitulo)) return "desafio";
  return !soTitulo && CARREGADOR_DE_DESAFIO.test(normal(html)) ? "desafio" : undefined;
}

/**
 * Texto no conjunto de caracteres que a resposta declara (cabeçalho Content-Type ou, na falta, meta charset / XML
 * encoding nos primeiros bytes); sem declaração, o padrão (UTF-8, salvo pedido); com nome desconhecido, UTF-8.
 */
export function decodificar(bytes: Uint8Array, contentType: string, padrao = "utf-8"): string {
  const declarado =
    /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(Buffer.from(bytes.subarray(0, 1024)).toString("latin1"))?.[1] ??
    /^<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i.exec(Buffer.from(bytes.subarray(0, 200)).toString("latin1"))?.[1];
  try {
    return new TextDecoder(declarado ?? padrao).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** O código HPE_* do parser HTTP do Node, no erro ou na sua causa (o fetch do Node 22 o põe em `cause`). */
function erroDoParser(e: unknown): string | undefined {
  for (let atual = e, n = 0; atual && n < 3; atual = (atual as { cause?: unknown }).cause, n++) {
    const code = (atual as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("HPE_")) return code;
  }
  return undefined;
}

/** Desafio anti-robô conhecido (Cloudflare "managed", AWS WAF 202). */
function desafioAntiRobo(resposta: Response): boolean {
  if (resposta.headers.get("cf-mitigated") === "challenge") return true;
  if (resposta.status === 202 && resposta.headers.has("x-amzn-waf-action")) return true;
  return false;
}
