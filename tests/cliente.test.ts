import { readFileSync } from "node:fs";
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

  describe("corpo sem fim e prazo máximo", () => {
    const codificar = (t: string) => new TextEncoder().encode(t);
    /**
     * Resolve com "preso" se a promessa não terminar a tempo (sinal nítido em vez de estourar o teste). Folgado: com
     * a máquina carregada, 300 ms reais podiam vencer o prazo de 30 ms dos casos e com o corpo que chega aos poucos.
     */
    const preso = <T>(p: Promise<T>, ms = 5_000) =>
      Promise.race([p, new Promise<"preso">((r) => setTimeout(() => r("preso"), ms))]);

    it("sem Content-Length, corpo sem fim: só o começo é inspecionado e os bytes chegam inteiros a quem lê", async () => {
      const pedaco = (i: number) => String(i).padEnd(1000, ".");
      let n = 0;
      const semFim = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            // Um pedaço por volta do relógio, como na rede: o corpo nunca termina, mas o teste não trava.
            pull: async (c) => {
              await new Promise((r) => setTimeout(r, 0));
              c.enqueue(codificar(pedaco(n++)));
            },
          }),
          { headers: { "content-type": "text/plain" } },
        );
      const { cliente } = clienteFalso([semFim, respostaJson({ depois: true })], { vagas: new Vagas(1) });

      const r = await preso(cliente.requisitar("https://exemplo.test/a"));
      expect(r).toBeInstanceOf(Response);
      const leitor = (r as Response).body!.getReader();
      const lidos: Uint8Array[] = [];
      let total = 0;
      while (total < 4000) {
        const { value } = await leitor.read();
        lidos.push(value!);
        total += value!.length;
      }
      expect(Buffer.concat(lidos).toString().slice(0, 4000)).toBe([0, 1, 2, 3].map(pedaco).join(""));
      await leitor.cancel();
      expect(await (await cliente.requisitar("https://exemplo.test/b")).json()).toEqual({ depois: true });
    });

    it("corpo que nunca chega, sem Content-Length: o prazo derruba a chamada e devolve a vaga", async () => {
      const parado = () =>
        new Response(new ReadableStream<Uint8Array>({ pull() {} }), { headers: { "content-type": "text/plain" } });
      const { cliente } = clienteFalso([parado, respostaJson({ depois: true })], { vagas: new Vagas(1), prazoMs: 30 });

      const e = await preso(cliente.requisitar("https://exemplo.test/a").catch((x) => x));
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/não respondeu em/);
      expect(await (await cliente.requisitar("https://exemplo.test/b")).json()).toEqual({ depois: true });
    });

    it("fetch que nunca responde: o prazo aborta a chamada e devolve a vaga", async () => {
      const mudo = (_url: string, init: RequestInit) =>
        new Promise<Response>((_, rejeitar) => init.signal?.addEventListener("abort", () => rejeitar(init.signal!.reason)));
      const { cliente } = clienteFalso([mudo, respostaJson({ depois: true })], { vagas: new Vagas(1), prazoMs: 30 });

      const e = await preso(cliente.requisitar("https://exemplo.test/a").catch((x) => x));
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/não respondeu em/);
      expect(await (await cliente.requisitar("https://exemplo.test/b")).json()).toEqual({ depois: true });
    });

    it("corpo que trava no meio da leitura: o prazo derruba a leitura e devolve a vaga", async () => {
      const travado = () =>
        new Response(new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(codificar("%PDF-1.7")), pull() {} }), {
          headers: { "content-type": "application/pdf" },
        });
      const { cliente } = clienteFalso([travado, respostaJson({ depois: true })], { vagas: new Vagas(1), prazoMs: 30 });

      const r = await cliente.requisitar("https://exemplo.test/a");
      const e = await preso(r.arrayBuffer().catch((x) => x));
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/não respondeu em/);
      expect(await (await cliente.requisitar("https://exemplo.test/b")).json()).toEqual({ depois: true });
    });

    /** Corpo que nunca chega e cujo cancelamento nunca termina. */
    const corpoSurdo = (tipo: string) =>
      new Response(new ReadableStream<Uint8Array>({ pull() {}, cancel: () => new Promise<void>(() => {}) }), {
        headers: { "content-type": tipo },
      });

    it("prazo estourado com cancelamento que nunca termina: o fetch é abortado antes de a vaga voltar (nunca 3 abertos)", async () => {
      // Transporte aberto = fetch feito e ainda não abortado (abortar o fetch fecha a conexão no Node).
      const sinais: AbortSignal[] = [];
      let pico = 0;
      const cliente = new Cliente({
        nome: "O site",
        vagas: new Vagas(2),
        prazoMs: 30,
        fetch: (async (_url: string, init: RequestInit) => {
          sinais.push(init.signal!);
          pico = Math.max(pico, sinais.filter((s) => !s.aborted).length);
          return sinais.length <= 2 ? corpoSurdo("application/pdf") : respostaJson({ depois: true });
        }) as typeof fetch,
      });

      const a = await cliente.requisitar("https://exemplo.test/a");
      const b = await cliente.requisitar("https://exemplo.test/b");
      const leituras = [a, b].map((r) => r.arrayBuffer().catch((x) => x));
      const c = await preso(cliente.requisitar("https://exemplo.test/c"));
      expect(c).toBeInstanceOf(Response);
      expect(await (c as Response).json()).toEqual({ depois: true });
      expect(pico).toBe(2);
      for (const e of await Promise.all(leituras)) expect((e as Error).message).toMatch(/não respondeu em/);
    });

    it("cancelamento pelo chamador que nunca termina: o prazo continua valendo e devolve a vaga", async () => {
      const { cliente } = clienteFalso([() => corpoSurdo("application/pdf"), respostaJson({ depois: true })], {
        vagas: new Vagas(1),
        prazoMs: 30,
      });

      const a = await cliente.requisitar("https://exemplo.test/a");
      void a.body!.cancel();
      const b = await preso(cliente.requisitar("https://exemplo.test/b"));
      expect(b).toBeInstanceOf(Response);
      expect(await (b as Response).json()).toEqual({ depois: true });
    });

    it("resposta curta que ninguém lê: o prazo devolve a vaga", async () => {
      const { cliente } = clienteFalso([respostaJson({ esquecida: true }), respostaJson({ depois: true })], {
        vagas: new Vagas(1),
        prazoMs: 30,
      });

      await cliente.requisitar("https://exemplo.test/a"); // corpo nunca lido
      const b = await preso(cliente.requisitar("https://exemplo.test/b"));
      expect(b).toBeInstanceOf(Response);
      expect(await (b as Response).json()).toEqual({ depois: true });
    });

    it.each([
      ["403", 403, {}],
      ["503 com cf-mitigated", 503, { "cf-mitigated": "challenge" }],
      ["202 com x-amzn-waf-action", 202, { "x-amzn-waf-action": "challenge" }],
    ])("bloqueio (%s) com corpo travado: recusa decidida pelo status, sem ler o corpo, e propagada à fila", async (_n, status, extra) => {
      const bloqueio = () =>
        new Response(new ReadableStream<Uint8Array>({ pull() {} }), {
          status,
          headers: { "content-type": "text/html", ...extra },
        });
      const { cliente, chamadas } = clienteFalso([bloqueio, respostaJson({})], { vagas: new Vagas(1) });

      const a = cliente.requisitar("https://exemplo.test/a").catch((x) => x);
      const b = cliente.requisitar("https://exemplo.test/b").catch((x) => x); // na fila atrás de "a"
      const ea = await preso(a);
      expect(ea).toBeInstanceOf(RecusaError);
      expect((ea as Error).message).toMatch(/não contorna/);
      const eb = await preso(b);
      expect(eb).toBeInstanceOf(RecusaError);
      expect((eb as Error).message).toMatch(/não foi feita/);
      expect(chamadas).toHaveLength(1);
    });

    it("429 com corpo travado e cancelamento que nunca termina: decide pelo status e a nova tentativa sai", async () => {
      const recusa = () =>
        new Response(new ReadableStream<Uint8Array>({ pull() {}, cancel: () => new Promise<void>(() => {}) }), {
          status: 429,
          headers: { "content-type": "text/plain", "retry-after": "1" },
        });
      const { cliente, chamadas, esperas } = clienteFalso([recusa, respostaJson({ ok: true })]);

      const r = await preso(cliente.requisitar("https://exemplo.test/x"));
      expect(r).toBeInstanceOf(Response);
      expect(await (r as Response).json()).toEqual({ ok: true });
      expect(chamadas).toHaveLength(2);
      expect(esperas).toEqual([1000]);
    });
  });

  it("envia User-Agent honesto identificando o Garimpo", async () => {
    const { cliente, chamadas } = clienteFalso([respostaJson({})]);
    await cliente.requisitar("https://exemplo.test/x");
    expect(new Headers(chamadas[0].init.headers).get("User-Agent")).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^Garimpo\//);
  });

  /**
   * Servidor que segura cada chamada até o teste soltar, sem relógio: o teste espera haver 2 presas antes de soltar
   * uma. Com 50 ms reais por chamada, a máquina carregada demorava mais que isso para dar a 2ª vaga e o pico saía 1.
   */
  function servidorQueSegura() {
    const conta = { ativas: 0, pico: 0 };
    const presas: (() => void)[] = [];
    const fetchSegurado = (async () => {
      conta.ativas++;
      conta.pico = Math.max(conta.pico, conta.ativas);
      await new Promise<void>((r) => presas.push(r));
      conta.ativas--;
      return respostaJson({});
    }) as typeof fetch;
    const tique = () => new Promise((r) => setTimeout(r, 5));
    /** Solta as chamadas uma a uma, sempre com 2 presas ao mesmo tempo (ou as que faltam). */
    async function soltarUmaAUma(total: number) {
      for (let soltas = 0; soltas < total; soltas++) {
        while (presas.length < Math.min(2, total - soltas)) await tique();
        presas.shift()!();
      }
    }
    return { conta, fetchSegurado, soltarUmaAUma };
  }

  it("nunca passa de 2 chamadas simultâneas", async () => {
    const { conta, fetchSegurado, soltarUmaAUma } = servidorQueSegura();
    const cliente = new Cliente({ nome: "O site", fetch: fetchSegurado });
    const todas = Promise.all(
      Array.from({ length: 10 }, () => cliente.requisitar("https://exemplo.test/x").then((r) => r.text())),
    );
    await soltarUmaAUma(10);
    await todas;
    expect(conta.pico).toBe(2);
  });

  it("o limite de 2 simultâneas é do processo inteiro: site e tribunais somados", async () => {
    const { conta, fetchSegurado, soltarUmaAUma } = servidorQueSegura();
    const site = new Cliente({ nome: "O JurisprudênciaIA", fetch: fetchSegurado });
    const stj = new Cliente({ nome: "O STJ", fetch: fetchSegurado });
    const tse = new Cliente({ nome: "O TSE", fetch: fetchSegurado });
    const todas = Promise.all(
      [site, stj, tse].flatMap((c) => Array.from({ length: 4 }, () => c.requisitar("https://exemplo.test/x").then((r) => r.text()))),
    );
    await soltarUmaAUma(12);
    await todas;
    expect(conta.pico).toBe(2);
  });

  it("depois da recusa final, nenhuma chamada ao serviço sai até a pausa vencer: nem a da fila nem a nova", async () => {
    const relogio = { agora: 1_000 };
    const recusa = () => new Response("", { status: 429 });
    const { cliente, chamadas } = clienteFalso([recusa, recusa, respostaJson({ depois: true })], {
      vagas: new Vagas(1),
      agora: () => relogio.agora,
      esperar: async (ms) => {
        relogio.agora += ms;
      },
    });
    const a = cliente.requisitar("https://exemplo.test/a").catch((x) => x);
    const b = cliente.requisitar("https://exemplo.test/b").catch((x) => x); // na fila atrás de "a"
    expect(await a).toBeInstanceOf(RecusaError);
    const eb = await b;
    expect(eb).toBeInstanceOf(RecusaError);
    expect(eb.message).toMatch(/não foi feita/);
    expect(chamadas.map((c) => c.url)).toEqual(["https://exemplo.test/a", "https://exemplo.test/a"]);

    const ec = await cliente.requisitar("https://exemplo.test/c").catch((x) => x);
    expect(ec).toBeInstanceOf(RecusaError);
    expect(ec.message).toMatch(/pausadas/);
    expect(chamadas).toHaveLength(2);
  });

  it("no TSE, a espera antes da nova tentativa é de no mínimo 10 s, mesmo que ele peça menos", async () => {
    const { cliente, chamadas, esperas } = clienteFalso([
      new Response("", { status: 429, headers: { "retry-after": "3" } }),
      respostaJson({}),
    ]);
    await cliente.requisitar("https://sjur-servicos.tse.jus.br/x");
    expect(chamadas).toHaveLength(2);
    expect(esperas).toEqual([10_000]);
  });

  it("recusa que chega enquanto outra chamada espera a pausa do host: essa chamada não sai (2 vagas)", async () => {
    let responderA!: (r: Response) => void;
    let fimDaPausa!: () => void;
    const chamadas: string[] = [];
    const cliente = new Cliente({
      nome: "O TSE",
      vagas: new Vagas(2),
      intervaloMinimoPorHost: { "tse.test": 4000 },
      agora: () => 0,
      esperar: () => new Promise<void>((r) => (fimDaPausa = r)),
      fetch: (async (url: string) => {
        chamadas.push(url);
        return chamadas.length === 1 ? new Promise<Response>((r) => (responderA = r)) : respostaJson({});
      }) as typeof fetch,
    });
    const tique = () => new Promise((r) => setTimeout(r, 5));

    const a = cliente.requisitar("https://tse.test/a").catch((x) => x); // sai na hora
    const b = cliente.requisitar("https://tse.test/b").catch((x) => x); // tem vaga, mas espera a pausa
    await tique();
    expect(chamadas).toEqual(["https://tse.test/a"]);

    responderA(new Response("", { status: 403 }));
    expect(await a).toBeInstanceOf(RecusaError);
    fimDaPausa();
    const eb = await b;
    expect(eb).toBeInstanceOf(RecusaError);
    expect(eb.message).toMatch(/não foi feita/);
    expect(chamadas).toEqual(["https://tse.test/a"]);
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

  it("cancelar o corpo só devolve a vaga quando o cancelamento termina", async () => {
    let terminarCancel!: () => void;
    const corpoComCancelLento = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {},
          cancel: () => new Promise<void>((r) => (terminarCancel = r)),
        }),
      );
    const { cliente, chamadas } = clienteFalso([corpoComCancelLento, respostaJson({ b: 2 }), respostaJson({ c: 3 })]);
    const tique = () => new Promise((r) => setTimeout(r, 5));

    const a = await cliente.requisitar("https://exemplo.test/a");
    const b = await cliente.requisitar("https://exemplo.test/b");
    const c = cliente.requisitar("https://exemplo.test/c"); // 3ª: espera uma vaga
    const cancelando = a.body!.cancel();
    await tique();
    expect(chamadas).toHaveLength(2); // cancelamento de "a" ainda pendente: a vaga não voltou

    terminarCancel();
    await cancelando;
    expect(await (await c).json()).toEqual({ c: 3 });
    expect(chamadas).toHaveLength(3);
    await b.text();
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

  it("intervalo mínimo por host conta da saída efetiva: timers que acordam juntos não saem juntos", async () => {
    let relogio = 1000;
    const timers: { ate: number; acordar: () => void }[] = [];
    const saidas: number[] = [];
    const cliente = new Cliente({
      nome: "O TSE",
      vagas: new Vagas(2),
      intervaloMinimoPorHost: { "tse.test": 4000 },
      agora: () => relogio,
      esperar: (ms) => new Promise<void>((r) => timers.push({ ate: relogio + ms, acordar: r })),
      fetch: (async () => {
        saidas.push(relogio);
        return respostaJson({});
      }) as typeof fetch,
    });
    const tique = () => new Promise((r) => setTimeout(r, 5));

    await (await cliente.requisitar("https://tse.test/a")).text();
    relogio = 2000;
    const juntas = Promise.all(
      ["b", "c"].map((x) => cliente.requisitar(`https://tse.test/${x}`).then((r) => r.text())),
    );
    await tique();
    // O processo fica suspenso e volta em 20000: todos os timers já vencidos acordam juntos.
    relogio = 20000;
    timers.splice(0).forEach((t) => t.acordar());
    await tique();
    // Daí em diante, cada timer acorda na hora marcada.
    while (timers.length) {
      const t = timers.shift()!;
      relogio = Math.max(relogio, t.ate);
      t.acordar();
      await tique();
    }
    await juntas;
    expect(saidas).toEqual([1000, 20000, 24000]);
  });
});

describe("recusa reconhecida pela página da fonte (desafio com HTTP 200) e pelo erro do parser", () => {
  const desafio = (nome: string) => readFileSync(new URL(`./fixtures/desafios/${nome}`, import.meta.url));
  const pagina = (nome: string, tipo = "text/html; charset=utf-8") => () =>
    new Response(desafio(nome), { status: 200, headers: { "content-type": tipo } });
  /** Fonte que responde JSON (o JurisprudênciaIA): página HTML no lugar é envelope, não conteúdo. */
  const JSON_URL = "https://api.jurisprudenciaia.com.br/busca";

  it("página de verificação com 200 numa fonte JSON: recusa, sem nova tentativa, e o serviço fica pausado", async () => {
    const { cliente, chamadas, esperas } = clienteFalso([pagina("verificacao-de-seguranca.html"), respostaJson({})]);
    const e = await cliente.requisitar(JSON_URL).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/não contorna/);
    expect(e.message).toMatch(/pausadas em todas as janelas/);
    expect(esperas).toEqual([]);
    const depois = await cliente.requisitar(JSON_URL).catch((x) => x);
    expect(depois).toBeInstanceOf(RecusaError);
    expect(depois.message).toMatch(/não foi feita/);
    expect(chamadas).toHaveLength(1);
  });

  it("página de desafio em ISO-8859-1 (charset no cabeçalho) numa fonte JSON: recusa, sem acento corrompido", async () => {
    const { cliente } = clienteFalso([pagina("verificacao-de-seguranca-iso-8859-1.html", "text/html; charset=ISO-8859-1")]);
    const e = await cliente.requisitar(JSON_URL).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/verificação anti-robô/);
  });

  it("página de desafio em ISO-8859-1 declarada só no meta charset: recusa", async () => {
    const { cliente } = clienteFalso([pagina("verificacao-de-seguranca-iso-8859-1.html", "text/html")]);
    expect(await cliente.requisitar(JSON_URL).catch((x) => x)).toBeInstanceOf(RecusaError);
  });

  it("desafio application/xhtml+xml (Just a moment) numa fonte JSON: recusa", async () => {
    const { cliente } = clienteFalso([pagina("just-a-moment.xhtml", "application/xhtml+xml")]);
    const e = await cliente.requisitar(JSON_URL).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/verificação anti-robô/);
  });

  it("página bloqueada e carregador do desafio sem título, numa fonte JSON: recusa, cada uma com sua mensagem", async () => {
    const bloqueada = clienteFalso([pagina("pagina-bloqueada.html")]);
    const e1 = await bloqueada.cliente.requisitar(JSON_URL).catch((x) => x);
    expect(e1).toBeInstanceOf(RecusaError);
    expect(e1.message).toMatch(/página de acesso bloqueado \(HTTP 200\)/);
    const carregador = clienteFalso([pagina("carregador-tspd.html")]);
    const e2 = await carregador.cliente.requisitar(JSON_URL).catch((x) => x);
    expect(e2).toBeInstanceOf(RecusaError);
    expect(e2.message).toMatch(/página de verificação anti-robô \(HTTP 200\)/);
  });

  it("o mesmo texto de bloqueio DENTRO da ementa JSON não é recusa: a resposta chega inteira", async () => {
    const { cliente } = clienteFalso([pagina("ementa-com-texto-de-bloqueio.json", "application/json"), respostaJson({ ok: 1 })]);
    const r = await cliente.requisitar(JSON_URL);
    expect((await r.json()).resultados[0].ementa).toMatch(/ACESSO BLOQUEADO/);
    expect(await (await cliente.requisitar(JSON_URL)).json()).toEqual({ ok: 1 });
  });

  it("PDF com a palavra captcha não é recusa", async () => {
    const pdf = () =>
      new Response(new TextEncoder().encode("%PDF-1.4\n(Verificação de segurança e captcha no texto da decisão)\n%%EOF"), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    const { cliente } = clienteFalso([pdf]);
    const r = await cliente.requisitar("https://www.tjxx.jus.br/inteiro-teor/1.pdf");
    expect(new TextDecoder().decode(await r.arrayBuffer())).toMatch(/captcha/);
  });

  it("portal HTML com título de desafio: recusa e serviço pausado", async () => {
    const { cliente, chamadas } = clienteFalso([pagina("portal-com-titulo-de-desafio.html"), pagina("portal-com-ementa-de-bloqueio.html")]);
    const url = "https://www.tjxx.jus.br/acordao?id=1";
    const e = await cliente.requisitar(url).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/verificação anti-robô/);
    expect((await cliente.requisitar(url).catch((x) => x)).message).toMatch(/não foi feita/);
    expect(chamadas).toHaveLength(1);
  });

  it("portal HTML com texto de bloqueio só no conteúdo (título comum): não é recusa", async () => {
    const { cliente } = clienteFalso([pagina("portal-com-ementa-de-bloqueio.html")]);
    const r = await cliente.requisitar("https://www.tjxx.jus.br/acordao?id=1");
    expect(await r.text()).toMatch(/ACESSO BLOQUEADO/);
  });

  it("página HTML grande numa fonte JSON não é lida como desafio, e chega inteira a quem lê", async () => {
    const grande = `<html><head><title>Verificação de segurança</title></head><body>${"x".repeat(70_000)}</body></html>`;
    const { cliente } = clienteFalso([() => new Response(grande, { headers: { "content-type": "text/html" } })]);
    expect(await (await cliente.requisitar(JSON_URL)).text()).toBe(grande);
  });

  it("casca HTML com script do reCAPTCHA numa fonte JSON não é recusa (segue como formato inesperado)", async () => {
    const { cliente } = clienteFalso([pagina("casca-com-recaptcha.html")]);
    const r = await cliente.requisitar(JSON_URL);
    expect(await r.text()).toMatch(/recaptcha\/api\.js/);
  });

  it("título com entidades HTML (&ccedil;&atilde;) é reconhecido: recusa, numa fonte JSON e num portal HTML", async () => {
    const json = clienteFalso([pagina("titulo-com-entidades.html")]);
    expect(await json.cliente.requisitar(JSON_URL).catch((x) => x)).toBeInstanceOf(RecusaError);
    const html = clienteFalso([pagina("titulo-com-entidades.html")]);
    expect(await html.cliente.requisitar("https://www.tjxx.jus.br/acordao?id=1").catch((x) => x)).toBeInstanceOf(RecusaError);
  });

  it("entidade numérica (&#225;) em 'Página Bloqueada' é reconhecida como bloqueio", async () => {
    const { cliente } = clienteFalso([pagina("titulo-bloqueio-numerico.html")]);
    const e = await cliente.requisitar(JSON_URL).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/acesso bloqueado/);
  });

  it("<title> de um <svg> no corpo do portal não é o título da página: não é recusa", async () => {
    const { cliente } = clienteFalso([pagina("portal-com-svg-title.html")]);
    const r = await cliente.requisitar("https://www.tjxx.jus.br/acordao?id=1");
    expect(await r.text()).toMatch(/Resultado da consulta/);
  });

  it("título longo (ementa-título, mais de 80 caracteres) com a palavra captcha não é recusa", async () => {
    const { cliente } = clienteFalso([pagina("portal-com-titulo-longo.html")]);
    const r = await cliente.requisitar("https://www.tjxx.jus.br/acordao?id=1");
    expect(await r.text()).toMatch(/Conteúdo/);
  });

  /** Erro como o do fetch do Node 22: TypeError "fetch failed" com o erro de baixo nível em `cause`. */
  const falhaDoFetch = (code: string) => () => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error("falha de baixo nível"), { code }) });
  };

  it("erro de protocolo do parser HTTP (HPE_*): recusa do filtro, não queda de rede, e o serviço fica pausado", async () => {
    const { cliente, chamadas } = clienteFalso([falhaDoFetch("HPE_INVALID_HEADER_TOKEN"), respostaJson({})]);
    const e = await cliente.requisitar(JSON_URL).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/resposta corrompida/);
    expect(e.message).toMatch(/pausadas em todas as janelas/);
    expect((await cliente.requisitar(JSON_URL).catch((x) => x)).message).toMatch(/não foi feita/);
    expect(chamadas).toHaveLength(1);
  });

  it("ECONNRESET continua erro de rede comum: não é recusa e não pausa o serviço", async () => {
    const { cliente } = clienteFalso([falhaDoFetch("ECONNRESET"), respostaJson({ depois: true })]);
    const e = await cliente.requisitar(JSON_URL).catch((x) => x);
    expect(e).not.toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/Verifique a conexão/);
    expect(await (await cliente.requisitar(JSON_URL)).json()).toEqual({ depois: true });
  });

  it("a recusa pela página dobra a pausa como as outras: a prova recusada pausa 2 min", async () => {
    const relogio = { agora: 1_000_000 };
    const { cliente, chamadas } = clienteFalso(
      [pagina("verificacao-de-seguranca.html"), pagina("pagina-bloqueada.html"), respostaJson({ voltou: true })],
      { agora: () => relogio.agora },
    );
    expect(await cliente.requisitar(JSON_URL).catch((x) => x)).toBeInstanceOf(RecusaError);
    relogio.agora += 61_000; // venceu a 1ª pausa (1 min): sai a prova, que também é recusada
    const prova = await cliente.requisitar(JSON_URL).catch((x) => x);
    expect(prova.message).toMatch(/página de acesso bloqueado/);
    expect(chamadas).toHaveLength(2);
    relogio.agora += 61_000; // 1 min depois: a pausa agora é de 2 min, nada sai
    expect((await cliente.requisitar(JSON_URL).catch((x) => x)).message).toMatch(/não foi feita/);
    expect(chamadas).toHaveLength(2);
    relogio.agora += 60_000; // 2 min depois da prova recusada: sai a nova prova
    expect(await (await cliente.requisitar(JSON_URL)).json()).toEqual({ voltou: true });
    expect(chamadas).toHaveLength(3);
  });
});
