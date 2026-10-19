import { describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { Memoria } from "../src/memoria.js";

// Teste ao vivo opcional (ADR-0028): UMA busca (2 chamadas) e UM inteiro teor (2 chamadas), pelo Cliente real
// (UA honesto, freios). Só com GARIMPO_VIVO_TRF2=1 e sem outra prova ao vivo em curso.
describe.skipIf(process.env.GARIMPO_VIVO_TRF2 !== "1")("TRF2 — ao vivo", () => {
  it("a busca traz acórdãos com ementa e link do inteiro teor; o inteiro teor vem como texto do portal do tribunal", { timeout: 120_000 }, async () => {
    const memoria = new Memoria();
    const cliente = new Cliente({ nome: "O e-Proc do TRF2" });
    const r = await buscaDireta(cliente, { tribunal: "trf2", texto: "aposentadoria especial", limite: 3 }, memoria, { eproc: cliente });
    expect(r.acordaos.length).toBeGreaterThan(0);
    for (const a of r.acordaos) {
      expect(a.ementa.length).toBeGreaterThan(50);
      expect(a.link).toMatch(/^https:\/\/eproc\.trf2\.jus\.br\//);
    }
    const t = await obterInteiroTeor({ id: r.acordaos[0].id }, () => cliente, memoria);
    expect(t.baixado).toBe(false);
    expect((await memoria.obterTexto(r.acordaos[0].id))?.texto.length).toBeGreaterThan(500);
  });
});
