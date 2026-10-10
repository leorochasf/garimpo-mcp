/** Entrada do gerador da tabela do STF: lê a pasta de entrada e grava dados/tabela-precedentes-stf.json (ver gerarTabelaStf.ts). */

import { DESTINO_PADRAO_STF, ENTRADA_PADRAO_STF, gerarEGravarStf } from "./gerarTabelaStf.js";

const pasta = process.argv[2] ?? ENTRADA_PADRAO_STF;
const tabela = gerarEGravarStf(pasta);
console.log(
  `Tabela do STF gravada em ${DESTINO_PADRAO_STF}: ${tabela.linhas.length} linhas ` +
    `(partes ausentes: ${tabela.partesAusentes.join(", ") || "nenhuma"}); gerada em ${tabela.geradaEm}.`,
);
