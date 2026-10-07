import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { obterInteiroTeor, PAUSA_TSE_MS } from "../src/inteiroTeor.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

const PDF = new TextEncoder().encode("%PDF-1.7\nconteudo ficticio\n%%EOF");
const pdf = () => new Response(PDF, { headers: { "content-type": "application/pdf" } });
const html = (texto: string, headers: Record<string, string> = {}) =>
  new Response(texto, { headers: { "content-type": "text/html", ...headers } });

const LINK_STJ = "https://scon.stj.jus.br/SCON/GetInteiroTeorDoAcordao?num_registro=202000000001&dt_publicacao=10/12/2020";
const MEDIADO =
  "/processo/julgamento/eletronico/documento/mediado/?documento_tipo=integra&documento_sequencial=1&registro_numero=202000000001&peticao_numero=&publicacao_data=20201210";
const PAGINA_STJ = `<a href="javascript:AbreDocumento('${MEDIADO}')">REsp (inteiro teor)</a>
  <a href="javascript:AbreDocumento('/processo/revista/documento/mediado/?componente=ATC&sequencial=2')">CERTIDÃO</a>`;
const PDF_STJ =
  "https://processo.stj.jus.br/processo/julgamento/eletronico/documento/?documento_tipo=integra&documento_sequencial=1&registro_numero=202000000001&publicacao_data=20201210";
const MEDIADO_HTML = `<html><iframe name='doc' src='${PDF_STJ.replace(/&/g, "&amp;")}'></iframe></html>`;

/** Passo 3 do STJ: só devolve o PDF com o cookie da sessão; sem ele, o HTML de 28 bytes. */
const passo3 = (_url: string, init: RequestInit) =>
  new Headers(init.headers).get("Cookie")?.includes("JSESSIONID=abc") ? pdf() : html("<html><body></body></html>\n\n");

let pasta: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-teste-"));
});

describe("inteiro teor — STJ em 3 passos", () => {
  it("com a sessão: segue página → mediado → iframe e salva um PDF oficial", async () => {
    const { cliente, chamadas } = clienteFalso([
      html(PAGINA_STJ, { "set-cookie": "JSESSIONID=abc; path=/processo" }),
      html(MEDIADO_HTML),
      passo3,
    ]);
    const r = await obterInteiroTeor({ tribunal: "stj", link: LINK_STJ, pasta }, () => cliente);

    expect(r.baixado).toBe(true);
    if (!r.baixado) return;
    expect(r.arquivo.startsWith(pasta)).toBe(true);
    expect((await readFile(r.arquivo)).subarray(0, 4).toString()).toBe("%PDF");
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://processo.stj.jus.br/processo/revista/inteiroteor/?num_registro=202000000001&dt_publicacao=10/12/2020",
      `https://processo.stj.jus.br${MEDIADO}`,
      PDF_STJ,
    ]);
    expect(new Headers(chamadas[2].init.headers).get("Referer")).toBe(`https://processo.stj.jus.br${MEDIADO}`);
  });

  it("sem o cookie da sessão o passo 3 devolve HTML de 28 bytes: erro claro e nada salvo", async () => {
    const { cliente } = clienteFalso([html(PAGINA_STJ), html(MEDIADO_HTML), passo3]);
    await expect(obterInteiroTeor({ tribunal: "stj", link: LINK_STJ, pasta }, () => cliente)).rejects.toThrow(
      /devolveu uma página \(28 bytes\) no lugar do PDF; nada foi salvo/,
    );
    expect(await readdir(pasta)).toEqual([]);
  });

  it("link de host parecido (falso-stj.jus.br) ou sem HTTPS é recusado antes de qualquer chamada", async () => {
    for (const link of [
      LINK_STJ.replace("scon.stj.jus.br", "falso-stj.jus.br"),
      LINK_STJ.replace("https://", "http://"),
    ]) {
      const { cliente, chamadas } = clienteFalso([]);
      await expect(obterInteiroTeor({ tribunal: "stj", link, pasta }, () => cliente)).rejects.toThrow(/fora do portal/);
      expect(chamadas).toHaveLength(0);
    }
  });

  it("passo 2 fora do STJ é recusado antes de sair (os cookies da sessão não vazam)", async () => {
    const pagina = `<a href="javascript:AbreDocumento('https://falso-stj.jus.br/doc')">REsp</a>`;
    const { cliente, chamadas } = clienteFalso([html(pagina, { "set-cookie": "JSESSIONID=abc; path=/" })]);
    await expect(obterInteiroTeor({ tribunal: "stj", link: LINK_STJ, pasta }, () => cliente)).rejects.toThrow(
      /fora do portal/,
    );
    expect(chamadas).toHaveLength(1);
  });

  it("iframe apontando para host parecido é recusado", async () => {
    const mediado = `<iframe src='https://falso-stj.jus.br/pdf'></iframe>`;
    const { cliente, chamadas } = clienteFalso([html(PAGINA_STJ), html(mediado)]);
    await expect(obterInteiroTeor({ tribunal: "stj", link: LINK_STJ, pasta }, () => cliente)).rejects.toThrow(
      /fora do portal/,
    );
    expect(chamadas).toHaveLength(2);
  });

  it("redirect é seguido passo a passo: dentro do STJ segue com a sessão; para fora, para sem chamar", async () => {
    const redirect = (destino: string) => new Response(null, { status: 302, headers: { location: destino } });
    const dentro = clienteFalso([
      html(PAGINA_STJ, { "set-cookie": "JSESSIONID=abc; path=/processo" }),
      html(MEDIADO_HTML),
      redirect("/processo/pdf/final"),
      passo3,
    ]);
    const r = await obterInteiroTeor({ tribunal: "stj", link: LINK_STJ, pasta }, () => dentro.cliente);
    expect(r.baixado).toBe(true);
    expect(dentro.chamadas[3].url).toBe("https://processo.stj.jus.br/processo/pdf/final");
    expect(dentro.chamadas.every((c) => c.init.redirect === "manual")).toBe(true);

    const fora = clienteFalso([html(PAGINA_STJ), html(MEDIADO_HTML), redirect("https://outro.test/pdf")]);
    await expect(obterInteiroTeor({ tribunal: "stj", link: LINK_STJ, pasta }, () => fora.cliente)).rejects.toThrow(
      /fora do portal/,
    );
    expect(fora.chamadas).toHaveLength(3);
  });

  it("página sem documento listado vira erro claro", async () => {
    const { cliente } = clienteFalso([html("<html>nada</html>")]);
    await expect(obterInteiroTeor({ tribunal: "stj", link: LINK_STJ, pasta }, () => cliente)).rejects.toThrow(
      /não listou o inteiro teor/,
    );
  });
});

describe("inteiro teor — link + explicação", () => {
  it("STF devolve link e explicação, sem nenhuma chamada", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    const link = "https://portal.stf.jus.br/jurisprudencia/obterInteiroTeor.asp?idDocumento=1";
    const r = await obterInteiroTeor({ tribunal: "stf", link, pasta }, () => cliente);
    expect(r).toMatchObject({ baixado: false, link });
    if (!r.baixado) expect(r.explicacao).toMatch(/não contorna/);
    expect(chamadas).toHaveLength(0);
  });

  it("TJGO devolve link, explicação e o número CNJ para pesquisar no portal", async () => {
    const busca = clienteFalso([respostaJson(fixture("tjgo.json"))]);
    await buscaDireta(busca.cliente, { tribunal: "tjgo", texto: "exemplo" });
    const { cliente, chamadas } = clienteFalso([]);
    const r = await obterInteiroTeor({ id: "tjgo:301", pasta }, () => cliente);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.link).toMatch(/^https:\/\/projudi\.tjgo\.jus\.br/);
    expect(r.explicacao).toMatch(/reCAPTCHA/);
    expect(r.explicacao).toMatch(/0000001-11\.2025\.8\.09\.0001/);
    expect(chamadas).toHaveLength(0);
  });
});

describe("inteiro teor — TJMG e TSE", () => {
  it("TJMG baixa o PDF direto", async () => {
    const { cliente } = clienteFalso([pdf()]);
    const link = "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=1";
    const r = await obterInteiroTeor({ tribunal: "tjmg", link, pasta }, () => cliente);
    expect(r).toMatchObject({ baixado: true, bytes: PDF.length });
  });

  it("TSE: tira o PDF do envelope multipart em que o portal o entrega", async () => {
    const envelope =
      "--fronteiraXYZ\r\nContent-Disposition: form-data; name=\"file\"; filename=\"inteiroTeor.pdf\"\r\n" +
      "Content-Type: application/octet-stream\r\n\r\n%PDF-1.7\nconteudo ficticio\n%%EOF\r\n--fronteiraXYZ--\r\n";
    const { cliente } = clienteFalso([new Response(envelope, { headers: { "content-type": "application/pdf" } })]);
    const link = "https://sjur-servicos.tse.jus.br/sjur-servicos/rest/download/pdf/1";
    const r = await obterInteiroTeor({ tribunal: "tse", link, pasta }, () => cliente);
    expect(r.baixado).toBe(true);
    if (r.baixado) expect((await readFile(r.arquivo)).toString()).toBe("%PDF-1.7\nconteudo ficticio\n%%EOF");
  });

  it("dois acórdãos com o mesmo número viram dois arquivos (id no nome); conteúdo diferente nunca é sobrescrito", async () => {
    const base = "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=";
    const mesmoNumero = (id: string) => ({ id, numero_processo: "1.0000.00.000001-0/001", texto_ementa: "EMENTA FICTÍCIA.", link_pdf: `${base}${id}` });
    const busca = clienteFalso([respostaJson({ results: [mesmoNumero("901"), mesmoNumero("902")] })]);
    await buscaDireta(busca.cliente, { tribunal: "tjmg", texto: "exemplo" });

    const conteudo = (t: string) => () => new Response(new TextEncoder().encode(`%PDF-1.7\n${t}\n%%EOF`));
    const { cliente } = clienteFalso([conteudo("A"), conteudo("B"), conteudo("B2"), conteudo("B2")]);
    const a = await obterInteiroTeor({ id: "tjmg:901", pasta }, () => cliente);
    const b = await obterInteiroTeor({ id: "tjmg:902", pasta }, () => cliente);
    // O mesmo acórdão de novo com conteúdo diferente: arquivo novo; com conteúdo igual: reaproveita.
    const b2 = await obterInteiroTeor({ id: "tjmg:902", pasta }, () => cliente);
    const b3 = await obterInteiroTeor({ id: "tjmg:902", pasta }, () => cliente);
    if (!a.baixado || !b.baixado || !b2.baixado || !b3.baixado) throw new Error("deveria ter baixado");

    expect(new Set([a.arquivo, b.arquivo, b2.arquivo]).size).toBe(3);
    expect(b.arquivo).toMatch(/902/);
    expect(b3.arquivo).toBe(b2.arquivo);
    expect((await readdir(pasta)).sort()).toHaveLength(3);
    expect((await readFile(a.arquivo, "latin1"))).toMatch(/\nA\n/);
    expect((await readFile(b.arquivo, "latin1"))).toMatch(/\nB\n/);
    expect((await readFile(b2.arquivo, "latin1"))).toMatch(/\nB2\n/);
  });

  it("página de erro (HTML no lugar do PDF) nunca vira PDF falso", async () => {
    const { cliente } = clienteFalso([html("<html><body>Erro ao gerar documento</body></html>")]);
    const link = "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=1";
    await expect(obterInteiroTeor({ tribunal: "tjmg", link, pasta }, () => cliente)).rejects.toThrow(/no lugar do PDF/);
    expect(await readdir(pasta)).toEqual([]);
  });

  it("link fora do portal oficial é recusado", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    await expect(
      obterInteiroTeor({ tribunal: "tse", link: "https://outro.test/pdf/1", pasta }, () => cliente),
    ).rejects.toThrow(/fora do portal oficial/);
    expect(chamadas).toHaveLength(0);
  });

  it("duas chamadas seguidas ao TSE respeitam a pausa", async () => {
    let relogio = 0;
    const esperas: number[] = [];
    const cliente = new Cliente({
      nome: "O TSE",
      intervaloMinimoPorHost: { "sjur-servicos.tse.jus.br": PAUSA_TSE_MS },
      agora: () => relogio,
      esperar: async (ms) => {
        esperas.push(ms);
        relogio += ms;
      },
      fetch: (async () => pdf()) as typeof fetch,
    });
    const base = "https://sjur-servicos.tse.jus.br/sjur-servicos/rest/download/pdf/";
    await obterInteiroTeor({ tribunal: "tse", link: `${base}1`, pasta }, () => cliente);
    await obterInteiroTeor({ tribunal: "tse", link: `${base}2`, pasta }, () => cliente);
    expect(esperas).toEqual([PAUSA_TSE_MS]);
  });
});
