/**
 * Cabeçalho «Processo: <CNJ>» do PDF do TJCE (ADR-0033). O número só vale se estiver na PRIMEIRA página física, na
 * região do cabeçalho (antes de EMENTA, ACÓRDÃO, RELATÓRIO ou VOTO): o acórdão cita CNJs de precedentes no corpo, às
 * vezes com o mesmo rótulo «Processo:». Primeira página sem texto, cabeçalho ausente ou ambíguo = undefined.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** O cabeçalho real começa a página; mais longe que isso, é citação. */
const LIMITE_DO_CABECALHO = 300;
const REGIAO_MAXIMA = 600;
const TITULOS_DE_SECAO = /\b(EMENTA|AC[ÓO]RD[ÃA]O|RELAT[ÓO]RIO|VOTO)\b/;
const PROCESSO = /Processo:\s*(\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4})/g;

/** Os 20 dígitos do número do processo do cabeçalho, ou undefined se a 1ª página não o mostra sem ambiguidade. */
export async function processoDoCabecalhoDoTjce(pdf: Uint8Array): Promise<string | undefined> {
  // O pdfjs toma posse do buffer que recebe: vai uma cópia.
  const tarefa = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    const documento = await tarefa.promise;
    const conteudo = await (await documento.getPage(1)).getTextContent();
    const texto = conteudo.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : "")).join("");
    const corte = TITULOS_DE_SECAO.exec(texto)?.index ?? texto.length;
    const regiao = texto.slice(0, Math.min(corte, REGIAO_MAXIMA));
    const achados = [...regiao.matchAll(PROCESSO)].filter((m) => m.index <= LIMITE_DO_CABECALHO);
    const numeros = new Set(achados.map((m) => m[1].replace(/\D/g, "")));
    return numeros.size === 1 ? [...numeros][0] : undefined;
  } finally {
    await tarefa.destroy();
  }
}
