import { describe, expect, it } from "vitest";
import { buscaAmpla } from "../src/ampla.js";
import { acordaoNaMemoria, buscaDireta } from "../src/busca.js";
import { Cliente, RecusaError, Vagas } from "../src/cliente.js";
import { respostaJson } from "./apoio.js";

/** Acórdão fictício no formato do site. */
function bruto(id: string, rerank: number, ementa = `EMENTA FICTÍCIA ${id}.`) {
  return {
    id,
    texto_ementa: ementa,
    numero_processo: `${id}/UF`,
    orgao_julgador: "Turma Exemplo",
    data_julgamento: "2024-01-02T00:00:00.000Z",
    link_pdf: `https://exemplo.test/${id}`,
    rerank_score: rerank,
  };
}

/** Site falso: responde conforme tribunal e texto da busca; conta concorrência e chamadas. */
function siteFalso(responder: (tribunal: string, texto: string, n: number) => Response) {
  const estado = { chamadas: 0, ativas: 0, pico: 0 };
  const cliente = new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string, init: RequestInit) => {
      const n = estado.chamadas++;
      estado.ativas++;
      estado.pico = Math.max(estado.pico, estado.ativas);
      await new Promise((r) => setTimeout(r, 2));
      estado.ativas--;
      const tribunal = String(url).match(/tribunais\/(\w+)\/search/)![1];
      return responder(tribunal, JSON.parse(String(init.body)).query, n);
    }) as typeof fetch,
  });
  return { cliente, estado };
}

describe("busca ampla", () => {
  it("10 formulações × 2 tribunais: máx. 2 simultâneas, sem repetidos, com contagem de formulações", async () => {
    const formulacoes = Array.from({ length: 10 }, (_, i) => `formulação ${i}`);
    const { cliente, estado } = siteFalso((tribunal, texto) => {
      const i = Number(texto.split(" ")[1]);
      // "comum" aparece em todas; "par" só nas formulações pares; cada uma traz um exclusivo.
      const itens = [bruto("comum", 0.5), bruto(`so-${i}`, 0.9)];
      if (i % 2 === 0) itens.push(bruto("par", 0.4));
      return respostaJson({ results: itens.map((x) => ({ ...x, id: `${tribunal}-${x.id}` })) });
    });
    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj", "tjgo"] });

    expect(estado.chamadas).toBe(20);
    expect(estado.pico).toBeLessThanOrEqual(2);
    expect(r).toMatchObject({ buscasFeitas: 20, buscasPlanejadas: 20, completa: true, totalAcordaos: 24 });
    const ids = r.acordaos.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.acordaos.slice(0, 2).map((a) => [a.id, a.formulacoes])).toEqual([
      ["stj:stj-comum", 10],
      ["tjgo:tjgo-comum", 10],
    ]);
    expect(r.acordaos.find((a) => a.id === "stj:stj-par")?.formulacoes).toBe(5);
    expect(r.acordaos.find((a) => a.id === "tjgo:tjgo-so-3")?.formulacoes).toBe(1);
  });

  it("empate na contagem é desempatado pela relevância", async () => {
    const { cliente } = siteFalso((_t, texto) =>
      respostaJson({
        results: texto === "a" ? [bruto("fraco", 0.1), bruto("forte", 0.8)] : [bruto("fraco", 0.2), bruto("forte", 0.3)],
      }),
    );
    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b"], tribunais: ["stj"] });
    expect(r.acordaos.map((a) => [a.id, a.formulacoes])).toEqual([
      ["stj:forte", 2],
      ["stj:fraco", 2],
    ]);
  });

  it("recusa no meio: devolve o que já juntou, avisa que ficou incompleta e não faz novas buscas", async () => {
    const { cliente, estado } = siteFalso((_t, texto, n) =>
      n < 3 ? respostaJson({ results: [bruto(`r-${texto}`, 0.5)] }) : new Response("", { status: 429 }),
    );
    const formulacoes = Array.from({ length: 10 }, (_, i) => `f${i}`);
    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj"] });

    expect(r.completa).toBe(false);
    expect(r.buscasFeitas).toBe(3);
    expect(r.acordaos).toHaveLength(3);
    expect(r.avisos[0]).toMatch(/^BUSCA INCOMPLETA: 3 de 10 buscas/);
    expect(r.avisos[0]).toMatch(/recusou a chamada duas vezes/);
    // 3 que deram certo + no máximo 2 buscas em andamento, cada uma com 1 nova tentativa.
    expect(estado.chamadas).toBeLessThanOrEqual(7);
  });

  it("recusa vinda de outra operação: as buscas da ampla que estavam na fila não saem", async () => {
    let chamadas = 0;
    const cliente = new Cliente({
      nome: "O site",
      vagas: new Vagas(1),
      esperar: async () => {},
      fetch: (async () => {
        chamadas++;
        return new Response("", { status: 429 });
      }) as typeof fetch,
    });
    const direta = buscaDireta(cliente, { tribunal: "stj", texto: "outra operação" }).catch((x) => x);
    const ampla = buscaAmpla(cliente, { formulacoes: ["a", "b", "c"], tribunais: ["stj"] });

    expect(await direta).toBeInstanceOf(RecusaError);
    const r = await ampla;
    expect(r.completa).toBe(false);
    expect(r.buscasFeitas).toBe(0);
    expect(r.avisos[0]).toMatch(/^BUSCA INCOMPLETA: 0 de 3 buscas/);
    expect(chamadas).toBe(2); // só a busca direta e a nova tentativa dela
  });

  it("saída compacta cabe numa resposta; ementa inteira sai por id, sem nova busca", async () => {
    const ementaLonga = "X".repeat(4000);
    const { cliente, estado } = siteFalso((_t, texto) =>
      respostaJson({ results: Array.from({ length: 100 }, (_, i) => bruto(`${texto}-${i}`, 0.5, ementaLonga)) }),
    );
    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b", "c"], tribunais: ["stj"] });

    expect(r.totalAcordaos).toBe(300);
    expect(r.mostrados).toBe(50);
    expect(r.acordaos[0].trecho.length).toBeLessThanOrEqual(161);
    expect(JSON.stringify(r).length).toBeLessThan(25_000);

    const antes = estado.chamadas;
    expect(acordaoNaMemoria(r.acordaos[0].id)?.ementa).toBe(ementaLonga);
    expect(estado.chamadas).toBe(antes);
  });
});
