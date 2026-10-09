import { describe, expect, it } from "vitest";
import { AdiadaError, Cliente, RecusaError, Vagas } from "../src/cliente.js";
import { servicoDe } from "../src/disjuntor.js";
import { clienteDoDjen, FonteDjen } from "../src/djen.js";

const URL_DJEN = "https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroProcesso=1&itensPorPagina=100&pagina=1";
const vazio = (headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ status: "success", count: 0, items: [] }), {
    headers: { "content-type": "application/json", ...headers },
  });
const recusa429 = (retryAfter?: string) => () =>
  new Response("", { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });

/** DJEN falso com relógio falso: as esperas avançam o relógio. */
function djen(respostas: (() => Response)[]) {
  const relogio = { agora: 1_000_000 };
  const esperas: number[] = [];
  let chamadas = 0;
  const cliente = clienteDoDjen({
    vagas: new Vagas(2),
    agora: () => relogio.agora,
    esperar: async (ms) => {
      esperas.push(ms);
      relogio.agora += ms;
    },
    fetch: (async () => {
      const r = respostas[chamadas++];
      if (!r) throw new Error("sem resposta gravada");
      return r();
    }) as typeof fetch,
  });
  return { cliente, relogio, esperas, chamadas: () => chamadas };
}

describe("freios do DJEN", () => {
  it("é o serviço djen no disjuntor", () => {
    expect(servicoDe(URL_DJEN)).toBe("djen");
  });

  it("3 s entre chamadas ao host", async () => {
    const d = djen([() => vazio(), () => vazio()]);
    await (await d.cliente.requisitar(URL_DJEN)).text();
    await (await d.cliente.requisitar(URL_DJEN)).text();
    expect(d.esperas).toEqual([3_000]);
  });

  it("429 sem Retry-After: espera 60 s dentro da chamada e faz uma nova tentativa", async () => {
    const d = djen([recusa429(), () => vazio()]);
    const r = await d.cliente.requisitar(URL_DJEN);
    expect(r.status).toBe(200);
    expect(d.esperas).toContain(60_000);
    expect(d.chamadas()).toBe(2);
  });

  it("429 de novo na nova tentativa: recusa, disjuntor aberto", async () => {
    const d = djen([recusa429("10"), recusa429("10")]);
    await expect(d.cliente.requisitar(URL_DJEN)).rejects.toBeInstanceOf(RecusaError);
    await expect(d.cliente.requisitar(URL_DJEN)).rejects.toThrow(/pausadas em todas as janelas/);
    expect(d.chamadas()).toBe(2);
  });

  it("pedido acima de 60 s: adia sem recusa; antes do instante falha na hora; depois, a primeira é a nova tentativa", async () => {
    const d = djen([recusa429("300"), () => vazio()]);
    const primeira = await d.cliente.requisitar(URL_DJEN).catch((e) => e);
    expect(primeira).toBeInstanceOf(AdiadaError);
    expect(primeira).not.toBeInstanceOf(RecusaError);
    expect((primeira as AdiadaError).ate).toBe(1_000_000 + 300_000);
    expect(d.esperas).toEqual([]);

    d.relogio.agora += 100_000;
    const barrada = await d.cliente.requisitar(URL_DJEN).catch((e) => e);
    expect(barrada).toBeInstanceOf(AdiadaError);
    expect(barrada.message).toMatch(/^Esta chamada não foi feita: O DJEN pediu para esperar até /);
    expect(d.chamadas()).toBe(1);

    d.relogio.agora += 200_000;
    expect((await d.cliente.requisitar(URL_DJEN)).status).toBe(200);
    expect(d.chamadas()).toBe(2);
    // Aceita a nova tentativa, o serviço volta ao normal: a chamada seguinte sai (e cai no fim das gravações).
    d.relogio.agora += 3_000;
    await expect(d.cliente.requisitar(URL_DJEN)).rejects.toThrow(/sem resposta gravada/);
  });

  it("a nova tentativa depois do adiamento recusada: abre o disjuntor (1 min, a primeira abertura)", async () => {
    const d = djen([recusa429("300"), recusa429("10")]);
    await d.cliente.requisitar(URL_DJEN).catch(() => {});
    d.relogio.agora += 300_000;
    expect(await d.cliente.requisitar(URL_DJEN).catch((e) => e)).toBeInstanceOf(RecusaError);
    expect(d.chamadas()).toBe(2);
    d.relogio.agora += 30_000;
    await expect(d.cliente.requisitar(URL_DJEN)).rejects.toThrow(/pausadas em todas as janelas/);
    // Vencida a pausa de 1 min, sai a chamada de prova (e cai no fim das gravações).
    d.relogio.agora += 31_000;
    await expect(d.cliente.requisitar(URL_DJEN)).rejects.toThrow(/sem resposta gravada/);
  });

  it("outro serviço com pedido acima do teto continua sendo recusa: o adiamento é só do DJEN", async () => {
    const outro = new Cliente({
      nome: "O site",
      vagas: new Vagas(2),
      esperar: async () => {},
      fetch: (async () => new Response("", { status: 429, headers: { "retry-after": "300" } })) as typeof fetch,
    });
    await expect(outro.requisitar("https://www.jurisprudenciaia.com.br/x")).rejects.toBeInstanceOf(RecusaError);
  });

  it("x-ratelimit-remaining 2 ou menos: a próxima consulta espera a janela (1 min)", async () => {
    const d = djen([() => vazio({ "x-ratelimit-remaining": "2" }), () => vazio({ "x-ratelimit-remaining": "19" })]);
    const fonte = new FonteDjen(d.cliente, {
      agora: () => d.relogio.agora,
      esperar: async (ms) => {
        d.esperas.push(ms);
        d.relogio.agora += ms;
      },
    });
    await fonte.consultar("1");
    await fonte.consultar("1");
    expect(d.esperas).toEqual([60_000]);
  });
});
