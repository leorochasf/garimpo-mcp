import { describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { clienteDoFalcao } from "../src/falcao.js";

// Testes ao vivo opcionais do Falcão: duas buscas (1 página de 10 cada), com tese genérica, pelo Cliente real (UA de
// navegador, 1 s, freio preventivo, disjuntor). Só com GARIMPO_VIVO=1 e sem outra prova ao vivo em curso. A pasta de
// dados é a temporária dos testes (tests/preparo.ts): nada gravado na pasta do usuário.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("Falcão — ao vivo", () => {
  it("busca direta no TRT3 devolve acórdãos com id, fonte e cobertura", { timeout: 60_000 }, async () => {
    const r = await buscaDireta(clienteDoFalcao(), { tribunal: "trt3", texto: "intervalo intrajornada" });
    expect(r.acordaos.length).toBeGreaterThan(0);
    expect(r.acordaos[0].id).toMatch(/^trt3:\w+$/);
    expect(r.fonte).toMatch(/^Falcão/);
    expect(r.cabecalhoDeCobertura).toMatch(/o Garimpo recebeu \d+ e mostra \d+/);
  });

  it("decisoes: monocraticas no TRT2 devolve metadados sem texto (uma chamada a mais)", { timeout: 60_000 }, async () => {
    const r = await buscaDireta(clienteDoFalcao(), { tribunal: "trt2", texto: "adicional de insalubridade", decisoes: "monocraticas" });
    expect(r.acordaos).toEqual([]);
    expect(r.decisoes!.length).toBeGreaterThan(0);
    expect(r.decisoes![0].id).toMatch(/^trt2:decisoesmonocraticas:\w+$/);
    expect(JSON.stringify(r)).not.toMatch(/conteudoDocumento|textoDocumentoAnonim/);
  });
});
