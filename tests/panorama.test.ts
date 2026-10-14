import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { respostaJson } from "./apoio.js";

/** Site falso que responde a cada busca com os registros do tribunal pedido na URL e conta as chamadas. */
function siteDosTribunais(porTribunal: Record<string, unknown[]>) {
  const chamadas: string[] = [];
  const site = new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string) => {
      chamadas.push(url);
      const tribunal = /tribunais\/([a-z0-9]+)\/search/.exec(url)![1];
      return respostaJson({ results: porTribunal[tribunal] ?? [] });
    }) as typeof fetch,
  });
  return { site, chamadas };
}

async function conectar(site: Cliente) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
  await criarServidor(site, { dados }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { isError: r.isError, texto: r.content[0].text, json: r.isError ? undefined : JSON.parse(r.content[0].text) };
}

const registro = (id: string, data: string | null, orgao: string | null) => ({
  id,
  texto_ementa: `EMENTA FICTÍCIA ${id}. Tema de exemplo.`,
  numero_processo: `1.000.${id.padStart(3, "0")}/SP`,
  orgao_julgador: orgao,
  data_julgamento: data,
  link_pdf: `https://exemplo.test/${id}`,
});

describe("panorama_da_amostra", () => {
  it("conta uma vez o acórdão guardado sob ids equivalentes", async () => {
    const original = registro("1", "2021-01-02T00:00:00.000Z", "Terceira Turma");
    const { site, chamadas } = siteDosTribunais({ stj: [original, { ...original, id: "2" }] });
    const mcp = await conectar(site);
    await chamar(mcp, "busca_direta", { tribunal: "stj", texto: "tema de exemplo" });
    const r = await chamar(mcp, "panorama_da_amostra", { ids: ["stj:1", "stj:2"] });
    expect(r.json.total).toBe(1);
    expect(r.json.porOrgao).toEqual({ stj: { "Terceira Turma": 1 } });
    expect(chamadas).toHaveLength(1);
  });

  it("conta nomes de órgão que coincidem com propriedades de Object", async () => {
    const { site } = siteDosTribunais({ stj: [
      registro("1", null, "constructor"),
      registro("2", null, "__proto__"),
      registro("3", null, "toString"),
    ] });
    const mcp = await conectar(site);
    await chamar(mcp, "busca_direta", { tribunal: "stj", texto: "tema de exemplo" });
    const r = await chamar(mcp, "panorama_da_amostra", { ids: ["stj:1", "stj:2", "stj:3"] });
    expect(r.json.porOrgao.stj).toEqual(JSON.parse('{"constructor":1,"__proto__":1,"toString":1}'));
  });

  it("fica abaixo de 25 mil caracteres com 200 ids de cinco tribunais, sem consultar a rede", async () => {
    const tribunais = ["stj", "tjgo", "tjsp", "tjmg", "tjto"];
    const porTribunal = Object.fromEntries(tribunais.map((t) => [t, Array.from({ length: 40 }, (_, i) =>
      registro(String(i + 1), "2023-01-01T00:00:00.000Z", `Câmara de exemplo ${i % 30}`),
    )]));
    const { site, chamadas } = siteDosTribunais(porTribunal);
    const mcp = await conectar(site);
    for (const tribunal of tribunais) {
      await chamar(mcp, "busca_direta", { tribunal, texto: "tema de exemplo", limite: 100 });
    }
    const ids = tribunais.flatMap((t) => Array.from({ length: 40 }, (_, i) => `${t}:${i + 1}`));
    const r = await chamar(mcp, "panorama_da_amostra", { ids });
    expect(r.json.total).toBe(200);
    expect(r.json.porTribunal).toEqual({ stj: 40, tjgo: 40, tjsp: 40, tjmg: 40, tjto: 40 });
    expect(r.json.porAno).toEqual({ "2023": 200 });
    for (const tribunal of tribunais) {
      expect(Object.keys(r.json.porOrgao[tribunal])).toHaveLength(21);
      expect(r.json.porOrgao[tribunal].outros).toBe(10);
    }
    expect(r.texto.length).toBeLessThan(25_000);
    expect(chamadas).toHaveLength(5);
  });

  it("conta por tribunal, ano e órgão os acórdãos que a busca trouxe, sem chamar o site, e avisa que é amostra", async () => {
    const { site, chamadas } = siteDosTribunais({
      stj: [
        registro("1", "2020-12-04T00:00:00.000Z", "Segunda Turma"),
        registro("2", "2020-05-01T00:00:00.000Z", "Segunda Turma"),
        registro("3", "2022-03-09T00:00:00.000Z", "Primeira Turma"),
        registro("4", null, null),
      ],
      tjgo: [registro("5", "2022-07-07T00:00:00.000Z", "Segunda Turma")],
    });
    const mcp = await conectar(site);
    const ampla = await chamar(mcp, "busca_ampla", { formulacoes: ["tema de exemplo"], tribunais: ["stj", "tjgo"] });
    const ids = ampla.json.acordaos.map((a: { id: string }) => a.id);
    expect(ids).toHaveLength(5);
    const antes = chamadas.length;

    const r = await chamar(mcp, "panorama_da_amostra", { ids });
    expect(r.isError).toBeFalsy();
    expect(chamadas).toHaveLength(antes);
    expect(r.json.total).toBe(5);
    expect(r.json.porTribunal).toEqual({ stj: 4, tjgo: 1 });
    expect(r.json.porAno).toEqual({ "2020": 2, "2022": 2, "sem data": 1 });
    expect(r.json.porOrgao).toEqual({
      stj: { "Segunda Turma": 2, "Primeira Turma": 1, "sem órgão informado": 1 },
      tjgo: { "Segunda Turma": 1 },
    });
    expect(r.json.foraDaMemoria).toEqual([]);
    expect(r.json.avisoDeAmostra).toBe(
      "Contagem só dos acórdãos informados, tirados de uma busca do Garimpo: é uma amostra da busca, não a estatística " +
        "do tribunal nem o total de julgados sobre o tema.",
    );
  });

  it("conta uma vez o id repetido e põe o id fora da memória à parte, sem derrubar a resposta", async () => {
    const { site } = siteDosTribunais({ stj: [registro("1", "2021-01-02T00:00:00.000Z", "Terceira Turma")] });
    const mcp = await conectar(site);
    await chamar(mcp, "busca_direta", { tribunal: "stj", texto: "tema de exemplo" });
    const r = await chamar(mcp, "panorama_da_amostra", { ids: ["stj:1", "stj:1", "stj:999"] });
    expect(r.json.total).toBe(1);
    expect(r.json.porAno).toEqual({ "2021": 1 });
    expect(r.json.foraDaMemoria).toEqual(["stj:999"]);
    expect(r.json.aviso).toMatch(/refaça a busca/i);
  });

  it("mostra os 20 maiores órgãos de cada tribunal e junta o resto em outros, abaixo do teto de 25 mil caracteres", async () => {
    const registros = Array.from({ length: 100 }, (_, i) => registro(String(i + 1), "2023-01-01T00:00:00.000Z", `Órgão número ${i % 30}`));
    const { site } = siteDosTribunais({ stj: registros });
    const mcp = await conectar(site);
    const ampla = await chamar(mcp, "busca_ampla", { formulacoes: ["tema de exemplo"], tribunais: ["stj"], maximo: 100 });
    const ids = ampla.json.acordaos.map((a: { id: string }) => a.id);
    const r = await chamar(mcp, "panorama_da_amostra", { ids });
    const orgaos = r.json.porOrgao.stj as Record<string, number>;
    expect(Object.keys(orgaos)).toHaveLength(21);
    // 100 acórdãos em 30 órgãos: 10 com 4 e 20 com 3; os 20 maiores somam 70 e os 10 menores (3 cada), 30.
    expect(r.json.total).toBe(100);
    expect(orgaos.outros).toBe(30);
    expect(r.texto.length).toBeLessThan(25_000);
  });

  it("recusa lista vazia ou com mais de 200 ids, com frase que ensina", async () => {
    const mcp = await conectar(siteDosTribunais({}).site);
    for (const ids of [[], Array.from({ length: 201 }, (_, i) => `stj:${i}`)]) {
      const r = await chamar(mcp, "panorama_da_amostra", { ids });
      expect(r.isError).toBe(true);
      expect(r.texto).toMatch(/1 a 200 ids/);
    }
  });

  it("é só de leitura, repetível e não sai para a internet", async () => {
    const mcp = await conectar(siteDosTribunais({}).site);
    const { tools } = await mcp.listTools();
    expect(tools.find((t) => t.name === "panorama_da_amostra")!.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
