/**
 * Cliente HTTP com as travas de uso responsável (CLAUDE.md, regra 3):
 * - no máximo 2 chamadas simultâneas NO TOTAL das janelas do Garimpo do usuário (JurisprudênciaIA e tribunais
 *   somados), pelas vagas compartilhadas em arquivo (coordenacao.ts);
 * - em 429/503, espera o que o servidor pediu (Retry-After) e tenta UMA vez; as outras chamadas ao mesmo serviço,
 *   em todas as janelas, esperam essa decisão sem ocupar vaga;
 * - recusa final (nova recusa, 403, desafio anti-robô, pedido acima do teto) abre o disjuntor do serviço para
 *   todas as janelas: as chamadas a ele falham na hora até a pausa vencer, e então sai uma só chamada de prova
 *   (disjuntor.ts);
 * - User-Agent honesto identificando o Garimpo;
 * - intervalo mínimo opcional entre chamadas ao mesmo host (ex.: TSE), também entre janelas; a espera dessa
 *   pausa não ocupa vaga.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  type ContaDeEspera,
  type Coordenacao,
  coordenacaoPadrao,
  type Liberar,
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

export const VERSAO = "0.2.0";
export const USER_AGENT = `Garimpo/${VERSAO} (cliente MCP local e nao oficial de pesquisa de jurisprudencia)`;

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
    return decidirSaida(this.disjuntores.get(p.servico), p.chamada, agora(), p.provaPermitida, () => false).ordem;
  }

  async reservarSaida(p: PedidoDeSaida, agora: () => number): Promise<Ordem> {
    const instante = agora();
    const disjuntor = this.disjuntores.get(p.servico);
    const { ordem, novo } = decidirSaida(disjuntor, p.chamada, instante, p.provaPermitida, () => false);
    if (ordem.tipo !== "sai") return ordem;
    const ultima = this.ultimaPorHost.get(p.host);
    const falta = ultima === undefined || p.intervaloMs <= 0 ? 0 : ultima + p.intervaloMs - instante;
    if (falta > 0) return { tipo: "espera", ms: falta, motivo: "host" };
    if (p.intervaloMs > 0) this.ultimaPorHost.set(p.host, instante);
    if (novo) this.disjuntores.set(p.servico, novo);
    return ordem;
  }

  async anotar(servico: string, chamada: Chamada, saida: Saida, r: Resultado, agora: () => number) {
    const novo = aplicarResultado(this.disjuntores.get(servico), chamada, saida, r, agora(), servico);
    if (novo) this.disjuntores.set(servico, novo);
    return novo?.pausa;
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
        ida = await this.ir(url, init);
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
        if (pedidaMs > teto) {
          const erro = new RecusaError(
            `${this.opcoes.nome} pediu para esperar ${Math.ceil(pedidaMs / 1000)} s antes de nova chamada (HTTP ${status}), ` +
              `mais que o teto de ${Math.round(teto / 1000)} s do Garimpo. O Garimpo parou em vez de tentar mais cedo. ` +
              "Espere esse tempo e tente de novo.",
            status,
          );
          throw await this.abrir(servico, chamada, saida, erro, pedidaMs);
        }
        if (saida.papel === "prova" || recusada) {
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
          throw new Error(`${this.opcoes.nome} respondeu com erro HTTP ${status} para ${url}.`);
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
    const intervaloMs = this.opcoes.intervaloMinimoPorHost?.[host] ?? 0;
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
        throw new Error(
          `Esta chamada não foi feita: ${this.opcoes.nome} pediu uma pausa e a decisão (a nova tentativa ou a chamada ` +
            `de prova de outra chamada) não veio em ${ESPERA_MAXIMA_PELA_DECISAO_MS / 60_000} min. Tente mais tarde.`,
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

  /** 403 ou desafio anti-robô: recusa imediata, antes de qualquer espera ou nova tentativa. */
  private barrarBloqueio(resposta: Response): void {
    if (resposta.status === 403 || desafioAntiRobo(resposta)) {
      throw new RecusaError(
        `${this.opcoes.nome} bloqueou a chamada (HTTP ${resposta.status}, proteção anti-robô ou acesso negado). ` +
          "O Garimpo não contorna bloqueios. Se precisar do conteúdo, abra o link no navegador.",
        resposta.status,
      );
    }
  }

  /**
   * Faz um fetch, com a vaga já ocupada e a saída autorizada.
   * Bloqueio e 429/503 são decididos pelo status e cabeçalhos, antes de qualquer leitura do corpo;
   * só as demais respostas têm o começo do corpo lido em busca do aviso de excesso.
   */
  private async ir(url: string, init: RequestInit): Promise<Ida> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", USER_AGENT);
    const prazoMs = this.opcoes.prazoMs ?? 120_000;
    const estouro = new Error(
      `${this.opcoes.nome} não respondeu em ${Math.ceil(prazoMs / 1000)} s; o Garimpo desistiu da chamada. Tente mais tarde.`,
    );
    const ida = new Ida(prazoMs, estouro);
    try {
      ida.resposta = await this.fetchFn(url, { ...init, headers, signal: ida.controle.signal }).catch((e: Error) => {
        throw ida.controle.signal.reason === estouro
          ? estouro
          : new Error(`Não foi possível falar com ${this.opcoes.nome} (${e.message}). Verifique a conexão.`);
      });
      this.barrarBloqueio(ida.resposta);
      if (!pedeEspera(ida)) await ida.lerAviso();
      return ida;
    } catch (e) {
      ida.encerrar();
      throw e;
    }
  }

  /** Espera pedida pelo serviço: Retry-After em segundos ou em data HTTP; sem ele, o padrão. */
  private esperaPedida(resposta: Response): number {
    const valor = resposta.headers.get("retry-after")?.trim();
    if (valor && /^\d+$/.test(valor)) return Number(valor) * 1000;
    if (valor && Number.isFinite(Date.parse(valor))) return Math.max(0, Date.parse(valor) - this.agora());
    return this.opcoes.esperaPadraoMs ?? 5_000;
  }
}

/** Desafio anti-robô conhecido (Cloudflare "managed", AWS WAF 202). */
function desafioAntiRobo(resposta: Response): boolean {
  if (resposta.headers.get("cf-mitigated") === "challenge") return true;
  if (resposta.status === 202 && resposta.headers.has("x-amzn-waf-action")) return true;
  return false;
}
