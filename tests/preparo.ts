import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, vi } from "vitest";

// A pasta de dados (vagas e pausas compartilhadas) dos testes é temporária: nunca a do usuário.
const pasta = mkdtempSync(join(tmpdir(), "garimpo-teste-"));
process.env.GARIMPO_DADOS = pasta;
// Os testes que gravam centenas de acórdãos no disco ou rodam o disjuntor entre janelas levam de 2 a 6 s com a máquina
// carregada: o prazo padrão de 5 s derrubava um deles ao acaso.
vi.setConfig({ testTimeout: 20_000 });
// Cada teste começa com o estado de proteção zerado: o disjuntor aberto por uma recusa num teste não vale no
// seguinte.
afterEach(() => rmSync(join(pasta, "protecao", "estado.json"), { force: true }));
// A memória grava por trás das respostas: uma leva atrasada pode recriar a pasta logo depois de apagada. Apaga até
// ela ficar meio segundo sem voltar.
afterAll(async () => {
  do {
    rmSync(pasta, { recursive: true, force: true, maxRetries: 10 });
    await new Promise((r) => setTimeout(r, 500));
  } while (existsSync(pasta));
});
