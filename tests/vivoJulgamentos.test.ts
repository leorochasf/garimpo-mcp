import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { ChaveDoDataJud, clienteDoDataJud } from "../src/datajud.js";
import { clienteDoDjen, FonteDjen } from "../src/djen.js";
import { julgamentosDoProcesso } from "../src/julgamentos.js";

// Teste ao vivo opcional: 2 chamadas ao DataJud (TJTO), 0,5 s entre elas, e 1 busca no site. Só com GARIMPO_VIVO=1. O número vem da
// própria API (um processo público qualquer de 2º grau) e não é gravado em lugar nenhum.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("julgamentos_do_processo — ao vivo", () => {
  it("acha um processo de 2º grau no TJTO e mostra os julgamentos registrados", { timeout: 300_000 }, async () => {
    const datajud = clienteDoDataJud();
    const chave = new ChaveDoDataJud().atual().valor;
    const r = await datajud.requisitar("https://api-publica.datajud.cnj.jus.br/api_publica_tjto/_search", {
      method: "POST",
      headers: { Authorization: `APIKey ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { bool: { must: [{ match: { grau: "G2" } }, { match: { "movimentos.codigo": 200 } }] } }, size: 1, _source: ["numeroProcesso"] }),
    });
    const numero: string = (await r.json()).hits.hits[0]._source.numeroProcesso;

    const site = new Cliente({ nome: "O JurisprudênciaIA" });
    const djen = new FonteDjen(clienteDoDjen());
    const resposta = await julgamentosDoProcesso({ numero, incluirDjen: false }, { site, datajud, djen, chave: new ChaveDoDataJud() });

    expect(resposta.datajud.estado).toBe("ok");
    const codigos = resposta.datajud.registros!.flatMap((x) => x.resultadosDeJulgamento.map((m) => m.codigo));
    expect(codigos).toContain(200);
  });
});
