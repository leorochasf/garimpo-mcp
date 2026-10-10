import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { type TabelaDoStf, tabelaDoStfEmpacotada } from "../src/tabelaDoStf.js";
import { gerarTabelaStf } from "../scripts/gerarTabelaStf.js";
import { respostaJson } from "./apoio.js";

const gravado = (nome: string) => readFile(new URL(`./fixtures/stf-sintetico/${nome}`, import.meta.url));
const OBTIDO = "2026-10-09T12:00:00.000Z";

/** Tabela do STF gerada das gravações sintéticas (nada real). */
async function tabelaSintetica(): Promise<TabelaDoStf> {
  const a = async (nome: string) => ({ nome, bytes: await gravado(nome), obtidoEm: OBTIDO });
  return gerarTabelaStf(
    {
      repercussaoGeral: await a("RepercussaoGeral.xls"),
      sumulas: await a("sumulas.html"),
      sumulasVinculantes: await a("sumulas-vinculantes.html"),
      paginasDeSumula: [await a("sumulas/sumula-1.html"), await a("sumulas/sv-1.html")],
    },
    "2026-10-09T13:00:00.000Z",
  );
}

const HOJE = Date.parse("2026-10-10T12:00:00Z");
const DATA = "tabela de precedentes do STF de 2026-10-09";

function siteQueResponde(corpo: unknown) {
  return new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async () => respostaJson(corpo)) as typeof fetch,
  });
}

const siteSemRede = () =>
  new Cliente({
    nome: "O site",
    fetch: (async () => {
      throw new Error("a consulta à tabela não pode chamar a rede");
    }) as typeof fetch,
  });

async function conectar(site: Cliente, tabelaStf?: TabelaDoStf, agora = HOJE) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
  // O portal do STF falha (sem rede): o consultar_precedente responde a tabela, como plano B (ADR-0020).
  const semPortal = siteSemRede();
  await criarServidor(site, { dados, tabelaStf, agora: () => agora, precedentesStj: semPortal, precedentesStf: semPortal }).connect(
    ladoServidor,
  );
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function consultar(mcp: Client, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name: "consultar_precedente", arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { erro: r.isError === true, texto: r.content[0].text, dado: r.isError ? undefined : JSON.parse(r.content[0].text) };
}

describe("consultar_precedente — tabela do STF (plano B, portal sem rede)", () => {
  it("tema de repercussão geral: situação literal, tese, paradigma, enquadramento de sempre e atribuição", async () => {
    const mcp = await conectar(siteSemRede(), await tabelaSintetica());
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "repercussão geral", numero: 1 });
    expect(dado.consta).toBe(true);
    expect(dado.situacaoNaFonte).toBe("Trânsito em Julgado");
    expect(dado.situacaoEm).toMatch(/^situação no STF em 2026-10-09/);
    expect(dado.teseFirmada).toBe('Tese fictícia do tema um, "com aspas" & e comercial.\nSegunda linha da tese.');
    expect(dado.processoParadigma).toEqual(["RE 100001"]);
    expect(dado.haRepercussao).toBe("Há");
    expect(dado.notaTitulo).toMatch(/não é a tese/);
    expect(dado.enquadramento927.inciso).toBe("não classificado");
    expect(dado.enquadramento927.motivo).toMatch(/repercussão geral não é expressamente mencionada/);
    expect(dado.enquadramento927.avisoSituacao).toMatch(/situação na fonte: "Trânsito em Julgado" \(tabela de precedentes do STF de 2026-10-09\)/);
    expect(dado.tabela.atribuicao).toMatch(/^Fonte: STF/);
    expect(dado.tabela.fundamento).toMatch(/^Lei 9\.610\/98, art\. 8º, IV/);
    expect(dado.tabela.dataDaObtencao).toBe("2026-10-09");
    expect(dado.tabela.avisoDeIdade).toBeUndefined();
    expect(dado.avisoNaturezaJuridica).toMatch(/tabela do STF/);
    expect(JSON.stringify(dado)).not.toMatch(/vigente/i);
  });

  it("súmula com marca: a marca vem como rótulo da lista, com nota e sem enunciado se a página não foi salva", async () => {
    const mcp = await conectar(siteSemRede(), await tabelaSintetica());
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "súmula", numero: 2 });
    expect(dado.situacaoNaFonte).toBe('marcada como "superada" na lista do STF');
    expect(dado.situacaoEm).toMatch(/a falta de marca não prova que a súmula está em vigor/);
    expect(dado.enunciado).toMatch(/^enunciado não incluído na tabela/);
    expect(dado.link).toBe("https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=30&sumula=9002");
    expect(dado.enquadramento927.notas).toEqual([
      `a fonte marca "superada" (${DATA}); o inciso descreve o tipo do precedente, não a vigência`,
    ]);
  });

  it("súmula vinculante sem marca: inciso II, enunciado da página e aviso de que a falta de marca não prova vigência", async () => {
    const mcp = await conectar(siteSemRede(), await tabelaSintetica());
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "súmula vinculante", numero: 1 });
    expect(dado.situacaoNaFonte).toBe("sem marca de situação na lista do STF");
    expect(dado.enunciado).toBe("Enunciado fictício da súmula vinculante um.");
    expect(dado.enquadramento927.inciso).toBe("II");
    expect(dado.enquadramento927.avisoSituacao).toBe(
      `sem marca de situação na lista do STF (${DATA}); a falta de marca não prova que a súmula está em vigor: conferir antes de citar`,
    );
  });

  it("número ausente: não consta na tabela do STF de <data>", async () => {
    const mcp = await conectar(siteSemRede(), await tabelaSintetica());
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "súmula", numero: 999 });
    expect(dado.consta).toBe(false);
    expect(dado.resultado).toMatch(/^não consta na tabela do STF de 2026-10-09/);
  });

  it("parte que o mantenedor não obteve: diz que a tabela não tem a parte, sem afirmar nada do precedente", async () => {
    const vazia = gerarTabelaStf({ paginasDeSumula: [] }, "2026-10-09T13:00:00.000Z");
    const mcp = await conectar(siteSemRede(), vazia);
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "repercussão geral", numero: 1 });
    expect(dado.consta).toBe(false);
    expect(dado.resultado).toMatch(/não tem os temas de repercussão geral: o mantenedor ainda não obteve/);
  });

  it("tipo errado ou ausente no STF e tribunal fora da tabela: erro que ensina a corrigir", async () => {
    const mcp = await conectar(siteSemRede(), await tabelaSintetica());
    const semTipo = await consultar(mcp, { tribunal: "stf", numero: 1 });
    expect(semTipo.erro).toBe(true);
    expect(semTipo.texto).toMatch(/"repercussão geral", "súmula" ou "súmula vinculante"/);
    const errado = await consultar(mcp, { tribunal: "stf", tipo: "tema repetitivo", numero: 1 });
    expect(errado.erro).toBe(true);
    const tst = await consultar(mcp, { tribunal: "tst", tipo: "súmula", numero: 1 });
    expect(tst.erro).toBe(true);
    expect(tst.texto).toMatch(/só cobre o STJ .* e o STF/);
  });

  it("tabela com mais de 90 dias: aviso de idade", async () => {
    const mcp = await conectar(siteSemRede(), await tabelaSintetica(), Date.parse("2027-02-01T00:00:00Z"));
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "súmula", numero: 1 });
    expect(dado.tabela.avisoDeIdade).toMatch(/mais de 90 dias/);
  });
});

describe("listas de qualificados do STF com a tabela do STF", () => {
  it("busca_direta: situação da tabela no aviso, nota de marca e de tese divergente, campo tabelaDoStf", async () => {
    const mcp = await conectar(
      siteQueResponde({
        results: [],
        sumulas_vinc: [{ id: "1", numero: "2", enunciado: "Enunciado fictício." }],
        rg: [{ id: "2", numero: "1", tese_firmada: "Tese fictícia diferente." }],
      }),
      await tabelaSintetica(),
    );
    const r = (await mcp.callTool({ name: "busca_direta", arguments: { tribunal: "stf", texto: "exemplo" } })) as {
      content: { text: string }[];
    };
    const dado = JSON.parse(r.content[0].text);
    const sv = dado.qualificados.find((q: { tipo: string }) => q.tipo === "súmula vinculante").enquadramento927;
    expect(sv.inciso).toBe("II");
    expect(sv.avisoSituacao).toMatch(/^marcada como "cancelada" na lista do STF/);
    expect(sv.notas).toEqual([`a fonte marca "cancelada" (${DATA}); o inciso descreve o tipo do precedente, não a vigência`]);
    const rg = dado.qualificados.find((q: { tipo: string }) => q.tipo === "repercussão geral").enquadramento927;
    expect(rg.inciso).toBe("não classificado");
    expect(rg.notas[0]).toMatch(/^a tese informada pelo site difere da tese firmada na tabela de precedentes do STF/);
    expect(dado.tabelaDoStf.atribuicao).toMatch(/^Fonte: STF/);
    expect(dado.tabelaDePrecedentes).toBeUndefined();
  });

  it("busca_ampla: forma curta com a marca da lista e a data", async () => {
    const mcp = await conectar(
      siteQueResponde({ results: [], sumulas: [{ id: "1", numero: "3", enunciado: "Enunciado fictício." }] }),
      await tabelaSintetica(),
    );
    const r = (await mcp.callTool({
      name: "busca_ampla",
      arguments: { formulacoes: ["exemplo um", "exemplo dois"], tribunais: ["stf"] },
    })) as { content: { text: string }[] };
    const dado = JSON.parse(r.content[0].text);
    expect(dado.qualificados[0].enquadramento927).toMatch(/; marca na lista do STF em 2026-10-09: cancelada$/);
    expect(dado.tabelaDoStf.dataDaObtencao).toBe("2026-10-09");
  });

  it("súmula vinculante na busca_ampla: inciso e a marca da tabela no lugar do aviso do site", async () => {
    const mcp = await conectar(
      siteQueResponde({ results: [], sumulas_vinc: [{ id: "1", numero: "2", enunciado: "Enunciado fictício." }] }),
      await tabelaSintetica(),
    );
    const r = (await mcp.callTool({
      name: "busca_ampla",
      arguments: { formulacoes: ["exemplo um", "exemplo dois"], tribunais: ["stf"] },
    })) as { content: { text: string }[] };
    expect(JSON.parse(r.content[0].text).qualificados[0].enquadramento927).toBe(
      "art. 927, II; marca na lista do STF em 2026-10-09: cancelada",
    );
  });

  it("tese do site igual à da tabela salvo espaço interno: sem aviso de divergência", async () => {
    const mcp = await conectar(
      siteQueResponde({
        results: [],
        rg: [{ id: "2", numero: "1", tese_firmada: 'Tese fictícia do tema um,  "com aspas" & e comercial. Segunda linha da tese.' }],
      }),
      await tabelaSintetica(),
    );
    const r = (await mcp.callTool({ name: "busca_direta", arguments: { tribunal: "stf", texto: "exemplo" } })) as {
      content: { text: string }[];
    };
    expect(JSON.parse(r.content[0].text).qualificados[0].enquadramento927.notas).toEqual([]);
  });

  it("tabela do STF vazia: listas como antes, sem o campo da tabela", async () => {
    const vazia = gerarTabelaStf({ paginasDeSumula: [] }, "2026-10-09T13:00:00.000Z");
    const mcp = await conectar(siteQueResponde({ results: [], sumulas_vinc: [{ id: "1", numero: "2" }] }), vazia);
    const r = (await mcp.callTool({ name: "busca_direta", arguments: { tribunal: "stf", texto: "exemplo" } })) as {
      content: { text: string }[];
    };
    const dado = JSON.parse(r.content[0].text);
    expect(dado.qualificados[0].enquadramento927.avisoSituacao).toMatch(/não informada pelo site/);
    expect(dado.qualificados[0].enquadramento927.notas).toEqual([]);
    expect(dado.tabelaDoStf).toBeUndefined();
  });
});

describe("tabela do STF empacotada", () => {
  it("traz fonte, fundamento, atribuição, data de geração e linhas com tipo e número", () => {
    const t = tabelaDoStfEmpacotada();
    expect(t.fonte.tribunal).toBe("STF");
    expect(t.fundamento).toMatch(/^Lei 9\.610\/98, art\. 8º, IV/);
    expect(t.atribuicao).toMatch(/^Fonte: STF/);
    expect(t.geradaEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const l of t.linhas) {
      expect(["repercussão geral", "súmula", "súmula vinculante"]).toContain(l.tipo);
      expect(Number.isInteger(l.numero) && l.numero > 0).toBe(true);
    }
    for (const a of t.arquivos) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
