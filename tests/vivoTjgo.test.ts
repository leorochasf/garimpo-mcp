import { describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { Memoria } from "../src/memoria.js";

// Teste ao vivo opcional (ADR-0029): 1 busca no site e o inteiro teor do 1.º acórdão do TJGO pelo Projudi (4 ou 5
// chamadas, uma por vez), pelo Cliente real (UA honesto, freios). Só com GARIMPO_VIVO_TJGO=1 e sem outra prova ao vivo
// em curso. O texto da busca é genérico (GARIMPO_VIVO_TJGO_TEXTO muda).
describe.skipIf(process.env.GARIMPO_VIVO_TJGO !== "1")("TJGO — ao vivo", () => {
  it("o acórdão da busca vem do Projudi como texto do portal, com a ementa da busca", { timeout: 120_000 }, async () => {
    const memoria = new Memoria();
    const texto = process.env.GARIMPO_VIVO_TJGO_TEXTO ?? "dano moral negativação indevida";
    const busca = await buscaDireta(new Cliente({ nome: "O JurisprudênciaIA" }), { tribunal: "tjgo", texto, limite: 1 }, memoria);
    const [a] = busca.acordaos;
    const r = await obterInteiroTeor({ id: a.id }, () => new Cliente({ nome: "O TJGO" }), memoria);
    expect(r.baixado ? "" : r.explicacao).toMatch(/texto do portal do tribunal/);
    expect((await memoria.obterTexto(a.id))?.texto.length).toBeGreaterThan(500);
  });
});
