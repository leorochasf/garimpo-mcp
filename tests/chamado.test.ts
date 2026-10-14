import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente, FormatoInesperadoError, RecusaError, VERSAO } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { CHAMADO_LIGADO, linhaDeChamado } from "../src/chamado.js";

describe("linha de chamado nos erros inesperados (G-81)", () => {
  it("fica desligada até o repositório ser público", () => {
    expect(CHAMADO_LIGADO).toBe(false);
    expect(linhaDeChamado(new FormatoInesperadoError("x"), "busca_direta", "9.9.9")).toBeUndefined();
  });

  it("ligada, leva só versão, ferramenta e tipo do erro, nunca a mensagem", () => {
    const e = new FormatoInesperadoError("busca por 0001234-56.2020.8.09.0001 em /home/fulano/doc.pdf");
    const linha = linhaDeChamado(e, "busca_direta", "9.9.9", true)!;
    const url = new URL(linha.match(/https:\/\/\S+/)![0]);
    expect(url.origin + url.pathname).toBe("https://github.com/leorochasf/garimpo-mcp/issues/new");
    expect([...url.searchParams.keys()].sort()).toEqual(["ferramenta", "tipo", "versao"]);
    expect(url.searchParams.get("versao")).toBe("9.9.9");
    expect(url.searchParams.get("ferramenta")).toBe("busca_direta");
    expect(url.searchParams.get("tipo")).toBe("FormatoInesperadoError");
    expect(linha).not.toMatch(/0001234|fulano|doc\.pdf/);
  });

  it("recusa e erro comum de uso não levam o link, mesmo ligada", () => {
    expect(linhaDeChamado(new RecusaError("recusou", 429), "busca_direta", "9.9.9", true)).toBeUndefined();
    expect(linhaDeChamado(new Error("data inválida"), "busca_direta", "9.9.9", true)).toBeUndefined();
  });
});

describe("linha de chamado no servidor (G-81)", () => {
  async function chamarComFalhaDeFormato(chamado?: boolean) {
    const site = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async () => new Response("não é json 0001234-56.2020.8.09.0001", { status: 200 })) as typeof fetch,
    });
    const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    await criarServidor(site, { dados, chamado }).connect(ladoServidor);
    const mcp = new Client({ name: "teste", version: "0" });
    await mcp.connect(ladoCliente);
    const r = (await mcp.callTool({
      name: "busca_direta",
      arguments: { tribunal: "stj", texto: "responsabilidade civil do Estado" },
    })) as { content: { text: string }[]; isError?: boolean };
    return { isError: r.isError, textos: r.content.map((c) => c.text) };
  }

  it("desligada (padrão), o erro inesperado vem sem link", async () => {
    const r = await chamarComFalhaDeFormato();
    expect(r.isError).toBe(true);
    expect(r.textos.join("\n")).not.toMatch(/issues\/new/);
  });

  it("ligada, o erro inesperado leva só versão, ferramenta e tipo", async () => {
    const r = await chamarComFalhaDeFormato(true);
    const linha = r.textos.find((t) => t.includes("issues/new"))!;
    const url = new URL(linha.match(/https:\/\/\S+/)![0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      versao: VERSAO,
      ferramenta: "busca_direta",
      tipo: "FormatoInesperadoError",
    });
    expect(linha).not.toMatch(/responsabilidade|0001234/);
  });
});
