import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { clienteFalso, respostaJson } from "./apoio.js";
import { pdfSintetico } from "./pdfSintetico.js";

/**
 * PDF já baixado reaproveitado pelo recibo de origem (ADR-0011), pela porta do servidor montado: site e tribunais
 * falsos que contam as chamadas, pasta de destino e pasta de dados temporárias, relógio falso. Sem rede.
 */

const HORA = 3_600_000;
const LINKS = {
  stj: "https://scon.stj.jus.br/SCON/GetInteiroTeorDoAcordao?num_registro=202000000001&dt_publicacao=10/12/2020",
  tjmg: "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=1",
  tse: "https://sjur-servicos.tse.jus.br/sjur-servicos/rest/download/pdf/1",
};
type Sigla = keyof typeof LINKS;

/** PDF sintético legível de 30 páginas (dá mais de uma parte); `marca` muda os bytes e o texto. */
const pdfDe = (marca: string) =>
  Buffer.from(
    pdfSintetico(
      Array.from({ length: 30 }, (_, p) =>
        Array.from({ length: 25 }, (_, l) => `Pagina ${p + 1} linha ${l + 1}: inteiro teor ficticio ${marca}.`),
      ),
    ),
  );
const resposta = (pdf: Buffer) => new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf" } });
const html = (texto: string, headers: Record<string, string> = {}) =>
  new Response(texto, { headers: { "content-type": "text/html", ...headers } });

/** As respostas de um download completo em cada tribunal falso (STJ em 3 passos; TSE em envelope multipart). */
function download(sigla: Sigla, pdf: Buffer): Parameters<typeof clienteFalso>[0] {
  if (sigla === "stj") {
    const passo3 = "https://processo.stj.jus.br/processo/julgamento/eletronico/documento/?documento_sequencial=1";
    return [
      html(`<a href="javascript:AbreDocumento('/processo/documento/mediado/?documento_sequencial=1')">REsp</a>`),
      html(`<iframe src='${passo3}'></iframe>`),
      resposta(pdf),
    ];
  }
  if (sigla === "tse") {
    const envelope = `--fronteiraXYZ\r\nContent-Type: application/octet-stream\r\n\r\n${pdf.toString("latin1")}\r\n--fronteiraXYZ--\r\n`;
    return [new Response(Buffer.from(envelope, "latin1"))];
  }
  return [resposta(pdf)];
}

let dados: string;
let pasta: string;
let agora: number;

beforeEach(async () => {
  dados = await mkdtemp(join(tmpdir(), "garimpo-reuso-dados-"));
  pasta = await mkdtemp(join(tmpdir(), "garimpo-reuso-pdfs-"));
  agora = Date.UTC(2026, 9, 8, 17, 3);
});
afterEach(async () => {
  vi.useRealTimers();
  // A gravação da memória corre por trás das respostas: pode estar terminando agora.
  await rm(dados, { recursive: true, force: true, maxRetries: 10 });
  await rm(pasta, { recursive: true, force: true, maxRetries: 10 });
});

/**
 * Uma janela do Garimpo: site falso que responde a busca de cada tribunal com os registros dele, e tribunais falsos
 * que entregam o download preparado por `entregar`. Com `tribunaisInacessiveis`, qualquer chamada a tribunal falha.
 */
async function janela(registros: Partial<Record<Sigla, unknown[]>> = {}) {
  const site: string[] = [];
  const falsos = {
    stj: clienteFalso([]),
    tjmg: clienteFalso([]),
    tse: clienteFalso([]),
  };
  const estado = { tribunaisInacessiveis: false };
  const siteFalso = new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string) => {
      site.push(url);
      const sigla = url.match(/tribunais\/(\w+)\/search/)?.[1] as Sigla;
      return respostaJson({ results: registros[sigla] ?? [] });
    }) as typeof fetch,
  });
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(siteFalso, {
    dados,
    agora: () => agora,
    pasta,
    tribunais: (sigla) => {
      if (estado.tribunaisInacessiveis) throw new Error("tribunais inacessíveis: nenhuma chamada a tribunal é permitida");
      return falsos[sigla as Sigla].cliente;
    },
  }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  const chamar = async (name: string, args: Record<string, unknown>) => {
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: Boolean(r.isError), texto: r.content[0].text };
  };
  /** Prepara o próximo download do tribunal com estes bytes. */
  const entregar = (sigla: Sigla, pdf: Buffer) => {
    falsos[sigla] = clienteFalso(download(sigla, pdf));
  };
  const chamadasAosTribunais = () => Object.values(falsos).reduce((n, f) => n + f.chamadas.length, 0);
  return { chamar, entregar, falsos, site, estado, chamadasAosTribunais };
}

/** Registro do site com link do PDF. */
const registro = (id: string, link: string, numero = `0000${id}-00.2020.0.00.0000`) => ({
  id,
  texto_ementa: `EMENTA FICTÍCIA ${id}.`,
  numero_processo: numero,
  data_julgamento: "2024-01-02T00:00:00.000Z",
  link_pdf: link,
});

/** Campos "Campo: valor" do recibo. */
async function camposDoRecibo(caminho: string) {
  const texto = await readFile(caminho, "utf8");
  return Object.fromEntries(
    texto
      .split("\n")
      .filter((l) => l.includes(": "))
      .map((l) => [l.slice(0, l.indexOf(": ")), l.slice(l.indexOf(": ") + 2)]),
  ) as Record<string, string>;
}

describe("PDF já baixado reaproveitado pelo recibo (pela porta)", () => {
  it("2º pedido do mesmo acórdão (STJ, TJMG e TSE falsos): 0 chamadas, 1ª parte igual, data do download original e o aviso de que veio da pasta", async () => {
    const j = await janela({
      stj: [registro("11", LINKS.stj)],
      tjmg: [registro("12", LINKS.tjmg)],
      tse: [registro("13", LINKS.tse)],
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const [sigla, idSite] of [["stj", "11"], ["tjmg", "12"], ["tse", "13"]] as const) {
      await j.chamar("busca_direta", { tribunal: sigla, texto: "responsabilidade civil" });
      vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
      j.entregar(sigla, pdfDe(sigla));
      const primeiro = JSON.parse((await j.chamar("obter_inteiro_teor", { id: `${sigla}:${idSite}` })).texto);
      expect(primeiro.jaEstavaNaPasta, sigla).toBeUndefined();
      const baixadoEm = (await camposDoRecibo(primeiro.recibo))["Data e hora"];
      const chamadasAntes = j.chamadasAosTribunais();
      const buscasAntes = j.site.length;

      vi.setSystemTime(new Date("2026-03-02T12:00:00Z"));
      const r = await j.chamar("obter_inteiro_teor", { id: `${sigla}:${idSite}` });
      expect(r.isError, sigla).toBe(false);
      const segundo = JSON.parse(r.texto);

      expect(j.chamadasAosTribunais(), sigla).toBe(chamadasAntes);
      expect(j.site.length, sigla).toBe(buscasAntes);
      expect(segundo).toMatchObject({
        baixado: true,
        arquivo: primeiro.arquivo,
        recibo: primeiro.recibo,
        sha256: primeiro.sha256,
        bytes: primeiro.bytes,
        fonte: LINKS[sigla],
      });
      for (const campo of ["cabecalho", "avisos", "texto", "proximaParte"]) {
        expect(segundo[campo], `${sigla} ${campo}`).toEqual(primeiro[campo]);
      }
      expect(segundo.cabecalho.origem).toMatch(/^conferida: download pelo Garimpo/);
      expect(segundo.jaEstavaNaPasta).toBe(
        `O PDF já estava na pasta de destino: baixado pelo Garimpo em ${baixadoEm}, com o mesmo sha256 do recibo de ` +
          "origem. Nenhuma chamada foi feita ao tribunal nem ao JurisprudênciaIA. Para obter outra cópia do tribunal, " +
          "mova o PDF e o recibo para fora da pasta de destino.",
      );
    }
    expect((await readdir(pasta)).filter((f) => f.endsWith(".pdf"))).toHaveLength(3);
  });

  it("pedido por tribunal + link (sem id) também reaproveita; texto: false traz o total de páginas, sem chamada", async () => {
    const j = await janela();
    j.entregar("tjmg", pdfDe("link"));
    const primeiro = JSON.parse((await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg })).texto);
    const r = JSON.parse((await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg, texto: false })).texto);
    expect(j.falsos.tjmg.chamadas).toHaveLength(1);
    expect(r).toMatchObject({ arquivo: primeiro.arquivo, totalDePaginasDoPdf: 30 });
    expect(r.jaEstavaNaPasta).toMatch(/^O PDF já estava na pasta de destino/);
  });

  it("memória vencida e tribunais inacessíveis (como na rede parada): reaproveita pelo id e pelo link, sem chamar ninguém", async () => {
    const j = await janela({ tjmg: [registro("21", LINKS.tjmg)] });
    await j.chamar("busca_direta", { tribunal: "tjmg", texto: "responsabilidade civil" });
    j.entregar("tjmg", pdfDe("vencida"));
    const primeiro = JSON.parse((await j.chamar("obter_inteiro_teor", { id: "tjmg:21" })).texto);

    agora += 25 * HORA;
    j.estado.tribunaisInacessiveis = true;
    expect((await j.chamar("obter_ementa", { id: "tjmg:21" })).isError).toBe(true);
    for (const args of [{ id: "tjmg:21" }, { tribunal: "tjmg", link: LINKS.tjmg }]) {
      const r = await j.chamar("obter_inteiro_teor", args);
      expect(r.isError, r.texto).toBe(false);
      expect(JSON.parse(r.texto)).toMatchObject({ arquivo: primeiro.arquivo, texto: primeiro.texto });
    }
    expect(j.falsos.tjmg.chamadas).toHaveLength(1);
    expect(j.site).toHaveLength(1);
  });

  it("PDF alterado depois do download (sha256 diferente): não reaproveita, baixa de novo e preserva a cópia alterada", async () => {
    const j = await janela();
    j.entregar("tjmg", pdfDe("original"));
    const primeiro = JSON.parse((await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg })).texto);
    // Bytes a mais depois do fim: continua um PDF legível, mas não é mais o que o recibo registra.
    const alterado = Buffer.concat([await readFile(primeiro.arquivo), Buffer.from("\n% anotacao do usuario\n")]);
    await writeFile(primeiro.arquivo, alterado);
    const reciboOriginal = await readFile(primeiro.recibo, "utf8");

    j.entregar("tjmg", pdfDe("original"));
    const segundo = JSON.parse((await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg })).texto);
    expect(j.falsos.tjmg.chamadas).toHaveLength(1);
    expect(segundo.jaEstavaNaPasta).toBeUndefined();
    expect(segundo.arquivo).not.toBe(primeiro.arquivo);
    expect(segundo.cabecalho.origem).toMatch(/^conferida/);
    expect(await readFile(primeiro.arquivo)).toEqual(alterado);
    expect(await readFile(primeiro.recibo, "utf8")).toBe(reciboOriginal);
  });

  it("recibo de formato desconhecido: não reaproveita; baixa de novo e preserva PDF e recibo", async () => {
    const j = await janela();
    j.entregar("tjmg", pdfDe("formato"));
    const primeiro = JSON.parse((await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg })).texto);
    const desconhecido = (await readFile(primeiro.recibo, "utf8")).replace(/^Formato: .*$/m, "Formato: recibo de outra versão, 9");
    await writeFile(primeiro.recibo, desconhecido);
    const pdfOriginal = await readFile(primeiro.arquivo);

    j.entregar("tjmg", pdfDe("formato"));
    const r = await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg });
    expect(r.isError).toBe(false);
    expect(j.falsos.tjmg.chamadas).toHaveLength(1);
    expect(JSON.parse(r.texto).jaEstavaNaPasta).toBeUndefined();
    expect(await readFile(primeiro.recibo, "utf8")).toBe(desconhecido);
    expect(await readFile(primeiro.arquivo)).toEqual(pdfOriginal);
  });

  it("com os tribunais inacessíveis e só uma cópia alterada: não reaproveita e não chama ninguém (erro, cópia preservada)", async () => {
    const j = await janela();
    j.entregar("tjmg", pdfDe("parada"));
    const primeiro = JSON.parse((await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg })).texto);
    const alterado = Buffer.concat([await readFile(primeiro.arquivo), Buffer.from("\n% outra\n")]);
    await writeFile(primeiro.arquivo, alterado);
    j.estado.tribunaisInacessiveis = true;

    const r = await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/tribunais inacessíveis/);
    expect(await readFile(primeiro.arquivo)).toEqual(alterado);
  });

  it("duas versões válidas do mesmo acórdão: usa a de download mais recente pelo recibo (não pelo nome), diz a data e preserva a outra", async () => {
    const j = await janela({ tjmg: [registro("31", LINKS.tjmg)] });
    await j.chamar("busca_direta", { tribunal: "tjmg", texto: "responsabilidade civil" });
    vi.useFakeTimers({ toFake: ["Date"] });

    // A 1ª gravada (nome sem número) é a mais recente pelo recibo; a "-2" é de antes.
    vi.setSystemTime(new Date("2026-05-10T12:00:00Z"));
    j.entregar("tjmg", pdfDe("versao nova"));
    const nova = JSON.parse((await j.chamar("obter_inteiro_teor", { id: "tjmg:31" })).texto);
    // Esconde o PDF (o recibo fica): o próximo download ganha outro nome; depois o PDF volta ao lugar.
    const escondido = join(pasta, "escondido.bin");
    await rename(nova.arquivo, escondido);
    vi.setSystemTime(new Date("2026-04-10T12:00:00Z"));
    j.entregar("tjmg", pdfDe("versao antiga"));
    const antiga = JSON.parse((await j.chamar("obter_inteiro_teor", { id: "tjmg:31" })).texto);
    await rename(escondido, nova.arquivo);
    expect(antiga.arquivo).toBe(nova.arquivo.replace(/\.pdf$/, "-2.pdf"));

    const r = JSON.parse((await j.chamar("obter_inteiro_teor", { id: "tjmg:31" })).texto);
    expect(j.falsos.tjmg.chamadas).toHaveLength(1);
    const baixadoEm = (await camposDoRecibo(nova.recibo))["Data e hora"];
    expect(r).toMatchObject({ arquivo: nova.arquivo, sha256: nova.sha256 });
    expect(r.jaEstavaNaPasta).toContain(`baixado pelo Garimpo em ${baixadoEm}, com o mesmo sha256`);
    expect(r.jaEstavaNaPasta).toMatch(/ Há outra versão válida deste acórdão na pasta de destino, preservada\.$/);
    expect((await readdir(pasta)).sort()).toEqual(
      [nova.arquivo, nova.recibo, antiga.arquivo, antiga.recibo].map((c) => basename(c)).sort(),
    );
  });

  it("número do processo sozinho nunca casa: outro acórdão com o mesmo número e outro link é baixado", async () => {
    const outroLink = LINKS.tjmg.replace("numero=1", "numero=2");
    const numero = "1.0000.00.000009-0/001";
    const j = await janela({ tjmg: [registro("41", LINKS.tjmg, numero), registro("42", outroLink, numero)] });
    await j.chamar("busca_direta", { tribunal: "tjmg", texto: "responsabilidade civil" });
    j.entregar("tjmg", pdfDe("primeiro"));
    await j.chamar("obter_inteiro_teor", { id: "tjmg:41" });

    j.entregar("tjmg", pdfDe("segundo"));
    const r = JSON.parse((await j.chamar("obter_inteiro_teor", { id: "tjmg:42" })).texto);
    expect(j.falsos.tjmg.chamadas.map((c) => c.url)).toEqual([outroLink]);
    expect(r.jaEstavaNaPasta).toBeUndefined();
  });

  it("pelo link, nada de palpite: o recibo que diz outro acórdão não serve ao pedido com id, e recibos de acórdãos diferentes no mesmo link não servem ao pedido sem id", async () => {
    const j = await janela({ tjmg: [registro("51", LINKS.tjmg), registro("52", LINKS.tjmg)] });
    await j.chamar("busca_direta", { tribunal: "tjmg", texto: "responsabilidade civil" });
    j.entregar("tjmg", pdfDe("cinquenta e um"));
    await j.chamar("obter_inteiro_teor", { id: "tjmg:51" });

    // Sem id, o link só tem o recibo do 51: inequívoco, reaproveita.
    const semId = JSON.parse((await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg })).texto);
    expect(semId.jaEstavaNaPasta).toMatch(/^O PDF já estava na pasta de destino/);
    expect(j.falsos.tjmg.chamadas).toHaveLength(1);

    // O 52 tem o mesmo link, mas o recibo diz que o PDF é o 51: baixa o do 52.
    j.entregar("tjmg", pdfDe("cinquenta e dois"));
    const r52 = JSON.parse((await j.chamar("obter_inteiro_teor", { id: "tjmg:52" })).texto);
    expect(r52.jaEstavaNaPasta).toBeUndefined();
    expect(j.falsos.tjmg.chamadas).toHaveLength(1);

    // Agora o link tem recibos do 51 e do 52: sem id, é ambíguo, e baixa.
    j.entregar("tjmg", pdfDe("sem id"));
    const r = JSON.parse((await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg })).texto);
    expect(r.jaEstavaNaPasta).toBeUndefined();
    expect(j.falsos.tjmg.chamadas).toHaveLength(1);
    expect((await readdir(pasta)).filter((f) => f.endsWith(".pdf"))).toHaveLength(3);
  });

  it("recibos fora da pasta de destino são ignorados: noutra pasta, baixa de novo", async () => {
    const j = await janela();
    j.entregar("tjmg", pdfDe("pasta"));
    await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg });
    const outra = join(pasta, "subpasta");

    j.entregar("tjmg", pdfDe("pasta"));
    const r = JSON.parse((await j.chamar("obter_inteiro_teor", { tribunal: "tjmg", link: LINKS.tjmg, pasta: outra })).texto);
    expect(j.falsos.tjmg.chamadas).toHaveLength(1);
    expect(r.jaEstavaNaPasta).toBeUndefined();
    expect(basename(join(r.arquivo, ".."))).toBe("subpasta");
  });
});
