/**
 * Cliente HTTP com as travas de uso responsável (CLAUDE.md, regra 3):
 * - no máximo 2 chamadas simultâneas NO TOTAL das janelas do Garimpo do usuário (JurisprudênciaIA e tribunais
 *   somados), pelas vagas compartilhadas em arquivo (coordenacao.ts);
 * - em 429/503, espera o que o servidor pediu (Retry-After) e tenta UMA vez; as outras chamadas ao mesmo serviço,
 *   em todas as janelas, esperam essa decisão sem ocupar vaga;
 * - recusa final (nova recusa, 403, desafio anti-robô, pedido acima do teto) abre o disjuntor do serviço para
 *   todas as janelas: as chamadas a ele falham na hora até a pausa vencer, e então sai uma só chamada de prova
 *   (disjuntor.ts);
 * - identificação por fonte: User-Agent honesto identificando o Garimpo; só o Falcão (ADR-0018) e o portal do STF
 *   (ADR-0020), que recusam quem não se apresenta como navegador, recebem UA de navegador fixo por versão e
 *   cabeçalhos de navegador;
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
import { dataEHora } from "./memoria.js";
import { anotarRestante, decidirFreio, type Freio, lerRestante, type RestanteLido, temFreio } from "./freio.js";

export const VERSAO = "0.3.4";
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
};

/** Intervalo mínimo por host que vale em todo cliente, somado ao das opções (ms). */
const INTERVALO_POR_HOST: Record<string, number> = { [HOST_FALCAO]: 1_000 };

/** O site ou o tribunal negou a chamada. Nunca é contornada. */
export class RecusaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
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
    if (ordem.tipo !== "sai" || !temFreio(p.servico)) return ordem;
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
    if (temFreio(p.servico)) {
      const f = decidirFreio(this.freios.get(p.servico), p.chamada, instante, () => false);
      if (f.novo) this.freios.set(p.servico, f.novo);
      if (f.ordem.tipo !== "sai") return ordemDoFreio(f.ordem, ordem);
    }
    if (p.intervaloMs > 0) this.ultimaPorHost.set(p.host, instante);
    if (novo) this.disjuntores.set(p.servico, novo);
    return ordem;
  }

  async anotar(servico: string, chamada: Chamada, saida: Saida, r: Resultado, agora: () => number) {
    const novo = aplicarResultado(this.disjuntores.get(servico), chamada, saida, r, agora(), servico);
    if (novo) this.disjuntores.set(servico, novo);
    return novo?.pausa;
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
  /** Teto da espera, mesmo que o servidor peça mais (ms). */
  esperaMaximaMs?: number;
  /** Pedido acima do teto adia o serviço (não é recusa) em vez de abrir o disjuntor (DJEN). */
  adiaAcimaDoTeto?: boolean;
  /** Intervalo mínimo entre chamadas ao mesmo host (ms), por host. */
  intervaloMinimoPorHost?: Record<string, number>;
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

  constructor(prazoMs: number, estouro: Error) {
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
  async lerAviso(): Promise<void> {
    const r = this.resposta;
    const tipo = r.headers.get("content-type") ?? "";
    if (!tipo.includes("text") && !tipo.includes("json")) return;
    if (Number(r.headers.get("content-length")) > LIMITE_AVISO || !r.body) return;
    const leitor = (this.leitor = r.body.getReader());
    let total = 0;
    while (!this.fim && total <= LIMITE_AVISO) {
      const { done, value } = await ler(leitor, this.controle.signal);
      if (done) this.fim = true;
      else {
        this.lidos.push(value);
        total += value.length;
      }
    }
    this.excesso = this.fim && /excesso de requisi/i.test(new TextDecoder().decode(Buffer.concat(this.lidos)));
  }

  /** O `userMessage` de um corpo JSON curto (recusa do Falcão), já limpo; qualquer outra coisa = undefined. */
  async lerMensagemDoServico(): Promise<string | undefined> {
    try {
      await this.lerAviso();
      if (!this.fim) return undefined;
      const valor = JSON.parse(new TextDecoder().decode(Buffer.concat(this.lidos)))?.userMessage;
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
const pedeEspera = (ida: Ida) => ida.resposta.status === 429 || ida.resposta.status === 503 || ida.excesso;

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
      if (pedeEspera(ida)) {
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
      const pedido: PedidoDeSaida = { host, intervaloMs, servico, chamada, provaPermitida };
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
        );
      }
      if (ordem.tipo === "adiado") {
        throw new AdiadaError(
          `Esta chamada não foi feita: ${this.opcoes.nome} pediu para esperar até ${dataEHora(ordem.ate)}, para todas ` +
            "as janelas do Garimpo. Não é recusa: depois desse instante, a primeira chamada é a nova tentativa.",
          ordem.ate,
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
    let pausa: Pausa | undefined;
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
    );
  }

  /** Só a nova tentativa e a chamada de prova mudam o disjuntor ao terminar; a chamada comum não anota nada. */
  private async anotar(servico: string, chamada: Chamada, saida: Saida, r: Resultado): Promise<void> {
    if (saida.papel !== "normal") await this.vagas.anotar(servico, chamada, saida, r, this.agora);
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
    const ida = new Ida(prazoMs, estouro);
    // O freio do serviço anota o restante de toda resposta, ou a falta dela (a liberação não fica presa).
    const anotarFreio = (lido: RestanteLido) =>
      temFreio(servico) ? this.vagas.anotarFreio(servico, chamada, lido, this.agora) : Promise.resolve();
    try {
      ida.resposta = await this.fetchFn(url, { ...init, headers, signal: ida.controle.signal }).catch((e: Error) => {
        throw ida.controle.signal.reason === estouro
          ? estouro
          : new Error(`Não foi possível falar com ${this.opcoes.nome} (${e.message}). Verifique a conexão.`);
      });
      await anotarFreio(lerRestante(ida.resposta.headers));
      await this.barrarBloqueio(ida, url);
      if (!pedeEspera(ida)) await ida.lerAviso();
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

/** Desafio anti-robô conhecido (Cloudflare "managed", AWS WAF 202). */
function desafioAntiRobo(resposta: Response): boolean {
  if (resposta.headers.get("cf-mitigated") === "challenge") return true;
  if (resposta.status === 202 && resposta.headers.has("x-amzn-waf-action")) return true;
  return false;
}
