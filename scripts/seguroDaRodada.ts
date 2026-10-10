/**
 * Peças da rodada de gravação (rodarRodadaDeProvas.ts) que dispensam rede e por isso se testam: o valor de --saida, o
 * fetch gravador (sem redirecionamento automático) e o critério de rodada completa.
 */

/** Recusa valor de --saida ausente, vazio ou que pareça outra opção (`--saida --ao-vivo` criaria a pasta "--ao-vivo"). */
export function saidaInvalida(valor: string | undefined): string | undefined {
  if (valor === undefined || valor.trim() === "" || valor.startsWith("-"))
    return '--saida precisa de uma pasta como valor (vazio, ausente ou começando por "-" não vale): --saida <pasta>.';
  return undefined;
}

export interface Registro {
  seq: number;
  consulta: string;
  tribunal: string;
  corpoEnviado: string;
  inicio: string;
  ms?: number;
  status?: number;
  resposta?: string;
  erroDeRede?: string;
}

export interface DependenciasDoGravador {
  fetch: typeof fetch;
  permitida: RegExp;
  teto: number;
  consultaAtual: () => string;
  gravarRegistro: (r: Registro) => void;
  aoContar: (chamadas: number) => void;
  aoRecusa: (consulta: string, status: number) => void;
  hosts: Map<string, number>;
}

/**
 * Fetch que o cliente único usa na rodada: só a busca permitida, com o teto, gravando cada resposta crua. Redirecionamento
 * é falha (`redirect: "error"`): seguir sozinho geraria requisição a outra URL ou host fora do gravador, do contador e dos
 * freios do cliente.
 */
export function criarGravador(d: DependenciasDoGravador) {
  let chamadas = 0;
  let seq = 0;
  return async function gravador(url: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const u = String(url);
    const m = u.match(d.permitida);
    if (!m) throw new Error(`rodarRodadaDeProvas: chamada fora da busca do site bloqueada: ${u}`);
    if (chamadas >= d.teto) throw new Error(`rodarRodadaDeProvas: teto de ${d.teto} chamadas atingido; nada mais sai`);
    chamadas++;
    d.aoContar(chamadas);
    const host = new URL(u).host;
    d.hosts.set(host, (d.hosts.get(host) ?? 0) + 1);
    const consulta = d.consultaAtual();
    const r: Registro = { seq: ++seq, consulta, tribunal: m[1], corpoEnviado: String(init.body), inicio: new Date().toISOString() };
    const t0 = performance.now();
    try {
      const resposta = await d.fetch(url, { ...init, redirect: "error" });
      const texto = await resposta.text();
      r.ms = Math.round(performance.now() - t0);
      r.status = resposta.status;
      r.resposta = texto;
      if ([403, 429, 503].includes(resposta.status)) d.aoRecusa(consulta, resposta.status);
      const cabecalhos = new Headers(resposta.headers);
      cabecalhos.delete("content-encoding");
      cabecalhos.delete("content-length");
      return new Response(texto, { status: resposta.status, statusText: resposta.statusText, headers: cabecalhos });
    } catch (e) {
      r.ms = Math.round(performance.now() - t0);
      r.erroDeRede = `${(e as Error).name}: ${(e as Error).message}`;
      throw e;
    } finally {
      d.gravarRegistro(r);
    }
  };
}

export interface ResultadoParaCompletude {
  id: string;
  erro?: string;
}

/**
 * Completa = não parou e cada consulta obrigatória (as principais e a verificação de cada paradigma ausente) tem um
 * resultado SEM erro. Registro de erro (HTTP 500, JSON inválido, rede) conta como não feito; paradigma que deu erro não
 * pode ser verificado e, por isso, também deixa a rodada incompleta.
 */
export function rodadaCompleta(entrada: {
  parou?: string;
  principais: string[];
  verificacoes: string[];
  resultados: ResultadoParaCompletude[];
}): boolean {
  if (entrada.parou) return false;
  const bons = new Set(entrada.resultados.filter((r) => !r.erro).map((r) => r.id));
  return [...entrada.principais, ...entrada.verificacoes].every((id) => bons.has(id));
}
