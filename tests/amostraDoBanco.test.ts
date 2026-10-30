import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A régua do banco de provas 1.2 não muda no meio (docs/banco-de-provas/protocolo-1.2.md, seção 2): cada arquivo de que
 * a amostra depende tem o sha-256 gravado nela. Hash do conteúdo com fim de linha LF, para valer com e sem autocrlf.
 */
const amostra = JSON.parse(readFileSync("docs/banco-de-provas/amostra-1.2.json", "utf8"));
const sha = (arquivo: string) => createHash("sha256").update(readFileSync(arquivo, "utf8").replace(/\r\n/g, "\n")).digest("hex");

describe("amostra congelada do banco de provas 1.2", () => {
  it("cada arquivo de base confere com o hash gravado na amostra", () => {
    const base = Object.values(amostra.base) as { arquivo: string; sha256: string }[];
    expect(base.length).toBeGreaterThanOrEqual(4);
    for (const b of base) expect(sha(b.arquivo), b.arquivo).toBe(b.sha256);
  });

  it("tem ao menos 10 armadilhas e as 5 fixtures de injeção que cita", () => {
    expect(amostra.estratos.E3.casos.length).toBeGreaterThanOrEqual(10);
    const injecao = JSON.parse(readFileSync(amostra.base.injecao.arquivo, "utf8"));
    expect(injecao.casos.map((c: { id: string }) => c.id)).toEqual(amostra.estratos.E6.fixtures);
  });
});
