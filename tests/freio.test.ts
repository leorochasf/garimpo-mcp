import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Cliente, type OpcoesCliente, PausaPreventivaError, RecusaError } from "../src/cliente.js";
import { CoordenacaoEmArquivo, RedeParadaError } from "../src/coordenacao.js";
import { anotarOrcamento, decidirOrcamento } from "../src/freio.js";

/**
 * O freio preventivo do Falcão visto pelo cliente: duas janelas (dois clientes) com a coordenação real na MESMA
 * pasta de dados temporária e o mesmo relógio falso, como em disjuntor.test.ts.
 */

let pasta: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-freio-"));
});
afterEach(() => rm(pasta, { recursive: true, force: true, maxRetries: 10 }));

const FALCAO = "https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa";
const MIN = 60_000;
// Dezenas de chamadas com coordenação real gravam estado, travas e vagas. O relógio falso elimina a pausa do
// serviço, mas não esse trabalho de disco: sob carga, estes testes podem passar do prazo geral de 60 s (as 50
// chamadas do teto diário levaram 36 s com o disco disputado e passaram de 60 s com o antivírus sobrecarregado).
const PRAZO_MUITAS_CHAMADAS_MS = 120_000;
/** 09/10/2026, 14:00, hora local: a pausa preventiva de 15 min termina às 14:15. */
const INICIO = new Date(2026, 9, 9, 14, 0, 0).getTime();
const tique = (ms = 2) => new Promise((r) => setTimeout(r, ms));

/** Resposta do Falcão com o restante informado (ou sem o cabeçalho). */
const comRestante = (restante?: string) =>
  new Response(JSON.stringify({ documentos: [] }), {
    status: 200,
    headers: { "content-type": "application/json", ...(restante !== undefined && { "x-rate-limit-remaining": restante }) },
  });

/** Falcão falso: cada chamada recebe a próxima resposta da fila; uma "pendente" só responde quando o teste soltar. */
function falcao() {
  const chegadas: number[] = [];
  const fila: (Response | Promise<Response>)[] = [];
  const fetchFalso = (async () => {
    chegadas.push(chegadas.length + 1);
    const r = fila.shift();
    if (!r) throw new Error("sem resposta gravada");
    return r;
  }) as typeof fetch;
  const pendente = () => {
    let soltar!: (r: Response) => void;
    fila.push(new Promise<Response>((r) => (soltar = r)));
    return (r: Response) => soltar(r);
  };
  return { chegadas, fila, fetchFalso, pendente };
}

function janela(relogio: { agora: number }, fetchFalso: typeof fetch, extras: Partial<OpcoesCliente> = {}) {
  return new Cliente({
    ...extras,
    nome: "O Falcão",
    vagas: new CoordenacaoEmArquivo({ pasta, agora: () => relogio.agora }),
    agora: () => relogio.agora,
    esperar: async (ms) => {
      relogio.agora += ms;
      await tique(1);
    },
    fetch: fetchFalso,
  });
}

const erroDe = (p: Promise<Response>) =>
  p.then(
    () => {
      throw new Error("a chamada deveria ter falhado");
    },
    (e: Error) => e,
  );

const ler = async (c: Cliente) => (await c.requisitar(FALCAO)).text();

describe("freio preventivo do Falcão, entre janelas", () => {
  it("restante na reserva (10): a próxima chamada, na outra janela, não sai; pausa preventiva com a hora, sem ser recusa", async () => {
    const relogio = { agora: INICIO };
    const f = falcao();
    const [a, b] = [janela(relogio, f.fetchFalso), janela(relogio, f.fetchFalso)];
    f.fila.push(comRestante("10"));
    await ler(a);

    const e = await erroDe(b.requisitar(FALCAO));
    expect(e).toBeInstanceOf(PausaPreventivaError);
    expect(e).not.toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/pausa preventiva em todas as janelas/);
    expect(e.message).toMatch(/a partir de 14:15/);
    expect(e.message).toMatch(/sem garantia de liberação/);
    expect(f.chegadas).toHaveLength(1);
  });

  it("restante acima da reserva: as chamadas seguem, e cada uma reserva uma unidade antes de sair (duas janelas não gastam a mesma folga)", async () => {
    const relogio = { agora: INICIO };
    const f = falcao();
    const [a, b] = [janela(relogio, f.fetchFalso), janela(relogio, f.fetchFalso)];
    f.fila.push(comRestante("12"));
    await ler(a);
    // Duas chamadas em andamento, uma de cada janela: 12 → 11 → 10 reservados antes de qualquer resposta.
    const soltarA = f.pendente();
    const soltarB = f.pendente();
    const pa = ler(a);
    while (f.chegadas.length < 2) await tique();
    const pb = ler(b);
    while (f.chegadas.length < 3) await tique();
    const terceira = await erroDe(a.requisitar(FALCAO));
    expect(terceira).toBeInstanceOf(PausaPreventivaError);
    expect(f.chegadas).toHaveLength(3);
    soltarA(comRestante("11"));
    soltarB(comRestante("10"));
    await Promise.all([pa, pb]);
  });

  it("o restante que chega numa resposta ainda desconta a reserva da chamada em voo da outra janela", async () => {
    const relogio = { agora: INICIO };
    const f = falcao();
    const [a, b] = [janela(relogio, f.fetchFalso), janela(relogio, f.fetchFalso)];
    f.fila.push(comRestante("13"));
    await ler(a);
    const soltarA = f.pendente();
    const soltarB = f.pendente();
    const pa = ler(a);
    while (f.chegadas.length < 2) await tique();
    const pb = ler(b);
    while (f.chegadas.length < 3) await tique();
    // A resposta de A diz 11, mas a chamada de B ainda está em voo: sobram 10, a reserva.
    soltarA(comRestante("11"));
    await pa;
    expect(await erroDe(a.requisitar(FALCAO))).toBeInstanceOf(PausaPreventivaError);
    soltarB(comRestante("10"));
    await pb;
    expect(f.chegadas).toHaveLength(3);
  });

  it("chamada de liberação que falha antes de sair não prende as outras janelas", async () => {
    const relogio = { agora: INICIO };
    const f = falcao();
    const a = janela(relogio, f.fetchFalso);
    f.fila.push(comRestante("2"));
    await ler(a);
    relogio.agora = INICIO + 15 * MIN;
    const quebrada = janela(relogio, (() => {
      throw new Error("fetch quebrado");
    }) as unknown as typeof fetch);
    expect(await erroDe(quebrada.requisitar(FALCAO))).not.toBeInstanceOf(PausaPreventivaError);
    f.fila.push(comRestante("35"));
    await ler(janela(relogio, f.fetchFalso));
    expect(f.chegadas).toHaveLength(2);
  });

  it("vencida a pausa, o pedido do usuário libera UMA chamada entre todas as janelas; restante acima da reserva retoma", async () => {
    const relogio = { agora: INICIO };
    const f = falcao();
    const [a, b] = [janela(relogio, f.fetchFalso), janela(relogio, f.fetchFalso)];
    f.fila.push(comRestante("5"));
    await ler(a);
    relogio.agora = INICIO + 15 * MIN;
    // Sem pedido, nada sai: nenhuma sondagem automática.
    await tique(20);
    expect(f.chegadas).toHaveLength(1);

    const soltar = f.pendente();
    const pa = ler(a);
    while (f.chegadas.length < 2) await tique();
    f.fila.push(comRestante("39"));
    const pb = ler(b);
    // A outra janela espera a decisão da liberação, sem sair.
    for (let i = 0; i < 10; i++) await tique();
    expect(f.chegadas).toHaveLength(2);
    soltar(comRestante("30"));
    await Promise.all([pa, pb]);
    expect(f.chegadas).toHaveLength(3);
  });

  for (const [caso, restante] of [
    ["na reserva", "10"],
    ["ausente", undefined],
    ["inválido", "muito"],
  ] as const) {
    it(`liberação com restante ${caso} = mais 15 min; a outra janela, que esperava, recebe a pausa`, async () => {
      const relogio = { agora: INICIO };
      const f = falcao();
      const [a, b] = [janela(relogio, f.fetchFalso), janela(relogio, f.fetchFalso)];
      f.fila.push(comRestante("3"));
      await ler(a);
      relogio.agora = INICIO + 15 * MIN;

      const soltar = f.pendente();
      const pa = ler(a);
      while (f.chegadas.length < 2) await tique();
      const eb = erroDe(b.requisitar(FALCAO));
      for (let i = 0; i < 5; i++) await tique();
      const momento = relogio.agora;
      soltar(comRestante(restante));
      await pa;
      const e = await eb;
      expect(e).toBeInstanceOf(PausaPreventivaError);
      expect((e as PausaPreventivaError).ate).toBeGreaterThanOrEqual(momento + 15 * MIN);
      expect(f.chegadas).toHaveLength(2);
    });
  }

  it("liberação sem resposta (rede): não prende as outras; o próximo pedido pode ser a nova liberação", async () => {
    const relogio = { agora: INICIO };
    const f = falcao();
    const [a, b] = [janela(relogio, f.fetchFalso), janela(relogio, f.fetchFalso)];
    f.fila.push(comRestante("2"));
    await ler(a);
    relogio.agora = INICIO + 15 * MIN;
    const caiu = Promise.reject(new Error("rede caiu"));
    caiu.catch(() => {});
    f.fila.push(caiu);
    expect(await erroDe(a.requisitar(FALCAO))).not.toBeInstanceOf(PausaPreventivaError);
    f.fila.push(comRestante("35"));
    await ler(b);
    expect(f.chegadas).toHaveLength(3);
  });

  it("recusa na chamada de liberação segue o disjuntor: recusa final, pausa por recusa em todas as janelas", async () => {
    const relogio = { agora: INICIO };
    const f = falcao();
    const [a, b] = [janela(relogio, f.fetchFalso), janela(relogio, f.fetchFalso)];
    f.fila.push(comRestante("1"));
    await ler(a);
    relogio.agora = INICIO + 15 * MIN;
    f.fila.push(new Response("<html>bloqueado</html>", { status: 403, headers: { "content-type": "text/html" } }));
    const e = await erroDe(a.requisitar(FALCAO));
    expect(e).toBeInstanceOf(RecusaError);
    const e2 = await erroDe(b.requisitar(FALCAO));
    expect(e2).toBeInstanceOf(RecusaError);
    expect(e2.message).toMatch(/por causa de uma recusa/);
    expect(f.chegadas).toHaveLength(2);
  });

  it("TJDFT: o restante vem em x-ratelimit-remaining (cota de 60 por minuto); na reserva, pausa preventiva em todas as janelas", async () => {
    const relogio = { agora: INICIO };
    const f = falcao();
    const [a, b] = [janela(relogio, f.fetchFalso), janela(relogio, f.fetchFalso)];
    const TJDFT = "https://jurisdf.tjdft.jus.br/api/v1/pesquisa";
    f.fila.push(
      new Response("{}", { status: 200, headers: { "content-type": "application/json", "x-ratelimit-limit": "60", "x-ratelimit-remaining": "10" } }),
    );
    await (await a.requisitar(TJDFT, { method: "POST" })).text();

    const e = await erroDe(b.requisitar(TJDFT, { method: "POST" }));
    expect(e).toBeInstanceOf(PausaPreventivaError);
    expect(e).not.toBeInstanceOf(RecusaError);
    expect(f.chegadas).toHaveLength(1);
  });

  it("o freio é só do Falcão: restante baixo em outra fonte não pausa nada", async () => {
    const relogio = { agora: INICIO };
    const respostas = [comRestante("0"), comRestante("0")];
    const c = janela(relogio, (async () => respostas.shift()!) as typeof fetch);
    await (await c.requisitar("https://www.jurisprudenciaia.com.br/api/x")).text();
    await (await c.requisitar("https://www.jurisprudenciaia.com.br/api/x")).text();
    expect(respostas).toHaveLength(0);
  });

  it("freio ilegível no estado compartilhado = rede parada, sem apagar nada", async () => {
    await mkdir(join(pasta, "protecao"), { recursive: true });
    const estado = JSON.stringify({
      formato: "garimpo-protecao",
      versao: 2,
      pausas: {},
      disjuntores: {},
      freios: { jt: { restante: "muitos" } },
    });
    await writeFile(join(pasta, "protecao", "estado.json"), estado);
    const f = falcao();
    const e = await erroDe(janela({ agora: INICIO }, f.fetchFalso).requisitar(FALCAO));
    expect(e).toBeInstanceOf(RedeParadaError);
    expect(f.chegadas).toHaveLength(0);
    expect(await readFile(join(pasta, "protecao", "estado.json"), "utf8")).toBe(estado);
  });
});

/** Fonte sem cabeçalho de restante (serviço "teste"): o limite por janela é do próprio Garimpo (G-05, DQ-25). */
const FONTE = "https://teste.jus.br/api";
const ORCAMENTO = { teste: { chamadas: 2, largurasMs: [10 * MIN, 20 * MIN, 30 * MIN] } };

/** Fonte falsa que aceita tudo, ou responde na ordem a fila de respostas dada. */
function fonteAceita(fila: Response[] = []) {
  const chegadas: number[] = [];
  const fetchFalso = (async () => {
    chegadas.push(chegadas.length + 1);
    return fila.shift() ?? new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { chegadas, fetchFalso };
}

const chamar = async (c: Cliente) => (await c.requisitar(FONTE)).text();

describe("escada limitada e acertos consecutivos (I-04/I-05)", () => {
  it("recusas no último degrau saturam; 20 acertos bastam para descer um degrau", () => {
    let o = decidirOrcamento(undefined, ORCAMENTO.teste, INICIO).novo;
    for (let i = 0; i < 8; i++) o = anotarOrcamento(o, "recusa")!;
    for (let i = 0; i < 20; i++) o = anotarOrcamento(o, "aceita")!;
    expect(o.degrau).toBe(1);
  });

  it("o teto diário não acumula degraus nem acertos", () => {
    const config = { chamadas: 3, largurasMs: [], diario: true as const };
    const o = decidirOrcamento(undefined, config, INICIO).novo;
    expect(anotarOrcamento(o, "recusa")).toEqual(o);
    expect(anotarOrcamento(o, "aceita")).toEqual(o);
  });

  it("uma resposta com erro interrompe os 20 acertos seguidos", async () => {
    const relogio = { agora: INICIO };
    const f = fonteAceita([new Response("", { status: 429 }), ...Array.from({ length: 19 }, () => new Response("{}")), new Response("", { status: 500 })]);
    const a = janela(relogio, f.fetchFalso, { orcamentoPorServico: { teste: { chamadas: 50, largurasMs: ORCAMENTO.teste.largurasMs } } });
    for (let i = 0; i < 19; i++) await chamar(a);
    expect(await erroDe(a.requisitar(FONTE))).toMatchObject({ status: 500 });
    await chamar(a);
    const o = JSON.parse(await readFile(join(pasta, "protecao", "estado.json"), "utf8")).orcamentos.teste;
    expect(o).toMatchObject({ degrau: 1, acertos: 1 });
  }, PRAZO_MUITAS_CHAMADAS_MS);
});

describe("orçamento por janela, para fonte que não informa o restante", () => {
  it.each([
    ["mapa como lista", (e: any) => { e.orcamentos = []; }],
    ["mapa ausente na versão 3", (e: any) => { delete e.orcamentos; }],
    ["limite zero", (e: any) => { e.orcamentos.teste.limite = 0; }],
    ["contador inseguro", (e: any) => { e.orcamentos.teste.usadas = 1e20; }],
    ["contador acima do limite", (e: any) => { e.orcamentos.teste.usadas = 3; }],
    ["instante fora do calendário", (e: any) => { e.orcamentos.teste.fim = 9e15; }],
    ["degrau fora da escada", (e: any) => { e.orcamentos.teste.degrau = 3; }],
    ["sequência impossível de acertos", (e: any) => { e.orcamentos.teste.acertos = 20; }],
    ["dia que não termina à meia-noite", (e: any) => { e.orcamentos.teste.diario = true; }],
  ])("estado corrompido (%s) para todos os serviços sem alterar o arquivo (I-04/I-05)", async (_, corromper) => {
    const f = fonteAceita();
    const relogio = { agora: INICIO };
    await chamar(janela(relogio, f.fetchFalso, { orcamentoPorServico: ORCAMENTO }));
    const caminho = join(pasta, "protecao", "estado.json");
    const estado = JSON.parse(await readFile(caminho, "utf8"));
    corromper(estado);
    const texto = JSON.stringify(estado);
    await writeFile(caminho, texto);
    expect(await erroDe(janela(relogio, f.fetchFalso).requisitar("https://outra.jus.br/api"))).toBeInstanceOf(RedeParadaError);
    expect((await new CoordenacaoEmArquivo({ pasta }).diagnosticar()).redeParada).toBe(true);
    expect(f.chegadas).toHaveLength(1);
    expect(await readFile(caminho, "utf8")).toBe(texto);
  });

  it("migra a versão 2 preservando os freios e grava versão que clientes antigos recusam (I-04/I-05)", async () => {
    await mkdir(join(pasta, "protecao"), { recursive: true });
    await writeFile(join(pasta, "protecao", "estado.json"), JSON.stringify({
      formato: "garimpo-protecao", versao: 2, pausas: {}, disjuntores: {}, freios: { jt: { restante: 10, pausaAte: INICIO + MIN } },
    }));
    await chamar(janela({ agora: INICIO }, fonteAceita().fetchFalso, { orcamentoPorServico: ORCAMENTO }));
    const estado = JSON.parse(await readFile(join(pasta, "protecao", "estado.json"), "utf8"));
    expect(estado.versao).toBeGreaterThan(2);
    expect(estado.freios.jt).toEqual({ restante: 10, pausaAte: INICIO + MIN });
    expect(estado.orcamentos.teste.usadas).toBe(1);
  });
  it("no limite da janela a chamada não sai: pausa preventiva até o fim da janela, em todas as janelas do Garimpo", async () => {
    const relogio = { agora: INICIO };
    const f = fonteAceita();
    const [a, b] = [janela(relogio, f.fetchFalso, { orcamentoPorServico: ORCAMENTO }), janela(relogio, f.fetchFalso, { orcamentoPorServico: ORCAMENTO })];
    await chamar(a);
    await chamar(b);
    const e = await erroDe(a.requisitar(FONTE));
    expect(e).toBeInstanceOf(PausaPreventivaError);
    expect(e).not.toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/limite de chamadas do próprio Garimpo/);
    expect(e.message).toMatch(/a partir de 14:10/);
    expect(f.chegadas).toHaveLength(2);
  });

  it("vencida a janela, as chamadas voltam sem chamada de prova: a pausa do orçamento não é recusa e não abre o disjuntor", async () => {
    const relogio = { agora: INICIO };
    const f = fonteAceita();
    const a = janela(relogio, f.fetchFalso, { orcamentoPorServico: ORCAMENTO });
    await chamar(a);
    await chamar(a);
    expect(await erroDe(a.requisitar(FONTE))).toBeInstanceOf(PausaPreventivaError);
    relogio.agora = INICIO + 10 * MIN;
    await chamar(a);
    expect(f.chegadas).toHaveLength(3);
  });

  it("recusa da fonte alarga a janela um degrau (vale a partir da próxima janela)", async () => {
    const relogio = { agora: INICIO };
    const f = fonteAceita([new Response("", { status: 429, headers: { "retry-after": "1" } })]);
    const a = janela(relogio, f.fetchFalso, { orcamentoPorServico: ORCAMENTO });
    // O 429 e a nova tentativa gastam as duas chamadas da janela; a nova tentativa foi aceita.
    await chamar(a);
    relogio.agora = INICIO + 10 * MIN;
    await chamar(a);
    await chamar(a);
    relogio.agora = INICIO + 29 * MIN;
    expect(await erroDe(a.requisitar(FONTE))).toBeInstanceOf(PausaPreventivaError);
    relogio.agora = INICIO + 30 * MIN;
    await chamar(a);
  });

  it("20 chamadas aceitas seguidas afrouxam a janela um degrau, sem passar do primeiro", async () => {
    const relogio = { agora: INICIO };
    const f = fonteAceita([new Response("", { status: 429, headers: { "retry-after": "1" } })]);
    const a = janela(relogio, f.fetchFalso, { orcamentoPorServico: ORCAMENTO });
    await chamar(a); // 429 + nova tentativa aceita: janela de 20 min daqui em diante
    relogio.agora = INICIO + 10 * MIN;
    // 1 acerto veio da nova tentativa; faltam 19, duas por janela de 20 min.
    for (let i = 0; i < 10; i++) {
      await chamar(a);
      await chamar(a);
      relogio.agora += 20 * MIN;
    }
    // Janela de 10 min de novo: a terceira chamada pára e volta em 10 min.
    const base = relogio.agora;
    await chamar(a);
    await chamar(a);
    expect(await erroDe(a.requisitar(FONTE))).toBeInstanceOf(PausaPreventivaError);
    relogio.agora = base + 10 * MIN;
    await chamar(a);
  }, PRAZO_MUITAS_CHAMADAS_MS);

  it("serviço fora da tabela não tem orçamento", async () => {
    const relogio = { agora: INICIO };
    const f = fonteAceita();
    const a = janela(relogio, f.fetchFalso, { orcamentoPorServico: ORCAMENTO });
    for (let i = 0; i < 5; i++) await (await a.requisitar("https://outra.jus.br/api")).text();
    expect(f.chegadas).toHaveLength(5);
  });

  it("orçamento ilegível no estado compartilhado = rede parada, sem apagar nada", async () => {
    await mkdir(join(pasta, "protecao"), { recursive: true });
    const estado = JSON.stringify({
      formato: "garimpo-protecao",
      versao: 2,
      pausas: {},
      disjuntores: {},
      orcamentos: { teste: { fim: "amanhã" } },
    });
    await writeFile(join(pasta, "protecao", "estado.json"), estado);
    const f = fonteAceita();
    const e = await erroDe(janela({ agora: INICIO }, f.fetchFalso, { orcamentoPorServico: ORCAMENTO }).requisitar(FONTE));
    expect(e).toBeInstanceOf(RedeParadaError);
    expect(f.chegadas).toHaveLength(0);
    expect(await readFile(join(pasta, "protecao", "estado.json"), "utf8")).toBe(estado);
  });

  it("o diagnostico_dos_freios explica a pausa do orçamento: limite do Garimpo, até quando, sem ser recusa", async () => {
    const relogio = { agora: INICIO };
    const f = fonteAceita();
    const coordenacao = new CoordenacaoEmArquivo({ pasta, agora: () => relogio.agora });
    const a = new Cliente({ nome: "A fonte", vagas: coordenacao, agora: () => relogio.agora, fetch: f.fetchFalso, orcamentoPorServico: ORCAMENTO });
    await chamar(a);
    await chamar(a);
    const d = await coordenacao.diagnosticar();
    const fonte = d.fontes?.find((x) => x.servico === "teste");
    expect(fonte?.situacao).toBe("pausa preventiva");
    expect(fonte?.ate).toMatch(/14:10/);
    expect(fonte?.explicacao).toMatch(/Não é recusa/);
    expect(fonte?.explicacao).toMatch(/limite próprio/);
  });
});

/** O Falcão (serviço "jt"): teto diário do próprio Garimpo, mesmo com o restante informado alto (G-01, DQ-01). */
const HORA_BR = (instante: string) => Date.parse(`${instante}-03:00`);
const TETO_DE_TESTE = { jt: { chamadas: 3, largurasMs: [], diario: true as const } };

describe("relógio recuado não devolve chamadas já gastas (I-04/I-05)", () => {
  it.each(["janela", "dia"] as const)("mantém o contador e o fim do %s entre clientes", async (tipo) => {
    const relogio = { agora: INICIO };
    const f = fonteAceita();
    const config = tipo === "dia" ? { chamadas: 2, largurasMs: [], diario: true as const } : ORCAMENTO.teste;
    const extras = { orcamentoPorServico: { teste: config } };
    await chamar(janela(relogio, f.fetchFalso, extras));
    await chamar(janela(relogio, f.fetchFalso, extras));
    const antes = await readFile(join(pasta, "protecao", "estado.json"), "utf8");
    const fim = JSON.parse(antes).orcamentos.teste.fim;
    relogio.agora -= 2 * 24 * 60 * MIN;
    const erro = await erroDe(janela(relogio, f.fetchFalso, extras).requisitar(FONTE));
    expect(erro).toBeInstanceOf(PausaPreventivaError);
    expect((erro as PausaPreventivaError).ate).toBe(fim);
    expect(f.chegadas).toHaveLength(2);
    expect(await readFile(join(pasta, "protecao", "estado.json"), "utf8")).toBe(antes);
  });
});

describe("teto diário do Falcão, por dia civil de Brasília", () => {
  it.each(["dia", "restante"] as const)("o freio por %s bloqueia sem consumir o outro nem abrir o disjuntor", async (por) => {
    const relogio = { agora: HORA_BR("2026-10-09T14:00:00") };
    const f = falcao();
    const config = { jt: { chamadas: por === "dia" ? 1 : 3, largurasMs: [], diario: true as const } };
    const a = janela(relogio, f.fetchFalso, { orcamentoPorServico: config });
    f.fila.push(comRestante(por === "dia" ? "49" : "10"));
    await ler(a);
    const caminho = join(pasta, "protecao", "estado.json");
    if (por === "dia") {
      const estado = JSON.parse(await readFile(caminho, "utf8"));
      estado.freios.jt.pausaAte = relogio.agora - 1;
      await writeFile(caminho, JSON.stringify(estado));
    }
    const antes = await readFile(caminho, "utf8");
    expect(await erroDe(janela(relogio, f.fetchFalso, { orcamentoPorServico: config }).requisitar(FALCAO))).toBeInstanceOf(PausaPreventivaError);
    expect(await readFile(caminho, "utf8")).toBe(antes);
    expect(JSON.parse(antes).disjuntores).toEqual({});
    expect(f.chegadas).toHaveLength(1);
  });

  it("no teto a chamada não sai até a meia-noite de Brasília, mesmo com restante informado alto, em todas as janelas", async () => {
    const relogio = { agora: HORA_BR("2026-10-09T14:00:00") };
    const f = falcao();
    const [a, b] = [janela(relogio, f.fetchFalso, { orcamentoPorServico: TETO_DE_TESTE }), janela(relogio, f.fetchFalso, { orcamentoPorServico: TETO_DE_TESTE })];
    for (let i = 0; i < 3; i++) f.fila.push(comRestante("49"));
    await ler(a);
    await ler(b);
    await ler(a);
    const e = await erroDe(b.requisitar(FALCAO));
    expect(e).toBeInstanceOf(PausaPreventivaError);
    expect(e).not.toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/limite diário do próprio Garimpo/);
    expect((e as PausaPreventivaError).ate).toBe(HORA_BR("2026-10-10T00:00:00"));
    expect(f.chegadas).toHaveLength(3);
  });

  it("zera na virada do dia em Brasília, sem chamada de prova (não é recusa), e conta de novo no dia seguinte", async () => {
    const relogio = { agora: HORA_BR("2026-10-09T23:59:00") };
    const f = falcao();
    const a = janela(relogio, f.fetchFalso, { orcamentoPorServico: TETO_DE_TESTE });
    for (let i = 0; i < 6; i++) f.fila.push(comRestante("49"));
    for (let i = 0; i < 3; i++) await ler(a);
    expect(await erroDe(a.requisitar(FALCAO))).toBeInstanceOf(PausaPreventivaError);
    relogio.agora = HORA_BR("2026-10-10T00:00:00");
    for (let i = 0; i < 3; i++) await ler(a);
    const e = await erroDe(a.requisitar(FALCAO));
    expect((e as PausaPreventivaError).ate).toBe(HORA_BR("2026-10-11T00:00:00"));
    expect(f.chegadas).toHaveLength(6);
  });

  it("o teto padrão é de 50 chamadas por dia, e vale com o restante informado alto", async () => {
    const relogio = { agora: HORA_BR("2026-10-09T08:00:00") };
    const f = falcao();
    const a = janela(relogio, f.fetchFalso);
    for (let i = 0; i < 50; i++) f.fila.push(comRestante("49"));
    for (let i = 0; i < 50; i++) await ler(a);
    expect(await erroDe(a.requisitar(FALCAO))).toBeInstanceOf(PausaPreventivaError);
    expect(f.chegadas).toHaveLength(50);
  }, PRAZO_MUITAS_CHAMADAS_MS);

  it("o diagnostico_dos_freios explica a pausa diária", async () => {
    const relogio = { agora: HORA_BR("2026-10-09T14:00:00") };
    const f = falcao();
    const coordenacao = new CoordenacaoEmArquivo({ pasta, agora: () => relogio.agora });
    const a = new Cliente({ nome: "O Falcão", vagas: coordenacao, agora: () => relogio.agora, esperar: async (ms) => { relogio.agora += ms; }, fetch: f.fetchFalso, orcamentoPorServico: TETO_DE_TESTE });
    for (let i = 0; i < 3; i++) f.fila.push(comRestante("49"));
    for (let i = 0; i < 3; i++) await ler(a);
    const fonte = (await coordenacao.diagnosticar()).fontes?.find((x) => x.servico === "jt");
    expect(fonte?.situacao).toBe("pausa preventiva");
    expect(fonte?.explicacao).toMatch(/limite diário/);
    expect(fonte?.explicacao).toMatch(/meia-noite de Brasília/);
  });
});
