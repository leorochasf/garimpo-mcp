import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lerParaConferir } from "../src/leitura.js";
import {
  FRASES_DE_AUTORIA,
  LINHA_DE_CARIMBO,
  pdfComDispositivoECertidao,
  pdfComSinaisDeAutoria,
  pdfEmentaPadronizada,
  pdfMisto,
  pdfMuitasPaginas,
  pdfSoCarimbos,
  pdfUnanimeComDivergencia,
  TITULOS_DA_EMENTA,
} from "./pdfSintetico.js";

let pasta: string;
beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-pdf-sintetico-"));
});
afterAll(() => rm(pasta, { recursive: true, force: true }));

/** Grava o PDF e lê pelo mesmo caminho da conferência: páginas e texto de cada uma. */
async function ler(pdf: Uint8Array, nome: string) {
  const caminho = join(pasta, `${nome}.pdf`);
  await writeFile(caminho, pdf);
  const lido = await lerParaConferir(caminho);
  const textos = lido.unidades.map((u) => u.texto);
  return { lido, textos, tudo: textos.join("\n") };
}

describe("PDFs sintéticos de acórdão", () => {
  it("pdfSoCarimbos: uma linha de assinatura por página, ~80 caracteres", async () => {
    const { lido, textos } = await ler(pdfSoCarimbos(4), "carimbos");
    expect(lido.totalDePaginas).toBe(4);
    for (const t of textos) {
      expect(t).toContain(LINHA_DE_CARIMBO);
      expect(t.length).toBeLessThan(120);
    }
    expect(LINHA_DE_CARIMBO.length).toBeGreaterThan(70);
  });

  it("pdfMisto: páginas nativas primeiro, depois só carimbo", async () => {
    const { lido, textos } = await ler(pdfMisto(3, 2), "misto");
    expect(lido.totalDePaginas).toBe(5);
    expect(textos.slice(0, 3).every((t) => t.includes("(nativa)") && !t.includes(LINHA_DE_CARIMBO))).toBe(true);
    expect(textos.slice(3).every((t) => t.includes(LINHA_DE_CARIMBO))).toBe(true);
  });

  it("pdfMuitasPaginas: milhares de páginas curtas", async () => {
    const { lido, textos } = await ler(pdfMuitasPaginas(3000), "muitas");
    expect(lido.totalDePaginas).toBe(3000);
    expect(textos[0]).toContain("Pagina 1 de 3000");
    expect(textos[2999]).toContain("Pagina 3000 de 3000");
  }, 60_000);

  it("pdfEmentaPadronizada: os quatro títulos, na ordem", async () => {
    const { tudo } = await ler(pdfEmentaPadronizada(), "ementa");
    const posicoes = TITULOS_DA_EMENTA.map((t) => tudo.indexOf(t));
    expect(posicoes.every((p) => p >= 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  it("pdfComDispositivoECertidao: 'Ante o exposto', certidão e fecho com a câmara pedida", async () => {
    const padrao = await ler(pdfComDispositivoECertidao(), "fecho-padrao");
    expect(padrao.tudo).toContain("Ante o exposto");
    expect(padrao.tudo).toContain("CERTIDAO DE JULGAMENTO");
    expect(padrao.tudo).toContain("Acordam os Magistrados da 3ª Camara");
    const outra = await ler(pdfComDispositivoECertidao(7), "fecho-outra");
    expect(outra.tudo).toContain("Acordam os Magistrados da 7ª Camara");
    expect(outra.tudo).not.toContain("3ª Camara");
  });

  it("pdfComSinaisDeAutoria: negação, alegação, ementa transcrita, voto divergente sem título e hipotético", async () => {
    const { lido, tudo } = await ler(pdfComSinaisDeAutoria(), "autoria");
    expect(lido.totalDePaginas).toBe(5);
    for (const frase of Object.values(FRASES_DE_AUTORIA)) expect(tudo).toContain(frase);
    expect(tudo).not.toMatch(/VOTO DIVERGENTE|VOTO VENCIDO/i);
  });

  it("pdfUnanimeComDivergencia: acórdão unânime que contém a palavra 'divergência'", async () => {
    const { tudo } = await ler(pdfUnanimeComDivergencia(), "unanime");
    expect(tudo).toContain("divergencia");
    expect(tudo).toContain("por unanimidade");
  });
});
