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

  it("acórdão achado por 1 formulação com todas as palavras dela vem antes do assunto largo achado por todas", async () => {
    const formulacoes = ["prescrição dano ambiental", "imprescritibilidade reparação ambiental", "prazo prescricional dano ambiental"];
    const largo = bruto("largo", 0.9, "REPARAÇÃO DO DANO AMBIENTAL. OBRIGAÇÃO DE RECOMPOR A ÁREA. EXEMPLO FICTÍCIO.");
    const exato = bruto("exato", 0.1, "IMPRESCRITIBILIDADE DA PRETENSÃO DE REPARAÇÃO DO DANO AMBIENTAL. EXEMPLO FICTÍCIO.");
    const { cliente } = siteFalso((_t, texto) => respostaJson({ results: texto === formulacoes[0] ? [largo, exato] : [largo] }));

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj"] });

    expect(r.acordaos.map((a) => [a.id, a.formulacoes])).toEqual([
      ["stj:exato", 1],
      ["stj:largo", 3],
    ]);
  });

  // Reescrito no ticket 09: a regra do ticket 02 ("por quantas formulações acharam, desempate pela relevância") mudou
  // de propósito. Agora vem primeiro a aderência, depois o nº de formulações e a melhor posição na busca de origem.
  // A nota do site não decide: a gravação do ticket 05 mostrou que o site só reranqueia os primeiros de cada busca
  // (rerank_score, de 0 a 1) e os demais vêm só com score, noutra escala; notas de buscas diferentes também não se
  // comparam. A posição na busca de origem já põe os reranqueados na frente.
  it("a nota do site não decide: reranqueado (0,9) fica à frente do não reranqueado (score 70) da mesma busca", async () => {
    const formulacoes = ["dano moral coletivo", "dano moral difuso"];
    const aderente = { ...bruto("aderente", 0.1, "DANO MORAL COLETIVO. EXEMPLO FICTÍCIO."), rerank_score: undefined, score: 20 };
    const naoReranqueado = { ...bruto("nao-reranqueado", 0), rerank_score: undefined, score: 70 };
    const { cliente } = siteFalso(() =>
      respostaJson({
        reranked_results: [{ id: "reranqueado", original_bucket: "results", rerank_score: 0.9 }],
        results: [naoReranqueado, aderente, { ...bruto("reranqueado", 0), rerank_score: undefined, score: 30 }],
      }),
    );

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj"] });

    expect(r.acordaos.map((a) => [a.id, a.formulacoes])).toEqual([
      ["stj:aderente", 2],
      ["stj:reranqueado", 2],
      ["stj:nao-reranqueado", 2],
    ]);
  });

  it("cópias do mesmo acórdão achadas por formulações diferentes viram um só, com as formulações somadas", async () => {
    const ementa = "EMENTA FICTÍCIA DO MESMO ACÓRDÃO EM DOIS REGISTROS.";
    const { cliente } = siteFalso((_t, texto) =>
      respostaJson({
        results:
          texto === "a"
            ? [{ ...bruto("copia-a", 0.5, `Ementa: ${ementa}`), numero_processo: null }]
            : [bruto("copia-b", 0.5, ementa)],
      }),
    );
    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b"], tribunais: ["stj"] });

    expect(r.totalAcordaos).toBe(1);
    expect(r.acordaos.map((a) => [a.id, a.numero, a.formulacoes])).toEqual([["stj:copia-b", "copia-b/UF", 2]]);
    expect(acordaoNaMemoria("stj:copia-a")?.numero).toBe("copia-b/UF");
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

  it("STF sem link_pdf: a saída compacta traz o link oficial de consulta (link_consulta / url_acordao)", async () => {
    const consulta = "https://portal.stf.jus.br/processos/detalhe.asp?incidente=1";
    const acordao = "https://portal.stf.jus.br/jurisprudencia/sjur-exemplo";
    const { cliente } = siteFalso(() =>
      respostaJson({
        juris: [
          { id: "201", sigla_classe: "RE", numero_processo: "200001", texto_ementa: "EMENTA FICTÍCIA.", link_pdf: null, link_consulta: consulta },
          { id: "202", sigla_classe: "RE", numero_processo: "200002", texto_ementa: "EMENTA FICTÍCIA.", link_pdf: null, url_acordao: acordao },
        ],
      }),
    );
    const r = await buscaAmpla(cliente, { formulacoes: ["exemplo"], tribunais: ["stf"] });
    expect(Object.fromEntries(r.acordaos.map((a) => [a.id, a.link]))).toEqual({ "stf:201": consulta, "stf:202": acordao });
  });

  it("saída compacta cabe numa resposta; ementa inteira sai por id, sem nova busca", async () => {
    const ementaLonga = "X".repeat(4000);
    // Ementa idêntica e números de processo diferentes: ninguém se junta. Os números diferem nos dígitos porque a
    // regra de equivalência (ticket 06) compara números só pelos dígitos ("a-0/UF" e "b-0/UF" seriam o mesmo).
    const formulacao = (texto: string) => ["a", "b", "c"].indexOf(texto);
    const { cliente, estado } = siteFalso((_t, texto) =>
      respostaJson({
        results: Array.from({ length: 100 }, (_, i) => ({
          ...bruto(`${texto}-${i}`, 0.5, ementaLonga),
          numero_processo: `${String(i).padStart(3, "0")}-${formulacao(texto)}/UF`,
        })),
      }),
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
