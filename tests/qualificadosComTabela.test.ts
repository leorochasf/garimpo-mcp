import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { type TabelaDePrecedentes, tabelaEmpacotada } from "../src/tabelaDePrecedentes.js";
import { gerarTabela, PAGINA_DO_CONJUNTO, URL_PROCESSOS, URL_TEMAS } from "../scripts/gerarTabela.js";
import { respostaJson } from "./apoio.js";

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

/** Site falso que responde a toda busca com o mesmo corpo. */
function siteQueResponde(corpo: unknown | ((tribunal: string) => unknown)) {
  return new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string) => {
      const tribunal = String(url).match(/tribunais\/(\w+)\/search/)![1];
      return respostaJson(typeof corpo === "function" ? corpo(tribunal) : corpo);
    }) as typeof fetch,
  });
}

async function conectar(site: Cliente, tabela?: TabelaDePrecedentes) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
  await criarServidor(site, { dados, tabela, agora: () => HOJE }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return JSON.parse(r.content[0].text);
}

async function qualificadosDaDireta(corpo: unknown, tabela?: TabelaDePrecedentes) {
  const mcp = await conectar(siteQueResponde({ results: [], ...(corpo as object) }), tabela ?? (await tabelaPequena()));
  return chamar(mcp, "busca_direta", { tribunal: "stj", texto: "exemplo" });
}

const DATA = "tabela de precedentes do STJ de 2026-10-09";

describe("listas de qualificados com a tabela de precedentes", () => {
  it("casou com a mesma tese no site e na tabela: III, situação na fonte com data, sem nota de divergência", async () => {
    const tese = (await tabelaPequena()).linhas.find((l) => l.tipo === "tema repetitivo" && l.numero === 1)!.teseFirmada!;
    const r = await qualificadosDaDireta({ repetitivos: [{ id: "1", numero: 1, tese_firmada: `  ${tese}\r\n` }] });
    expect(r.qualificados[0].enquadramento927).toMatchObject({
      inciso: "III",
      evidencia: "lista de tema repetitivo do site (STJ), tema repetitivo nº 1, com tese informada",
      avisoSituacao: `situação na fonte: "Trânsito em Julgado" (${DATA}); é a situação processual, não a vigência: conferir antes de citar`,
      notas: [],
    });
    expect(r.tabelaDePrecedentes).toMatchObject({
      atribuicao: "Fonte: STJ — Portal de Dados Abertos, conjunto Precedentes qualificados",
      dataDaColeta: "2026-10-09",
      atualizacaoInformadaPelaFonte: "Última Atualização outubro 8, 2026, 17:25 (UTC)",
    });
    expect(r.tabelaDePrecedentes.licencaDosDados).toMatch(/^Creative Commons Atribuição/);
  });

  it("sem tese no site e com tese firmada na tabela: III, com a evidência da tabela", async () => {
    const r = await qualificadosDaDireta({ iacs: [{ id: "2", numero: 1, descricao_tese: "Questão fictícia." }] });
    expect(r.qualificados[0].enquadramento927).toMatchObject({
      inciso: "III",
      evidencia: `lista de IAC do site (STJ), IAC nº 1; tese firmada na ${DATA}`,
    });
  });

  it("sem tese no site nem na tabela: continua não classificado, com a situação na fonte", async () => {
    const r = await qualificadosDaDireta({ repetitivos: [{ id: "3", numero: 978 }] });
    expect(r.qualificados[0].enquadramento927).toMatchObject({
      inciso: "não classificado",
      motivo: `tema repetitivo do STJ sem tese firmada informada pelo site nem na ${DATA}`,
      avisoSituacao: `situação na fonte: "Afetado" (${DATA}); é a situação processual, não a vigência: conferir antes de citar`,
    });
  });

  it.each([
    [56, "Cancelado"],
    [126, "Revisado"],
  ])("tema %i (%s): nota \"a fonte indica\" sem mudar o inciso", async (numero, situacao) => {
    const linha = (await tabelaPequena()).linhas.find((l) => l.tipo === "tema repetitivo" && l.numero === numero)!;
    const r = await qualificadosDaDireta({ repetitivos: [{ id: "4", numero, tese_firmada: linha.teseFirmada }] });
    const e = r.qualificados[0].enquadramento927;
    expect(e.inciso).toBe(linha.teseFirmada ? "III" : "não classificado");
    expect(e.notas).toEqual([`a fonte indica "${situacao}" (${DATA}); o inciso descreve o tipo do precedente, não a vigência`]);
  });

  it("tese do site diferente da tabela: aviso com a tese da tabela, sem dizer qual vale hoje", async () => {
    const tabela = await tabelaPequena();
    const daTabela = tabela.linhas.find((l) => l.tipo === "IAC" && l.numero === 1)!.teseFirmada!;
    const r = await qualificadosDaDireta({ iacs: [{ id: "5", numero: 1, tese_firmada: "Tese fictícia diferente." }] }, tabela);
    const e = r.qualificados[0].enquadramento927;
    expect(e.inciso).toBe("III");
    expect(e.notas).toEqual([
      `a tese informada pelo site difere da tese firmada na ${DATA}, que é o texto da fonte oficial naquela data ` +
        `(o Garimpo não afirma qual vale hoje): "${daTabela}"`,
    ]);
  });

  it("não consta na tabela: regra de hoje, com \"não consta na tabela de <data>\"", async () => {
    const r = await qualificadosDaDireta({ repetitivos: [{ id: "6", numero: 2002, tese_firmada: "Tese fictícia." }] });
    expect(r.qualificados[0].enquadramento927).toMatchObject({
      inciso: "III",
      evidencia: "lista de tema repetitivo do site (STJ), tema repetitivo nº 2002, com tese informada",
      avisoSituacao: `situação do tema repetitivo não verificada: não consta na ${DATA}; conferir antes de citar`,
      notas: [`não consta na ${DATA}`],
    });
    expect(r.tabelaDePrecedentes.dataDaColeta).toBe("2026-10-09");
  });

  it("súmula do STJ e tema de outro tribunal ficam intocados, sem o campo da tabela", async () => {
    const tabela = await tabelaPequena();
    const sumula = await qualificadosDaDireta({ sumulas: [{ id: "7", numero: 1, enunciado: "Enunciado fictício." }] }, tabela);
    expect(sumula.qualificados[0].enquadramento927.motivo).toBe(
      "súmula do STJ: o inciso IV exige matéria infraconstitucional, que os dados não informam",
    );
    expect(sumula.tabelaDePrecedentes).toBeUndefined();

    const mcp = await conectar(siteQueResponde({ results: [], repetitivos: [{ id: "8", numero: 1, tese_firmada: "Tese fictícia." }] }), tabela);
    const tjgo = await chamar(mcp, "busca_direta", { tribunal: "tjgo", texto: "exemplo" });
    expect(tjgo.qualificados[0].enquadramento927).toMatchObject({ inciso: "não classificado", notas: [] });
    expect(tjgo.tabelaDePrecedentes).toBeUndefined();
  });

  it("sem tabela no servidor, o comportamento é o de hoje", async () => {
    const mcp = await conectar(siteQueResponde({ results: [], repetitivos: [{ id: "9", numero: 1, tese_firmada: "Tese fictícia." }] }));
    const r = await chamar(mcp, "busca_direta", { tribunal: "stj", texto: "exemplo" });
    expect(r.qualificados[0].enquadramento927.avisoSituacao).toBe(
      "situação do tema repetitivo (julgamento concluído, revisão, superação) não verificada: conferir antes de citar",
    );
    expect(r.tabelaDePrecedentes).toBeUndefined();
  });

  it("busca ampla: forma curta com a situação curta e a data; não consta também aparece", async () => {
    const mcp = await conectar(
      siteQueResponde({
        results: [],
        repetitivos: [
          { id: "a", numero: 978 },
          { id: "b", numero: 56, tese_firmada: "Tese fictícia." },
          { id: "c", numero: 2002, tese_firmada: "Tese fictícia." },
        ],
        iacs: [{ id: "d", numero: 1 }],
      }),
      await tabelaPequena(),
    );
    const r = await chamar(mcp, "busca_ampla", { formulacoes: ["exemplo"], tribunais: ["stj"] });
    const curto = Object.fromEntries(r.qualificados.map((q: { tipo: string; numero: string; enquadramento927: string }) => [`${q.tipo} ${q.numero}`, q.enquadramento927]));
    expect(curto).toEqual({
      "tema repetitivo 978": "não classificado: tema repetitivo sem tese no site nem na tabela",
      "tema repetitivo 56": "art. 927, III; situação na fonte em 2026-10-09: Cancelado",
      "tema repetitivo 2002": "art. 927, III; não consta na tabela de 2026-10-09: conferir antes de citar",
      "IAC 1": "art. 927, III; situação na fonte em 2026-10-09: Trânsito em Julgado",
    });
    expect(r.tabelaDePrecedentes.atribuicao).toMatch(/Precedentes qualificados/);
  });

  it("busca ampla com campos de tamanho realista e 10 temas casados na tabela empacotada: < 25 mil caracteres", async () => {
    const link = (i: number) => `https://jurisprudencia.tribunal-exemplo.invalid/consulta/inteiro-teor/documento?id=${String(i).padStart(10, "0")}`;
    const acordao = (tribunal: string, i: number) => ({
      id: `${tribunal}a${String(i).padStart(9, "0")}`,
      texto_ementa:
        `EMENTA: APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO ${tribunal}-${i}. ${"Texto fictício de ementa. ".repeat(75)}` +
        `DANO MORAL COLETIVO RECONHECIDO. ${"Texto fictício de ementa. ".repeat(75)}`,
      sigla_classe: "ApCiv",
      numero_processo: `50${String(i).padStart(5, "0")}-11.2024.8.21.0001`,
      orgao_julgador: "Décima Segunda Câmara Cível",
      data_julgamento: "2024-01-02T00:00:00.000Z",
      link_pdf: link(i),
    });
    // Situações longas da tabela real ("Acórdão Publicado - RE Pendente") e temas sem tese no site.
    const tabela = tabelaEmpacotada();
    const temas = tabela.linhas
      .filter((l) => l.tipo === "tema repetitivo")
      .sort((a, b) => (b.situacao?.length ?? 0) - (a.situacao?.length ?? 0))
      .slice(0, 12)
      .map((l, i) => ({
        id: `t${i}`,
        numero: l.numero,
        tese_firmada: i % 2 ? "Tese fictícia de tema repetitivo, longa como as reais. ".repeat(80) : undefined,
        orgao_julgador: "PRIMEIRA SEÇÃO",
        numero_processo_paradigma: `REsp ${1_000_000 + i}`,
        link: link(900 + i),
      }));
    const mcp = await conectar(
      siteQueResponde((tribunal: string) => ({
        results: Array.from({ length: 100 }, (_, i) => acordao(tribunal, i)),
        ...(tribunal === "stj" ? { repetitivos: temas } : {}),
      })),
      tabela,
    );
    const r = await mcp.callTool({
      name: "busca_ampla",
      arguments: { formulacoes: ["dano moral coletivo", "dano moral difuso", "dano moral transindividual"], tribunais: ["tjrs", "stj"] },
    });
    const texto = (r.content as { text: string }[])[0].text;
    const dado = JSON.parse(texto);
    expect(dado.acordaos).toHaveLength(50);
    expect(dado.qualificados).toHaveLength(10);
    expect(dado.qualificados.every((q: { enquadramento927: string }) => /situação na fonte em 2026-\d\d-\d\d: /.test(q.enquadramento927) || /sem tese no site nem na tabela/.test(q.enquadramento927))).toBe(true);
    expect(dado.tabelaDePrecedentes).toBeDefined();
    expect(texto.length).toBeLessThan(25_000);
  });
});
