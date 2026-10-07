/**
 * Cliente HTTP com as travas de uso responsável (CLAUDE.md, regra 3):
 * - no máximo N chamadas simultâneas (padrão 2);
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

/** A resposta veio num formato que o Garimpo não reconhece. */
export class FormatoInesperadoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatoInesperadoError";
  }
}

export interface OpcoesCliente {
  /** Nome de quem responde, usado nas mensagens ("o JurisprudênciaIA", "o STJ"). */
  nome: string;
  maxSimultaneas?: number;
  /** Espera antes da nova tentativa quando não há Retry-After (ms). */
  esperaPadraoMs?: number;
  /** Teto da espera, mesmo que o servidor peça mais (ms). */
  esperaMaximaMs?: number;
  /** Intervalo mínimo entre chamadas ao mesmo host (ms), por host. */
  intervaloMinimoPorHost?: Record<string, number>;
  fetch?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  agora?: () => number;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Cliente {
  private ativas = 0;
  private fila: (() => void)[] = [];
  private ultimaPorHost = new Map<string, number>();
  private readonly max: number;
  private readonly fetchFn: typeof fetch;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly agora: () => number;

  constructor(private readonly opcoes: OpcoesCliente) {
    this.max = opcoes.maxSimultaneas ?? 2;
    this.fetchFn = opcoes.fetch ?? fetch;
    this.esperar = opcoes.esperar ?? dormir;
    this.agora = opcoes.agora ?? Date.now;
  }

  /**
   * Faz a chamada respeitando as travas. Devolve a resposta já aceita (2xx).
   * A vaga de concorrência só é liberada quando o corpo da resposta é lido até o fim ou cancelado.
   */
  async requisitar(url: string, init: RequestInit = {}): Promise<Response> {
    await this.entrar();
    let resposta: Response | undefined;
    try {
      resposta = await this.chamar(url, init);
      this.barrarBloqueio(resposta);
      if (resposta.status === 429 || resposta.status === 503 || (await excessoDeRequisicoes(resposta))) {
        const espera = this.tempoDeEspera(resposta);
        await descartar(resposta);
        await this.esperar(espera);
        resposta = await this.chamar(url, init);
        this.barrarBloqueio(resposta);
        if (resposta.status === 429 || resposta.status === 503 || (await excessoDeRequisicoes(resposta))) {
          throw new RecusaError(
            `${this.opcoes.nome} recusou a chamada duas vezes seguidas (HTTP ${resposta.status}). ` +
              "O Garimpo parou para não sobrecarregar o serviço. Espere alguns minutos e tente de novo.",
            resposta.status,
          );
        }
      }
      if (!resposta.ok) {
        throw new Error(`${this.opcoes.nome} respondeu com erro HTTP ${resposta.status} para ${url}.`);
      }
      return this.segurarVagaAteOCorpo(resposta);
    } catch (e) {
      if (resposta) await descartar(resposta);
      this.sair();
      throw e;
    }
  }

  /** Embrulha o corpo: a vaga volta à fila quando ele termina, falha ou é cancelado. */
  private segurarVagaAteOCorpo(resposta: Response): Response {
    const original = resposta.body;
    let liberada = false;
    const liberar = () => {
      if (!liberada) {
        liberada = true;
        this.sair();
      }
    };
    if (!original) {
      liberar();
      return resposta;
    }
    const leitor = original.getReader();
    const corpo = new ReadableStream<Uint8Array>({
      async pull(controle) {
        try {
          const { done, value } = await leitor.read();
          if (done) {
            liberar();
            controle.close();
          } else controle.enqueue(value);
        } catch (e) {
          liberar();
          controle.error(e);
        }
      },
      async cancel(motivo) {
        liberar();
        await leitor.cancel(motivo);
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

  private async chamar(url: string, init: RequestInit): Promise<Response> {
    const host = new URL(url).host;
    const intervalo = this.opcoes.intervaloMinimoPorHost?.[host];
    if (intervalo) {
      // Reserva o horário de saída antes de esperar: quem vier depois enxerga a reserva e espera a vez dele.
      const ultima = this.ultimaPorHost.get(host);
      const agora = this.agora();
      const saida = ultima === undefined ? agora : Math.max(agora, ultima + intervalo);
      this.ultimaPorHost.set(host, saida);
      if (saida > agora) await this.esperar(saida - agora);
    }
    const headers = new Headers(init.headers);
    headers.set("User-Agent", USER_AGENT);
    try {
      return await this.fetchFn(url, { ...init, headers });
    } catch (e) {
      throw new Error(`Não foi possível falar com ${this.opcoes.nome} (${(e as Error).message}). Verifique a conexão.`);
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

  private async entrar(): Promise<void> {
    if (this.ativas < this.max) {
      this.ativas++;
      return;
    }
    await new Promise<void>((r) => this.fila.push(r));
  }

  private sair(): void {
    const proximo = this.fila.shift();
    if (proximo) proximo();
    else this.ativas--;
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

/** O TSE responde "Excesso de requisições" no corpo, às vezes com status 200. */
async function excessoDeRequisicoes(resposta: Response): Promise<boolean> {
  const tipo = resposta.headers.get("content-type") ?? "";
  if (!tipo.includes("text") && !tipo.includes("json")) return false;
  const tamanho = Number(resposta.headers.get("content-length"));
  if (tamanho > 2_000) return false;
  const texto = await resposta.clone().text();
  return texto.length < 2_000 && /excesso de requisi/i.test(texto);
}
