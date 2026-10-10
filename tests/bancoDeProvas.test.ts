import { describe, expect, it } from "vitest";
import { carregarRecorte, medir, rodarTese } from "./apoioBancoDeProvas.js";

describe("banco de provas sobre o recorte gravado (sem rede)", () => {
  it("a tese 18 (só TSE) reproduz a medição da rodada 2: 50 mostrados, todos relevantes, cobertura 50 de 92", async () => {
    const recorte = carregarRecorte(18);
    const lista = await rodarTese(recorte);
    expect(lista).toHaveLength(50);
    const m = medir([{ recorte, lista }]);
    expect(m.porTribunal.tse).toEqual({ mostrados: 50, relevantes: 50, precisao: 1, relevantesNaLista: 92, achados: 50, cobertura: 50 / 92 });
  });
});
