import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { textoDoTjpi } from "../src/tjpi.js";

// Testes ao vivo opcionais (I-16 / G-23): UMA chamada por tribunal, pelo Cliente real (UA honesto, freios). O link vem
// do JurisprudênciaIA (GARIMPO_VIVO_TJRR_LINK, GARIMPO_VIVO_TJPI_LINK). Só com GARIMPO_VIVO_TJRR=1 / GARIMPO_VIVO_TJPI=1
// e sem outra prova ao vivo em curso.
describe.skipIf(process.env.GARIMPO_VIVO_TJRR !== "1")("TJRR — ao vivo", () => {
  it("o link da busca leva a um PDF de verdade", { timeout: 60_000 }, async () => {
    const pasta = await mkdtemp(join(tmpdir(), "garimpo-vivo-tjrr-"));
    try {
      const link = process.env.GARIMPO_VIVO_TJRR_LINK!;
      const r = await obterInteiroTeor({ tribunal: "tjrr", link, pasta }, () => new Cliente({ nome: "O TJRR" }));
      expect(r.baixado).toBe(true);
      if (r.baixado) expect(r.bytes).toBeGreaterThan(1000);
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.env.GARIMPO_VIVO_TJPI !== "1")("TJPI — ao vivo", () => {
  it("a página do link traz o texto do acórdão", { timeout: 60_000 }, async () => {
    const link = process.env.GARIMPO_VIVO_TJPI_LINK!;
    const r = await textoDoTjpi(new Cliente({ nome: "O TJPI" }), link, {});
    expect(r?.texto.length).toBeGreaterThan(200);
  });
});
