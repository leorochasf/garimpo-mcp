/**
 * TJPI: o texto do acórdão na página pública do portal de jurisprudência do próprio tribunal (I-16 / G-23). Não é PDF e
 * não tem recibo: é o texto que o portal entrega em HTML, guardado na memória pelo id do acórdão (como o do TJTO).
 */

import { type Cliente, decodificarDoHost } from "./cliente.js";
import { htmlComConteudoOculto, htmlComIndicioDeCorte, htmlParaTexto } from "./html.js";
import type { TextoIntegral } from "./memoria.js";

export const HOST_TJPI = "jurisprudencia.tjpi.jus.br";
/** Como o portal aponta o acórdão: /jurisprudences/<n>/public. */
const CAMINHO_DO_LINK = /^\/jurisprudences\/\d+\/public$/;
/** Texto útil mínimo: uma página de aviso do portal não chega perto disso; ementa, relatório e voto passam com folga. */
const MINIMO_TEXTO = 200;
/** Limite de leitura da página (bytes): as páginas medidas têm dezenas de KB. */
const LIMITE_BYTES = 5_000_000;

/** Só https no portal do TJPI, no formato do link de um acórdão; outro endereço é erro: nada sai. */
function lerLink(link: string): URL {
  const url = new URL(link);
  if (url.protocol !== "https:" || url.host !== HOST_TJPI || !CAMINHO_DO_LINK.test(url.pathname)) {
    throw new Error(`Link do TJPI fora do formato esperado (só https em ${HOST_TJPI}/jurisprudences/<n>/public): ${link}`);
  }
  return url;
}

/**
 * Do cartão do acórdão: começa no título «Ementa» e termina antes da coluna «Detalhes». Sem as duas seções do acórdão
 * (títulos «Ementa» e «Acórdão»), não é a página de um acórdão.
 */
function trechoDoAcordao(html: string): string | undefined {
  const ementa = html.search(/<h4[^>]*>\s*Ementa\s*<\/h4>/i);
  if (ementa < 0) return undefined;
  const fim = html.indexOf('<div class="col-md-3">', ementa);
  if (fim < 0) return undefined;
  const trecho = html.slice(ementa, fim);
  const titulo = /<h4[^>]*>\s*Acórdão\s*<\/h4>/i.exec(trecho);
  // A ementa não pode cumprir o mínimo pelo acórdão: título presente com corpo vazio não é texto integral.
  if (!titulo || htmlParaTexto(trecho.slice(titulo.index + titulo[0].length)).length < MINIMO_TEXTO) return undefined;
  return trecho;
}

/** Número do processo da coluna «Detalhes» da página. */
function processoDaPagina(html: string): string | undefined {
  return /Processo<\/strong>\s*<p[^>]*>\s*([^<\s]+)\s*<\/p>/i.exec(html)?.[1];
}

/**
 * Uma chamada à página do acórdão. Só vale se tiver as seções do acórdão, texto útil mínimo e, quando a busca trouxe o
 * número CNJ, o mesmo processo; senão, undefined (nada é guardado).
 */
export async function textoDoTjpi(
  cliente: Cliente,
  link: string,
  acordao: { numeroCnj?: string },
): Promise<Omit<TextoIntegral, "id"> | undefined> {
  const url = lerLink(link);
  const r = await cliente.requisitar(url.href, { headers: { accept: "text/html" }, redirect: "manual" });
  // A prova é da página direta, um GET. Outra rota não foi verificada e não é seguida, mesmo no mesmo host.
  if (r.status >= 300 && r.status < 400) {
    await r.body?.cancel();
    return undefined;
  }
  const tipo = r.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!/text\/html/i.test(tipo) || bytes.length > LIMITE_BYTES) return undefined;
  const html = decodificarDoHost(bytes, tipo, HOST_TJPI);
  const trecho = trechoDoAcordao(html);
  if (!trecho) return undefined;
  if (acordao.numeroCnj && processoDaPagina(html) !== acordao.numeroCnj) return undefined;
  const texto = htmlParaTexto(trecho);
  if (texto.length < MINIMO_TEXTO) return undefined;
  return {
    texto,
    indicioDeCorte: htmlComIndicioDeCorte(html),
    ...(htmlComConteudoOculto(trecho) && { conteudoOculto: true }),
  };
}
