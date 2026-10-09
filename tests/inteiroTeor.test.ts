import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { obterInteiroTeor, PAUSA_TSE_MS } from "../src/inteiroTeor.js";
import { Memoria } from "../src/memoria.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";
import { pdfSintetico } from "./pdfSintetico.js";

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
afterEach(() => rm(pasta, { recursive: true, force: true, maxRetries: 10 }));

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

  it("STF sem link_pdf: preserva link_consulta / url_acordao e os usa no link + explicação", async () => {
    const consulta = "https://portal.stf.jus.br/processos/detalhe.asp?incidente=1";
    const acordao = "https://portal.stf.jus.br/jurisprudencia/sjur-exemplo";
    const busca = clienteFalso([
      respostaJson({
        juris: [
          { id: "103", sigla_classe: "RE", numero_processo: "100003", texto_ementa: "EMENTA FICTÍCIA.", link_pdf: null, link_consulta: consulta },
          { id: "104", sigla_classe: "RE", numero_processo: "100004", texto_ementa: "EMENTA FICTÍCIA.", link_pdf: null, url_acordao: acordao },
        ],
      }),
    ]);
    const memoria = new Memoria();
    const r = await buscaDireta(busca.cliente, { tribunal: "stf", texto: "exemplo" }, memoria);
    expect(r.acordaos.map((a) => a.linkConsulta)).toEqual([consulta, acordao]);

    const { cliente, chamadas } = clienteFalso([]);
    for (const [id, link] of [["stf:103", consulta], ["stf:104", acordao]]) {
      const t = await obterInteiroTeor({ id, pasta }, () => cliente, memoria);
      expect(t).toMatchObject({ baixado: false, link });
      if (!t.baixado) expect(t.explicacao).not.toMatch(/não trouxe link/);
    }
    expect(chamadas).toHaveLength(0);
  });

  it("TJGO devolve link, explicação e o número CNJ para pesquisar no portal", async () => {
    const busca = clienteFalso([respostaJson(fixture("tjgo.json"))]);
    const memoria = new Memoria();
    await buscaDireta(busca.cliente, { tribunal: "tjgo", texto: "exemplo" }, memoria);
    const { cliente, chamadas } = clienteFalso([]);
    const r = await obterInteiroTeor({ id: "tjgo:301", pasta }, () => cliente, memoria);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.link).toMatch(/^https:\/\/projudi\.tjgo\.jus\.br/);
    expect(r.explicacao).toMatch(/reCAPTCHA/);
    expect(r.explicacao).toMatch(/0000001-11\.2025\.8\.09\.0001/);
    expect(chamadas).toHaveLength(0);
  });
});

describe("inteiro teor — acórdão sem link", () => {
  const CNJ = "0000009-99.2024.8.05.0001";
  /** Busca de um acórdão sem link_pdf nem link de consulta, guardado na memória. */
  async function semLink(tribunal: string, id: string) {
    const busca = clienteFalso([
      respostaJson({
        results: [{ id, texto_ementa: "EMENTA FICTÍCIA.", numero_processo: CNJ, numero_processo_cnj: CNJ, link_pdf: null }],
      }),
    ]);
    const memoria = new Memoria();
    await buscaDireta(busca.cliente, { tribunal, texto: "exemplo" }, memoria);
    return memoria;
  }

  it("tribunal de link sem link: não manda abrir link nenhum e dá o número CNJ e o portal", async () => {
    const memoria = await semLink("tjba", "701");
    const { cliente } = clienteFalso([]);
    const r = await obterInteiroTeor({ id: "tjba:701", pasta }, () => cliente, memoria);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.link).toBeUndefined();
    expect(r.explicacao).not.toMatch(/abr(a|ir) o link/i);
    expect(r.explicacao).toMatch(/não trouxe link/);
    expect(r.explicacao).toContain(CNJ);
    expect(r.explicacao).toMatch(/portal de jurisprudência do TJ da Bahia/);
    expect(r.explicacao).toMatch(/ler_inteiro_teor/);
  });

  it("tribunal de link com link: mantém o texto de abrir o link", async () => {
    const { cliente } = clienteFalso([]);
    const link = "https://exemplo.tjba.jus.br/acordao/1";
    const r = await obterInteiroTeor({ tribunal: "tjba", link, pasta }, () => cliente);
    expect(r).toMatchObject({ baixado: false, link });
    if (!r.baixado) expect(r.explicacao).toMatch(/abra o link no navegador/i);
  });

  it("tribunal que baixa, sem link: dá o caminho alternativo (número CNJ no portal)", async () => {
    const memoria = await semLink("tjmg", "702");
    const { cliente, chamadas } = clienteFalso([]);
    const r = await obterInteiroTeor({ id: "tjmg:702", pasta }, () => cliente, memoria);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toContain(CNJ);
    expect(r.explicacao).toMatch(/portal de jurisprudência do TJ de Minas Gerais/);
    expect(r.explicacao).not.toMatch(/abr(a|ir) o link/i);
    expect(chamadas).toHaveLength(0);
  });
});

describe("inteiro teor — link pedido à rota de link do site", () => {
  const ROTA = "https://www.jurisprudenciaia.com.br/api/jurisprudencia-link";

  async function semLink(tribunal: string, id: string) {
    const busca = clienteFalso([
      respostaJson({ results: [{ id, texto_ementa: "EMENTA FICTÍCIA.", numero_processo_cnj: "0000009-99.2024.8.05.0001" }] }),
    ]);
    const memoria = new Memoria();
    await buscaDireta(busca.cliente, { tribunal, texto: "exemplo" }, memoria);
    return memoria;
  }

  it("TJPA: o link_processo da busca vira o link de consulta, sem chamada nenhuma à rota", async () => {
    const busca = clienteFalso([
      respostaJson({
        results: [{ id: 501, texto_ementa: "EMENTA FICTÍCIA.", link_processo: "https://jurisprudencia.tjpa.jus.br/#/documento/1" }],
      }),
    ]);
    const memoria = new Memoria();
    const r = await buscaDireta(busca.cliente, { tribunal: "tjpa", texto: "exemplo" }, memoria);
    expect(r.acordaos[0].linkConsulta).toBe("https://jurisprudencia.tjpa.jus.br/#/documento/1");

    const site = clienteFalso([]);
    const t = await obterInteiroTeor({ id: "tjpa:501", pasta }, () => clienteFalso([]).cliente, memoria, site.cliente);
    expect(t).toMatchObject({ baixado: false, link: "https://jurisprudencia.tjpa.jus.br/#/documento/1" });
    if (!t.baixado) expect(t.explicacao).not.toMatch(/rota de link/);
    expect(site.chamadas).toHaveLength(0);
  });

  it("sem link na busca: 1 chamada à rota, link devolvido com a origem dita; de novo, 0 chamadas (memória)", async () => {
    const memoria = await semLink("tjba", "801");
    const link = "https://jurisprudencia.tjba.jus.br/#/documento/801";
    const site = clienteFalso([respostaJson({ link })]);
    const tribunal = clienteFalso([]);
    const r = await obterInteiroTeor({ id: "tjba:801", pasta }, () => tribunal.cliente, memoria, site.cliente);
    expect(r).toMatchObject({ baixado: false, link });
    if (!r.baixado) {
      expect(r.explicacao).toMatch(/pedido à rota de link do JurisprudênciaIA/);
      expect(r.explicacao).toMatch(/abra o link no navegador/i);
    }
    expect(site.chamadas.map((c) => c.url)).toEqual([`${ROTA}?tribunal=tjba&id=801`]);

    const deNovo = await obterInteiroTeor({ id: "tjba:801", pasta }, () => tribunal.cliente, memoria, site.cliente);
    expect(deNovo).toMatchObject({ baixado: false, link });
    if (!deNovo.baixado) expect(deNovo.explicacao).toMatch(/pedido à rota de link/);
    expect(site.chamadas).toHaveLength(1);
    expect(tribunal.chamadas).toHaveLength(0);
  });

  it.each([
    ["HTTP 400", () => respostaJson({ error: "bad request" }, 400)],
    ["corpo sem link", () => respostaJson({})],
    ["link que não é https", () => respostaJson({ link: "javascript:alert(1)" })],
    ["link fora de domínio .jus.br", () => respostaJson({ link: "https://exemplo.test/documento/802" })],
  ])("rota falhou (%s): resposta sem link do ticket 02, sem erro e sem link inventado", async (_caso, resposta) => {
    const memoria = await semLink("tjba", "802");
    const site = clienteFalso([resposta()]);
    const r = await obterInteiroTeor({ id: "tjba:802", pasta }, () => clienteFalso([]).cliente, memoria, site.cliente);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.link).toBeUndefined();
    expect(r.explicacao).toMatch(/não trouxe link/);
    expect(r.explicacao).toContain("0000009-99.2024.8.05.0001");
    expect(r.explicacao).not.toMatch(/abr(a|ir) o link/i);
    expect(site.chamadas).toHaveLength(1);
  });

  it("tribunal que baixa, sem link na busca: baixa pelo link da rota, e o recibo diz de onde ele veio", async () => {
    const memoria = await semLink("tjmg", "804");
    const link = "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=804";
    const site = clienteFalso([respostaJson({ link })]);
    const tribunal = clienteFalso([pdf()]);
    const r = await obterInteiroTeor({ id: "tjmg:804", pasta }, () => tribunal.cliente, memoria, site.cliente);
    expect(r).toMatchObject({ baixado: true, fonte: link });
    if (!r.baixado) return;
    expect(tribunal.chamadas.map((c) => c.url)).toEqual([link]);
    expect(await readFile(r.recibo, "utf8")).toContain(`Link pedido à rota de link do site: ${link}`);
  });

  it("TST (rota responde 400 por documentação): nenhuma chamada", async () => {
    const memoria = await semLink("tst", "803");
    const site = clienteFalso([]);
    const r = await obterInteiroTeor({ id: "tst:803", pasta }, () => clienteFalso([]).cliente, memoria, site.cliente);
    expect(r).toMatchObject({ baixado: false });
    expect(site.chamadas).toHaveLength(0);
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
    const memoria = new Memoria();
    await buscaDireta(busca.cliente, { tribunal: "tjmg", texto: "exemplo" }, memoria);

    const conteudo = (t: string) => () => new Response(new TextEncoder().encode(`%PDF-1.7\n${t}\n%%EOF`));
    const { cliente } = clienteFalso([conteudo("A"), conteudo("B"), conteudo("B2"), conteudo("B2")]);
    const a = await obterInteiroTeor({ id: "tjmg:901", pasta }, () => cliente, memoria);
    const b = await obterInteiroTeor({ id: "tjmg:902", pasta }, () => cliente, memoria);
    // O mesmo acórdão de novo com conteúdo diferente: arquivo novo; com conteúdo igual: reaproveita.
    const b2 = await obterInteiroTeor({ id: "tjmg:902", pasta }, () => cliente, memoria);
    const b3 = await obterInteiroTeor({ id: "tjmg:902", pasta }, () => cliente, memoria);
    if (!a.baixado || !b.baixado || !b2.baixado || !b3.baixado) throw new Error("deveria ter baixado");

    expect(new Set([a.arquivo, b.arquivo, b2.arquivo]).size).toBe(3);
    expect(b.arquivo).toMatch(/902/);
    expect(b3.arquivo).toBe(b2.arquivo);
    expect((await readdir(pasta)).filter((f) => f.endsWith(".pdf"))).toHaveLength(3);
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

  it("TJMG/TSE só por https: link http é recusado antes de qualquer chamada", async () => {
    for (const [tribunal, link] of [
      ["tjmg", "http://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=1"],
      ["tse", "http://sjur-servicos.tse.jus.br/sjur-servicos/rest/download/pdf/1"],
    ]) {
      const { cliente, chamadas } = clienteFalso([pdf()]);
      await expect(obterInteiroTeor({ tribunal, link, pasta }, () => cliente)).rejects.toThrow(/fora do portal oficial/);
      expect(chamadas).toHaveLength(0);
    }
    expect(await readdir(pasta)).toEqual([]);
  });

  it("TJMG/TSE seguem redirect passo a passo: dentro do portal por https segue; http ou outro host para sem chamar", async () => {
    const redirect = (destino: string) => () => new Response(null, { status: 302, headers: { location: destino } });
    const link = "https://sjur-servicos.tse.jus.br/sjur-servicos/rest/download/pdf/1";

    const dentro = clienteFalso([redirect("/sjur-servicos/rest/download/pdf/1/final"), pdf()]);
    const r = await obterInteiroTeor({ tribunal: "tse", link, pasta }, () => dentro.cliente);
    expect(r.baixado).toBe(true);
    expect(dentro.chamadas.map((c) => c.url)).toEqual([link, `${link}/final`]);
    expect(dentro.chamadas.every((c) => c.init.redirect === "manual")).toBe(true);

    for (const destino of [
      "http://sjur-servicos.tse.jus.br/sjur-servicos/rest/download/pdf/1", // rebaixa para http
      "https://outro.test/pdf/1", // sai do portal
    ]) {
      const fora = clienteFalso([redirect(destino), pdf()]);
      await expect(obterInteiroTeor({ tribunal: "tse", link, pasta }, () => fora.cliente)).rejects.toThrow(
        /fora do portal oficial/,
      );
      expect(fora.chamadas).toHaveLength(1);
    }
  });

  it("TJMG/TSE: redirect sem fim para no teto de saltos, sem salvar nada", async () => {
    const link = "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=1";
    const voltaAoMesmo = () => new Response(null, { status: 302, headers: { location: link } });
    const { cliente, chamadas } = clienteFalso(Array.from({ length: 20 }, () => voltaAoMesmo));
    await expect(obterInteiroTeor({ tribunal: "tjmg", link, pasta }, () => cliente)).rejects.toThrow(/vezes demais/);
    expect(chamadas).toHaveLength(6);
    expect(await readdir(pasta)).toEqual([]);
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

describe("inteiro teor — TJSP pelo fallback anônimo da verificação de login", () => {
  // Formato observado na prova do B11 (2026-10-09), com números fictícios.
  const LINK_TJSP = "https://esaj.tjsp.jus.br/cjsg/getArquivo.do?cdAcordao=1&cdForo=0";
  const VERIFICA = "/cjsg/jsp/verificarLoginArquivo.jsp?cdAcordao=1&cdForo=0";
  const ANONIMO = "https://esaj.tjsp.jus.br/cjsg/getArquivo.do?cdAcordao=1&cdForo=0&casChecked=true";
  const paginaVerifica = (literal = "/cjsg/getArquivo.do?cdAcordao=1&cdForo=0&casChecked=true") => `<html><head>
    <script src="https://esaj.tjsp.jus.br/sajcas/verificarLogin.js?script=1"></script>
    <script>
        if (window.sajcas && window.sajcas.usuarioLogadoNoCasServer) {
            var urlRetornoSistema = '/cjsg/getArquivo.do?cdAcordao=1&cdForo=0';
            window.location.href = urlRetornoSistema;
        }
    </script>
    <script>
        // Fallback: se o usuario NAO esta logado no CAS, volta para getArquivo.do como anonimo
        if (!window.sajcas || !window.sajcas.usuarioLogadoNoCasServer) {
            window.location.href = '${literal}';
        }
    </script>
</head><body></body></html>`;
  const redirect = (destino: string, headers: Record<string, string> = {}) =>
    new Response(null, { status: 302, headers: { location: destino, ...headers } });
  /** O PDF só sai com o cookie da sessão que o próprio portal entregou no 1º passo. */
  const pdfComSessao = (_url: string, init: RequestInit) =>
    new Headers(init.headers).get("Cookie")?.includes("JSESSIONID=abc") ? pdf() : html(paginaVerifica());

  it("3 GETs numa sessão: link → verificação de login → endereço literal do fallback anônimo → PDF com recibo", async () => {
    const { cliente, chamadas } = clienteFalso([
      redirect(VERIFICA, { "set-cookie": "JSESSIONID=abc; Path=/cjsg" }),
      html(paginaVerifica()),
      pdfComSessao,
    ]);
    const r = await obterInteiroTeor({ tribunal: "tjsp", link: LINK_TJSP, pasta }, () => cliente);

    expect(r.baixado).toBe(true);
    if (!r.baixado) return;
    expect(chamadas.map((c) => c.url)).toEqual([LINK_TJSP, `https://esaj.tjsp.jus.br${VERIFICA}`, ANONIMO]);
    expect(chamadas.every((c) => c.init.redirect === "manual")).toBe(true);
    const recibo = await readFile(r.recibo, "utf8");
    expect(recibo).toContain(`Link oficial final: ${ANONIMO}`);
    expect(recibo).toContain(`Link que veio na busca: ${LINK_TJSP}`);
    expect(recibo).toContain("Tribunal: TJSP");
  });

  it("endereço literal fora do portal do TJSP é recusado sem chamar, e os cookies da sessão não vazam", async () => {
    const { cliente, chamadas } = clienteFalso([
      redirect(VERIFICA, { "set-cookie": "JSESSIONID=abc; Path=/cjsg" }),
      html(paginaVerifica("https://outro.test/getArquivo.do?casChecked=true")),
    ]);
    await expect(obterInteiroTeor({ tribunal: "tjsp", link: LINK_TJSP, pasta }, () => cliente)).rejects.toThrow(
      /fora do portal oficial do TJSP/,
    );
    expect(chamadas).toHaveLength(2);
    expect(await readdir(pasta)).toEqual([]);
  });

  it("link ou redirect fora de https no portal do TJSP é recusado antes de sair", async () => {
    for (const link of [LINK_TJSP.replace("https://", "http://"), LINK_TJSP.replace("esaj.tjsp.jus.br", "falso-tjsp.jus.br")]) {
      const { cliente, chamadas } = clienteFalso([]);
      await expect(obterInteiroTeor({ tribunal: "tjsp", link, pasta }, () => cliente)).rejects.toThrow(/fora do portal/);
      expect(chamadas).toHaveLength(0);
    }
    const fora = clienteFalso([redirect("https://outro.test/verificar")]);
    await expect(obterInteiroTeor({ tribunal: "tjsp", link: LINK_TJSP, pasta }, () => fora.cliente)).rejects.toThrow(
      /fora do portal/,
    );
    expect(fora.chamadas).toHaveLength(1);
  });

  it("página sem PDF nem endereço do fallback anônimo: link + motivo observado, sem afirmar login nem JavaScript", async () => {
    const { cliente, chamadas } = clienteFalso([redirect(VERIFICA), html("<html><body>Documento indisponível</body></html>")]);
    const r = await obterInteiroTeor({ tribunal: "tjsp", link: LINK_TJSP, pasta }, () => cliente);

    expect(r).toMatchObject({ baixado: false, link: LINK_TJSP });
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/^O TJSP devolveu uma página \(\d+ bytes\) no lugar do PDF; nada foi salvo\./);
    expect(r.explicacao).not.toMatch(/login|JavaScript|captcha/i);
    expect(r.explicacao).toMatch(/abra o link no navegador, baixe o PDF e passe o caminho do arquivo ao ler_inteiro_teor/);
    expect(chamadas).toHaveLength(2);
    expect(await readdir(pasta)).toEqual([]);
  });

  it("o fallback anônimo também devolve página no lugar do PDF: link + motivo, e não segue mais nenhum endereço", async () => {
    const { cliente, chamadas } = clienteFalso([redirect(VERIFICA), html(paginaVerifica()), html(paginaVerifica())]);
    const r = await obterInteiroTeor({ tribunal: "tjsp", link: LINK_TJSP, pasta }, () => cliente);

    expect(r).toMatchObject({ baixado: false, link: LINK_TJSP });
    expect(chamadas).toHaveLength(3);
  });

  it("PDF já baixado é reconhecido pelo recibo, sem nenhuma chamada (ADR-0011)", async () => {
    const real = () => new Response(pdfSintetico([["ACÓRDÃO FICTÍCIO"]]), { headers: { "content-type": "application/pdf" } });
    const primeiro = clienteFalso([redirect(VERIFICA), html(paginaVerifica()), real]);
    const a = await obterInteiroTeor({ tribunal: "tjsp", link: LINK_TJSP, pasta }, () => primeiro.cliente);
    expect(a.baixado).toBe(true);

    const segundo = clienteFalso([]);
    const b = await obterInteiroTeor({ tribunal: "tjsp", link: LINK_TJSP, pasta }, () => segundo.cliente);
    expect(b).toMatchObject({ baixado: true, jaEstavaNaPasta: expect.stringMatching(/^O PDF já estava na pasta de destino/) });
    expect(segundo.chamadas).toHaveLength(0);
  });
});
