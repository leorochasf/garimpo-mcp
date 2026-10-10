import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conferirNoInteiroTeor, lerCitacao } from "../src/conferencia.js";
import { lerParaConferir } from "../src/leitura.js";
import { pdfMisto, pdfSintetico, pdfSoCarimbos } from "./pdfSintetico.js";

let pasta: string;
beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-conf-leitura-"));
});
afterAll(() => rm(pasta, { recursive: true, force: true }));

async function gravar(pdf: Uint8Array, nome: string) {
  const caminho = join(pasta, nome);
  await writeFile(caminho, pdf);
  return caminho;
}

const citar = (texto: string) => lerCitacao(texto, { reticenciasComoCorte: false });
/** `n` páginas com texto acima do limiar de leitura (o pdfMuitasPaginas fica abaixo dele). */
const pdfMuitasPaginas = (n: number) =>
  pdfSintetico(Array.from({ length: n }, (_, i) => [`Pagina ${i + 1} de ${n}.`, ...Array(5).fill("a".repeat(50))]));
const FRASE_AUSENTE = "frase que so existe na imagem escaneada do acordao";

describe("conferência sobre leitura que não leu tudo: nunca 'não encontrado' (G-10, G-11)", () => {
  it("PDF de páginas só de carimbo: não verificável", async () => {
    const leitura = await lerParaConferir(await gravar(pdfSoCarimbos(4), "carimbos.pdf"));
    expect(conferirNoInteiroTeor(leitura, citar(FRASE_AUSENTE)).veredito).toBe("não verificável");
  });

  it("PDF misto: frase ausente do texto nativo é não verificável e aponta as páginas de carimbo", async () => {
    const leitura = await lerParaConferir(await gravar(pdfMisto(2, 2), "misto.pdf"));
    const r = conferirNoInteiroTeor(leitura, citar(FRASE_AUSENTE));
    expect(r.veredito).toBe("não verificável");
    expect(JSON.stringify(r)).toContain("3");
  });

  it("PDF misto: frase presente no texto nativo continua encontrada", async () => {
    const leitura = await lerParaConferir(await gravar(pdfMisto(2, 2), "misto-achada.pdf"));
    const r = conferirNoInteiroTeor(leitura, citar("Pagina 1 (nativa) linha 3: texto ficticio do inteiro teor."));
    expect(r.veredito).toBe("encontrado literalmente");
  });

  it("leitura parcial por teto de páginas: frase ausente das lidas é não verificável, nunca não encontrado", async () => {
    const leitura = await lerParaConferir(await gravar(pdfMuitasPaginas(6), "muitas.pdf"), { tetoDePaginas: 2 });
    const r = conferirNoInteiroTeor(leitura, citar(FRASE_AUSENTE));
    expect(r.veredito).toBe("não verificável");
    expect(JSON.stringify(r)).toContain("3");
  });
});
