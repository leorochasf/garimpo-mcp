import { defineConfig } from "vitest/config";

export default defineConfig({
  // Cada arquivo de teste usa uma pasta de dados temporária própria, nunca a pasta real do usuário.
  // As suítes gravam muitos arquivos: limitar workers evita disputar o disco até estourar os prazos no Windows.
  test: { setupFiles: ["tests/preparo.ts"], maxWorkers: 4 },
});
