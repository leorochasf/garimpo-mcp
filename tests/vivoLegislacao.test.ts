import { describe, expect, it } from "vitest";
import { clienteDaLegislacao, textoDeLei } from "../src/legislacao.js";

// Teste ao vivo opcional: 1 chamada ao normas.leg.br (a norma inteira, ~4 MB). Só com GARIMPO_VIVO=1.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("texto_de_lei — ao vivo", () => {
  it("traz o caput do art. 85 do CPC com URL oficial e o aviso fixo", { timeout: 120_000 }, async () => {
    const r = await textoDeLei({ diploma: "CPC", dispositivo: "art. 85, caput" }, { cliente: clienteDaLegislacao() });

    expect(r.resultado).toBe("encontrado");
    if (r.resultado !== "encontrado") return;
    expect(r.urlOficial).toMatch(/^https:\/\/normas\.leg\.br\/\?urn=urn:lex:br:federal:lei:2015-03-16;13105!art85/);
    expect(r.partes[0].texto).toMatch(/honorários ao advogado do vencedor/);
    expect(r.aviso).toMatch(/não afirma vigência/);
  });
});
