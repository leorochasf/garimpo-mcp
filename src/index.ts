#!/usr/bin/env node
/**
 * Garimpo — servidor MCP local (stdio) de pesquisa de jurisprudência brasileira.
 * Cliente não oficial do JurisprudênciaIA; não é afiliado ao site nem à JAI.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Cliente, VERSAO } from "./cliente.js";
import { buscaDireta } from "./busca.js";
import { SIGLAS, TRIBUNAIS } from "./tribunais.js";

const site = new Cliente({ nome: "O JurisprudênciaIA" });

const servidor = new McpServer({ name: "garimpo", version: VERSAO });

const tribunal = z
  .string()
  .refine((s) => SIGLAS.includes(s.toLowerCase()), { message: `Tribunal desconhecido. Use um de: ${SIGLAS.join(", ")}` })
  .describe(`Sigla do tribunal: ${SIGLAS.join(", ")}`);

const filtros = {
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Data de julgamento inicial, AAAA-MM-DD"),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Data de julgamento final, AAAA-MM-DD"),
  relator: z.string().optional().describe("Nome do relator"),
  orgao: z.string().optional().describe("Órgão julgador (turma, câmara, seção)"),
  classe: z.string().optional().describe("Classe processual"),
};

function json(dado: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(dado, null, 1) }] };
}

function erro(e: unknown) {
  return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
}

servidor.registerTool(
  "busca_direta",
  {
    title: "Busca direta",
    description:
      "Pesquisa jurisprudência num tribunal pela busca direta do JurisprudênciaIA (sem o chat de IA do site). " +
      "Devolve acórdãos com ementa inteira, número, órgão, data e link oficial, e, em lista separada, os " +
      "precedentes qualificados (temas, súmulas). O STF devolve no máximo 4 acórdãos por busca. " +
      "Ementas são longas: prefira limite baixo aqui e busca_ampla para volume.",
    inputSchema: {
      tribunal,
      texto: z.string().min(2).describe("Texto da busca (palavras da tese, dispositivo legal, instituto)"),
      limite: z.number().int().min(1).max(100).optional().describe("Máximo de acórdãos (1 a 100; padrão 10)"),
      ...filtros,
    },
  },
  async (args) => {
    try {
      return json(await buscaDireta(site, args));
    } catch (e) {
      return erro(e);
    }
  },
);

servidor.registerTool(
  "listar_tribunais",
  {
    title: "Listar tribunais",
    description:
      "Lista os tribunais cobertos pelo Garimpo e, para cada um: se tem busca, quais precedentes qualificados " +
      "o site devolve, o teto de resultados por busca e se o inteiro teor oficial é baixado ou só linkado.",
    inputSchema: {},
  },
  async () =>
    json(
      TRIBUNAIS.map((t) => ({
        tribunal: t.sigla,
        nome: t.nome,
        busca: true,
        qualificados: t.qualificados,
        tetoResultados: t.tetoResultados,
        inteiroTeor: t.inteiroTeor,
        ...(t.motivoLink ? { motivo: t.motivoLink } : {}),
      })),
    ),
);

await servidor.connect(new StdioServerTransport());
