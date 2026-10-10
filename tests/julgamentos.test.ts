import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cliente, Vagas } from "../src/cliente.js";
import { clienteDoDataJud } from "../src/datajud.js";
import { servicoDe } from "../src/disjuntor.js";
import { criarServidor, type OpcoesServidor } from "../src/servidor.js";
import { fixture, respostaJson } from "./apoio.js";

/** Números fictícios com dígito verificador válido (módulo 97). */
const TJTO = "0000123-70.2020.8.27.0001";
const TJTO_2 = "0000124-55.2020.8.27.0001";
const STF = "0000126-63.2020.1.00.0000";
const CNJ = "0000128-49.2020.2.00.0000";

type Rota = (url: string, init: RequestInit) => Response | Promise<Response>;

/** DataJud falso: roteia por host (API e wiki) e registra as chamadas. */
function dataJudFalso(api: Rota, wiki: Rota = () => new Response("", { status: 404 })) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const cliente = new Cliente({
    nome: "O DataJud",
    vagas: new Vagas(2),
    esperar: async () => {},
    fetch: (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new URL(url).host === "datajud-wiki.cnj.jus.br" ? wiki(url, init) : api(url, init);
    }) as typeof fetch,
  });
  return { cliente, chamadas };
}

const siteQueNuncaResponde = () =>
  new Cliente({
    nome: "O site",
    vagas: new Vagas(2),
    esperar: async () => {},
    fetch: (async () => {
      throw new Error("o site não devia ser chamado");
    }) as typeof fetch,
  });

/** DJEN falso: responde com este corpo (ou esta resposta) e registra as chamadas. */
function djenFalso(resposta: object | (() => Response) = { status: "success", count: 0, items: [] }) {
  const chamadas: string[] = [];
  const cliente = new Cliente({
    nome: "O DJEN",
    vagas: new Vagas(2),
    esperar: async () => {},
    fetch: (async (url: string) => {
      chamadas.push(url);
      return typeof resposta === "function" ? resposta() : respostaJson(resposta);
    }) as typeof fetch,
  });
  return { cliente, chamadas };
}

/** Sem DJEN informado, um falso vazio: nenhum teste chama o DJEN de verdade. */
async function conectar(opcoes: OpcoesServidor, site = siteQueNuncaResponde()) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = opcoes.dados ?? (await mkdtemp(join(process.env.GARIMPO_DADOS!, "julgamentos-")));
  await criarServidor(site, { dados, djen: djenFalso().cliente, ...opcoes }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function chamar(mcp: Client, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name: "julgamentos_do_processo", arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const texto = r.content[0].text;
  return { isError: Boolean(r.isError), texto, json: r.isError ? undefined : JSON.parse(texto) };
}

/** Resposta do DataJud com estes registros (_source). */
const hits = (...fontes: unknown[]) => respostaJson({ hits: { total: { value: fontes.length }, hits: fontes.map((f) => ({ _source: f })) } });
const mov = (codigo: number | undefined, nome: string | undefined, dataHora: string, extra: object = {}) => ({
  ...(codigo !== undefined && { codigo }),
  ...(nome !== undefined && { nome }),
  dataHora,
  orgaoJulgador: { nome: "GAB. DO RELATOR 1" },
  ...extra,
});

afterEach(() => vi.unstubAllEnvs());

describe("julgamentos_do_processo: entrada sem chamada nenhuma", () => {
  it.each([
    ["número curto", { numero: "123" }, /20 dígitos/],
    ["dígito verificador errado", { numero: "0000123-71.2020.8.27.0001" }, /dígito verificador/],
    ["STF pelo número", { numero: STF }, /não cobre o STF/],
    ["STF pedido", { numero: TJTO, tribunal: "STF" }, /não cobre o STF/],
    ["CNJ, sem rota", { numero: CNJ }, /não tem rota no DataJud/],
    ["tribunal desconhecido", { numero: TJTO, tribunal: "tjxx" }, /não tem rota no DataJud/],
  ])("%s: explica, sem chamar", async (_caso, args, motivo) => {
    const { cliente, chamadas } = dataJudFalso(() => hits());
    const r = await chamar(await conectar({ datajud: cliente }), args);
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(motivo);
    expect(chamadas).toHaveLength(0);
  });
});

describe("julgamentos_do_processo: DataJud (gravação real reduzida)", () => {
  it("mostra só o 2º grau, os resultados de julgamento e, à parte, as juntadas com complemento Acórdão", async () => {
    const { cliente, chamadas } = dataJudFalso(() => respostaJson(fixture("datajud-tjto.json")));
    const r = await chamar(await conectar({ datajud: cliente }), { numero: TJTO.replace(/\D/g, "") });

    expect(r.isError).toBe(false);
    const d = r.json.datajud;
    expect(r.json).toMatchObject({ numero: TJTO, tribunal: "TJTO" });
    expect(d).toMatchObject({ fonte: "DataJud (API Pública do CNJ)", estado: "ok", total: 2, registrosDePrimeiroGrauNaoMostrados: 1 });
    expect(d.registros).toHaveLength(1);
    const [g2] = d.registros;
    expect(g2).toMatchObject({ grau: "G2", classe: "Apelação Cível", orgao: "GAB. DO RELATOR 1" });
    expect(g2.atualizadoNoDataJud).toBe("2026-11-30T10:09:23.414Z");
    // Códigos e nomes TPU reais, na ordem do lançamento; pauta (12115), baixa (22) e distribuição (26) ficam de fora.
    expect(g2.resultadosDeJulgamento.map((m: { codigo: number; nome: string }) => `${m.codigo} ${m.nome}`)).toEqual([
      "237 Provimento",
      "200 Não-Acolhimento de Embargos de Declaração",
      "239 Não-Provimento",
    ]);
    expect(g2.resultadosDeJulgamento[1]).toEqual({
      lancadoEm: "2021-02-28T14:46:25.000Z",
      codigo: 200,
      nome: "Não-Acolhimento de Embargos de Declaração",
      orgao: "GAB. DO RELATOR 2",
    });
    expect(g2.juntadasComComplementoAcordao.map((m: { lancadoEm: string }) => m.lancadoEm)).toEqual([
      "2020-11-15T11:49:43.000Z",
      "2021-03-04T13:40:54.000Z",
      "2026-01-03T16:54:11.000Z",
    ]);
    expect(d.sobreAsDatas).toMatch(/data do lançamento no DataJud, não é a data da sessão/);
    expect(r.json.termoDeUso).toMatch(/Termos-de-uso-api-publica-V1\.2\.pdf/);
    expect(r.json.termoDeUso).toMatch(/obrigações do termo são de quem usa a API/);
    expect(r.texto).not.toMatch(/julgamento colegiado/i);
    expect(d.notas).toBeUndefined();

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe("https://api-publica.datajud.cnj.jus.br/api_publica_tjto/_search");
    expect(chamadas[0].init.method).toBe("POST");
    expect(JSON.parse(String(chamadas[0].init.body)).query).toEqual({ match: { numeroProcesso: "00001237020208270001" } });
    expect(new Headers(chamadas[0].init.headers).get("Authorization")).toMatch(/^APIKey \S+$/);
    expect(new Headers(chamadas[0].init.headers).get("User-Agent")).toMatch(/^Garimpo\//);
  });

  it("tribunal informado troca a rota (o processo que subiu ao STJ)", async () => {
    const { cliente, chamadas } = dataJudFalso(() => hits());
    const r = await chamar(await conectar({ datajud: cliente }), { numero: TJTO, tribunal: "STJ" });
    expect(r.json.tribunal).toBe("STJ");
    expect(chamadas[0].url).toMatch(/\/api_publica_stj\/_search$/);
  });

  it("consulta repetida volta da memória, sem chamada, dizendo de quando é", async () => {
    const { cliente, chamadas } = dataJudFalso(() => respostaJson(fixture("datajud-tjto.json")));
    const mcp = await conectar({ datajud: cliente });
    const primeira = await chamar(mcp, { numero: TJTO });
    const segunda = await chamar(mcp, { numero: TJTO });
    expect(chamadas).toHaveLength(1);
    expect(primeira.json.datajud.obtido).toMatch(/^consultado no DataJud em /);
    expect(segunda.json.datajud.obtido).toMatch(/^consulta guardada: fotografia da consulta feita no DataJud em /);
    expect(segunda.json.datajud.registros).toEqual(primeira.json.datajud.registros);
  });

  it("a memória guarda só a resposta reduzida, sem o número em claro no nome do arquivo", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "julgamentos-"));
    const { cliente } = dataJudFalso(() => respostaJson(fixture("datajud-tjto.json")));
    await chamar(await conectar({ datajud: cliente, dados }, siteQueNuncaResponde()), { numero: TJTO, incluir_djen: false });
    const pasta = join(dados, "memoria", "consultas-1");
    let nomes: string[] = [];
    for (const prazo = Date.now() + 5_000; !nomes.length && Date.now() < prazo; await new Promise((r) => setTimeout(r, 20))) {
      nomes = (await readdir(pasta).catch(() => [])).filter((n) => n.endsWith(".json"));
    }
    expect(nomes).toHaveLength(1);
    expect(nomes[0]).toMatch(/^[0-9a-f]{64}\.json$/);
    const guardado = await readFile(join(pasta, nomes[0]), "utf8");
    expect(guardado).toContain('"fonte":"datajud"');
    expect(guardado).toContain("Não-Acolhimento de Embargos de Declaração");
    // Nada da resposta bruta: nem o número, nem andamentos que a ferramenta não mostra, nem campos não usados.
    for (const bruto of ["00001237020208270001", "Distribuição", "Baixa Definitiva", "nivelSigilo", "VARA 6"]) {
      expect(guardado).not.toContain(bruto);
    }
  });
});

describe("julgamentos_do_processo: bordas do DataJud", () => {
  const g2 = (movimentos: unknown[]) => ({ grau: "G2", classe: { nome: "Apelação Cível" }, movimentos });

  it("total 0: estado vazia e a frase de que isso não prova que o processo não exista", async () => {
    const { cliente } = dataJudFalso(() => hits());
    const r = await chamar(await conectar({ datajud: cliente }), { numero: TJTO });
    expect(r.json.datajud.estado).toBe("vazia");
    expect(r.json.datajud.notas).toEqual([
      "O DataJud não devolveu este processo nesta rota (TJTO); isso não prova que ele não exista.",
    ]);
  });

  it("só 1º grau: nenhum registro listado, o de 1º grau contado e a nota", async () => {
    const { cliente } = dataJudFalso(() => hits({ grau: "G1", movimentos: [mov(219, "Procedência", "2020-01-01T10:00:00Z")] }));
    const d = (await chamar(await conectar({ datajud: cliente }), { numero: TJTO })).json.datajud;
    expect(d).toMatchObject({ estado: "ok", registros: [], registrosDePrimeiroGrauNaoMostrados: 1 });
    expect(d.notas).toEqual([
      "A resposta trouxe apenas registro de 1º grau; não há registro de 2º grau ou superior nesta resposta.",
    ]);
  });

  it("andamento sem código ou nome é contado, nunca adivinhado; repetição só com mesmo código e mesmo instante", async () => {
    const { cliente } = dataJudFalso(() =>
      hits(
        g2([
          mov(undefined, "Sem código", "2020-01-01T10:00:00Z"),
          mov(239, undefined, "2020-01-01T10:00:00Z"),
          mov(239, "Não-Provimento", "2020-01-02T10:00:00Z"),
          mov(239, "Não-Provimento", "2020-01-02T10:00:00Z"),
          mov(239, "Não-Provimento", "2020-01-02T15:00:00Z"),
          mov(198, "Acolhimento de Embargos de Declaração", "2020-01-02T10:00:00Z"),
        ]),
      ),
    );
    const [r] = (await chamar(await conectar({ datajud: cliente }), { numero: TJTO })).json.datajud.registros;
    expect(r.andamentosSemCodigoOuNomeNaoMostrados).toBe(2);
    expect(r.resultadosDeJulgamento.map((m: { codigo: number; lancadoEm: string }) => `${m.codigo} ${m.lancadoEm}`)).toEqual([
      "239 2020-01-02T10:00:00Z",
      "198 2020-01-02T10:00:00Z",
      "239 2020-01-02T15:00:00Z",
    ]);
    expect(r.atualizadoNoDataJud).toBe("não informada");
  });

  it("erro HTTP do DataJud: estado erro com o motivo, nunca lista vazia", async () => {
    const { cliente } = dataJudFalso(() => new Response("falha", { status: 500 }));
    const d = (await chamar(await conectar({ datajud: cliente }), { numero: TJTO })).json.datajud;
    expect(d.estado).toBe("erro");
    expect(d.mensagem).toMatch(/HTTP 500/);
    expect(d).not.toHaveProperty("registros");
  });

  it("403 do DataJud: estado recusa", async () => {
    const { cliente } = dataJudFalso(() => new Response("negado", { status: 403 }));
    const d = (await chamar(await conectar({ datajud: cliente }), { numero: TJTO })).json.datajud;
    expect(d.estado).toBe("recusa");
  });
});

describe("julgamentos_do_processo: chave do DataJud", () => {
  const CHAVE_NOVA = "Q2hhdmVGaWN0aWNpYU5vdmFQYXJhVGVzdGU6MTIzNDU2Nzg5MA==";
  /** Página /acesso fictícia, no formato da wiki (a chave entre tags, com o texto da página logo depois). */
  const paginaDaWiki = (chave: string) =>
    new Response(
      `<p>utilize o formato &quot;Authorization: APIKey <!-- -->[Chave Pública]<!-- -->&quot; no cabeçalho.</p>` +
        `<ul><li><strong>APIKey atual</strong>:<ul><li>Authorization: APIKey <strong>${chave}</strong></li></ul></li></ul>` +
        `</div></article><nav>Próxima página</nav>`,
      { headers: { "content-type": "text/html" } },
    );
  const autorizacao = (init: RequestInit) => new Headers(init.headers).get("Authorization");

  it("401 com a chave do código: lê a wiki uma vez, repete uma vez com a chave nova e passa a usá-la", async () => {
    const { cliente, chamadas } = dataJudFalso(
      (_url, init) => (autorizacao(init) === `APIKey ${CHAVE_NOVA}` ? hits() : new Response("", { status: 401 })),
      () => paginaDaWiki(CHAVE_NOVA),
    );
    const mcp = await conectar({ datajud: cliente });
    const r = await chamar(mcp, { numero: TJTO });
    expect(r.json.datajud.estado).toBe("vazia");
    expect(chamadas.map((c) => new URL(c.url).host)).toEqual([
      "api-publica.datajud.cnj.jus.br",
      "datajud-wiki.cnj.jus.br",
      "api-publica.datajud.cnj.jus.br",
    ]);
    expect(chamadas[1].url).toBe("https://datajud-wiki.cnj.jus.br/api-publica/acesso/");
    expect(new Headers(chamadas[1].init.headers).get("User-Agent")).toMatch(/^Garimpo\//);

    await chamar(mcp, { numero: TJTO_2 });
    expect(chamadas).toHaveLength(4);
    expect(autorizacao(chamadas[3].init)).toBe(`APIKey ${CHAVE_NOVA}`);
  });

  it("401 e a wiki sem chave reconhecível: erro com o link da wiki, sem a chave na mensagem", async () => {
    const { cliente, chamadas } = dataJudFalso(
      () => new Response("", { status: 401 }),
      () => new Response("<p>página mudou</p>", { headers: { "content-type": "text/html" } }),
    );
    const r = await chamar(await conectar({ datajud: cliente }), { numero: TJTO });
    expect(r.json.datajud.estado).toBe("erro");
    expect(r.json.datajud.mensagem).toMatch(/https:\/\/datajud-wiki\.cnj\.jus\.br\/api-publica\/acesso\//);
    expect(chamadas).toHaveLength(2);
    const chave = autorizacao(chamadas[0].init)!.replace("APIKey ", "");
    expect(r.texto).not.toContain(chave);
  });

  it("401 e a wiki recusa (403): erro com o link da wiki, e a API não fica pausada", async () => {
    const { cliente, chamadas } = dataJudFalso(
      (_url, init) => (autorizacao(init) === "APIKey nao-usada" ? hits() : new Response("", { status: 401 })),
      () => new Response("negado", { status: 403 }),
    );
    const mcp = await conectar({ datajud: cliente });
    const r = await chamar(mcp, { numero: TJTO });
    expect(r.json.datajud.estado).toBe("recusa");
    expect(chamadas).toHaveLength(2);
    // Outro número: a API é chamada de novo (não ficou pausada pela recusa da wiki).
    await chamar(mcp, { numero: TJTO_2 });
    expect(chamadas.map((c) => new URL(c.url).host)[2]).toBe("api-publica.datajud.cnj.jus.br");
  });

  it("401 com a chave da variável de ambiente: nunca troca nem lê a wiki; explica e aponta a wiki", async () => {
    vi.stubEnv("GARIMPO_DATAJUD_CHAVE", "minha-chave-de-teste-1234567890");
    const { cliente, chamadas } = dataJudFalso(() => new Response("", { status: 401 }), () => paginaDaWiki(CHAVE_NOVA));
    const r = await chamar(await conectar({ datajud: cliente }), { numero: TJTO });
    expect(chamadas).toHaveLength(1);
    expect(autorizacao(chamadas[0].init)).toBe("APIKey minha-chave-de-teste-1234567890");
    expect(r.json.datajud.estado).toBe("erro");
    expect(r.json.datajud.mensagem).toMatch(/GARIMPO_DATAJUD_CHAVE/);
    expect(r.json.datajud.mensagem).toMatch(/datajud-wiki\.cnj\.jus\.br/);
    expect(r.texto).not.toContain("minha-chave-de-teste");
  });
});

describe("freios do DataJud", () => {
  it("a API é o serviço datajud no disjuntor; a wiki, à parte (uma recusa dela não pausa a API)", () => {
    expect(servicoDe("https://api-publica.datajud.cnj.jus.br/api_publica_tjto/_search")).toBe("datajud");
    expect(servicoDe("https://datajud-wiki.cnj.jus.br/api-publica/acesso/")).toBe("datajud-wiki");
  });

  it("intervalo mínimo de 0,5 s entre chamadas ao mesmo host", async () => {
    let agora = 0;
    const esperas: number[] = [];
    const cliente = clienteDoDataJud({
      vagas: new Vagas(2),
      agora: () => agora,
      esperar: async (ms) => {
        esperas.push(ms);
        agora += ms;
      },
      fetch: (async () => respostaJson({ hits: { total: { value: 0 }, hits: [] } })) as typeof fetch,
    });
    const url = "https://api-publica.datajud.cnj.jus.br/api_publica_tjto/_search";
    await (await cliente.requisitar(url, { method: "POST" })).text();
    await (await cliente.requisitar(url, { method: "POST" })).text();
    expect(esperas).toEqual([500]);
  });
});


describe("julgamentos_do_processo: DJEN", () => {
  /** Comunicação no formato do DJEN, com texto, partes e advogados fictícios que nunca podem sair. */
  const comunicacao = (k: number, link = `https://eproc.tribunal-exemplo.invalid/doc=${k}`) => ({
    id: 900000 + k,
    data_disponibilizacao: `2020-05-0${k}`,
    siglaTribunal: "TJTO",
    tipoComunicacao: "Intimação",
    nomeOrgao: "GAB. DO RELATOR 1",
    texto: `<p>INTIMA&Ccedil;&Atilde;O FICT&Iacute;CIA ${k}. PARTE A x PARTE B. ADVOGADO A (OAB/TO 00000).</p>`,
    numero_processo: "00001237020208270001",
    link,
    tipoDocumento: "Acórdão",
    nomeClasse: "APELAÇÃO CÍVEL",
    codigoClasse: 198,
    hash: `hashficticio${k}`,
    destinatarios: [
      { nome: "PARTE A", polo: "A" },
      { nome: "PARTE B", polo: "P" },
    ],
    destinatarioadvogados: [{ advogado: { nome: "ADVOGADO A", numero_oab: "00000", uf_oab: "TO" } }],
  });
  const NOMES = ["PARTE A", "PARTE B", "ADVOGADO A", "00000", "OAB", "INTIMA", "hashficticio"];
  const semDataJud = () => dataJudFalso(() => hits()).cliente;

  it("mostra só os metadados e o link https; nada de texto, partes ou advogados na saída nem na memória", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "julgamentos-"));
    const djen = djenFalso({ status: "success", count: 2, items: [comunicacao(1), comunicacao(2, "http://inseguro.invalid/2")] });
    const r = await chamar(await conectar({ datajud: semDataJud(), djen: djen.cliente, dados }), { numero: TJTO });

    expect(djen.chamadas).toEqual([
      "https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroProcesso=00001237020208270001&itensPorPagina=100&pagina=1",
    ]);
    expect(r.json.djen).toMatchObject({
      fonte: "DJEN (comunicações processuais do CNJ)",
      estado: "ok",
      total: 2,
      sobreALista: "Comunicações do processo no DJEN, não um inventário de acórdãos.",
    });
    expect(r.json.djen.comunicacoes).toEqual([
      {
        dataDisponibilizacao: "2020-05-01",
        tipoComunicacao: "Intimação",
        tipoDocumento: "Acórdão",
        orgao: "GAB. DO RELATOR 1",
        classe: "APELAÇÃO CÍVEL",
        link: "https://eproc.tribunal-exemplo.invalid/doc=1",
      },
      {
        dataDisponibilizacao: "2020-05-02",
        tipoComunicacao: "Intimação",
        tipoDocumento: "Acórdão",
        orgao: "GAB. DO RELATOR 1",
        classe: "APELAÇÃO CÍVEL",
      },
    ]);
    expect(r.json.djen).not.toHaveProperty("listaCortada");
    for (const nome of NOMES) expect(r.texto).not.toContain(nome);

    const pasta = join(dados, "memoria", "consultas-1");
    let djenGuardado: string | undefined;
    for (const prazo = Date.now() + 5_000; !djenGuardado && Date.now() < prazo; await new Promise((ok) => setTimeout(ok, 20))) {
      const nomes = (await readdir(pasta).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
      const textos = await Promise.all(nomes.map((n) => readFile(join(pasta, n), "utf8")));
      djenGuardado = textos.find((t) => t.includes('"fonte":"djen"'));
    }
    expect(djenGuardado).toContain("GAB. DO RELATOR 1");
    for (const nome of [...NOMES, "00001237020208270001"]) expect(djenGuardado).not.toContain(nome);
  });

  it("mais de 100: uma página só e o aviso de lista cortada, com a resposta limitada", async () => {
    const itens = Array.from({ length: 100 }, (_, i) => comunicacao((i % 9) + 1));
    const djen = djenFalso({ status: "success", count: 250, items: itens });
    const r = await chamar(await conectar({ datajud: semDataJud(), djen: djen.cliente }), { numero: TJTO });
    expect(djen.chamadas).toHaveLength(1);
    expect(r.json.djen.comunicacoes).toHaveLength(100);
    expect(r.json.djen.listaCortada).toBe("lista cortada: o DJEN tem 250 comunicações, mostradas 100");
    expect(r.texto.length).toBeLessThan(25_000);
  });

  it("vazio: estado vazia, com a frase do que a lista é", async () => {
    const r = await chamar(await conectar({ datajud: semDataJud() }), { numero: TJTO });
    expect(r.json.djen).toMatchObject({ estado: "vazia", total: 0, comunicacoes: [] });
    expect(r.json.djen.sobreALista).toMatch(/não um inventário de acórdãos/);
  });

  it("erro do DJEN aparece como estado, sem apagar o DataJud nem o site", async () => {
    const djen = djenFalso(() => new Response("falha", { status: 500 }));
    const site = new Cliente({
      nome: "O JurisprudênciaIA",
      vagas: new Vagas(2),
      esperar: async () => {},
      fetch: (async () => respostaJson({ results: [] })) as typeof fetch,
    });
    const datajud = dataJudFalso(() => respostaJson(fixture("datajud-tjto.json"))).cliente;
    const r = await chamar(await conectar({ datajud, djen: djen.cliente }, site), { numero: TJTO });
    expect(r.json.djen).toMatchObject({ estado: "erro", mensagem: expect.stringMatching(/HTTP 500/) });
    expect(r.json.datajud.estado).toBe("ok");
    expect(r.json.jurisprudenciaia.estado).toBe("vazia");
  });

  it("incluir_djen false: nenhuma chamada ao DJEN", async () => {
    const djen = djenFalso();
    const r = await chamar(await conectar({ datajud: semDataJud(), djen: djen.cliente }), { numero: TJTO, incluir_djen: false });
    expect(djen.chamadas).toHaveLength(0);
    expect(r.json.djen).toMatchObject({ estado: "não consultada" });
  });

  it("o DJEN pede mais de 60 s: vem na hora o que as outras fontes trouxeram e o instante permitido (pausa)", async () => {
    let chamadas = 0;
    const djen = new Cliente({
      nome: "O DJEN",
      vagas: new Vagas(2),
      esperar: async () => {},
      esperaMaximaMs: 60_000,
      adiaAcimaDoTeto: true,
      fetch: (async () => {
        chamadas++;
        return new Response("", { status: 429, headers: { "retry-after": "300" } });
      }) as typeof fetch,
    });
    const datajud = dataJudFalso(() => respostaJson(fixture("datajud-tjto.json"))).cliente;
    const r = await chamar(await conectar({ datajud, djen }), { numero: TJTO });
    expect(chamadas).toBe(1);
    expect(r.json.djen.estado).toBe("pausa");
    expect(r.json.djen.mensagem).toMatch(/pediu para esperar até \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(hora local, UTC[+-]\d{2}:\d{2}\)/);
    expect(r.json.djen.mensagem).toMatch(/Não é recusa/);
    expect(r.json.datajud.estado).toBe("ok");
  });
});

describe("julgamentos_do_processo: lado a lado com o JurisprudênciaIA", () => {
  const TRF1 = "0000131-91.2020.4.01.3400";

  /** Site falso: responde a toda busca com estes registros (ou esta resposta) e registra as chamadas. */
  function siteFalso(resposta: unknown[] | (() => Response)) {
    const chamadas: { url: string; corpo: Record<string, unknown> }[] = [];
    const cliente = new Cliente({
      nome: "O JurisprudênciaIA",
      vagas: new Vagas(2),
      esperar: async () => {},
      fetch: (async (url: string, init: RequestInit) => {
        chamadas.push({ url, corpo: JSON.parse(String(init.body)) });
        return typeof resposta === "function" ? resposta() : respostaJson({ results: resposta });
      }) as typeof fetch,
    });
    return { cliente, chamadas };
  }
  const doSite = (id: number, classe: string, cnj: string) => ({
    id,
    texto_ementa: `EMENTA: EXEMPLO FICTÍCIO ${id}.`,
    classe_processual: classe,
    numero_processo: cnj,
    numero_processo_cnj: cnj,
    data_julgamento: "2023-12-11T00:00:00.000Z",
  });
  /** O caso típico: o DataJud tem o mérito e os embargos; o site, só os embargos. */
  const dataJudTipico = () =>
    dataJudFalso(() =>
      hits(
        {
          grau: "G2",
          classe: { nome: "Apelação Cível" },
          movimentos: [
            mov(239, "Não-Provimento", "2023-09-06T10:00:00.000Z"),
            mov(200, "Não-Acolhimento de Embargos de Declaração", "2023-12-12T10:00:00.000Z"),
          ],
        },
        { grau: "G1", movimentos: [mov(219, "Procedência", "2022-01-01T10:00:00.000Z")] },
      ),
    );
  /** Nada de "falta acórdão" a partir de contagem, nem comparação por data. */
  const PROIBIDO = /falta|fora da base|não está na base|não existe|antes d[ao]|depois d[ao]|mesma data/i;

  it("caso típico: aponta o movimento de tipo não verificado, com nome e data, sem dizer que falta acórdão", async () => {
    const { cliente: datajud } = dataJudTipico();
    const site = siteFalso([doSite(1, "Embargos de Declaração Cível", TJTO), doSite(2, "Apelação Cível", TJTO_2)]);
    const r = await chamar(await conectar({ datajud }, site.cliente), { numero: TJTO });

    expect(r.json.jurisprudenciaia).toMatchObject({
      fonte: "JurisprudênciaIA (busca pelo número)",
      estado: "ok",
      acordaos: [{ id: "tjto:1", numero: TJTO, classe: "Embargos de Declaração Cível", tipo: "embargos de declaração" }],
    });
    expect(r.json.ladoALado).toEqual({
      datajud:
        "2 movimentos de resultado de julgamento (1 de embargos de declaração; 1 de tipo não verificado: " +
        "Não-Provimento, lançado no DataJud em 2023-09-06)",
      jurisprudenciaia: "busca pelo número: 1 acórdão deste número (embargos de declaração, id tjto:1)",
      comparacao: "embargos de declaração: 1 no DataJud e 1 no JurisprudênciaIA (mesmo número)",
      conferir:
        "Confira no portal do TJTO o movimento de tipo não verificado (Não-Provimento, lançado no DataJud em 2023-09-06).",
    });
    expect(r.texto).not.toMatch(PROIBIDO);
    // Uma chamada ao site, pelo número, no tribunal do número.
    expect(site.chamadas).toHaveLength(1);
    expect(site.chamadas[0].url).toMatch(/\/api\/tribunais\/tjto\/search$/);
    expect(site.chamadas[0].corpo.query).toBe(TJTO);
  });

  it("diferença no número de embargos: aponta a diferença, sem dizer que falta", async () => {
    const { cliente: datajud } = dataJudTipico();
    const site = siteFalso([]);
    const r = await chamar(await conectar({ datajud }, site.cliente), { numero: TJTO });
    expect(r.json.jurisprudenciaia).toMatchObject({ estado: "vazia", acordaos: [] });
    expect(r.json.ladoALado.comparacao).toBe("embargos de declaração: 1 no DataJud e 0 no JurisprudênciaIA");
    expect(r.json.ladoALado.conferir).toMatch(/e a diferença no número de embargos de declaração\.$/);
    expect(r.texto).not.toMatch(PROIBIDO);
  });

  it("repetida: o site responde pela busca guardada, sem nova chamada", async () => {
    const { cliente: datajud } = dataJudTipico();
    const site = siteFalso([doSite(1, "Embargos de Declaração", TJTO)]);
    const mcp = await conectar({ datajud }, site.cliente);
    await chamar(mcp, { numero: TJTO });
    const r = await chamar(mcp, { numero: TJTO });
    expect(site.chamadas).toHaveLength(1);
    expect(r.json.jurisprudenciaia.buscaGuardada).toMatch(/fotografia da busca/);
    expect(r.json.jurisprudenciaia.acordaos).toHaveLength(1);
  });

  it.each([
    ["site com erro", () => new Response("falha", { status: 500 }), /o JurisprudênciaIA não deu resposta utilizável \(erro\)/],
    ["site recusa", () => new Response("negado", { status: 403 }), /o JurisprudênciaIA não deu resposta utilizável \(recusa\)/],
    [
      "lista do site cortada",
      () => respostaJson({ results: Array.from({ length: 20 }, (_, i) => doSite(i, "Embargos de Declaração", TJTO)) }),
      /a lista do JurisprudênciaIA pode ter sido cortada/,
    ],
  ])("%s: sem comparação, com o estado da fonte dito", async (_caso, resposta, motivo) => {
    const { cliente: datajud } = dataJudTipico();
    const r = await chamar(await conectar({ datajud }, siteFalso(resposta).cliente), { numero: TJTO });
    expect(r.json.ladoALado.comparacao).toMatch(motivo);
    expect(r.json.ladoALado).not.toHaveProperty("conferir");
    // O DataJud continua lá.
    expect(r.json.datajud.registros).toHaveLength(1);
  });

  it("DataJud sem 2º grau: sem comparação", async () => {
    const { cliente: datajud } = dataJudFalso(() => hits({ grau: "G1", movimentos: [] }));
    const r = await chamar(await conectar({ datajud }, siteFalso([doSite(1, "Embargos de Declaração", TJTO)]).cliente), {
      numero: TJTO,
    });
    expect(r.json.ladoALado.comparacao).toBe("sem comparação: o DataJud não trouxe registro de 2º grau ou superior");
  });

  it("tribunal que o site não cobre: o site fica não consultado, sem chamada", async () => {
    const { cliente: datajud } = dataJudFalso(() => hits());
    const site = siteFalso([]);
    const r = await chamar(await conectar({ datajud }, site.cliente), { numero: TRF1 });
    expect(r.json.tribunal).toBe("TRF1");
    expect(r.json.jurisprudenciaia).toMatchObject({ estado: "não consultada", mensagem: "O JurisprudênciaIA não cobre o TRF1." });
    expect(site.chamadas).toHaveLength(0);
  });
});
