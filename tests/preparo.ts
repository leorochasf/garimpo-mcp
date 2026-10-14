import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

// A pasta de dados (vagas e pausas compartilhadas) dos testes é temporária: nunca a do usuário. Nasce no beforeAll,
// não ao carregar o arquivo: num arquivo com todos os testes pulados (os ao vivo) o Vitest não roda o afterAll, e a
// pasta criada ficava vazia no %TEMP%.
let pasta: string;
beforeAll(() => {
  pasta = mkdtempSync(join(tmpdir(), "garimpo-teste-"));
  process.env.GARIMPO_DADOS = pasta;
});
// Os testes que gravam centenas de acórdãos no disco ou rodam o disjuntor entre janelas levam de 2 a 6 s com a máquina
// carregada: o prazo padrão de 5 s derrubava um deles ao acaso.
vi.setConfig({ testTimeout: 20_000 });
// Cada teste começa com o estado de proteção zerado: o disjuntor aberto por uma recusa num teste não vale no
// seguinte.
afterEach(() => rmSync(join(pasta, "protecao", "estado.json"), { force: true }));
// A memória grava por trás das respostas: uma leva atrasada pode recriar a pasta (ou um arquivo dentro dela) enquanto
// ela é apagada, e o rmSync falha com ENOTEMPTY mesmo com novas tentativas. Apaga até a pasta ficar meio segundo sem
// voltar; erro de remoção é só nova rodada, e esgotadas as rodadas a pasta sobra no %TEMP% sem derrubar o arquivo.
// As 20 pausas somam até 10 s, além dos retries do rmSync: o prazo padrão de 10 s não cobre esta limpeza.
afterAll(async () => {
  for (let rodada = 0; rodada < 20; rodada++) {
    try {
      rmSync(pasta, { recursive: true, force: true, maxRetries: 10 });
    } catch (erro) {
      if (rodada === 19) console.warn(`[preparo] não consegui apagar ${pasta}: ${(erro as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
    if (!existsSync(pasta)) return;
  }
}, 120_000);
