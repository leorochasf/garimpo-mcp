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
  listaUnificada,
  lotesDoPool,
  medirPedido,
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
  vereditosNaOrdem,
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

describe("chaveDoAcordao (identidade canônica: na dúvida, não funde)", () => {
  it("CNJ vira só os dígitos, com tribunal e data; a pontuação não importa", () => {
    expect(chaveDoAcordao(acordao("stj", 12))).toContain("00000121120208990000");
    expect(chaveDoAcordao(acordao("stj", 12, { numero: "00000121120208990000" }))).toBe(chaveDoAcordao(acordao("stj", 12)));
    expect(chaveDoAcordao(acordao("stj", 12, { numero: "", numeroCnj: "0000012-11.2020.8.99.0000" }))).toBe(chaveDoAcordao(acordao("stj", 12)));
  });

  it("sem CNJ: classe e número, sem pontuação nem UF; mesmo processo em outra data é outro acórdão", () => {
    const a = acordao("stj", 1, { numero: "REsp 1.234.567/SP" });
    expect(chaveDoAcordao({ ...a, numero: "REsp 1234567" })).toBe(chaveDoAcordao(a));
    expect(chaveDoAcordao({ ...a, dataJulgamento: "2024-02-01" })).not.toBe(chaveDoAcordao(a));
  });

  it("B02-R01: classes diferentes com o mesmo número e a mesma data são acórdãos diferentes", () => {
    const resp = acordao("stj", 1, { numero: "REsp 1.000.002/SP" });
    expect(chaveDoAcordao({ ...resp, numero: "AREsp 1.000.002/SP" })).not.toBe(chaveDoAcordao(resp));
    expect(chaveDoAcordao({ ...resp, numero: "AgInt no REsp 1.000.002/SP" })).not.toBe(chaveDoAcordao(resp));
    expect(chaveDoAcordao({ ...resp, classe: "Recurso Especial" })).not.toBe(chaveDoAcordao({ ...resp, classe: "Agravo em Recurso Especial" }));
  });

  it("B02-R01: recursos diferentes do mesmo processo (mesmo CNJ) julgados no mesmo dia não se fundem", () => {
    const apelacao = acordao("tjsp", 7, { classe: "Apelação Cível" });
    expect(chaveDoAcordao({ ...apelacao, classe: "Embargos de Declaração Cível" })).not.toBe(chaveDoAcordao(apelacao));
    const comCnj = acordao("stj", 7, { numeroCnj: "0000007-11.2020.8.99.0000", numero: "REsp 1.000.003/SP" });
    expect(chaveDoAcordao({ ...comCnj, numero: "EDcl no REsp 1.000.003/SP" })).not.toBe(chaveDoAcordao(comCnj));
  });

  it("sem número: o começo da ementa normalizada; sem número nem ementa, o id (nunca uma chave vazia comum)", () => {
    expect(chaveDoAcordao({ id: "tst:1", tribunal: "tst", numero: "", ementa: "Ementa: Recurso Fictício." })).toBe("tst|em:recurso ficticio");
    expect(chaveDoAcordao({ id: "tst:1", tribunal: "tst", numero: "" })).not.toBe(chaveDoAcordao({ id: "tst:2", tribunal: "tst", numero: "" }));
  });
});

describe("listaUnificada (o montador do júri: uma linha por acórdão, a união dos braços)", () => {
  const resp = acordao("stj", 1, { id: "stj:1", numero: "REsp 1.000.002/SP", ementa: "EMENTA FICTÍCIA DO RECURSO ESPECIAL." });
  const aresp = acordao("stj", 2, { id: "stj:2", numero: "AREsp 1.000.002/SP", ementa: "EMENTA FICTÍCIA DO AGRAVO." });
  const item = (a: AcordaoDaRodada) => ({ id: a.id, numero: a.numero, tribunal: a.tribunal, data: a.dataJulgamento });
  const resultado = (id: string, acordaos: AcordaoDaRodada[], extra = {}) => ({ id, estrato: "E1", tese: 1, mostrados: acordaos.length, acordaos: acordaos.map(item), ...extra });

  it("B02-R01: REsp e AREsp de mesmo número e data, do mesmo tribunal, são duas linhas, cada uma com o seu pedido e a sua ementa", () => {
    const lista = listaUnificada([
      { braco: "cc956b4", resultados: [resultado("e1-t01-tecnica", [resp]), resultado("e1-t01-leiga", [aresp])], ementas: { "stj:1": resp, "stj:2": aresp } },
    ]).get(1)!;
    expect(lista).toHaveLength(2);
    expect(lista.map((i) => [i.acordao.numero, i.acordao.ementa, i.pedidos])).toEqual([
      ["REsp 1.000.002/SP", "EMENTA FICTÍCIA DO RECURSO ESPECIAL.", ["cc956b4/e1-t01-tecnica"]],
      ["AREsp 1.000.002/SP", "EMENTA FICTÍCIA DO AGRAVO.", ["cc956b4/e1-t01-leiga"]],
    ]);
  });

  it("o mesmo acórdão por dois braços é uma linha com os dois pedidos; pedido com erro fica fora; sem ementa, o que a lista trouxe", () => {
    const lista = listaUnificada([
      { braco: "cc956b4", resultados: [resultado("e1-t01-tecnica", [resp]), resultado("e1-t01-leiga", [aresp], { erro: "Error: falhou" })], ementas: { "stj:1": resp } },
      { braco: "abc1234", resultados: [resultado("e1-t01-tecnica", [resp, aresp])], ementas: { "stj:1": resp, "stj:2": { ...aresp, erro: "falhou" } } },
    ]).get(1)!;
    expect(lista.map((i) => i.pedidos)).toEqual([["cc956b4/e1-t01-tecnica", "abc1234/e1-t01-tecnica"], ["abc1234/e1-t01-tecnica"]]);
    expect(lista[1].acordao).toMatchObject({ numero: "AREsp 1.000.002/SP", ementa: "" });
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
      ...Array.from({ length: 30 }, (_, i) => ({ id: `J-${String(i + 1).padStart(4, "0")}`, tese: 1, chave: `k${i}`, pedidos: ["cc956b4/e1-t01-tecnica"] })),
      { id: "J-0031", tese: 1, chave: "x", pedidos: [], controleDaTese: 16 },
      { id: "J-0032", tese: 2, chave: "y", pedidos: ["cc956b4/e1-t02-tecnica"] },
    ];
    const vereditos = new Map(reservado.map((l, i) => [l.id, i < 26 ? "S" : i < 30 ? "P" : "N"] as [string, Veredito]));
    vereditos.set("J-0031", "P");
    vereditos.set("J-0032", "C");
    const apuracao = contarVereditos(reservado, vereditos);
    expect(apuracao.porPedido.get("cc956b4/e1-t01-tecnica")).toEqual({ S: 26, P: 4, C: 0, N: 0, semMaioria: 0 });
    expect(apuracao.controles).toEqual({ total: 1, julgadosN: 0, falhos: ["J-0031"] });
    const pedidos = pedidosE1(teses, [1, 2]);
    expect(tesesDeE2("cc956b4", pedidos, new Map([["e1-t01-tecnica", 30], ["e1-t02-tecnica", 50]]), apuracao)).toEqual([1]);
    expect(tesesDeE2("cc956b4", pedidos, new Map([["e1-t01-tecnica", 29]]), apuracao)).toEqual([]);
    expect(tesesDeE2("abc1234", pedidos, new Map([["e1-t01-tecnica", 30]]), apuracao)).toEqual([]);
    const casos = casosParaODono(apuracao, reservado, vereditos, 1);
    expect(casos).toEqual({ casos: [{ id: "J-0031", motivo: "controle negativo que o júri não julgou N" }], excedeu: true, total: 2 });
  });
});

describe("B02-R04: medidas do pedido (precisão nos 10 primeiros, cobertura relativa, limites do sem maioria)", () => {
  const S10N10: Veredito[] = [...Array(10).fill("S"), ...Array(10).fill("N")];
  const zero = { S: 0, P: 0, C: 0, N: 0, semMaioria: 0 };

  it("20 entregues, 10 S e 10 N: com os S no topo, 100% nos 10 primeiros; com os S no fim, 0% — a lista toda dá 50% nos dois", () => {
    const topo = medirPedido(S10N10, zero, zero);
    const fim = medirPedido([...S10N10].reverse(), zero, zero);
    expect(topo.precisao.amplaNosDez).toEqual({ pessimista: 1, otimista: 1 });
    expect(fim.precisao.amplaNosDez).toEqual({ pessimista: 0, otimista: 0 });
    expect(topo.precisao.ampla).toEqual({ pessimista: 0.5, otimista: 0.5 });
    expect(fim.precisao.ampla).toEqual(topo.precisao.ampla);
    expect(topo.todos).toEqual(fim.todos);
    expect(topo.vereditos).toEqual(S10N10);
    expect(topo.dezPrimeiros).toEqual({ S: 10, P: 0, C: 0, N: 0, semMaioria: 0 });
  });

  it("C fica fora do numerador das duas precisões e no denominador; sem maioria: N no pessimista, S no otimista", () => {
    const m = medirPedido(["S", "P", "C", "N", "sem maioria"], zero, zero);
    expect(m.precisao.ampla).toEqual({ pessimista: 2 / 5, otimista: 3 / 5 });
    expect(m.precisao.estrita).toEqual({ pessimista: 1 / 5, otimista: 2 / 5 });
    expect(m.todos.C).toBe(1);
    expect(medirPedido([], zero, zero).precisao.ampla).toEqual({ pessimista: null, otimista: null });
  });

  it("cobertura relativa contra a união julgada da tese, com os extremos de cada sem maioria", () => {
    // O pedido trouxe 3 que servem e 1 sem maioria; a união da tese tem 6 que servem e 3 sem maioria (2 fora do pedido).
    const distintos = { S: 2, P: 1, C: 0, N: 4, semMaioria: 1 };
    const uniao = { S: 4, P: 2, C: 1, N: 9, semMaioria: 3 };
    // Pessimista: o sem maioria do pedido não serve; os 2 de fora servem → 3 ÷ (6 + 2). Otimista: o do pedido serve,
    // os de fora não → (3 + 1) ÷ (6 + 1).
    expect(medirPedido([], distintos, uniao).cobertura).toEqual({ pessimista: 3 / 8, otimista: 4 / 7 });
    expect(medirPedido([], zero, zero).cobertura).toEqual({ pessimista: null, otimista: null });
  });

  it("o veredito de cada entregue sai da linha real da tese do pedido, pela chave, na ordem da lista", () => {
    const reservado = [
      { id: "J-0001", tese: 1, chave: "a", pedidos: ["cc956b4/e1-t01-tecnica"] },
      { id: "J-0002", tese: 1, chave: "b", pedidos: ["cc956b4/e1-t01-tecnica"] },
      { id: "J-0003", tese: 2, chave: "a", pedidos: ["cc956b4/e1-t02-tecnica"] },
      { id: "J-0004", tese: 1, chave: "c", pedidos: [], controleDaTese: 16 },
    ];
    const vereditos = new Map<string, Veredito>([["J-0001", "S"], ["J-0002", "N"], ["J-0003", "C"], ["J-0004", "N"]]);
    expect(vereditosNaOrdem(1, ["b", "a", "a"], reservado, vereditos)).toEqual(["N", "S", "S"]);
    expect(vereditosNaOrdem(2, ["a"], reservado, vereditos)).toEqual(["C"]);
    expect(() => vereditosNaOrdem(1, ["c"], reservado, vereditos)).toThrow(/1º acórdão entregue sob a tese 1/);
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
