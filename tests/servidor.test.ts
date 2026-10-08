import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { Cliente, VERSAO } from "../src/cliente.js";
import { criarServidor, type OpcoesServidor } from "../src/servidor.js";
import { clienteFalso, respostaJson } from "./apoio.js";

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
  it("marca como só leem as buscas, obter ementa e listar tribunais; obter inteiro teor não, nem destrutiva; as buscas saem para a internet", async () => {
    const mcp = await conectar(siteFalso([]));
    const { tools } = await mcp.listTools();
    const marca = Object.fromEntries(tools.map((t) => [t.name, t.annotations ?? {}]));

    for (const nome of ["busca_direta", "busca_ampla", "obter_ementa", "listar_tribunais"]) {
      expect(marca[nome].readOnlyHint, nome).toBe(true);
    }
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
  const PDF = "%PDF-1.7\nconteudo ficticio\n%%EOF";
  const pdf = () => new Response(new TextEncoder().encode(PDF), { headers: { "content-type": "application/pdf" } });
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
      new Response(`--fronteiraXYZ\r\nContent-Type: application/octet-stream\r\n\r\n${PDF}\r\n--fronteiraXYZ--\r\n`),
    ]);

  it("STJ, TJMG e TSE falsos: baixa e grava o PDF na pasta injetada, com a resposta de sempre", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "garimpo-porta-"));
    const falsos = { stj: stjFalso(), tjmg: clienteFalso([pdf()]), tse: tseFalso() };
    const mcp = await conectar(siteFalso([]), {
      tribunais: (sigla) => falsos[sigla as keyof typeof falsos].cliente,
      pasta,
    });
    const links = {
      stj: "https://scon.stj.jus.br/SCON/GetInteiroTeorDoAcordao?num_registro=202000000001&dt_publicacao=10/12/2020",
      tjmg: "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=1",
      tse: "https://sjur-servicos.tse.jus.br/sjur-servicos/rest/download/pdf/1",
    };

    for (const [tribunal, link] of Object.entries(links)) {
      const r = (await mcp.callTool({ name: "obter_inteiro_teor", arguments: { tribunal, link } })) as {
        content: { text: string }[];
        isError?: boolean;
      };
      expect(r.isError, tribunal).toBeFalsy();
      const dado = JSON.parse(r.content[0].text);
      expect(Object.keys(dado).sort(), tribunal).toEqual(["arquivo", "baixado", "bytes", "fonte", "recibo", "sha256"]);
      expect(dado).toMatchObject({ baixado: true, bytes: PDF.length, fonte: link });
      expect(dirname(dado.arquivo), tribunal).toBe(pasta);
      expect(await readFile(dado.arquivo, "latin1"), tribunal).toBe(PDF);
    }
    expect((await readdir(pasta)).filter((f) => f.endsWith(".pdf"))).toHaveLength(3);
    expect(falsos.stj.chamadas).toHaveLength(3);
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
