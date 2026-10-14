import { describe, expect, it } from "vitest";
import { ChaveDoDataJud, clienteDoDataJud } from "../src/datajud.js";
import { clienteDoDjen, FonteDjen } from "../src/djen.js";

// Teste ao vivo opcional (PV-12): 1 chamada ao DataJud (TJTO) só para obter um número público qualquer de 2º grau e 1
// consulta ao DJEN por esse número. Só com GARIMPO_VIVO=1, nunca junto do Falcão. O número não é gravado nem impresso.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("DJEN — ao vivo", () => {
  it("consulta um processo e mostra o resultado do critério de dois sinais", { timeout: 300_000 }, async () => {
    const r = await clienteDoDataJud().requisitar("https://api-publica.datajud.cnj.jus.br/api_publica_tjto/_search", {
      method: "POST",
      headers: { Authorization: `APIKey ${new ChaveDoDataJud().atual().valor}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { match: { grau: "G2" } }, size: 1, _source: ["numeroProcesso"] }),
    });
    const numero: string = (await r.json()).hits.hits[0]._source.numeroProcesso;

    const consulta = await new FonteDjen(clienteDoDjen()).consultar(numero);
    const porTipo: Record<string, number> = {};
    for (const c of consulta.comunicacoes) {
      const k = `${c.tipoDocumento ?? "?"} → ${c.ementa === undefined ? "sem campo" : c.ementa === "não verificado" ? "não verificado" : "trecho"}`;
      porTipo[k] = (porTipo[k] ?? 0) + 1;
    }
    console.log(JSON.stringify({ total: consulta.total, porTipo }));
    expect(consulta.total).toBeGreaterThanOrEqual(0);
  });
});
