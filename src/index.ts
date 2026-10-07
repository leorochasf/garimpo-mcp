#!/usr/bin/env node
/**
 * Garimpo — servidor MCP local (stdio) de pesquisa de jurisprudência brasileira.
 * Cliente não oficial do JurisprudênciaIA; não é afiliado ao site nem à JAI.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Cliente, VERSAO } from "./cliente.js";
import { acordaoNaMemoria, buscaDireta } from "./busca.js";
import { buscaAmpla } from "./ampla.js";
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
  "busca_ampla",
  {
    title: "Busca ampla",
    description:
      "Roda várias formulações da mesma tese em um ou mais tribunais e devolve uma lista única, sem repetidos, " +
      "ordenada por quantas formulações acharam cada acórdão (desempate pela relevância). Saída compacta: " +
      "número, tribunal, data, órgão, começo da ementa e link. Para ler a ementa inteira, use obter_ementa com o id. " +
      "Formulações boas variam sinônimos técnicos, dispositivo legal e nome do instituto.",
    inputSchema: {
      formulacoes: z.array(z.string().min(2)).min(1).max(20).describe("Formulações da mesma tese (até 20)"),
      tribunais: z.array(tribunal).min(1).max(5).describe("Tribunais (até 5)"),
      limitePorBusca: z.number().int().min(1).max(100).optional().describe("Acórdãos por busca (padrão 100)"),
      maximo: z.number().int().min(1).max(200).optional().describe("Máximo de acórdãos na resposta (padrão 50)"),
      ...filtros,
    },
  },
  async (args) => {
    try {
      return json(await buscaAmpla(site, args));
    } catch (e) {
      return erro(e);
    }
  },
);

servidor.registerTool(
  "obter_ementa",
  {
    title: "Obter ementa",
    description:
      "Devolve a ementa inteira e os dados de um acórdão já devolvido por busca_direta ou busca_ampla nesta " +
      "sessão, pelo id (ex.: \"stj:12345\"). Não faz nova busca no site.",
    inputSchema: { id: z.string().describe("Id do acórdão, como veio na busca (tribunal:id)") },
  },
  async ({ id }) => {
    const a = acordaoNaMemoria(id);
    if (!a) return erro(new Error(`O acórdão ${id} não está na memória desta sessão. Refaça a busca que o trouxe.`));
    return json(a);
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
