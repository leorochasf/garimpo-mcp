import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

/** O fluxo de CI do repositório: permissão mínima, nenhum segredo, testes ao vivo desligados (G-84). */
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

/** Confere o conteúdo do YAML, não a escolha de aspas, espaços ou comentários (G-84). */
function conferir(texto: string) {
  const fluxo = parse(texto);
  expect(fluxo.permissions).toEqual({ contents: "read" });
  function visitar(valor: unknown) {
    if (typeof valor === "string") {
      expect(valor).not.toMatch(/\bsecrets\s*[.\[]|\bgithub\s*(?:\.\s*token\b|\[\s*["']token["']\s*\])|\bGITHUB_TOKEN\b/i);
      expect(valor).not.toMatch(/\bGARIMPO_VIVO\s*=\s*["']?1\b/);
    } else if (valor && typeof valor === "object") {
      for (const [chave, filho] of Object.entries(valor)) {
        if (chave === "permissions") expect(filho).toEqual({ contents: "read" });
        if (chave === "GARIMPO_VIVO") expect(filho).toBe("");
        visitar(chave);
        visitar(filho);
      }
    }
  }
  visitar(fluxo);
  expect(Object.keys(fluxo.jobs).length).toBeGreaterThan(0);
  for (const trabalho of Object.values(fluxo.jobs) as { env: Record<string, unknown>; steps: { uses?: string; with?: Record<string, unknown>; run?: string }[] }[]) {
    expect(trabalho.env?.GARIMPO_VIVO).toBe("");
    const checkout = trabalho.steps.find((p) => p.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    // Os três comandos precisam estar no mesmo passo isolado; comentário não satisfaz o teste.
    const isolado = trabalho.steps.find((p) => p.run && /\bunshare\s+--net\b/.test(p.run));
    expect(isolado).toBeDefined();
    for (const comando of ["npx tsc --noEmit", "npx vitest run", "npm run build"]) expect(isolado?.run).toContain(comando);
    expect(isolado?.run).toMatch(/\bGARIMPO_VIVO=/);
    expect(isolado?.run).toMatch(/\bnpm_config_offline=true\b/);
  }
}

describe(".github/workflows/ci.yml", () => {
  it("só lê, não usa segredos, desliga testes ao vivo e isola tipos/testes/build da rede", () => {
    conferir(ci);
  });

  it("aceita aspas, comentários e mapas inline equivalentes", () => {
    conferir(ci.replace("contents: read", "contents: 'read' # leitura")
      .replace('GARIMPO_VIVO: ""', "GARIMPO_VIVO: '' # desligado"));
    conferir(ci.replace(/permissions:\s*\n\s+contents: read/, 'permissions: {contents: "read"}'));
  });

  it.each([
    ["permissão ampla", (f: ReturnType<typeof parse>) => { f.permissions = "write-all"; }],
    ["permissão adicional no job", (f: ReturnType<typeof parse>) => { f.jobs.verificar.permissions = { contents: "read", actions: "write" }; }],
    ["segredo com ponto", (f: ReturnType<typeof parse>) => { f.jobs.verificar.env.CHAVE = "${{ secrets.CHAVE }}"; }],
    ["segredo com colchetes", (f: ReturnType<typeof parse>) => { f.jobs.verificar.env.CHAVE = "${{ secrets['CHAVE'] }}"; }],
    ["token do contexto", (f: ReturnType<typeof parse>) => { f.jobs.verificar.env.CHAVE = "${{ github['token'] }}"; }],
    ["vivo sobrescrito no passo", (f: ReturnType<typeof parse>) => { f.jobs.verificar.steps.at(-1).env = { GARIMPO_VIVO: "1" }; }],
    ["vivo ligado pelo shell", (f: ReturnType<typeof parse>) => { f.jobs.verificar.steps.at(-1).run += '\nexport GARIMPO_VIVO="1"'; }],
    ["checkout guarda credenciais", (f: ReturnType<typeof parse>) => { f.jobs.verificar.steps[0].with["persist-credentials"] = true; }],
    ["passo perde isolamento", (f: ReturnType<typeof parse>) => { f.jobs.verificar.steps.at(-1).run = "npx tsc --noEmit\nnpx vitest run\nnpm run build"; }],
    ["testes só no comentário", (f: ReturnType<typeof parse>) => { f.jobs.verificar.steps.at(-1).run = f.jobs.verificar.steps.at(-1).run.replace("npx vitest run", ""); }],
  ])("rejeita %s", (_nome, mudar) => {
    const fluxo = parse(ci);
    mudar(fluxo);
    expect(() => conferir(stringify(fluxo) + "\n# npx vitest run\n")).toThrow();
  });
});
