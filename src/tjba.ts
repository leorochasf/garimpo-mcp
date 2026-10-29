/**
 * TJBA (ADR-0033): o texto do acórdão na página pública do portal de jurisprudência do tribunal, pelo molde «página com
 * íntegra». A página do link que vem da busca é o próprio documento da decisão em HTML — cabeçalho do tribunal,
 * processo, partes, ementa, acórdão, relatório e voto —, sem campos à parte (gravações de 2026-10-29: uma Turma Recursal
 * e uma Câmara Cível). Não é PDF e não tem recibo.
 */

import { htmlParaTexto } from "./html.js";
import type { PortalComIntegra } from "./paginaComIntegra.js";

export const HOST_TJBA = "jurisprudenciaws.tjba.jus.br";

/**
 * O documento no link: o caminho exato da prova, com o uuid; só os dígitos hexadecimais podem vir em maiúsculas. É a
 * mesma regra da junção das cópias do TJBA (`documentoDoTjba`, src/equivalencia.ts).
 */
const CAMINHO_DO_DOCUMENTO =
  /^\/inteiroTeor\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** O cabeçalho que todo documento do tribunal traz; página de aviso ou erro do portal não o tem. */
const CABECALHO_DO_TRIBUNAL = /tribunal de justiça do estado da bahia/i;

/** O número do processo no cabeçalho do documento: «PROCESSO Nº <CNJ>» ou «Processo: <classe> n. <CNJ>». */
const PROCESSO_NO_CABECALHO = /processo\b[^\n]{0,60}?(\d{7}-\d{2}\.\d{4}\.8\.05\.\d{4})/i;

export const PORTAL_TJBA: PortalComIntegra = {
  sigla: "tjba",
  host: HOST_TJBA,
  caminho: CAMINHO_DO_DOCUMENTO,
  rotulo: `portal de jurisprudência do TJBA (${HOST_TJBA})`,
  processo: (html) => PROCESSO_NO_CABECALHO.exec(htmlParaTexto(html))?.[1],
  // A página inteira é o documento (a da Câmara Cível nem tem <body>); as imagens embutidas não viram texto.
  integra: (html) => {
    const corpo = /<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html)?.[1] ?? html;
    return CABECALHO_DO_TRIBUNAL.test(htmlParaTexto(corpo)) ? corpo : undefined;
  },
  desligadas: {
    segredoDeJustica:
      "a página do TJBA é só o documento da decisão, sem campo de segredo de justiça (gravações de 2026-10-29, Turma " +
      "Recursal e Câmara Cível); o processo da página continua conferido com o da busca",
  },
};
