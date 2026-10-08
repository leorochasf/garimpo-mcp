/**
 * Cliente HTTP com as travas de uso responsável (CLAUDE.md, regra 3):
 * - no máximo 2 chamadas simultâneas NO TOTAL das janelas do Garimpo do usuário (JurisprudênciaIA e tribunais
 *   somados), pelas vagas compartilhadas em arquivo (coordenacao.ts);
 * - em 429/503, espera o que o servidor pediu (Retry-After) e tenta UMA vez; pedido acima do teto ou
 *   nova recusa = para e avisa;
 * - 403 ou desafio anti-robô = recusa imediata, sem nova tentativa e sem contorno;
 * - User-Agent honesto identificando o Garimpo;
 * - intervalo mínimo opcional entre chamadas ao mesmo host (ex.: TSE), também entre janelas; a espera dessa
 *   pausa não ocupa vaga.
 */

import { type ContaDeEspera, type Coordenacao, coordenacaoPadrao, type Liberar } from "./coordenacao.js";

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

/** Recusa herdada: a chamada estava na fila quando o serviço recusou outra, e não saiu. */
class RecusaPropagada extends RecusaError {}

/** A resposta veio num formato que o Garimpo não reconhece. */
export class FormatoInesperadoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatoInesperadoError";
  }
}

/** Vagas em memória, só deste objeto, com fila de espera e pausa por host. Só testes do cliente usam. */
export class Vagas implements Coordenacao {
  private ativas = 0;
  private fila: (() => void)[] = [];
  private ultimaPorHost = new Map<string, number>();

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

  async reservarSaida(host: string, intervaloMs: number, agora: () => number): Promise<number> {
    const ultima = this.ultimaPorHost.get(host);
    const falta = ultima === undefined || intervaloMs <= 0 ? 0 : ultima + intervaloMs - agora();
    if (falta > 0) return falta;
    if (intervaloMs > 0) this.ultimaPorHost.set(host, agora());
    return 0;
  }
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
  /** Numeração dos pedidos, para saber quais já estavam na fila quando veio uma recusa. */
  private pedidos = 0;
  private recusa?: { ate: number; erro: RecusaError };
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
    const pedido = ++this.pedidos;
    const host = new URL(url).host;
    const conta: ContaDeEspera = { esperadoMs: 0 };
    let vaga: Liberar | undefined;
    let ida: Ida | undefined;
    try {
      vaga = await this.vagaParaSair(host, pedido, conta, init.signal);
      ida = await this.ir(url, init, pedido);
      if (pedeEspera(ida)) {
        const espera = this.tempoDeEspera(ida.resposta);
        ida.encerrar();
        await this.esperar(espera);
        vaga = await this.vagaParaSair(host, pedido, conta, init.signal, vaga);
        ida = await this.ir(url, init, pedido);
        if (pedeEspera(ida)) {
          throw new RecusaError(
            `${this.opcoes.nome} recusou a chamada duas vezes seguidas (HTTP ${ida.resposta.status}). ` +
              "O Garimpo parou para não sobrecarregar o serviço. Espere alguns minutos e tente de novo.",
            ida.resposta.status,
          );
        }
      }
      const { status, ok } = ida.resposta;
      const redirectManual = init.redirect === "manual" && status >= 300 && status < 400;
      if (!ok && !redirectManual) {
        throw new Error(`${this.opcoes.nome} respondeu com erro HTTP ${status} para ${url}.`);
      }
      return ida.entregar(vaga);
    } catch (e) {
      if (e instanceof RecusaError && !(e instanceof RecusaPropagada)) this.recusa = { ate: this.pedidos, erro: e };
      ida?.encerrar();
      void vaga?.();
      throw e;
    }
  }

  /**
   * Vaga ocupada e saída ao host autorizada agora. Se a pausa do host ainda não venceu, devolve a vaga e espera
   * sem ocupar nada; ao voltar, confere de novo recusa, vaga e pausa.
   */
  private async vagaParaSair(
    host: string,
    pedido: number,
    conta: ContaDeEspera,
    sinal?: AbortSignal | null,
    vaga?: Liberar,
  ): Promise<Liberar> {
    const intervalo = this.opcoes.intervaloMinimoPorHost?.[host] ?? 0;
    for (;;) {
      this.barrarSeJaRecusado(pedido);
      vaga ??= await this.vagas.ocupar(conta, sinal ?? undefined);
      let falta: number;
      try {
        this.barrarSeJaRecusado(pedido);
        falta = await this.vagas.reservarSaida(host, intervalo, this.agora);
      } catch (e) {
        void vaga();
        throw e;
      }
      if (falta <= 0) return vaga;
      await vaga();
      vaga = undefined;
      await this.esperar(falta);
    }
  }

  /** Pedido feito antes de uma recusa deste serviço (e ainda na fila) não sai: herda a recusa. */
  private barrarSeJaRecusado(pedido: number): void {
    if (this.recusa && pedido <= this.recusa.ate) {
      throw new RecusaPropagada(
        `Esta chamada estava na fila e não foi feita: ${this.recusa.erro.message}`,
        this.recusa.erro.status,
      );
    }
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
   * Faz um fetch, com a vaga já ocupada. A recusa é conferida logo antes dele, depois de qualquer espera.
   * Bloqueio e 429/503 são decididos pelo status e cabeçalhos, antes de qualquer leitura do corpo;
   * só as demais respostas têm o começo do corpo lido em busca do aviso de excesso.
   */
  private async ir(url: string, init: RequestInit, pedido: number): Promise<Ida> {
    this.barrarSeJaRecusado(pedido);
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

  /**
   * Espera antes da nova tentativa. Retry-After vale em segundos ou em data HTTP; sem ele, o padrão.
   * Se o servidor pedir mais que o teto, para com recusa: nunca tenta antes do que foi pedido.
   */
  private tempoDeEspera(resposta: Response): number {
    const padrao = this.opcoes.esperaPadraoMs ?? 5_000;
    const maxima = this.opcoes.esperaMaximaMs ?? 30_000;
    const valor = resposta.headers.get("retry-after")?.trim();
    let ms = padrao;
    if (valor && /^\d+$/.test(valor)) ms = Number(valor) * 1000;
    else if (valor && Number.isFinite(Date.parse(valor))) ms = Math.max(0, Date.parse(valor) - this.agora());
    if (ms > maxima) {
      throw new RecusaError(
        `${this.opcoes.nome} pediu para esperar ${Math.ceil(ms / 1000)} s antes de nova chamada (HTTP ${resposta.status}), ` +
          `mais que o teto de ${Math.round(maxima / 1000)} s do Garimpo. O Garimpo parou em vez de tentar mais cedo. ` +
          "Espere esse tempo e tente de novo.",
        resposta.status,
      );
    }
    return ms;
  }
}

/** Desafio anti-robô conhecido (Cloudflare "managed", AWS WAF 202). */
function desafioAntiRobo(resposta: Response): boolean {
  if (resposta.headers.get("cf-mitigated") === "challenge") return true;
  if (resposta.status === 202 && resposta.headers.has("x-amzn-waf-action")) return true;
  return false;
}
