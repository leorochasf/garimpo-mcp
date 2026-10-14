import { FormatoInesperadoError } from "./cliente.js";
import { FalhaNaMemoriaError } from "./memoria.js";

/**
 * Linha opcional de chamado nos erros INESPERADOS (G-81, D-16). Desligada até o repositório ser público e o dono
 * autorizar (regra 4): desligada, nenhuma resposta muda.
 */
export const CHAMADO_LIGADO = false;

const NOVO_CHAMADO = "https://github.com/leorochasf/garimpo-mcp/issues/new";

/** Erro de formato, da memória ou de programação: o que não é recusa, pausa nem uso errado. */
function inesperado(e: unknown): e is Error {
  return e instanceof FormatoInesperadoError || e instanceof FalhaNaMemoriaError || e instanceof TypeError || e instanceof RangeError;
}

/**
 * O link do chamado com só três campos: versão do Garimpo, nome da ferramenta e tipo do erro. Nunca a mensagem do
 * erro, a formulação da busca, número de processo, caminho local ou trecho de documento.
 */
export function linhaDeChamado(e: unknown, ferramenta: string, versao: string, ligado = CHAMADO_LIGADO): string | undefined {
  if (!ligado || !inesperado(e)) return undefined;
  const p = new URLSearchParams({ versao, ferramenta, tipo: e.constructor.name });
  return `Para relatar o erro sem dados da pesquisa: ${NOVO_CHAMADO}?${p}`;
}

/** Marca, na resposta de erro, o erro que a gerou (não é enumerável: nunca sai na resposta). */
export const ERRO_DE_ORIGEM = Symbol("erroDeOrigem");

/** A resposta da ferramenta; se for erro inesperado e o chamado estiver ligado, com a linha de chamado ao final. */
export function comLinhaDeChamado<T>(resposta: T, ferramenta: string, versao: string, ligado: boolean): T {
  const origem = (resposta as { [ERRO_DE_ORIGEM]?: unknown } | undefined)?.[ERRO_DE_ORIGEM];
  const linha = origem === undefined ? undefined : linhaDeChamado(origem, ferramenta, versao, ligado);
  if (!linha) return resposta;
  const r = resposta as unknown as { content: { type: "text"; text: string }[] };
  return { ...r, content: [...r.content, { type: "text", text: linha }] } as T;
}
