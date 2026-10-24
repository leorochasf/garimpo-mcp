import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sem tipos (vai copiado para a pasta do júri)
import { idsDoLote, lerRespostas } from "../scripts/conferirVotos.mjs";
import {
  type AcordaoDaRodada,
  apurar,
  casosParaODono,
  chamadasNoMaximo,
  chaveDoAcordao,
  contarVereditos,
  type ItemDaTese,
  lerSecoes,
  lotesDoPool,
  montarPool,
  paraDesempate,
  pedidosE1,
  pedidosE5,
  sortearConferencia,
  tesesDeE2,
  tetoDaRodada,
  TESES_VIZINHAS,
  tribunaisDaRodada,
  type Veredito,
  type Voto,
} from "../scripts/linhaDeBase.js";

// Os pedidos saem dos arquivos congelados de verdade (genéricos); o resto usa acórdãos inventados (tribunal 99).
const teses = readFileSync("docs/banco-de-provas/teses-propostas.md", "utf8");
const amostra = JSON.parse(readFileSync("docs/banco-de-provas/amostra-1.2.json", "utf8"));

describe("pedidos da linha de base", () => {
  const e1 = pedidosE1(teses, amostra.estratos.E1.teses);
  const e5 = pedidosE5(teses, amostra.estratos.E5);

  it("E1: 21 teses × técnica e leiga; técnica com as 3 formulações do documento, leiga com a versão leiga e o só palavras", () => {
    expect(e1).toHaveLength(42);
    expect(new Set(e1.map((p) => p.id)).size).toBe(42);
    const secoes = new Map(lerSecoes(teses).map((s) => [s.numero, s]));
    for (const p of e1) {
      expect(p.formulacoes.length).toBe(p.versao === "tecnica" ? 3 : 2);
      if (p.versao === "tecnica") expect(p.formulacoes).toEqual(secoes.get(p.tese as number)!.formulacoes);
      for (const f of p.formulacoes) expect(f.length).toBeLessThanOrEqual(300);
    }
  });

  it("tribunais de E1 pela coluna do documento, no máximo 5, sem TRT nem TRF", () => {
    expect(tribunaisDaRodada("STF, STJ, TJs")).toEqual(["stf", "stj", "tjsp", "tjmg", "tjrs"]);
    expect(tribunaisDaRodada("STJ, STF, TJs")).toEqual(["stf", "stj", "tjsp", "tjmg", "tjrs"]);
    expect(tribunaisDaRodada("STF, STJ, TJs, TRFs")).toEqual(["stf", "stj", "tjsp", "tjmg", "tjrs"]);
    expect(tribunaisDaRodada("STJ, TJs")).toEqual(["stj", "tjsp", "tjmg", "tjrs"]);
    expect(tribunaisDaRodada("STF, TST, TRTs")).toEqual(["stf", "tst"]);
    expect(tribunaisDaRodada("TSE (TREs fora da cobertura atual)")).toEqual(["tse"]);
    expect(() => tribunaisDaRodada("TRTs")).toThrow(/nenhum tribunal/);
  });

  it("E5: 5 TRTs fria, quente e renovar num grupo; cada tese fria e quente no seu grupo, com a contrária em 2º lugar", () => {
    expect(e5.map((p) => p.id)).toEqual([
      "e5-5trts-fria", "e5-5trts-quente", "e5-5trts-renovar",
      "e5-t15-fria", "e5-t15-quente", "e5-T01-fria", "e5-T01-quente", "e5-T02-fria", "e5-T02-quente",
    ]);
    const caso = e5.filter((p) => p.grupo === "e5-5trts");
    expect(new Set(caso.map((p) => JSON.stringify([p.formulacoes, p.tribunais]))).size).toBe(1);
    expect(caso[0].tribunais).toEqual(["trt1", "trt2", "trt3", "trt4", "trt15"]);
    const t01 = e5.find((p) => p.id === "e5-T01-fria")!;
    expect(t01.formulacoes).toEqual([amostra.estratos.E5.tesesNovas[0].tecnica, amostra.estratos.E5.tesesNovas[0].contraria]);
  });

  it("teto: o máximo de cada pedido (Falcão com 5 páginas por chamada) mais a margem", () => {
    expect(chamadasNoMaximo(e1[0])).toBe(15);
    expect(chamadasNoMaximo(e5[0])).toBe(5);
    expect(chamadasNoMaximo(e5[3])).toBe(6);
    expect(e1.reduce((s, p) => s + chamadasNoMaximo(p), 0)).toBe(450);
    expect(tetoDaRodada([...e1, ...e5])).toBe(511);
  });

  it("amostra que muda a rodada do caso de 5 TRTs é recusada", () => {
    expect(() => pedidosE5(teses, { ...amostra.estratos.E5, cincoTrts: { ...amostra.estratos.E5.cincoTrts, rodadas: ["morna"] } })).toThrow(/morna/);
  });
});

const acordao = (tribunal: string, seq: number, extra: Partial<AcordaoDaRodada> = {}): AcordaoDaRodada => ({
  id: `${tribunal}:${seq}`,
  tribunal,
  numero: `${String(seq).padStart(7, "0")}-11.2020.8.99.0000`,
  dataJulgamento: "2024-01-15",
  ementa: `EMENTA FICTÍCIA ${seq}.`,
  ...extra,
});

describe("chaveDoAcordao (como no 2º duelo)", () => {
  it("CNJ vira só os dígitos, com tribunal e data; a pontuação não importa", () => {
    expect(chaveDoAcordao(acordao("stj", 12))).toBe("stj|00000121120208990000|2024-01-15");
    expect(chaveDoAcordao(acordao("stj", 12, { numero: "00000121120208990000" }))).toBe(chaveDoAcordao(acordao("stj", 12)));
  });

  it("sem CNJ: o maior grupo numérico; mesmo processo em outra data é outro acórdão", () => {
    const a = acordao("stj", 1, { numero: "AgInt no REsp 1.234.567/SP" });
    expect(chaveDoAcordao(a)).toBe("stj|1234567|2024-01-15");
    expect(chaveDoAcordao({ ...a, dataJulgamento: "2024-02-01" })).not.toBe(chaveDoAcordao(a));
  });

  it("sem número: o começo da ementa normalizada", () => {
    expect(chaveDoAcordao({ id: "tst:1", tribunal: "tst", numero: "", ementa: "Ementa: Recurso Fictício." })).toBe("tst|em:recurso ficticio");
  });
});

/** 4 teses, 18 acórdãos cada; a tese 2 tem um acórdão sem ementa (não pode virar controle). */
function porTese(): Map<number, ItemDaTese[]> {
  const m = new Map<number, ItemDaTese[]>();
  for (const n of [1, 2, 7, 16]) {
    m.set(
      n,
      Array.from({ length: 18 }, (_, k) => {
        const a = acordao("stj", n * 100 + k, n === 2 && k === 0 ? { ementa: "" } : {});
        return { chave: chaveDoAcordao(a), acordao: a, pedidos: [`e1-t${String(n).padStart(2, "0")}-${k % 2 ? "leiga" : "tecnica"}`] };
      }),
    );
  }
  return m;
}

describe("montarPool (pool cego com controles negativos)", () => {
  const pool = montarPool(porTese(), { semente: 20261023 });
  const controles = pool.reservado.filter((l) => l.controleDaTese !== undefined);

  it("cerca de 10% de controles (reais ÷ 9), cada um sob outra tese, nunca vizinha nem com o mesmo acórdão, sempre com ementa", () => {
    expect(controles).toHaveLength(Math.round(72 / 9));
    const vizinha = (a: number, b: number) => TESES_VIZINHAS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    for (const c of controles) {
      expect(c.tese).not.toBe(c.controleDaTese);
      expect(vizinha(c.tese, c.controleDaTese!)).toBe(false);
      expect(c.pedidos).toEqual([]);
      expect(pool.linhas.find((l) => l.id === c.id)!.ementa).not.toBe("");
      const daTese = pool.reservado.filter((l) => l.tese === c.tese && l.controleDaTese === undefined);
      expect(daTese.some((l) => l.chave === c.chave)).toBe(false);
    }
  });

  it("a linha do júri não diz de onde veio; ids em ordem; mesma semente, mesmo pool; outra semente, outra ordem", () => {
    expect(Object.keys(pool.linhas[0]).sort()).toEqual(["data", "ementa", "id", "numero", "orgao", "tese", "tribunal"]);
    expect(pool.linhas.map((l) => l.id)).toEqual(pool.linhas.map((_, i) => `J-${String(i + 1).padStart(4, "0")}`));
    expect(montarPool(porTese(), { semente: 20261023 })).toEqual(pool);
    expect(montarPool(porTese(), { semente: 1 }).reservado.map((l) => l.chave)).not.toEqual(pool.reservado.map((l) => l.chave));
  });

  it("conferência do dono: 20 linhas reais (nunca controle), sorteadas com a semente e sempre as mesmas", () => {
    const sorteadas = sortearConferencia(pool.reservado, { semente: 20261023 });
    expect(sorteadas).toHaveLength(20);
    expect(new Set(sorteadas).size).toBe(20);
    for (const id of sorteadas) expect(pool.reservado.find((l) => l.id === id)!.controleDaTese).toBeUndefined();
    expect(sortearConferencia(pool.reservado, { semente: 20261023 })).toEqual(sorteadas);
  });

  it("lotes de até 25, nunca misturando teses, cobrindo o pool inteiro na ordem", () => {
    const lotes = lotesDoPool(pool.linhas);
    for (const lote of lotes) {
      expect(lote.length).toBeLessThanOrEqual(25);
      expect(new Set(lote.map((l) => l.tese)).size).toBe(1);
    }
    expect(lotes.flat()).toEqual(pool.linhas);
  });
});

const votos = (pares: [string, Voto["letra"]][]) => new Map(pares.map(([id, letra]) => [id, { id, letra, motivo: "motivo" }]));

describe("apuração", () => {
  it("concordância vira veredito; divergência vai ao desempate; três letras diferentes = sem maioria", () => {
    const a = votos([["J-0001", "S"], ["J-0002", "S"], ["J-0003", "P"], ["J-0004", "C"]]);
    const b = votos([["J-0001", "S"], ["J-0002", "P"], ["J-0003", "N"], ["J-0004", "N"]]);
    expect(paraDesempate(a, b)).toEqual(["J-0002", "J-0003", "J-0004"]);
    const c = votos([["J-0002", "P"], ["J-0003", "S"], ["J-0004", "C"]]);
    expect(Object.fromEntries(apurar(["J-0001", "J-0002", "J-0003", "J-0004"], a, b, c))).toEqual({
      "J-0001": "S",
      "J-0002": "P",
      "J-0003": "sem maioria",
      "J-0004": "C",
    });
    expect(() => apurar(["J-0009"], a, b)).toThrow(/J-0009/);
  });

  it("conta por pedido e por tese sem os controles; controle que não sai N é falho; E2 e os casos do dono", () => {
    const reservado = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `J-${String(i + 1).padStart(4, "0")}`, tese: 1, chave: `k${i}`, pedidos: ["e1-t01-tecnica"] })),
      { id: "J-0031", tese: 1, chave: "x", pedidos: [], controleDaTese: 16 },
      { id: "J-0032", tese: 2, chave: "y", pedidos: ["e1-t02-tecnica"] },
    ];
    const vereditos = new Map(reservado.map((l, i) => [l.id, i < 26 ? "S" : i < 30 ? "P" : "N"] as [string, Veredito]));
    vereditos.set("J-0031", "P");
    vereditos.set("J-0032", "C");
    const apuracao = contarVereditos(reservado, vereditos);
    expect(apuracao.porPedido.get("e1-t01-tecnica")).toEqual({ S: 26, P: 4, C: 0, N: 0, semMaioria: 0 });
    expect(apuracao.controles).toEqual({ total: 1, julgadosN: 0, falhos: ["J-0031"] });
    const pedidos = pedidosE1(teses, [1, 2]);
    expect(tesesDeE2(pedidos, new Map([["e1-t01-tecnica", 30], ["e1-t02-tecnica", 50]]), apuracao)).toEqual([1]);
    expect(tesesDeE2(pedidos, new Map([["e1-t01-tecnica", 29]]), apuracao)).toEqual([]);
    const casos = casosParaODono(apuracao, reservado, vereditos, 1);
    expect(casos).toEqual({ casos: [{ id: "J-0031", motivo: "controle negativo que o júri não julgou N" }], excedeu: true, total: 2 });
  });
});

describe("conferirVotos.mjs (o que o jurado roda e a apuração lê)", () => {
  it("lê os ids do lote e as respostas, apontando o que falta sem repetir o motivo do jurado", () => {
    expect(idsDoLote("# Lote\n\n## J-0001\n\ntexto\n## J-0002\n")).toEqual(["J-0001", "J-0002"]);
    const { votos: lidos, problemas } = lerRespostas(
      "﻿id;resposta;motivo\nJ-0001;s;ratio aplica a tese\nJ-0002;X;segredo do jurado\nJ-0003;N;\nJ-0001;P;de novo\nlixo",
    );
    expect([...lidos.keys()]).toEqual(["J-0001"]);
    expect(lidos.get("J-0001").letra).toBe("S");
    expect(problemas).toHaveLength(4);
    expect(problemas.join("\n")).not.toContain("segredo");
  });
});
