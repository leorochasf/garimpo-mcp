/**
 * Monta o servidor MCP do Garimpo com o cliente do site injetado, sem ligá-lo a transporte nenhum:
 * o stdio liga em index.ts; os testes ligam um cliente MCP em memória com um site falso por trás.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Cliente, VERSAO } from "./cliente.js";
import { acordaoNaMemoria, buscaDireta } from "./busca.js";
import { buscaAmpla } from "./ampla.js";
import { obterInteiroTeor, pastaPadrao } from "./inteiroTeor.js";
import { SIGLAS, TRIBUNAIS } from "./tribunais.js";

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

/** JSON sem recuo: o recuo não leva informação e custa ~10% da resposta da busca ampla. */
function json(dado: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(dado) }] };
}

/** Aviso de natureza jurídica: vai, em campo próprio, em toda resposta que traz jurisprudência (nunca em erro). */
const AVISO_NATUREZA_JURIDICA =
  "Resultado de busca em base não oficial. Confira o acórdão no link oficial do tribunal antes de citar; " +
  "a ementa não substitui o inteiro teor.";

function comAvisoNaturezaJuridica<T extends object>(dado: T) {
  return json({ ...dado, avisoNaturezaJuridica: AVISO_NATUREZA_JURIDICA });
}

function erro(e: unknown) {
  return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
}

export function criarServidor(site: Cliente): McpServer {
  const servidor = new McpServer({ name: "garimpo", version: VERSAO });

  servidor.registerTool(
    "busca_direta",
    {
      title: "Busca direta",
      description:
        "Pesquisa jurisprudência num tribunal pela busca direta do JurisprudênciaIA (sem o chat de IA do site). " +
        "Devolve acórdãos com ementa inteira, número, órgão, data e link oficial, e, em lista separada, os " +
        "precedentes qualificados (temas, súmulas). O site costuma devolver poucos acórdãos do STF por busca (de 2 a 7 na medição de out/2026). " +
        "O campo cabecalhoDeCobertura diz se veio o número pedido (pode haver mais) ou menos (a base não tem mais " +
        "para o texto; no STF, que devolve poucos por busca, pode haver mais). " +
        "Ementas são longas: prefira limite baixo aqui e busca_ampla para volume.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        tribunal,
        texto: z.string().min(2).describe("Texto da busca (palavras da tese, dispositivo legal, instituto)"),
        limite: z.number().int().min(1).max(100).optional().describe("Máximo de acórdãos (1 a 100; padrão 10)"),
        ...filtros,
      },
    },
    async (args) => {
      try {
        return comAvisoNaturezaJuridica(await buscaDireta(site, args));
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
        "Roda várias formulações da mesma tese em um ou mais tribunais e devolve uma lista única de acórdãos, sem " +
        "repetidos (registros duplicados na base do site viram um acórdão só), ordenada pela aderência (quantas " +
        "palavras de alguma formulação estão na ementa), depois por quantas formulações acharam cada acórdão e pela " +
        "posição na busca de origem. Cada tribunal pedido com acórdão aderente tem vagas garantidas. Aderência mede " +
        "proximidade de texto, não relevância jurídica. Saída compacta: número, tribunal, data, órgão, trecho da " +
        "ementa onde a tese aparece e link; e, em lista separada, os precedentes qualificados (temas, súmulas) que " +
        "o site devolveu. O campo cabecalhoDeCobertura traz, por tribunal, buscas feitas, vazias, com erro e não " +
        "feitas, acórdãos achados e mostrados; as formulações que não trouxeram nada; e se a lista foi cortada pelo " +
        "máximo. Busca vazia não é busca com erro: tribunal em que nenhuma busca deu resposta aparece \"com erro\" " +
        "(ou \"não pesquisado\"), sem achados. Se nenhuma busca deu resposta, a ferramenta responde com erro e o " +
        "motivo de cada busca, nunca com lista vazia. Para ler a ementa inteira, use obter_ementa com o id. " +
        "Formulações boas variam sinônimos técnicos, dispositivo legal e nome do instituto.",
      annotations: { readOnlyHint: true, openWorldHint: true },
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
        return comAvisoNaturezaJuridica(await buscaAmpla(site, args));
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
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { id: z.string().describe("Id do acórdão, como veio na busca (tribunal:id)") },
    },
    async ({ id }) => {
      const a = acordaoNaMemoria(id);
      if (!a) return erro(new Error(`O acórdão ${id} não está na memória desta sessão. Refaça a busca que o trouxe.`));
      return comAvisoNaturezaJuridica(a);
    },
  );

  servidor.registerTool(
    "obter_inteiro_teor",
    {
      title: "Obter inteiro teor oficial",
      description:
        "Baixa o PDF oficial do acórdão do portal do próprio tribunal e devolve o caminho do arquivo salvo. " +
        "Baixa do STJ, TJMG e TSE. Para STF, TJGO e demais devolve o link e explica como obter no navegador " +
        "(o Garimpo não contorna captcha nem proteção anti-robô). Informe o id que veio na busca ou tribunal + link.",
      inputSchema: {
        id: z.string().optional().describe("Id do acórdão, como veio na busca (tribunal:id)"),
        tribunal: tribunal.optional().describe("Tribunal, se informar o link em vez do id"),
        link: z.string().url().optional().describe("Link do inteiro teor que veio na busca"),
        pasta: z.string().optional().describe(`Pasta onde salvar o PDF (padrão: ${pastaPadrao()})`),
      },
    },
    async (args) => {
      try {
        return json(await obterInteiroTeor(args));
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
      annotations: { readOnlyHint: true, openWorldHint: false },
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

  return servidor;
}
