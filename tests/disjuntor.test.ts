import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buscaAmpla } from "../src/ampla.js";
import { Cliente, RecusaError, umaProvaPorFerramenta } from "../src/cliente.js";
import { CoordenacaoEmArquivo } from "../src/coordenacao.js";
import { respostaJson } from "./apoio.js";

/**
 * O disjuntor por serviço visto pelo cliente: duas janelas (dois clientes) com a coordenação real na MESMA pasta
 * de dados temporária e o mesmo relógio falso. A disputa entre processos reais está em janelas.test.ts.
 */

let pasta: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-disjuntor-"));
});
afterEach(() => rm(pasta, { recursive: true, force: true }));

const tique = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const MIN = 60_000;
/** 08/10/2026, 14:00, hora local: a pausa de 1 min termina às 14:01. */
const INICIO = new Date(2026, 9, 8, 14, 0, 0).getTime();

type Responder = (caminho: string) => Response | Promise<Response>;

/** Servidor falso: anota o caminho de cada chamada que chegou e responde conforme a regra. */
function servidor(responder: Responder) {
  const chegadas: string[] = [];
  const fetchFalso = (async (url: string) => {
    const caminho = new URL(url).pathname;
    chegadas.push(caminho);
    return responder(caminho);
  }) as typeof fetch;
  return { chegadas, fetchFalso };
}

/** Uma janela do Garimpo: cliente com a coordenação em arquivo na pasta comum; esperar avança o relógio comum. */
function janela(relogio: { agora: number }, fetchFalso: typeof fetch) {
  return new Cliente({
    nome: "O site",
    vagas: new CoordenacaoEmArquivo({ pasta, agora: () => relogio.agora }),
    agora: () => relogio.agora,
    esperar: async (ms) => {
      relogio.agora += ms;
      await tique(1);
    },
    fetch: fetchFalso,
  });
}

const erroDe = (p: Promise<Response>) => p.then(
  () => {
    throw new Error("a chamada deveria ter falhado");
  },
  (e: Error) => e,
);

describe("disjuntor compartilhado entre janelas", () => {
  it("429 isolado: as outras chamadas, também da outra janela, esperam a única nova tentativa e seguem quando ela é aceita", async () => {
    const relogio = { agora: INICIO };
    let soltarNovaTentativa!: (r: Response) => void;
    let vezesA = 0;
    const { chegadas, fetchFalso } = servidor((caminho) => {
      if (caminho !== "/a") return respostaJson({ ok: caminho });
      if (++vezesA === 1) return new Response("", { status: 429, headers: { "retry-after": "3" } });
      return new Promise<Response>((r) => (soltarNovaTentativa = r));
    });
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];

    const a = j1.requisitar("http://site.test/a");
    while (chegadas.length < 2) await tique(); // a nova tentativa saiu e está sem resposta
    const outras = [j2.requisitar("http://site.test/b"), j1.requisitar("http://site.test/c")].map((p) =>
      p.then((r) => r.json()),
    );
    await tique(200);
    expect(chegadas).toEqual(["/a", "/a"]);

    soltarNovaTentativa(respostaJson({ ok: "/a" }));
    expect(await (await a).json()).toEqual({ ok: "/a" });
    expect(await Promise.all(outras)).toEqual([{ ok: "/b" }, { ok: "/c" }]);
    expect([...chegadas].sort()).toEqual(["/a", "/a", "/b", "/c"]);
  });

  it("a dona da nova tentativa desiste antes de sair: as outras chamadas não ficam presas esperando por ela", async () => {
    const relogio = { agora: INICIO };
    const cancelar = new AbortController();
    const { chegadas, fetchFalso } = servidor((caminho) => {
      if (caminho !== "/a") return respostaJson({ ok: caminho });
      cancelar.abort(new Error("cancelada por quem pediu"));
      return new Response("", { status: 429, headers: { "retry-after": "3" } });
    });
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];

    expect((await erroDe(j1.requisitar("http://site.test/a", { signal: cancelar.signal }))).message).toBe(
      "cancelada por quem pediu",
    );
    expect(await (await j2.requisitar("http://site.test/b")).json()).toEqual({ ok: "/b" });
    expect(relogio.agora - INICIO).toBeLessThan(MIN); // sem os 3 min de espera por uma decisão que não viria
    expect(chegadas).toEqual(["/a", "/b"]);
  });

  it("recusa final numa janela pausa o serviço na outra: falha na hora, sem rede, com a hora de retorno; outro serviço segue", async () => {
    const relogio = { agora: INICIO };
    const presas: ((r: Response) => void)[] = [];
    const { chegadas, fetchFalso } = servidor((caminho) => {
      if (caminho === "/bloqueia") return new Response("", { status: 403 });
      if (caminho === "/lenta") return new Promise<Response>((r) => presas.push(r));
      return respostaJson({ ok: caminho });
    });
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];

    const e1 = await erroDe(j1.requisitar("http://site.test/bloqueia"));
    expect(e1).toBeInstanceOf(RecusaError);
    expect(e1.message).toMatch(/não contorna bloqueios/);
    expect(e1.message).toMatch(/pausadas em todas as janelas do Garimpo até 14:01/);

    // As 2 vagas ocupadas por chamadas lentas a outro serviço: a chamada ao serviço pausado falha mesmo assim, na hora.
    const lentas = [j2.requisitar("http://outro.test/lenta"), j2.requisitar("http://outro.test/lenta")];
    while (presas.length < 2) await tique();
    const e2 = await erroDe(j2.requisitar("http://site.test/x"));
    expect(e2).toBeInstanceOf(RecusaError);
    expect(e2.message).toMatch(/^Esta chamada não foi feita: as chamadas ao site estão pausadas .* até 14:01/);
    expect(e2.message).toMatch(/não contorna bloqueios/);
    expect(chegadas).toEqual(["/bloqueia", "/lenta", "/lenta"]);

    presas.forEach((soltar) => soltar(respostaJson({ ok: "/lenta" })));
    await Promise.all(lentas.map(async (p) => (await p).text()));
    expect(await (await j2.requisitar("http://outro.test/x")).json()).toEqual({ ok: "/x" });
  });

  it("o disjuntor é por serviço, pelo domínio: recusa do TSE não pausa o JurisprudênciaIA; a do STJ vale para todo endereço do STJ", async () => {
    const relogio = { agora: INICIO };
    const { chegadas, fetchFalso } = servidor((caminho) =>
      caminho.startsWith("/bloqueia") ? new Response("", { status: 403 }) : respostaJson({ ok: caminho }),
    );
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];

    await erroDe(j1.requisitar("https://sjur-servicos.tse.jus.br/bloqueia-tse"));
    expect(await (await j2.requisitar("https://www.jurisprudenciaia.com.br/api/b")).json()).toEqual({ ok: "/api/b" });
    await erroDe(j2.requisitar("https://processo.stj.jus.br/bloqueia-stj"));
    expect((await erroDe(j1.requisitar("https://ww2.stj.jus.br/d"))).message).toMatch(/não foi feita/);
    expect((await erroDe(j2.requisitar("https://sjur-servicos.tse.jus.br/e"))).message).toMatch(/não foi feita/);
    expect(await (await j1.requisitar("https://www.jurisprudenciaia.com.br/api/f")).json()).toEqual({ ok: "/api/f" });
    expect(chegadas).toEqual(["/bloqueia-tse", "/api/b", "/bloqueia-stj", "/api/f"]);
  });

  it("relógio falso comum: cada prova recusada reabre com a pausa dobrada, 1→2→4…→60 min, sem passar de 60", async () => {
    const relogio = { agora: INICIO };
    const { chegadas, fetchFalso } = servidor(() => new Response("", { status: 403 }));
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];
    await erroDe(j1.requisitar("http://site.test/primeira"));

    let abertaEm = INICIO;
    for (const minutos of [1, 2, 4, 8, 16, 32, 60, 60]) {
      relogio.agora = abertaEm + minutos * MIN - 1;
      expect((await erroDe(j2.requisitar("http://site.test/cedo"))).message).toMatch(/não foi feita/);
      relogio.agora = abertaEm + minutos * MIN;
      expect((await erroDe(j1.requisitar("http://site.test/prova"))).message).toMatch(/bloqueou a chamada/);
      abertaEm = relogio.agora;
    }
    expect(chegadas).toEqual(["/primeira", ...Array(8).fill("/prova")]);
  });

  it("Retry-After acima de 30 s vira pausa, sem nova tentativa; pedido acima de 60 min é respeitado", async () => {
    const relogio = { agora: INICIO };
    const pedidos = ["45", "7200"];
    const { chegadas, fetchFalso } = servidor((caminho) =>
      caminho === "/x" ? respostaJson({ ok: true }) : new Response("", { status: 429, headers: { "retry-after": pedidos.shift()! } }),
    );
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];

    const e = await erroDe(j1.requisitar("http://site.test/pede-45"));
    expect(e.message).toMatch(/pediu para esperar 45 s/);
    expect(chegadas).toEqual(["/pede-45"]); // nenhuma nova tentativa
    relogio.agora = INICIO + MIN - 1; // 45 s pedidos, mas a pausa mínima é 1 min
    expect((await erroDe(j2.requisitar("http://site.test/x"))).message).toMatch(/não foi feita/);

    relogio.agora = INICIO + MIN;
    await erroDe(j2.requisitar("http://site.test/pede-2h")); // a prova: 2 h pedidas, mais que a dobra de 2 min
    relogio.agora = INICIO + MIN + 120 * MIN - 1;
    expect((await erroDe(j1.requisitar("http://site.test/x"))).message).toMatch(/não foi feita/);
    relogio.agora = INICIO + MIN + 120 * MIN;
    expect(await (await j1.requisitar("http://site.test/x")).json()).toEqual({ ok: true });
    expect(chegadas).toEqual(["/pede-45", "/pede-2h", "/x"]);
  });

  it("resposta de chamada que saiu antes da abertura não fecha o disjuntor nem zera a dobra", async () => {
    const relogio = { agora: INICIO };
    let soltarLenta!: (r: Response) => void;
    const { chegadas, fetchFalso } = servidor((caminho) =>
      caminho === "/lenta" ? new Promise<Response>((r) => (soltarLenta = r)) : new Response("", { status: 403 }),
    );
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];

    const lenta = j1.requisitar("http://site.test/lenta");
    while (!chegadas.length) await tique();
    await erroDe(j2.requisitar("http://site.test/bloqueia")); // abre: 1 min
    soltarLenta(respostaJson({ ok: true }));
    expect(await (await lenta).json()).toEqual({ ok: true }); // a resposta chega a quem pediu...

    relogio.agora = INICIO + MIN / 2;
    expect((await erroDe(j1.requisitar("http://site.test/x"))).message).toMatch(/não foi feita/); // ...e não fecha
    relogio.agora = INICIO + MIN;
    await erroDe(j1.requisitar("http://site.test/prova")); // prova recusada: 2 min, porque a dobra não zerou
    relogio.agora = INICIO + 3 * MIN - 1;
    expect((await erroDe(j2.requisitar("http://site.test/x"))).message).toMatch(/não foi feita/);
    expect(chegadas).toEqual(["/lenta", "/bloqueia", "/prova"]);
  });

  /** Uma chamada lenta sai, outra janela recebe 403 e abre o disjuntor; a lenta ainda não respondeu. */
  async function lentaEAbertura(relogio: { agora: number }) {
    let soltarLenta!: (r: Response) => void;
    const { chegadas, fetchFalso } = servidor((caminho) => {
      if (caminho === "/lenta") return new Promise<Response>((r) => (soltarLenta = r));
      return caminho === "/bloqueia" ? new Response("", { status: 403 }) : respostaJson({ ok: caminho });
    });
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];
    const lenta = erroDe(j1.requisitar("http://site.test/lenta"));
    while (!chegadas.length) await tique();
    await erroDe(j2.requisitar("http://site.test/bloqueia")); // abre: 1 min
    return { chegadas, j1, j2, lenta, soltarLenta };
  }

  it("recusas da mesma pausa contam como uma abertura: a recusa atrasada de uma chamada anterior não dobra", async () => {
    const relogio = { agora: INICIO };
    const { j1, lenta, soltarLenta } = await lentaEAbertura(relogio);
    soltarLenta(new Response("", { status: 403 }));
    expect((await lenta).message).toMatch(/pausadas em todas as janelas do Garimpo até 14:01/);

    relogio.agora = INICIO + MIN;
    expect(await (await j1.requisitar("http://site.test/prova")).json()).toEqual({ ok: "/prova" });
  });

  it("recusa atrasada que chega depois de a prova fechar o disjuntor não o reabre", async () => {
    const relogio = { agora: INICIO };
    const { chegadas, j2, lenta, soltarLenta } = await lentaEAbertura(relogio);
    relogio.agora = INICIO + MIN;
    expect(await (await j2.requisitar("http://site.test/prova")).json()).toEqual({ ok: "/prova" }); // fecha

    soltarLenta(new Response("", { status: 403 }));
    expect(await lenta).toBeInstanceOf(RecusaError);
    expect(await (await j2.requisitar("http://site.test/x")).json()).toEqual({ ok: "/x" });
    expect(chegadas).toEqual(["/lenta", "/bloqueia", "/prova", "/x"]);
  });

  it("vencida a pausa, sai uma só chamada de prova; as outras esperam a decisão e seguem quando ela é aceita, com a dobra zerada", async () => {
    const relogio = { agora: INICIO };
    let soltarProva!: (r: Response) => void;
    const { chegadas, fetchFalso } = servidor((caminho) => {
      if (caminho === "/prova") return new Promise<Response>((r) => (soltarProva = r));
      return caminho === "/bloqueia" ? new Response("", { status: 403 }) : respostaJson({ ok: caminho });
    });
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];
    await erroDe(j1.requisitar("http://site.test/bloqueia"));

    relogio.agora = INICIO + MIN;
    const prova = j1.requisitar("http://site.test/prova");
    while (chegadas.length < 2) await tique();
    const outras = [j2.requisitar("http://site.test/b"), j1.requisitar("http://site.test/c")].map((p) =>
      p.then((r) => r.json()),
    );
    await tique(200);
    expect(chegadas).toEqual(["/bloqueia", "/prova"]);

    soltarProva(respostaJson({ ok: "/prova" }));
    expect(await (await prova).json()).toEqual({ ok: "/prova" });
    expect(await Promise.all(outras)).toEqual([{ ok: "/b" }, { ok: "/c" }]);

    // Dobra zerada: a próxima recusa final pausa 1 min de novo, não 2.
    const abertaEm = relogio.agora;
    await erroDe(j2.requisitar("http://site.test/bloqueia"));
    relogio.agora = abertaEm + MIN;
    expect(await (await j2.requisitar("http://site.test/d")).json()).toEqual({ ok: "/d" });
  });

  it("prova com erro sem recusa não conta como recusa: outra prova só depois de 5 s, e cada ferramenta faz no máximo uma", async () => {
    const relogio = { agora: INICIO };
    const { chegadas, fetchFalso } = servidor((caminho) => {
      if (caminho === "/quebra") return new Response("", { status: 500 });
      return caminho === "/bloqueia" ? new Response("", { status: 403 }) : respostaJson({ ok: caminho });
    });
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];
    await erroDe(j1.requisitar("http://site.test/bloqueia"));

    relogio.agora = INICIO + MIN;
    await umaProvaPorFerramenta(async () => {
      expect((await erroDe(j1.requisitar("http://site.test/quebra"))).message).toMatch(/erro HTTP 500/);
      expect((await erroDe(j1.requisitar("http://site.test/x"))).message).toMatch(/no máximo uma/);
    });
    expect(chegadas).toEqual(["/bloqueia", "/quebra"]);

    // Outra ferramenta: espera os 5 s e faz a nova prova. Recusada, a pausa é de 2 min: o erro não contou.
    const e = await erroDe(j2.requisitar("http://site.test/bloqueia"));
    expect(relogio.agora).toBe(INICIO + MIN + 5_000);
    expect(e.message).toMatch(/até 14:04/); // 14:01:05 + 2 min, arredondado para o minuto seguinte
    relogio.agora = INICIO + MIN + 5_000 + 2 * MIN - 1;
    expect((await erroDe(j1.requisitar("http://site.test/x"))).message).toMatch(/não foi feita/);
    expect(chegadas).toEqual(["/bloqueia", "/quebra", "/bloqueia"]);
  });

  it("busca ampla com o disjuntor aberto por outra janela: erro com o motivo, nunca lista vazia, e nenhuma chamada", async () => {
    const relogio = { agora: INICIO };
    const { chegadas, fetchFalso } = servidor(() => new Response("", { status: 403 }));
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];
    await erroDe(j1.requisitar("https://www.jurisprudenciaia.com.br/api/qualquer"));

    const e = await buscaAmpla(j2, { formulacoes: ["tese a", "tese b"], tribunais: ["stj"] }).then(
      () => new Error("a busca ampla deveria ter falhado"),
      (x: Error) => x,
    );
    expect(e.message).toMatch(/^Nenhuma das 2 buscas deu resposta/);
    expect(e.message).toMatch(/pausadas em todas as janelas do Garimpo até 14:01/);
    expect(chegadas).toHaveLength(1);
  });

  it("busca ampla com a pausa vencida faz uma só chamada de prova: se ela falha sem recusa, as outras buscas não provam", async () => {
    const relogio = { agora: INICIO };
    const { chegadas, fetchFalso } = servidor(() => new Response("", { status: chegadas.length === 1 ? 403 : 500 }));
    const [j1, j2] = [janela(relogio, fetchFalso), janela(relogio, fetchFalso)];
    await erroDe(j1.requisitar("https://www.jurisprudenciaia.com.br/api/qualquer"));

    relogio.agora = INICIO + MIN;
    const e = await buscaAmpla(j2, { formulacoes: ["tese a", "tese b", "tese c"], tribunais: ["stj"] }).then(
      () => new Error("a busca ampla deveria ter falhado"),
      (x: Error) => x,
    );
    expect(e.message).toMatch(/^Nenhuma das 3 buscas deu resposta/);
    expect(e.message).toMatch(/erro HTTP 500/);
    expect(e.message.match(/no máximo uma/g)).toHaveLength(2);
    expect(chegadas).toHaveLength(2); // a recusa e a única prova
  });

  it("busca ampla com recusa final no meio: as buscas pausadas entram \"com erro\" no cabeçalho", async () => {
    const relogio = { agora: INICIO };
    let n = 0;
    const { fetchFalso } = servidor(() =>
      n++ === 0
        ? respostaJson({ results: [{ id: "1", texto_ementa: "EMENTA FICTÍCIA. Tese a.", numero_processo: "1/UF" }] })
        : new Response("", { status: 403 }),
    );
    const r = await buscaAmpla(janela(relogio, fetchFalso), { formulacoes: ["tese a", "tese b", "tese c"], tribunais: ["stj"] });

    expect(r.completa).toBe(false);
    expect(r.avisos[0]).toMatch(/^BUSCA INCOMPLETA: 1 de 3 buscas/);
    const [stj] = r.cabecalhoDeCobertura.porTribunal;
    expect(stj).toMatchObject({ tribunal: "stj", buscasFeitas: 1 });
    expect(stj.comErro).toBeGreaterThan(0);
  });
});
