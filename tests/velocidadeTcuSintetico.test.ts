import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPOSICAO_TCU, CONSULTAS_TCU, gerarAnoTcu, gravarTcuSintetico } from "../scripts/tcuSintetico.js";
import { lerRegistrosTcu } from "../src/tcu.js";
import { pesquisarTcu } from "../src/tcuLocal.js";
import { COLUNAS_TCU } from "./apoioTcu.js";

/** Composição pequena para o teste: as mesmas frações da padrão, com menos registros e textos curtos. */
const PEQUENA = {
  ...COMPOSICAO_TCU,
  anos: [2024, 2025],
  registrosPorAno: 400,
  tamanho: { ...COMPOSICAO_TCU.tamanho, comum: { medianaBytes: 6_000, sigma: 0.9 }, relacao: { medianaBytes: 1_500, sigma: 0.5 } },
};

async function registros(csv: string) {
  const lidos = [];
  for await (const r of lerRegistrosTcu([csv])) lidos.push(r);
  return lidos;
}

describe("TCU sintético da bateria de velocidade: composição declarada e conferida", () => {
  it("é determinístico: mesma composição, mesmo arquivo (mesmo sha256)", () => {
    const a = gerarAnoTcu(2025, PEQUENA);
    const b = gerarAnoTcu(2025, PEQUENA);
    expect(a.resumo.sha256).toBe(b.resumo.sha256);
    expect(gerarAnoTcu(2024, PEQUENA).resumo.sha256).not.toBe(a.resumo.sha256);
  });

  it("o leitor do Garimpo lê todos os registros, com as 33 colunas reais e as frações declaradas", async () => {
    const { csv, resumo } = gerarAnoTcu(2025, PEQUENA);
    expect(csv.split("\n", 1)[0].split("|").map((c) => c.replaceAll('"', ""))).toEqual([...COLUNAS_TCU]);
    const lidos = await registros(csv);
    expect(lidos).toHaveLength(PEQUENA.registrosPorAno);
    expect(resumo.registros).toBe(PEQUENA.registrosPorAno);

    const conta = (f: (r: Record<string, string>) => boolean) => lidos.filter(f).length;
    expect(conta((r) => r.TIPO === "ACÓRDÃO DE RELAÇÃO")).toBe(resumo.porTipo["ACÓRDÃO DE RELAÇÃO"]);
    expect(resumo.porTipo["ACÓRDÃO DE RELAÇÃO"] / resumo.registros).toBeCloseTo(PEQUENA.fracaoRelacao, 1);
    // Situações raras: a fração real arredondada, com pelo menos 1 por ano.
    expect(conta((r) => r.SITUACAO === "INVALIDADO")).toBe(resumo.porSituacao.INVALIDADO);
    expect(resumo.porSituacao.INVALIDADO).toBe(Math.max(1, Math.round(PEQUENA.fracaoInvalidado * PEQUENA.registrosPorAno)));
    expect(conta((r) => r.SITUACAO === "SIGILOSO")).toBe(1);
    expect(conta((r) => /^Documento classificado como sigiloso/.test(r.RELATORIO))).toBe(resumo.avisosDeSigilo);
    expect(resumo.avisosDeSigilo).toBe(1);
    // Nada de dado pessoal real: as colunas vedadas, mesmo descartadas pelo leitor, só têm texto fictício.
    expect(csv).toContain("INTERESSADO FICTICIO");
  });

  it("registra o tamanho por registro e o vocabulário; o relatório e o voto só existem no acórdão comum", async () => {
    const { csv, resumo } = gerarAnoTcu(2025, PEQUENA);
    expect(resumo.bytes.total).toBe(Buffer.byteLength(csv));
    expect(resumo.bytes.porRegistro.p10).toBeLessThan(resumo.bytes.porRegistro.mediana);
    expect(resumo.bytes.porRegistro.mediana).toBeLessThan(resumo.bytes.porRegistro.p90);
    expect(resumo.vocabulario.palavrasDistintas).toBeGreaterThan(500);
    const lidos = await registros(csv);
    expect(lidos.filter((r) => r.TIPO === "ACÓRDÃO DE RELAÇÃO").every((r) => !r.RELATORIO && !r.VOTO)).toBe(true);
    expect(lidos.filter((r) => r.TIPO === "ACÓRDÃO" && r.SITUACAO === "OFICIALIZADO").every((r) => r.VOTO)).toBe(true);
  });

  describe("consultas da bateria, pelo próprio Garimpo, sobre o ano gravado", () => {
    let dados: string;
    let resumo: Awaited<ReturnType<typeof gravarTcuSintetico>>;
    beforeAll(async () => {
      dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-sintetico-"));
      resumo = await gravarTcuSintetico(dados, { ...PEQUENA, anos: [2025] });
    });
    afterAll(() => rm(dados, { recursive: true, force: true }));

    const total = async (nome: string) => {
      const c = CONSULTAS_TCU.find((x) => x.nome === nome)!;
      return (await pesquisarTcu(dados, { ...c.filtros, consulta: c.consulta })).total;
    };

    it("grava o arquivo anual onde o baixador deixa e devolve a composição de cada ano", () => {
      expect(resumo.anos.map((a) => a.ano)).toEqual([2025]);
      expect(resumo.composicao.registrosPorAno).toBe(PEQUENA.registrosPorAno);
    });

    it("vazia não acha nada; seletiva acha pouco; comum acha muito", async () => {
      expect(await total("vazia")).toBe(0);
      const seletiva = await total("seletiva");
      const comum = await total("comum");
      expect(seletiva).toBeGreaterThan(0);
      expect(seletiva).toBeLessThan(PEQUENA.registrosPorAno * 0.05);
      expect(comum).toBeGreaterThan(PEQUENA.registrosPorAno * 0.3);
    });

    it("sem acento acha o mesmo que com acento; entre aspas acha menos que as palavras soltas; filtros restringem", async () => {
      const semAcento = await total("semAcento");
      const comAcento = (await pesquisarTcu(dados, { consulta: "licitação sobrepreço" })).total;
      expect(semAcento).toBe(comAcento);
      expect(semAcento).toBeGreaterThan(0);
      const aspas = await total("aspas");
      const soltas = (await pesquisarTcu(dados, { consulta: "pregão eletrônico" })).total;
      expect(aspas).toBeGreaterThan(0);
      expect(aspas).toBeLessThan(soltas);
      const filtros = await total("filtros");
      expect(filtros).toBeGreaterThan(0);
      expect(filtros).toBeLessThan((await pesquisarTcu(dados, { consulta: "sobrepreço" })).total);
    });
  });
});
