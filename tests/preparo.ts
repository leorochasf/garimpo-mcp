import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach } from "vitest";

// A pasta de dados (vagas e pausas compartilhadas) dos testes é temporária: nunca a do usuário.
const pasta = mkdtempSync(join(tmpdir(), "garimpo-teste-"));
process.env.GARIMPO_DADOS = pasta;
// Cada teste começa com o estado de proteção zerado: o disjuntor aberto por uma recusa num teste não vale no
// seguinte.
afterEach(() => rmSync(join(pasta, "protecao", "estado.json"), { force: true }));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
