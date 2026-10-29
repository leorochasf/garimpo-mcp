import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { Memoria } from "../src/memoria.js";
import { criarServidor } from "../src/servidor.js";
import { respostaJson } from "./apoio.js";

// Fixtures saneadas: estrutura vista na base em 2026-10-29; nomes e números fictícios.
const DO_VOTO = "Trecho só do voto, para a conferência.";
const DA_EMENTA = "RECURSO INOMINADO. CONSUMIDOR. EXEMPLO FICTÍCIO.";
const TJBA =
  "EMENTA: Tribunal de Justiça do Estado da Bahia PODER JUDICIÁRIO SEGUNDA TURMA RECURSAL PROCESSO Nº " +
  "0000001-11.2024.8.05.0001 RECORRENTE: EMPRESA EXEMPLO S A RECORRIDO: PESSOA FICTÍCIA RELATORA: JUÍZA FULANA " +
  `EXEMPLO E M E N T A ${DA_EMENTA} RECURSO CONHECIDO E PROVIDO. RELATÓRIO Trata-se de recurso de exemplo. VOTO ` +
  `${DO_VOTO} ( Classe: Recurso Inominado,Número do Processo: 0000001-11.2024.8.05.0001,Publicado em: 27/01/2025 )`;
const SEM_FIM = TJBA.replace("RELATÓRIO", "Relato").replace("VOTO", "Voto");
const INCERTA =
  "A ementa deste acórdão não pôde ser separada com segurança do resto do campo da base do JurisprudênciaIA (o " +
  "texto pode ter parte do relatório ou do voto): o Garimpo não diz se a citação está na ementa. Confira no inteiro teor.";

function site(texto_ementa: string) {
  const registro = {
    id: "1",
    texto_ementa,
    numero_processo_cnj: "0000001-11.2024.8.05.0001",
    data_julgamento: "2025-01-27T00:00:00.000Z",
    orgao_julgador: "Turma Exemplo",
  };
  return new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async () => respostaJson({ results: [registro] })) as typeof fetch,
  });
}

async function conectar(cliente: Cliente, dados?: string) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  dados ??= await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
  await criarServidor(cliente, { dados }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  expect(r.isError, r.content[0].text).toBeFalsy();
  return JSON.parse(r.content[0].text);
}

/** Veredito da conferência na ementa de cada citação, pelo id "tjba:1". */
async function naEmenta(mcp: Client, ...citacoes: string[]) {
  const r = await chamar(mcp, "conferir_citacao", { citacoes: citacoes.map((citacao) => ({ citacao, id: "tjba:1" })) });
  return (r.resultados as { fontes: Record<string, unknown>[] }[]).map((x) => x.fontes.find((f) => f.fonte === "ementa")!);
}

/** Memória gravada antes da ementa limpa: o campo inteiro do site, como fazia a versão anterior. */
async function memoriaAntiga(ementa: string): Promise<string> {
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-antiga-"));
  const acordao = { id: "tjba:1", tribunal: "tjba", numero: "0000001-11.2024.8.05.0001", semNumero: false, ementa } as Acordao;
  new Memoria({ dados }).lembrar([{ ids: [acordao.id], registro: acordao }]);
  const prazo = Date.now() + 10_000;
  while (!(await new Memoria({ dados }).obter(acordao.id))) {
    if (Date.now() > prazo) throw new Error("a gravação da memória não terminou no prazo");
    await new Promise((r) => setTimeout(r, 20));
  }
  return dados;
}

describe("conferência «na ementa» com a ementa limpa (TJBA)", () => {
  it("trecho do voto não sai como encontrado na ementa; trecho da ementa, sim", async () => {
    const mcp = await conectar(site(TJBA));
    await chamar(mcp, "busca_direta", { tribunal: "tjba", texto: "exemplo" });

    const [voto, ementa] = await naEmenta(mcp, DO_VOTO, DA_EMENTA);

    expect(voto.veredito).toBe("não encontrado");
    expect(ementa.veredito).toBe("encontrado literalmente");
  });

  it("ementa separada sem segurança: nunca «encontrado na ementa» nem «não encontrado», mas não verificável com o motivo", async () => {
    const mcp = await conectar(site(SEM_FIM));
    await chamar(mcp, "busca_direta", { tribunal: "tjba", texto: "exemplo" });

    const fontes = await naEmenta(mcp, DA_EMENTA, "Texto que não está em lugar nenhum do campo.");

    for (const f of fontes) {
      expect(f.veredito).toBe("não verificável");
      expect(JSON.stringify(f)).toContain(INCERTA);
    }
  });

  it("memória de antes da regra (campo inteiro guardado): o voto também não sai como encontrado na ementa", async () => {
    const mcp = await conectar(site(TJBA), await memoriaAntiga(TJBA));

    const [voto, ementa] = await naEmenta(mcp, DO_VOTO, DA_EMENTA);

    expect(voto.veredito).toBe("não encontrado");
    expect(ementa.veredito).toBe("encontrado literalmente");
  });

  it("memória de antes da regra sem separação segura: não verificável", async () => {
    const mcp = await conectar(site(SEM_FIM), await memoriaAntiga(SEM_FIM));

    const [f] = await naEmenta(mcp, DA_EMENTA);

    expect(f.veredito).toBe("não verificável");
  });
});
