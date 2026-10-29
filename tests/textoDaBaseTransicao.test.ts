import { describe, expect, it } from "vitest";
import { Cliente, Vagas } from "../src/cliente.js";
import { Memoria } from "../src/memoria.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { lerTextoIntegral, textoEhDaBase } from "../src/leitura.js";
import { type PortalComIntegra, registrarPortal } from "../src/paginaComIntegra.js";
import { clienteFalso, respostaJson } from "./apoio.js";
import { chamar, conectar, falcaoFalso } from "./apoioFalcao.js";

// B07-R02: o texto da base guardado ANTES de o tribunal ganhar portal não pode virar «texto do portal» sem passar pelas
// guardas do portal. Arquivo à parte: o registro de portais é global ao arquivo de teste, e aqui o portal entra DEPOIS da busca.

const CNJ = "0000001-11.2025.8.10.0001";
const LINK = "https://portal.exemplo.jus.br/acordao/77";
const ROTULO = "texto da base do JurisprudênciaIA, não oficial";
const BASE = "TEXTO FICTICIO DA BASE ANTES DO PORTAL.";
const html = `<html><body><p>EMENTA: ${BASE} Razões fictícias da base, bastantes para o teste.</p></body></html>`;
const dataUri = "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64");

const portal = (processo = CNJ) =>
  `<html><body><span>Processo:</span> <b id="processo">${processo}</b> <span>Segredo de Justiça:</span> <b id="segredo">Não</b>` +
  `<div id="integra">ACÓRDÃO FICTÍCIO do portal. Processo ${CNJ}. ${"Razões fictícias do portal. ".repeat(12)}</div></body></html>`;
const resposta = (corpo: string) => () => new Response(corpo, { headers: { "content-type": "text/html; charset=UTF-8" } });

const PORTAL: PortalComIntegra = {
  sigla: "tjma",
  host: "portal.exemplo.jus.br",
  caminho: /^\/acordao\/\d+$/,
  rotulo: "portal fictício do TJMA (portal.exemplo.jus.br)",
  processo: (h) => /id="processo">([^<]*)</.exec(h)?.[1],
  segredo: (h) => /id="segredo">([^<]*)</.exec(h)?.[1],
  integra: (h) => /<div id="integra">([\s\S]*?)<\/div>/.exec(h)?.[1],
};

function siteComRegistro() {
  return new Cliente({
    nome: "O site",
    vagas: new Vagas(2),
    esperar: async () => {},
    fetch: (async () =>
      respostaJson({
        results: [{ id: 5, numero_processo_cnj: CNJ, texto_ementa: "APELAÇÃO CÍVEL. Ementa fictícia.", link_pdf: dataUri }],
      })) as typeof fetch,
  });
}

/** Memória com o acórdão do TJMA e o texto da base já guardado (a origem, ou nenhuma, como numa entrada antiga). */
function memoriaComBase(origem: { origem?: "base" }) {
  const dados = new Memoria();
  dados.lembrar([
    { ids: ["tjma:5"], registro: { id: "tjma:5", tribunal: "tjma", numero: CNJ, numeroCnj: CNJ, semNumero: false, ementa: "APELAÇÃO CÍVEL." } as never },
  ]);
  dados.lembrarTextos([{ id: "tjma:5", texto: `${BASE} Razões da base, bastantes para o teste.`, indicioDeCorte: false, ...origem }]);
  return dados;
}

describe("textoEhDaBase — origem efetiva do texto guardado", () => {
  it("a origem gravada vale; sem origem, TJES e TJMA são tratados como da base e os demais não", () => {
    expect(textoEhDaBase({ origem: "base" }, "tjpr:1")).toBe(true);
    expect(textoEhDaBase({ origem: "portal" }, "tjma:1")).toBe(false);
    expect(textoEhDaBase({}, "tjma:1")).toBe(true);
    expect(textoEhDaBase({}, "tjes:1")).toBe(true);
    expect(textoEhDaBase({}, "tjpr:1")).toBe(false);
    expect(textoEhDaBase(undefined, "tjma:1")).toBe(false);
  });
});

describe("B07-R02 — base guardada → portal registrado → obter/ler/conferir", () => {
  it("o portal passa pelas guardas e o texto guardado passa a ser o do portal, com a fonte do portal", async () => {
    const portalCli = clienteFalso([resposta(portal())]);
    const { mcp } = await conectar(siteComRegistro(), falcaoFalso().cliente, { tribunais: () => portalCli.cliente });
    await chamar(mcp, "busca_direta", { tribunal: "tjma", texto: "exemplo" });
    // Antes do portal: a leitura é da base.
    const antes = await chamar(mcp, "ler_inteiro_teor", { id: "tjma:5" });
    expect(antes.dado.cabecalho.fonte).toBe(ROTULO);
    // O tribunal ganha portal com o texto da base ainda na memória.
    registrarPortal(PORTAL);
    const o = await chamar(mcp, "obter_inteiro_teor", { id: "tjma:5", tribunal: "tjma", link: LINK });
    expect(portalCli.chamadas).toHaveLength(1); // as guardas rodaram: a página do portal foi pedida
    expect(o.texto).not.toContain(BASE);
    const l = await chamar(mcp, "ler_inteiro_teor", { id: "tjma:5" });
    expect(l.dado.cabecalho.fonte).toBe("portal fictício do TJMA (portal.exemplo.jus.br)");
    expect(l.dado.cabecalho.natureza).not.toContain(ROTULO);
    expect(l.dado.texto).toContain("Razões fictícias do portal.");
    expect(l.dado.texto).not.toContain(BASE);
  });

  it("portal que falha nas guardas (outro processo): nada vira texto do portal; o que sobra continua rotulado como da base", async () => {
    const portalCli = clienteFalso([resposta(portal("0000009-99.2025.8.10.0009"))]);
    const dados = memoriaComBase({ origem: "base" });
    registrarPortal(PORTAL);
    const o = await obterInteiroTeor({ id: "tjma:5", tribunal: "tjma", link: LINK }, () => portalCli.cliente, dados);
    expect(portalCli.chamadas).toHaveLength(1);
    expect("explicacao" in o && o.explicacao).toMatch(/a página é de outro processo que o da busca/);
    const l = await lerTextoIntegral("tjma:5", 1, dados);
    expect(l.cabecalho.fonte).toBe(ROTULO);
    expect(l.cabecalho.natureza).toContain(ROTULO);
    expect(l.texto).toContain(BASE);
  });

  it("entrada antiga sem origem no TJMA: não satisfaz o cache do portal e é rotulada como da base", async () => {
    const portalCli = clienteFalso([resposta(portal())]);
    const dados = memoriaComBase({});
    expect((await lerTextoIntegral("tjma:5", 1, dados)).cabecalho.fonte).toBe(ROTULO);
    registrarPortal(PORTAL);
    await obterInteiroTeor({ id: "tjma:5", tribunal: "tjma", link: LINK }, () => portalCli.cliente, dados);
    expect(portalCli.chamadas).toHaveLength(1);
    const depois = await lerTextoIntegral("tjma:5", 1, dados);
    expect(depois.cabecalho.fonte).toBe("portal fictício do TJMA (portal.exemplo.jus.br)");
    expect(depois.texto).not.toContain(BASE);
  });
});
