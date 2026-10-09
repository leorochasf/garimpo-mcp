import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cliente } from "../src/cliente.js";
import { CoordenacaoEmArquivo } from "../src/coordenacao.js";
import { criarServidor, type OpcoesServidor } from "../src/servidor.js";
import { clienteFalso, respostaJson } from "./apoio.js";
import { pdfSintetico } from "./pdfSintetico.js";

/**
 * A memória de acórdãos pela porta do servidor montado: cada montagem é uma janela do Garimpo; duas montagens com a
 * mesma pasta de dados (temporária, nunca a do usuário) dividem a memória. Relógio falso, site falso, sem rede.
 */

const HORA = 3_600_000;
/** 08/10/2026 17:03 UTC = 14:03 em Brasília (UTC-03:00, sem horário de verão). */
const OBTENCAO = Date.UTC(2026, 9, 8, 17, 3);

let dados: string;
let agora: number;
const relogio = () => agora;

beforeEach(async () => {
  dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-memoria-"));
  agora = OBTENCAO;
  vi.stubEnv("TZ", "America/Sao_Paulo");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  // A gravação da memória corre por trás das respostas: pode estar terminando agora.
  await rm(dados, { recursive: true, force: true, maxRetries: 10 });
});

/**
 * Site falso que conta as chamadas e responde a cada busca com os registros seguintes da lista, no formato do site
 * (a última resposta se repete).
 */
function siteFalso(...respostas: unknown[][]) {
  const chamadas: string[] = [];
  const cliente = new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string) => {
      chamadas.push(url);
      return respostaJson({ results: respostas.length > 1 ? respostas.shift() : respostas[0] });
    }) as typeof fetch,
  });
  return { cliente, chamadas };
}

async function janela(site: Cliente, opcoes: OpcoesServidor = {}) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(site, { dados, agora: relogio, ...opcoes }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

/** Todos os arquivos debaixo de uma pasta, com o caminho relativo a ela. */
async function arquivos(pasta: string): Promise<string[]> {
  const itens = await readdir(pasta, { recursive: true, withFileTypes: true });
  return itens.filter((i) => i.isFile()).map((i) => join(i.parentPath, i.name).slice(pasta.length + 1)).sort();
}

/** O que não é memória de acórdãos desta versão: proteção, PDF e recibo, e memória de outra versão. */
async function semearAlheios() {
  const alheios: Record<string, string> = {
    [join("protecao", "estado.json")]: "estado da proteção",
    [join("protecao", "vaga-1")]: "vaga",
    [join("memoria", "acordao.pdf")]: "%PDF-1.4 ficticio",
    [join("memoria", "acordao.recibo.txt")]: "recibo ficticio",
    [join("memoria", "acordaos-2", "registro-de-outra-versao.json")]: '{"formato":"outro"}',
  };
  for (const [nome, conteudo] of Object.entries(alheios)) {
    await mkdir(join(dados, nome, ".."), { recursive: true });
    await writeFile(join(dados, nome), conteudo);
  }
  return alheios;
}

async function conferirAlheios(alheios: Record<string, string>) {
  for (const [nome, conteudo] of Object.entries(alheios)) expect(await readFile(join(dados, nome), "utf8"), nome).toBe(conteudo);
}

/** A limpeza roda por trás das respostas: espera, com prazo, até a pasta chegar ao estado esperado. */
async function esperarAte(condicao: () => Promise<boolean>) {
  const prazo = Date.now() + 5_000;
  while (!(await condicao())) {
    if (Date.now() > prazo) throw new Error("a limpeza da memória não terminou no prazo");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Os acórdãos guardados em disco por esta versão (a gravação corre por trás das respostas). */
async function guardadosNoDisco(): Promise<string[]> {
  return (await arquivos(dados)).filter((f) => f.startsWith(join("memoria", "acordaos-1")) && f.endsWith(".json"));
}

async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { isError: Boolean(r.isError), texto: r.content[0].text };
}

const acordao = (id: string, ementa = `EMENTA FICTÍCIA ${id}. Responsabilidade civil do Estado por omissão.`) => ({
  id,
  texto_ementa: ementa,
  numero_processo: `1.000.${id}/UF`,
  orgao_julgador: "Turma Exemplo",
  data_julgamento: "2024-01-02T00:00:00.000Z",
  link_pdf: `https://exemplo.test/${id}.pdf`,
});

describe("memória de acórdãos entre janelas", () => {
  it("o acórdão buscado numa janela é lido por outra com a mesma pasta de dados, com a data de obtenção, sem chamar o site", async () => {
    const siteA = siteFalso([acordao("m1")]);
    const a = await janela(siteA.cliente);
    expect((await chamar(a, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil" })).isError).toBe(false);
    await esperarAte(async () => (await guardadosNoDisco()).length === 1);

    agora += 23 * HORA;
    const siteB = siteFalso();
    const b = await janela(siteB.cliente);
    const r = await chamar(b, "obter_ementa", { id: "stj:m1" });

    expect(r.isError).toBe(false);
    const ementa = JSON.parse(r.texto);
    expect(ementa.ementa).toMatch(/EMENTA FICTÍCIA m1/);
    expect(ementa.obtidoDoSite).toBe("obtido do site em 08/10/2026 14:03 (hora local, UTC-03:00)");
    expect(siteB.chamadas).toHaveLength(0);
  });

  it("depois de 24 h da obtenção, nesta janela e na outra: o erro que ensina a refazer a busca, sem chamar o site", async () => {
    const site = siteFalso([acordao("m2")]);
    const a = await janela(site.cliente);
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil" });
    await esperarAte(async () => (await guardadosNoDisco()).length === 1);
    const b = await janela(siteFalso().cliente);

    agora += 24 * HORA - 1;
    expect((await chamar(b, "obter_ementa", { id: "stj:m2" })).isError).toBe(false);
    agora += 1;
    const vencidoNaOutra = await chamar(b, "obter_ementa", { id: "stj:m2" });
    const vencidoNaMesma = await chamar(a, "obter_ementa", { id: "stj:m2" });

    for (const r of [vencidoNaOutra, vencidoNaMesma]) {
      expect(r.isError).toBe(true);
      expect(r.texto).toBe(
        "O acórdão stj:m2 não está na memória do Garimpo, que guarda os acórdãos por 24 h desde a busca. " +
          "Refaça a busca que o trouxe.",
      );
    }
    expect(site.chamadas).toHaveLength(1);
  });

  it("obter_inteiro_teor pelo id noutra janela baixa do tribunal usando o link guardado", async () => {
    const LINK_TJMG = "https://www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&numero=7";
    const a = await janela(siteFalso([{ ...acordao("m3"), link_pdf: LINK_TJMG }]).cliente);
    await chamar(a, "busca_direta", { tribunal: "tjmg", texto: "responsabilidade civil" });
    await esperarAte(async () => (await guardadosNoDisco()).length === 1);

    const pdf = Buffer.from(pdfSintetico([["Inteiro teor ficticio de exemplo."]]));
    const tjmg = clienteFalso([new Response(pdf, { headers: { "content-type": "application/pdf" } })]);
    const pasta = join(dados, "pdfs");
    const b = await janela(siteFalso().cliente, { tribunais: () => tjmg.cliente, pasta });
    const r = await chamar(b, "obter_inteiro_teor", { id: "tjmg:m3", texto: false });

    expect(r.isError).toBe(false);
    expect(JSON.parse(r.texto)).toMatchObject({ baixado: true, fonte: LINK_TJMG });
    expect(tjmg.chamadas.map((c) => c.url)).toEqual([LINK_TJMG]);
  });

  it("ao iniciar, apaga os vencidos e preserva o formato desconhecido, a proteção, PDFs, recibos e a memória de outra versão", async () => {
    const alheios = await semearAlheios();
    const a = await janela(siteFalso([acordao("m4")], [acordao("m5")]).cliente);
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil" });
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão do Estado" });
    await esperarAte(async () => (await guardadosNoDisco()).length === 2);
    // Um dos acórdãos guardados passa a ter um formato que esta versão não entende: é ignorado, nunca apagado.
    const [estranho] = await guardadosNoDisco();
    await writeFile(join(dados, estranho), '{"formato":"garimpo-memoria-acordao","versao":99}');

    agora += 25 * HORA;
    const b = await janela(siteFalso().cliente);
    await esperarAte(async () => (await guardadosNoDisco()).length === 1);

    expect(await guardadosNoDisco()).toEqual([estranho]);
    expect((await chamar(b, "obter_ementa", { id: "stj:m4" })).isError).toBe(true);
    expect((await chamar(b, "obter_ementa", { id: "stj:m5" })).isError).toBe(true);
    expect(await readFile(join(dados, estranho), "utf8")).toBe('{"formato":"garimpo-memoria-acordao","versao":99}');
    await conferirAlheios(alheios);
  });

  it("acima do teto de espaço, apaga o mais antigo primeiro, sem tocar proteção, PDFs nem recibos", async () => {
    const alheios = await semearAlheios();
    const a = await janela(siteFalso([acordao("m6")]).cliente);
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil" });
    const buscasNoDisco = async () => (await arquivos(dados)).filter((f) => f.startsWith(join("memoria", "buscas-1")));
    await esperarAte(async () => (await guardadosNoDisco()).length === 1 && (await buscasNoDisco()).length === 1);
    const [primeiro] = await guardadosNoDisco();
    const [busca] = await buscasNoDisco();
    // O teto vale para a memória inteira: cada busca direta ocupa o acórdão e a busca guardada.
    const tamanho = (await stat(join(dados, primeiro))).size + (await stat(join(dados, busca))).size;

    // Cabem duas buscas com o acórdão de cada uma; a terceira estoura o teto.
    const site = siteFalso([acordao("m7")], [acordao("m8")]);
    const b = await janela(site.cliente, { tetoDaMemoria: Math.floor(2.5 * tamanho) });
    agora += HORA;
    await chamar(b, "busca_direta", { tribunal: "stj", texto: "omissão do Estado" });
    agora += HORA;
    await chamar(b, "busca_direta", { tribunal: "stj", texto: "dever de indenizar" });

    const c = await janela(siteFalso().cliente);
    const ementa = async (id: string) => !(await chamar(c, "obter_ementa", { id })).isError;
    await esperarAte(async () => !(await ementa("stj:m6")) && (await ementa("stj:m8")));
    expect(await guardadosNoDisco()).toHaveLength(2);
    expect((await chamar(c, "obter_ementa", { id: "stj:m7" })).isError).toBe(false);
    expect((await chamar(c, "obter_ementa", { id: "stj:m8" })).isError).toBe(false);
    await conferirAlheios(alheios);
  });

  it("GARIMPO_SEM_MEMORIA=1: a janela guarda só enquanto está aberta, nada gravado na memória, e as chamadas seguem pelo freio compartilhado", async () => {
    vi.stubEnv("GARIMPO_SEM_MEMORIA", "1");
    const site = new Cliente({
      nome: "O site",
      esperar: async () => {},
      vagas: new CoordenacaoEmArquivo({ pasta: dados }),
      fetch: (async () => respostaJson({ results: [acordao("m9")] })) as typeof fetch,
    });
    const a = await janela(site);
    expect((await chamar(a, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil" })).isError).toBe(false);
    const b = await janela(siteFalso().cliente);

    const naMesma = await chamar(a, "obter_ementa", { id: "stj:m9" });
    expect(naMesma.isError).toBe(false);
    expect(JSON.parse(naMesma.texto).obtidoDoSite).toBe("obtido do site em 08/10/2026 14:03 (hora local, UTC-03:00)");
    expect((await chamar(b, "obter_ementa", { id: "stj:m9" })).isError).toBe(true);
    const gravados = await arquivos(dados);
    expect(gravados.some((f) => f.startsWith("memoria"))).toBe(false);
    expect(gravados.some((f) => f.startsWith("protecao"))).toBe(true);
  });

  it("o texto da busca não fica gravado na memória", async () => {
    const a = await janela(siteFalso([acordao("m10")]).cliente);
    await chamar(a, "busca_ampla", { formulacoes: ["teoria-do-orgao-ficticia"], tribunais: ["stj"] });
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "nexo-causal-ficticio" });

    await esperarAte(async () => (await guardadosNoDisco()).length === 1);
    for (const f of await guardadosNoDisco()) {
      const conteudo = await readFile(join(dados, f), "utf8");
      expect(conteudo).not.toMatch(/teoria-do-orgao-ficticia|nexo-causal-ficticio/);
    }
  });
});
