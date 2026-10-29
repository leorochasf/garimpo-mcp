import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { diplomasSuportados } from "../src/legislacao.js";
import { criarServidor } from "../src/servidor.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

async function conectar(legislacao: Cliente) {
  const site = new Cliente({ nome: "O site", esperar: async () => {}, fetch: (async () => respostaJson({ results: [] })) as typeof fetch });
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
  await criarServidor(site, { dados, legislacao }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function chamar(mcp: Client, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name: "texto_de_lei", arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { isError: r.isError, texto: r.content[0].text, json: r.isError ? undefined : JSON.parse(r.content[0].text) };
}

describe("texto_de_lei no servidor MCP", () => {
  it("entra no fim do tools/list, só leitura, idempotente e aberta ao mundo (sai para a internet)", async () => {
    const mcp = await conectar(clienteFalso([]).cliente);
    const { tools } = await mcp.listTools();

    const tl = tools.find((t) => t.name === "texto_de_lei")!;
    expect(tl.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, openWorldHint: true });
    // as 3 do TCU entram depois dela, no fim
    expect(tools.map((t) => t.name).slice(-5)).toEqual(["panorama_da_amostra", "texto_de_lei", "baixar_anos_tcu", "pesquisar_acordaos_tcu", "ler_acordao_tcu"]);
  });

  it("a descrição diz o que a ferramenta faz e o que não faz: texto literal, sem vigência, sem histórico próprio, sem artigo → precedente", async () => {
    const mcp = await conectar(clienteFalso([]).cliente);
    const { tools } = await mcp.listTools();
    const d = tools.find((t) => t.name === "texto_de_lei")!.description!;

    expect(d).toMatch(/texto literal/i);
    expect(d).toMatch(/normas\.leg\.br/);
    expect(d).toMatch(/não afirma vigência/);
    expect(d).toMatch(/CPC/);
    expect(d).toMatch(/não verificado/);
    expect(d).toMatch(/não liga artigo a precedente/i);
  });

  it("o campo diploma lista as mesmas siglas da descrição, e a descrição diz como a compilação difere", async () => {
    const mcp = await conectar(clienteFalso([]).cliente);
    const { tools } = await mcp.listTools();
    const tl = tools.find((t) => t.name === "texto_de_lei")!;
    const diploma = (tl.inputSchema.properties as Record<string, { description?: string }>).diploma.description;

    expect(diploma).toBe(`Sigla do diploma (${diplomasSuportados()})`);
    expect(diploma).toMatch(/CDC/);
    expect(tl.description).toMatch(/"Current"/);
    expect(tl.description).toMatch(/arquivoDaFonte/);
    expect(tl.description).toMatch(/duas no CP, no CPP, na CLT e no CDC/);
  });

  it("devolve o texto literal do dispositivo com a data de obtenção e o aviso fixo", async () => {
    const { cliente, chamadas } = clienteFalso([respostaJson(fixture("legislacao/cpc-recorte.json"))]);
    const mcp = await conectar(cliente);

    const r = await chamar(mcp, { diploma: "CPC", dispositivo: "art. 85, § 2º, inciso I" });

    expect(chamadas).toHaveLength(1);
    expect(r.json.resultado).toBe("encontrado");
    expect(r.json.partes[0].texto).toBe("o grau de zelo do profissional;");
    expect(r.json.aviso).toMatch(/^texto conforme a página oficial em \d{2}\/\d{2}\/\d{4}; o Garimpo não afirma vigência$/);
  });

  it("diploma ou dispositivo que não entende viram erro que ensina, sem chamada", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    const mcp = await conectar(cliente);

    const diploma = await chamar(mcp, { diploma: "Lei qualquer", dispositivo: "art. 1" });
    const dispositivo = await chamar(mcp, { diploma: "CPC", dispositivo: "o artigo dos honorários" });

    expect(diploma.isError).toBe(true);
    expect(diploma.texto).toMatch(/não reconheceu o diploma.*CPC/);
    expect(dispositivo.isError).toBe(true);
    expect(dispositivo.texto).toMatch(/Não entendi o dispositivo/);
    expect(chamadas).toHaveLength(0);
  });
});
