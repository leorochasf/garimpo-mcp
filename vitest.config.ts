import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Cada arquivo de teste usa uma pasta de dados temporária própria, nunca a pasta real do usuário.
  // As suítes gravam muitos arquivos: limitar workers evita disputar o disco até estourar os prazos no Windows.
  // .claude/ guarda os worktrees do Claude Code (outra cópia do repositório): os testes de lá não são os deste.
  test: {
    setupFiles: ["tests/preparo.ts"],
    maxWorkers: 4,
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
