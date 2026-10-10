import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import type { TabelaDoStf } from "../src/tabelaDoStf.js";
import { gerarTabelaStf } from "../scripts/gerarTabelaStf.js";
import { gerarTabela, PAGINA_DO_CONJUNTO, URL_PROCESSOS, URL_TEMAS } from "../scripts/gerarTabela.js";
import type { TabelaDePrecedentes } from "../src/tabelaDePrecedentes.js";
import { respostaJson } from "./apoio.js";

/**
 * Busca guardada e tabelas de precedentes: a busca devolvida pela memória recebe o reforço das tabelas carregadas na janela que
 * responde, como a busca nova, sem nova chamada ao site. Janelas = montagens com a mesma pasta de dados temporária.
 */

const gravado = (nome: string) => readFile(new URL(`./fixtures/stf-sintetico/${nome}`, import.meta.url));
const HOJE = Date.parse("2026-10-10T12:00:00Z");
const TESE_DO_SITE = 'Tese fictícia do tema um, "com aspas" & e comercial.\nSegunda linha da tese.';

/** Tabela sintética só com a repercussão geral, obtida em `obtidoEm`, com uma troca de texto no export. */
async function tabelaStf(obtidoEm: string, de = "", para = ""): Promise<TabelaDoStf> {
  const rg = Buffer.from((await gravado("RepercussaoGeral.xls")).toString("utf8").replace(de, para));
  const t = gerarTabelaStf({ repercussaoGeral: { nome: "RepercussaoGeral.xls", bytes: rg, obtidoEm }, paginasDeSumula: [] }, obtidoEm);
  return t;
}

/** Tabela do STJ pequena, da gravação de referência (como em qualificadosComTabela.test.ts). */
async function tabelaStj(): Promise<TabelaDePrecedentes> {
  const stj = (nome: string) => readFile(new URL(`./fixtures/stj-precedentes/${nome}`, import.meta.url));
  return gerarTabela(
    {
      pagina: { url: PAGINA_DO_CONJUNTO, bytes: await stj("pagina-trecho.html"), coletadoEm: "2026-10-09T12:22:25.614Z" },
      temas: { url: URL_TEMAS, bytes: await stj("temas-trecho.csv"), coletadoEm: "2026-10-09T12:22:35.742Z" },
      processos: { url: URL_PROCESSOS, bytes: await stj("processos-trecho.csv"), coletadoEm: "2026-10-09T12:22:47.212Z" },
    },
    "2026-10-09T12:23:00.000Z",
  );
}

function siteQueConta() {
  const chamadas: string[] = [];
  const cliente = new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string) => {
      chamadas.push(String(url));
      return respostaJson(
        String(url).includes("/stj/")
          ? { results: [], iacs: [{ id: "2", numero: 1, descricao_tese: "Questão fictícia." }] }
          : { results: [], rg: [{ id: "1", numero: 1, tese_firmada: TESE_DO_SITE }] },
      );
    }) as typeof fetch,
  });
  return { cliente, chamadas };
}

async function janela(site: Cliente, dados: string, tabelaStf?: TabelaDoStf, tabela?: TabelaDePrecedentes) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(site, { dados, tabelaStf, tabela, agora: () => HOJE }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

/** A gravação em disco corre por trás das respostas: espera, com prazo, a busca guardada aparecer no disco. */
async function esperarBuscaNoDisco(dados: string) {
  const prazo = Date.now() + 5_000;
  while (!(await readdir(join(dados, "memoria", "buscas-1")).catch(() => [])).some((n) => n.endsWith(".json"))) {
    if (Date.now() > prazo) throw new Error("a gravação da memória não terminou no prazo");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return JSON.parse(r.content[0].text);
}

describe("busca guardada com as tabelas de precedentes da janela que responde", () => {
  it("busca direta: sem tabela → com tabela → outra fotografia, sem nova chamada ao site", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "guardada-stf-"));
    const { cliente, chamadas } = siteQueConta();
    const busca = { tribunal: "stf", texto: "exemplo" };

    const semTabela = await chamar(await janela(cliente, dados), "busca_direta", busca);
    expect(semTabela.qualificados[0].enquadramento927.avisoSituacao ?? "").not.toMatch(/tabela de precedentes do STF/);
    expect(semTabela.tabelaDoStf).toBeUndefined();
    await esperarBuscaNoDisco(dados);

    const comTabela = await chamar(await janela(cliente, dados, await tabelaStf("2026-10-09T12:00:00.000Z")), "busca_direta", busca);
    expect(comTabela.buscaGuardada).toBeDefined();
    expect(comTabela.qualificados[0].enquadramento927.avisoSituacao).toMatch(
      /situação na fonte: "Trânsito em Julgado" \(tabela de precedentes do STF de 2026-10-09\)/,
    );
    expect(comTabela.qualificados[0].enquadramento927.notas).toEqual([]);
    expect(comTabela.tabelaDoStf.dataDaObtencao).toBe("2026-10-09");

    const outra = await tabelaStf(
      "2026-10-10T08:00:00.000Z",
      "<td>Trânsito em Julgado</td><td>Tese fictícia do tema um",
      "<td>Cancelado</td><td>Tese fictícia revista do tema um",
    );
    const trocada = await chamar(await janela(cliente, dados, outra), "busca_direta", busca);
    expect(trocada.buscaGuardada).toBeDefined();
    const e = trocada.qualificados[0].enquadramento927;
    expect(e.avisoSituacao).toMatch(/situação na fonte: "Cancelado" \(tabela de precedentes do STF de 2026-10-10\)/);
    expect(JSON.stringify(e)).not.toMatch(/2026-10-09|Trânsito em Julgado/);
    // A tese do site guardada continua a ser comparada com a da fotografia nova.
    expect(e.notas.some((n: string) => /a tese informada pelo site difere/.test(n))).toBe(true);
    expect(trocada.tabelaDoStf.dataDaObtencao).toBe("2026-10-10");

    expect(chamadas).toHaveLength(1);
  });

  it("busca guardada no formato anterior (sem as teses do site): não atribui o enquadramento antigo à fotografia nova; busca de novo", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "guardada-stf-antiga-"));
    const { cliente, chamadas } = siteQueConta();
    const busca = { tribunal: "stf", texto: "exemplo" };

    const antiga = await chamar(await janela(cliente, dados, await tabelaStf("2026-10-09T12:00:00.000Z")), "busca_direta", busca);
    expect(antiga.qualificados[0].enquadramento927.avisoSituacao).toMatch(/Trânsito em Julgado.*2026-10-09/);
    await esperarBuscaNoDisco(dados);
    // Simula o arquivo gravado pela versão anterior: mesmo formato, sem tesesDoSite.
    const pasta = join(dados, "memoria", "buscas-1");
    for (const nome of (await readdir(pasta)).filter((n) => n.endsWith(".json"))) {
      const { tesesDoSite, ...resto } = JSON.parse(await readFile(join(pasta, nome), "utf8"));
      expect(tesesDoSite).toBeDefined();
      await writeFile(join(pasta, nome), JSON.stringify(resto));
    }

    const outra = await tabelaStf("2026-10-10T08:00:00.000Z", "<td>Trânsito em Julgado</td>", "<td>Cancelado</td>");
    const depois = await chamar(await janela(cliente, dados, outra), "busca_direta", busca);
    const e = depois.qualificados[0].enquadramento927;
    expect(e.avisoSituacao).toMatch(/situação na fonte: "Cancelado" \(tabela de precedentes do STF de 2026-10-10\)/);
    expect(JSON.stringify(e)).not.toMatch(/2026-10-09|Trânsito em Julgado/);
    expect(depois.tabelaDoStf.dataDaObtencao).toBe("2026-10-10");
    expect(depois.buscaGuardada).toBeUndefined();
    expect(chamadas).toHaveLength(2);
  });

  it("busca ampla: a busca guardada também recebe a tabela da janela que responde", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "guardada-stf-ampla-"));
    const { cliente, chamadas } = siteQueConta();
    const busca = { formulacoes: ["exemplo"], tribunais: ["stf"] };

    const semTabela = await chamar(await janela(cliente, dados), "busca_ampla", busca);
    expect(semTabela.qualificados[0].enquadramento927).not.toMatch(/tabela do STF/);
    await esperarBuscaNoDisco(dados);

    const outra = await tabelaStf("2026-10-10T08:00:00.000Z", "<td>Trânsito em Julgado</td>", "<td>Cancelado</td>");
    const comTabela = await chamar(await janela(cliente, dados, outra), "busca_ampla", busca);
    expect(comTabela.qualificados[0].enquadramento927).toMatch(/Cancelado/);
    expect(comTabela.tabelaDoStf).toBeDefined();
    expect(chamadas).toHaveLength(1);
  });

  it("busca ampla: o inciso que depende da tabela (IAC do STJ sem tese no site) também é refeito na busca guardada", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "guardada-stj-ampla-"));
    const { cliente, chamadas } = siteQueConta();
    const busca = { formulacoes: ["exemplo"], tribunais: ["stj"] };

    const semTabela = await chamar(await janela(cliente, dados), "busca_ampla", busca);
    expect(semTabela.qualificados[0].enquadramento927).toMatch(/^não classificado/);
    await esperarBuscaNoDisco(dados);

    const comTabela = await chamar(await janela(cliente, dados, undefined, await tabelaStj()), "busca_ampla", busca);
    expect(comTabela.qualificados[0].enquadramento927).toBe("art. 927, III; situação na fonte em 2026-10-09: Trânsito em Julgado");
    expect(chamadas).toHaveLength(1);
  });
});
