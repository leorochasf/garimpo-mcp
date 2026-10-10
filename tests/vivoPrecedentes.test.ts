import { describe, expect, it } from "vitest";
import { clienteDosPrecedentes, PrecedentesAoVivo } from "../src/precedentesAoVivo.js";
import { Memoria } from "../src/memoria.js";

// Teste ao vivo opcional (ADR-0020): 5 chamadas em série, 1 ao portal do STJ e 4 ao do STF. Só com GARIMPO_VIVO=1.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("precedentes ao vivo — portais reais", () => {
  const aoVivo = new PrecedentesAoVivo(clienteDosPrecedentes("stj"), clienteDosPrecedentes("stf"), new Memoria());

  it("STJ: tema repetitivo 1 com situação", { timeout: 60_000 }, async () => {
    const d = await aoVivo.doStj("tema repetitivo", 1);
    expect(d.linha.situacao).toBeTruthy();
  });

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
