import { describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { Memoria } from "../src/memoria.js";

// Teste ao vivo opcional (D-07 / G-31, ADR-0024): UMA busca (2 chamadas) e UM inteiro teor (2 chamadas), pelo Cliente real
// (UA honesto, freios). Só com GARIMPO_VIVO_TRF4=1 e sem outra prova ao vivo em curso. Repete a validação da lista
// de 2026-10-14 (recorte saneado na fixture) e verifica o download pelo adaptador, ainda não validado nessa rodada.
describe.skipIf(process.env.GARIMPO_VIVO_TRF4 !== "1")("TRF4 — ao vivo", () => {
  it("a busca traz acórdãos com ementa e link do inteiro teor; o inteiro teor vem como texto do portal", { timeout: 120_000 }, async () => {
    const memoria = new Memoria();
    const cliente = new Cliente({ nome: "O e-Proc do TRF4" });
    const r = await buscaDireta(cliente, { tribunal: "trf4", texto: "contribuição previdenciária", limite: 3 }, memoria, { eproc: cliente });
    expect(r.acordaos.length).toBeGreaterThan(0);
    for (const a of r.acordaos) {
      expect(a.ementa.length).toBeGreaterThan(50);
      expect(a.link).toMatch(/^https:\/\/eproc-jur\.trf4\.jus\.br\//);
    }
    const t = await obterInteiroTeor({ id: r.acordaos[0].id }, () => cliente, memoria);
    expect(t.baixado).toBe(false);
    expect((await memoria.obterTexto(r.acordaos[0].id))?.texto.length).toBeGreaterThan(500);
  });
});
