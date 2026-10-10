import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  amostrarTemas,
  cortarEmPalavra,
  ehOParadigma,
  lerParadigma,
  lerTeses,
  montarRodada,
  posicaoDoParadigma,
  recusaDaRodada,
  tribunalDaTese,
  consultaDeVerificacao,
  TAMANHO_MAXIMO_DA_BUSCA,
  type TeseDoBanco,
} from "../scripts/montarRodadaDeProvas.js";
import type { LinhaDaTabela } from "../src/tabelaDePrecedentes.js";
import type { LinhaDoStf } from "../src/tabelaDoStf.js";

// Tabelas falsas: nada de processo real. Números inventados.
const stj = (numero: number, extra: Partial<LinhaDaTabela> = {}): LinhaDaTabela => ({
  tipo: "tema repetitivo",
  numero,
  situacao: "Trânsito em Julgado",
  teseFirmada: `Tese falsa do tema ${numero}.`,
  processosParadigma: [`REsp ${1000000 + numero}`],
  ...extra,
});
const stf = (numero: number, extra: Partial<LinhaDoStf> = {}): LinhaDoStf => ({
  tipo: "repercussão geral",
  numero,
  situacao: "Trânsito em Julgado",
  teseFirmada: `Tese falsa da RG ${numero}.`,
  processosParadigma: [`RE ${500000 + numero}`],
  ...extra,
});

const tabelaStj = [
  ...Array.from({ length: 20 }, (_, i) => stj(i + 1)),
  stj(101, { situacao: "Cancelado" }),
  stj(102, { situacao: "Afetado" }),
  stj(103, { processosParadigma: undefined }),
  stj(104, { processosParadigma: ["REsp 1", "REsp 2"] }),
  stj(105, { teseFirmada: undefined }),
  stj(106, { processosParadigma: ["sem número"] }),
  stj(107, { tipo: "IAC", numero: 7 }),
  { tipo: "IAC", numero: 8, situacao: "Trânsito em Julgado", teseFirmada: "IAC falso.", processosParadigma: ["EREsp 2000008"] } as LinhaDaTabela,
];
const tabelaStf = [
  ...Array.from({ length: 20 }, (_, i) => stf(i + 1)),
  stf(201, { situacao: "Em julgamento" }),
  stf(202, { tipo: "súmula" }),
];

const teses: TeseDoBanco[] = Array.from({ length: 3 }, (_, i) => ({
  numero: i + 1,
  tecnica: `técnica ${i + 1}`,
  leiga: `leiga ${i + 1}`,
  palavras: `palavras ${i + 1}`,
  tribunal: "stj",
}));

describe("paradigma: leitura e conferência", () => {
  it("lê classe e número; sem número reconhecível não é paradigma identificado", () => {
    expect(lerParadigma("REsp 1234567")).toEqual({ texto: "REsp 1234567", sigla: "REsp", numero: "1234567" });
    expect(lerParadigma("RE 559.937")).toMatchObject({ sigla: "RE", numero: "559937" });
    expect(lerParadigma("sem processo")).toBeUndefined();
    expect(lerParadigma("REsp")).toBeUndefined();
  });

  it("confere o número do acórdão do site com pontos, UF e zeros, e a classe quando o site a traz", () => {
    const p = lerParadigma("REsp 1234567")!;
    expect(ehOParadigma("REsp 1.234.567/SP", p)).toBe(true);
    expect(ehOParadigma("1234567", p)).toBe(true);
    expect(ehOParadigma("AREsp 1234567", p)).toBe(false);
    expect(ehOParadigma("REsp 1234568", p)).toBe(false);
    expect(ehOParadigma("0000123-45.2019.8.99.0000", p)).toBe(false);
  });

  it("dá a posição (1 = primeiro) ou nada", () => {
    const p = lerParadigma("RE 559937")!;
    expect(posicaoDoParadigma(["RE 1", "RE 559937", "RE 3"], p)).toBe(2);
    expect(posicaoDoParadigma(["RE 1", "RE 3"], p)).toBeUndefined();
  });
});

describe("amostra de temas", () => {
  it("é estratificada, só com tese firmada e um único paradigma legível, e repete com a mesma semente", () => {
    const a = amostrarTemas(tabelaStj, tabelaStf, { porTribunal: 5, semente: 7 });
    expect(a.filter((t) => t.tribunal === "stj")).toHaveLength(5);
    expect(a.filter((t) => t.tribunal === "stf")).toHaveLength(5);
    // Nenhum dos excluídos (cancelado, afetado, sem paradigma, vários, sem tese, ilegível, súmula, em julgamento).
    const numeros = a.map((t) => `${t.tribunal}:${t.numero}`);
    expect(numeros.some((n) => /:(10[1-6]|20[12])$/.test(n))).toBe(false);
    expect(amostrarTemas(tabelaStj, tabelaStf, { porTribunal: 5, semente: 7 })).toEqual(a);
    expect(amostrarTemas(tabelaStj, tabelaStf, { porTribunal: 5, semente: 8 })).not.toEqual(a);
  });

  it("aceita IAC no STJ e usa o que houver se a tabela tiver menos que o pedido", () => {
    const a = amostrarTemas([stj(1), { tipo: "IAC", numero: 3, situacao: "Trânsito em Julgado", teseFirmada: "x", processosParadigma: ["EREsp 9"] } as LinhaDaTabela], [], { porTribunal: 12 });
    expect(a.map((t) => t.tipo).sort()).toEqual(["IAC", "tema repetitivo"]);
  });
});

describe("consultas da rodada", () => {
  it("monta as consultas esperadas: temas, depois técnica e leiga lado a lado; 'só palavras' à parte", () => {
    const r = montarRodada(tabelaStj, tabelaStf, teses, { porTribunal: 2, semente: 1, teto: 80 });
    expect(r.principais.map((c) => c.id.replace(/^(stj|stf)-(tema|iac|rg)-\d+$/, "$1-$2-N"))).toEqual([
      expect.stringMatching(/^stj-/),
      expect.stringMatching(/^stj-/),
      expect.stringMatching(/^stf-rg-N$/),
      expect.stringMatching(/^stf-rg-N$/),
      "tese-01-tecnica",
      "tese-01-leiga",
      "tese-02-tecnica",
      "tese-02-leiga",
      "tese-03-tecnica",
      "tese-03-leiga",
    ]);
    expect(r.principais.slice(4).map((c) => c.texto)).toEqual(["técnica 1", "leiga 1", "técnica 2", "leiga 2", "técnica 3", "leiga 3"]);
    expect(r.principais.every((c) => c.limite === 100)).toBe(true);
    expect(r.palavras.map((c) => c.id).sort()).toEqual(["tese-01-palavras", "tese-02-palavras", "tese-03-palavras"]);
    expect(r.reserva).toBe(80 - 10);
    // O sorteio das teses para "só palavras" é fixo.
    expect(montarRodada(tabelaStj, tabelaStf, teses, { porTribunal: 2, semente: 1 }).palavras.map((c) => c.id)).toEqual(r.palavras.map((c) => c.id));
  });

  it("a consulta de um tema usa a tese oficial, no tribunal do tema; a verificação busca o próprio número", () => {
    const r = montarRodada([stj(5)], [stf(6)], [], { porTribunal: 1 });
    expect(r.principais).toMatchObject([
      { tribunal: "stj", texto: "Tese falsa do tema 5.", fase: "paradigma" },
      { tribunal: "stf", texto: "Tese falsa da RG 6.", fase: "paradigma" },
    ]);
    expect(consultaDeVerificacao(r.principais[0].tema!)).toMatchObject({ fase: "verificacao", tribunal: "stj", texto: "REsp 1000005", limite: 10 });
  });

  it("passar do teto é erro, e nenhuma rodada pede mais que 80 chamadas com a configuração padrão", () => {
    expect(() => montarRodada(tabelaStj, tabelaStf, teses, { porTribunal: 5, teto: 5 })).toThrow(/acima do teto/);
    const muitas = Array.from({ length: 21 }, (_, i) => ({ ...teses[0], numero: i + 1 }));
    const r = montarRodada(tabelaStj, tabelaStf, muitas, { porTribunal: 12 });
    expect(r.principais.length).toBeLessThanOrEqual(r.teto);
  });

  it("corta o texto oficial longo em palavra inteira e diz que cortou", () => {
    expect(cortarEmPalavra("curto")).toEqual({ texto: "curto", cortada: false });
    const longo = "palavra ".repeat(100);
    const c = cortarEmPalavra(longo);
    expect(c.cortada).toBe(true);
    expect(c.texto.length).toBeLessThanOrEqual(TAMANHO_MAXIMO_DA_BUSCA);
    expect(c.texto.endsWith("palavra")).toBe(true);
  });
});

describe("teses do banco de provas (documento)", () => {
  it("lê as 21 teses com técnica, leiga e só palavras, e escolhe um tribunal que o site cobre", () => {
    const md = readFileSync(new URL("../docs/banco-de-provas/teses-propostas.md", import.meta.url), "utf8");
    const lidas = lerTeses(md);
    expect(lidas).toHaveLength(21);
    expect(lidas.every((t) => t.tecnica && t.leiga && t.palavras)).toBe(true);
    expect(lidas.find((t) => t.numero === 18)?.tribunal).toBe("tse");
    expect(lidas.find((t) => t.numero === 15)?.tribunal).toBe("tst");
    expect(lidas.find((t) => t.numero === 4)?.tribunal).toBe("stf");
    expect(lidas.find((t) => t.numero === 1)?.tribunal).toBe("stj");
    expect(lidas.find((t) => t.numero === 11)?.tecnica).toContain("propter rem");
    expect(lidas.find((t) => t.numero === 11)?.tecnica).not.toContain("*");
  });

  it("tabela falsa de teses: faltar a versão leiga é erro", () => {
    const md = "| # | Área | Tese | Tribunais |\n|---|---|---|---|\n| 1 | A | Tese um | STJ, TJs |\n\n## Versão leiga\n\n| # | L | P |\n|---|---|---|\n";
    expect(() => lerTeses(md)).toThrow(/tese 1 não tem versão leiga/);
  });

  it("escolhe STJ antes dos demais; sem nenhum dos quatro, STJ", () => {
    expect(tribunalDaTese("STF, STJ, TJs")).toBe("stj");
    expect(tribunalDaTese("TJs")).toBe("stj");
    expect(tribunalDaTese("STF, TST, TRTs")).toBe("tst");
  });
});

describe("trava da rodada ao vivo (sem rede, sem executar o fetch)", () => {
  const nada = () => false;
  it("sem --saida ou sem --ao-vivo recusa", () => {
    expect(recusaDaRodada({ aoVivo: true }, nada)).toMatch(/--saida/);
    expect(recusaDaRodada({ saida: "p", aoVivo: false }, nada)).toMatch(/--ao-vivo/);
  });
  it("pasta com plano.json (rodada interrompida antes do fim) ou gravacao/ recusa, mesmo sem estado.json", () => {
    expect(recusaDaRodada({ saida: "p", aoVivo: true }, (c) => c === "plano.json")).toMatch(/uma vez só/);
    expect(recusaDaRodada({ saida: "p", aoVivo: true }, (c) => c === "gravacao")).toMatch(/uma vez só/);
  });
  it("pasta explícita, --ao-vivo e pasta virgem: pode rodar", () => {
    expect(recusaDaRodada({ saida: "p", aoVivo: true }, nada)).toBeUndefined();
  });
});
