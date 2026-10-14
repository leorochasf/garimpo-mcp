import { describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { clienteDoDjen, FonteDjen } from "../src/djen.js";

// Teste ao vivo opcional (PV-12): 1 busca genérica no JurisprudênciaIA só para obter um número público e 1 consulta ao
// DJEN por esse número. Só com GARIMPO_VIVO=1, nunca junto do Falcão. O número não é gravado nem impresso.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("DJEN — ao vivo", () => {
  it("consulta um processo e mostra o resultado do critério de dois sinais", { timeout: 300_000 }, async () => {
    const site = new Cliente({ nome: "O JurisprudênciaIA" });
    const busca = await buscaDireta(site, { tribunal: "tjgo", texto: "dano moral protesto indevido", limite: 5 });
    const numero = busca.acordaos.find((a) => a.numeroCnj)?.numeroCnj;
    expect(numero).toBeDefined();

    const consulta = await new FonteDjen(clienteDoDjen()).consultar(numero!.replace(/\D/g, ""));
    const porTipo: Record<string, number> = {};
    for (const c of consulta.comunicacoes) {
      const k = `${c.tipoDocumento ?? "?"} → ${c.ementa === undefined ? "sem campo" : c.ementa === "não verificado" ? "não verificado" : "trecho"}`;
      porTipo[k] = (porTipo[k] ?? 0) + 1;
    }
    console.log(JSON.stringify({ total: consulta.total, porTipo }));
    expect(consulta.total).toBeGreaterThanOrEqual(0);
  });
});
