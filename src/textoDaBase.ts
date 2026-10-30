/**
 * Texto da base (decisão do dono, 2026-10-29): no TJES e no TJMA o registro do JurisprudênciaIA traz o acórdão em HTML,
 * embutido no `link` como `data:text/html;base64,…`. Este módulo é puro: decodifica o valor, converte o HTML em texto
 * pela regra fixa do Garimpo (html.ts) e devolve o texto com o rótulo de cópia de terceiro, não oficial. Não chama
 * rede nem decide onde o texto fica guardado.
 */
import { htmlComConteudoOculto, htmlComIndicioDeCorte, htmlParaTexto } from "./html.js";

/** O rótulo que acompanha toda resposta que usa esse texto. */
export const ROTULO_TEXTO_DA_BASE = "texto da base do JurisprudênciaIA, não oficial";

/** Teto do HTML decodificado. Os `data:` vistos em 29/10/2026 iam de 15 a 294 KB (TJMA e TJES). */
export const TETO_BYTES_TEXTO_DA_BASE = 2 * 1024 * 1024;

/** Texto útil mínimo (caracteres) para valer como texto; menos que isso é página sem acórdão. */
const MINIMO_DE_CARACTERES = 20;

export type MotivoDeRecusa = "não é data:text/html" | "sem base64" | "base64 inválido" | "grande demais" | "sem texto";

export type TextoDaBase =
  | {
      ok: true;
      texto: string;
      rotulo: typeof ROTULO_TEXTO_DA_BASE;
      /** O HTML terminava no meio de uma etiqueta ou sem fechar o último bloco. */
      indicioDeCorte: boolean;
      /** O HTML tinha trechos marcados como ocultos; eles foram mantidos. */
      conteudoOculto: boolean;
    }
  | { ok: false; recusa: MotivoDeRecusa };

const CABECALHO = /^data:text\/html((?:;[^;,]*)*),/i;

export function textoDaBase(valor: string): TextoDaBase {
  const dado = valor.trim();
  const cabecalho = CABECALHO.exec(dado);
  if (!cabecalho) return { ok: false, recusa: "não é data:text/html" };
  const parametros = cabecalho[1].split(";").map((p) => p.trim().toLowerCase());
  if (!parametros.includes("base64")) return { ok: false, recusa: "sem base64" };
  const base64 = dado.slice(cabecalho[0].length).replace(/\s+/g, "");
  // Recusa antes de decodificar: 4 caracteres de base64 são no máximo 3 bytes.
  if ((base64.length * 3) / 4 > TETO_BYTES_TEXTO_DA_BASE) return { ok: false, recusa: "grande demais" };
  if (base64.length > 0 && !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return { ok: false, recusa: "base64 inválido" };
  const charset = parametros.find((p) => p.startsWith("charset="))?.slice("charset=".length).replace(/["']/g, "");
  const bytes = Buffer.from(base64, "base64");
  let html: string;
  try {
    html = new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    html = new TextDecoder("utf-8").decode(bytes);
  }
  const texto = htmlParaTexto(html);
  if (texto.length < MINIMO_DE_CARACTERES) return { ok: false, recusa: "sem texto" };
  return {
    ok: true,
    texto,
    rotulo: ROTULO_TEXTO_DA_BASE,
    indicioDeCorte: htmlComIndicioDeCorte(html),
    conteudoOculto: htmlComConteudoOculto(html),
  };
}
