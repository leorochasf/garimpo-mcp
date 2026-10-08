import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { Cliente, VERSAO } from "../src/cliente.js";
import { criarServidor, type OpcoesServidor } from "../src/servidor.js";
import { clienteFalso, respostaJson } from "./apoio.js";
import { pdfSintetico, type TextoPosicionado } from "./pdfSintetico.js";

/**
 * O Garimpo inteiro, chamado como o Claude chama: cliente MCP em memória e site falso por trás, sem rede.
 * Opcionalmente, tribunais falsos e a pasta de gravação.
 */
async function conectar(site: Cliente, opcoes?: OpcoesServidor) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(site, opcoes).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

/** Site falso: responde a toda busca com estes registros no formato do site. */
function siteFalso(registros: unknown[]) {
  return new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async () => respostaJson({ results: registros })) as typeof fetch,
  });
}

describe("servidor MCP", () => {
  it("marca como só leem as buscas, obter ementa, listar tribunais e ler inteiro teor (sem sair para a internet); obter inteiro teor não, nem destrutiva; as buscas saem para a internet", async () => {
    const mcp = await conectar(siteFalso([]));
    const { tools } = await mcp.listTools();
    const marca = Object.fromEntries(tools.map((t) => [t.name, t.annotations ?? {}]));

    for (const nome of ["busca_direta", "busca_ampla", "obter_ementa", "listar_tribunais", "ler_inteiro_teor"]) {
      expect(marca[nome].readOnlyHint, nome).toBe(true);
    }
    expect(marca.ler_inteiro_teor.openWorldHint).toBe(false);
    expect(marca.obter_inteiro_teor.readOnlyHint).not.toBe(true);
    expect(marca.obter_inteiro_teor.destructiveHint).toBe(false);
    expect(marca.busca_direta.openWorldHint).toBe(true);
    expect(marca.busca_ampla.openWorldHint).toBe(true);
    expect(marca.obter_ementa.openWorldHint).toBe(false);
    expect(marca.listar_tribunais.openWorldHint).toBe(false);
  });

  describe("aviso de natureza jurídica", () => {
    const AVISO =
      "Resultado de busca em base não oficial. Confira o acórdão no link oficial do tribunal antes de citar; " +
      "a ementa não substitui o inteiro teor.";
    const acordao = {
      id: "aviso1",
      texto_ementa: "EMENTA FICTÍCIA. Responsabilidade civil do Estado por omissão.",
      numero_processo: "1.000.001/SP",
      orgao_julgador: "Turma Exemplo",
      data_julgamento: "2024-01-02T00:00:00.000Z",
      link_pdf: "https://exemplo.test/aviso1",
    };

    async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
      const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { isError: r.isError, texto: r.content[0].text };
    }

    it("vem, com o texto exato e em campo próprio, na busca direta, na busca ampla e no obter ementa", async () => {
      const mcp = await conectar(siteFalso([acordao]));
      const direta = await chamar(mcp, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil" });
      const ampla = await chamar(mcp, "busca_ampla", { formulacoes: ["responsabilidade civil"], tribunais: ["stj"] });
      const ementa = await chamar(mcp, "obter_ementa", { id: "stj:aviso1" });

      for (const r of [direta, ampla, ementa]) {
        expect(r.isError).toBeFalsy();
        expect(JSON.parse(r.texto).avisoNaturezaJuridica).toBe(AVISO);
      }
      expect(JSON.parse(direta.texto).acordaos).toHaveLength(1);
      expect(JSON.parse(ampla.texto).acordaos).toHaveLength(1);
      expect(JSON.parse(ementa.texto).ementa).toMatch(/Responsabilidade civil do Estado/);
    });

    it("não vem em listar tribunais, em obter inteiro teor nem nas respostas de erro", async () => {
      const mcp = await conectar(
        new Cliente({
          nome: "O site",
          esperar: async () => {},
          fetch: (async () => {
            throw new Error("site fora do ar");
          }) as typeof fetch,
        }),
      );
      const respostas = [
        await chamar(mcp, "listar_tribunais", {}),
        // STF é só link: devolve o link sem chamar o tribunal, então segue sem rede.
        await chamar(mcp, "obter_inteiro_teor", { tribunal: "stf", link: "https://exemplo.test/stf.pdf" }),
        await chamar(mcp, "obter_ementa", { id: "stj:nunca-buscado" }),
        await chamar(mcp, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil" }),
      ];

      expect(respostas.map((r) => Boolean(r.isError))).toEqual([false, false, true, true]);
      for (const r of respostas) {
        expect(r.texto).not.toMatch(/base não oficial/);
      }
    });
  });
});

describe("obter inteiro teor pela porta (tribunal falso e pasta temporária)", () => {
  // Teto da resposta: cerca de 8 mil tokens estimados, a 3 caracteres por token, cabeçalho incluído.
  const TETO = 24_000;
  const linhas = (n: number) =>
    Array.from({ length: 25 }, (_, i) => `Pagina ${n} linha ${i + 1}: texto generico de exemplo sobre responsabilidade civil.`);
  /** PDF sintético de 30 páginas: dá mais de uma parte. */
  const PDF = Buffer.from(pdfSintetico(Array.from({ length: 30 }, (_, i) => linhas(i + 1)))).toString("latin1");
  const pdf = () => new Response(Buffer.from(PDF, "latin1"), { headers: { "content-type": "application/pdf" } });
  const html = (texto: string, headers: Record<string, string> = {}) =>
    new Response(texto, { headers: { "content-type": "text/html", ...headers } });

  // STJ em 3 passos (página → mediado → PDF do iframe), o último só com o cookie da sessão.
  const PDF_STJ = "https://processo.stj.jus.br/processo/julgamento/eletronico/documento/?documento_sequencial=1";
  const stjFalso = () =>
    clienteFalso([
      html(`<a href="javascript:AbreDocumento('/processo/documento/mediado/?documento_sequencial=1')">REsp</a>`, {
        "set-cookie": "JSESSIONID=abc; path=/processo",
      }),
      html(`<iframe src='${PDF_STJ}'></iframe>`),
      (_url, init) => (new Headers(init.headers).get("Cookie")?.includes("JSESSIONID=abc") ? pdf() : html("<html></html>")),
    ]);
  // O TSE entrega o PDF dentro de um envelope multipart.
  const tseFalso = () =>
    clienteFalso([
      new Response(
        Buffer.from(`--fronteiraXYZ\r\nContent-Type: application/octet-stream\r\n\r\n${PDF}\r\n--fronteiraXYZ--\r\n`, "latin1"),
      ),
    ]);
  const LINKS = {
    stj: "https://scon.stj.jus.br/SCON/GetInteiroTeorDoAcordao?num_registro=202000000001&dt_publicacao=10/12/2020",
    tjmg: "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=1",
    tse: "https://sjur-servicos.tse.jus.br/sjur-servicos/rest/download/pdf/1",
  };

  /** Servidor com STJ, TJMG e TSE falsos e uma pasta temporária; o TJMG pode entregar outras respostas. */
  async function montar(tjmg: Parameters<typeof clienteFalso>[0] = [pdf()], registros: unknown[] = []) {
    const pasta = await mkdtemp(join(tmpdir(), "garimpo-porta-"));
    const falsos = { stj: stjFalso(), tjmg: clienteFalso(tjmg), tse: tseFalso() };
    const mcp = await conectar(siteFalso(registros), {
      tribunais: (sigla) => falsos[sigla as keyof typeof falsos].cliente,
      pasta,
    });
    const chamar = async (name: string, args: Record<string, unknown>) => {
      const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { isError: r.isError, texto: r.content[0].text };
    };
    return { pasta, falsos, chamar };
  }

  it("STJ, TJMG e TSE falsos: grava o PDF e devolve a 1ª parte, igual à do ler_inteiro_teor, com origem conferida e a chamada para a parte 2", async () => {
    const { pasta, falsos, chamar } = await montar();

    for (const [tribunal, link] of Object.entries(LINKS)) {
      const r = await chamar("obter_inteiro_teor", { tribunal, link });
      expect(r.isError, tribunal).toBeFalsy();
      expect(r.texto.length, tribunal).toBeLessThanOrEqual(TETO);
      const dado = JSON.parse(r.texto);
      expect(dado).toMatchObject({ baixado: true, bytes: PDF.length, fonte: link });
      expect(dirname(dado.arquivo), tribunal).toBe(pasta);
      expect(await readFile(dado.arquivo, "latin1"), tribunal).toBe(PDF);
      expect(dado.recibo).toBe(dado.arquivo.replace(/\.pdf$/, ".recibo.txt"));

      expect(dado.cabecalho.origem, tribunal).toMatch(/^conferida: download pelo Garimpo/);
      expect(dado.cabecalho).toMatchObject({ tribunal: tribunal.toUpperCase(), linkOficial: expect.stringMatching(/^https:/) });
      expect(dado.cabecalho.paginasDoPdf).toMatch(/^páginas 1–\d+ de 30 \(parte 1 de \d+\)$/);
      expect(dado.texto).toMatch(/^\[página 1 de 30\]\nPagina 1 linha 1: /);
      expect(dado.proximaParte).toEqual({ ferramenta: "ler_inteiro_teor", argumentos: { caminho: dado.arquivo, parte: 2 } });

      // Mesmo cabeçalho e mesma divisão do ler_inteiro_teor: a parte 1 lida depois é a mesma.
      const lida = JSON.parse((await chamar("ler_inteiro_teor", { caminho: dado.arquivo })).texto);
      for (const campo of ["cabecalho", "avisos", "texto", "proximaParte"]) expect(dado[campo], campo).toEqual(lida[campo]);
      const segunda = await chamar("ler_inteiro_teor", dado.proximaParte.argumentos);
      expect(segunda.isError).toBeFalsy();
      expect(JSON.parse(segunda.texto).cabecalho.paginasDoPdf).toMatch(/\(parte 2 de \d+\)$/);
    }
    expect((await readdir(pasta)).filter((f) => f.endsWith(".pdf"))).toHaveLength(3);
    expect(falsos.stj.chamadas).toHaveLength(3);
  });

  it("link longo: a 1ª parte vem inteira e a resposta, com os dados do download, fica dentro do teto", async () => {
    const { chamar } = await montar();
    const link = `${LINKS.tjmg}&extra=${"x".repeat(4_000)}`;
    const r = await chamar("obter_inteiro_teor", { tribunal: "tjmg", link });
    expect(r.texto.length).toBeLessThanOrEqual(TETO);
    const dado = JSON.parse(r.texto);
    expect(dado.fonte).toBe(link);
    expect(dado.texto).toMatch(/^\[página 1 de 30\]/);
    const lida = JSON.parse((await chamar("ler_inteiro_teor", { caminho: dado.arquivo })).texto);
    expect(dado.texto).toBe(lida.texto);
  });

  it("1ª parte que não cabe com os dados do download: aviso e a chamada para lê-la, nunca resposta acima do teto", async () => {
    // O mesmo acórdão e os mesmos bytes, pedidos por outro link, muito mais longo: o arquivo é o mesmo e o recibo
    // original (com o link curto) é preservado.
    const acordao = { id: "801", texto_ementa: "EMENTA FICTÍCIA.", numero_processo: "1.0000.00.000003-0/001", link_pdf: LINKS.tjmg };
    const { chamar } = await montar([pdf(), pdf()], [acordao]);
    await chamar("busca_direta", { tribunal: "tjmg", texto: "exemplo" });
    const primeiro = JSON.parse((await chamar("obter_inteiro_teor", { id: "tjmg:801", texto: false })).texto);
    const r = await chamar("obter_inteiro_teor", { id: "tjmg:801", link: `${LINKS.tjmg}&extra=${"x".repeat(6_000)}` });
    expect(r.isError).toBeFalsy();
    expect(r.texto.length).toBeLessThanOrEqual(TETO);
    const dado = JSON.parse(r.texto);
    expect(dado.arquivo).toBe(primeiro.arquivo);
    expect(dado.texto).toBeUndefined();
    expect(dado.aviso).toMatch(/1ª parte não coube nesta resposta/);
    expect(dado.proximaParte).toEqual({ ferramenta: "ler_inteiro_teor", argumentos: { caminho: dado.arquivo, parte: 1 } });
  });

  it("texto: false — só o caminho, o recibo e o total de páginas, sem texto", async () => {
    const { chamar } = await montar();
    const r = await chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg, texto: false });
    expect(r.isError).toBeFalsy();
    const dado = JSON.parse(r.texto);
    expect(Object.keys(dado).sort()).toEqual(["arquivo", "baixado", "bytes", "fonte", "recibo", "sha256", "totalDePaginasDoPdf"]);
    expect(dado.totalDePaginasDoPdf).toBe(30);
    expect(await readFile(dado.arquivo, "latin1")).toBe(PDF);
  });

  it("PDF salvo mas ilegível pelo extrator: download e recibo preservados, motivo informado, nenhum número inventado", async () => {
    const ilegivel = new TextEncoder().encode("%PDF-1.7\nconteudo ficticio\n%%EOF");
    const { pasta, chamar } = await montar([new Response(ilegivel), new Response(ilegivel)]);

    const comTexto = await chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg });
    expect(comTexto.isError).toBeFalsy();
    const dado = JSON.parse(comTexto.texto);
    expect(Object.keys(dado).sort()).toEqual(["arquivo", "baixado", "bytes", "erroDeLeitura", "fonte", "recibo", "sha256"]);
    expect(dado.erroDeLeitura).toMatch(/^Erro de leitura: o extrator não conseguiu ler o PDF .* O download continua valendo/);
    expect(dado.erroDeLeitura).not.toMatch(/sem conteúdo|sem texto/);
    expect(await readFile(dado.arquivo)).toEqual(Buffer.from(ilegivel));
    expect(await readFile(dado.recibo, "utf8")).toMatch(/^Formato: recibo de origem do Garimpo/);

    const semTexto = JSON.parse((await chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg, texto: false })).texto);
    expect(semTexto).toMatchObject({ arquivo: dado.arquivo, recibo: dado.recibo, totalDePaginasDoPdf: "não disponível" });
    expect(semTexto.motivo).toMatch(/não conseguiu (ler|contar)/);
    expect((await readdir(pasta)).sort()).toEqual([basename(dado.arquivo), basename(dado.recibo)].sort());
  });
});

describe("download robusto e recibo de origem (pela porta)", () => {
  const LINK_TJMG = "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=1";
  const bytesPdf = (texto: string) => new TextEncoder().encode(`%PDF-1.7\n${texto}\n%%EOF`);
  const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

  /** Servidor com um TJMG falso que entrega estas respostas, em ordem, e uma pasta temporária. */
  async function montar(respostas: Parameters<typeof clienteFalso>[0], registros: unknown[] = []) {
    const pasta = await mkdtemp(join(tmpdir(), "garimpo-recibo-"));
    const tjmg = clienteFalso(respostas);
    const mcp = await conectar(siteFalso(registros), { tribunais: () => tjmg.cliente, pasta });
    const obter = async (args: Record<string, unknown>) => {
      const r = (await mcp.callTool({ name: "obter_inteiro_teor", arguments: args })) as {
        content: { text: string }[];
        isError?: boolean;
      };
      return { isError: r.isError, texto: r.content[0].text };
    };
    return { pasta, mcp, obter };
  }

  /** Lê o recibo em linhas "Campo: valor". */
  async function lerRecibo(caminho: string) {
    const texto = await readFile(caminho, "utf8");
    const campos = Object.fromEntries(
      texto
        .split("\n")
        .filter((l) => l.includes(": "))
        .map((l) => [l.slice(0, l.indexOf(": ")), l.slice(l.indexOf(": ") + 2)]),
    );
    return { texto, campos };
  }

  it("grava ao lado do PDF o recibo com todos os campos; a resposta traz o caminho do recibo e o sha256", async () => {
    const pdf = bytesPdf("conteudo ficticio");
    const acordao = {
      id: "501",
      texto_ementa: "EMENTA FICTÍCIA.",
      numero_processo: "1.0000.00.000001-0/001",
      data_julgamento: "2024-01-02T00:00:00.000Z",
      link_pdf: LINK_TJMG,
    };
    const final = "https://www5.tjmg.jus.br/jurisprudencia/pdf/inteiro-teor-1.pdf";
    const { mcp, obter } = await montar(
      [new Response(null, { status: 302, headers: { location: final } }), new Response(pdf)],
      [acordao],
    );
    await mcp.callTool({ name: "busca_direta", arguments: { tribunal: "tjmg", texto: "exemplo" } });

    const r = await obter({ id: "tjmg:501" });
    expect(r.isError).toBeFalsy();
    const dado = JSON.parse(r.texto);
    expect(dado).toMatchObject({ baixado: true, bytes: pdf.length, sha256: sha256(pdf) });
    expect(dado.recibo).toBe(dado.arquivo.replace(/\.pdf$/, ".recibo.txt"));

    const { texto, campos } = await lerRecibo(dado.recibo);
    expect(campos).toMatchObject({
      Formato: "recibo de origem do Garimpo, versão 1",
      Origem: "download pelo Garimpo",
      "Link oficial final": final,
      "Link que veio na busca": LINK_TJMG,
      Sha256: sha256(pdf),
      "Tamanho em bytes": String(pdf.length),
      Tribunal: "TJMG",
      "Número": "1.0000.00.000001-0/001",
      Id: "tjmg:501",
      "Nome do arquivo": basename(dado.arquivo),
      "Versão do Garimpo": VERSAO,
    });
    expect(campos["Data e hora"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?[+-]\d{2}:\d{2}$/);
    expect(texto).toMatch(/declaração do Garimpo.*não tem valor de certidão.*nem de autenticação independente/);
  });

  it("o que faltar no recibo aparece como \"não informado\"", async () => {
    const { obter } = await montar([new Response(bytesPdf("sem busca"))]);
    const dado = JSON.parse((await obter({ tribunal: "tjmg", link: LINK_TJMG })).texto);
    const { campos } = await lerRecibo(dado.recibo);
    expect(campos["Número"]).toBe("não informado");
    expect(campos.Id).toBe("não informado");
    expect(campos["Link oficial final"]).toBe(LINK_TJMG);
  });

  it("conexão que cai no meio: erro claro, e nenhum PDF nem temporário na pasta", async () => {
    const corpo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytesPdf("comeco do arquivo").subarray(0, 12));
      },
      pull(c) {
        c.error(new Error("socket hang up"));
      },
    });
    const { pasta, obter } = await montar([new Response(corpo, { headers: { "content-type": "application/pdf" } })]);
    const r = await obter({ tribunal: "tjmg", link: LINK_TJMG });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/download do TJMG foi interrompido no meio .*nada foi salvo/);
    expect(await readdir(pasta)).toEqual([]);
  });

  it("PDF acima de 50 MB sem Content-Length: download interrompido, nada salvo, aviso claro", async () => {
    let pedacos = 0;
    const mega = new Uint8Array(1024 * 1024);
    mega.set(bytesPdf("").subarray(0, 4));
    // Corpo sem fim e sem Content-Length: só o corte pelos bytes recebidos faz o download parar.
    const corpo = new ReadableStream<Uint8Array>({
      pull(c) {
        pedacos++;
        c.enqueue(mega);
      },
    });
    const { pasta, obter } = await montar([new Response(corpo, { headers: { "content-type": "application/pdf" } })]);
    const r = await obter({ tribunal: "tjmg", link: LINK_TJMG });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/passa de 50 MB; o download foi interrompido e nada foi salvo/);
    expect(pedacos).toBeLessThanOrEqual(52);
    expect(await readdir(pasta)).toEqual([]);
  });

  it("mesmos bytes de novo: o PDF e o recibo original são preservados", async () => {
    const pdf = bytesPdf("igual");
    const { pasta, obter } = await montar([new Response(pdf), new Response(pdf)]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-05T10:00:00Z"));
      const primeiro = JSON.parse((await obter({ tribunal: "tjmg", link: LINK_TJMG })).texto);
      const original = await readFile(primeiro.recibo, "utf8");
      vi.setSystemTime(new Date("2026-02-05T10:00:00Z"));
      const segundo = JSON.parse((await obter({ tribunal: "tjmg", link: LINK_TJMG })).texto);

      expect(segundo).toMatchObject({ arquivo: primeiro.arquivo, recibo: primeiro.recibo, sha256: sha256(pdf) });
      expect(await readFile(primeiro.recibo, "utf8")).toBe(original);
      expect((await readdir(pasta)).sort()).toEqual([basename(primeiro.arquivo), basename(primeiro.recibo)].sort());
    } finally {
      vi.useRealTimers();
    }
  });

  it("mesmos bytes de um PDF sem recibo (baixado antes do recibo existir): o recibo é gravado agora", async () => {
    const pdf = bytesPdf("antigo");
    const { pasta, obter } = await montar([new Response(pdf), new Response(pdf)]);
    const primeiro = JSON.parse((await obter({ tribunal: "tjmg", link: LINK_TJMG })).texto);
    await rm(primeiro.recibo);

    const segundo = JSON.parse((await obter({ tribunal: "tjmg", link: LINK_TJMG })).texto);
    expect(segundo).toMatchObject({ arquivo: primeiro.arquivo, recibo: primeiro.recibo });
    expect((await lerRecibo(segundo.recibo)).campos.Sha256).toBe(sha256(pdf));
    expect(await readdir(pasta)).toHaveLength(2);
  });

  it("recibo que ficou sem o PDF não é sobrescrito: o PDF novo ganha outro nome", async () => {
    const pdf = bytesPdf("orfao");
    const { pasta, obter } = await montar([new Response(pdf), new Response(pdf)]);
    const primeiro = JSON.parse((await obter({ tribunal: "tjmg", link: LINK_TJMG })).texto);
    const reciboOrfao = await readFile(primeiro.recibo, "utf8");
    await rm(primeiro.arquivo);

    const segundo = JSON.parse((await obter({ tribunal: "tjmg", link: LINK_TJMG })).texto);
    expect(segundo.arquivo).toBe(primeiro.arquivo.replace(/\.pdf$/, "-2.pdf"));
    expect(await readFile(primeiro.recibo, "utf8")).toBe(reciboOrfao);
    expect((await lerRecibo(segundo.recibo)).campos["Nome do arquivo"]).toBe(basename(segundo.arquivo));
  });

  it("bytes diferentes: arquivo novo e recibo novo, nada sobrescrito", async () => {
    const a = bytesPdf("versao A");
    const b = bytesPdf("versao B");
    const { pasta, obter } = await montar([new Response(a), new Response(b)]);
    const primeiro = JSON.parse((await obter({ tribunal: "tjmg", link: LINK_TJMG })).texto);
    const reciboA = await readFile(primeiro.recibo, "utf8");
    const segundo = JSON.parse((await obter({ tribunal: "tjmg", link: LINK_TJMG })).texto);

    expect(segundo.arquivo).not.toBe(primeiro.arquivo);
    expect(segundo.recibo).not.toBe(primeiro.recibo);
    expect(await readFile(primeiro.arquivo)).toEqual(Buffer.from(a));
    expect(await readFile(primeiro.recibo, "utf8")).toBe(reciboA);
    expect(await readFile(segundo.arquivo)).toEqual(Buffer.from(b));
    expect((await lerRecibo(segundo.recibo)).campos).toMatchObject({
      Sha256: sha256(b),
      "Nome do arquivo": basename(segundo.arquivo),
    });
    expect(await readdir(pasta)).toHaveLength(4);
  });
});

describe("erro nunca vira lista vazia (busca ampla)", () => {
  /** Site falso que responde conforme o tribunal e a ordem da chamada. */
  function siteQueResponde(responder: (tribunal: string, n: number) => Response) {
    let n = 0;
    return new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async (url: string) => responder(String(url).match(/tribunais\/(\w+)\/search/)![1], n++)) as typeof fetch,
    });
  }
  const acordao = (id: string) => ({
    id,
    texto_ementa: `EMENTA FICTÍCIA ${id}. Responsabilidade civil.`,
    numero_processo: `${id}/UF`,
    data_julgamento: "2024-01-02T00:00:00.000Z",
    link_pdf: `https://exemplo.test/${id}`,
  });
  // Resposta que o Garimpo não sabe ler: busca com erro que não é recusa.
  const formatoDesconhecido = () => respostaJson({ mensagem: "formato que o Garimpo não conhece" });

  async function ampla(site: Cliente, args: Record<string, unknown>) {
    const mcp = await conectar(site);
    const r = (await mcp.callTool({ name: "busca_ampla", arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: r.isError, texto: r.content[0].text };
  }

  it("todas as buscas com erro comum: responde com erro e o motivo de cada busca, sem lista vazia", async () => {
    const r = await ampla(siteQueResponde(formatoDesconhecido), { formulacoes: ["tese a", "tese b"], tribunais: ["stj", "tjgo"] });

    expect(r.isError).toBe(true);
    for (const busca of ["STJ / formulação 1", "STJ / formulação 2", "TJGO / formulação 1", "TJGO / formulação 2"]) {
      expect(r.texto).toMatch(new RegExp(`${busca}: .*formato`));
    }
    expect(r.texto).toMatch(/^Nenhuma das 4 buscas deu resposta/);
    expect(r.texto).not.toMatch(/base não oficial/);
  });

  it("recusa já na primeira busca, nenhuma feita: responde com erro e a mensagem de recusa", async () => {
    const r = await ampla(siteQueResponde(() => new Response("", { status: 429 })), { formulacoes: ["tese a", "tese b"], tribunais: ["stj"] });

    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/recusou a chamada duas vezes/);
    expect(r.texto).toMatch(/Espere alguns minutos e tente de novo/);
    expect(r.texto).toMatch(/^Nenhuma das 2 buscas deu resposta/);
    expect(r.texto).not.toMatch(/base não oficial/);
  });

  it("falha parcial: um tribunal deu resposta e o outro só erro → resultado, com o tribunal \"com erro\"", async () => {
    const r = await ampla(
      siteQueResponde((tribunal, n) => (tribunal === "stj" ? respostaJson({ results: [acordao(`ok${n}`)] }) : formatoDesconhecido())),
      { formulacoes: ["tese a", "tese b"], tribunais: ["stj", "tjgo"] },
    );

    expect(r.isError).toBeFalsy();
    const dado = JSON.parse(r.texto);
    expect(dado.acordaos).toHaveLength(2);
    expect(dado.cabecalhoDeCobertura.porTribunal.find((t: { tribunal: string }) => t.tribunal === "tjgo")).toMatchObject({
      comErro: 2,
      situacao: "com erro",
    });
  });

  it("recusa no meio, com alguma busca feita: resultado parcial com o aviso de busca incompleta no topo", async () => {
    const r = await ampla(
      siteQueResponde((_t, n) => (n === 0 ? respostaJson({ results: [acordao("ok")] }) : new Response("", { status: 429 }))),
      { formulacoes: ["tese a", "tese b", "tese c", "tese d"], tribunais: ["stj"] },
    );

    expect(r.isError).toBeFalsy();
    const dado = JSON.parse(r.texto);
    expect(dado.completa).toBe(false);
    expect(dado.acordaos).toHaveLength(1);
    expect(dado.avisos[0]).toMatch(/^BUSCA INCOMPLETA: 1 de 4 buscas/);
  });
});

describe("erros que ensinam e listas como texto", () => {
  /** Site falso que anota cada busca que chegou (tribunal e texto) e devolve um acórdão por busca. */
  function siteQueAnota() {
    const buscas: string[] = [];
    let n = 0;
    const site = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async (url: string, init: RequestInit) => {
        const tribunal = String(url).match(/tribunais\/(\w+)\/search/)![1];
        buscas.push(`${tribunal}: ${JSON.parse(String(init.body)).query}`);
        const id = `a${n++}`;
        return respostaJson({
          results: [{ id, texto_ementa: `EMENTA FICTÍCIA ${id}.`, numero_processo: `${id}/UF`, link_pdf: `https://exemplo.test/${id}` }],
        });
      }) as typeof fetch,
    });
    return { site, buscas };
  }

  async function chamar(site: Cliente, name: string, args: Record<string, unknown>) {
    const mcp = await conectar(site);
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: r.isError, texto: r.content[0].text };
  }

  // Embrulho técnico da validação que o modelo não deve receber.
  const TECNICO = /validation|Invalid|invalid_|"code"|"path"|MCP error/;

  it("tribunal inválido: frase em português com as siglas válidas, sem texto técnico e sem chamar o site", async () => {
    const { site, buscas } = siteQueAnota();
    const respostas = [
      await chamar(site, "busca_direta", { tribunal: "trf9", texto: "responsabilidade civil" }),
      await chamar(site, "busca_ampla", { formulacoes: ["responsabilidade civil"], tribunais: ["stj", "trf9"] }),
      await chamar(site, "obter_inteiro_teor", { tribunal: "trf9", link: "https://exemplo.test/trf9.pdf" }),
    ];

    for (const r of respostas) {
      expect(r.isError).toBe(true);
      expect(r.texto).toMatch(/Tribunal "trf9" não existe no Garimpo/);
      expect(r.texto).toMatch(/stf, stj, .*tjgo/);
      expect(r.texto).not.toMatch(TECNICO);
    }
    expect(buscas).toEqual([]);
  });

  it("data fora do formato: frase \"use AAAA-MM-DD\", sem texto técnico e sem chamar o site", async () => {
    const { site, buscas } = siteQueAnota();
    const respostas = [
      await chamar(site, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil", de: "15/03/2024" }),
      await chamar(site, "busca_ampla", { formulacoes: ["responsabilidade civil"], tribunais: ["stj"], ate: "2024-3-15" }),
    ];

    for (const r of respostas) {
      expect(r.isError).toBe(true);
      expect(r.texto).toMatch(/use AAAA-MM-DD/);
      expect(r.texto).not.toMatch(TECNICO);
    }
    expect(respostas[0].texto).toMatch(/"15\/03\/2024"/);
    expect(buscas).toEqual([]);
  });

  it("formulações e tribunais mandados como texto de lista JSON: a busca roda normalmente", async () => {
    const { site, buscas } = siteQueAnota();
    const r = await chamar(site, "busca_ampla", {
      formulacoes: '["responsabilidade civil", "dano moral"]',
      tribunais: '["stj", "tjgo"]',
    });

    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.texto).acordaos).toHaveLength(4);
    expect(buscas.sort()).toEqual(["stj: dano moral", "stj: responsabilidade civil", "tjgo: dano moral", "tjgo: responsabilidade civil"]);
  });

  it("texto solto vale como um item só, inteiro: nunca parte por vírgula", async () => {
    const { site, buscas } = siteQueAnota();
    const r = await chamar(site, "busca_ampla", { formulacoes: "art. 37, § 6º", tribunais: "stj" });

    expect(r.isError).toBeFalsy();
    expect(buscas).toEqual(["stj: art. 37, § 6º"]);
    expect(JSON.parse(r.texto).cabecalhoDeCobertura.porTribunal).toHaveLength(1);
  });

  it("os limites (até 20 formulações, até 5 tribunais) valem depois da conversão, sem chamar o site", async () => {
    const { site, buscas } = siteQueAnota();
    const vinteEUma = JSON.stringify(Array.from({ length: 21 }, (_, i) => `tese ${i + 1}`));
    const seisTribunais = JSON.stringify(["stf", "stj", "tst", "tse", "stm", "tjgo"]);
    const respostas = [
      await chamar(site, "busca_ampla", { formulacoes: vinteEUma, tribunais: "stj" }),
      await chamar(site, "busca_ampla", { formulacoes: "responsabilidade civil", tribunais: seisTribunais }),
    ];

    for (const r of respostas) expect(r.isError).toBe(true);
    expect(buscas).toEqual([]);
  });
});

describe("ler inteiro teor em partes (pela porta)", () => {
  const LINK_TJMG = "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=1";
  // Teto da resposta: cerca de 8 mil tokens estimados, a 3 caracteres por token, cabeçalho incluído.
  const TETO = 24_000;
  /** Página genérica de linhas únicas e reconhecíveis ("Pagina 7 linha 3: …"). */
  const pagina = (n: number, linhas = 25) =>
    Array.from({ length: linhas }, (_, i) => `Pagina ${n} linha ${i + 1}: texto generico de exemplo sobre responsabilidade civil.`);

  type Resposta = { isError?: boolean; texto: string };

  /** Servidor com um TJMG falso que entrega este PDF, uma pasta temporária e o PDF já baixado pelo Garimpo. */
  async function baixado(pdf: Uint8Array<ArrayBuffer>, registros: unknown[] = []) {
    const pasta = await mkdtemp(join(tmpdir(), "garimpo-leitura-"));
    const tjmg = clienteFalso([new Response(pdf)]);
    const mcp = await conectar(siteFalso(registros), { tribunais: () => tjmg.cliente, pasta });
    const chamar = async (name: string, args: Record<string, unknown>): Promise<Resposta> => {
      const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { isError: r.isError, texto: r.content[0].text };
    };
    if (registros.length) await chamar("busca_direta", { tribunal: "tjmg", texto: "exemplo" });
    const args = registros.length ? { id: "tjmg:701" } : { tribunal: "tjmg", link: LINK_TJMG };
    const salvo = JSON.parse((await chamar("obter_inteiro_teor", args)).texto);
    const ler = (parte?: number, caminho: string = salvo.arquivo) =>
      chamar("ler_inteiro_teor", parte === undefined ? { caminho } : { caminho, parte });
    return { pasta, salvo, ler, chamar };
  }

  /** Lê todas as partes, da 1ª à última que a 1ª anuncia. */
  async function todas(ler: (parte?: number) => Promise<Resposta>) {
    const primeira = await ler(1);
    expect(primeira.isError, primeira.texto).toBeFalsy();
    const total = Number(JSON.parse(primeira.texto).cabecalho.paginasDoPdf.match(/\(parte 1 de (\d+)\)$/)[1]);
    const respostas = [primeira];
    for (let p = 2; p <= total; p++) respostas.push(await ler(p));
    return respostas;
  }

  it("PDF de várias páginas: as partes cobrem todas as páginas, sem perda nem repetição, e dizem onde se está", async () => {
    const paginas = Array.from({ length: 30 }, (_, i) => pagina(i + 1));
    const { ler } = await baixado(pdfSintetico(paginas));
    const respostas = await todas(ler);

    expect(respostas.length).toBeGreaterThan(1);
    let seguinte = 1;
    respostas.forEach((r, i) => {
      expect(r.isError).toBeFalsy();
      expect(r.texto.length).toBeLessThanOrEqual(TETO);
      const { cabecalho, texto } = JSON.parse(r.texto);
      const [, x, y] = cabecalho.paginasDoPdf.match(
        new RegExp(`^páginas? (\\d+)(?:–(\\d+))? de 30 \\(parte ${i + 1} de ${respostas.length}\\)$`),
      );
      expect(Number(x)).toBe(seguinte);
      seguinte = Number(y ?? x) + 1;
      expect(texto).toMatch(new RegExp(`^\\[página ${x} de 30\\]`));
    });
    expect(seguinte).toBe(31);

    const tudo = respostas.map((r) => JSON.parse(r.texto).texto).join("\n");
    for (const linha of paginas.flat()) expect(tudo.split(linha).length - 1, linha).toBe(1);
    for (let n = 1; n <= 30; n++) expect(tudo.split(`[página ${n} de 30]`).length - 1).toBe(1);
  });

  it("página grande demais: dividida em segmentos com a continuação indicada, sem perder texto, e sempre igual", async () => {
    const grande = pagina(2, 600);
    const { ler } = await baixado(pdfSintetico([pagina(1), grande, pagina(3)]));
    const respostas = await todas(ler);
    const textos = respostas.map((r) => JSON.parse(r.texto).texto as string);

    for (const r of respostas) expect(r.texto.length).toBeLessThanOrEqual(TETO);
    const segmentos = textos.join("\n").match(/\[página 2 de 3, segmento \d+ de \d+[^\]]*\]/g) ?? [];
    expect(segmentos.length).toBeGreaterThan(1);
    segmentos.forEach((s, k) => {
      const ultimo = k === segmentos.length - 1;
      expect(s).toBe(
        `[página 2 de 3, segmento ${k + 1} de ${segmentos.length}${ultimo ? "" : `; continua no segmento ${k + 2}`}]`,
      );
    });
    expect(JSON.parse(respostas[1].texto).cabecalho.paginasDoPdf).toMatch(/^página 2 de 3 \(parte 2 de \d+\)$/);
    const tudo = textos.join("\n");
    for (const linha of [...pagina(1), ...grande, ...pagina(3)]) expect(tudo.split(linha).length - 1, linha).toBe(1);
    // Determinística: a mesma parte, lida de novo, vem igual.
    expect((await ler(2)).texto).toBe(respostas[1].texto);
  });

  describe("origem", () => {
    const acordao = {
      id: "701",
      texto_ementa: "EMENTA FICTÍCIA.",
      numero_processo: "1.0000.00.000002-0/001",
      data_julgamento: "2024-03-15T00:00:00.000Z",
      link_pdf: LINK_TJMG,
    };
    const naoInformado = { tribunal: "não informado", numero: "não informado", data: "não informado", linkOficial: "não informado", id: "não informado" };

    it("recibo válido e mesmo sha256: origem conferida, cabeçalho completo vindo do recibo, sem aviso de origem", async () => {
      const pdf = pdfSintetico([pagina(1)]);
      const { salvo, ler } = await baixado(pdf, [acordao]);
      const r = await ler();
      expect(r.isError).toBeFalsy();
      const dado = JSON.parse(r.texto);
      expect(dado.cabecalho).toEqual({
        tribunal: "TJMG",
        numero: "1.0000.00.000002-0/001",
        data: "2024-03-15",
        linkOficial: LINK_TJMG,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        id: "tjmg:701",
        arquivo: basename(salvo.arquivo),
        origem: expect.stringMatching(/^conferida: download pelo Garimpo em \d{4}-\d{2}-\d{2}T.*mesmo sha256/),
        paginasDoPdf: "página 1 de 1 (parte 1 de 1)",
      });
      expect(dado.avisos).toEqual([]);
      expect(dado.vinculoDeclarado).toBeUndefined();
      expect(dado.proximaParte).toBeUndefined();
    });

    it("sem recibo: tratado como trazido pelo usuário (origem declarada, não conferida), com aviso de recibo ausente, e o texto sai do mesmo jeito", async () => {
      const { salvo, ler } = await baixado(pdfSintetico([pagina(1)]), [acordao]);
      await rm(salvo.recibo);
      const dado = JSON.parse((await ler()).texto);
      expect(dado.cabecalho).toMatchObject({
        ...naoInformado,
        origem: "declarada pelo usuário, não conferida (inteiro teor trazido pelo usuário)",
      });
      expect(dado.avisos).toEqual([expect.stringMatching(/não conferida: não há recibo de origem ao lado deste PDF/)]);
      expect(dado.vinculoDeclarado).toBeUndefined();
      expect(dado.texto).toContain(pagina(1)[0]);
    });

    it("recibo de formato desconhecido: não conferida, com aviso de formato", async () => {
      const { salvo, ler } = await baixado(pdfSintetico([pagina(1)]), [acordao]);
      const recibo = await readFile(salvo.recibo, "utf8");
      await writeFile(salvo.recibo, recibo.replace("versão 1", "versão 99"));
      const dado = JSON.parse((await ler()).texto);
      expect(dado.cabecalho).toMatchObject({ ...naoInformado, origem: "não conferida" });
      expect(dado.avisos).toEqual([expect.stringMatching(/^Origem não conferida: o recibo .* não está num formato que o Garimpo reconheça/)]);
    });

    it("recibo que não registra download pelo Garimpo: não conferida, e os dados do recibo só como vínculo declarado", async () => {
      const { salvo, ler } = await baixado(pdfSintetico([pagina(1)]), [acordao]);
      const recibo = await readFile(salvo.recibo, "utf8");
      await writeFile(salvo.recibo, recibo.replace("Origem: download pelo Garimpo", "Origem: declarada pelo usuário"));
      const dado = JSON.parse((await ler()).texto);
      expect(dado.cabecalho).toMatchObject({ ...naoInformado, origem: "não conferida" });
      expect(dado.avisos).toEqual([expect.stringMatching(/^Origem não conferida: o recibo .* não registra download pelo Garimpo/)]);
      expect(dado.vinculoDeclarado).toMatchObject({ tribunal: "TJMG", id: "tjmg:701" });
    });

    it("PDF mudou depois do download (sha256 diferente): não conferida, e os dados do recibo só como vínculo declarado", async () => {
      const { salvo, ler } = await baixado(pdfSintetico([pagina(1)]), [acordao]);
      const outro = pdfSintetico([pagina(9)]);
      await writeFile(salvo.arquivo, outro);
      const dado = JSON.parse((await ler()).texto);
      expect(dado.cabecalho).toMatchObject({
        ...naoInformado,
        origem: "não conferida",
        sha256: createHash("sha256").update(outro).digest("hex"),
      });
      expect(dado.avisos).toEqual([expect.stringMatching(/^Origem não conferida: o PDF mudou depois do download/)]);
      expect(dado.vinculoDeclarado).toMatchObject({ tribunal: "TJMG", id: "tjmg:701", declaradoPor: expect.stringMatching(/sha256/) });
    });

    it("vínculo informado para um PDF de origem conferida: não é usado, e o cabeçalho continua vindo do recibo", async () => {
      const { ler, salvo, chamar } = await baixado(pdfSintetico([pagina(1)]), [acordao]);
      const semVinculo = JSON.parse((await ler()).texto);
      const dado = JSON.parse((await chamar("ler_inteiro_teor", { caminho: salvo.arquivo, tribunal: "tjgo", numero: "9999999" })).texto);
      expect(dado.cabecalho).toEqual(semVinculo.cabecalho);
      expect(dado.avisos).toEqual([expect.stringMatching(/^O vínculo informado não foi usado: a origem deste PDF é conferida pelo recibo/)]);
    });
  });

  it("página sem texto extraível: aviso na própria página; PDF inteiro sem texto: aviso no topo, nunca \"sem conteúdo\"", async () => {
    const misto = await baixado(pdfSintetico([pagina(1), [], pagina(3)]));
    const dadoMisto = JSON.parse((await misto.ler()).texto);
    expect(dadoMisto.texto).toContain("[página 2 de 3: sem texto extraível; pode ser escaneada]");
    expect(dadoMisto.avisos.join(" ")).not.toMatch(/Nenhuma página/);

    const vazio = await baixado(pdfSintetico([[], []]));
    const dadoVazio = JSON.parse((await vazio.ler()).texto);
    expect(dadoVazio.avisos[0]).toMatch(/^Nenhuma página deste PDF tem texto extraível; pode ser escaneado\. O Garimpo não faz OCR/);
    expect(dadoVazio.texto).toBe(
      "[página 1 de 2: sem texto extraível; pode ser escaneada]\n\n[página 2 de 2: sem texto extraível; pode ser escaneada]",
    );
  });

  it("PDF truncado: erro de leitura explícito, nunca \"sem conteúdo\" nem \"sem texto\"", async () => {
    const pdf = pdfSintetico([pagina(1), pagina(2)]);
    const { salvo, ler } = await baixado(pdf);
    await writeFile(salvo.arquivo, pdf.subarray(0, Math.floor(pdf.length * 0.6)));
    const r = await ler();
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/^Erro de leitura: o extrator não conseguiu ler o PDF .*truncado ou corrompido/);
    expect(r.texto).not.toMatch(/sem conteúdo|sem texto/);
  });

  it("parte inexistente: erro que ensina o total de partes", async () => {
    const { ler } = await baixado(pdfSintetico([pagina(1)]));
    for (const parte of [2, 0]) {
      const r = await ler(parte);
      expect(r.isError).toBe(true);
      expect(r.texto).toBe(`A parte ${parte} não existe: este PDF tem 1 parte (de 1 a 1).`);
    }
  });

  it("a resposta traz a chamada pronta para a parte seguinte, e a última não", async () => {
    const { salvo, ler } = await baixado(pdfSintetico(Array.from({ length: 30 }, (_, i) => pagina(i + 1))));
    const respostas = await todas(ler);
    respostas.forEach((r, i) => {
      const { proximaParte } = JSON.parse(r.texto);
      if (i === respostas.length - 1) expect(proximaParte).toBeUndefined();
      else expect(proximaParte).toEqual({ ferramenta: "ler_inteiro_teor", argumentos: { caminho: salvo.arquivo, parte: i + 2 } });
    });
  });

  it("só lê: nada é gravado nem apagado na pasta", async () => {
    const { pasta, ler } = await baixado(pdfSintetico([pagina(1), []]));
    const antes = (await readdir(pasta)).sort();
    await ler(1);
    await ler(5);
    expect((await readdir(pasta)).sort()).toEqual(antes);
  });
});

describe("inteiro teor trazido pelo usuário (pela porta)", () => {
  const pagina = (n: number) =>
    Array.from({ length: 5 }, (_, i) => `Pagina ${n} linha ${i + 1}: texto generico de exemplo sobre responsabilidade civil.`);
  type Resposta = { isError?: boolean; texto: string };

  /** Servidor sem tribunal nenhum (a leitura não chama a rede) e uma pasta qualquer, fora da pasta do Garimpo. */
  async function montar(registros: unknown[] = []) {
    const pastaDoUsuario = await mkdtemp(join(tmpdir(), "garimpo-usuario-"));
    const pasta = await mkdtemp(join(tmpdir(), "garimpo-pasta-"));
    const mcp = await conectar(siteFalso(registros), {
      tribunais: () => {
        throw new Error("a leitura não pode chamar tribunal");
      },
      pasta,
    });
    const chamar = async (name: string, args: Record<string, unknown>): Promise<Resposta> => {
      const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { isError: r.isError, texto: r.content[0].text };
    };
    return { pastaDoUsuario, pasta, chamar };
  }

  it("PDF numa pasta qualquer: lido, com origem declarada pelo usuário e o sha256 no cabeçalho; nada gravado na pasta", async () => {
    const { pastaDoUsuario, pasta, chamar } = await montar();
    const pdf = pdfSintetico([pagina(1), pagina(2)]);
    const caminho = join(pastaDoUsuario, "acordao baixado à mão.pdf");
    await writeFile(caminho, pdf);

    const r = await chamar("ler_inteiro_teor", { caminho });
    expect(r.isError, r.texto).toBeFalsy();
    const dado = JSON.parse(r.texto);
    expect(dado.cabecalho).toEqual({
      tribunal: "não informado",
      numero: "não informado",
      data: "não informado",
      linkOficial: "não informado",
      sha256: createHash("sha256").update(pdf).digest("hex"),
      id: "não informado",
      arquivo: "acordao baixado à mão.pdf",
      origem: "declarada pelo usuário, não conferida (inteiro teor trazido pelo usuário)",
      paginasDoPdf: "páginas 1–2 de 2 (parte 1 de 1)",
    });
    expect(dado.avisos).toEqual([
      expect.stringMatching(/^Inteiro teor trazido pelo usuário — origem declarada, não conferida: não há recibo de origem/),
    ]);
    expect(dado.avisos[0]).toMatch(/Não trate este PDF como inteiro teor oficial/);
    expect(r.texto).not.toMatch(/conferida: download|origem oficial/);
    expect(dado.texto).toContain(pagina(2)[4]);
    expect(await readdir(pastaDoUsuario)).toEqual(["acordao baixado à mão.pdf"]);
    expect(await readdir(pasta)).toEqual([]);
  });

  it("recusa, com mensagem clara, arquivo que não é PDF, PDF acima de 50 MB, caminho de pasta e URL", async () => {
    const { pastaDoUsuario, chamar } = await montar();
    const texto = join(pastaDoUsuario, "notas.pdf");
    await writeFile(texto, "Isto e um texto comum com extensao de PDF.");
    const grande = join(pastaDoUsuario, "grande.pdf");
    await writeFile(grande, "%PDF-1.4\n");
    await truncate(grande, 50 * 1024 * 1024 + 1);

    const casos: [string, RegExp][] = [
      [texto, /^O arquivo .*notas\.pdf não é um PDF \(não começa com a assinatura %PDF\)/],
      [grande, /^O arquivo .*grande\.pdf passa de 50 MB/],
      [pastaDoUsuario, /^O caminho .* é uma pasta, não um arquivo\. Informe o caminho do PDF/],
      ["https://exemplo.test/acordao.pdf", /^O ler_inteiro_teor não aceita endereço da internet/],
      ["file:///C:/acordao.pdf", /^O ler_inteiro_teor não aceita endereço da internet/],
      [join(pastaDoUsuario, "nao-existe.pdf"), /^Não consegui ler o arquivo /],
    ];
    for (const [caminho, mensagem] of casos) {
      const r = await chamar("ler_inteiro_teor", { caminho });
      expect(r.isError, caminho).toBe(true);
      expect(r.texto, caminho).toMatch(mensagem);
    }
    expect((await readdir(pastaDoUsuario)).sort()).toEqual(["grande.pdf", "notas.pdf"]);
  });

  describe("vínculo declarado", () => {
    const LINK = "https://exemplo.test/tjsp/acordao/701";
    const acordao = {
      id: "701",
      texto_ementa: "EMENTA FICTÍCIA.",
      numero_processo: "1000002-03.2024.8.26.0001",
      data_julgamento: "2024-03-15T00:00:00.000Z",
      link_pdf: LINK,
    };
    const VINCULO = /^declarado pelo usuário/;

    /** PDF trazido pelo usuário numa pasta qualquer, com estas páginas. */
    async function trazido(paginas: string[][], registros: unknown[] = []) {
      const m = await montar(registros);
      if (registros.length) await m.chamar("busca_direta", { tribunal: "tjsp", texto: "exemplo" });
      const caminho = join(m.pastaDoUsuario, "acordao.pdf");
      await writeFile(caminho, pdfSintetico(paginas));
      return { ...m, caminho };
    }

    it("pelo id da busca: cabeçalho preenchido da memória da sessão, com a marca \"declarado\", número encontrado no texto, e a parte seguinte com o mesmo vínculo", async () => {
      const paginas = Array.from({ length: 30 }, (_, i) =>
        i === 0 ? ["Processo n. 1000002-03.2024.8.26.0001", ...pagina(1)] : [...pagina(i + 1), ...pagina(i + 1), ...pagina(i + 1), ...pagina(i + 1), ...pagina(i + 1)],
      );
      const { caminho, chamar } = await trazido(paginas, [acordao]);
      const r = await chamar("ler_inteiro_teor", { caminho, id: "tjsp:701" });
      expect(r.isError, r.texto).toBeFalsy();
      const dado = JSON.parse(r.texto);
      expect(dado.cabecalho).toMatchObject({
        tribunal: "TJSP",
        numero: "1000002-03.2024.8.26.0001",
        data: "2024-03-15",
        linkOficial: LINK,
        id: "tjsp:701",
        origem: "declarada pelo usuário, não conferida (inteiro teor trazido pelo usuário)",
        vinculo: expect.stringMatching(VINCULO),
        numeroNoTexto: "encontrado",
      });
      expect(dado.cabecalho.vinculo).toMatch(/não prova/);
      expect(dado.proximaParte).toEqual({ ferramenta: "ler_inteiro_teor", argumentos: { caminho, parte: 2, id: "tjsp:701" } });
      const segunda = JSON.parse((await chamar("ler_inteiro_teor", dado.proximaParte.argumentos)).texto);
      expect({ ...segunda.cabecalho, paginasDoPdf: "" }).toEqual({ ...dado.cabecalho, paginasDoPdf: "" });
    });

    it("por tribunal + número: o que não foi informado fica \"não informado\"; número com outra pontuação no texto conta como encontrado", async () => {
      const { caminho, chamar } = await trazido([["Recurso 1.000.002/0001 julgado."], pagina(2)]);
      const dado = JSON.parse((await chamar("ler_inteiro_teor", { caminho, tribunal: "tjgo", numero: "10000020001" })).texto);
      expect(dado.cabecalho).toMatchObject({
        tribunal: "TJGO",
        numero: "10000020001",
        data: "não informado",
        linkOficial: "não informado",
        id: "não informado",
        vinculo: expect.stringMatching(VINCULO),
        numeroNoTexto: "encontrado",
      });
    });

    it("número que não está no texto: \"não encontrado\", e a leitura sai do mesmo jeito", async () => {
      const { caminho, chamar } = await trazido([pagina(1)]);
      const r = await chamar("ler_inteiro_teor", { caminho, tribunal: "tjgo", numero: "5000009-99.2023.8.09.0001" });
      expect(r.isError).toBeFalsy();
      const dado = JSON.parse(r.texto);
      expect(dado.cabecalho.numeroNoTexto).toBe("não encontrado");
      expect(dado.texto).toContain(pagina(1)[0]);
    });

    it("\"não verificável\" quando o PDF não tem texto extraível ou quando não há número para conferir", async () => {
      const semTexto = await trazido([[], []]);
      const a = JSON.parse((await semTexto.chamar("ler_inteiro_teor", { caminho: semTexto.caminho, tribunal: "tjgo", numero: "5000009-99.2023.8.09.0001" })).texto);
      expect(a.cabecalho.numeroNoTexto).toBe("não verificável");

      // Id que não está na memória desta sessão: vale o que foi informado, sem nova chamada à rede.
      const semNumero = await trazido([pagina(1)]);
      const b = JSON.parse((await semNumero.chamar("ler_inteiro_teor", { caminho: semNumero.caminho, id: "tjsp:999" })).texto);
      expect(b.cabecalho).toMatchObject({
        id: "tjsp:999",
        tribunal: "TJSP",
        numero: "não informado",
        vinculo: expect.stringMatching(VINCULO),
        numeroNoTexto: "não verificável",
      });
      expect(b.avisos).toContainEqual("O acórdão tjsp:999 não está na memória desta sessão: o cabeçalho traz só o que foi informado.");
    });

    it("sem vínculo informado: nem marca de vínculo nem conferência do número", async () => {
      const { caminho, chamar } = await trazido([pagina(1)]);
      const dado = JSON.parse((await chamar("ler_inteiro_teor", { caminho })).texto);
      expect(dado.cabecalho.vinculo).toBeUndefined();
      expect(dado.cabecalho.numeroNoTexto).toBeUndefined();
    });

    it("tribunal que não existe: erro que ensina as siglas", async () => {
      const { caminho, chamar } = await trazido([pagina(1)]);
      const r = await chamar("ler_inteiro_teor", { caminho, tribunal: "xyz", numero: "123456" });
      expect(r.isError).toBe(true);
      expect(r.texto).toMatch(/^Tribunal "xyz" não existe no Garimpo/);
    });
  });
});

describe("ponte: resposta \"só link\" ensina a ler o PDF baixado no navegador (pela porta)", () => {
  it("STF, TJGO e um tribunal genérico: a explicação traz a instrução de baixar e passar o caminho ao ler_inteiro_teor, sem chamar o tribunal", async () => {
    const chamadas: string[] = [];
    const mcp = await conectar(siteFalso([]), {
      tribunais: (sigla) => {
        chamadas.push(sigla);
        throw new Error("só link não chama tribunal");
      },
      pasta: await mkdtemp(join(tmpdir(), "garimpo-ponte-")),
    });
    for (const tribunal of ["stf", "tjgo", "tjrs"]) {
      const r = (await mcp.callTool({
        name: "obter_inteiro_teor",
        arguments: { tribunal, link: `https://exemplo.test/${tribunal}/acordao` },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError, tribunal).toBeFalsy();
      const dado = JSON.parse(r.content[0].text);
      expect(dado).toMatchObject({ baixado: false, link: `https://exemplo.test/${tribunal}/acordao` });
      expect(dado.explicacao, tribunal).toMatch(
        /Para ler pelo Garimpo: abra o link no navegador, baixe o PDF e passe o caminho do arquivo ao ler_inteiro_teor/,
      );
    }
    expect(chamadas).toEqual([]);
  });
});

describe("ordem de leitura do texto do PDF (pela porta)", () => {
  /** Texto da página 1 lido pelo ler_inteiro_teor, sem o marcador de página: PDF numa pasta qualquer, sem rede. */
  async function lido(posicionados: TextoPosicionado[]) {
    const pasta = await mkdtemp(join(tmpdir(), "garimpo-ordem-"));
    const caminho = join(pasta, "ordem.pdf");
    await writeFile(caminho, pdfSintetico([posicionados]));
    const mcp = await conectar(siteFalso([]), { tribunais: () => { throw new Error("a leitura não chama tribunal"); }, pasta });
    const r = (await mcp.callTool({ name: "ler_inteiro_teor", arguments: { caminho } })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError, r.content[0].text).toBeFalsy();
    return (JSON.parse(r.content[0].text).texto as string).replace(/^\[página 1 de 1\]\n/, "");
  }

  it("pedaços de uma linha desenhados fora da ordem (como negrito, itálico ou link) saem na ordem visual", async () => {
    const texto = await lido([
      { x: 30, y: 800, texto: "Primeira linha do voto, sem formatacao nenhuma." },
      { x: 250, y: 788, texto: "o que nao ocorreu no caso." },
      { x: 30, y: 788, texto: "conforme o item (i) do art. 36-A," },
      { x: 30, y: 776, texto: "em que ha" },
      { x: 300, y: 776, texto: "devem ser de iniciativa" },
      { x: 80, y: 776, texto: "mencao a pretensa candidatura" },
    ]);
    expect(texto).toBe(
      "Primeira linha do voto, sem formatacao nenhuma.\n" +
        "conforme o item (i) do art. 36-A, o que nao ocorreu no caso.\n" +
        "em que ha mencao a pretensa candidatura devem ser de iniciativa",
    );
  });

  it("colunas, cabeçalho, citação recuada, carimbo de margem girado e rodapé não embaralham, cada um na sua linha", async () => {
    const texto = await lido([
      { x: 30, y: 820, texto: "CABECALHO GENERICO DO TRIBUNAL" },
      { x: 30, y: 780, texto: "Coluna um, linha um." },
      { x: 30, y: 768, texto: "Coluna um, linha dois." },
      { x: 310, y: 780, texto: "Coluna dois, linha um." },
      { x: 310, y: 768, texto: "Coluna dois, linha dois." },
      { x: 80, y: 700, texto: "Citacao recuada, primeira linha," },
      { x: 80, y: 688, texto: "citacao recuada, segunda linha." },
      { x: 570, y: 100, texto: "Carimbo generico na margem", girado: true },
      { x: 30, y: 650, texto: "Ultimo paragrafo do voto." },
      { x: 30, y: 30, texto: "Rodape generico com assinatura eletronica.", tamanho: 7 },
    ]);
    expect(texto).toBe(
      [
        "CABECALHO GENERICO DO TRIBUNAL",
        "Coluna um, linha um.",
        "Coluna um, linha dois.",
        "Coluna dois, linha um.",
        "Coluna dois, linha dois.",
        "Citacao recuada, primeira linha,",
        "citacao recuada, segunda linha.",
        "Carimbo generico na margem",
        "Ultimo paragrafo do voto.",
        "Rodape generico com assinatura eletronica.",
      ].join("\n"),
    );
  });

  it("fim de página: o carimbo de assinatura aposto à parte sai na sua linha, não colado ao último parágrafo", async () => {
    const texto = await lido([
      { x: 30, y: 650, texto: "Ultimo paragrafo do voto." },
      { x: 30, y: 30, texto: "Assinado eletronicamente em data generica.", tamanho: 7, carimbo: true },
    ]);
    expect(texto).toBe("Ultimo paragrafo do voto.\nAssinado eletronicamente em data generica.");
  });

  it("expoente de nota de rodapé fica na linha, e carimbo de margem girado em dois pedaços sai numa linha só", async () => {
    const texto = await lido([
      { x: 30, y: 800, texto: "Texto do voto" },
      { x: 100, y: 804, texto: "1", tamanho: 6 },
      { x: 106, y: 800, texto: "e segue na mesma linha." },
      { x: 570, y: 100, texto: "Documento assinado", girado: true },
      { x: 570, y: 200, texto: "digitalmente", girado: true },
      { x: 30, y: 788, texto: "Linha seguinte do voto." },
    ]);
    const linhas = texto.split("\n");
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toMatch(/^Texto do voto ?1 ?e segue na mesma linha\.$/);
    expect(linhas[1]).toMatch(/^Documento assinado ?digitalmente$/);
    expect(linhas[2]).toBe("Linha seguinte do voto.");
  });
});
