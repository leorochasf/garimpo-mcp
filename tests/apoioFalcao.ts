import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Cliente, Vagas } from "../src/cliente.js";
import { criarServidor, type OpcoesServidor } from "../src/servidor.js";
import { fixture, respostaJson } from "./apoio.js";

/** A resposta sintética do Falcão (formato observado no ticket 01; nenhum dado real). */
export const PESQUISA = fixture("falcao-pesquisa.json") as { documentos: Record<string, unknown>[]; quantidadeTotal: number };

/** Documento sintético do Falcão: o 1º da fixture (com ementa), com campos trocados. */
export function documento(campos: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...PESQUISA.documentos[0], ...campos };
}

/** Página do Falcão com estes documentos e o restante de folga no cabeçalho. */
export function pagina(documentos: unknown[], quantidadeTotal = 10_000, restante = "39"): Response {
  const r = respostaJson({ documentos, temasTopFive: [], quantidadeTotal });
  r.headers.set("x-rate-limit-remaining", restante);
  return r;
}

type Responder = (url: URL) => Response | Promise<Response>;

/**
 * Falcão falso: responde pela regra (padrão: a fixture inteira) e anota cada URL pedida. Relógio próprio que a espera
 * avança (o 1 s entre chamadas ao Falcão não vira espera real); vagas e freio em memória.
 */
export function falcaoFalso(responder: Responder = () => pagina(PESQUISA.documentos)) {
  const pedidos: URL[] = [];
  const cabecalhos: Headers[] = [];
  let agora = Date.UTC(2026, 9, 9, 17, 0);
  const cliente = new Cliente({
    nome: "O Falcão",
    vagas: new Vagas(2),
    agora: () => agora,
    esperar: async (ms) => {
      agora += ms;
    },
    fetch: (async (url: string, init: RequestInit) => {
      pedidos.push(new URL(url));
      cabecalhos.push(new Headers(init.headers));
      return responder(new URL(url));
    }) as typeof fetch,
  });
  return { cliente, pedidos, cabecalhos };
}

/** Site falso do JurisprudênciaIA: responde a toda busca com estes registros; anota as chamadas. */
export function siteFalso(registros: unknown[] = []) {
  const chamadas: string[] = [];
  const cliente = new Cliente({
    nome: "O site",
    vagas: new Vagas(2),
    esperar: async () => {},
    fetch: (async (url: string) => {
      chamadas.push(url);
      return respostaJson({ results: registros });
    }) as typeof fetch,
  });
  return { cliente, chamadas };
}

/** O Garimpo montado, chamado como o Claude chama, com pasta de dados nova dentro da temporária dos testes. */
export async function conectar(site: Cliente, falcao: Cliente, opcoes: OpcoesServidor = {}) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = opcoes.dados ?? (await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-falcao-")));
  await criarServidor(site, { dados, falcao, ...opcoes }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return { mcp, dados };
}

export async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const texto = r.content[0].text;
  let dado: any;
  try {
    dado = JSON.parse(texto);
  } catch {
    dado = undefined;
  }
  return { isError: Boolean(r.isError), texto, dado };
}
