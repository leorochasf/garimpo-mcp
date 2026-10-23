import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cliente, Vagas } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { respostaJson } from "./apoio.js";
import { chamar, conectar as conectarComFalcao, documento, falcaoFalso, pagina } from "./apoioFalcao.js";

/**
 * O que o servidor faz com o que o roteiro 1.2 manda (B1.1; P02, P04), sem rede: com memória fria, falha de leitura,
 * busca guardada vencida (24 h) ou renovar, as formulações antigas da união da 2ª rodada vão ao site e o cabeçalho as
 * conta como feitas, não como guardadas; 5 TRTs × 2 formulações deixam a contrária foraDoTeto, e repetir só a executa
 * com a memória valendo. São as condições que o roteiro ratificado nomeia (revisão B1.1, E1 e E2). Isso prova o que o
 * servidor envia e faz, não a resistência do agente (essa se mede na amostra com agente).
 */

/** Validade da busca guardada (src/memoria.ts), contada da obtenção no site. */
const DIA = 24 * 3_600_000;

/** Uma janela do Garimpo com esta pasta de dados (a mesma pasta = a mesma memória em disco) e, se vier, este relógio. */
async function janela(site: Cliente, dados: string, agora?: () => number) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(site, { dados, agora }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

const novaPasta = () => mkdtemp(join(process.env.GARIMPO_DADOS!, "rodadas-"));

/** Site falso: um acórdão próprio por (tribunal, texto); anota "tribunal/texto" de cada busca. */
function siteContado() {
  const buscas: string[] = [];
  const cliente = new Cliente({
    nome: "O site",
    vagas: new Vagas(2),
    esperar: async () => {},
    fetch: (async (url: string, init: RequestInit) => {
      const tribunal = String(url).match(/tribunais\/(\w+)\/search/)![1];
      const texto = String(JSON.parse(String(init.body)).query);
      buscas.push(`${tribunal}/${texto}`);
      const id = createHash("sha256").update(`${tribunal}/${texto}`).digest("hex").slice(0, 12);
      return respostaJson({
        results: [
          {
            id,
            texto_ementa: `EMENTA FICTÍCIA ${id}. ${texto}.`,
            numero_processo: `1.000.${id}/UF`,
            orgao_julgador: "Turma Exemplo",
            data_julgamento: "2024-01-02T00:00:00.000Z",
            link_pdf: `https://exemplo.test/${id}.pdf`,
          },
        ],
      });
    }) as typeof fetch,
  });
  return { cliente, buscas };
}

const PRIMEIRA = ["instituto jurídico x aplicado", "instituto jurídico x afastado", "situação y do instituto x"];
const NOVAS = ["expressão do tribunal a", "expressão do tribunal b"];
const UNIAO = [...PRIMEIRA, ...NOVAS];
const TRIBUNAIS = ["stj", "tjmg"];

type Linha = { tribunal: string; buscasFeitas: number; guardadas?: number; feitasAgora?: number; foraDoTeto?: number };
const cabecalho = (r: { dado: any }): Linha[] => r.dado.cabecalhoDeCobertura.porTribunal;
const daUniao = (buscas: string[]) => buscas.filter((b) => UNIAO.some((f) => b.endsWith(`/${f}`)));

/** A gravação em disco corre por trás das respostas: espera, com prazo, até haver n buscas guardadas no disco. */
async function buscasNoDisco(dados: string, n: number): Promise<string[]> {
  const prazo = Date.now() + 5_000;
  for (;;) {
    const itens = await readdir(join(dados, "memoria"), { recursive: true, withFileTypes: true }).catch(() => []);
    const buscas = itens
      .filter((i) => i.isFile() && i.name.endsWith(".json"))
      .map((i) => join(i.parentPath, i.name))
      .filter((f) => f.includes(join("memoria", "buscas-")));
    if (buscas.length >= n) return buscas;
    if (Date.now() > prazo) throw new Error("a gravação da memória não terminou no prazo");
    await new Promise((r) => setTimeout(r, 20));
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("2ª rodada: a união das formulações numa só busca_ampla (P02)", () => {
  async function primeiraRodada() {
    const dados = await novaPasta();
    const site = siteContado();
    const mcp = await janela(site.cliente, dados);
    const r = await chamar(mcp, "busca_ampla", { formulacoes: PRIMEIRA, tribunais: TRIBUNAIS });
    expect(r.isError).toBe(false);
    expect(site.buscas).toHaveLength(PRIMEIRA.length * TRIBUNAIS.length);
    return { dados, site, mcp };
  }

  it("memória ligada e legível: as antigas voltam da memória e só as novas vão ao site", async () => {
    const { site, mcp } = await primeiraRodada();
    site.buscas.length = 0;
    const r = await chamar(mcp, "busca_ampla", { formulacoes: UNIAO, tribunais: TRIBUNAIS });
    expect(r.isError).toBe(false);
    expect(site.buscas.sort()).toEqual(TRIBUNAIS.flatMap((t) => NOVAS.map((f) => `${t}/${f}`)).sort());
    for (const l of cabecalho(r)) {
      expect(l).toMatchObject({ buscasFeitas: UNIAO.length, guardadas: PRIMEIRA.length, feitasAgora: NOVAS.length });
    }
  });

  it("memória fria (GARIMPO_SEM_MEMORIA=1): as antigas vão ao site de novo e contam como feitas, não como guardadas", async () => {
    vi.stubEnv("GARIMPO_SEM_MEMORIA", "1");
    const { site, mcp } = await primeiraRodada();
    site.buscas.length = 0;
    const r = await chamar(mcp, "busca_ampla", { formulacoes: UNIAO, tribunais: TRIBUNAIS });
    expect(r.isError).toBe(false);
    expect(daUniao(site.buscas)).toHaveLength(UNIAO.length * TRIBUNAIS.length);
    for (const l of cabecalho(r)) {
      expect(l.buscasFeitas).toBe(UNIAO.length);
      expect(l.guardadas).toBeUndefined();
      expect(l.feitasAgora).toBeUndefined();
    }
  });

  it("falha ao ler a memória (outra janela, buscas ilegíveis no disco): as antigas vão ao site, com aviso, e contam como feitas", async () => {
    const { dados } = await primeiraRodada();
    // Cada busca guardada vira uma pasta com o mesmo nome: ler dá erro, não "ausente".
    for (const f of await buscasNoDisco(dados, PRIMEIRA.length * TRIBUNAIS.length)) {
      await rm(f);
      await mkdir(f);
    }
    const site = siteContado();
    const outra = await janela(site.cliente, dados);
    const r = await chamar(outra, "busca_ampla", { formulacoes: UNIAO, tribunais: TRIBUNAIS });
    expect(r.isError).toBe(false);
    expect(site.buscas).toHaveLength(UNIAO.length * TRIBUNAIS.length);
    expect(r.dado.avisos.join("\n")).toContain(
      `Memória do Garimpo falhou ao ler ${PRIMEIRA.length * TRIBUNAIS.length} de ${UNIAO.length * TRIBUNAIS.length} buscas: tratadas como buscas novas.`,
    );
    for (const l of cabecalho(r)) {
      expect(l.buscasFeitas).toBe(UNIAO.length);
      expect(l.guardadas).toBeUndefined();
    }
  });

  it("busca guardada vencida: com menos de 24 h as antigas voltam como guardadas; com 24 h vão ao site e contam como feitas", async () => {
    for (const [passou, guardadas] of [
      [DIA - 1, PRIMEIRA.length],
      [DIA, undefined],
    ] as const) {
      let agora = Date.UTC(2026, 0, 1);
      const site = siteContado();
      const mcp = await janela(site.cliente, await novaPasta(), () => agora);
      expect((await chamar(mcp, "busca_ampla", { formulacoes: PRIMEIRA, tribunais: TRIBUNAIS })).isError).toBe(false);
      agora += passou;
      site.buscas.length = 0;
      const r = await chamar(mcp, "busca_ampla", { formulacoes: UNIAO, tribunais: TRIBUNAIS });
      expect(r.isError).toBe(false);
      expect(site.buscas).toHaveLength((UNIAO.length - (guardadas ?? 0)) * TRIBUNAIS.length);
      for (const l of cabecalho(r)) {
        expect(l.buscasFeitas).toBe(UNIAO.length);
        expect(l.guardadas).toBe(guardadas);
      }
    }
  });

  it("renovar: a união inteira vai ao site, e nada conta como guardada", async () => {
    const { site, mcp } = await primeiraRodada();
    site.buscas.length = 0;
    const r = await chamar(mcp, "busca_ampla", { formulacoes: UNIAO, tribunais: TRIBUNAIS, renovar: true });
    expect(r.isError).toBe(false);
    expect(site.buscas).toHaveLength(UNIAO.length * TRIBUNAIS.length);
    for (const l of cabecalho(r)) {
      expect(l.buscasFeitas).toBe(UNIAO.length);
      expect(l.guardadas).toBeUndefined();
    }
  });

  it("outra grafia ou outro limite por busca é busca nova: por isso o roteiro manda a mesma grafia e os mesmos parâmetros", async () => {
    const { site, mcp } = await primeiraRodada();
    site.buscas.length = 0;
    const outraGrafia = [PRIMEIRA[0].toUpperCase(), ...PRIMEIRA.slice(1), ...NOVAS];
    const r = await chamar(mcp, "busca_ampla", { formulacoes: outraGrafia, tribunais: TRIBUNAIS });
    expect(r.isError).toBe(false);
    expect(site.buscas.filter((b) => b.endsWith(`/${PRIMEIRA[0].toUpperCase()}`))).toHaveLength(TRIBUNAIS.length);
    for (const l of cabecalho(r)) expect(l.guardadas).toBe(PRIMEIRA.length - 1);

    site.buscas.length = 0;
    const outroLimite = await chamar(mcp, "busca_ampla", { formulacoes: UNIAO, tribunais: TRIBUNAIS, limitePorBusca: 20 });
    expect(outroLimite.isError).toBe(false);
    expect(site.buscas).toHaveLength(UNIAO.length * TRIBUNAIS.length);
    for (const l of cabecalho(outroLimite)) expect(l.guardadas).toBeUndefined();
  });
});

// --- TRT: a contrária e o teto de 5 páginas do Falcão (P04) ---------------------------------------------------------

const TESE = "horas extras habituais";
const CONTRARIA = "horas extras eventuais não habituais";
const CINCO_TRTS = ["trt1", "trt2", "trt3", "trt4", "trt5"];

/** Falcão falso: um acórdão fictício por (TRT, texto); anota "trtN/texto" de cada página pedida. */
function falcaoContado() {
  const paginas: string[] = [];
  const falcao = falcaoFalso((url) => {
    const trt = url.searchParams.get("tribunais")!;
    const texto = url.searchParams.get("texto")!;
    paginas.push(`${trt.toLowerCase()}/${texto}`);
    const n = [...`${trt}${texto}`].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9_000_000, 7) + 1_000_000;
    return pagina([
      documento({
        tribunal: trt,
        idDocumentoAcordao: String(n),
        numeroProcesso: `0${n}-00.2024.5.01.0001`,
        ementa: `<p>${texto.toUpperCase()}. Ementa ficticia generica.</p>`,
      }),
    ]);
  });
  return { ...falcao, paginas };
}

/** Em quais TRTs a formulação rodou nesta chamada (página pedida ao Falcão). */
const rodouEm = (paginas: string[], texto: string) =>
  paginas
    .filter((p) => p.endsWith(`/${texto}`))
    .map((p) => p.split("/")[0])
    .sort();
/** Os TRTs em ordem de texto, para comparar com rodouEm (as duas filas de trabalho não garantem a ordem das páginas). */
const ordenados = (trts: string[]) => [...trts].sort();

describe("TRT: a contrária cabe no teto do Falcão ou a busca do contrário é declarada incompleta (P04)", () => {
  async function abrir() {
    const falcao = falcaoContado();
    const { mcp } = await conectarComFalcao(siteContado().cliente, falcao.cliente);
    return { mcp, falcao };
  }

  it("5 TRTs × 2 formulações, contrária em 2º lugar e memória fria: a 1ª chamada só roda a tese; a contrária fica foraDoTeto em todos", async () => {
    const { mcp, falcao } = await abrir();
    const r = await chamar(mcp, "busca_ampla", { formulacoes: [TESE, CONTRARIA], tribunais: CINCO_TRTS });
    expect(r.isError).toBe(false);
    expect(rodouEm(falcao.paginas, TESE)).toEqual(ordenados(CINCO_TRTS));
    expect(rodouEm(falcao.paginas, CONTRARIA)).toEqual([]);
    for (const l of cabecalho(r)) expect(l).toMatchObject({ buscasFeitas: 1, foraDoTeto: 1 });
    // O aviso sai: não são buscas vazias, e o texto diz quantas faltaram.
    expect(r.dado.cabecalhoDeCobertura.tetoDoFalcao).toMatch(/^5 de 10 buscas \(formulação × TRT\) não executadas pelo teto de 5 páginas/);
    expect(r.dado.cabecalhoDeCobertura.formulacoesSemAcordao).toEqual([]);
    expect(r.dado.completa).toBe(false);

    // Repetir com a memória ligada executa só a contrária, nos 5 TRTs; a tese volta da memória.
    falcao.paginas.length = 0;
    const de_novo = await chamar(mcp, "busca_ampla", { formulacoes: [TESE, CONTRARIA], tribunais: CINCO_TRTS });
    expect(rodouEm(falcao.paginas, CONTRARIA)).toEqual(ordenados(CINCO_TRTS));
    expect(rodouEm(falcao.paginas, TESE)).toEqual([]);
    for (const l of cabecalho(de_novo)) {
      expect(l).toMatchObject({ buscasFeitas: 2, guardadas: 1, feitasAgora: 1 });
      expect(l.foraDoTeto).toBeUndefined();
    }
    expect(de_novo.dado.cabecalhoDeCobertura.tetoDoFalcao).toBeUndefined();
  });

  it("5 TRTs × 2 com renovar: a repetição refaz as 5 páginas da tese e a contrária continua sem rodar (o custo que o roteiro avisa)", async () => {
    const { mcp, falcao } = await abrir();
    const pedido = { formulacoes: [TESE, CONTRARIA], tribunais: CINCO_TRTS, renovar: true };
    await chamar(mcp, "busca_ampla", pedido);
    const r = await chamar(mcp, "busca_ampla", pedido);
    expect(r.isError).toBe(false);
    expect(falcao.paginas).toHaveLength(10);
    expect(rodouEm(falcao.paginas, TESE)).toEqual(ordenados([...CINCO_TRTS, ...CINCO_TRTS]));
    expect(rodouEm(falcao.paginas, CONTRARIA)).toEqual([]);
    for (const l of cabecalho(r)) {
      expect(l).toMatchObject({ buscasFeitas: 1, foraDoTeto: 1 });
      expect(l.guardadas).toBeUndefined();
    }
    expect(r.dado.cabecalhoDeCobertura.tetoDoFalcao).toMatch(/^5 de 10 buscas/);
  });

  it("5 TRTs × 2 com a memória desligada: a repetição também refaz as páginas já feitas, e nada volta como guardada", async () => {
    vi.stubEnv("GARIMPO_SEM_MEMORIA", "1");
    const { mcp, falcao } = await abrir();
    const pedido = { formulacoes: [TESE, CONTRARIA], tribunais: CINCO_TRTS };
    await chamar(mcp, "busca_ampla", pedido);
    const r = await chamar(mcp, "busca_ampla", pedido);
    expect(falcao.paginas).toHaveLength(10);
    expect(rodouEm(falcao.paginas, CONTRARIA)).toEqual([]);
    for (const l of cabecalho(r)) {
      expect(l).toMatchObject({ buscasFeitas: 1, foraDoTeto: 1 });
      expect(l.guardadas).toBeUndefined();
    }
  });

  it("5 TRTs × 2 com as buscas guardadas vencidas (24 h): a repetição refaz as 5 páginas da tese e a contrária continua sem rodar", async () => {
    let agora = Date.UTC(2026, 0, 1);
    const falcao = falcaoContado();
    const { mcp } = await conectarComFalcao(siteContado().cliente, falcao.cliente, { agora: () => agora });
    const pedido = { formulacoes: [TESE, CONTRARIA], tribunais: CINCO_TRTS };
    await chamar(mcp, "busca_ampla", pedido);
    agora += DIA;
    const r = await chamar(mcp, "busca_ampla", pedido);
    expect(r.isError).toBe(false);
    expect(falcao.paginas).toHaveLength(10);
    expect(rodouEm(falcao.paginas, TESE)).toEqual(ordenados([...CINCO_TRTS, ...CINCO_TRTS]));
    expect(rodouEm(falcao.paginas, CONTRARIA)).toEqual([]);
    for (const l of cabecalho(r)) {
      expect(l).toMatchObject({ buscasFeitas: 1, foraDoTeto: 1 });
      expect(l.guardadas).toBeUndefined();
    }
  });

  it("5 TRTs × 2 com falha ao ler a memória na repetição: as já feitas não voltam como guardadas, são refeitas, e a contrária continua sem rodar", async () => {
    const falcao = falcaoContado();
    const { mcp, dados } = await conectarComFalcao(siteContado().cliente, falcao.cliente);
    const pedido = { formulacoes: [TESE, CONTRARIA], tribunais: CINCO_TRTS };
    await chamar(mcp, "busca_ampla", pedido);
    // Cada busca guardada vira uma pasta com o mesmo nome: ler dá erro, não "ausente". Outra janela não a tem consigo.
    for (const f of await buscasNoDisco(dados, CINCO_TRTS.length)) {
      await rm(f);
      await mkdir(f);
    }
    falcao.paginas.length = 0;
    const { mcp: outra } = await conectarComFalcao(siteContado().cliente, falcao.cliente, { dados });
    const r = await chamar(outra, "busca_ampla", pedido);
    expect(r.isError).toBe(false);
    expect(rodouEm(falcao.paginas, TESE)).toEqual(ordenados(CINCO_TRTS));
    expect(rodouEm(falcao.paginas, CONTRARIA)).toEqual([]);
    expect(r.dado.avisos.join("\n")).toContain(
      `Memória do Garimpo falhou ao ler ${CINCO_TRTS.length} de ${2 * CINCO_TRTS.length} buscas: tratadas como buscas novas.`,
    );
    for (const l of cabecalho(r)) {
      expect(l).toMatchObject({ buscasFeitas: 1, foraDoTeto: 1 });
      expect(l.guardadas).toBeUndefined();
    }
  });

  it("regra (i): com 3 TRTs ou mais, a contrária em 1º lugar roda em todos já na 1ª chamada", async () => {
    const { mcp, falcao } = await abrir();
    const r = await chamar(mcp, "busca_ampla", { formulacoes: [CONTRARIA, TESE], tribunais: CINCO_TRTS });
    expect(r.isError).toBe(false);
    expect(rodouEm(falcao.paginas, CONTRARIA)).toEqual(ordenados(CINCO_TRTS));
    for (const l of cabecalho(r)) expect(l).toMatchObject({ buscasFeitas: 1, foraDoTeto: 1 });
  });

  it("regra (i): com até 2 TRTs, a contrária em 2º lugar roda nos dois na 1ª chamada, mesmo com mais formulações", async () => {
    const { mcp, falcao } = await abrir();
    const formulacoes = [TESE, CONTRARIA, "jornada extraordinária habitual", "sobrejornada habitual"];
    const r = await chamar(mcp, "busca_ampla", { formulacoes, tribunais: ["trt2", "trt15"] });
    expect(r.isError).toBe(false);
    expect(rodouEm(falcao.paginas, CONTRARIA)).toEqual(ordenados(["trt2", "trt15"]));
    // As 5 páginas: tese e contrária nos dois TRTs e a 3ª formulação no 1º; o resto fica foraDoTeto, não vazio.
    expect(falcao.paginas).toHaveLength(5);
    expect(cabecalho(r).find((l) => l.tribunal === "trt15")).toMatchObject({ buscasFeitas: 2, foraDoTeto: 2 });
  });
});
