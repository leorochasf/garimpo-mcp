/** Entrada do `npm run gerar-tabela`: gera e grava a tabela de precedentes em dados/ (ver gerarTabela.ts). */

import { clienteDoGerador, DESTINO_PADRAO, gerarEGravar } from "./gerarTabela.js";

const tabela = await gerarEGravar(clienteDoGerador());
console.log(
  `Tabela gravada em ${DESTINO_PADRAO}: ${tabela.linhas.length} linhas; ${tabela.atualizacaoDaFonte.texto}; ` +
    `gerada em ${tabela.geradaEm}.`,
);
