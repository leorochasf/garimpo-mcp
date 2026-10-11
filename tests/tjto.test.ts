import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { Cliente, RecusaError, UA_NAVEGADOR } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { lerTextoIntegral } from "../src/leitura.js";
import { Memoria } from "../src/memoria.js";
import { criarServidor } from "../src/servidor.js";
import { clienteFalso, respostaJson } from "./apoio.js";

const TJTO = "https://jurisprudencia.tjto.jus.br/viewFileDoc.php?uuid=0123456789abcdef0123456789abcdef";

describe("cliente — identificação por fonte (TJTO, ADR-0021)", () => {
  it("ao portal do TJTO vai o UA de navegador fixo, que ele exige", async () => {
    const { cliente, chamadas } = clienteFalso([respostaJson({})]);
    await (await cliente.requisitar(TJTO)).text();
    expect(new Headers(chamadas[0].init.headers).get("User-Agent")).toBe(UA_NAVEGADOR);
  });
});

const UUID = "0123456789abcdef0123456789abcdef";
const VIEW = `https://jurisprudencia.tjto.jus.br/viewFileDoc.php?uuid=${UUID}&options=%23page%3D1`;
const DOCUMENTO = `https://jurisprudencia.tjto.jus.br/documento.php?uuid=${UUID}`;
/** Esqueleto sintético do documento do eproc que o portal devolve (prova de 2026-10-11), em ISO-8859-1. */
const HTML_TJTO = readFileSync(new URL("./fixtures/tjto-documento.html", import.meta.url));
const documento = () =>
  new Response(HTML_TJTO, { headers: { "content-type": "text/html; charset=ISO-8859-1" } });
/** O portal responde 302 com o Location escapado como HTML (&amp;), como na prova. */
const redireciona = () =>
  new Response("", {
    status: 302,
    headers: { location: `documento.php?uuid=${UUID}&amp;options=%23page%3D1`, "content-type": "text/html; charset=UTF-8" },
  });

function memoriaComAcordao(link = VIEW) {
  const memoria = new Memoria();
  const acordao: Acordao = { id: "tjto:777", tribunal: "tjto", numero: "0000000-00.2024.8.27.0000", semNumero: false, ementa: "EMENTA FICTÍCIA.", link };
  memoria.lembrar([{ ids: [acordao.id], registro: acordao }]);
  return memoria;
}

describe("inteiro teor — TJTO entrega o texto do portal do tribunal", () => {
  it("segue o redirecionamento ao documento, guarda o texto na memória e ensina a ler pelo id; nada é salvo como PDF", async () => {
    const memoria = memoriaComAcordao();
    const { cliente, chamadas } = clienteFalso([redireciona(), documento()]);
    const r = await obterInteiroTeor({ id: "tjto:777" }, () => cliente, memoria);

    expect(chamadas.map((c) => c.url)).toEqual([VIEW, DOCUMENTO]);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.link).toBe(VIEW);
    expect(r.explicacao).toMatch(/texto do portal do tribunal/);
    expect(r.explicacao).toMatch(/ler_inteiro_teor com o id tjto:777/);
    expect(r.explicacao).not.toMatch(/inteiro teor oficial/);
    const guardado = await memoria.obterTexto("tjto:777");
    expect(guardado?.texto).toMatch(/EXEMPLO FICTÍCIO DE EMENTA DO TJTO PARA TESTE/);
    expect(guardado?.texto).toMatch(/RELATÓRIO\n[\s\S]*VOTO\n[\s\S]*EXTRATO DE ATA/);
    expect(guardado?.texto).not.toMatch(/<|@media/);
  });
});

describe("ler_inteiro_teor — texto do portal do TJTO pelo id", () => {
  it("lê da memória com o rótulo do portal do TJTO, nunca como Falcão nem como PDF", async () => {
    const memoria = memoriaComAcordao();
    const { cliente } = clienteFalso([redireciona(), documento()]);
    await obterInteiroTeor({ id: "tjto:777" }, () => cliente, memoria);

    const p = await lerTextoIntegral("tjto:777", 1, memoria);
    expect(p.cabecalho.tribunal).toBe("TJTO");
    expect(p.cabecalho.numero).toBe("0000000-00.2024.8.27.0000");
    expect(p.cabecalho.fonte).toMatch(/portal de jurisprudência do TJTO/);
    expect(p.cabecalho.natureza).toMatch(/^texto do portal do tribunal/);
    expect(JSON.stringify(p.cabecalho)).not.toMatch(/Falcão/);
    expect(p.texto).toMatch(/EXEMPLO FICTÍCIO DE EMENTA DO TJTO/);
  });

  it("fora da memória: ensina a chamar o obter_inteiro_teor de novo (o portal tem o documento pelo link)", async () => {
    await expect(lerTextoIntegral("tjto:777", 1, new Memoria())).rejects.toThrow(/obter_inteiro_teor/);
  });

  it("já na memória: o obter_inteiro_teor não chama o portal de novo", async () => {
    const memoria = memoriaComAcordao();
    await obterInteiroTeor({ id: "tjto:777" }, () => clienteFalso([redireciona(), documento()]).cliente, memoria);
    const { cliente, chamadas } = clienteFalso([]);
    const r = await obterInteiroTeor({ id: "tjto:777" }, () => cliente, memoria);
    expect(chamadas).toHaveLength(0);
    expect(r).toMatchObject({ baixado: false, link: VIEW });
  });
});

describe("servidor — TJTO de ponta a ponta (busca, obter, ler, conferir)", () => {
  async function montar() {
    const site = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async () =>
        respostaJson({
          results: [{ id: 777, texto_ementa: "EMENTA FICTÍCIA DO TJTO.", link_pdf: VIEW, numero_processo: "0000000-00.2024.8.27.0000" }],
        })) as typeof fetch,
    });
    const tjto = clienteFalso([redireciona(), documento()]);
    const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    await criarServidor(site, { dados, tribunais: () => tjto.cliente }).connect(ladoServidor);
    const mcp = new Client({ name: "teste", version: "0" });
    await mcp.connect(ladoCliente);
    const chamar = async (name: string, args: Record<string, unknown>) => {
      const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { isError: r.isError, texto: r.content[0].text };
    };
    await chamar("busca_direta", { tribunal: "tjto", texto: "exemplo" });
    return { chamar, tjto };
  }

  it("ler_inteiro_teor e conferir_citacao usam o texto do portal pelo id", async () => {
    const { chamar, tjto } = await montar();
    const obtido = await chamar("obter_inteiro_teor", { id: "tjto:777" });
    expect(obtido.isError).toBeFalsy();
    expect(tjto.chamadas).toHaveLength(2);

    const lido = await chamar("ler_inteiro_teor", { id: "tjto:777" });
    expect(lido.isError).toBeFalsy();
    expect(lido.texto).toMatch(/texto do portal do tribunal/);
    expect(lido.texto).toMatch(/EXEMPLO FICTÍCIO DE EMENTA DO TJTO/);

    const conferido = await chamar("conferir_citacao", {
      citacoes: [{ id: "tjto:777", citacao: "O dano moral decorrente de protesto indevido é presumido" }],
    });
    expect(conferido.isError).toBeFalsy();
    const fontes = JSON.parse(conferido.texto).resultados[0].fontes as { fonte: string; veredito: string; origem?: string }[];
    const doTexto = fontes.find((f) => f.fonte === "texto integral");
    expect(doTexto?.veredito).toBe("encontrado literalmente");
    expect(doTexto?.origem).toMatch(/^texto do portal do tribunal/);
  });
});

describe("achados da revisão Codex (TJTO)", () => {
  const pagina = (corpo: Uint8Array | string, tipo = "text/html; charset=ISO-8859-1") => () =>
    new Response(corpo, { headers: { "content-type": tipo } });
  const fixtureTjto = (nome: string) => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url));

  it("página de erro com HTTP 200 (documento não encontrado): nada vai para a memória; devolve o link com explicação honesta", async () => {
    const memoria = memoriaComAcordao();
    const { cliente } = clienteFalso([redireciona(), pagina(fixtureTjto("tjto-nao-encontrado.html"))]);
    const r = await obterInteiroTeor({ id: "tjto:777" }, () => cliente, memoria);

    expect(r).toMatchObject({ baixado: false, link: VIEW });
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/não é a página do acórdão/);
    expect(r.explicacao).not.toMatch(/converteu em texto/);
    expect(await memoria.obterTexto("tjto:777")).toBeUndefined();
  });

  it("página com a estrutura do documento mas quase sem texto: não entrega", async () => {
    const memoria = memoriaComAcordao();
    const vazia =
      '<html><head><title>Documento:1</title></head><body><section data-nome="identificacao_processo"><p>X</p></section>' +
      '<section data-nome="ementa"><p>EMENTA.</p></section></body></html>';
    const { cliente } = clienteFalso([redireciona(), pagina(vazia)]);
    const r = await obterInteiroTeor({ id: "tjto:777" }, () => cliente, memoria);
    expect(r).toMatchObject({ baixado: false, link: VIEW });
    expect(await memoria.obterTexto("tjto:777")).toBeUndefined();
  });

  it("página de desafio com HTTP 200 (marca só no corpo): recusa pelos freios, e o disjuntor do TJTO fica aberto", async () => {
    const memoria = memoriaComAcordao();
    const { cliente, chamadas } = clienteFalso([redireciona(), pagina(fixtureTjto("tjto-desafio.html")), documento()], {
      nome: "O portal do TJTO",
    });
    const e = await obterInteiroTeor({ id: "tjto:777" }, () => cliente, memoria).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/página de verificação anti-robô \(HTTP 200\)/);
    expect(await memoria.obterTexto("tjto:777")).toBeUndefined();
    const depois = await cliente.requisitar(DOCUMENTO).catch((x) => x);
    expect(depois).toBeInstanceOf(RecusaError);
    expect(depois.message).toMatch(/não foi feita/);
    expect(chamadas).toHaveLength(2);
  });

  it("charset ausente no cabeçalho: lê o do <meta>, com os acentos certos", async () => {
    const memoria = memoriaComAcordao();
    const { cliente } = clienteFalso([redireciona(), pagina(HTML_TJTO, "text/html")]);
    await obterInteiroTeor({ id: "tjto:777" }, () => cliente, memoria);
    expect((await memoria.obterTexto("tjto:777"))?.texto).toMatch(/ACÓRDÃO[\s\S]*EXEMPLO FICTÍCIO/);
  });

  it("charset ausente no cabeçalho e no HTML: ISO-8859-1, o que o portal usa", async () => {
    const memoria = memoriaComAcordao();
    const semMeta = Buffer.from(HTML_TJTO.toString("latin1").replace(/<meta charset="ISO-8859-1"\/>/g, ""), "latin1");
    const { cliente } = clienteFalso([redireciona(), pagina(semMeta, "text/html")]);
    await obterInteiroTeor({ id: "tjto:777" }, () => cliente, memoria);
    expect((await memoria.obterTexto("tjto:777"))?.texto).toMatch(/ACÓRDÃO[\s\S]*EXEMPLO FICTÍCIO/);
  });
});
