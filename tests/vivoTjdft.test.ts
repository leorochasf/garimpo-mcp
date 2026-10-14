import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { textoDoTjdft } from "../src/tjdft.js";

// Teste ao vivo opcional do TJDFT: UMA chamada à API de pesquisa, pelo Cliente real (UA honesto, freio preventivo,
// disjuntor), com o acórdão indicado nas variáveis GARIMPO_VIVO_TJDFT_LINK (link do JurisprudênciaIA) e
// GARIMPO_VIVO_TJDFT_EMENTA (ementa dele). Só com GARIMPO_VIVO_TJDFT=1 e sem outra prova ao vivo em curso.
describe.skipIf(process.env.GARIMPO_VIVO_TJDFT !== "1")("TJDFT — ao vivo", () => {
  it("o link do acórdão leva ao registro certo, com texto", { timeout: 60_000 }, async () => {
    const link = process.env.GARIMPO_VIVO_TJDFT_LINK!;
    const r = await textoDoTjdft(new Cliente({ nome: "O TJDFT" }), link, { ementa: process.env.GARIMPO_VIVO_TJDFT_EMENTA });
    expect(r?.motivoSemTexto).toBeUndefined();
    expect(r?.texto.length).toBeGreaterThan(200);
  });
});
