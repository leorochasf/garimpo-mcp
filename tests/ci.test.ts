import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** O fluxo de CI do repositório: permissão mínima, nenhum segredo, testes ao vivo desligados (G-84). */
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

describe(".github/workflows/ci.yml", () => {
  it("só lê o código: permissão contents: read e nenhuma de escrita", () => {
    expect(ci).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(ci).not.toMatch(/:\s*write\b/);
  });

  it("não usa segredo nem token", () => {
    expect(ci).not.toMatch(/secrets\./i);
    expect(ci).not.toMatch(/GITHUB_TOKEN/);
  });

  it("deixa os testes ao vivo desligados", () => {
    expect(ci).toMatch(/^\s+GARIMPO_VIVO: ""\s*$/m);
    expect(ci).not.toMatch(/GARIMPO_VIVO: *["']?1/);
  });

  it("roda tipos, testes e build, e não deixa o checkout guardar credenciais", () => {
    for (const passo of ["npx tsc --noEmit", "npx vitest run", "npm run build"]) expect(ci).toContain(passo);
    expect(ci).toMatch(/persist-credentials: false/);
  });
});
