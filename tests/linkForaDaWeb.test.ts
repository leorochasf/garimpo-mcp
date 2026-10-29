import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { Memoria } from "../src/memoria.js";
import { criarServidor } from "../src/servidor.js";
import { respostaJson } from "./apoio.js";

// Ticket 01 da frente dos TJs: só endereço web do tribunal vira link. O site manda, no lugar do link, um `data:` com o
// HTML do acórdão (TJES, TJMA) ou um `gs://` de armazenamento em nuvem (TJPB); nenhum dos dois abre como página.

/** Um `data:` como o do TJES: HTML fictício do acórdão, em base64, com dezenas de KB. */
function dataComAcordao(n: number): string {
  const html = `<html><body><p>ACÓRDÃO FICTÍCIO ${n}.</p>${"<p>Texto fictício de relatório e voto para teste.</p>".repeat(1500)}</body></html>`;
  return `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
}

function registro(n: number, link: string) {
  return {
    id: 900 + n,
    texto_ementa: `EMENTA FICTÍCIA ${n}. APELAÇÃO CÍVEL. DANO MORAL. EXEMPLO PARA TESTE.`,
    link_pdf: link,
    data_julgamento: "2026-10-28T00:00:00.000Z",
    classe_processual: "Apelação Cível",
    numero_processo: `000000${n}-11.2025.8.08.0001`,
    numero_processo_cnj: `000000${n}-11.2025.8.08.0001`,
    relator: "DESEMBARGADOR EXEMPLO",
    orgao_julgador: "1ª Câmara Cível",
    score: 10 - n,
  };
}

/**
 * Site falso: responde a toda busca com estes registros no formato do site; a rota de link, com `linkDaRota`, se
 * houver. Anota cada endereço pedido.
 */
function siteFalso(registros: unknown[], linkDaRota?: string) {
  const pedidos: string[] = [];
  const cliente = new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string) => {
      pedidos.push(String(url));
      if (String(url).includes("/api/jurisprudencia-link")) return respostaJson(linkDaRota ? { link: linkDaRota } : {});
      return respostaJson({ results: registros });
    }) as typeof fetch,
  });
  return { cliente, pedidos };
}

const rota = (pedidos: string[]) => pedidos.filter((p) => p.includes("/api/jurisprudencia-link"));

async function conectar(site: Cliente, dados?: string) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  dados ??= await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
  await criarServidor(site, { dados }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

/**
 * Memória gravada antes desta regra: um acórdão com o valor cru no link ou no link de consulta, gravado por outra janela
 * na pasta de dados (como fazia a versão anterior). Espera o disco antes de devolver a pasta.
 */
async function memoriaAntiga(sobre: Partial<Acordao>): Promise<string> {
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-antiga-"));
  const acordao = {
    id: "tjpb:1",
    tribunal: "tjpb",
    numero: "0000001-11.2025.8.15.0001",
    numeroCnj: "0000001-11.2025.8.15.0001",
    semNumero: false,
    ementa: "EMENTA FICTÍCIA. APELAÇÃO CÍVEL.",
    ...sobre,
  } as Acordao;
  new Memoria({ dados }).lembrar([{ ids: [acordao.id], registro: acordao }]);
  const prazo = Date.now() + 10_000;
  while (!(await new Memoria({ dados }).obter(acordao.id))) {
    if (Date.now() > prazo) throw new Error("a gravação da memória não terminou no prazo");
    await new Promise((r) => setTimeout(r, 20));
  }
  return dados;
}

async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  expect(r.isError, r.content[0].text).toBeFalsy();
  return r.content[0].text;
}

describe("só endereço web do tribunal vira link", () => {
  it("busca do TJES com 3 links data: responde com menos de 1/20 do tamanho e sem o data:", async () => {
    const links = [1, 2, 3].map(dataComAcordao);
    const { cliente } = siteFalso(links.map((l, i) => registro(i + 1, l)));
    const texto = await chamar(await conectar(cliente), "busca_direta", { tribunal: "tjes", texto: "dano moral", limite: 3 });

    const tamanhoDosLinks = links.reduce((n, l) => n + l.length, 0);
    expect(texto.length).toBeLessThan(tamanhoDosLinks / 20);
    // A frase do aviso nomeia o tipo («data:»); o que não pode sair é o link em si, com o HTML em base64.
    expect(texto).not.toMatch(/data:text\/html|base64/);
    expect(JSON.parse(texto).acordaos[0].avisoDeLink).toBe(
      "O JurisprudênciaIA mandou, no lugar do link, um endereço que não é página do tribunal (endereço do tipo data:); o Garimpo não o mostra.",
    );
    expect(JSON.parse(texto).acordaos).toHaveLength(3);
  });

  it("obter_inteiro_teor do TJPB com gs:// não devolve o gs:// nem manda abrir no navegador, e diz o motivo", async () => {
    const gs = "gs://pdfs-jurisprudencias/tjpb/2026/03/00000011120258150001_20260304_1.pdf";
    const { cliente, pedidos } = siteFalso([{ ...registro(1, gs), numero_processo_cnj: "0000001-11.2025.8.15.0001" }]);
    const mcp = await conectar(cliente);
    const busca = JSON.parse(await chamar(mcp, "busca_direta", { tribunal: "tjpb", texto: "dano moral", limite: 3 }));
    expect(JSON.stringify(busca)).not.toMatch(/gs:\/\//);

    const r = JSON.parse(await chamar(mcp, "obter_inteiro_teor", { id: busca.acordaos[0].id }));
    expect(r.baixado).toBe(false);
    expect(r.link).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/gs:\/\//);
    expect(r.explicacao).not.toMatch(/abr[ae] o link no navegador/i);
    expect(r.explicacao).toMatch(/no lugar do link, um endereço que não é página do tribunal \(endereço do tipo gs:\); o Garimpo não o mostra\./);
    // Sem link web, o caminho «sem link» de hoje: a rota de link do site, uma vez, e depois o número no portal.
    expect(pedidos.filter((p) => p.includes("/api/jurisprudencia-link"))).toHaveLength(1);
  });

  it("obter_inteiro_teor com tribunal + link gs:// informado: não devolve o gs:// e diz o motivo", async () => {
    const gs = "gs://pdfs-jurisprudencias/tjpb/2026/03/00000011120258150001_20260304_1.pdf";
    const { cliente } = siteFalso([]);
    const r = JSON.parse(await chamar(await conectar(cliente), "obter_inteiro_teor", { tribunal: "tjpb", link: gs }));
    expect(r.baixado).toBe(false);
    expect(r.link).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/gs:\/\//);
    expect(r.explicacao).not.toMatch(/abr[ae] o link no navegador/i);
    expect(r.explicacao).toMatch(/não é página do tribunal \(endereço do tipo gs:\)/);
  });

  it("no tribunal que baixa PDF, sem link web: o aviso e «Não há de onde baixar.»", async () => {
    const { cliente } = siteFalso([]);
    const r = JSON.parse(
      await chamar(await conectar(cliente), "obter_inteiro_teor", { tribunal: "tjmg", link: "gs://balde/acordao.pdf" }),
    );
    expect(r.baixado).toBe(false);
    expect(r.explicacao).toMatch(
      /^O JurisprudênciaIA mandou, no lugar do link, um endereço que não é página do tribunal \(endereço do tipo gs:\); o Garimpo não o mostra\. Não há de onde baixar\. /,
    );
  });

  it("link https fora da Justiça na busca: só o domínio vai no aviso", async () => {
    const { cliente } = siteFalso([registro(1, "https://cdn.exemplo.com/caminho/longo/acordao.pdf")]);
    const busca = JSON.parse(
      await chamar(await conectar(cliente), "busca_direta", { tribunal: "tjpb", texto: "dano moral", limite: 3 }),
    );
    expect(busca.acordaos[0].link).toBeUndefined();
    expect(busca.acordaos[0].avisoDeLink).toMatch(/\(endereço em cdn\.exemplo\.com\); o Garimpo não o mostra\.$/);
  });

  it("link https de host do tribunal continua como hoje: sai na busca e no obter_inteiro_teor, sem aviso", async () => {
    const link = "https://www.tjpb.jus.br/acordao/1";
    const { cliente } = siteFalso([registro(1, link)]);
    const mcp = await conectar(cliente);
    const busca = JSON.parse(await chamar(mcp, "busca_direta", { tribunal: "tjpb", texto: "dano moral", limite: 3 }));
    expect(busca.acordaos[0].link).toBe(link);
    expect(busca.acordaos[0].avisoDeLink).toBeUndefined();
    const r = JSON.parse(await chamar(mcp, "obter_inteiro_teor", { id: busca.acordaos[0].id }));
    expect(r.link).toBe(link);
  });
});

// Revisão do 01 (B01-R01, B01-R02): a memória gravada antes da regra também não pode vazar o valor cru nem travar a rota.
describe("só endereço web vira link: memória de antes da regra", () => {
  const OFICIAL = "https://www.tjpb.jus.br/documento/1";

  it("B01-R01: linkConsulta data: na memória antiga não sai como link; vai o aviso e o caminho sem link", async () => {
    const dados = await memoriaAntiga({ linkConsulta: "data:text/html;base64,VEVTVEU=" });
    const { cliente, pedidos } = siteFalso([]);
    const r = JSON.parse(await chamar(await conectar(cliente, dados), "obter_inteiro_teor", { id: "tjpb:1" }));
    expect(JSON.stringify(r)).not.toMatch(/data:text|base64/);
    expect(r.link).toBeUndefined();
    expect(r.explicacao).toMatch(/não é página do tribunal \(endereço do tipo data:\)/);
    expect(r.explicacao).not.toMatch(/abr[ae] o link no navegador/i);
    expect(rota(pedidos)).toHaveLength(1);
  });

  it("B01-R02: link gs:// na memória antiga não trava a rota de link; o link oficial dela sai", async () => {
    const dados = await memoriaAntiga({ link: "gs://balde/documento.pdf" });
    const { cliente, pedidos } = siteFalso([], OFICIAL);
    const r = JSON.parse(await chamar(await conectar(cliente, dados), "obter_inteiro_teor", { id: "tjpb:1" }));
    expect(rota(pedidos)).toHaveLength(1);
    expect(r.link).toBe(OFICIAL);
    expect(r.explicacao).toMatch(/Link pedido à rota de link do JurisprudênciaIA/);
    expect(JSON.stringify(r)).not.toMatch(/gs:\/\//);
  });

  it("B01-R02: pedido com link gs:// e id guardado sem link também segue para a rota de link", async () => {
    const dados = await memoriaAntiga({});
    const { cliente, pedidos } = siteFalso([], OFICIAL);
    const r = JSON.parse(
      await chamar(await conectar(cliente, dados), "obter_inteiro_teor", { id: "tjpb:1", link: "gs://balde/documento.pdf" }),
    );
    expect(rota(pedidos)).toHaveLength(1);
    expect(r.link).toBe(OFICIAL);
    expect(JSON.stringify(r)).not.toMatch(/gs:\/\//);
  });
});
