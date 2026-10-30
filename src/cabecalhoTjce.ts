/**
 * Cabeçalho «Processo: <CNJ>» do PDF do TJCE (ADR-0033). O número só vale se estiver na PRIMEIRA página física, na
 * região do cabeçalho (antes de EMENTA, ACÓRDÃO, RELATÓRIO ou VOTO): o acórdão cita CNJs de precedentes no corpo, às
 * vezes com o mesmo rótulo «Processo:». Primeira página sem texto, cabeçalho ausente ou ambíguo = undefined. A regra
 * de um número só, na região declarada, é a do molde (src/cabecalho.ts, ticket 16).
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { processoNoCabecalho, type RegiaoDoCabecalho } from "./cabecalho.js";

/** A região do cabeçalho da 1ª página: até o 1º título ou 600 caracteres, e o rótulo começa a página (até 300). */
export const CABECALHO_DO_TJCE: RegiaoDoCabecalho = {
  titulos: /\b(EMENTA|AC[ÓO]RD[ÃA]O|RELAT[ÓO]RIO|VOTO)\b/,
  maximo: 600,
  numero: /Processo:\s*(\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4})/g,
  inicioMaximo: 300,
};

/** Os 20 dígitos do número do processo do cabeçalho, ou undefined se a 1ª página não o mostra sem ambiguidade. */
export async function processoDoCabecalhoDoTjce(pdf: Uint8Array): Promise<string | undefined> {
  // O pdfjs toma posse do buffer que recebe: vai uma cópia.
  const tarefa = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    const documento = await tarefa.promise;
    const conteudo = await (await documento.getPage(1)).getTextContent();
    const texto = conteudo.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : "")).join("");
    return processoNoCabecalho(texto, CABECALHO_DO_TJCE)?.replace(/\D/g, "");
  } finally {
    await tarefa.destroy();
  }
}
