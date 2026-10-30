import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { RecusaError } from "../src/cliente.js";
import { servicoDe } from "../src/disjuntor.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { Memoria } from "../src/memoria.js";
import { infoTribunal, paginaDeTribunais } from "../src/tribunais.js";
import { clienteFalso, respostaJson } from "./apoio.js";
import { pdfSintetico, pdfSoCarimbos } from "./pdfSintetico.js";

/** TJCE (ticket b22-06): PDF oficial do eSAJ, só se o cabeçalho «Processo:» for o do registro da busca. Números inventados. */
const CNJ = "0000009-99.2024.8.06.0001";
const OUTRO_CNJ = "0000008-88.2023.8.06.0002";
const LINK = "https://esaj.tjce.jus.br/cjsg/getArquivo.do?cdAcordao=9999999&cdForo=0";

let pasta: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-tjce-"));
});
afterEach(() => rm(pasta, { recursive: true, force: true, maxRetries: 10 }));

const comoPdf = (bytes: Uint8Array) =>
  new Response(bytes, { headers: { "content-type": "application/pdf;charset=UTF-8" } });

/** Linhas de enchimento: o leitor só conta como texto a página com mais de 100 caracteres úteis. */
const ENCHIMENTO = ["Texto ficticio de enchimento para a pagina ter conteudo suficiente de leitura.", "Segunda linha ficticia do mesmo acordao de teste."];

/** Acórdão do TJCE: cabeçalho «Processo:» no começo e, no corpo, as linhas dadas (ex.: CNJs de precedentes citados). */
const acordaoDoTjce = (cabecalho: string, corpo: string[] = []) =>
  pdfSintetico([
    [cabecalho, "EMENTA: apelacao civel, texto ficticio.", "ACORDAO", "RELATORIO", ...ENCHIMENTO, ...corpo],
    ["VOTO", "Fortaleza, data constante do sistema."],
  ]);

/** Busca que põe o acórdão na memória; `cnj` null = o site não trouxe o número do processo. */
async function buscar(cnj: string | null = CNJ) {
  const busca = clienteFalso([
    respostaJson({
      results: [
        { id: 7, texto_ementa: "EMENTA FICTÍCIA.", link_pdf: LINK, ...(cnj && { numero_processo: cnj, numero_processo_cnj: cnj }) },
      ],
    }),
  ]);
  const memoria = new Memoria();
  await buscaDireta(busca.cliente, { tribunal: "tjce", texto: "exemplo" }, memoria);
  return memoria;
}

describe("TJCE — baixa o PDF oficial do eSAJ (b22-06)", () => {
  it("caminho feliz: uma chamada ao link, recibo com origem e sha256", async () => {
    const memoria = await buscar();
    const { cliente, chamadas } = clienteFalso([comoPdf(acordaoDoTjce(`Processo: ${CNJ} - Apelacao Civel`))]);
    const r = await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria);
    expect(r.baixado).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(LINK);
    expect(chamadas[0].init.redirect).toBe("manual");
    if (!r.baixado) return;
    const recibo = await readFile(r.recibo, "utf8");
    expect(recibo).toMatch(/Link oficial final: https:\/\/esaj\.tjce\.jus\.br\/cjsg\/getArquivo\.do/);
    expect(recibo).toMatch(/Sha256: [0-9a-f]{64}/);
    expect(recibo).toMatch(/Tribunal: TJCE/);
  });

  it("já baixado: a segunda chamada não vai ao tribunal", async () => {
    const memoria = await buscar();
    const { cliente, chamadas } = clienteFalso([comoPdf(acordaoDoTjce(`Processo: ${CNJ} - Apelacao Civel`))]);
    await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria);
    const deNovo = await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria);
    expect(deNovo.baixado).toBe(true);
    expect(chamadas).toHaveLength(1);
  });
});

describe("TJCE — guarda: o cabeçalho «Processo:» do PDF tem de ser o do registro da busca", () => {
  const nadaGuardado = async (r: Awaited<ReturnType<typeof obterInteiroTeor>>) => {
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/não verificado/i);
    expect(r.explicacao).toMatch(/cabeçalho/);
    expect(await readdir(pasta)).toEqual([]);
  };

  it("cabeçalho com o CNJ só em dígitos corridos também vale", async () => {
    const memoria = await buscar();
    const digitos = CNJ.replace(/\D/g, "");
    const { cliente } = clienteFalso([comoPdf(acordaoDoTjce(`Processo: ${digitos} - Apelacao Civel`))]);
    expect((await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria)).baixado).toBe(true);
  });

  it("PDF de outro processo: não guarda", async () => {
    const memoria = await buscar();
    const { cliente } = clienteFalso([comoPdf(acordaoDoTjce(`Processo: ${OUTRO_CNJ} - Apelacao Civel`))]);
    await nadaGuardado(await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria));
  });

  it("PDF de outro processo que CITA o CNJ da busca no corpo (precedente): não guarda", async () => {
    const memoria = await buscar();
    const pdf = acordaoDoTjce(`Processo: ${OUTRO_CNJ} - Apelacao Civel`, [`Precedente citado: processo ${CNJ}.`]);
    const { cliente } = clienteFalso([comoPdf(pdf)]);
    await nadaGuardado(await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria));
  });

  it("PDF do processo certo que cita outros CNJs no corpo: guarda (vale o cabeçalho)", async () => {
    const memoria = await buscar();
    const pdf = acordaoDoTjce(`Processo: ${CNJ} - Apelacao Civel`, [`Precedente: ${OUTRO_CNJ}.`, "Outro: 0000007-77.2022.8.06.0003."]);
    const { cliente } = clienteFalso([comoPdf(pdf)]);
    expect((await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria)).baixado).toBe(true);
  });

  it("CNJ da busca só no corpo, sem cabeçalho «Processo:»: não guarda", async () => {
    const memoria = await buscar();
    const pdf = pdfSintetico([["EMENTA: texto ficticio.", ...ENCHIMENTO, `Menciona o processo ${CNJ} no corpo.`]]);
    const { cliente } = clienteFalso([comoPdf(pdf)]);
    await nadaGuardado(await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria));
  });

  it("primeira página sem texto e «Processo: <CNJ>» na página 2 (citação com o rótulo exato): não guarda", async () => {
    const memoria = await buscar();
    const pdf = pdfSintetico([[], [`Processo: ${CNJ} - Apelacao Civel`, ...ENCHIMENTO]]);
    const { cliente } = clienteFalso([comoPdf(pdf)]);
    await nadaGuardado(await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria));
  });

  it("citação com o rótulo exato «Processo:» na 1ª página, depois dos títulos de seção, sem cabeçalho real: não guarda", async () => {
    const memoria = await buscar();
    const pdf = pdfSintetico([["EMENTA: texto ficticio.", ...ENCHIMENTO, "ACORDAO", `Precedente - Processo: ${CNJ} - Apelacao Civel`]]);
    const { cliente } = clienteFalso([comoPdf(pdf)]);
    await nadaGuardado(await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria));
  });

  it("dois números diferentes no cabeçalho (ambíguo): não guarda", async () => {
    const memoria = await buscar();
    const pdf = pdfSintetico([[`Processo: ${CNJ} - Apelacao Civel`, `Processo: ${OUTRO_CNJ} - Agravo`, "EMENTA: x", ...ENCHIMENTO]]);
    const { cliente } = clienteFalso([comoPdf(pdf)]);
    await nadaGuardado(await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria));
  });

  it("registro sem número e sem link: recusa ANTES da rota de link do site (nenhuma chamada, nem ao site)", async () => {
    const busca = clienteFalso([respostaJson({ results: [{ id: 7, texto_ementa: "EMENTA FICTÍCIA." }] })]);
    const memoria = new Memoria();
    await buscaDireta(busca.cliente, { tribunal: "tjce", texto: "exemplo" }, memoria);
    const tribunal = clienteFalso([]);
    const site = clienteFalso([respostaJson({ link: LINK })]);
    const r = await obterInteiroTeor({ id: "tjce:7", pasta }, () => tribunal.cliente, memoria, site.cliente);
    expect(r.baixado).toBe(false);
    if (!r.baixado) expect(r.explicacao).toMatch(/número do processo/);
    expect(site.chamadas).toHaveLength(0);
    expect(tribunal.chamadas).toHaveLength(0);
  });

  it("registro da busca sem número de processo: não guarda, com o motivo", async () => {
    const memoria = await buscar(null);
    const { cliente } = clienteFalso([comoPdf(acordaoDoTjce(`Processo: ${CNJ} - Apelacao Civel`))]);
    const r = await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria);
    expect(r.baixado).toBe(false);
    if (!r.baixado) expect(r.explicacao).toMatch(/número do processo/);
    expect(await readdir(pasta)).toEqual([]);
  });

  it("PDF sem texto (só carimbos): não guarda", async () => {
    const memoria = await buscar();
    const { cliente } = clienteFalso([comoPdf(pdfSoCarimbos(2))]);
    await nadaGuardado(await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria));
  });
});

describe("TJCE — endereço e resposta", () => {
  it("link fora do eSAJ do TJCE: erro, nenhuma chamada", async () => {
    const memoria = await buscar();
    for (const link of [
      "http://esaj.tjce.jus.br/cjsg/getArquivo.do?cdAcordao=1&cdForo=0",
      "https://esaj.tjce.jus.br.exemplo.test/cjsg/getArquivo.do?cdAcordao=1&cdForo=0",
      "https://www2.tjal.jus.br/cjsg/getArquivo.do?cdAcordao=1&cdForo=0",
      "https://esaj.tjce.jus.br/outro/caminho.do?cdAcordao=1",
      "https://esaj.tjce.jus.br/cjsg/getArquivo.do?cdAcordao=abc&cdForo=0",
    ]) {
      const { cliente, chamadas } = clienteFalso([]);
      await expect(obterInteiroTeor({ id: "tjce:7", link, pasta }, () => cliente, memoria), link).rejects.toThrow();
      expect(chamadas, link).toHaveLength(0);
    }
  });

  it("página comum no lugar do PDF (sem desafio): erro, nada guardado", async () => {
    const pagina = new Response("<html><title>Manutenção</title>serviço fora do ar</html>", { headers: { "content-type": "text/html" } });
    const { cliente } = clienteFalso([pagina]);
    const memoria = await buscar();
    await expect(obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria)).rejects.toThrow(/no lugar do PDF/);
    expect(await readdir(pasta)).toEqual([]);
  });

  describe("captcha do eSAJ sem título: recusa do serviço tjce, como o 403 (regra 3)", () => {
    const captcha = () =>
      new Response("<html><body>Para acessar o conteúdo do Acórdão, por favor digite o código da figura no campo abaixo.</body></html>", {
        headers: { "content-type": "text/html" },
      });

    it("é RecusaError, nada é guardado e a 2ª chamada ao TJCE nem sai", async () => {
      const memoria = await buscar();
      const { cliente, chamadas } = clienteFalso([captcha(), comoPdf(acordaoDoTjce(`Processo: ${CNJ} - Apelacao Civel`))]);
      const e = await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria).catch((x) => x);
      expect(e).toBeInstanceOf(RecusaError);
      expect(e.message).toMatch(/pausadas em todas as janelas/);
      const depois = await obterInteiroTeor({ id: "tjce:7", pasta }, () => cliente, memoria).catch((x) => x);
      expect(depois.message).toMatch(/não foi feita/);
      expect(chamadas).toHaveLength(1);
      expect(await readdir(pasta)).toEqual([]);
    });

    it("a pausa vale para o serviço tjce e não para as outras fontes", async () => {
      const { cliente, chamadas } = clienteFalso([captcha(), respostaJson({ ok: 1 }), respostaJson({ ok: 2 })]);
      await cliente.requisitar(LINK).catch((x) => x);
      expect(await cliente.requisitar(LINK).catch((x) => x)).toBeInstanceOf(RecusaError);
      const outroTribunal = await cliente.requisitar("https://www.tjxx.jus.br/acordao?id=1");
      expect(await outroTribunal.json()).toEqual({ ok: 1 });
      const site = await cliente.requisitar("https://www.jurisprudenciaia.com.br/api/tribunais/tjxx/search");
      expect(await site.json()).toEqual({ ok: 2 });
      expect(chamadas).toHaveLength(3);
    });
  });

  it("redirecionamento: dentro do host segue; para fora, erro", async () => {
    const memoria = await buscar();
    const dentro = clienteFalso([
      new Response(null, { status: 302, headers: { location: "/cjsg/getArquivo.do?cdAcordao=9999999&cdForo=0&x=1" } }),
      comoPdf(acordaoDoTjce(`Processo: ${CNJ} - Apelacao Civel`)),
    ]);
    expect((await obterInteiroTeor({ id: "tjce:7", pasta }, () => dentro.cliente, memoria)).baixado).toBe(true);
    expect(dentro.chamadas).toHaveLength(2);
    const fora = clienteFalso([new Response(null, { status: 302, headers: { location: "https://exemplo.test/x.pdf" } })]);
    const outraPasta = await mkdtemp(join(tmpdir(), "garimpo-tjce-"));
    try {
      await expect(obterInteiroTeor({ id: "tjce:7", pasta: outraPasta }, () => fora.cliente, memoria)).rejects.toThrow(/fora do portal oficial/);
    } finally {
      await rm(outraPasta, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  it("o serviço do disjuntor é o tjce", () => {
    expect(servicoDe(LINK)).toBe("tjce");
  });
});

describe("TJCE — tabela", () => {
  it("é «baixa», sem motivo de só link, e a página diz «baixado pelo Garimpo»", () => {
    const info = infoTribunal("tjce");
    expect(info).toMatchObject({ inteiroTeor: "baixa" });
    expect(info?.motivoLink).toBeUndefined();
    expect(info?.classeDoMotivo).toBeUndefined();
    expect(info?.dataDaProva).toBeUndefined();
    expect(paginaDeTribunais()).toMatch(/\| TJCE \|.*baixado pelo Garimpo/);
  });
});
