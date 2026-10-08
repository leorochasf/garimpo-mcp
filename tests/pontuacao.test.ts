import { describe, expect, it } from "vitest";
import { aderencia, ordenarPorAderencia } from "../src/pontuacao.js";

/** Acórdão fictício já juntado pela busca ampla. */
function item(id: string, ementa: string, formulacoes: number, melhorPosicao = 0, tribunal = "stj", relevancia?: number) {
  return { id, tribunal, ementa, formulacoes, melhorPosicao, relevancia };
}

const ids = (r: { id: string }[]) => r.map((p) => p.id);

describe("aderência e nova ordem", () => {
  it("acórdão de assunto largo, achado pelas 3 formulações, fica depois do achado por 1 que tem as palavras dela", () => {
    const formulacoes = [
      "prescrição da pretensão de reparação do dano ambiental",
      "imprescritibilidade da reparação civil ambiental",
      "dano ambiental imprescritível",
    ];
    const largo = item("largo", "EMENTA FICTÍCIA. Reparação civil. Dano ambiental. Responsabilidade objetiva do poluidor.", 3, 0);
    const exato = item("exato", "EMENTA FICTÍCIA. É imprescritível a pretensão de reparação civil de dano ambiental.", 1, 40);

    expect(ids(ordenarPorAderencia([largo, exato], formulacoes))).toEqual(["exato", "largo"]);
  });

  it("variações da mesma palavra (acento, maiúsculas, mesmo radical) contam como presentes", () => {
    for (const ementa of ["PRESCRICAO TRIENAL.", "Pretensão prescritível.", "É IMPRESCRITÍVEL.", "prazo prescricional"]) {
      expect(aderencia(ementa, ["prescrição"]), ementa).toBe(1);
    }
    expect(aderencia("Prescrição da pretensão.", ["imprescritibilidade"])).toBe(1);
    expect(aderencia("Ação Civil Pública", ["acao civil publica"])).toBe(1);
    expect(aderencia("Decadência do direito.", ["prescrição"])).toBe(0);
  });

  it("palavras vazias e tokens curtos não contam a favor nem contra", () => {
    const formulacao = "dano ambiental para a lei, com o art. 3 do CC, pelos";
    expect(aderencia("Dano ambiental.", [formulacao])).toBe(1);
    expect(aderencia("Para a lei, com o art. 3 do CC, pelos.", [formulacao])).toBe(0);
  });

  it("palavra curta (menos de 6 letras) só casa com ela mesma ou o plural, nunca como começo de outra", () => {
    expect(aderencia("Danos morais.", ["dano"])).toBe(1);
    expect(aderencia("Interesse de agir.", ["ter"])).toBe(0);
    expect(aderencia("Remessa necessária.", ["rem"])).toBe(0);
    expect(aderencia("Conduta danosa.", ["dano"])).toBe(0);
  });

  // Aderência 0,8 (4 de 5 palavras) e 0,75 (3 de 4): mesma faixa nas padrão, faixas diferentes com corte em 0,8.
  const formulacoesFaixa = ["responsabilidade solidária adquirente imóvel degradado", "obrigação propter rem ambiental"];
  const quatroDeCinco = item("4-de-5", "EMENTA FICTÍCIA. Responsabilidade solidária do adquirente do imóvel.", 1);
  const tresDeQuatro = item("3-de-4", "EMENTA FICTÍCIA. Obrigação propter rem.", 2);

  it("diferença mínima de aderência dentro da mesma faixa não reordena: decide o nº de formulações", () => {
    const r = ordenarPorAderencia([quatroDeCinco, tresDeQuatro], formulacoesFaixa);
    expect(r.map((p) => [p.id, p.aderencia])).toEqual([
      ["3-de-4", 0.75],
      ["4-de-5", 0.8],
    ]);
  });

  it("as faixas são parâmetro: com corte em 0,8 os mesmos dois acórdãos trocam de lugar", () => {
    const r = ordenarPorAderencia([tresDeQuatro, quatroDeCinco], formulacoesFaixa, { faixas: [1, 0.8] });
    expect(r.map((p) => [p.id, p.faixa])).toEqual([
      ["4-de-5", 1],
      ["3-de-4", 2],
    ]);
  });

  const ementaComum = "EMENTA FICTÍCIA. Dano ambiental.";

  it("mesma faixa e mesmo nº de formulações: decide a melhor posição nas buscas de origem", () => {
    const r = ordenarPorAderencia([item("pos-7", ementaComum, 2, 7), item("pos-1", ementaComum, 2, 1)], ["dano ambiental"]);
    expect(ids(r)).toEqual(["pos-1", "pos-7"]);
  });

  it("nota de relevância desempata só dentro do mesmo tribunal; entre tribunais não decide a ordem", () => {
    const empatado = (id: string, tribunal: string, nota: number) => item(id, ementaComum, 2, 3, tribunal, nota);
    const ordem = (...xs: ReturnType<typeof empatado>[]) => ids(ordenarPorAderencia(xs, ["dano ambiental"]));

    // Tribunais diferentes: a ordem de chegada fica, seja qual for a nota.
    expect(ordem(empatado("tjgo-baixa", "tjgo", 0.1), empatado("stj-alta", "stj", 0.99))).toEqual(["tjgo-baixa", "stj-alta"]);
    expect(ordem(empatado("stj-baixa", "stj", 0.1), empatado("tjgo-alta", "tjgo", 0.99))).toEqual(["stj-baixa", "tjgo-alta"]);
    // Mesmo tribunal: a nota maior vem antes; o acórdão do outro tribunal não sai do lugar.
    expect(
      ordem(empatado("stj-fraco", "stj", 0.1), empatado("tjgo-meio", "tjgo", 0.99), empatado("stj-forte", "stj", 0.9)),
    ).toEqual(["stj-forte", "tjgo-meio", "stj-fraco"]);
  });

  it("~1.200 ementas × 3 formulações pontuadas e ordenadas em milissegundos", () => {
    const trecho = "Responsabilidade civil por dano ambiental, reparação integral e obrigação propter rem do adquirente. ";
    const itens = Array.from({ length: 1200 }, (_, i) =>
      item(`a${i}`, `EMENTA FICTÍCIA ${i}. ${trecho.repeat(15)} Prescrição ${i % 7}.`, (i % 3) + 1, i % 100, i % 2 ? "stj" : "tjgo", i / 1200),
    );
    const inicio = performance.now();
    const r = ordenarPorAderencia(itens, ["prescrição do dano ambiental", "imprescritibilidade da reparação", "dano ambiental imprescritível"]);
    const ms = performance.now() - inicio;
    expect(r).toHaveLength(1200);
    expect(ms).toBeLessThan(50);
  });
});
