import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analisarListaTcu, urlDoAnoTcu } from "../src/tcu.js";
import { baixarAnoTcu, avisoDeBaixaTcu } from "../src/tcuBaixar.js";
import { caminhoDoAnoTcu, caminhoDoIndiceTcu, lerReciboTcu, pesquisarTcu } from "../src/tcuLocal.js";
import { clienteFalso } from "./apoio.js";
import { acordaoFicticio, csvDoTcu, LISTA_REAL_TCU } from "./apoioTcu.js";

const CSV = csvDoTcu([acordaoFicticio(1), acordaoFicticio(2)]);
const BYTES = Buffer.from(CSV, "utf8");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const CABECALHOS = { "content-type": "text/csv", etag: '"abc"', "last-modified": "Fri, 02 Oct 2026 18:12:03 GMT" };

const pasta = () => mkdtemp(join(tmpdir(), "garimpo-tcu-baixa-"));
const completa = () => new Response(BYTES, { status: 200, headers: { ...CABECALHOS, "content-length": String(BYTES.length) } });
function cortada(inicio: number) {
  return new Response(BYTES.subarray(inicio), {
    status: 206,
    headers: { ...CABECALHOS, "content-range": `bytes ${inicio}-${BYTES.length - 1}/${BYTES.length}` },
  });
}
/** Corpo que entrega o começo e depois quebra, como a rede caindo no meio. */
function queQuebra(parte: Buffer) {
  let pedidos = 0;
  // controller.error descarta o que está na fila: o começo sai num pull e a queda vem no seguinte.
  const corpo = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pedidos++ < 4) c.enqueue(parte.subarray((pedidos - 1) * 30, pedidos * 30));
      else c.error(new Error("a rede caiu"));
    },
  });
  return new Response(corpo, { status: 200, headers: { ...CABECALHOS, "content-length": "999999" } });
}

describe("download dos arquivos anuais do TCU", () => {
  it("baixa um ano para a pasta de dados, com recibo (URL, bytes, sha256, ETag, Last-Modified, datas)", async () => {
    const dados = await pasta();
    const { cliente, chamadas } = clienteFalso([completa()]);
    const r = await baixarAnoTcu({ dados, cliente, ano: 2025, listaEm: "02/10/2026" });
    expect(r.situacao).toBe("baixado");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(urlDoAnoTcu(2025));
    expect(await readFile(caminhoDoAnoTcu(dados, 2025))).toEqual(BYTES);
    expect(await lerReciboTcu(dados, 2025)).toMatchObject({
      ano: 2025, url: urlDoAnoTcu(2025), bytes: BYTES.length, sha256: sha(BYTES), etag: '"abc"',
      lastModified: "Fri, 02 Oct 2026 18:12:03 GMT", listaEm: "02/10/2026",
    });
    expect((await lerReciboTcu(dados, 2025))!.baixadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(`${caminhoDoAnoTcu(dados, 2025)}.parcial`)).toBe(false);
  });

  it("ano já baixado não é baixado de novo sem renovar: nenhuma chamada", async () => {
    const dados = await pasta();
    await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
    const { cliente, chamadas } = clienteFalso([]);
    const r = await baixarAnoTcu({ dados, cliente, ano: 2025 });
    expect(r.situacao).toBe("ja-baixado");
    expect(chamadas).toHaveLength(0);
  });

  it("retoma de arquivo parcial com Range e If-Range, e fecha com o mesmo hash do arquivo inteiro", async () => {
    const dados = await pasta();
    const dest = caminhoDoAnoTcu(dados, 2025);
    await mkdir(join(dados, "tcu"), { recursive: true });
    await writeFile(`${dest}.parcial`, BYTES.subarray(0, 100));
    await writeFile(`${dest}.parcial.json`, JSON.stringify({ etag: '"abc"', lastModified: CABECALHOS["last-modified"] }));
    const { cliente, chamadas } = clienteFalso([cortada(100)]);
    const r = await baixarAnoTcu({ dados, cliente, ano: 2025 });
    const h = new Headers(chamadas[0].init.headers);
    expect(h.get("range")).toBe("bytes=100-");
    expect(h.get("if-range")).toBe('"abc"');
    expect(r.situacao).toBe("retomado");
    expect(await readFile(dest)).toEqual(BYTES);
    expect((await lerReciboTcu(dados, 2025))!.sha256).toBe(sha(BYTES));
  });

  it("se o servidor responde 200 ao pedido de retomada (arquivo mudou), recomeça do zero", async () => {
    const dados = await pasta();
    const dest = caminhoDoAnoTcu(dados, 2025);
    await mkdir(join(dados, "tcu"), { recursive: true });
    await writeFile(`${dest}.parcial`, Buffer.from("lixo de outro arquivo"));
    await writeFile(`${dest}.parcial.json`, JSON.stringify({ etag: '"velho"' }));
    const r = await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
    expect(r.situacao).toBe("baixado");
    expect(await readFile(dest)).toEqual(BYTES);
  });

  it("queda no meio do download deixa o parcial para retomar e não cria o arquivo final", async () => {
    const dados = await pasta();
    const { cliente } = clienteFalso([queQuebra(BYTES.subarray(0, 120))]);
    await expect(baixarAnoTcu({ dados, cliente, ano: 2025 })).rejects.toThrow(/retomar/);
    const dest = caminhoDoAnoTcu(dados, 2025);
    expect(existsSync(dest)).toBe(false);
    const guardado = (await stat(`${dest}.parcial`)).size;
    expect(guardado).toBeGreaterThan(0);
    expect(guardado).toBeLessThanOrEqual(120);
  });

  it("corpo menor que o declarado não vira arquivo final", async () => {
    const dados = await pasta();
    const curta = new Response(BYTES.subarray(0, 50), { status: 200, headers: { ...CABECALHOS, "content-length": String(BYTES.length) } });
    // O servidor falso entrega menos que o content-length: sem o arquivo inteiro, não há final.
    await expect(baixarAnoTcu({ dados, cliente: clienteFalso([curta]).cliente, ano: 2025 })).rejects.toThrow();
    expect(existsSync(caminhoDoAnoTcu(dados, 2025))).toBe(false);
  });

  it("conteúdo que não é o arquivo do TCU (cabeçalho diferente) não é guardado", async () => {
    const dados = await pasta();
    const outra = new Response('"A"|"B"\n"1"|"2"\n', { status: 200, headers: { "content-type": "text/csv" } });
    await expect(baixarAnoTcu({ dados, cliente: clienteFalso([outra]).cliente, ano: 2025 })).rejects.toThrow(/cabeçalho|formato/);
    expect(existsSync(caminhoDoAnoTcu(dados, 2025))).toBe(false);
    expect(existsSync(`${caminhoDoAnoTcu(dados, 2025)}.parcial`)).toBe(false);
  });

  it("outra janela baixando o mesmo ano (trava recente) impede um segundo download", async () => {
    const dados = await pasta();
    await mkdir(join(dados, "tcu"), { recursive: true });
    await writeFile(join(dados, "tcu", "download.trava"), String(process.pid));
    const { cliente, chamadas } = clienteFalso([completa()]);
    await expect(baixarAnoTcu({ dados, cliente, ano: 2025 })).rejects.toThrow(/outra janela/i);
    expect(chamadas).toHaveLength(0);
  });
});

describe("renovação de um ano já baixado", () => {
  async function comAnoBaixado() {
    const dados = await pasta();
    await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
    return dados;
  }

  it("pergunta com pedido condicional e, se o TCU diz 304, não baixa nada e mantém o arquivo", async () => {
    const dados = await comAnoBaixado();
    const { cliente, chamadas } = clienteFalso([new Response(null, { status: 304 })]);
    const r = await baixarAnoTcu({ dados, cliente, ano: 2025, renovar: true });
    const h = new Headers(chamadas[0].init.headers);
    expect(h.get("if-none-match")).toBe('"abc"');
    expect(h.get("if-modified-since")).toBe(CABECALHOS["last-modified"]);
    expect(r.situacao).toBe("sem-mudanca");
    expect(await readFile(caminhoDoAnoTcu(dados, 2025))).toEqual(BYTES);
  });

  it("se mudou, baixa de novo e troca o arquivo e o recibo só no fim", async () => {
    const dados = await comAnoBaixado();
    const novo = Buffer.from(csvDoTcu([acordaoFicticio(9)]), "utf8");
    const resp = new Response(novo, { status: 200, headers: { ...CABECALHOS, etag: '"novo"', "content-length": String(novo.length) } });
    const r = await baixarAnoTcu({ dados, cliente: clienteFalso([resp]).cliente, ano: 2025, renovar: true });
    expect(r.situacao).toBe("atualizado");
    expect(await readFile(caminhoDoAnoTcu(dados, 2025))).toEqual(novo);
    expect(await lerReciboTcu(dados, 2025)).toMatchObject({ etag: '"novo"', sha256: sha(novo) });
  });

  it("falha na renovação preserva a cópia anterior e o recibo", async () => {
    const dados = await comAnoBaixado();
    const { cliente } = clienteFalso([queQuebra(Buffer.from("parte do novo"))]);
    await expect(baixarAnoTcu({ dados, cliente, ano: 2025, renovar: true })).rejects.toThrow();
    expect(await readFile(caminhoDoAnoTcu(dados, 2025))).toEqual(BYTES);
    expect(await lerReciboTcu(dados, 2025)).toMatchObject({ etag: '"abc"', sha256: sha(BYTES) });
  });
});

describe("índice local criado com o download (D14: sob pedido, ao baixar o ano)", () => {
  const usaIndice = async (dados: string) => (await pesquisarTcu(dados, { consulta: "sobrepreço" })).indiceLocal;

  it("baixar um ano cria o índice dele; a pesquisa passa a usá-lo", async () => {
    const dados = await pasta();
    const r = await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
    expect(r.indice).toMatchObject({ ano: 2025, documentos: 2, bytesDoArquivo: BYTES.length });
    expect(await usaIndice(dados)).toEqual({ comIndice: [2025], semIndice: [] });
  });

  it("renovar sem mudança no TCU (304) cria o índice que falta, sem baixar de novo; com índice válido, não refaz", async () => {
    const dados = await pasta();
    await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
    await rm(caminhoDoIndiceTcu(dados, 2025));
    expect((await usaIndice(dados))?.comIndice).toEqual([]);
    const r = await baixarAnoTcu({ dados, cliente: clienteFalso([new Response(null, { status: 304 })]).cliente, ano: 2025, renovar: true });
    expect(r.situacao).toBe("sem-mudanca");
    expect(r.indice).toMatchObject({ ano: 2025, documentos: 2 });
    expect(await usaIndice(dados)).toEqual({ comIndice: [2025], semIndice: [] });
    const de_novo = await baixarAnoTcu({ dados, cliente: clienteFalso([new Response(null, { status: 304 })]).cliente, ano: 2025, renovar: true });
    expect(de_novo.indice).toBeUndefined();
  });

  it("atualizar o ano recria o índice para o arquivo novo", async () => {
    const dados = await pasta();
    await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
    const novo = Buffer.from(csvDoTcu([acordaoFicticio(9)]), "utf8");
    const resp = new Response(novo, { status: 200, headers: { ...CABECALHOS, etag: '"novo"', "content-length": String(novo.length) } });
    const r = await baixarAnoTcu({ dados, cliente: clienteFalso([resp]).cliente, ano: 2025, renovar: true });
    expect(r).toMatchObject({ situacao: "atualizado", indice: { documentos: 1 } });
    const p = await pesquisarTcu(dados, { consulta: "sobrepreço" });
    expect(p.indiceLocal?.comIndice).toEqual([2025]);
    expect(p.resultados.map((x) => x.numero)).toEqual(["9"]);
  });

  it("falha ao criar o índice não desfaz o download: o ano fica baixado e a pesquisa lê o arquivo inteiro", async () => {
    const dados = await pasta();
    await mkdir(caminhoDoIndiceTcu(dados, 2025), { recursive: true }); // no lugar do índice, uma pasta
    const r = await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
    expect(r.situacao).toBe("baixado");
    expect(r.indice).toMatchObject({ erro: expect.stringMatching(/índice/) });
    expect(await readFile(caminhoDoAnoTcu(dados, 2025))).toEqual(BYTES);
    expect((await pesquisarTcu(dados, { consulta: "sobrepreço" })).total).toBe(2);
  });
});

describe("aviso antes de baixar", () => {
  const lista = analisarListaTcu(LISTA_REAL_TCU);

  it("diz que precisa baixar, o tamanho por ano e no total, e a pasta; nada é baixado", async () => {
    const dados = await pasta();
    const a = await avisoDeBaixaTcu(dados, lista, [2021, 2025]);
    expect(a.precisaConfirmar).toBe(true);
    expect(a.anos.map((x) => [x.ano, x.tamanhoMb])).toEqual([[2021, 500.75], [2025, 394.4]]);
    expect(a.totalMb).toBeCloseTo(895.15, 2);
    expect(a.indiceEstimadoMb).toBeCloseTo(895.15 * 0.35, 1);
    expect(a.mensagem).toMatch(/313,3 MB do índice local/);
    expect(a.pasta).toBe(join(dados, "tcu"));
    expect(a.mensagem).toMatch(/baixar/);
    expect(a.mensagem).toMatch(/confirmar/);
  });

  it("recusa ano que o TCU não lista", async () => {
    const dados = await pasta();
    await expect(avisoDeBaixaTcu(dados, lista, [1900])).rejects.toThrow(/1900/);
  });
});


describe("proteções da revisão D-08/G-41", () => {
  it("não aceita 206 sem retomada nem 304 sem cópia anterior", async () => {
    for (const resposta of [cortada(0), new Response(null, { status: 304 })]) {
      const dados = await pasta();
      await expect(baixarAnoTcu({ dados, cliente: clienteFalso([resposta]).cliente, ano: 2025 })).rejects.toThrow(/inesperad/);
      expect(existsSync(caminhoDoAnoTcu(dados, 2025))).toBe(false);
    }
  });

  it("trava comum impede baixar outro ano enquanto uma janela está ativa", async () => {
    const dados = await pasta();
    await mkdir(join(dados, "tcu"), { recursive: true });
    await writeFile(join(dados, "tcu", "download.trava"), String(process.pid));
    const { cliente, chamadas } = clienteFalso([completa()]);
    await expect(baixarAnoTcu({ dados, cliente, ano: 2024 })).rejects.toThrow(/outra janela/i);
    expect(chamadas).toHaveLength(0);
  });

  it("CSV truncado sem content-length não substitui o arquivo anterior", async () => {
    const dados = await pasta();
    await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
    const truncado = new Response(BYTES.subarray(0, BYTES.length - 10), { headers: CABECALHOS });
    await expect(baixarAnoTcu({ dados, cliente: clienteFalso([truncado]).cliente, ano: 2025, renovar: true })).rejects.toThrow();
    expect(await readFile(caminhoDoAnoTcu(dados, 2025))).toEqual(BYTES);
  });

  it("falha ao preparar recibo mantém CSV e recibo anteriores", async () => {
    const dados = await pasta();
    await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
    await mkdir(`${caminhoDoAnoTcu(dados, 2025).replace(/\.csv$/, ".recibo.json")}.novo`);
    const novo = Buffer.from(csvDoTcu([acordaoFicticio(9)]));
    await expect(baixarAnoTcu({ dados, cliente: clienteFalso([new Response(novo, { headers: CABECALHOS })]).cliente, ano: 2025, renovar: true })).rejects.toThrow();
    expect(await readFile(caminhoDoAnoTcu(dados, 2025))).toEqual(BYTES);
    expect((await lerReciboTcu(dados, 2025))!.sha256).toBe(sha(BYTES));
  });
});


it("renovação também avisa tamanho e tempo antes de baixar anos existentes", async () => {
  const dados = await pasta();
  await baixarAnoTcu({ dados, cliente: clienteFalso([completa()]).cliente, ano: 2025 });
  const aviso = await avisoDeBaixaTcu(dados, analisarListaTcu(LISTA_REAL_TCU), [2025], true);
  expect(aviso.precisaConfirmar).toBe(true);
  expect(aviso.totalMb).toBe(394.4);
  expect(aviso.listaDoTcuEm).toBe("02/10/2026");
  expect(aviso.mensagem).toMatch(/10 a 20 s/);
});

it("faixa de retomada que não chega ao fim conserva o parcial e recusa a publicação", async () => {
  const dados = await pasta();
  const dest = caminhoDoAnoTcu(dados, 2025);
  await mkdir(join(dados, "tcu"), { recursive: true });
  await writeFile(`${dest}.parcial`, BYTES.subarray(0, 100));
  await writeFile(`${dest}.parcial.json`, JSON.stringify({ etag: '"abc"' }));
  const resposta = new Response(BYTES.subarray(100, 150), { status: 206, headers: { ...CABECALHOS, "content-range": `bytes 100-149/${BYTES.length}` } });
  await expect(baixarAnoTcu({ dados, cliente: clienteFalso([resposta]).cliente, ano: 2025 })).rejects.toThrow(/faixa inesperada/);
  expect(await readFile(`${dest}.parcial`)).toEqual(BYTES.subarray(0, 100));
});
