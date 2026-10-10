/**
 * Entrada do gerador da tabela do STF: lê a pasta de entrada e grava dados/tabela-precedentes-stf.json (ver gerarTabelaStf.ts).
 * Uso: npx vite-node scripts/rodarGeradorStf.ts [pasta de entrada] [--revisado]
 */

import { DESTINO_PADRAO_STF, ENTRADA_PADRAO_STF, gerarEGravarStf } from "./gerarTabelaStf.js";

const pasta = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? ENTRADA_PADRAO_STF;
const tabela = gerarEGravarStf(pasta, DESTINO_PADRAO_STF, Date.now, {
  revisado: process.argv.includes("--revisado"),
  aoComparar: console.log,
});
console.log(
  `Tabela do STF gravada em ${DESTINO_PADRAO_STF}: ${tabela.linhas.length} linhas ` +
    `(partes ausentes: ${tabela.partesAusentes.join(", ") || "nenhuma"}); gerada em ${tabela.geradaEm}.`,
);
