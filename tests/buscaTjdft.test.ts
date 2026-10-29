import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { buscaNoTjdft, lerResultadosDoTjdft } from "../src/buscaTjdft.js";
import { Cliente, FormatoInesperadoError } from "../src/cliente.js";
import { servicoDe } from "../src/disjuntor.js";
import { ROTULO_PORTAL_TJDFT } from "../src/leitura.js";
import { Memoria } from "../src/memoria.js";
import { criarServidor } from "../src/servidor.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

// Ticket 12 (piloto TJDFT): o braço de medição da pesquisa oficial do tribunal. Não está ligado à busca do usuário.
// Fixtures: estrutura das respostas reais gravadas em 2026-10-29 (busca «dano moral» e busca vazia), valores fictícios.

type Registro = Record<string, unknown>;
const BUSCA = () => fixture("tjdft-busca.json") as { hits: { value: number }; registros: Registro[] };
const VAZIA = () => fixture("tjdft-busca-vazia.json");
const ENDPOINT = "https://jurisdf.tjdft.jus.br/api/v1/pesquisa";

describe("leitor da pesquisa oficial do TJDFT", () => {
  it("lê os acórdãos (turma e turma recursal), deixa de fora a decisão monocrática e diz o total informado", () => {
    const { acordaos, total, foraDosAcordaos } = lerResultadosDoTjdft(BUSCA());
    expect(total).toBe(268023);
    expect(foraDosAcordaos).toBe(1);
    expect(acordaos.map((a) => a.id)).toEqual(["tjdft:of9100001", "tjdft:of9100002", "tjdft:of9100003", "tjdft:of9100004"]);
    const a = acordaos[2];
    expect(a).toMatchObject({
      tribunal: "tjdft",
      numero: "0000003-11.2025.8.07.0001",
      numeroCnj: "0000003-11.2025.8.07.0001",
      semNumero: false,
      relator: "RELATOR FICTÍCIO 3",
      orgao: "2ª TURMA CÍVEL",
      dataJulgamento: "2026-10-14",
      dataPublicacao: "2026-10-29",
      link: "https://jurisdf.tjdft.jus.br/acordaos/9100003/inteiro-teor/00000003-1111-4222-8333-444444444443",
      fonte: ROTULO_PORTAL_TJDFT,
    });
    expect(a.ementa).toMatch(/^EMENTA FICTÍCIA 3\./);
    // A resposta só traz o código da classe: nenhuma tabela de tradução inventada.
    expect(a.classe).toBeUndefined();
    expect(a.enquadramento927).toBeDefined();
  });

  it("busca vazia real (200, hits 0, registros vazios) é lista vazia, não erro", () => {
    expect(lerResultadosDoTjdft(VAZIA())).toEqual({ acordaos: [], total: 0, foraDosAcordaos: 0 });
  });

  it("processo sem os 20 algarismos: sem número CNJ, e o número mostrado é o identificador do tribunal", () => {
    const dado = BUSCA();
    dado.registros[2] = { ...dado.registros[2], processo: "não informado" };
    const a = lerResultadosDoTjdft(dado).acordaos[2];
    expect(a.numeroCnj).toBeUndefined();
    expect(a.semNumero).toBe(true);
    expect(a.numero).toBe("9100003");
  });

  it.each([
    ["nada", null],
    ["objeto vazio", {}],
    ["total que não é número", { hits: { value: "muitos" }, registros: [] }],
    ["registros que não são lista", { hits: { value: 1 }, registros: "x" }],
    ["acórdão sem uuid válido", { hits: { value: 1 }, registros: [{ ...BUSCA().registros[2], uuid: "sem-uuid" }] }],
    ["acórdão com identificador que não é número", { hits: { value: 1 }, registros: [{ ...BUSCA().registros[2], identificador: "abc" }] }],
    ["acórdão sem ementa", { hits: { value: 1 }, registros: [{ ...BUSCA().registros[2], ementa: undefined }] }],
    // B12-R01: só a decisão conhecida («decisoes») é descartada e contada; o resto não pode virar página vazia.
    ["registro nulo", { hits: { value: 1 }, registros: [null] }],
    ["registro vazio, sem base", { hits: { value: 1 }, registros: [{}] }],
    ["registro que não é objeto", { hits: { value: 1 }, registros: ["acordaos"] }],
    ["base desconhecida", { hits: { value: 1 }, registros: [{ ...BUSCA().registros[2], base: "sumulas" }] }],
    ["acórdãos sem o campo base", { hits: { value: 4 }, registros: BUSCA().registros.map(({ base, ...r }: Record<string, unknown>) => r) }],
  ])("formato inesperado (%s) é erro, nunca lista vazia", (_, dado) => {
    expect(() => lerResultadosDoTjdft(dado)).toThrow(FormatoInesperadoError);
  });
});

describe("busca na pesquisa oficial do TJDFT (braço de medição)", () => {
  it("um POST na API, só a base de acórdãos, sem o inteiro teor, e guarda os acórdãos na memória", async () => {
    const memoria = new Memoria();
    const { cliente, chamadas } = clienteFalso([() => respostaJson(BUSCA())]);
    const r = await buscaNoTjdft(cliente, { texto: "  dano moral  ", limite: 3 }, memoria);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(ENDPOINT);
    expect(chamadas[0].init.method).toBe("POST");
    expect(new Headers(chamadas[0].init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual({
      query: "dano moral",
      pagina: 0,
      tamanho: 3,
      termosAcessorios: [{ campo: "base", valor: "acordaos" }],
    });
    expect(r.total).toBe(268023);
    expect(r.acordaos).toHaveLength(3);
    expect((await memoria.obter("tjdft:of9100001"))?.acordao.link).toMatch(/\/acordaos\/9100001\/inteiro-teor\//);
  });

  it("limite acima do teto do braço vira 20; sem limite, 20", async () => {
    for (const limite of [50, undefined]) {
      const { cliente, chamadas } = clienteFalso([() => respostaJson(VAZIA())]);
      await buscaNoTjdft(cliente, { texto: "dano moral", limite });
      expect(JSON.parse(String(chamadas[0].init.body)).tamanho).toBe(20);
    }
  });

  it("vai ao serviço tjdft dos freios: a mesma cota (60 por minuto) do inteiro teor", () => {
    expect(servicoDe(ENDPOINT)).toBe("tjdft");
  });
});

describe("acórdão da busca oficial pela interface MCP: inteiro teor e leitura sem mudança, id sem colisão", () => {
  it("obter_inteiro_teor e ler_inteiro_teor funcionam pelo id próprio, e o id da base com o mesmo número é outro acórdão", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    const memoria = new Memoria({ dados });
    await buscaNoTjdft(clienteFalso([() => respostaJson(BUSCA())]).cliente, { texto: "dano moral" }, memoria);
    // Um acórdão da base do JurisprudênciaIA cujo id do site tem o mesmo número do identificador do tribunal.
    const daBase = { id: "tjdft:9100003", tribunal: "tjdft", numero: "outro", semNumero: true, ementa: "OUTRO ACÓRDÃO." } as Acordao;
    memoria.lembrar([{ ids: [daBase.id], registro: daBase }]);
    const prazo = Date.now() + 10_000;
    while (!(await new Memoria({ dados }).obter("tjdft:9100003")) || !(await new Memoria({ dados }).obter("tjdft:of9100003"))) {
      if (Date.now() > prazo) throw new Error("a gravação da memória não terminou no prazo");
      await new Promise((r) => setTimeout(r, 20));
    }

    const comTexto = { ...BUSCA().registros[2], inteiroTeor: "Poder Judiciário. Acórdão fictício 3. RELATÓRIO. VOTO fictício.", possuiInteiroTeor: true };
    const portal = clienteFalso([() => respostaJson({ hits: { value: 1 }, registros: [comTexto] })]);
    const site = new Cliente({ nome: "O site", fetch: (async () => { throw new Error("o site não deve ser chamado"); }) as typeof fetch });
    const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
    await criarServidor(site, { dados, tribunais: () => portal.cliente }).connect(ladoServidor);
    const mcp = new Client({ name: "teste", version: "0" });
    await mcp.connect(ladoCliente);
    const chamar = async (name: string, args: Record<string, unknown>) => {
      const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError, r.content[0].text).toBeFalsy();
      return JSON.parse(r.content[0].text);
    };

    expect((await chamar("obter_inteiro_teor", { id: "tjdft:of9100003" })).explicacao).toMatch(/API do TJ do Distrito Federal/);
    expect(portal.chamadas).toHaveLength(1);
    expect(JSON.parse(String(portal.chamadas[0].init.body)).termosAcessorios).toEqual([{ campo: "identificador", valor: "9100003" }]);
    const lida = await chamar("ler_inteiro_teor", { id: "tjdft:of9100003" });
    expect(lida.cabecalho.fonte).toBe(ROTULO_PORTAL_TJDFT);
    expect(lida.texto).toMatch(/VOTO fictício/);
    expect((await chamar("obter_ementa", { id: "tjdft:9100003" })).ementa).toBe("OUTRO ACÓRDÃO.");
    await mcp.close();
  });
});
