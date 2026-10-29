import { describe, expect, it } from "vitest";
import { buscaDireta, normalizar } from "../src/busca.js";
import { Memoria } from "../src/memoria.js";
import { clienteFalso, respostaJson } from "./apoio.js";

// Ticket 07: a busca guarda o texto que o JurisprudênciaIA embute no link (data:text/html) de TJES e TJMA; o data: cru
// nunca vai à resposta. HTML sintético, sem dado real.

const html = (n: string) =>
  `<html><body><h2>Inteiro Teor</h2><p>EMENTA: APELAÇÃO CÍVEL ${n}. Texto fictício de ementa.</p>` +
  "<p>VOTO fictício: o recurso é conhecido e provido.</p></body></html>";
const dataUri = (n: string) => "data:text/html;base64," + Buffer.from(html(n), "utf8").toString("base64");

const registro = (id: number, linkPdf: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  texto_ementa: `EMENTA FICTÍCIA ${id}.`,
  link_pdf: linkPdf,
  ...extra,
});

describe("normalizar — texto da base numa lista paralela", () => {
  it("converte o data:text/html do link_pdf e guarda pelo id do acórdão; o acórdão segue sem o data:", () => {
    const r = normalizar("tjes", { results: [registro(1, dataUri("1")), registro(2, "https://exemplo.jus.br/a.pdf")] });
    expect(r.textosDaBase).toHaveLength(1);
    expect(r.textosDaBase[0].id).toBe("tjes:1");
    expect(r.textosDaBase[0].texto).toContain("APELAÇÃO CÍVEL 1");
    const [a1, a2] = r.acordaos;
    expect(a1.link).toBeUndefined();
    expect(a1.avisoDeLink).toBeDefined();
    expect(a2.link).toBe("https://exemplo.jus.br/a.pdf");
    expect(JSON.stringify(r.acordaos)).not.toMatch(/data:text|base64/);
  });

  it("link que não é data:text/html, base64 ruim ou HTML sem texto: nenhum texto", () => {
    const r = normalizar("tjma", {
      results: [registro(1, "gs://b/a.pdf"), registro(2, "data:text/html;base64,@@@"), registro(3, "data:text/html;base64,"), registro(4, undefined)],
    });
    expect(r.textosDaBase).toEqual([]);
  });

  it("o indício de corte e o conteúdo oculto vêm junto", () => {
    const cortado = "data:text/html;base64," + Buffer.from("<p>EMENTA: texto fictício que termina no meio de uma etiq<", "utf8").toString("base64");
    const r = normalizar("tjes", { results: [registro(1, cortado)] });
    expect(r.textosDaBase[0].indicioDeCorte).toBe(true);
  });
});

describe("buscaDireta — guarda o texto da base na memória", () => {
  it("o texto fica na memória pelo id e a resposta ao usuário não leva o data:", async () => {
    const memoria = new Memoria();
    const { cliente } = clienteFalso([respostaJson({ results: [registro(7, dataUri("7"))] })]);
    const r = await buscaDireta(cliente, { tribunal: "tjes", texto: "exemplo" }, memoria);
    expect(JSON.stringify(r)).not.toMatch(/data:text|base64/);
    const t = await memoria.obterTexto("tjes:7");
    expect(t?.texto).toContain("APELAÇÃO CÍVEL 7");
  });

  it("cópias juntadas: o texto fica no id do acórdão que a busca mostra", async () => {
    const memoria = new Memoria();
    const igual = { texto_ementa: "EMENTA IGUAL FICTÍCIA.", data_julgamento: "2025-03-04" };
    const { cliente } = clienteFalso([
      respostaJson({ results: [{ id: 1, link_pdf: undefined, ...igual }, { id: 2, link_pdf: dataUri("2"), ...igual }] }),
    ]);
    const r = await buscaDireta(cliente, { tribunal: "tjma", texto: "exemplo" }, memoria);
    expect(r.acordaos).toHaveLength(1);
    const t = await memoria.obterTexto(r.acordaos[0].id);
    expect(t?.texto).toContain("APELAÇÃO CÍVEL 2");
  });

  it("sem guardar acórdãos (guardarAcordaos: false), nenhum texto vai à memória", async () => {
    const memoria = new Memoria();
    const { cliente } = clienteFalso([respostaJson({ results: [registro(7, dataUri("7"))] })]);
    await buscaDireta(cliente, { tribunal: "tjes", texto: "exemplo" }, memoria, { guardarAcordaos: false });
    expect(await memoria.obterTexto("tjes:7")).toBeUndefined();
  });
});
