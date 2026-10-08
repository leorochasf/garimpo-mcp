#!/usr/bin/env node
/**
 * Garimpo — servidor MCP local (stdio) de pesquisa de jurisprudência brasileira.
 * Cliente não oficial do JurisprudênciaIA; não é afiliado ao site nem à JAI.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Cliente } from "./cliente.js";
import { criarServidor } from "./servidor.js";

const site = new Cliente({ nome: "O JurisprudênciaIA" });

await criarServidor(site).connect(new StdioServerTransport());
