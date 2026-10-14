import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { avisoDeBaixaTcu, baixarAnoTcu, clienteDoTcu, listarAnosDoTcu } from "../src/tcuBaixar.js";
import { pesquisarTcu } from "../src/tcuLocal.js";

// Teste ao vivo opcional (validação do TCU, ADR-0024): 1 chamada à lista de arquivos e 1 download do MENOR ano
// listado (cerca de 15 MB), para uma pasta temporária. Só com GARIMPO_VIVO_TCU=1 e GARIMPO_VIVO desligado,
// executando apenas este arquivo. Confere o formato real da lista, o cabeçalho do CSV e uma pesquisa de ponta a ponta.
describe.skipIf(process.env.GARIMPO_VIVO_TCU !== "1" || process.env.GARIMPO_VIVO === "1")("TCU — ao vivo", () => {
  it("lista os anos, baixa o menor e pesquisa nele", { timeout: 900_000 }, async () => {
    const cliente = clienteDoTcu();
    const lista = await listarAnosDoTcu(cliente);
    const menor = [...lista.anos].filter((a) => a.tamanhoMb).sort((a, b) => a.tamanhoMb! - b.tamanhoMb!)[0];
    console.log(JSON.stringify({ baseEm: lista.baseEm, anos: lista.anos.length, menor }));
    expect(menor).toBeDefined();

    const dados = await mkdtemp(join(tmpdir(), "garimpo-vivo-tcu-"));
    expect((await avisoDeBaixaTcu(dados, lista, [menor.ano])).precisaConfirmar).toBe(true);
    const baixa = await baixarAnoTcu({ dados, cliente, ano: menor.ano, listaEm: lista.baseEm });
    console.log(JSON.stringify(baixa));

    const r = await pesquisarTcu(dados, { consulta: "licitação", limite: 3 });
    console.log(JSON.stringify({ total: r.total, base: r.anosUsados, primeiro: r.resultados[0]?.titulo }));
    expect(r.anosUsados).toHaveLength(1);
  });
});
