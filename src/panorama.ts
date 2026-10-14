/**
 * Panorama da amostra: contagens por tribunal, ano de julgamento e órgão sobre acórdãos que uma busca já trouxe.
 * Só conta o que recebe; não chama fonte nenhuma e não estima o que falta.
 */

import type { Acordao } from "./busca.js";

/** Órgãos mostrados por tribunal: o resto soma em "outros", para a resposta ficar longe do teto de 25 mil caracteres. */
export const ORGAOS_POR_TRIBUNAL = 20;

export const SEM_DATA = "sem data";
export const SEM_ORGAO = "sem órgão informado";

/** O aviso fixo de toda resposta do panorama: amostra da busca, não estatística. */
export const AVISO_DE_AMOSTRA =
  "Contagem só dos acórdãos informados, tirados de uma busca do Garimpo: é uma amostra da busca, não a estatística " +
  "do tribunal nem o total de julgados sobre o tema.";

export interface Panorama {
  total: number;
  porTribunal: Record<string, number>;
  porAno: Record<string, number>;
  /** Por tribunal, do órgão mais frequente ao menos; "outros" soma o que passou dos maiores. */
  porOrgao: Record<string, Record<string, number>>;
}

function contar(contagem: Record<string, number>, chave: string) {
  contagem[chave] = (contagem[chave] ?? 0) + 1;
}

export function panorama(acordaos: readonly Acordao[]): Panorama {
  const porTribunal: Record<string, number> = {};
  const porAno: Record<string, number> = {};
  const orgaos: Record<string, Record<string, number>> = {};
  for (const a of acordaos) {
    contar(porTribunal, a.tribunal);
    contar(porAno, a.dataJulgamento?.slice(0, 4) || SEM_DATA);
    contar((orgaos[a.tribunal] ??= {}), a.orgao || SEM_ORGAO);
  }
  const porOrgao: Panorama["porOrgao"] = {};
  for (const [tribunal, contagem] of Object.entries(orgaos)) {
    const ordem = Object.entries(contagem).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
    const outros = ordem.slice(ORGAOS_POR_TRIBUNAL).reduce((soma, [, n]) => soma + n, 0);
    porOrgao[tribunal] = {
      ...Object.fromEntries(ordem.slice(0, ORGAOS_POR_TRIBUNAL)),
      ...(outros && { outros }),
    };
  }
  return { total: acordaos.length, porTribunal, porAno, porOrgao };
}
