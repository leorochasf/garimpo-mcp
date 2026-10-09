import { describe, expect, it } from "vitest";
import { filtroLocal } from "../src/filtroLocal.js";

// Ementas genéricas, sem processo real.
const EMENTA =
  "EMENTA: APELAÇÃO CÍVEL. IMPROBIDADE   ADMINISTRATIVA. Conduta culposa. Lei 14.230/2021. Dano ao erário não comprovado.";

describe("casamento dos filtros locais (expressão inteira, ADR-0013)", () => {
  it("sem filtro nenhum (listas ausentes ou vazias) não há filtro local", () => {
    expect(filtroLocal({})).toBeUndefined();
    expect(filtroLocal({ deveConter: [], naoPodeConter: [] })).toBeUndefined();
  });

  it("não diferencia acento nem maiúscula, nos dois sentidos", () => {
    expect(filtroLocal({ deveConter: [["apelacao civel"]] })!(EMENTA)).toBe(true);
    expect(filtroLocal({ deveConter: [["Dano ao Erário"]] })!(EMENTA.toLowerCase())).toBe(true);
  });

  it("casa a expressão inteira, com fronteira de palavra: sem radical, sem pedaço de palavra", () => {
    expect(filtroLocal({ deveConter: [["culposa"]] })!(EMENTA)).toBe(true);
    expect(filtroLocal({ deveConter: [["culpa"]] })!(EMENTA)).toBe(false);
    expect(filtroLocal({ deveConter: [["culpabilidade"]] })!(EMENTA)).toBe(false);
    expect(filtroLocal({ naoPodeConter: ["culpa"] })!(EMENTA)).toBe(true);
    expect(filtroLocal({ deveConter: [["14.230"]] })!(EMENTA)).toBe(true);
    expect(filtroLocal({ deveConter: [["14230"]] })!(EMENTA)).toBe(false);
  });

  it("espaços normalizados: vários espaços ou quebra de linha valem um espaço, na ementa e no termo", () => {
    expect(filtroLocal({ deveConter: [["improbidade administrativa"]] })!(EMENTA)).toBe(true);
    expect(filtroLocal({ deveConter: [["dano  ao\nerário"]] })!(EMENTA)).toBe(true);
  });

  it("deveConter: basta um sinônimo de cada grupo, e todos os grupos são exigidos", () => {
    const f = filtroLocal({ deveConter: [["improbidade"], ["dolo", "culposa"]] })!;
    expect(f(EMENTA)).toBe(true);
    expect(f("EMENTA: IMPROBIDADE. Sem elemento subjetivo.")).toBe(false);
    expect(f("EMENTA: Conduta culposa, sem ato ímprobo.")).toBe(false);
  });

  it("naoPodeConter: qualquer termo exclui, junto com o deveConter", () => {
    expect(filtroLocal({ naoPodeConter: ["multa administrativa", "erário"] })!(EMENTA)).toBe(false);
    expect(filtroLocal({ deveConter: [["improbidade"]], naoPodeConter: ["tributário"] })!(EMENTA)).toBe(true);
    expect(filtroLocal({ deveConter: [["improbidade"]], naoPodeConter: ["culposa"] })!(EMENTA)).toBe(false);
  });
});
