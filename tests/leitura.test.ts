import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FRACAO_DE_PAGINAS_SEM_TEXTO,
  LIMIAR_DE_CARACTERES_POR_PAGINA,
  lerInteiroTeor,
  lerParaConferir,
  TETO_DE_PAGINAS,
} from "../src/leitura.js";
import { LINHA_DE_CARIMBO, pdfMisto, pdfSintetico, pdfSoCarimbos } from "./pdfSintetico.js";

let pasta: string;
beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-leitura-"));
});
afterAll(() => rm(pasta, { recursive: true, force: true }));

let contador = 0;
async function gravar(pdf: Uint8Array): Promise<string> {
  const caminho = join(pasta, `teste-${++contador}.pdf`);
  await writeFile(caminho, pdf);
  return caminho;
}

/** Página nativa de `n` letras sem espaço (o limiar conta só caracteres que não são espaço). */
const pagina = (n: number) => linhas(n);
/** `n` letras em linhas de 50, para caberem na largura da página. */
function linhas(n: number): string[] {
  return Array.from({ length: Math.ceil(n / 50) }, (_, i) => "a".repeat(Math.min(50, n - i * 50)));
}

/** `n` páginas, cada uma com texto acima do limiar e a marca "Pagina k" na 1ª linha (o pdfMuitasPaginas fica abaixo). */
const pdfMuitasPaginas = (n: number) =>
  pdfSintetico(Array.from({ length: n }, (_, i) => [`Pagina ${i + 1} de ${n}.`, ...linhas(LIMIAR_DE_CARACTERES_POR_PAGINA)]));

describe("página só com o carimbo da assinatura (G-10)", () => {
  it("uma linha de carimbo por página não é texto lido: 'sem texto extraível' em todas", async () => {
    const leitura = await lerParaConferir(await gravar(pdfSoCarimbos(3)));
    expect(leitura.unidades.map((u) => u.texto)).toEqual(["", "", ""]);
  });

  it("no ler_inteiro_teor, cada página de carimbo sai com o rótulo e o PDF inteiro ganha o aviso de escaneado", async () => {
    const r = await lerInteiroTeor(await gravar(pdfSoCarimbos(2)));
    expect(r.texto).toContain("[página 1 de 2: sem texto extraível; pode ser escaneada]");
    expect(r.texto).not.toContain(LINHA_DE_CARIMBO);
    expect(r.avisos[0]).toContain("Nenhuma página deste PDF tem texto extraível");
  });

  it("limiar: a página com texto nativo curto abaixo dele conta como sem texto; no limiar, é lida", async () => {
    const L = LIMIAR_DE_CARACTERES_POR_PAGINA;
    const leitura = await lerParaConferir(await gravar(pdfSintetico([pagina(500), pagina(L - 1), pagina(L)])));
    expect(leitura.unidades.map((u) => u.texto.length > 0)).toEqual([true, false, true]);
  });

  it("só conta caracteres que não são espaço, e desconta a linha de assinatura eletrônica", async () => {
    const L = LIMIAR_DE_CARACTERES_POR_PAGINA;
    const comEspacos = Array.from({ length: 9 }, () => "a a a a a a a a a a"); // 90 letras (< limiar), 171 caracteres com espaços
    const carimboMaisCurto = [LINHA_DE_CARIMBO, ...linhas(L - 1)];
    const carimboMaisTexto = [LINHA_DE_CARIMBO, ...linhas(L)];
    const leitura = await lerParaConferir(
      await gravar(pdfSintetico([pagina(500), comEspacos, carimboMaisCurto, carimboMaisTexto])),
    );
    expect(leitura.unidades.map((u) => u.texto.length > 0)).toEqual([true, false, false, true]);
  });

  it("todas as páginas com texto: igual a antes, sem aviso de leitura em parte", async () => {
    const r = await lerInteiroTeor(await gravar(pdfMisto(3, 0)));
    expect(r.avisos.filter((a) => /Leitura em parte|Nenhuma página/.test(a))).toEqual([]);
    expect(r.texto).toContain("[página 3 de 3]\nPagina 3 (nativa) linha 1");
    expect(r.texto).not.toContain("sem texto extraível");
  });
});

describe("PDF misto (G-10)", () => {
  it("acima da fração de páginas sem texto: aviso de leitura em parte, com as páginas", async () => {
    // 2 de 5 = 40% > 30%
    const r = await lerInteiroTeor(await gravar(pdfMisto(3, 2)));
    const aviso = r.avisos.find((a) => a.startsWith("Leitura em parte"));
    expect(aviso).toContain("2 de 5 páginas");
    expect(aviso).toContain("4, 5");
    expect(aviso).toContain("OCR");
  });

  it("na fração ou abaixo dela: sem o aviso (a página sem texto continua marcada na parte)", async () => {
    // 3 de 10 = 30%, não acima
    expect(FRACAO_DE_PAGINAS_SEM_TEXTO).toBe(0.3);
    const r = await lerInteiroTeor(await gravar(pdfMisto(7, 3)));
    expect(r.avisos.some((a) => a.startsWith("Leitura em parte"))).toBe(false);
    expect(r.texto).toContain("[página 8 de 10: sem texto extraível; pode ser escaneada]");
  });
});

describe("tetos de páginas e de tempo (G-11)", () => {
  it("PDF com mais páginas que o teto: lê até o teto; o resto vira região não lida", async () => {
    const leitura = await lerParaConferir(await gravar(pdfMuitasPaginas(8)), { tetoDePaginas: 3 });
    expect(leitura.totalDePaginas).toBe(8);
    expect(leitura.unidades).toHaveLength(8);
    expect(leitura.unidades.map((u) => u.texto !== "")).toEqual([true, true, true, false, false, false, false, false]);
    expect(leitura.naoLidas).toEqual([4, 5, 6, 7, 8]);
  });

  it("o teto de páginas vem fixado, e a leitura parcial avisa no ler_inteiro_teor", async () => {
    expect(TETO_DE_PAGINAS).toBeGreaterThanOrEqual(100);
    const r = await lerInteiroTeor(await gravar(pdfMuitasPaginas(6)), 1, {}, undefined, { tetoDePaginas: 2 });
    expect(r.avisos.find((a) => a.startsWith("Leitura parcial"))).toContain("páginas 3–6");
    expect(r.texto).toContain("[página 1 de 6]");
    expect(r.texto).toContain("[página 3 de 6: não lida; passou do teto de leitura]");
    expect(r.texto).not.toContain("Pagina 3 de 6.");
  });

  it("teto de tempo com relógio falso: para quando o tempo passa e marca as páginas seguintes como não lidas", async () => {
    let agora = 0;
    // cada consulta ao relógio avança 1 s; o teto é de 2,5 s
    const relogio = () => (agora += 1000);
    const leitura = await lerParaConferir(await gravar(pdfMuitasPaginas(10)), { tetoDeTempoMs: 2500, agora: relogio });
    const lidas = leitura.unidades.filter((u) => u.texto).length;
    expect(lidas).toBeGreaterThan(0);
    expect(lidas).toBeLessThan(10);
    expect(leitura.naoLidas).toEqual(Array.from({ length: 10 - lidas }, (_, i) => lidas + i + 1));
  });

  it("a primeira página é sempre lida, mesmo com o tempo esgotado desde o início", async () => {
    let t = 0;
    const leitura = await lerParaConferir(await gravar(pdfMuitasPaginas(3)), { tetoDeTempoMs: 0, agora: () => (t += 1) });
    expect(leitura.unidades[0].texto).not.toBe("");
    expect(leitura.naoLidas).toEqual([2, 3]);
  });

  it("dentro dos tetos: nenhuma página não lida e nenhum aviso de leitura parcial", async () => {
    const r = await lerInteiroTeor(await gravar(pdfMuitasPaginas(4)));
    expect(r.avisos.some((a) => a.startsWith("Leitura parcial"))).toBe(false);
    expect((await lerParaConferir(await gravar(pdfMuitasPaginas(4)))).naoLidas).toEqual([]);
  });
});
