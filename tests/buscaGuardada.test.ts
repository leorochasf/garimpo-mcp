import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cliente } from "../src/cliente.js";
import { CoordenacaoEmArquivo } from "../src/coordenacao.js";
import { criarServidor } from "../src/servidor.js";
import { respostaJson } from "./apoio.js";

/**
 * A busca guardada pela porta do servidor montado: cada montagem é uma janela do Garimpo; montagens com a mesma
 * pasta de dados (temporária, nunca a do usuário) dividem a memória. Relógio falso, site falso, sem rede.
 */

const HORA = 3_600_000;
/** 08/10/2026 17:03 UTC = 14:03 em Brasília (UTC-03:00, sem horário de verão). */
const OBTENCAO = Date.UTC(2026, 9, 8, 17, 3);
const FOTOGRAFIA_DAS_14_03 = "fotografia da busca feita no site em 08/10/2026 14:03 (hora local, UTC-03:00)";

let dados: string;
let agora: number;
const relogio = () => agora;

beforeEach(async () => {
  dados = await mkdtemp(join(tmpdir(), "garimpo-busca-guardada-"));
  agora = OBTENCAO;
  vi.stubEnv("TZ", "America/Sao_Paulo");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  // A gravação da memória corre por trás das respostas: pode estar terminando agora.
  await rm(dados, { recursive: true, force: true, maxRetries: 10 });
});

const acordao = (id: string) => ({
  id,
  texto_ementa: `EMENTA FICTÍCIA ${id}. Responsabilidade civil do Estado por omissão.`,
  numero_processo: `1.000.${id}/UF`,
  orgao_julgador: "Turma Exemplo",
  data_julgamento: "2024-01-02T00:00:00.000Z",
  link_pdf: `https://exemplo.test/${id}.pdf`,
});

/**
 * Site falso que conta as chamadas e responde a cada busca conforme o texto pedido: um acórdão próprio do texto,
 * nenhum se o texto começar com "vazia", e erro do servidor se começar com "falha".
 */
function siteFalso(extra: Partial<ConstructorParameters<typeof Cliente>[0]> = {}) {
  const chamadas: string[] = [];
  const cliente = new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (_url: string, init: RequestInit) => {
      const texto = String(JSON.parse(String(init.body)).query);
      chamadas.push(texto);
      if (texto.startsWith("falha")) return new Response("", { status: 500 });
      return respostaJson({ results: texto.startsWith("vazia") ? [] : [acordao(texto.replace(/\W+/g, "-"))] });
    }) as typeof fetch,
    ...extra,
  });
  return { cliente, chamadas };
}

async function janela(site: Cliente) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(site, { dados, agora: relogio }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { isError: Boolean(r.isError), texto: r.content[0].text };
}

/** Todos os arquivos da memória, com o caminho relativo à pasta de dados. */
async function arquivosDaMemoria(): Promise<string[]> {
  const pasta = join(dados, "memoria");
  const itens = await readdir(pasta, { recursive: true, withFileTypes: true }).catch(() => []);
  return itens.filter((i) => i.isFile()).map((i) => join(i.parentPath, i.name));
}

/** A gravação em disco corre por trás das respostas: espera, com prazo, até haver n buscas guardadas no disco. */
async function esperarBuscasNoDisco(n: number) {
  const prazo = Date.now() + 5_000;
  for (;;) {
    const buscas = (await arquivosDaMemoria()).filter((f) => f.includes(join("memoria", "buscas-1")) && f.endsWith(".json"));
    if (buscas.length >= n) return;
    if (Date.now() > prazo) throw new Error("a gravação da memória não terminou no prazo");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("busca guardada", () => {
  it("busca_direta repetida noutra janela dentro de 24 h volta da memória, sem chamada, marcada com a data da busca", async () => {
    const siteA = siteFalso();
    const a = await janela(siteA.cliente);
    const primeira = await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal" });
    expect(primeira.isError).toBe(false);
    expect(JSON.parse(primeira.texto).buscaGuardada).toBeUndefined();
    await esperarBuscasNoDisco(1);

    agora += 23 * HORA;
    const siteB = siteFalso();
    const b = await janela(siteB.cliente);
    const repetida = await chamar(b, "busca_direta", { tribunal: "stj", texto: "omissão estatal" });

    expect(repetida.isError).toBe(false);
    const r = JSON.parse(repetida.texto);
    expect(r.buscaGuardada.startsWith(FOTOGRAFIA_DAS_14_03)).toBe(true);
    expect(r.acordaos.map((x: { id: string }) => x.id)).toEqual(["stj:omiss-o-estatal"]);
    expect(r.avisoNaturezaJuridica).toBeTruthy();
    expect(siteB.chamadas).toEqual([]);
    // A ementa guardada mantém a data da obtenção no site, nunca a de hoje.
    expect(JSON.parse((await chamar(b, "obter_ementa", { id: "stj:omiss-o-estatal" })).texto).obtidoDoSite).toBe(
      "obtido do site em 08/10/2026 14:03 (hora local, UTC-03:00)",
    );
  });

  it("outro parâmetro (limite, filtro) é outra busca; depois de 24 h a busca vai ao site de novo", async () => {
    const site = siteFalso();
    const a = await janela(site.cliente);
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal" });
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal", limite: 5 });
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal", relator: "Relator Exemplo" });
    await chamar(a, "busca_direta", { tribunal: "tjgo", texto: "omissão estatal" });
    expect(site.chamadas).toHaveLength(4);

    agora += 24 * HORA;
    const r = JSON.parse((await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal" })).texto);
    expect(r.buscaGuardada).toBeUndefined();
    expect(site.chamadas).toHaveLength(5);
  });

  it("busca vazia guardada continua vazia, com a data; erro nunca é guardado", async () => {
    const site = siteFalso();
    const a = await janela(site.cliente);
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "vazia de propósito" });
    expect((await chamar(a, "busca_direta", { tribunal: "stj", texto: "falha de propósito" })).isError).toBe(true);
    agora += HORA;

    const vazia = await chamar(a, "busca_direta", { tribunal: "stj", texto: "vazia de propósito" });
    expect(vazia.isError).toBe(false);
    const r = JSON.parse(vazia.texto);
    expect(r.acordaos).toEqual([]);
    expect(r.buscaGuardada.startsWith(FOTOGRAFIA_DAS_14_03)).toBe(true);
    expect(r.cabecalhoDeCobertura).toMatch(/devolveu 0 registros/);
    expect((await chamar(a, "busca_direta", { tribunal: "stj", texto: "falha de propósito" })).isError).toBe(true);
    expect(site.chamadas).toEqual(["vazia de propósito", "falha de propósito", "falha de propósito"]);
  });

  it("renovar vai ao site; se falhar, é busca com erro e a guardada fica intacta", async () => {
    let falhar = false;
    const chamadas: string[] = [];
    const cliente = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async (_url: string, init: RequestInit) => {
        chamadas.push(String(JSON.parse(String(init.body)).query));
        return falhar ? new Response("", { status: 500 }) : respostaJson({ results: [acordao("r1")] });
      }) as typeof fetch,
    });
    const a = await janela(cliente);
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal" });
    agora += HORA;
    const renovada = JSON.parse((await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal", renovar: true })).texto);
    expect(renovada.buscaGuardada).toBeUndefined();
    expect(chamadas).toHaveLength(2);

    falhar = true;
    agora += HORA;
    expect((await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal", renovar: true })).isError).toBe(true);
    const guardada = JSON.parse((await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal" })).texto);
    // A renovada (15:03) é a que ficou guardada; a falha não a apagou nem a trocou.
    expect(guardada.buscaGuardada).toMatch(/^fotografia da busca feita no site em 08\/10\/2026 15:03/);
    expect(guardada.acordaos).toHaveLength(1);
    expect(chamadas).toHaveLength(3);
  });

  it("busca_ampla repetida noutra janela: 0 chamadas; ampliada com 3 formulações novas: só as novas; cabeçalho por tribunal", async () => {
    const site = siteFalso();
    const a = await janela(site.cliente);
    const primeira = JSON.parse(
      (await chamar(a, "busca_ampla", { formulacoes: ["omissão estatal", "dever de vigilância"], tribunais: ["stj"] })).texto,
    );
    expect(primeira.cabecalhoDeCobertura.porTribunal[0].guardadas).toBeUndefined();
    expect(site.chamadas).toHaveLength(2);
    await esperarBuscasNoDisco(2);

    agora += 2 * HORA;
    const siteB = siteFalso();
    const b = await janela(siteB.cliente);
    const repetida = JSON.parse(
      (await chamar(b, "busca_ampla", { formulacoes: ["omissão estatal", "dever de vigilância"], tribunais: ["stj"] })).texto,
    );
    expect(siteB.chamadas).toEqual([]);
    expect(repetida.acordaos.map((x: { id: string }) => x.id).sort()).toEqual(primeira.acordaos.map((x: { id: string }) => x.id).sort());
    expect(repetida.cabecalhoDeCobertura.porTribunal[0]).toMatchObject({
      tribunal: "stj",
      buscasFeitas: 2,
      guardadas: 2,
      feitasAgora: 0,
      maisAntiga: "08/10/2026 14:03",
    });

    agora += HORA;
    const ampliada = JSON.parse(
      (
        await chamar(b, "busca_ampla", {
          formulacoes: ["omissão estatal", "dever de vigilância", "falha do serviço", "culpa anônima", "vazia nada"],
          tribunais: ["stj"],
        })
      ).texto,
    );
    expect(siteB.chamadas.sort()).toEqual(["culpa anônima", "falha do serviço", "vazia nada"]);
    expect(ampliada.cabecalhoDeCobertura.porTribunal[0]).toMatchObject({
      buscasFeitas: 4,
      vazias: 1,
      comErro: 1,
      guardadas: 2,
      feitasAgora: 2,
      maisAntiga: "08/10/2026 14:03",
    });
    // A ementa guardada não ganha a data de hoje; a buscada agora, sim.
    const ementa = async (id: string) => JSON.parse((await chamar(b, "obter_ementa", { id })).texto).obtidoDoSite;
    expect(await ementa("stj:omiss-o-estatal")).toBe("obtido do site em 08/10/2026 14:03 (hora local, UTC-03:00)");
    expect(await ementa("stj:culpa-an-nima")).toBe("obtido do site em 08/10/2026 17:03 (hora local, UTC-03:00)");
  });

  it("busca_ampla com renovar ignora a memória; falha parcial = \"com erro\"; falha total = erro (ADR-0001), guardadas intactas", async () => {
    let falhar: "nada" | "stj" | "tudo" = "nada";
    const chamadas: string[] = [];
    const cliente = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async (url: string, init: RequestInit) => {
        chamadas.push(String(JSON.parse(String(init.body)).query));
        const tribunal = String(url).match(/tribunais\/(\w+)\/search/)![1];
        if (falhar === "tudo" || (falhar === "stj" && tribunal === "stj")) return new Response("", { status: 500 });
        return respostaJson({ results: [acordao(`${tribunal}-1`)] });
      }) as typeof fetch,
    });
    const a = await janela(cliente);
    const pedido = { formulacoes: ["omissão estatal"], tribunais: ["stj", "tjmg"] };
    await chamar(a, "busca_ampla", pedido);
    expect(chamadas).toHaveLength(2);

    agora += HORA;
    const renovada = JSON.parse((await chamar(a, "busca_ampla", { ...pedido, renovar: true })).texto);
    expect(chamadas).toHaveLength(4);
    expect(renovada.cabecalhoDeCobertura.porTribunal.every((t: { guardadas?: number }) => !t.guardadas)).toBe(true);

    // Só o STJ falha: aparece "com erro", nunca a fotografia antiga.
    falhar = "stj";
    const parcial = JSON.parse((await chamar(a, "busca_ampla", { ...pedido, renovar: true })).texto);
    expect(parcial.cabecalhoDeCobertura.porTribunal).toEqual([
      expect.objectContaining({ tribunal: "stj", buscasFeitas: 0, comErro: 1, situacao: "com erro" }),
      expect.objectContaining({ tribunal: "tjmg", buscasFeitas: 1, comErro: 0 }),
    ]);

    falhar = "tudo";
    const total = await chamar(a, "busca_ampla", { ...pedido, renovar: true });
    expect(total.isError).toBe(true);
    expect(total.texto).toMatch(/^Nenhuma das 2 buscas deu resposta/);

    // Sem renovar, as guardadas (as da renovação das 15:03; a do TJMG, da falha parcial) continuam valendo.
    const antes = chamadas.length;
    const guardada = JSON.parse((await chamar(a, "busca_ampla", pedido)).texto);
    expect(chamadas).toHaveLength(antes);
    expect(guardada.cabecalhoDeCobertura.porTribunal[0]).toMatchObject({
      tribunal: "stj",
      guardadas: 1,
      maisAntiga: "08/10/2026 15:03",
    });
  });

  it("busca guardada responde com o disjuntor aberto, sem chamada; a busca nova é recusada na hora", async () => {
    let recusar = false;
    const chamadas: string[] = [];
    const cliente = new Cliente({
      nome: "O site",
      esperar: async () => {},
      agora: relogio,
      vagas: new CoordenacaoEmArquivo({ pasta: dados, agora: relogio }),
      fetch: (async (_url: string, init: RequestInit) => {
        chamadas.push(String(JSON.parse(String(init.body)).query));
        return recusar ? new Response("", { status: 403 }) : respostaJson({ results: [acordao("d1")] });
      }) as typeof fetch,
    });
    const a = await janela(cliente);
    await chamar(a, "busca_ampla", { formulacoes: ["omissão estatal"], tribunais: ["stj"] });
    recusar = true;
    expect((await chamar(a, "busca_direta", { tribunal: "stj", texto: "outra tese" })).isError).toBe(true);
    const recusadas = chamadas.length;

    const direta = await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal", limite: 100 });
    expect(direta.isError).toBe(false);
    expect(JSON.parse(direta.texto).buscaGuardada.startsWith(FOTOGRAFIA_DAS_14_03)).toBe(true);
    const ampla = await chamar(a, "busca_ampla", { formulacoes: ["omissão estatal", "tese nova"], tribunais: ["stj"] });
    expect(ampla.isError).toBe(false);
    expect(JSON.parse(ampla.texto).cabecalhoDeCobertura.porTribunal[0]).toMatchObject({ guardadas: 1, comErro: 1 });
    expect(chamadas).toHaveLength(recusadas);
  });

  it("rede parada (estado da proteção ilegível): a busca guardada e a ementa guardada respondem; a busca nova não sai", async () => {
    const chamadas: string[] = [];
    const cliente = new Cliente({
      nome: "O site",
      esperar: async () => {},
      vagas: new CoordenacaoEmArquivo({ pasta: dados, agora: relogio }),
      fetch: (async (_url: string, init: RequestInit) => {
        chamadas.push(String(JSON.parse(String(init.body)).query));
        return respostaJson({ results: [acordao("p2")] });
      }) as typeof fetch,
    });
    const a = await janela(cliente);
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal" });
    await writeFile(join(dados, "protecao", "estado.json"), "{ ilegível");

    const guardada = await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal" });
    expect(guardada.isError).toBe(false);
    expect(JSON.parse(guardada.texto).buscaGuardada.startsWith(FOTOGRAFIA_DAS_14_03)).toBe(true);
    expect((await chamar(a, "obter_ementa", { id: "stj:p2" })).isError).toBe(false);
    expect((await chamar(a, "busca_direta", { tribunal: "stj", texto: "outra tese" })).isError).toBe(true);
    expect(chamadas).toEqual(["omissão estatal"]);
  });

  it("o texto da busca e os filtros não ficam em nenhum arquivo da memória", async () => {
    // O site falso devolve sempre o mesmo acórdão: nada da busca ecoa na resposta do site.
    const cliente = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async () => respostaJson({ results: [acordao("p1")] })) as typeof fetch,
    });
    const a = await janela(cliente);
    await chamar(a, "busca_ampla", { formulacoes: ["teoria-do-orgao-ficticia"], tribunais: ["stj"], relator: "Relator-Ficticio-Sigiloso" });
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "nexo-causal-ficticio", orgao: "Orgao-Ficticio-Sigiloso" });
    await esperarBuscasNoDisco(2);

    const arquivos = await arquivosDaMemoria();
    expect(arquivos.length).toBeGreaterThanOrEqual(3);
    for (const f of arquivos) {
      const conteudo = await readFile(f, "utf8");
      expect(conteudo).not.toMatch(/teoria-do-orgao|nexo-causal|Relator-Ficticio|Orgao-Ficticio/);
      expect(f).not.toMatch(/teoria|nexo|Ficticio/);
    }
  });
});

/** Simula falha de leitura: cada busca guardada no disco vira uma pasta com o mesmo nome (ler dá erro, não "ausente"). */
async function estragarBuscasNoDisco() {
  for (const f of (await arquivosDaMemoria()).filter((f) => f.includes(join("memoria", "buscas-1")) && f.endsWith(".json"))) {
    await rm(f);
    await mkdir(f);
  }
}

describe("falha na memória vira busca normal explícita", () => {
  it("busca_direta: falha ao ler a busca guardada leva a busca ao site, com aviso na resposta", async () => {
    const a = await janela(siteFalso().cliente);
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "omissão estatal" });
    await esperarBuscasNoDisco(1);
    await estragarBuscasNoDisco();

    const siteB = siteFalso();
    const b = await janela(siteB.cliente);
    const r = await chamar(b, "busca_direta", { tribunal: "stj", texto: "omissão estatal" });
    expect(r.isError).toBe(false);
    const json = JSON.parse(r.texto);
    expect(json.buscaGuardada).toBeUndefined();
    expect(json.acordaos.map((x: { id: string }) => x.id)).toEqual(["stj:omiss-o-estatal"]);
    expect(json.avisos.join("\n")).toMatch(/A memória do Garimpo falhou ao ler a busca guardada .*: a busca foi feita no site/);
    expect(siteB.chamadas).toEqual(["omissão estatal"]);
  });

  it("busca_ampla: as buscas cuja leitura falhou vão ao site, com aviso; as legíveis voltam da memória", async () => {
    const a = await janela(siteFalso().cliente);
    await chamar(a, "busca_ampla", { formulacoes: ["omissão estatal"], tribunais: ["stj"] });
    await esperarBuscasNoDisco(1);
    await estragarBuscasNoDisco();
    await chamar(a, "busca_direta", { tribunal: "stj", texto: "dever de vigilância", limite: 100 });
    await esperarBuscasNoDisco(1);

    const siteB = siteFalso();
    const b = await janela(siteB.cliente);
    const r = await chamar(b, "busca_ampla", { formulacoes: ["omissão estatal", "dever de vigilância"], tribunais: ["stj"] });
    expect(r.isError).toBe(false);
    const json = JSON.parse(r.texto);
    expect(siteB.chamadas).toEqual(["omissão estatal"]);
    expect(json.cabecalhoDeCobertura.porTribunal[0]).toMatchObject({ buscasFeitas: 2, guardadas: 1, feitasAgora: 1 });
    expect(json.avisos.join("\n")).toMatch(/Memória do Garimpo falhou ao ler 1 de 2 buscas.*tratadas como/);
  });

  it("falha ao gravar na memória: a busca vai ao site normalmente e a resposta avisa que a memória não está gravando", async () => {
    // A pasta "memoria" é um arquivo: nenhuma gravação da memória consegue criar as subpastas.
    await writeFile(join(dados, "memoria"), "não é uma pasta");
    const site = siteFalso();
    const a = await janela(site.cliente);
    const primeira = await chamar(a, "busca_direta", { tribunal: "stj", texto: "tese 0" });
    expect(primeira.isError).toBe(false);

    // A gravação corre por trás da resposta: o aviso aparece numa resposta seguinte, assim que ela tiver falhado.
    const prazo = Date.now() + 5_000;
    let avisos = "";
    for (let i = 1; !/não conseguiu gravar/.test(avisos); i++) {
      if (Date.now() > prazo) throw new Error("o aviso de falha na gravação não apareceu no prazo");
      const r = await chamar(a, "busca_direta", { tribunal: "stj", texto: `tese ${i}` });
      expect(r.isError).toBe(false);
      avisos = JSON.parse(r.texto).avisos.join("\n");
    }
    expect(avisos).toMatch(/A memória do Garimpo não conseguiu gravar no disco .*: as buscas seguem indo ao site/);
    const ampla = JSON.parse((await chamar(a, "busca_ampla", { formulacoes: ["tese nova"], tribunais: ["stj"] })).texto);
    expect(ampla.avisos.join("\n")).toMatch(/Memória do Garimpo falhou .*ao gravar/);
    expect(await readFile(join(dados, "memoria"), "utf8")).toBe("não é uma pasta");
  });

  it("falha ao ler a memória com a rede parada segue a regra atual: erro, sem chamada", async () => {
    const chamadas: string[] = [];
    const cliente = new Cliente({
      nome: "O site",
      esperar: async () => {},
      vagas: new CoordenacaoEmArquivo({ pasta: dados, agora: relogio }),
      fetch: (async (_url: string, init: RequestInit) => {
        chamadas.push(String(JSON.parse(String(init.body)).query));
        return respostaJson({ results: [acordao("p3")] });
      }) as typeof fetch,
    });
    await chamar(await janela(cliente), "busca_direta", { tribunal: "stj", texto: "omissão estatal" });
    await esperarBuscasNoDisco(1);
    await estragarBuscasNoDisco();
    await writeFile(join(dados, "protecao", "estado.json"), "{ ilegível");

    const r = await chamar(await janela(cliente), "busca_direta", { tribunal: "stj", texto: "omissão estatal" });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/Rede parada/);
    expect(chamadas).toEqual(["omissão estatal"]);
  });
});
