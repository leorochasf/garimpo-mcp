import { describe, expect, it } from "vitest";
import { agruparEmSerie } from "../src/emSerie.js";

const base = {
  tribunal: "stj",
  orgao: "Turma Exemplo",
  relator: "Fulano de Tal",
  ementa: "AGRAVO. Recurso inadmissível, pois não houve impugnação.",
  dataJulgamento: "2024-03-01T00:00:00.000Z",
};
const a = (id: string, extra: Partial<typeof base & { avisoDeEmenta: string }> = {}) => ({ id, ...base, ...extra });
const ids = (grupos: ReturnType<typeof agruparEmSerie<ReturnType<typeof a>>>) =>
  grupos.map((g) => [g.principal.id, ...g.outros.map((o) => o.id)]);

describe("agruparEmSerie", () => {
  it("junta mesma ementa do mesmo tribunal, órgão e relator, na ordem da primeira ocorrência", () => {
    const grupos = agruparEmSerie([a("1"), a("x", { ementa: "OUTRA." }), a("2"), a("3")]);
    expect(ids(grupos)).toEqual([["1", "2", "3"], ["x"]]);
  });

  it("só espaços e quebras de linha diferentes: agrupa", () => {
    const grupos = agruparEmSerie([a("1"), a("2", { ementa: "  AGRAVO.\nRecurso   inadmissível,\tpois não houve impugnação.\n" })]);
    expect(ids(grupos)).toEqual([["1", "2"]]);
  });

  it("uma negação, um número, uma pontuação ou uma maiúscula de diferença: não agrupa", () => {
    const variantes = [
      "AGRAVO. Recurso inadmissível, pois houve impugnação.",
      "AGRAVO. Recurso inadmissível, pois não houve impugnação 2.",
      "AGRAVO. Recurso inadmissível pois não houve impugnação.",
      "AGRAVO. Recurso inadmissível, pois não houve Impugnação.",
    ];
    for (const ementa of variantes) expect(ids(agruparEmSerie([a("1"), a("2", { ementa })]))).toEqual([["1"], ["2"]]);
  });

  it("tribunal, órgão ou relator diferente: não agrupa", () => {
    for (const extra of [{ tribunal: "stf" }, { orgao: "Outra Turma" }, { relator: "Beltrano" }]) {
      expect(ids(agruparEmSerie([a("1"), a("2", extra)]))).toEqual([["1"], ["2"]]);
    }
  });

  it("ementa ausente ou cortada, ou órgão/relator ausente: nunca agrupa, nem com outro igual", () => {
    const lista = [
      a("1", { ementa: "" }),
      a("2", { ementa: "" }),
      a("3", { avisoDeEmenta: "ementa cortada" }),
      a("4", { avisoDeEmenta: "ementa cortada" }),
      a("5", { relator: undefined }),
      a("6", { relator: undefined }),
      a("7", { orgao: undefined }),
      a("8", { orgao: undefined }),
    ];
    expect(ids(agruparEmSerie(lista))).toEqual(lista.map((x) => [x.id]));
  });

  it("devolve cada acórdão uma vez só: a soma do grupo é a lista original", () => {
    const grupos = agruparEmSerie([a("1"), a("2"), a("3", { relator: "Beltrano" })]);
    expect(grupos.flatMap((g) => [g.principal, ...g.outros])).toHaveLength(3);
  });
});
