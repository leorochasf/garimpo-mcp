import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Pastas locais de ferramentas de agente nunca entram no repositório. */
function ignorado(caminho: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", caminho]);
    return true;
  } catch {
    return false;
  }
}

describe(".gitignore", () => {
  it("ignora .codex/ e .overclock-app/", () => {
    expect(ignorado(".codex/hooks.json")).toBe(true);
    expect(ignorado(".overclock-app/qualquer.txt")).toBe(true);
    expect(ignorado("entrada-stf/RepercussaoGeral.xls")).toBe(true);
  });
});
