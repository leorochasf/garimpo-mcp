import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// A pasta de dados (vagas e pausas compartilhadas) dos testes é temporária: nunca a do usuário.
const pasta = mkdtempSync(join(tmpdir(), "garimpo-teste-"));
process.env.GARIMPO_DADOS = pasta;
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
