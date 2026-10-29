/**
 * TJPR: o texto do acórdão na página pública do portal de jurisprudência do próprio tribunal (ADR-0030). A página do link
 * que vem da busca já traz a íntegra num bloco oculto («Íntegra do Acórdão»). Não é PDF e não tem recibo: é o texto que
 * o portal entrega em HTML, guardado na memória pelo id do acórdão (como o do TJPI).
 */

import { type Cliente, decodificarDoHost } from "./cliente.js";
import { htmlComConteudoOculto, htmlComIndicioDeCorte, htmlParaTexto } from "./html.js";
import type { TextoIntegral } from "./memoria.js";
import { documentoDoTjpr, HOST_TJPR } from "./tribunais.js";

/** Aviso que o tribunal põe antes da íntegra: sem ele, o bloco não é a transcrição do acórdão. */
const AVISO_DE_TRANSCRICAO = /O texto abaixo representa a transcrição de Acórdão/i;
/** Texto útil mínimo: uma página de aviso do portal não chega perto disso; relatório, voto e dispositivo passam com folga. */
const MINIMO_TEXTO = 200;
/** Limite de leitura da página (bytes): as páginas medidas têm dezenas de KB. */
const LIMITE_BYTES = 5_000_000;

/** Só https no portal do TJPR, no formato do link de um documento; outro endereço é erro: nada sai. */
function lerLink(link: string): { url: URL; documento: string } {
  const documento = documentoDoTjpr(link);
  if (!documento) {
    throw new Error(`Link do TJPR fora do formato esperado (só https em ${HOST_TJPR}/jurisprudencia/j/<n>): ${link}`);
  }
  return { url: new URL(link), documento };
}

/**
 * A íntegra do documento do link: o bloco «texto<n>», do mesmo número, depois do aviso de transcrição do tribunal e
 * antes do fim da célula da tabela. Sem qualquer dessas marcas, não é a página do acórdão.
 */
function integraDoDocumento(html: string, documento: string): string | undefined {
  const inicio = html.indexOf(`id="integra${documento}"`);
  if (inicio < 0) return undefined;
  const abre = html.indexOf(`<div id="texto${documento}">`, inicio);
  if (abre < 0 || !AVISO_DE_TRANSCRICAO.test(htmlParaTexto(html.slice(inicio, abre)))) return undefined;
  const corpo = abre + `<div id="texto${documento}">`.length;
  const fim = html.indexOf("</td>", corpo);
  return fim < 0 ? undefined : html.slice(corpo, fim);
}

/** Número do processo do campo «Processo:» da página. */
function processoDaPagina(html: string): string | undefined {
  return /<b>Processo:<\/b><\/span>\s*<div[^>]*>\s*<div>\s*([^<\s]+)\s*<\/div>/i.exec(html)?.[1];
}

/** O que a página diz em «Segredo de Justiça:» («Não», «Sim»); sem o campo, undefined. */
function segredoDaPagina(html: string): string | undefined {
  return /<b>Segredo de Justiça:<\/b>\s*([^<]*?)\s*<\/td>/i.exec(html)?.[1];
}

/**
 * Uma chamada à página do acórdão. Só vale a íntegra do documento do link, com o aviso de transcrição, texto útil
 * mínimo, o número do processo da página escrito dentro da própria íntegra e, quando a busca trouxe o número CNJ, o
 * mesmo processo; senão, undefined (nada é guardado). Acórdão em segredo de justiça = texto vazio com o motivo (nunca o
 * texto da página).
 */
export async function textoDoTjpr(
  cliente: Cliente,
  link: string,
  acordao: { numeroCnj?: string },
): Promise<Omit<TextoIntegral, "id"> | undefined> {
  const { url, documento } = lerLink(link);
  const r = await cliente.requisitar(url.href, { headers: { accept: "text/html" }, redirect: "manual" });
  // A prova é da página direta, um GET. Outra rota não foi verificada e não é seguida, mesmo no mesmo host.
  if (r.status >= 300 && r.status < 400) {
    await r.body?.cancel();
    return undefined;
  }
  const tipo = r.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!/text\/html/i.test(tipo) || bytes.length > LIMITE_BYTES) return undefined;
  const html = decodificarDoHost(bytes, tipo, HOST_TJPR);
  const processo = processoDaPagina(html);
  if (!processo || (acordao.numeroCnj && processo !== acordao.numeroCnj)) return undefined;
  const segredo = segredoDaPagina(html);
  if (segredo !== undefined && segredo.toLowerCase() !== "não") {
    return { texto: "", indicioDeCorte: false, motivoSemTexto: "o acórdão está em segredo de justiça" };
  }
  const integra = integraDoDocumento(html, documento);
  if (!integra) return undefined;
  const texto = htmlParaTexto(integra);
  // O portal às vezes põe na página certa (mesmo processo, mesmo documento) a íntegra de outro acórdão: em 2026-10-29,
  // 2 de 3 chamadas seguidas ao mesmo link (ADR-0030). A íntegra certa traz o número do próprio processo.
  if (texto.length < MINIMO_TEXTO || !texto.includes(processo)) return undefined;
  return {
    texto,
    indicioDeCorte: htmlComIndicioDeCorte(html),
    ...(htmlComConteudoOculto(integra) && { conteudoOculto: true }),
  };
}
