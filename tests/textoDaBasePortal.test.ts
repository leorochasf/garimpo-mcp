import { describe, expect, it } from "vitest";
import { Cliente, Vagas } from "../src/cliente.js";
import { type PortalComIntegra, registrarPortal } from "../src/paginaComIntegra.js";
import { clienteFalso, respostaJson } from "./apoio.js";
import { chamar, conectar, falcaoFalso } from "./apoioFalcao.js";

// Ticket 07: o caminho oficial prevalece. Arquivo à parte porque o registro de portais é global ao arquivo de teste:
// aqui o TJMA (fictício) ganha um portal; nos outros testes ele segue sem caminho oficial.

const CNJ = "0000001-11.2025.8.10.0001";
const ROTULO = "texto da base do JurisprudênciaIA, não oficial";
const LINK = "https://portal.exemplo.jus.br/acordao/77";
const html = "<html><body><p>EMENTA: texto fictício da base, que não pode ser usado quando há portal oficial.</p></body></html>";

describe("texto da base — o portal registrado no molde do 03 prevalece", () => {
  it("TJMA com portal: a busca nem guarda o texto da base, e o obter e o ler usam o portal", async () => {
    const portal: PortalComIntegra = {
      sigla: "tjma",
      host: "portal.exemplo.jus.br",
      caminho: /^\/acordao\/\d+$/,
      rotulo: "portal fictício do TJMA (portal.exemplo.jus.br)",
      processo: (h) => /id="processo">([^<]*)</.exec(h)?.[1],
      segredo: (h) => /id="segredo">([^<]*)</.exec(h)?.[1],
      integra: (h) => /<div id="integra">([\s\S]*?)<\/div>/.exec(h)?.[1],
    };
    registrarPortal(portal);
    const corpo = `ACÓRDÃO FICTÍCIO do portal. Processo ${CNJ}. ${"Razões fictícias do portal. ".repeat(12)}`;
    const pagina =
      `<html><body><span>Processo:</span> <b id="processo">${CNJ}</b> <span>Segredo de Justiça:</span> ` +
      `<b id="segredo">Não</b><div id="integra">${corpo}</div></body></html>`;
    const portalCli = clienteFalso([() => new Response(pagina, { headers: { "content-type": "text/html; charset=UTF-8" } })]);
    const site = new Cliente({
      nome: "O site",
      vagas: new Vagas(2),
      esperar: async () => {},
      fetch: (async () =>
        respostaJson({
          results: [
            {
              id: 5,
              numero_processo_cnj: CNJ,
              texto_ementa: "APELAÇÃO CÍVEL. Ementa fictícia.",
              link_pdf: "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64"),
            },
          ],
        })) as typeof fetch,
    });
    const { mcp } = await conectar(site, falcaoFalso().cliente, { tribunais: () => portalCli.cliente });
    await chamar(mcp, "busca_direta", { tribunal: "tjma", texto: "exemplo" });
    expect(JSON.stringify(portalCli.chamadas)).toBe("[]");
    const o = await chamar(mcp, "obter_inteiro_teor", { id: "tjma:5", tribunal: "tjma", link: LINK });
    expect(o.texto).not.toContain(ROTULO);
    expect(portalCli.chamadas).toHaveLength(1);
    const l = await chamar(mcp, "ler_inteiro_teor", { id: "tjma:5" });
    expect(l.dado.cabecalho.fonte).toBe("portal fictício do TJMA (portal.exemplo.jus.br)");
    expect(l.dado.cabecalho.natureza).not.toContain(ROTULO);
    expect(l.dado.texto).toContain("Razões fictícias do portal.");
  });
});
