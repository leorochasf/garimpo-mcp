/**
 * Ressalva da grafia: com filtro de relator ou órgão, resultado vazio ou quase vazio pode ser só o nome escrito de
 * outro jeito. Vale no site e no Falcão e na busca ampla; nunca diz que não há julgado.
 */

/** Com filtro de relator ou órgão, até tantos registros contam como "poucos". */
const POUCOS_COM_NOME = 3;

/** "relator", "órgão" ou "relator e órgão", conforme os filtros pedidos; vazio = nenhum dos dois. */
export function nomesDoFiltro(p: { relator?: string; orgao?: string }): string {
  return [p.relator && "relator", p.orgao && "órgão"].filter(Boolean).join(" e ");
}

/** O nome do filtro pode não casar com a grafia do site: vazio ou quase vazio não prova que não há julgado. */
export function ressalvaDaGrafia(nomes: string): string {
  return (
    `Com filtro de ${nomes}, pode ser a grafia: o nome talvez não esteja escrito como o site escreve; ` +
    "isso não mostra que não há julgado, então repita sem o filtro."
  );
}

/**
 * A ressalva, ou undefined. Lista cheia (vieram tantos quanto o pedido) não é pouca: o limite pequeno, não o filtro,
 * é o que a explica. Na busca ampla não há limite por busca a comparar: passe `pedidos` indefinido.
 */
export function ressalvaSePoucos(nomes: string, vieram: number, pedidos?: number): string | undefined {
  if (!nomes || vieram > POUCOS_COM_NOME) return undefined;
  if (pedidos !== undefined && vieram >= pedidos) return undefined;
  return ressalvaDaGrafia(nomes);
}
