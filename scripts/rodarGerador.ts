/**
 * Entrada do `npm run gerar-tabela`: gera e grava a tabela de precedentes em dados/ (ver gerarTabela.ts).
 * `--revisado`: o mantenedor leu o relatório de diferenças e aceita a remoção ou a mudança grande.
 */

import { clienteDoGerador, DESTINO_PADRAO, gerarEGravar } from "./gerarTabela.js";

const tabela = await gerarEGravar(clienteDoGerador(), DESTINO_PADRAO, Date.now, {
  revisado: process.argv.includes("--revisado"),
  aoComparar: console.log,
});
console.log(
  `Tabela gravada em ${DESTINO_PADRAO}: ${tabela.linhas.length} linhas; ${tabela.atualizacaoDaFonte.texto}; ` +
    `gerada em ${tabela.geradaEm}.`,
);
