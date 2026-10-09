import { describe, expect, it } from "vitest";
import { chamar, conectar, falcaoFalso, siteFalso } from "./apoioFalcao.js";

describe("os 24 TRTs em listar_tribunais e garimpo://tribunais", () => {
  it("listar_tribunais traz a fonte de cada tribunal; os 24 TRTs pelo Falcão, com teto 30, qualificados não pesquisados e texto integral", async () => {
    const falcao = falcaoFalso();
    const site = siteFalso();
    const { mcp } = await conectar(site.cliente, falcao.cliente);
    const { dado } = await chamar(mcp, "listar_tribunais", {});
    const trts = dado.filter((t: { fonte: string }) => t.fonte === "Falcão (CSJT)");
    expect(trts.map((t: { tribunal: string }) => t.tribunal)).toEqual(Array.from({ length: 24 }, (_, i) => `trt${i + 1}`));
    for (const t of trts) {
      expect(t).toMatchObject({
        busca: true,
        tetoResultados: 30,
        qualificados: "qualificados não pesquisados no B12",
        inteiroTeor: "texto",
        motivo: "texto integral do repositório oficial (sem PDF)",
      });
    }
    expect(dado.find((t: { tribunal: string }) => t.tribunal === "tst")).toMatchObject({ fonte: "JurisprudênciaIA" });
    expect(dado.find((t: { tribunal: string }) => t.tribunal === "stj")).toMatchObject({ fonte: "JurisprudênciaIA", inteiroTeor: "baixa" });
    expect(falcao.pedidos).toHaveLength(0);
    expect(site.chamadas).toHaveLength(0);
  });

  it("a página tem a coluna Fonte, as linhas dos TRTs e os limites do Falcão (5 páginas, freio preventivo, memória de 24 h)", async () => {
    const { mcp } = await conectar(siteFalso().cliente, falcaoFalso().cliente);
    const { contents } = await mcp.readResource({ uri: "garimpo://tribunais" });
    const pagina = (contents[0] as { text: string }).text;
    expect(pagina).toContain("| Sigla | Tribunal | Fonte | Qualificados | Teto por busca | Inteiro teor |");
    expect(pagina).toContain(
      "| TRT15 | TRT da 15ª Região | Falcão (CSJT) | qualificados não pesquisados no B12 | 30 | texto integral do repositório oficial (sem PDF) |",
    );
    expect(pagina).toMatch(/\| STJ \| Superior Tribunal de Justiça \| JurisprudênciaIA \|/);
    expect(pagina).toMatch(/no máximo 5 páginas do Falcão por chamada/);
    expect(pagina).toMatch(/freio preventivo/);
    expect(pagina).toMatch(/24 h desde a busca/);
    expect(pagina).toMatch(/Res\. CSJT 401\/2024/);
  });
});
