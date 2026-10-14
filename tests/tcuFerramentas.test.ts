import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { clienteFalso, respostaJson } from "./apoio.js";
import { acordaoFicticio, csvDoTcu, gravarAnoTcu, LISTA_REAL_TCU } from "./apoioTcu.js";

const LISTA = LISTA_REAL_TCU;
const lista = () => new Response(LISTA, { status: 200, headers: { "content-type": "text/csv" } });
const CSV = Buffer.from(csvDoTcu([acordaoFicticio(1), acordaoFicticio(2, { SUMARIO: "Convênio sem prestação de contas." })]), "utf8");
const arquivo = () =>
  new Response(CSV, { status: 200, headers: { "content-type": "text/csv", etag: '"e1"', "last-modified": "Fri, 02 Oct 2026 18:12:03 GMT", "content-length": String(CSV.length) } });

async function conectar(tcu: Cliente, dados: string) {
  const site = new Cliente({ nome: "O site", esperar: async () => {}, fetch: (async () => respostaJson({ results: [] })) as typeof fetch });
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(site, { dados, tcu }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { isError: r.isError, texto: r.content[0].text, json: r.isError ? undefined : JSON.parse(r.content[0].text) };
}

describe("ferramentas do TCU", () => {
  it("entram no fim do tools/list, depois das anteriores, com os hints certos", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    const mcp = await conectar(clienteFalso([]).cliente, dados);
    const { tools } = await mcp.listTools();
    expect(tools.slice(-4).map((t) => t.name)).toEqual(["texto_de_lei", "baixar_anos_tcu", "pesquisar_acordaos_tcu", "ler_acordao_tcu"]);
    const marca = Object.fromEntries(tools.map((t) => [t.name, t.annotations ?? {}]));
    expect(marca.baixar_anos_tcu.readOnlyHint).not.toBe(true);
    expect(marca.baixar_anos_tcu.destructiveHint).toBe(false);
    expect(marca.baixar_anos_tcu.openWorldHint).toBe(true);
    for (const nome of ["pesquisar_acordaos_tcu", "ler_acordao_tcu"]) {
      expect(marca[nome]).toMatchObject({ readOnlyHint: true, idempotentHint: true, openWorldHint: false });
    }
    const descricao = tools.find((t) => t.name === "baixar_anos_tcu")!.description!;
    expect(descricao).toMatch(/confirmar/);
    expect(descricao).toMatch(/MB/);
    expect(tools.find((t) => t.name === "pesquisar_acordaos_tcu")!.description).toMatch(/sumário/);
  });

  it("sem anos, lista o que o TCU publica (tamanho, data da lista) e o que já está no computador; uma só chamada", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    await gravarAnoTcu(dados, 2021, [acordaoFicticio(1)]);
    const { cliente, chamadas } = clienteFalso([lista()]);
    const r = await chamar(await conectar(cliente, dados), "baixar_anos_tcu", {});
    expect(chamadas).toHaveLength(1);
    expect(r.json.listaDoTcuEm).toBe("02/10/2026");
    expect(r.json.anos.map((a: { ano: number }) => a.ano)).toEqual([1992, 2020, 2021, 2025]);
    expect(r.json.anos).toEqual(expect.arrayContaining([
      expect.objectContaining({ ano: 2021, tamanhoMb: 500.75, baixado: true }),
      expect.objectContaining({ ano: 2025, tamanhoMb: 394.4, baixado: false }),
    ]));
    expect(r.json.aviso).toMatch(/Nada foi baixado/);
  });

  it("com anos e sem confirmar, só avisa (tamanho, total, pasta) e não toca no arquivo anual", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    const { cliente, chamadas } = clienteFalso([lista()]);
    const r = await chamar(await conectar(cliente, dados), "baixar_anos_tcu", { anos: [2025] });
    expect(chamadas.map((c) => c.url)).toEqual(["https://sites.tcu.gov.br/dados-abertos/jurisprudencia/arquivos/jurisprudencia-arquivos.csv"]);
    expect(r.json.precisaConfirmar).toBe(true);
    expect(r.json.totalMb).toBe(394.4);
    expect(r.json.pasta).toBe(join(dados, "tcu"));
    expect(r.json.mensagem).toMatch(/confirmar: true/);
    expect(r.json.mensagem).toMatch(/10 a 20 s/);
    expect(r.json.mensagem).toMatch(/poucos anos/);
  });

  it("com confirmar baixa um ano por vez; depois a pesquisa e a leitura funcionam sem nova chamada", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    const { cliente, chamadas } = clienteFalso([lista(), arquivo()]);
    const mcp = await conectar(cliente, dados);
    const baixa = await chamar(mcp, "baixar_anos_tcu", { anos: [2025], confirmar: true });
    expect(baixa.json.resultados).toEqual([expect.objectContaining({ ano: 2025, situacao: "baixado" })]);
    expect(baixa.json.aviso).toMatch(/10 a 20 s/);
    expect(chamadas).toHaveLength(2);

    const achou = await chamar(mcp, "pesquisar_acordaos_tcu", { consulta: "convênio" });
    expect(chamadas).toHaveLength(2);
    expect(achou.json.resultados).toHaveLength(1);
    expect(achou.json.resultados[0]).toMatchObject({ numero: "2", situacao: "OFICIALIZADO" });
    expect(achou.json.anosUsados[0]).toMatchObject({ ano: 2025, atualizadoNoTcuEm: "Fri, 02 Oct 2026 18:12:03 GMT" });
    expect(achou.texto).not.toContain("SEGREDO-");
    expect(achou.json.avisoNomes).toMatch(/nomes de pessoas/);
    expect(achou.json.anosPercorridos).toBe(1);
    expect(achou.json.tempoSegundos).toEqual(expect.any(Number));

    const lido = await chamar(mcp, "ler_acordao_tcu", { ano: 2025, chave: "ACORDAO-COMPLETO-100002", parte: "voto" });
    expect(lido.json.texto).toContain("Voto fictício 2");
    expect(chamadas).toHaveLength(2);
  });

  it("confirmar sem anos é erro claro, sem chamada de rede ao arquivo", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    const { cliente, chamadas } = clienteFalso([lista()]);
    const r = await chamar(await conectar(cliente, dados), "baixar_anos_tcu", { confirmar: true });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/anos/);
    expect(chamadas.length).toBeLessThanOrEqual(1);
  });
});
