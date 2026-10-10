import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lerInteiroTeor, lerParaConferir, type OpcoesDeLeitura, TETO_DE_PAGINAS } from "../src/leitura.js";
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
async function ler(pdf: Uint8Array, nome: string, opcoes?: OpcoesDeLeitura) {
  const caminho = join(pasta, `${nome}.pdf`);
  await writeFile(caminho, pdf);
  const lido = await lerParaConferir(caminho, opcoes);
  const textos = lido.unidades.map((u) => u.texto);
  return { caminho, lido, textos, tudo: textos.join("\n") };
}

/** O fluxo do PDF como texto: o que a página desenha, antes de a leitura descartar a página quase sem texto. */
const bruto = (pdf: Uint8Array) => Buffer.from(pdf).toString("latin1");

describe("PDFs sintéticos de acórdão", () => {
  it("pdfSoCarimbos: uma linha de assinatura por página, ~80 caracteres, que a leitura não conta como texto", async () => {
    const pdf = pdfSoCarimbos(4);
    for (let n = 1; n <= 4; n++) expect(bruto(pdf)).toContain(`${LINHA_DE_CARIMBO} - pagina ${n}`);
    expect(LINHA_DE_CARIMBO.length).toBeGreaterThan(70);
    expect(LINHA_DE_CARIMBO.length).toBeLessThan(120);
    // Página só com o carimbo é página sem texto extraível (G-10).
    const { lido, textos } = await ler(pdf, "carimbos");
    expect(lido.totalDePaginas).toBe(4);
    expect(textos).toEqual(["", "", "", ""]);
  });

  it("pdfMisto: páginas nativas primeiro, depois só carimbo (sem texto), com o aviso de leitura em parte", async () => {
    const pdf = pdfMisto(3, 2);
    expect(bruto(pdf)).toContain(`${LINHA_DE_CARIMBO} - pagina 5`);
    const { caminho, lido, textos } = await ler(pdf, "misto");
    expect(lido.totalDePaginas).toBe(5);
    expect(textos.slice(0, 3).every((t) => t.includes("(nativa)") && !t.includes(LINHA_DE_CARIMBO))).toBe(true);
    // As páginas de carimbo são páginas sem texto extraível; 2 de 5 passa da fração e o PDF ganha o aviso (G-10).
    expect(textos.slice(3)).toEqual(["", ""]);
    const { avisos } = await lerInteiroTeor(caminho);
    expect(avisos.find((a) => a.startsWith("Leitura em parte"))).toContain("2 de 5 páginas");
  });

  it("pdfMuitasPaginas: milhares de páginas curtas; a leitura para no teto de páginas (G-11)", async () => {
    const pdf = pdfMuitasPaginas(3000);
    expect(bruto(pdf)).toContain("(Pagina 1 de 3000.)");
    expect(bruto(pdf)).toContain("(Pagina 3000 de 3000.)");
    // Relógio parado: só o teto de páginas corta, nunca o de tempo, mesmo em máquina lenta.
    const { lido, textos } = await ler(pdf, "muitas", { agora: () => 0 });
    expect(lido.totalDePaginas).toBe(3000);
    expect(TETO_DE_PAGINAS).toBe(1000);
    expect(lido.naoLidas).toEqual(Array.from({ length: 2000 }, (_, k) => 1001 + k));
    // As 1.000 lidas têm uma linha curta cada: abaixo do limiar, são páginas sem texto, não páginas não lidas.
    expect(lido.unidades.slice(0, 1000).some((u) => u.naoLida)).toBe(false);
    expect(lido.unidades.slice(1000).every((u) => u.naoLida)).toBe(true);
    expect(textos.every((t) => t === "")).toBe(true);
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
