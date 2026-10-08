import { defineConfig } from "vitest/config";

export default defineConfig({
  // Cada arquivo de teste usa uma pasta de dados temporária própria, nunca a pasta real do usuário.
  test: { setupFiles: ["tests/preparo.ts"] },
});
