/**
 * Decisões em série: acórdãos do mesmo tribunal, órgão e relator com a MESMA ementa inteira (só espaços e quebras de
 * linha podem diferir). É só um critério de apresentação: nada é apagado e não se afirma mesma tese nem mesmo
 * resultado. Não confundir com src/equivalencia.ts, que junta o MESMO acórdão duplicado na base do site.
 */

import type { Acordao } from "./busca.js";

/** O mínimo de um acórdão que a regra olha. */
export type DaSerie = Pick<Acordao, "tribunal" | "orgao" | "relator" | "ementa" | "avisoDeEmenta">;

/** O primeiro da série e os demais, na ordem em que vieram. */
export interface GrupoEmSerie<T> {
  principal: T;
  outros: T[];
}

/** Como o grupo se chama na resposta: o critério, sem sugerir que a tese ou o resultado sejam os mesmos. */
export const CRITERIO_DA_SERIE = "mesma ementa";

export function agruparEmSerie<T extends DaSerie>(lista: readonly T[]): GrupoEmSerie<T>[] {
  const grupos: GrupoEmSerie<T>[] = [];
  const porChave = new Map<string, GrupoEmSerie<T>>();
  for (const x of lista) {
    const chave = chaveDaSerie(x);
    const grupo = chave === undefined ? undefined : porChave.get(chave);
    if (grupo) {
      grupo.outros.push(x);
      continue;
    }
    const novo = { principal: x, outros: [] };
    grupos.push(novo);
    if (chave !== undefined) porChave.set(chave, novo);
  }
  return grupos;
}

/** Sem chave (= sozinho): ementa ausente ou cortada, ou tribunal, órgão ou relator sem valor. */
function chaveDaSerie(x: DaSerie): string | undefined {
  const [tribunal, orgao, relator, ementa] = [x.tribunal, x.orgao, x.relator, x.ementa].map((t) => t?.trim().replace(/\s+/g, " "));
  if (x.avisoDeEmenta || !tribunal || !orgao || !relator || !ementa) return undefined;
  return JSON.stringify([tribunal, orgao, relator, ementa]);
}
