import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { opcoesDoTribunal } from "../src/inteiroTeor.js";
import { textoDoTjpr } from "../src/tjpr.js";

// Teste ao vivo opcional (ADR-0030): UMA chamada ao portal do TJPR, pelo Cliente real (UA honesto, freios). O link vem
// do JurisprudênciaIA (GARIMPO_VIVO_TJPR_LINK). Só com GARIMPO_VIVO_TJPR=1 e sem outra prova ao vivo em curso.
describe.skipIf(process.env.GARIMPO_VIVO_TJPR !== "1")("TJPR — ao vivo", () => {
  it("a página do link traz a íntegra do acórdão", { timeout: 60_000 }, async () => {
    const link = process.env.GARIMPO_VIVO_TJPR_LINK!;
    const r = await textoDoTjpr(new Cliente(opcoesDoTribunal("tjpr")), link, {});
    expect(r?.texto.length).toBeGreaterThan(200);
  });
});
