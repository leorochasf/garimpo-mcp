import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { USER_AGENT } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { infoTribunal } from "../src/tribunais.js";
import { clienteFalso } from "./apoio.js";

const PDF = new TextEncoder().encode("%PDF-1.4\nconteudo ficticio do TJRR\n%%EOF");
const pdf = () => new Response(PDF, { headers: { "content-type": "application/pdf" } });
const LINK = "https://jurisprudencia.tjrr.jus.br/inteiroTeor.xhtml?id=12345";

let pasta: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-tjrr-"));
});
afterEach(() => rm(pasta, { recursive: true, force: true, maxRetries: 10 }));

describe("inteiro teor — TJRR (I-16 / G-23): um GET por documento, no endereço /pdf?id=", () => {
  it("o tribunal é marcado como baixa o PDF", () => {
    expect(infoTribunal("tjrr")?.inteiroTeor).toBe("baixa");
  });

  it("do link inteiroTeor.xhtml?id=N da busca pede direto /pdf?id=N (uma chamada), com o UA honesto, e guarda PDF com recibo", async () => {
    const { cliente, chamadas } = clienteFalso([pdf()]);
    const r = await obterInteiroTeor({ tribunal: "tjrr", link: LINK, pasta }, () => cliente);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe("https://jurisprudencia.tjrr.jus.br/pdf?id=12345");
    expect(new Headers(chamadas[0].init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(r).toMatchObject({ baixado: true, bytes: PDF.length });
    expect(await readdir(pasta)).toHaveLength(2);
  });

  it("página no lugar do PDF nunca vira PDF: erro claro, nada salvo", async () => {
    const pagina = new Response("<html>Erro</html>", { headers: { "content-type": "text/html" } });
    const { cliente } = clienteFalso([pagina]);
    await expect(obterInteiroTeor({ tribunal: "tjrr", link: LINK, pasta }, () => cliente)).rejects.toThrow(/no lugar do PDF/);
    expect(await readdir(pasta)).toEqual([]);
  });

  it("content-type PDF com corpo HTML não passa pelo reconhecimento do PDF", async () => {
    const { cliente } = clienteFalso([new Response("<html>Erro</html>", { headers: { "content-type": "application/pdf" } })]);
    await expect(obterInteiroTeor({ tribunal: "tjrr", link: LINK, pasta }, () => cliente)).rejects.toThrow(/no lugar do PDF/);
    expect(await readdir(pasta)).toEqual([]);
  });

  it.each(["https://outro.test/pdf?id=12345", "http://jurisprudencia.tjrr.jus.br/pdf?id=12345"])(
    "redirect para %s é barrado antes da segunda chamada", async (destino) => {
      const { cliente, chamadas } = clienteFalso([new Response(null, { status: 302, headers: { location: destino } })]);
      await expect(obterInteiroTeor({ tribunal: "tjrr", link: LINK, pasta }, () => cliente)).rejects.toThrow(/fora do portal oficial/);
      expect(chamadas).toHaveLength(1);
      expect(await readdir(pasta)).toEqual([]);
    },
  );

  it("TJPA continua só link sem nenhuma chamada ao portal", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    expect(infoTribunal("tjpa")?.inteiroTeor).toBe("link");
    const link = "https://jurisprudencia.tjpa.jus.br/#/documento/12345";
    const r = await obterInteiroTeor({ tribunal: "tjpa", link, pasta }, () => cliente);
    expect(r).toMatchObject({ baixado: false, link });
    expect(chamadas).toHaveLength(0);
    expect(await readdir(pasta)).toEqual([]);
  });

  it.each([
    "https://outro.test/inteiroTeor.xhtml?id=12345",
    "http://jurisprudencia.tjrr.jus.br/inteiroTeor.xhtml?id=12345",
    "https://jurisprudencia.tjrr.jus.br/inteiroTeor.xhtml?id=abc",
    "https://jurisprudencia.tjrr.jus.br/outra.xhtml?id=12345",
  ])("link fora do formato do TJRR (%s) é recusado antes de qualquer chamada", async (link) => {
    const { cliente, chamadas } = clienteFalso([]);
    await expect(obterInteiroTeor({ tribunal: "tjrr", link, pasta }, () => cliente)).rejects.toThrow(/fora do formato/);
    expect(chamadas).toHaveLength(0);
  });
});
