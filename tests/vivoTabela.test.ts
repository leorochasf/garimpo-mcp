import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clienteDoGerador, gerarEGravar } from "../scripts/gerarTabela.js";

// Teste ao vivo opcional do gerador: 3 chamadas ao portal de dados do STJ, 10 s entre elas. Só com GARIMPO_VIVO=1.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("gerador da tabela — ao vivo", () => {
  it("baixa o conjunto e grava uma tabela com Tema e IAC", { timeout: 120_000 }, async () => {
    const destino = join(mkdtempSync(join(tmpdir(), "garimpo-tabela-vivo-")), "tabela.json");
    const tabela = await gerarEGravar(clienteDoGerador(), destino);
    expect(tabela.linhas.some((l) => l.tipo === "tema repetitivo" && l.numero === 1)).toBe(true);
    expect(tabela.linhas.some((l) => l.tipo === "IAC" && l.numero === 1)).toBe(true);
    expect(JSON.parse(readFileSync(destino, "utf8")).linhas).toHaveLength(tabela.linhas.length);
  });
});
