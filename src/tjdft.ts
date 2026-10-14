/**
 * TJDFT: o texto do acórdão pela API pública de pesquisa do próprio tribunal (I-13 / G-17). Não é PDF e não tem
 * recibo: é o texto que o portal do tribunal entrega, guardado na memória pelo id do acórdão (como o do TJTO).
 * Documentação: https://www.tjdft.jus.br/transparencia/tecnologia-da-informacao-e-comunicacao/dados-abertos/documentos/documentacao_api_seti_transparencia.pdf
 */

import type { Cliente } from "./cliente.js";
import type { TextoIntegral } from "./memoria.js";

export const HOST_TJDFT = "jurisdf.tjdft.jus.br";
const ENDPOINT = `https://${HOST_TJDFT}/api/v1/pesquisa`;
/** Como o link do JurisprudênciaIA aponta o acórdão: /acordaos/<identificador>/inteiro-teor/<uuid>. */
const CAMINHO_DO_LINK = /^\/acordaos\/(\d+)\/inteiro-teor\/([0-9a-f-]{36})$/i;

interface RegistroTjdft {
  identificador?: unknown;
  uuid?: unknown;
  processo?: unknown;
  segredoJustica?: unknown;
  possuiInteiroTeor?: unknown;
  inteiroTeor?: unknown;
}

/** Identificador e uuid do acórdão, lidos do link; outro endereço (host, https, caminho) é erro: nada sai. */
function lerLink(link: string): { identificador: string; uuid: string } {
  const url = new URL(link);
  const partes = CAMINHO_DO_LINK.exec(url.pathname);
  if (url.protocol !== "https:" || url.host !== HOST_TJDFT || !partes) {
    throw new Error(`Link do TJDFT fora do formato esperado (só https em ${HOST_TJDFT}/acordaos/<n>/inteiro-teor/<uuid>): ${link}`);
  }
  return { identificador: partes[1], uuid: partes[2].toLowerCase() };
}

/**
 * A API exige um termo de pesquisa além do filtro: uma palavra da própria ementa do acórdão, que ele necessariamente
 * contém. Sem ementa, "acórdão".
 */
function termoDePesquisa(ementa: string | undefined): string {
  return ementa?.match(/\p{L}{5,}/gu)?.find((p) => p.toLowerCase() !== "ementa") ?? "acórdão";
}

/**
 * Uma chamada à API pelo identificador do link. O registro só vale se o uuid for o do link (e o processo, o do acórdão
 * da busca, quando ele o tem): outro = undefined, e nenhum texto é guardado. Acórdão em segredo de justiça ou sem texto
 * = texto vazio com o motivo (nunca o texto que a API mandar).
 */
export async function textoDoTjdft(
  cliente: Cliente,
  link: string,
  acordao: { ementa?: string; numeroCnj?: string },
): Promise<Omit<TextoIntegral, "id"> | undefined> {
  const { identificador, uuid } = lerLink(link);
  const r = await cliente.requisitar(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      query: termoDePesquisa(acordao.ementa),
      termosAcessorios: [{ campo: "identificador", valor: identificador }],
      pagina: 0,
      tamanho: 5,
      retornaInteiroTeor: true,
    }),
  });
  const registros = ((await r.json()) as { registros?: RegistroTjdft[] } | null)?.registros;
  if (!Array.isArray(registros) || registros.length !== 1) return undefined;
  const registro = registros[0];
  if (
    !registro ||
    String(registro.identificador) !== identificador ||
    typeof registro.uuid !== "string" ||
    registro.uuid.toLowerCase() !== uuid ||
    (acordao.numeroCnj && registro.processo !== acordao.numeroCnj)
  ) return undefined;
  const vazio = (motivo: string) => ({ texto: "", indicioDeCorte: false, motivoSemTexto: motivo });
  if (registro.segredoJustica === true) return vazio("o acórdão está em segredo de justiça");
  if (registro.possuiInteiroTeor === false) return vazio("a API do TJDFT informa que o acórdão não tem inteiro teor");
  const texto = typeof registro.inteiroTeor === "string" ? registro.inteiroTeor.trim() : "";
  return texto ? { texto, indicioDeCorte: false } : vazio("a API do TJDFT não mandou o texto do acórdão");
}
