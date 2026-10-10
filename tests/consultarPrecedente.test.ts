import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { type TabelaDePrecedentes, tabelaEmpacotada } from "../src/tabelaDePrecedentes.js";
import { gerarTabela, PAGINA_DO_CONJUNTO, URL_PROCESSOS, URL_TEMAS } from "../scripts/gerarTabela.js";

const gravado = (nome: string) => readFile(new URL(`./fixtures/stj-precedentes/${nome}`, import.meta.url));

/** Tabela pequena gerada da gravação de referência real (coleta do temas.csv em 2026-10-09). */
async function tabelaPequena(): Promise<TabelaDePrecedentes> {
  return gerarTabela(
    {
      pagina: { url: PAGINA_DO_CONJUNTO, bytes: await gravado("pagina-trecho.html"), coletadoEm: "2026-10-09T12:22:25.614Z" },
      temas: { url: URL_TEMAS, bytes: await gravado("temas-trecho.csv"), coletadoEm: "2026-10-09T12:22:35.742Z" },
      processos: { url: URL_PROCESSOS, bytes: await gravado("processos-trecho.csv"), coletadoEm: "2026-10-09T12:22:47.212Z" },
    },
    "2026-10-09T12:23:00.000Z",
  );
}

const HOJE = Date.parse("2026-10-10T12:00:00Z");

/** O Garimpo chamado como o Claude chama, com um site que falha se for chamado: a consulta não usa rede. */
async function conectar(tabela: TabelaDePrecedentes, agora = HOJE) {
  const site = new Cliente({
    nome: "O site",
    fetch: (async () => {
      throw new Error("a consulta à tabela não pode chamar a rede");
    }) as typeof fetch,
  });
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
  await criarServidor(site, { dados, tabela, agora: () => agora }).connect(ladoServidor);
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

describe("consultar_precedente — tabela de precedentes do STJ, sem rede", () => {
  it("só lê e não sai para a internet", async () => {
    const mcp = await conectar(await tabelaPequena());
    const { tools } = await mcp.listTools();
    const t = tools.find((x) => x.name === "consultar_precedente")!;
    expect(t.annotations?.readOnlyHint).toBe(true);
    expect(t.annotations?.openWorldHint).toBe(false);
  });

  it("tema achado: situação literal com data, tese, questão rotulada, datas, paradigma, enquadramento e atribuição", async () => {
    const mcp = await conectar(await tabelaPequena());
    const { dado } = await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero: 1 });
    expect(dado.consta).toBe(true);
    expect(dado.situacaoNaFonte).toBe("Trânsito em Julgado");
    expect(dado.situacaoEm).toMatch(/^situação no STJ em 2026-10-09/);
    expect(dado.teseFirmada).toMatch(/\S/);
    expect(dado.teseFirmada).not.toBe("sem tese firmada na tabela");
    expect(dado.notaQuestaoSubmetida).toMatch(/não a tese/);
    expect(dado.processoParadigma).toEqual(["REsp 1091443"]);
    expect(dado.enquadramento927.inciso).toBe("III");
    expect(dado.enquadramento927.evidencia).toBe("tabela de precedentes do STJ de 2026-10-09, tema repetitivo nº 1, com tese firmada");
    expect(dado.enquadramento927.avisoSituacao).toMatch(/situação na fonte: "Trânsito em Julgado"/);
    expect(dado.tabela.atribuicao).toBe("Fonte: STJ — Portal de Dados Abertos, conjunto Precedentes qualificados");
    expect(dado.tabela.licencaDosDados).toMatch(/^Creative Commons Atribuição, conforme a página do conjunto em 2026-10-09/);
    expect(dado.tabela.dataDaColeta).toBe("2026-10-09");
    expect(dado.tabela.atualizacaoInformadaPelaFonte).toBe("Última Atualização outubro 8, 2026, 17:25 (UTC)");
    expect(dado.tabela.idadeDaTabela).toMatch(/^1 dias, contada da data de atualização informada pela fonte \(2026-10-08\)/);
    expect(dado.tabela.avisoDeIdade).toBeUndefined();
    expect(dado.avisoNaturezaJuridica).toMatch(/Fotografia da tabela/);
    expect(JSON.stringify(dado)).not.toMatch(/vigente|superad/i);
  });

  it("Tema 1 e IAC 1 são precedentes diferentes", async () => {
    const mcp = await conectar(await tabelaPequena());
    const tema = (await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero: 1 })).dado;
    const iac = (await consultar(mcp, { tribunal: "STJ", tipo: "IAC", numero: 1 })).dado;
    expect(iac.tipo).toBe("IAC");
    expect(iac.processoParadigma).toEqual(["EREsp 1604412"]);
    expect(iac.temasDeRepercussaoGeralDoSTF).toEqual(["1162"]);
    expect(iac.teseFirmada).not.toBe(tema.teseFirmada);
  });

  it("afetado sem tese: \"sem tese firmada na tabela\" e não classificado", async () => {
    const mcp = await conectar(await tabelaPequena());
    const { dado } = await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero: 978 });
    expect(dado.situacaoNaFonte).toBe("Afetado");
    expect(dado.teseFirmada).toBe("sem tese firmada na tabela");
    expect(dado.questaoSubmetida).toMatch(/\S/);
    expect(dado.enquadramento927.inciso).toBe("não classificado");
    expect(dado.enquadramento927.motivo).toMatch(/sem tese firmada informada pela tabela de precedentes do STJ de 2026-10-09/);
  });

  it.each([
    [56, "Cancelado"],
    [126, "Revisado"],
  ])("tema %i (%s): a situação vem literal e a nota não muda o inciso", async (numero, situacao) => {
    const mcp = await conectar(await tabelaPequena());
    const { dado } = await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero });
    expect(dado.situacaoNaFonte).toBe(situacao);
    const comTese = dado.teseFirmada !== "sem tese firmada na tabela";
    expect(dado.enquadramento927.inciso).toBe(comTese ? "III" : "não classificado");
    expect(dado.enquadramento927.notas).toEqual([
      `a fonte indica "${situacao}" (tabela de precedentes do STJ de 2026-10-09); o inciso descreve o tipo do precedente, não a vigência`,
    ]);
  });

  it("situação ausente na fonte: \"situação não informada pela fonte\"; sem paradigma: \"não informado pela tabela\"", async () => {
    const tabela = await tabelaPequena();
    const linha = tabela.linhas.find((l) => l.tipo === "tema repetitivo" && l.numero === 14)!;
    delete linha.situacao;
    delete linha.processosParadigma;
    const { dado } = await consultar(await conectar(tabela), { tribunal: "stj", tipo: "tema repetitivo", numero: 14 });
    expect(dado.situacaoNaFonte).toBe("situação não informada pela fonte");
    expect(dado.processoParadigma).toBe("processo paradigma não informado pela tabela");
    expect(dado.sumulaOriginada).toBe("378");
    expect(dado.notaSumulas).toMatch(/sem o enunciado/);
  });

  it("número ausente: \"não consta na tabela de <data>\", nunca \"não existe\"", async () => {
    const mcp = await conectar(await tabelaPequena());
    const { erro, dado } = await consultar(mcp, { tribunal: "stj", tipo: "IAC", numero: 978 });
    expect(erro).toBe(false);
    expect(dado.consta).toBe(false);
    expect(dado.resultado).toMatch(/^não consta na tabela de precedentes do STJ de 2026-10-09/);
    expect(dado.resultado).not.toMatch(/não existe\b/);
    expect(dado.tabela.atribuicao).toMatch(/Precedentes qualificados/);
  });

  it("tipo ausente ou desconhecido: erro que explica a numeração separada", async () => {
    const mcp = await conectar(await tabelaPequena());
    for (const args of [{ tribunal: "stj", numero: 1 }, { tribunal: "stj", tipo: "tema", numero: 1 }]) {
      const r = await consultar(mcp, args);
      expect(r.erro).toBe(true);
      expect(r.texto).toMatch(/"tema repetitivo" ou "IAC"/);
      expect(r.texto).toMatch(/numeração separada/);
    }
  });

  it("outro tribunal: erro explicando que as tabelas só têm o STJ e o STF", async () => {
    const r = await consultar(await conectar(await tabelaPequena()), { tribunal: "tst", tipo: "tema repetitivo", numero: 1 });
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/só têm o STJ .* e o STF/);
  });

  it("tabela com mais de 90 dias: aviso fixo de idade", async () => {
    const mcp = await conectar(await tabelaPequena(), Date.parse("2027-02-01T00:00:00Z"));
    const { dado } = await consultar(mcp, { tribunal: "stj", tipo: "IAC", numero: 1 });
    expect(dado.tabela.avisoDeIdade).toMatch(/mais de 90 dias \(115 dias, contada da data de atualização informada pela fonte/);
  });

  it("data de atualização da fonte não identificada: a idade é contada da coleta, e isso é dito", async () => {
    const tabela = { ...(await tabelaPequena()), atualizacaoDaFonte: { texto: "não informada", pagina: PAGINA_DO_CONJUNTO } };
    const mcp = await conectar(tabela, Date.parse("2027-02-01T00:00:00Z"));
    const { dado } = await consultar(mcp, { tribunal: "stj", tipo: "IAC", numero: 1 });
    expect(dado.tabela.atualizacaoInformadaPelaFonte).toBe("não informada");
    expect(dado.tabela.avisoDeIdade).toMatch(/contada da data da coleta \(2026-10-09\), porque a data de atualização/);
  });
});

describe("tabela empacotada — trava", () => {
  const t = tabelaEmpacotada();

  it("traz fonte, URL, datas, sha256 e atribuição", () => {
    expect(t.fonte.pagina).toBe(PAGINA_DO_CONJUNTO);
    expect(t.atribuicao).toBe("Fonte: STJ — Portal de Dados Abertos, conjunto Precedentes qualificados");
    expect(t.licenca.declarada).toMatch(/^Creative Commons Atribuição, conforme a página do conjunto em \d{4}-\d{2}-\d{2}$/);
    expect(t.atualizacaoDaFonte.texto).toMatch(/^(Última Atualização .+|não informada)$/);
    expect(Number.isFinite(Date.parse(t.geradaEm))).toBe(true);
    expect(t.arquivos.map((a) => a.url)).toEqual([PAGINA_DO_CONJUNTO, URL_TEMAS, URL_PROCESSOS]);
    for (const a of t.arquivos) {
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isFinite(Date.parse(a.coletadoEm))).toBe(true);
    }
  });

  it("nenhuma linha sem tipo ou número, e cada tipo + número uma vez só", () => {
    expect(t.linhas.length).toBeGreaterThan(0);
    for (const l of t.linhas) {
      expect(["tema repetitivo", "IAC"]).toContain(l.tipo);
      expect(Number.isInteger(l.numero) && l.numero > 0).toBe(true);
    }
    expect(new Set(t.linhas.map((l) => `${l.tipo} ${l.numero}`)).size).toBe(t.linhas.length);
  });
});
