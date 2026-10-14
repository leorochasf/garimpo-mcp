import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { fixture, respostaJson } from "./apoio.js";

/** Site falso que conta as chamadas e responde a toda busca com estes registros no formato do site. */
function siteQueConta(registros: unknown[]) {
  const chamadas: string[] = [];
  const site = new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string) => {
      chamadas.push(url);
      return respostaJson({ results: registros });
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

async function conferir(mcp: Client, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name: "conferir_acordao_citado", arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { isError: r.isError, texto: r.content[0].text, json: r.isError ? undefined : JSON.parse(r.content[0].text) };
}

const stj = (fixture("stj-sem-classe.json") as { results: unknown[] }).results;
const tjgo = (fixture("tjgo.json") as { results: unknown[] }).results;

describe("conferir_acordao_citado", () => {
  it("não toma o id do site por número de processo, nem na busca nem na memória", async () => {
    const { site, chamadas } = siteQueConta([{ ...(stj[1] as object), numero_processo: null, numero_processo_cnj: null }]);
    const mcp = await conectar(site);
    const busca = await conferir(mcp, { tribunal: "stj", numero: "202" });
    expect(busca.json.estado).toBe("não verificado");
    const memoria = await conferir(mcp, { tribunal: "stj", numero: "202", id: "stj:202" });
    expect(memoria.json.estado).toBe("não verificado");
    expect(memoria.texto).toMatch(/não que ele não exista/);
    expect(chamadas).toHaveLength(1);
  });

  it("não confirma órgãos por substring ou por texto vazio", async () => {
    const mcp = await conectar(siteQueConta([{ ...(tjgo[0] as object), orgao_julgador: "11ª Câmara Cível" }]).site);
    for (const orgao of ["1ª Câmara Cível", "Câmara Cível", "", "..."]) {
      const r = await conferir(mcp, { tribunal: "tjgo", numero: "0000001-11.2025.8.09.0001", orgao });
      expect(r.json.estado).toBe("dados em conflito");
      expect(r.json.divergencias[0].campo).toBe("orgao");
    }
  });

  it("prefere o registro que confere todos os campos ao que não traz um deles", async () => {
    const incompleto = { ...(stj[1] as object), data_julgamento: null };
    const completo = { ...(stj[1] as object), id: "203" };
    const mcp = await conectar(siteQueConta([incompleto, completo]).site);
    const r = await conferir(mcp, { tribunal: "stj", numero: "1.000.002/GO", data: "2020-12-05" });
    expect(r.json.acordao.id).toBe("stj:203");
    expect(r.json.naoConferidos).toEqual([]);
  });

  it("confirma o acórdão que bate em tribunal, número e data, com 1 busca no site", async () => {
    const { site, chamadas } = siteQueConta(stj);
    const mcp = await conectar(site);
    const r = await conferir(mcp, { tribunal: "stj", numero: "REsp 1.000.002/GO", data: "2020-12-05" });
    expect(r.isError).toBeFalsy();
    expect(r.json.estado).toBe("confirmado");
    expect(r.json.acordao).toMatchObject({ id: "stj:202", tribunal: "stj", dataJulgamento: "2020-12-05" });
    expect(r.json.divergencias).toEqual([]);
    expect(chamadas).toHaveLength(1);
  });

  it("aponta a data que diverge do registro como dados em conflito, com o que foi informado e o que está no registro", async () => {
    const mcp = await conectar(siteQueConta(stj).site);
    const r = await conferir(mcp, { tribunal: "stj", numero: "1.000.002/GO", data: "2020-12-06" });
    expect(r.json.estado).toBe("dados em conflito");
    expect(r.json.divergencias).toEqual([{ campo: "data", informado: "2020-12-06", noRegistro: "2020-12-05" }]);
    expect(r.json.acordao.id).toBe("stj:202");
  });

  it("compara o órgão sem diferenciar acento, maiúscula e pontuação, e aponta o que diverge", async () => {
    const mcp = await conectar(siteQueConta(tjgo).site);
    const igual = await conferir(mcp, { tribunal: "tjgo", numero: "0000001-11.2025.8.09.0001", orgao: "1a CAMARA civel" });
    expect(igual.json.estado).toBe("confirmado");
    const outro = await conferir(mcp, { tribunal: "tjgo", numero: "0000001-11.2025.8.09.0001", orgao: "2ª Câmara Cível" });
    expect(outro.json.estado).toBe("dados em conflito");
    expect(outro.json.divergencias).toEqual([{ campo: "orgao", informado: "2ª Câmara Cível", noRegistro: "1ª Câmara Cível" }]);
  });

  it("número que a busca não trouxe é não verificado, nunca inexistente", async () => {
    const mcp = await conectar(siteQueConta(stj).site);
    const r = await conferir(mcp, { tribunal: "stj", numero: "1.000.777/SP", data: "2020-12-05" });
    expect(r.json.estado).toBe("não verificado");
    expect(r.json.acordao).toBeUndefined();
    expect(r.texto).toMatch(/não que ele não exista/);
    expect(r.texto).not.toMatch(/inexistente/i);
    const vazia = await conferir(await conectar(siteQueConta([]).site), { tribunal: "stj", numero: "1.000.002/GO" });
    expect(vazia.json.estado).toBe("não verificado");
  });

  it("busca com erro é erro, nunca não verificado", async () => {
    const site = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async () => new Response("", { status: 429 })) as typeof fetch,
    });
    const r = await conferir(await conectar(site), { tribunal: "stj", numero: "1.000.002/GO" });
    expect(r.isError).toBe(true);
    expect(r.texto).not.toMatch(/não verificado/);
  });

  it("repetir a mesma conferência volta da busca guardada, sem nova chamada ao site", async () => {
    const { site, chamadas } = siteQueConta(stj);
    const mcp = await conectar(site);
    const primeira = await conferir(mcp, { tribunal: "stj", numero: "1.000.002/GO" });
    const segunda = await conferir(mcp, { tribunal: "stj", numero: "1.000.002/GO", data: "2020-12-05" });
    expect(primeira.json.consultaAoSite).toBe(true);
    expect(segunda.json.consultaAoSite).toBe(false);
    expect(chamadas).toHaveLength(1);
  });

  it("com o id de um acórdão que está na memória, não chama o site", async () => {
    const { site, chamadas } = siteQueConta(stj);
    const mcp = await conectar(site);
    await mcp.callTool({ name: "busca_direta", arguments: { tribunal: "stj", texto: "exemplo fictício" } });
    expect(chamadas).toHaveLength(1);
    const certo = await conferir(mcp, { tribunal: "stj", numero: "1.000.001/SP", id: "stj:201", data: "2020-12-04" });
    expect(certo.json).toMatchObject({ estado: "confirmado", consultaAoSite: false });
    const errado = await conferir(mcp, { tribunal: "stj", numero: "1.000.009/SP", id: "stj:201" });
    expect(errado.json.estado).toBe("dados em conflito");
    expect(errado.json.divergencias[0]).toMatchObject({ campo: "numero", informado: "1.000.009/SP" });
    expect(chamadas).toHaveLength(1);
  });

  it("dado citado que o registro não trouxe não é conflito: sai em naoConferidos", async () => {
    const semOrgao = [{ ...(stj[1] as object), orgao_julgador: null }];
    const mcp = await conectar(siteQueConta(semOrgao).site);
    const r = await conferir(mcp, { tribunal: "stj", numero: "1.000.002/GO", orgao: "Primeira Turma", data: "2020-12-05" });
    expect(r.json).toMatchObject({ estado: "confirmado", divergencias: [], naoConferidos: ["orgao"] });
  });

  it("mesmo número em dois acórdãos: confirma o que bate em tudo e lista o outro", async () => {
    const embargos = { ...(stj[1] as object), id: "203", data_julgamento: "2021-03-02T00:00:00.000Z", texto_ementa: "EMBARGOS DE DECLARAÇÃO. OUTRA EMENTA FICTÍCIA." };
    const mcp = await conectar(siteQueConta([stj[1], embargos]).site);
    const r = await conferir(mcp, { tribunal: "stj", numero: "1.000.002/GO", data: "2021-03-02" });
    expect(r.json.estado).toBe("confirmado");
    expect(r.json.acordao.id).toBe("stj:203");
    expect(r.json.outrosComOMesmoNumero).toEqual([{ id: "stj:202", orgao: "Primeira Turma", dataJulgamento: "2020-12-05" }]);
    const nenhum = await conferir(mcp, { tribunal: "stj", numero: "1.000.002/GO", data: "2019-01-01" });
    expect(nenhum.json.estado).toBe("dados em conflito");
    expect(nenhum.json.outrosComOMesmoNumero).toHaveLength(1);
  });

  it("recusa, com frase que ensina, data fora do formato, tribunal inexistente, número sem algarismo, id de outro tribunal e TRT", async () => {
    const { site, chamadas } = siteQueConta(stj);
    const mcp = await conectar(site);
    const data = await conferir(mcp, { tribunal: "stj", numero: "1.000.002/GO", data: "05/12/2020" });
    expect(data.isError).toBe(true);
    expect(data.texto).toMatch(/AAAA-MM-DD/);
    expect((await conferir(mcp, { tribunal: "xx", numero: "1" })).texto).toMatch(/não existe no Garimpo/);
    expect((await conferir(mcp, { tribunal: "stj", numero: "REsp" })).isError).toBe(true);
    expect((await conferir(mcp, { tribunal: "stj", numero: "1", id: "stf:9" })).texto).toMatch(/não é do tribunal/);
    const trt = await conferir(mcp, { tribunal: "trt3", numero: "0000001-11.2025.5.03.0001" });
    expect(trt.isError).toBe(true);
    expect(trt.texto).toMatch(/TRT/);
    expect(chamadas).toHaveLength(0);
  });

  it("vem com o aviso de natureza jurídica e as anotações de leitura que sai para a internet", async () => {
    const mcp = await conectar(siteQueConta(stj).site);
    const r = await conferir(mcp, { tribunal: "stj", numero: "1.000.002/GO" });
    expect(r.json.avisoNaturezaJuridica).toMatch(/base não oficial/);
    const { tools } = await mcp.listTools();
    expect(tools.find((t) => t.name === "conferir_acordao_citado")!.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});
