/**
 * HTML → texto (ADR-0018, spec do B12, Q22): conversor próprio, sem dependência nova, para a ementa e o texto integral
 * do Falcão. Tira imagens, script, style e comentários; bloco (parágrafo, quebra, item, célula, título…) vira quebra
 * de linha; entidades decodificadas; espaços horizontais repetidos viram um, sem apagar quebras. Nenhuma outra
 * mudança: não corrige palavra, não junta hífen, não muda maiúsculas.
 */

/** Etiquetas que separam blocos: abrir ou fechar uma delas é quebra de linha. */
const BLOCOS = new Set([
  "address", "article", "aside", "blockquote", "br", "caption", "center", "dd", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
  "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

/** Entidades nomeadas mais comuns em texto jurídico em português; as numéricas são decodificadas todas. */
export const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", hellip: "…",
  bull: "•", middot: "·", ordm: "º", ordf: "ª", sect: "§", para: "¶", deg: "°", euro: "€", trade: "™", copy: "©",
  reg: "®", laquo: "«", raquo: "»", iexcl: "¡", iquest: "¿", shy: "­", acute: "´", uml: "¨", cedil: "¸",
  sup1: "¹", sup2: "²", sup3: "³", frac12: "½", frac14: "¼", frac34: "¾", times: "×", divide: "÷", plusmn: "±",
  micro: "µ", cent: "¢", pound: "£", yen: "¥", curren: "¤", brvbar: "¦", not: "¬", macr: "¯",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  ETH: "Ð", Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý", THORN: "Þ", szlig: "ß",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  eth: "ð", ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", thorn: "þ", yuml: "ÿ",
};

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (inteira, nome: string) => {
    if (nome[0] === "#") {
      const codigo = nome[1] === "x" || nome[1] === "X" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return codigo > 0 && codigo <= 0x10ffff && !(codigo >= 0xd800 && codigo <= 0xdfff)
        ? String.fromCodePoint(codigo)
        : inteira;
    }
    return ENTIDADES[nome] ?? inteira;
  });
}

export function htmlParaTexto(html: string): string {
  const semRuido = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    // Fim de linha do código-fonte é espaço no HTML, não quebra: a quebra vem dos blocos.
    .replace(/\r\n?|\n/g, " ");
  const comQuebras = semRuido.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (_, nome: string) =>
    BLOCOS.has(nome.toLowerCase()) ? "\n" : "",
  );
  return decodificar(comQuebras.replace(/<[^>]*>/g, ""))
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** Indício de que o HTML veio cortado: termina no meio de uma etiqueta ou sem fechar o último bloco. */
export function htmlComIndicioDeCorte(html: string): boolean {
  const fim = html.trim();
  return fim !== "" && !fim.endsWith(">");
}
