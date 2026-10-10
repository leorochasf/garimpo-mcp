import { describe, expect, it } from "vitest";
import { clienteDosPrecedentes, PrecedentesAoVivo } from "../src/precedentesAoVivo.js";
import { Memoria } from "../src/memoria.js";

// Teste ao vivo opcional (ADR-0020): 3 chamadas em série, 1 ao portal do STJ e 2 ao do STF. Só com GARIMPO_VIVO=1.
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
});
