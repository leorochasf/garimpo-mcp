import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { AdiadaError, Cliente, FormatoInesperadoError, PausaPreventivaError, RecusaError, VERSAO } from "../src/cliente.js";
import { RedeParadaError } from "../src/coordenacao.js";
import { FalhaNaMemoriaError } from "../src/memoria.js";
import { criarServidor } from "../src/servidor.js";
import { CHAMADO_LIGADO, linhaDeChamado } from "../src/chamado.js";

// Montados em partes: o varredor de dados reais não deve ver número nem caminho nos arquivos.
const NUMERO = ["0001234", "56", "2020", "8", "09", "0001"].join(".");
const CAMINHO = ["", "home", "ficticio", "doc.pdf"].join("/");

describe("linha de chamado nos erros inesperados (G-81)", () => {
  it("fica desligada até o repositório ser público", () => {
    expect(CHAMADO_LIGADO).toBe(false);
    expect(linhaDeChamado(new FormatoInesperadoError("x"), "busca_direta", "9.9.9")).toBeUndefined();
  });

  it("ligada, leva só versão, ferramenta e tipo do erro, nunca a mensagem", () => {
    const e = new FormatoInesperadoError(`busca por ${NUMERO} em ${CAMINHO}`);
    const linha = linhaDeChamado(e, "busca_direta", "9.9.9", true)!;
    const url = new URL(linha.match(/https:\/\/\S+/)![0]);
    expect(url.origin + url.pathname).toBe("https://github.com/leorochasf/garimpo-mcp/issues/new");
    expect([...url.searchParams.keys()].sort()).toEqual(["ferramenta", "tipo", "versao"]);
    expect(url.searchParams.get("versao")).toBe("9.9.9");
    expect(url.searchParams.get("ferramenta")).toBe("busca_direta");
    expect(url.searchParams.get("tipo")).toBe("FormatoInesperadoError");
    expect(linha).not.toMatch(/0001234|ficticio|doc\.pdf/);
  });

  it("recusa e erro comum de uso não levam o link, mesmo ligada", () => {
    expect(linhaDeChamado(new RecusaError("recusou", 429), "busca_direta", "9.9.9", true)).toBeUndefined();
    expect(linhaDeChamado(new Error("data inválida"), "busca_direta", "9.9.9", true)).toBeUndefined();
  });

  it.each([FormatoInesperadoError, FalhaNaMemoriaError, TypeError, RangeError])(
    "usa tipo fixo para %s, mesmo com nome e construtor contendo dados",
    (Classe) => {
      const e = new Classe(`formulação ${NUMERO} ${CAMINHO} trecho de documento`);
      e.name = e.message;
      Object.defineProperty(e, "constructor", { value: { name: e.message } });
      const linha = linhaDeChamado(e, "busca_direta", "9.9.9", true)!;
      const url = new URL(linha.match(/https:\/\/\S+/)![0]);
      expect(url.searchParams.get("tipo")).toBe(Classe.name);
      expect(linha).not.toMatch(/0001234|ficticio|formula|documento/);
      expect(linhaDeChamado(e, "busca_direta", "9.9.9", false)).toBeUndefined();
    },
  );
});

describe("linha de chamado no servidor (G-81)", () => {
  async function chamarComFalhaDeFormato(chamado?: boolean, falha?: Error) {
    const site = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async () => new Response(`não é json ${NUMERO}`, { status: 200 })) as typeof fetch,
    });
    if (falha) site.requisitar = async () => { throw falha; };
    const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    await criarServidor(site, { dados, chamado }).connect(ladoServidor);
    const mcp = new Client({ name: "teste", version: "0" });
    await mcp.connect(ladoCliente);
    const ferramentas = await mcp.listTools();
    const sucesso = await mcp.callTool({ name: "listar_tribunais", arguments: {} });
    const r = (await mcp.callTool({
      name: "busca_direta",
      arguments: { tribunal: "stj", texto: "responsabilidade civil do Estado" },
    })) as { content: { text: string }[]; isError?: boolean };
    await mcp.close();
    return { isError: r.isError, textos: r.content.map((c) => c.text), ferramentas, sucesso };
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

  it.each([
    new RecusaError("recusou", 429),
    new AdiadaError("esperar", Date.now() + 60_000),
    new PausaPreventivaError("pausado", Date.now() + 60_000),
    new RedeParadaError("estado ilegível"),
    new Error("uso inválido"),
  ])("não oferece chamado para %s, mesmo ligada", async (falha) => {
    const r = await chamarComFalhaDeFormato(true, falha);
    expect(r.isError).toBe(true);
    expect(r.textos.join("\n")).not.toMatch(/issues\/new/);
  });

  it("preserva toda resposta desligada e o tools/list e respostas de sucesso nos dois estados", async () => {
    const padrao = await chamarComFalhaDeFormato();
    expect(await chamarComFalhaDeFormato(false)).toEqual(padrao);
    const ligada = await chamarComFalhaDeFormato(true);
    expect(ligada.ferramentas).toEqual(padrao.ferramentas);
    expect(ligada.sucesso).toEqual(padrao.sucesso);
    expect(JSON.stringify(ligada.sucesso)).not.toMatch(/issues\/new/);
  });
});
