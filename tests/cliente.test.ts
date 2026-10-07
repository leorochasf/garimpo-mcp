import { describe, expect, it } from "vitest";
import { Cliente, RecusaError, USER_AGENT, Vagas } from "../src/cliente.js";
import { clienteFalso, respostaJson } from "./apoio.js";

describe("cliente — travas de uso responsável", () => {
  it("em 429 espera e faz UMA nova tentativa", async () => {
    const { cliente, chamadas, esperas } = clienteFalso([
      new Response("", { status: 429, headers: { "retry-after": "3" } }),
      respostaJson({ ok: true }),
    ]);
    const r = await cliente.requisitar("https://exemplo.test/x");
    expect(await r.json()).toEqual({ ok: true });
    expect(chamadas).toHaveLength(2);
    expect(esperas).toEqual([3000]);
  });

  it("em 503 sem Retry-After espera o padrão e tenta de novo", async () => {
    const { cliente, chamadas, esperas } = clienteFalso([new Response("", { status: 503 }), respostaJson({})]);
    await cliente.requisitar("https://exemplo.test/x");
    expect(chamadas).toHaveLength(2);
    expect(esperas).toEqual([5000]);
  });

  it("Retry-After em data HTTP: espera até a data pedida", async () => {
    const agora = Date.parse("2026-01-01T12:00:00Z");
    const { cliente, chamadas, esperas } = clienteFalso(
      [
        new Response("", { status: 503, headers: { "retry-after": "Thu, 01 Jan 2026 12:00:20 GMT" } }),
        respostaJson({}),
      ],
      { agora: () => agora },
    );
    await cliente.requisitar("https://exemplo.test/x");
    expect(chamadas).toHaveLength(2);
    expect(esperas).toEqual([20_000]);
  });

  it("Retry-After acima do teto: para e avisa, nunca tenta antes do pedido", async () => {
    const { cliente, chamadas, esperas } = clienteFalso([
      new Response("", { status: 429, headers: { "retry-after": "120" } }),
      respostaJson({}),
    ]);
    const e = await cliente.requisitar("https://exemplo.test/x").catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/120 s/);
    expect(chamadas).toHaveLength(1);
    expect(esperas).toEqual([]);
  });

  it("recusa dupla para e devolve mensagem clara, sem terceira tentativa", async () => {
    const { cliente, chamadas } = clienteFalso([new Response("", { status: 429 }), new Response("", { status: 503 })]);
    const e = await cliente.requisitar("https://exemplo.test/x").catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/recusou a chamada duas vezes/);
    expect(e.message).toMatch(/Espere alguns minutos/);
    expect(chamadas).toHaveLength(2);
  });

  it("403 / desafio anti-robô é recusa imediata, sem nova tentativa", async () => {
    const { cliente, chamadas } = clienteFalso([
      new Response("<html>challenge</html>", { status: 403, headers: { "cf-mitigated": "challenge" } }),
    ]);
    const e = await cliente.requisitar("https://exemplo.test/x").catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/não contorna/);
    expect(chamadas).toHaveLength(1);
  });

  it("503 com desafio anti-robô (cf-mitigated) é recusa imediata, sem esperar nem tentar de novo", async () => {
    const { cliente, chamadas, esperas } = clienteFalso([
      new Response("<html>challenge</html>", { status: 503, headers: { "cf-mitigated": "challenge" } }),
      respostaJson({ ok: true }),
    ]);
    const e = await cliente.requisitar("https://exemplo.test/x").catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/não contorna/);
    expect(chamadas).toHaveLength(1);
    expect(esperas).toEqual([]);
  });

  it("\"Excesso de requisições\" no corpo conta como recusa", async () => {
    const texto = () => new Response("Excesso de requisições", { status: 200, headers: { "content-type": "text/plain" } });
    const { cliente, chamadas } = clienteFalso([texto, texto]);
    await expect(cliente.requisitar("https://exemplo.test/x")).rejects.toBeInstanceOf(RecusaError);
    expect(chamadas).toHaveLength(2);
  });

  it("envia User-Agent honesto identificando o Garimpo", async () => {
    const { cliente, chamadas } = clienteFalso([respostaJson({})]);
    await cliente.requisitar("https://exemplo.test/x");
    expect(new Headers(chamadas[0].init.headers).get("User-Agent")).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^Garimpo\//);
  });

  it("nunca passa de 2 chamadas simultâneas", async () => {
    let ativas = 0;
    let pico = 0;
    const cliente = new Cliente({
      nome: "O site",
      fetch: (async () => {
        ativas++;
        pico = Math.max(pico, ativas);
        await new Promise((r) => setTimeout(r, 5));
        ativas--;
        return respostaJson({});
      }) as typeof fetch,
    });
    await Promise.all(Array.from({ length: 10 }, () => cliente.requisitar("https://exemplo.test/x").then((r) => r.text())));
    expect(pico).toBe(2);
  });

  it("o limite de 2 simultâneas é do processo inteiro: site e tribunais somados", async () => {
    let ativas = 0;
    let pico = 0;
    const fetchContado = (async () => {
      ativas++;
      pico = Math.max(pico, ativas);
      await new Promise((r) => setTimeout(r, 5));
      ativas--;
      return respostaJson({});
    }) as typeof fetch;
    const site = new Cliente({ nome: "O JurisprudênciaIA", fetch: fetchContado });
    const stj = new Cliente({ nome: "O STJ", fetch: fetchContado });
    const tse = new Cliente({ nome: "O TSE", fetch: fetchContado });
    await Promise.all(
      [site, stj, tse].flatMap((c) => Array.from({ length: 4 }, () => c.requisitar("https://exemplo.test/x").then((r) => r.text()))),
    );
    expect(pico).toBe(2);
  });

  it("depois de uma recusa, chamadas que já estavam na fila do mesmo serviço não saem", async () => {
    const recusa = () => new Response("", { status: 429 });
    const { cliente, chamadas } = clienteFalso([recusa, recusa, respostaJson({ depois: true })], { vagas: new Vagas(1) });
    const a = cliente.requisitar("https://exemplo.test/a").catch((x) => x);
    const b = cliente.requisitar("https://exemplo.test/b").catch((x) => x); // na fila atrás de "a"
    expect(await a).toBeInstanceOf(RecusaError);
    const eb = await b;
    expect(eb).toBeInstanceOf(RecusaError);
    expect(eb.message).toMatch(/não foi feita/);
    expect(chamadas.map((c) => c.url)).toEqual(["https://exemplo.test/a", "https://exemplo.test/a"]);

    // Chamada nova, pedida depois da recusa, é decisão de quem pediu: sai normalmente.
    expect(await (await cliente.requisitar("https://exemplo.test/c")).json()).toEqual({ depois: true });
  });

  it("a vaga só é liberada quando o corpo da resposta é lido ou cancelado", async () => {
    const { cliente, chamadas } = clienteFalso([respostaJson({ a: 1 }), respostaJson({ b: 2 }), respostaJson({ c: 3 })], {
      vagas: new Vagas(1),
    });
    const tique = () => new Promise((r) => setTimeout(r, 5));

    const a = await cliente.requisitar("https://exemplo.test/a");
    const b = cliente.requisitar("https://exemplo.test/b");
    await tique();
    expect(chamadas).toHaveLength(1); // corpo de "a" ainda não lido: "b" espera

    expect(await a.json()).toEqual({ a: 1 });
    const rb = await b;
    expect(chamadas).toHaveLength(2);

    const c = cliente.requisitar("https://exemplo.test/c");
    await tique();
    expect(chamadas).toHaveLength(2);
    await rb.body!.cancel();
    expect(await (await c).json()).toEqual({ c: 3 });
  });

  it("respeita intervalo mínimo entre chamadas ao mesmo host", async () => {
    let relogio = 1000;
    const esperas: number[] = [];
    const cliente = new Cliente({
      nome: "O TSE",
      vagas: new Vagas(2),
      intervaloMinimoPorHost: { "tse.test": 4000 },
      agora: () => relogio,
      esperar: async (ms) => {
        esperas.push(ms);
        relogio += ms;
      },
      fetch: (async () => respostaJson({})) as typeof fetch,
    });
    await cliente.requisitar("https://tse.test/a");
    relogio += 1000;
    await cliente.requisitar("https://tse.test/b");
    expect(esperas).toEqual([3000]);
  });

  it("intervalo mínimo por host vale também para chamadas concorrentes (cada uma reserva seu horário)", async () => {
    let relogio = 1000;
    const esperas: number[] = [];
    const cliente = new Cliente({
      nome: "O TSE",
      vagas: new Vagas(2),
      intervaloMinimoPorHost: { "tse.test": 4000 },
      agora: () => relogio,
      esperar: async (ms) => {
        esperas.push(ms);
        await new Promise((r) => setTimeout(r, 1));
      },
      fetch: (async () => respostaJson({})) as typeof fetch,
    });
    await cliente.requisitar("https://tse.test/a");
    relogio = 2000;
    // Duas chamadas juntas: a 1ª sai em 5000 (espera 3000); a 2ª só em 9000 (espera 7000), nunca junto.
    await Promise.all([
      cliente.requisitar("https://tse.test/b").then((r) => r.text()),
      cliente.requisitar("https://tse.test/c").then((r) => r.text()),
    ]);
    expect(esperas.sort((x, y) => x - y)).toEqual([3000, 7000]);
  });
});
