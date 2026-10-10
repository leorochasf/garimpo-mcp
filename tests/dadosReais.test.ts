import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md, regra 2: nenhum dado de processo real no repositório.
 * Os números reais já encontrados ficam só como hash (dígitos, sem pontuação), para não reaparecerem aqui.
 */
const REAIS_CONHECIDOS = new Set([
  "4c0a2f73da02c7e2d7d15ada1348215a0e6ad68145a28c5bc5ccad8f51b4abe4",
  "ab91aa730965bcfa246a215c6a65632cdadd74c809a005d9b236454e5d9da740",
  "f251dcf576f00282e6f508bc6e6a42a6d0c710bb1d794acabb2a59242f0c92ab",
]);

/** Número no formato do STJ ("1.234.567/SP"); fictícios aceitos: 1.000.00X e 1.234.567. */
const FORMATO_STJ = /\b\d\.\d{3}\.\d{3}\/[A-Z]{2}\b/g;
const FICTICIO = /^1\.(000\.\d{3}|234\.567)\//;

// As tabelas de precedentes são cópia de fonte oficial (ADR-0015: Portal de Dados Abertos do STJ; arquivos do portal
// do STF): os processos citados nas teses e os paradigmas são dados públicos da fonte, não de usuário.
const arquivos = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(md|ts|json)$/.test(f) && f !== "package-lock.json" && !/^dados\/tabela-precedentes-st[fj]\.json$/.test(f));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("dados reais", () => {
  it("nenhum número de processo real nos arquivos do repositório", () => {
    const achados: string[] = [];
    for (const f of arquivos) {
      const texto = readFileSync(f, "utf8");
      for (const m of texto.match(FORMATO_STJ) ?? []) if (!FICTICIO.test(m)) achados.push(`${f}: formato STJ ${m}`);
      for (const m of texto.match(/\d[\d.]{4,}\d/g) ?? []) {
        if (REAIS_CONHECIDOS.has(sha(m.replace(/\./g, "")))) achados.push(`${f}: número real conhecido`);
      }
    }
    expect(achados).toEqual([]);
  });
});
