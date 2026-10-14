import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { USER_AGENT } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { Memoria } from "../src/memoria.js";
import { infoTribunal } from "../src/tribunais.js";
import { clienteFalso } from "./apoio.js";

const LINK = "https://jurisprudencia.tjpi.jus.br/jurisprudences/4426913/public";
const CNJ = "0000001-11.2020.8.18.0001";
const PAGINA = readFileSync(new URL("./fixtures/tjpi-documento.html", import.meta.url), "utf8");
const pagina = (html = PAGINA) => () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });

function memoriaComAcordao(sobre: Partial<Acordao> = {}) {
  const memoria = new Memoria();
  const acordao = {
    id: "tjpi:77",
    tribunal: "tjpi",
    numero: CNJ,
    numeroCnj: CNJ,
    semNumero: false,
    ementa: "APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO DE EMENTA DO TJPI PARA TESTE.",
    linkConsulta: LINK,
    ...sobre,
  } as Acordao;
  memoria.lembrar([{ ids: [acordao.id], registro: acordao }]);
  return memoria;
}

describe("inteiro teor — TJPI (I-16 / G-23): o texto do acórdão vem na página do portal, um GET por documento", () => {
  it("o tribunal é marcado como texto do portal", () => {
    expect(infoTribunal("tjpi")?.inteiroTeor).toBe("portal");
  });

  it("pede a página do link de consulta (uma chamada, UA honesto), guarda ementa e acórdão na memória e ensina a ler pelo id", async () => {
    const memoria = memoriaComAcordao();
    const { cliente, chamadas } = clienteFalso([pagina()]);
    const r = await obterInteiroTeor({ id: "tjpi:77" }, () => cliente, memoria);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(LINK);
    expect(new Headers(chamadas[0].init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/texto do portal do tribunal/);
    expect(r.explicacao).toMatch(/ler_inteiro_teor com o id tjpi:77/);
    const guardado = await memoria.obterTexto("tjpi:77");
    expect(guardado?.texto).toMatch(/EXEMPLO FICTÍCIO DE EMENTA DO TJPI/);
    expect(guardado?.texto).toMatch(/O dano moral decorrente de situação exemplar fictícia é presumido/);
    expect(guardado?.texto).toMatch(/NEGO-LHE PROVIMENTO/);
    // A coluna "Detalhes" e o menu do portal não são texto do acórdão.
    expect(guardado?.texto).not.toMatch(/Detalhes|Jurisprudências - TJPI/);
  });

  it("já na memória: não chama o portal de novo", async () => {
    const memoria = memoriaComAcordao();
    await obterInteiroTeor({ id: "tjpi:77" }, () => clienteFalso([pagina()]).cliente, memoria);
    const { cliente, chamadas } = clienteFalso([]);
    await obterInteiroTeor({ id: "tjpi:77" }, () => cliente, memoria);
    expect(chamadas).toHaveLength(0);
  });

  it("página de outro processo que o da busca: texto não verificado, nada guardado", async () => {
    const memoria = memoriaComAcordao({ numeroCnj: "0000002-22.2020.8.18.0001" });
    const { cliente } = clienteFalso([pagina()]);
    const r = await obterInteiroTeor({ id: "tjpi:77" }, () => cliente, memoria);
    expect(r.baixado ? "" : r.explicacao).toMatch(/não é a página do acórdão/);
    expect(await memoria.obterTexto("tjpi:77")).toBeUndefined();
  });

  it("página de aviso ou erro do portal (sem as marcas do acórdão): não verificado, nada guardado", async () => {
    const memoria = memoriaComAcordao();
    const { cliente } = clienteFalso([pagina("<html><body><h1>Registro não encontrado</h1></body></html>")]);
    const r = await obterInteiroTeor({ id: "tjpi:77" }, () => cliente, memoria);
    expect(r.baixado ? "" : r.explicacao).toMatch(/não é a página do acórdão/);
    expect(await memoria.obterTexto("tjpi:77")).toBeUndefined();
  });

  it.each([
    "https://outro.test/jurisprudences/4426913/public",
    "http://jurisprudencia.tjpi.jus.br/jurisprudences/4426913/public",
    "https://jurisprudencia.tjpi.jus.br/jurisprudences/search",
  ])("link fora do formato do TJPI (%s) é recusado antes de qualquer chamada", async (linkConsulta) => {
    const memoria = memoriaComAcordao({ linkConsulta });
    const { cliente, chamadas } = clienteFalso([]);
    await expect(obterInteiroTeor({ id: "tjpi:77" }, () => cliente, memoria)).rejects.toThrow(/fora do formato/);
    expect(chamadas).toHaveLength(0);
  });
});
