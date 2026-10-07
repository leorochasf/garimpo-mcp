/**
 * Cliente HTTP com as travas de uso responsável (CLAUDE.md, regra 3):
 * - no máximo 2 chamadas simultâneas NO TOTAL do processo (JurisprudênciaIA e tribunais somados);
 * - em 429/503, espera o que o servidor pediu (Retry-After) e tenta UMA vez; pedido acima do teto ou
 *   nova recusa = para e avisa;
 * - 403 ou desafio anti-robô = recusa imediata, sem nova tentativa e sem contorno;
 * - User-Agent honesto identificando o Garimpo;
 * - intervalo mínimo opcional entre chamadas ao mesmo host (ex.: TSE).
 */

export const VERSAO = "0.1.0";
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

/** Vagas de chamada simultânea, com fila de espera. */
export class Vagas {
  private ativas = 0;
  private fila: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async entrar(): Promise<void> {
    if (this.ativas < this.max) {
      this.ativas++;
      return;
    }
    await new Promise<void>((r) => this.fila.push(r));
  }

  sair(): void {
    const proximo = this.fila.shift();
    if (proximo) proximo();
    else this.ativas--;
  }
}

/** Limite único do processo: todos os clientes (site e tribunais) dividem estas 2 vagas. */
export const vagasDoProcesso = new Vagas(2);

export interface OpcoesCliente {
  /** Nome de quem responde, usado nas mensagens ("o JurisprudênciaIA", "o STJ"). */
  nome: string;
  /** Vagas de concorrência; padrão: as do processo (2 no total). Só testes trocam. */
  vagas?: Vagas;
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

/** Uma ida ao servidor: a resposta (corpo sob prazo), o sinal desse prazo e se veio "Excesso de requisições". */
interface Tentativa {
  resposta: Response;
  prazo: AbortSignal;
  excesso: boolean;
}

export class Cliente {
  /** Numeração dos pedidos, para saber quais já estavam na fila quando veio uma recusa. */
  private pedidos = 0;
  private recusa?: { ate: number; erro: RecusaError };
  /** Horário da última saída efetiva (fetch) por host. */
  private ultimaPorHost = new Map<string, number>();
  /** Fila de autorização de envio por host: uma saída por vez. */
  private vezPorHost = new Map<string, Promise<void>>();
  private readonly vagas: Vagas;
  private readonly fetchFn: typeof fetch;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly agora: () => number;

  constructor(private readonly opcoes: OpcoesCliente) {
    this.vagas = opcoes.vagas ?? vagasDoProcesso;
    this.fetchFn = opcoes.fetch ?? fetch;
    this.esperar = opcoes.esperar ?? dormir;
    this.agora = opcoes.agora ?? Date.now;
  }

  /**
   * Faz a chamada respeitando as travas. Devolve a resposta já aceita (2xx; ou 3xx, se o chamador pediu
   * redirect "manual" para validar cada salto).
   * A vaga de concorrência só é liberada quando o corpo da resposta é lido até o fim ou cancelado.
   */
  async requisitar(url: string, init: RequestInit = {}): Promise<Response> {
    const pedido = ++this.pedidos;
    await this.vagas.entrar();
    let resposta: Response | undefined;
    try {
      let t = await this.chamar(url, init, pedido);
      resposta = t.resposta;
      this.barrarBloqueio(resposta);
      if (resposta.status === 429 || resposta.status === 503 || t.excesso) {
        const espera = this.tempoDeEspera(resposta);
        await descartar(resposta);
        await this.esperar(espera);
        t = await this.chamar(url, init, pedido);
        resposta = t.resposta;
        this.barrarBloqueio(resposta);
        if (resposta.status === 429 || resposta.status === 503 || t.excesso) {
          throw new RecusaError(
            `${this.opcoes.nome} recusou a chamada duas vezes seguidas (HTTP ${resposta.status}). ` +
              "O Garimpo parou para não sobrecarregar o serviço. Espere alguns minutos e tente de novo.",
            resposta.status,
          );
        }
      }
      const redirectManual = init.redirect === "manual" && resposta.status >= 300 && resposta.status < 400;
      if (!resposta.ok && !redirectManual) {
        throw new Error(`${this.opcoes.nome} respondeu com erro HTTP ${resposta.status} para ${url}.`);
      }
      return this.segurarVagaAteOCorpo(resposta, t.prazo);
    } catch (e) {
      if (e instanceof RecusaError && !(e instanceof RecusaPropagada)) this.recusa = { ate: this.pedidos, erro: e };
      if (resposta) await descartar(resposta);
      this.vagas.sair();
      throw e;
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

  /** Embrulha o corpo: a vaga volta à fila quando ele termina, falha, é cancelado ou estoura o prazo. */
  private segurarVagaAteOCorpo(resposta: Response, prazo: AbortSignal): Response {
    const original = resposta.body;
    let liberada = false;
    const liberar = () => {
      if (!liberada) {
        liberada = true;
        this.vagas.sair();
      }
    };
    if (!original) {
      liberar();
      return resposta;
    }
    const leitor = original.getReader();
    // Cancelado, quem devolve a vaga é o cancel, e só depois de o cancelamento terminar.
    let cancelado = false;
    const corpo = new ReadableStream<Uint8Array>({
      start(controle) {
        // Estourado o prazo, a vaga volta mesmo que ninguém esteja lendo o corpo.
        prazo.addEventListener(
          "abort",
          () => {
            liberar();
            controle.error(prazo.reason);
          },
          { once: true },
        );
      },
      async pull(controle) {
        try {
          const { done, value } = await leitor.read();
          if (cancelado) return;
          if (done) {
            liberar();
            controle.close();
          } else controle.enqueue(value);
        } catch (e) {
          if (cancelado) return;
          liberar();
          controle.error(e);
        }
      },
      async cancel(motivo) {
        cancelado = true;
        try {
          await leitor.cancel(motivo);
        } finally {
          liberar();
        }
      },
    });
    return new Response(corpo, { status: resposta.status, statusText: resposta.statusText, headers: resposta.headers });
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
   * Faz um fetch. A recusa é conferida logo antes dele, depois de qualquer espera.
   * O prazo vale do envio até o fim da leitura do corpo; estourado, a chamada é abortada.
   */
  private async chamar(url: string, init: RequestInit, pedido: number): Promise<Tentativa> {
    this.barrarSeJaRecusado(pedido);
    const host = new URL(url).host;
    const intervalo = this.opcoes.intervaloMinimoPorHost?.[host];
    if (intervalo) {
      // Uma autorização de envio por vez neste host; a pausa conta da saída efetiva da chamada anterior,
      // não de um horário reservado (timers vencidos que acordam juntos não saem juntos).
      const anterior = this.vezPorHost.get(host) ?? Promise.resolve();
      let passarAVez!: () => void;
      const vez = new Promise<void>((r) => (passarAVez = r));
      this.vezPorHost.set(host, anterior.then(() => vez));
      try {
        await anterior;
        const ultima = this.ultimaPorHost.get(host);
        const falta = ultima === undefined ? 0 : ultima + intervalo - this.agora();
        if (falta > 0) await this.esperar(falta);
        this.barrarSeJaRecusado(pedido);
        this.ultimaPorHost.set(host, this.agora());
      } finally {
        passarAVez();
      }
    }
    this.barrarSeJaRecusado(pedido);
    const headers = new Headers(init.headers);
    headers.set("User-Agent", USER_AGENT);
    const prazoMs = this.opcoes.prazoMs ?? 120_000;
    const estouro = new Error(
      `${this.opcoes.nome} não respondeu em ${Math.ceil(prazoMs / 1000)} s; o Garimpo desistiu da chamada. Tente mais tarde.`,
    );
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(estouro), prazoMs);
    relogio.unref?.();
    const desarmar = () => clearTimeout(relogio);
    let resposta: Response;
    try {
      resposta = await this.fetchFn(url, { ...init, headers, signal: controle.signal });
    } catch (e) {
      desarmar();
      if (controle.signal.aborted) throw estouro;
      throw new Error(`Não foi possível falar com ${this.opcoes.nome} (${(e as Error).message}). Verifique a conexão.`);
    }
    resposta = comPrazo(resposta, controle.signal, desarmar);
    try {
      const { excesso, resposta: inteira } = await excessoDeRequisicoes(resposta);
      return { resposta: inteira, prazo: controle.signal, excesso };
    } catch (e) {
      await descartar(resposta);
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

/** Cancela o corpo de uma resposta que não vai ser usada (libera a conexão). */
async function descartar(resposta: Response): Promise<void> {
  if (resposta.body && !resposta.bodyUsed) await resposta.body.cancel().catch(() => {});
}

/** Desafio anti-robô conhecido (Cloudflare "managed", AWS WAF 202). */
function desafioAntiRobo(resposta: Response): boolean {
  if (resposta.headers.get("cf-mitigated") === "challenge") return true;
  if (resposta.status === 202 && resposta.headers.has("x-amzn-waf-action")) return true;
  return false;
}

/** Mesma resposta com outro corpo (status e cabeçalhos preservados). */
function comCorpo(resposta: Response, corpo: ReadableStream<Uint8Array>): Response {
  return new Response(corpo, { status: resposta.status, statusText: resposta.statusText, headers: resposta.headers });
}

/** Corpo sob prazo: estourado, a leitura falha e a conexão é cancelada; terminado ou cancelado, o prazo é desarmado. */
function comPrazo(resposta: Response, prazo: AbortSignal, desarmar: () => void): Response {
  if (!resposta.body) {
    desarmar();
    return resposta;
  }
  const leitor = resposta.body.getReader();
  return comCorpo(
    resposta,
    new ReadableStream<Uint8Array>({
      start(controle) {
        prazo.addEventListener(
          "abort",
          () => {
            controle.error(prazo.reason);
            leitor.cancel(prazo.reason).catch(() => {});
          },
          { once: true },
        );
      },
      async pull(controle) {
        const { done, value } = await leitor.read().catch((e) => {
          desarmar();
          throw e;
        });
        if (done) {
          desarmar();
          controle.close();
        } else controle.enqueue(value);
      },
      async cancel(motivo) {
        desarmar();
        await leitor.cancel(motivo);
      },
    }),
  );
}

/** Corpo curto o bastante para ser o aviso de recusa do TSE (bytes). */
const LIMITE_AVISO = 2_000;

/**
 * O TSE responde "Excesso de requisições" no corpo, às vezes com status 200. Só o começo do corpo é lido
 * (até LIMITE_AVISO bytes, mais o pedaço em curso); a resposta devolvida entrega esses bytes e o resto a quem ler.
 */
async function excessoDeRequisicoes(resposta: Response): Promise<{ excesso: boolean; resposta: Response }> {
  const tipo = resposta.headers.get("content-type") ?? "";
  if (!tipo.includes("text") && !tipo.includes("json")) return { excesso: false, resposta };
  if (Number(resposta.headers.get("content-length")) > LIMITE_AVISO || !resposta.body) {
    return { excesso: false, resposta };
  }
  const leitor = resposta.body.getReader();
  const lidos: Uint8Array[] = [];
  let total = 0;
  let fim = false;
  while (!fim && total <= LIMITE_AVISO) {
    const { done, value } = await leitor.read();
    if (done) fim = true;
    else {
      lidos.push(value);
      total += value.length;
    }
  }
  const inteira = comCorpo(
    resposta,
    new ReadableStream<Uint8Array>({
      start(controle) {
        for (const pedaco of lidos) controle.enqueue(pedaco);
        if (fim) controle.close();
      },
      async pull(controle) {
        const { done, value } = await leitor.read();
        if (done) controle.close();
        else controle.enqueue(value);
      },
      cancel: (motivo) => leitor.cancel(motivo),
    }),
  );
  const excesso =
    fim && total <= LIMITE_AVISO && /excesso de requisi/i.test(new TextDecoder().decode(Buffer.concat(lidos)));
  return { excesso, resposta: inteira };
}
