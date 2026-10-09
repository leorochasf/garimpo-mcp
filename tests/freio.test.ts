import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Cliente, PausaPreventivaError, RecusaError } from "../src/cliente.js";
import { CoordenacaoEmArquivo, RedeParadaError } from "../src/coordenacao.js";

/**
 * O freio preventivo do Falcão visto pelo cliente: duas janelas (dois clientes) com a coordenação real na MESMA
 * pasta de dados temporária e o mesmo relógio falso, como em disjuntor.test.ts.
 */

let pasta: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-freio-"));
});
afterEach(() => rm(pasta, { recursive: true, force: true }));

const FALCAO = "https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa";
const MIN = 60_000;
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

function janela(relogio: { agora: number }, fetchFalso: typeof fetch) {
  return new Cliente({
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
