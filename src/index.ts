#!/usr/bin/env node
/**
 * Garimpo — servidor MCP local (stdio) de pesquisa de jurisprudência brasileira.
 * Cliente não oficial do JurisprudênciaIA; não é afiliado ao site nem à JAI.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Cliente } from "./cliente.js";
import { criarServidor } from "./servidor.js";
import { tabelaEmpacotada } from "./tabelaDePrecedentes.js";
import { tabelaDoStfEmpacotada } from "./tabelaDoStf.js";

const site = new Cliente({ nome: "O JurisprudênciaIA" });

// Tabela ilegível não derruba o servidor: o consultar_precedente fica sem plano B e as listas seguem sem ela.
let tabela;
try {
  tabela = tabelaEmpacotada();
} catch (e) {
  console.error(`Garimpo: a tabela de precedentes não pôde ser lida (${(e as Error).message}).`);
}
let tabelaStf;
try {
  tabelaStf = tabelaDoStfEmpacotada();
} catch (e) {
  console.error(`Garimpo: a tabela do STF não pôde ser lida (${(e as Error).message}).`);
}

await criarServidor(site, { tabela, tabelaStf }).connect(new StdioServerTransport());
