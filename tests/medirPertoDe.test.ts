import { describe, expect, it } from "vitest";
import { filtroLocal } from "../src/filtroLocal.js";
import {
  decidir,
  melhorRegra,
  medirTudo,
  regrasPerto,
  regrasSimples,
  teto,
  validacaoCruzada,
  type Amostra,
} from "../scripts/medirPertoDe.js";

describe("regras candidatas de uma ementa", () => {
  it("a forma simples traz palavras e expressões de até 3 palavras seguidas, sem acento nem maiúscula", () => {
    const r = regrasSimples("O Subsídio ao incentivo fiscal");
    expect(r.has("subsidio")).toBe(true);
    expect(r.has("incentivo fiscal")).toBe(true);
    expect(r.has("subsidio ao incentivo")).toBe(true);
    expect(r.has("subsidio ao incentivo fiscal")).toBe(false); // 4 palavras: fora
    expect(r.has("ao")).toBe(true); // o ticket não restringe o tamanho das palavras
  });

  it("preserva a pontuação entre palavras, como o filtro local real", () => {
    const ementa = "Incentivo, fiscal; subsídio ao desenvolvimento";
    const regras = regrasSimples(ementa);
    expect(regras.has("incentivo fiscal")).toBe(false);
    expect(regras.has("fiscal subsidio")).toBe(false);
    expect(regras.has("incentivo, fiscal")).toBe(true);
    expect(regras.has("subsidio ao desenvolvimento")).toBe(true);
    for (const regra of regras) expect(filtroLocal({ naoPodeConter: [regra] })!(ementa)).toBe(false);
  });

  it("considera também pares com palavras curtas, sem esconder candidatos previstos no ticket", () => {
    expect(regrasPerto("ato de incentivo").has("ato|incentivo")).toBe(true);
    expect(regrasPerto("incentivo ao incentivo").has("incentivo|incentivo")).toBe(true);
  });

  it("a forma 'perto de' traz o par de palavras a até 60 caracteres, em qualquer ordem, e não o par distante", () => {
    const perto = regrasPerto("subsídio concedido ao incentivo");
    expect(perto.has("incentivo|subsidio")).toBe(true);
    const longe = regrasPerto(`subsídio ${"x".repeat(61)} incentivo`);
    expect(longe.has("incentivo|subsidio")).toBe(false);
    const nolimite = regrasPerto(`subsídio ${"x".repeat(58)} incentivo`); // 60 caracteres entre as palavras (2 espaços + 58)
    expect(nolimite.has("incentivo|subsidio")).toBe(true);
  });
});

describe("junção das marcações", () => {
  it("deduplica dúvidas e exclui definitivas conflitantes sem depender da ordem das rodadas", () => {
    const marcadas = [
      { tese: 1, ementa: "Subsídio fiscal", marca: "relevante" },
      { tese: 1, ementa: "SUBSIDIO fiscal", marca: "irrelevante" },
      { tese: 1, ementa: "Ato administrativo", marca: "duvida" },
      { tese: 1, ementa: "Ato administrativo", marca: "duvida" },
      { tese: 1, ementa: "Incentivo fiscal", marca: "duvida" },
      { tese: 1, ementa: "Incentivo fiscal", marca: "relevante" },
    ];
    const resultado = medirTudo(marcadas);
    expect(resultado.totais).toMatchObject({ ementas: 1, relevantes: 1, irrelevantes: 0, duvida: 1, conflitos: 1 });
    expect(medirTudo([...marcadas].reverse())).toEqual(resultado);
  });
});

const amostra = (irrelevante: boolean, regras: string[]): Amostra => ({ irrelevante, regras: new Set(regras) });

describe("escolha da melhor regra segura", () => {
  it("só vale regra que não tira relevante e tira pelo menos o mínimo de irrelevantes", () => {
    const lote = [
      amostra(true, ["a", "b"]),
      amostra(true, ["a", "b"]),
      amostra(true, ["a"]),
      amostra(false, ["a"]), // 'a' derruba uma relevante: não é segura
    ];
    expect(melhorRegra(lote, 2)).toBe("b");
    expect(melhorRegra(lote, 3)).toBeUndefined();
  });

  it("empate se resolve pela ordem alfabética, para a medição ser repetível", () => {
    const lote = [amostra(true, ["z", "m"]), amostra(true, ["z", "m"])];
    expect(melhorRegra(lote, 2)).toBe("m");
  });
});

describe("validação cruzada e teto", () => {
  // 8 amostras em ordem estável; as metades são as posições pares e ímpares.
  const lote = [
    amostra(true, ["p"]), //0
    amostra(true, ["p"]), //1
    amostra(true, ["p"]), //2
    amostra(true, ["p"]), //3
    amostra(false, []), //4
    amostra(false, []), //5
    amostra(true, ["q"]), //6
    amostra(false, ["q"]), //7
  ];

  it("escolhe numa metade e conta na outra, nos dois sentidos", () => {
    const v = validacaoCruzada(lote, 2);
    // escolhe 'p' nas pares {0,2,4,6}: tira 2 irrelevantes -> valida nas ímpares {1,3,5,7}: tira 2, 0 relevantes.
    // escolhe 'p' nas ímpares {1,3,5,7}: tira 2 -> valida nas pares: tira 2.
    expect(v).toEqual({ irrelevantesTirados: 4, relevantesPerdidos: 0, regrasEscolhidas: 2 });
  });

  it("o teto escolhe e conta no lote inteiro", () => {
    expect(teto(lote, 2)).toEqual({ irrelevantesTirados: 4, relevantesPerdidos: 0, regrasEscolhidas: 1 });
  });
});

describe("decisão pelo critério escrito antes da medição", () => {
  const tese = (n: number, simples: number, perto: number, perdSimples = 0, perdPerto = 0) => ({
    tese: n,
    simples: { irrelevantesTirados: simples, relevantesPerdidos: perdSimples, regrasEscolhidas: 2 },
    perto: { irrelevantesTirados: perto, relevantesPerdidos: perdPerto, regrasEscolhidas: 2 },
  });

  it("segue só com +10 irrelevantes, em 4 teses ou mais, sem perder mais relevantes", () => {
    const boa = [tese(1, 0, 3), tese(2, 1, 4), tese(3, 0, 2), tese(4, 2, 4)]; // +3 +3 +2 +2 = 10
    expect(decidir(boa)).toMatchObject({ segue: true, ganhoLiquido: 10, tesesComGanho: 4 });
  });

  it("não segue com ganho de 9", () => {
    const quase = [tese(1, 0, 3), tese(2, 1, 4), tese(3, 0, 2), tese(4, 2, 3)];
    expect(decidir(quase)).toMatchObject({ segue: false, ganhoLiquido: 9 });
  });

  it("não segue quando o ganho vem de menos de 4 teses", () => {
    const concentrado = [tese(1, 0, 6), tese(2, 0, 6), tese(3, 0, 1)];
    expect(decidir(concentrado)).toMatchObject({ segue: false, ganhoLiquido: 13, tesesComGanho: 3 });
  });

  it("não segue quando 'perto de' perde mais relevantes que a forma simples", () => {
    const custo = [tese(1, 0, 4, 0, 1), tese(2, 0, 4), tese(3, 0, 4), tese(4, 0, 4)];
    expect(decidir(custo)).toMatchObject({ segue: false, ganhoLiquido: 16 });
  });
});
