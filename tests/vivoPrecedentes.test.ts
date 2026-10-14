import { describe, expect, it } from "vitest";
import { clienteDosPrecedentes, PrecedentesAoVivo } from "../src/precedentesAoVivo.js";
import { Memoria } from "../src/memoria.js";

// Teste ao vivo opcional (ADR-0020): 4 chamadas em série ao portal do STF (o STJ não é consultado: D-18). Só com GARIMPO_VIVO=1.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("precedentes ao vivo — portais reais", () => {
  const aoVivo = new PrecedentesAoVivo(clienteDosPrecedentes(), new Memoria());

  it("STF: repercussão geral 1 com situação e tese", { timeout: 90_000 }, async () => {
    const d = await aoVivo.doStf("repercussão geral", 1);
    expect(d.linha.situacao).toBeTruthy();
    expect(d.linha.teseFirmada).toBeTruthy();
  });

  it("STF: súmula vinculante 10 com enunciado (lista e página)", { timeout: 90_000 }, async () => {
    const d = await aoVivo.doStf("súmula vinculante", 10);
    expect(d.linha.enunciado).toMatch(/reserva de plenário/);
  });
});
