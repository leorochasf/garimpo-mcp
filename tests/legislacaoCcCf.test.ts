import { describe, expect, it } from "vitest";
import { textoDeLei } from "../src/legislacao.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

// Recortes das respostas reais de https://normas.leg.br/api/public/normas?urn=...&&tipo_documento=maior-detalhe
// (obtidas em 14/10/2026): CC (Lei 10.406/2002: arts. 50, 186, 187 e 229) e CF/88 (arts. 5º, 16 e 117), cada um com a
// subárvore que a fonte entregou. Os textos esperados são literais copiados dessa página, não calculados pelo código.
const CC = fixture("legislacao/cc-recorte.json");
const CF = fixture("legislacao/cf-recorte.json");
const AGORA = new Date(2026, 9, 14, 10, 30).getTime();

async function consultar(diploma: string, dispositivo: string, resposta: unknown) {
  const { cliente, chamadas } = clienteFalso([respostaJson(resposta)]);
  const r = await textoDeLei({ diploma, dispositivo }, { cliente, agora: () => AGORA });
  return { r, chamadas };
}

describe("texto_de_lei — Código Civil", () => {
  it("art. 186: texto literal do caput, com a decisão do STF anotada pela fonte como nota dela, sem concluir vigência", async () => {
    const { r, chamadas } = await consultar("CC", "art. 186", CC);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(
      "https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:lei:2002-01-10;10406&&tipo_documento=maior-detalhe",
    );
    if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);
    expect(r.diploma).toEqual({ sigla: "CC", nome: "Lei nº 10.406, de 10 de janeiro de 2002" });
    expect(r.urlOficial).toBe("https://normas.leg.br/?urn=urn:lex:br:federal:lei:2002-01-10;10406!art186");
    expect(r.partes[0]).toMatchObject({
      dispositivo: "art. 186, caput",
      texto:
        "Aquele que, por ação ou omissão voluntária, negligência ou imprudência, violar direito e causar dano a outrem, ainda que exclusivamente moral, comete ato ilícito.",
    });
    expect(r.partes[0].versoesNaFonte![0]).toMatchObject({
      tipoNaFonte: "Original_Version",
      periodoNaFonte: "2002-01-10/2024-05-21",
      forcaMarcadaPelaFonte: "NotInForce",
    });
    expect(r.partes[0].versoesNaFonte![1].notaDaFonte).toMatch(/^Foi conferida interpretação conforme a Constituição ao caput dos arts\. 186 e 927/);
    expect(r.aviso).toBe("texto conforme a página oficial em 14/10/2026; o Garimpo não afirma vigência");
  });

  it("art. 229, caput: redação antiga e '(Revogado)' como a fonte mostra, com a lei revogadora", async () => {
    const { r } = await consultar("Código Civil", "art. 229, caput", CC);
    if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);

    expect(r.partes[0].texto).toBe("(Revogado)");
    expect(r.partes[0].versoesNaFonte![0].texto).toBe("Ninguém pode ser obrigado a depor sobre fato:");
    expect(r.partes[0].versoesNaFonte![1]).toMatchObject({ tipoNaFonte: "Repeal_Version", alteradoPor: "Lei nº 13.105 de 16/03/2015" });
  });

  it.each(["CC", "cc/2002", "Código Civil", "lei 10.406/2002", "Lei 10406/2002"])("reconhece o diploma %s", async (diploma) => {
    expect((await consultar(diploma, "art. 187", CC)).r.diploma.sigla).toBe("CC");
  });
});

describe("texto_de_lei — Constituição Federal", () => {
  it("art. 5º, caput: texto literal e URL oficial da Constituição", async () => {
    const { r, chamadas } = await consultar("CF", "art. 5º, caput", CF);

    expect(chamadas[0].url).toBe(
      "https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:constituicao:1988-10-05;1988&&tipo_documento=maior-detalhe",
    );
    if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);
    expect(r.diploma).toEqual({ sigla: "CF", nome: "Constituição da República Federativa do Brasil" });
    expect(r.urlOficial).toBe("https://normas.leg.br/?urn=urn:lex:br:federal:constituicao:1988-10-05;1988!art5_cpt");
    expect(r.partes[0]).toMatchObject({
      dispositivo: "art. 5º, caput",
      texto:
        "Todos são iguais perante a lei, sem distinção de qualquer natureza, garantindo-se aos brasileiros e aos estrangeiros residentes no País a inviolabilidade do direito à vida, à liberdade, à igualdade, à segurança e à propriedade, nos termos seguintes:",
    });
  });

  it.each(["CF", "CF/88", "CRFB/1988", "Constituição Federal", "constituicao federal de 1988"])("reconhece o diploma %s", async (diploma) => {
    expect((await consultar(diploma, "art. 5º, caput", CF)).r.diploma.sigla).toBe("CF");
  });
});

describe("texto_de_lei — diplomas não provados", () => {
  it("diploma fora da lista (ex.: ECA): erro que ensina, com a lista que começa por CPC, CC e CF, e nenhuma chamada", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    await expect(textoDeLei({ diploma: "ECA", dispositivo: "art. 14" }, { cliente })).rejects.toThrow(
      /não reconheceu o diploma "ECA".*CPC, CC, CF/,
    );
    expect(chamadas).toHaveLength(0);
  });
});
