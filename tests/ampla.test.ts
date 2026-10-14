import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buscaAmpla } from "../src/ampla.js";
import { buscaDireta } from "../src/busca.js";
import { Cliente, ErroHttp, FormatoInesperadoError, PausaPreventivaError, RecusaError, Vagas } from "../src/cliente.js";
import { RedeParadaError } from "../src/coordenacao.js";
import { Memoria } from "../src/memoria.js";
import { respostaJson } from "./apoio.js";
import { documento, falcaoFalso, pagina } from "./apoioFalcao.js";

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
function siteFalso(
  responder: (tribunal: string, texto: string, n: number) => Response,
  /** Espera da n-ª chamada antes de responder (padrão 2 ms). */
  espera = (_n: number): Promise<unknown> => new Promise((r) => setTimeout(r, 2)),
) {
  const estado = { chamadas: 0, ativas: 0, pico: 0 };
  const cliente = new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string, init: RequestInit) => {
      const n = estado.chamadas++;
      estado.ativas++;
      estado.pico = Math.max(estado.pico, estado.ativas);
      await espera(n);
      estado.ativas--;
      const tribunal = String(url).match(/tribunais\/(\w+)\/search/)![1];
      return responder(tribunal, JSON.parse(String(init.body)).query, n);
    }) as typeof fetch,
  });
  return { cliente, estado };
}

// A tese no meio da ementa: o trecho sai do meio, com "…" nas duas pontas (o caso mais longo).
const FORMULACOES_REALISTAS = ["dano moral coletivo", "dano moral difuso", "dano moral transindividual"];

/**
 * Site falso com campos de tamanho realista: tudo fictício, mas com o tamanho dos campos reais: id longo, número CNJ
 * com sigla, órgão por extenso, link de ~95 caracteres, ementa longa; qualificados com tese longa, paradigma e link longo.
 */
function siteRealista(dataDo = (_i: number) => "2024-01-02T00:00:00.000Z") {
  const link = (i: number) => `https://jurisprudencia.tribunal-exemplo.invalid/consulta/inteiro-teor/documento?id=${String(i).padStart(10, "0")}`;
  const realista = (texto: string, i: number) => ({
    id: `${texto}${String(i).padStart(9, "0")}`,
    texto_ementa:
      `EMENTA: APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO ${texto}-${i}. ${"Texto fictício de ementa. ".repeat(75)}` +
      `DANO MORAL COLETIVO RECONHECIDO. ${"Texto fictício de ementa. ".repeat(75)}`,
    sigla_classe: "ApCiv",
    numero_processo: `50${String(i).padStart(5, "0")}-${texto.length}1.2024.8.21.0001`,
    orgao_julgador: "Décima Segunda Câmara Cível",
    data_julgamento: dataDo(i),
    link_pdf: link(i),
  });
  const tema = (i: number) => ({
    numero: 1000 + i,
    tese_firmada: "Tese fictícia de repercussão geral, longa como as reais. ".repeat(80),
    orgao_julgador: "Tribunal Pleno",
    numero_processo_paradigma: `RE ${1_000_000 + i}`,
    link: link(900 + i),
  });
  // Chaves curtas, como antes, para o id e o número não crescerem com o texto da formulação.
  const chave = (texto: string) => ["a", "bb", "ccc"][FORMULACOES_REALISTAS.indexOf(texto)];
  return siteFalso((tribunal, texto) =>
    respostaJson({
      results: Array.from({ length: 100 }, (_, i) => realista(`${tribunal}${chave(texto)}`, i)),
      rg: Array.from({ length: 30 }, (_, i) => tema(i)),
    }),
  );
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

  // A regra antiga ("por quantas formulações acharam, desempate pela relevância") mudou de propósito.
  // Agora vem primeiro a aderência, depois o nº de formulações e a melhor posição na busca de origem.
  // A nota do site não decide: a gravação de respostas reais mostrou que o site só reranqueia os primeiros de cada busca
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

  it("STF achado por 1 formulação ganha vagas reservadas ao lado de um tribunal grande achado por todas", async () => {
    const formulacoes = ["dano moral coletivo", "dano moral difuso", "dano moral transindividual"];
    const aderente = (id: string) => bruto(id, 0.5, `DANO MORAL COLETIVO. EXEMPLO FICTÍCIO ${id}.`);
    const { cliente } = siteFalso((tribunal, texto) =>
      respostaJson({
        results:
          tribunal === "tjgo"
            ? Array.from({ length: 100 }, (_, i) => aderente(`tj-${i}`))
            : texto === formulacoes[0]
              ? Array.from({ length: 4 }, (_, i) => aderente(`stf-${i}`))
              : [],
      }),
    );

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["tjgo", "stf"] });

    expect(r.mostrados).toBe(50);
    expect(r.acordaos).toHaveLength(50);
    expect(r.acordaos.filter((a) => a.tribunal === "stf").map((a) => a.id)).toEqual(["stf:stf-0", "stf:stf-1", "stf:stf-2"]);
    // A reserva não pula para o topo: os do STF ficam no fim, depois dos achados por mais formulações.
    expect(r.acordaos.slice(47).every((a) => a.tribunal === "stf")).toBe(true);
  });

  it("precedentes qualificados devolvidos pelas buscas saem numa seção própria, sem nenhuma chamada a mais", async () => {
    const tema = { numero: 900, tese_firmada: "Tese fictícia de repercussão geral.", link: "https://exemplo.test/tema-900" };
    const { cliente, estado } = siteFalso((tribunal, texto) =>
      respostaJson({
        juris: [bruto(`${tribunal}-${texto}`, 0.5)],
        ...(tribunal === "stf" ? { rg: texto === "c" ? [] : [tema] } : {}),
      }),
    );

    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b", "c"], tribunais: ["stf", "stj"] });

    expect(estado.chamadas).toBe(6); // 3 formulações × 2 tribunais, como antes
    expect(r.qualificados).toEqual([
      {
        tipo: "repercussão geral",
        numero: "900",
        texto: tema.tese_firmada,
        link: tema.link,
        enquadramento927: "não classificado: repercussão geral: enquadramento não verificado",
        tribunal: "stf",
        formulacoes: 2,
      },
    ]);
  });

  it("com campos de tamanho realista, 50 acórdãos + 10 qualificados cabem numa resposta (< 25 mil caracteres)", async () => {
    const { cliente } = siteRealista();

    const r = await buscaAmpla(cliente, { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj"] });

    expect(r.acordaos).toHaveLength(50);
    expect(r.qualificados).toHaveLength(10);
    expect(r.acordaos.every((a) => /^….*DANO MORAL COLETIVO RECONHECIDO\..*…$/.test(a.trecho))).toBe(true);
    // Decisão do dono (2026-10-08): enquadramento927 curto só nos qualificados; texto deles cortado em 120.
    expect(r.qualificados.every((q) => q.enquadramento927 === "não classificado: repercussão geral: enquadramento não verificado")).toBe(true);
    expect(r.qualificados.every((q) => q.texto.length <= 121)).toBe(true);
    // Mesmo formato da resposta da ferramenta (src/index.ts: JSON sem recuo).
    expect(JSON.stringify(r).length).toBeLessThan(25_000);
  });

  it("repetida da memória, com a marca de busca guardada em cada tribunal, continua < 25 mil caracteres", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-ampla-"));
    try {
      const memoria = new Memoria({ dados });
      const { cliente, estado } = siteRealista();
      const pedido = { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj"] };
      await buscaAmpla(cliente, pedido, memoria);
      const chamadas = estado.chamadas;

      const r = await buscaAmpla(cliente, pedido, memoria);

      expect(estado.chamadas).toBe(chamadas);
      expect(r.cabecalhoDeCobertura.porTribunal.every((t) => t.guardadas === 3 && t.maisAntiga)).toBe(true);
      expect(r.acordaos).toHaveLength(50);
      expect(r.qualificados).toHaveLength(10);
      expect(JSON.stringify(r).length).toBeLessThan(25_000);
    } finally {
      await rm(dados, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  it("com a memória falhando ao ler e ao gravar, os dois avisos cabem: continua < 25 mil caracteres", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-ampla-"));
    // A gravação que esbarra numa pasta no lugar do arquivo insiste por ~1 s de relógio (19 esperas de 50 ms) antes de
    // desistir: sob carga, essa espera real e a gravação de centenas de acórdãos estouravam o prazo. Aqui as esperas de
    // 50 ms da insistência passam a valer 0: a gravação falha igual, só sem esperar. O disco segue real.
    const setTimeoutReal = globalThis.setTimeout;
    const semEsperaDeInsistencia = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((f: () => void, ms?: number, ...resto: unknown[]) => setTimeoutReal(f, ms === 50 ? 0 : ms, ...resto)) as typeof setTimeout);
    /** A gravação corre por trás: espera a condição; o prazo só guarda contra travamento (o disco real é mais lento sob carga). */
    const esperar = async (pronto: () => Promise<boolean> | boolean) => {
      for (const prazo = Date.now() + 60_000; !(await pronto()); await new Promise((r) => setTimeoutReal(r, 20))) {
        if (Date.now() > prazo) throw new Error("a gravação da memória não terminou no prazo");
      }
    };
    try {
      const { cliente } = siteRealista();
      const pedido = { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj"] };
      await buscaAmpla(cliente, pedido, new Memoria({ dados }));
      // Cada busca guardada no disco vira uma pasta com o mesmo nome: ler e gravar nela falham.
      const buscas = join(dados, "memoria", "buscas-1");
      const guardadas = async () => (await readdir(buscas).catch(() => [])).filter((n) => n.endsWith(".json"));
      await esperar(async () => (await guardadas()).length === 6);
      for (const n of await guardadas()) {
        await rm(join(buscas, n));
        await mkdir(join(buscas, n));
      }
      // Outra janela: uma das buscas renovada antes falha ao gravar; as outras 5 falham ao ler na busca ampla.
      const memoria = new Memoria({ dados });
      await buscaDireta(cliente, { tribunal: "tjrs", texto: FORMULACOES_REALISTAS[0], limite: 100 }, memoria, { renovar: true });
      await esperar(() => memoria.avisoDeGravacao() !== undefined);

      const r = await buscaAmpla(cliente, pedido, memoria);

      expect(r.avisos).toContain("Memória do Garimpo falhou ao ler 5 de 6 buscas (tratadas como novas) e ao gravar.");
      expect(r.acordaos).toHaveLength(50);
      expect(r.qualificados).toHaveLength(10);
      expect(JSON.stringify(r).length).toBeLessThan(25_000);
    } finally {
      semEsperaDeInsistencia.mockRestore();
      await rm(dados, { recursive: true, force: true, maxRetries: 10 });
    }
  }, 60_000);

  it("com filtro local, repetida da memória e campos de tamanho realista, continua < 25 mil caracteres", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-ampla-"));
    try {
      const memoria = new Memoria({ dados });
      const { cliente } = siteRealista();
      const pedido = { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj"] };
      await buscaAmpla(cliente, pedido, memoria);

      // Exclusões de 3 dígitos nos dois tribunais, só de quem fica fora dos 50: a lista mostrada é a mesma da busca sem
      // filtro, e a diferença de tamanho é só a do filtro (cada ementa traz "tjrsa-57", "stjbb-63"...).
      const naoPodeConter = ["tjrs", "stj"].flatMap((t) =>
        ["a", "bb", "ccc"].flatMap((chave) => Array.from({ length: 50 }, (_, i) => `${t}${chave}-${50 + i}`)),
      );
      const r = await buscaAmpla(
        cliente,
        { ...pedido, deveConter: [["dano moral coletivo", "dano moral difuso"], ["apelação cível"]], naoPodeConter },
        memoria,
      );

      expect(r.cabecalhoDeCobertura.porTribunal.map((t) => [t.guardadas, t.excluidos])).toEqual([
        [3, 150],
        [3, 150],
      ]);
      expect(r.cabecalhoDeCobertura.listaCortada).toBe("mostrando 50 de 300; limite não é amostra (os primeiros por aderência, não um retrato do todo); peça maximo maior (até 200)");
      expect(r.acordaos).toHaveLength(50);
      expect(r.qualificados).toHaveLength(10);
      expect(JSON.stringify(r).length).toBeLessThan(25_000);
    } finally {
      await rm(dados, { recursive: true, force: true, maxRetries: 10 });
    }
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
    const memoria = new Memoria();
    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b"], tribunais: ["stj"] }, memoria);

    expect(r.totalAcordaos).toBe(1);
    expect(r.acordaos.map((a) => [a.id, a.numero, a.formulacoes])).toEqual([["stj:copia-b", "copia-b/UF", 2]]);
    expect((await memoria.obter("stj:copia-a"))?.acordao.numero).toBe("copia-b/UF");
  });

  it("a mesma gravação dá a mesma resposta em qualquer ordem de chegada, empates exatos inclusive", async () => {
    // Todos empatam em aderência, nº de formulações e melhor posição: só o desempate final decide.
    const formulacoes = ["tese exemplo", "exemplo tese"];
    const responder = (tribunal: string, texto: string) => {
      const f = formulacoes.indexOf(texto);
      return respostaJson({
        results: [
          bruto(`${tribunal}-${f}`, 0.5, `TESE EXEMPLO FICTÍCIA ${tribunal}-${f}.`),
          // Cópia do mesmo acórdão nas duas formulações (mesmo número, data e ementa), igualmente completas.
          { ...bruto(`${tribunal}-copia-${f}`, 0.5, `TESE EXEMPLO FICTÍCIA ${tribunal} COPIADA.`), numero_processo: "0001/UF" },
        ],
        // Um precedente qualificado por tribunal, cada um trazido por uma formulação só.
        rg: (tribunal === "stj") === (f === 1) ? [{ numero: tribunal === "stj" ? 1 : 2, tese_firmada: "Tese fictícia." }] : [],
      });
    };
    /** As chamadas (numeradas na ordem em que saem) respondem na ordem pedida, sem relógio: cada uma libera a próxima. */
    const rodar = async (ordem: number[]) => {
      const chegada: number[] = [];
      const liberar: (() => void)[] = [];
      const portoes = ordem.map((_, n) => new Promise<void>((r) => (liberar[n] = r)));
      const { cliente } = siteFalso(
        (tribunal, texto, n) => {
          chegada.push(n);
          liberar[ordem[chegada.length]]?.();
          return responder(tribunal, texto);
        },
        (n) => portoes[n],
      );
      liberar[ordem[0]]();
      return { r: await buscaAmpla(cliente, { formulacoes, tribunais: ["stj", "tjgo"] }), chegada };
    };

    const { r: naOrdem } = await rodar([0, 1, 2, 3]);
    // Duas filas: a primeira chamada responde por último; depois, a segunda responde depois da terceira.
    const primeira = await rodar([1, 2, 3, 0]);
    const segunda = await rodar([0, 2, 1, 3]);

    expect([primeira.chegada, segunda.chegada]).toEqual([
      [1, 2, 3, 0],
      [0, 2, 1, 3],
    ]);
    expect(naOrdem.acordaos.map((a) => a.id)).toEqual([
      "stj:stj-copia-0",
      "tjgo:tjgo-copia-0",
      "stj:stj-0",
      "stj:stj-1",
      "tjgo:tjgo-0",
      "tjgo:tjgo-1",
    ]);
    expect(naOrdem.qualificados.map((q) => q.tribunal)).toEqual(["stj", "tjgo"]);
    expect(primeira.r).toEqual(naOrdem);
    expect(segunda.r).toEqual(naOrdem);
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
    const ampla = buscaAmpla(cliente, { formulacoes: ["a", "b", "c"], tribunais: ["stj"] }).catch((x) => x);

    expect(await direta).toBeInstanceOf(RecusaError);
    // Nenhuma busca da ampla deu resposta: é erro com a recusa, nunca lista vazia (ADR-0001).
    expect((await ampla).message).toMatch(/^Nenhuma das 3 buscas deu resposta[\s\S]*Espere alguns minutos e tente de novo/);
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
    // regra de equivalência compara números só pelos dígitos ("a-0/UF" e "b-0/UF" seriam o mesmo).
    const formulacao = (texto: string) => ["a", "b", "c"].indexOf(texto);
    const { cliente, estado } = siteFalso((_t, texto) =>
      respostaJson({
        results: Array.from({ length: 100 }, (_, i) => ({
          ...bruto(`${texto}-${i}`, 0.5, ementaLonga),
          numero_processo: `${String(i).padStart(3, "0")}-${formulacao(texto)}/UF`,
        })),
      }),
    );
    const memoria = new Memoria();
    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b", "c"], tribunais: ["stj"] }, memoria);

    expect(r.totalAcordaos).toBe(300);
    expect(r.mostrados).toBe(50);
    expect(r.acordaos[0].trecho.length).toBeLessThanOrEqual(122);
    expect(JSON.stringify(r).length).toBeLessThan(25_000);

    const antes = estado.chamadas;
    expect((await memoria.obter(r.acordaos[0].id))?.acordao.ementa).toBe(ementaLonga);
    expect(estado.chamadas).toBe(antes);
  });
});

describe("busca ampla em ordem de data", () => {
  /** Quatro acórdãos: três com a tese inteira na ementa (um sem data) e um só com parte dela. */
  const site = () =>
    siteFalso(() =>
      respostaJson({
        results: [
          { ...bruto("recente", 0.5, "EMENTA FICTÍCIA. DANO MORAL COLETIVO."), data_julgamento: "2022-05-10T00:00:00.000Z" },
          { ...bruto("parcial", 0.5, "EMENTA FICTÍCIA. DANO."), data_julgamento: "2010-01-01T00:00:00.000Z" },
          { ...bruto("semdata", 0.5, "EMENTA FICTÍCIA. DANO MORAL COLETIVO."), data_julgamento: null },
          { ...bruto("antigo", 0.5, "EMENTA FICTÍCIA. DANO MORAL COLETIVO."), data_julgamento: "2019-03-04T00:00:00.000Z" },
        ],
      }),
    );
  const pedido = { formulacoes: ["dano moral coletivo"], tribunais: ["stj"], maximo: 3 };

  it("mesma lista nas duas ordens: o corte pelo máximo segue a aderência, a data só muda a apresentação", async () => {
    const { cliente, estado } = site();
    const porAderencia = await buscaAmpla(cliente, pedido);
    const chamadas = estado.chamadas;
    const porData = await buscaAmpla(cliente, { ...pedido, ordem: "data" });

    // O de menor aderência (e mais antigo) fica fora nas duas: a ordem por data não o traz de volta.
    expect(porAderencia.acordaos.map((a) => a.id).sort()).toEqual(["stj:antigo", "stj:recente", "stj:semdata"]);
    expect(porData.acordaos.map((a) => a.id)).toEqual(["stj:antigo", "stj:recente", "stj:semdata"]);
    expect(porData.cabecalhoDeCobertura).toEqual(porAderencia.cabecalhoDeCobertura);
    expect(porData.avisos).toContain("Ordem por data: 1 acórdão sem data foi para o fim da lista.");
    expect(porAderencia.avisos.some((a) => a.startsWith("Ordem por data"))).toBe(false);
    // Sem memória, a segunda faz as mesmas buscas: o parâmetro não acrescenta chamada.
    expect(estado.chamadas - chamadas).toBe(chamadas);
  });

  it("5 tribunais, repetida da memória e campos de tamanho realista: em ordem de data, o mesmo tamanho da ordem padrão", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-ampla-"));
    try {
      const memoria = new Memoria({ dados });
      // Datas que embaralham a ordem: a data não acompanha a posição na busca.
      const { cliente, estado } = siteRealista((i) => `20${String(10 + ((i * 7) % 15))}-0${1 + (i % 9)}-1${i % 10}T00:00:00.000Z`);
      const pedido = { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj", "tjsp", "tjmg", "tjpr"] };
      await buscaAmpla(cliente, pedido, memoria);
      const chamadas = estado.chamadas;

      const porAderencia = await buscaAmpla(cliente, pedido, memoria);
      const porData = await buscaAmpla(cliente, { ...pedido, ordem: "data" }, memoria);

      expect(estado.chamadas).toBe(chamadas);
      expect(porData.cabecalhoDeCobertura.porTribunal.every((t) => t.guardadas === 3)).toBe(true);
      expect(porData.acordaos.map((a) => a.id)).not.toEqual(porAderencia.acordaos.map((a) => a.id));
      expect(porData.acordaos.map((a) => a.id).sort()).toEqual(porAderencia.acordaos.map((a) => a.id).sort());
      const datas = porData.acordaos.map((a) => a.data!);
      expect(datas).toEqual([...datas].sort());
      // O parâmetro não acrescenta nada à resposta. Com 5 tribunais e estes campos, a ordem padrão já passa um pouco
      // dos 25 mil caracteres (25.458 em 2026-10-10, antes desta mudança): o teto é do conjunto, não desta ordem.
      expect(JSON.stringify(porData).length).toBe(JSON.stringify(porAderencia).length);
    } finally {
      await rm(dados, { recursive: true, force: true, maxRetries: 10 });
    }
  });
});

describe("trecho da busca ampla", () => {
  // Enchimento sem nenhuma palavra das formulações dos testes abaixo.
  const enchimento = (n: number) => "Texto de enchimento sem relação com a tese. ".repeat(n);
  const umAcordao = async (ementa: string, formulacoes: string[]) => {
    const { cliente } = siteFalso(() => respostaJson({ results: [bruto("unico", 0.5, ementa)] }));
    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj"] });
    return r.acordaos[0].trecho;
  };

  it("palavras da tese no meio da ementa: o trecho mostra o meio, com … nas pontas", async () => {
    // Um "dano" solto no começo não puxa a janela: ela vai para onde as palavras se concentram.
    const ementa = `EMENTA: DANO. ${enchimento(10)}PRESCRIÇÃO DA PRETENSÃO DE REPARAÇÃO DO DANO AMBIENTAL. ${enchimento(10)}`;

    const trecho = await umAcordao(ementa, ["prescrição dano ambiental"]);

    expect(trecho).toContain("PRESCRIÇÃO DA PRETENSÃO DE REPARAÇÃO DO DANO AMBIENTAL.");
    expect(trecho.startsWith("…")).toBe(true);
    expect(trecho.endsWith("…")).toBe(true);
    expect(trecho.length).toBeLessThanOrEqual(122);
  });

  it("acórdão achado por duas formulações: o trecho segue a de maior aderência", async () => {
    // A 1ª formulação tem só 1 de 3 palavras no começo; a 2ª tem todas no fim.
    const ementa = `RESPONSABILIDADE. ${enchimento(10)}DANO MORAL COLETIVO RECONHECIDO.`;
    const formulacoes = ["responsabilidade objetiva estado", "dano moral coletivo"];
    const { cliente } = siteFalso(() => respostaJson({ results: [bruto("unico", 0.5, ementa)] }));

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj"] });

    expect(r.acordaos[0].formulacoes).toBe(2);
    expect(r.acordaos[0].trecho).toMatch(/^….*DANO MORAL COLETIVO RECONHECIDO\.$/);
  });

  it("duas formulações com a mesma aderência: o trecho segue a primeira", async () => {
    const ementa = `${enchimento(5)}DANO MORAL COLETIVO. ${enchimento(10)}RESPONSABILIDADE OBJETIVA DO ESTADO. ${enchimento(5)}`;

    const trecho = await umAcordao(ementa, ["responsabilidade objetiva estado", "dano moral coletivo"]);

    expect(trecho).toContain("RESPONSABILIDADE OBJETIVA DO ESTADO.");
    expect(trecho).not.toContain("DANO");
  });

  it("ementa sem palavra da tese: o trecho é o começo da ementa, sem o rótulo", async () => {
    const trecho = await umAcordao(`EMENTA: APELAÇÃO CÍVEL. ${enchimento(10)}`, ["prescrição dano ambiental"]);

    expect(trecho).toMatch(/^APELAÇÃO CÍVEL\. Texto de enchimento/);
    expect(trecho.endsWith("…")).toBe(true);
  });

  it("palavra casada pelo radical (prescrição × imprescritível) entra no trecho", async () => {
    const trecho = await umAcordao(`${enchimento(10)}A PRETENSÃO É IMPRESCRITÍVEL. ${enchimento(10)}`, ["prescrição"]);

    expect(trecho).toContain("IMPRESCRITÍVEL");
    expect(trecho.startsWith("…")).toBe(true);
  });
  it("caractere de dois códigos (emoji) nas pontas não é cortado ao meio", async () => {
    for (const n of [57, 58, 59, 60]) {
      const trecho = await umAcordao(`${"😀".repeat(n)} DANO MORAL COLETIVO ${"😀".repeat(n)}`, ["dano moral coletivo"]);

      expect(trecho).toContain("DANO MORAL COLETIVO");
      expect(trecho).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });
});

describe("cabeçalho de cobertura da busca ampla", () => {
  // Resposta que o Garimpo não sabe ler: vira busca com erro.
  const formatoDesconhecido = () => respostaJson({ mensagem: "formato que o Garimpo não conhece" });

  it("dois tribunais, um só com buscas vazias e outro com acórdãos: contas certas por tribunal", async () => {
    const { cliente } = siteFalso((tribunal, texto) =>
      respostaJson({ results: tribunal === "stj" ? [bruto(`${texto}-1`, 0.5), bruto(`${texto}-2`, 0.5)] : [] }),
    );

    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b"], tribunais: ["stj", "tjgo"] });

    expect(r.cabecalhoDeCobertura.porTribunal).toEqual([
      { tribunal: "stj", buscasFeitas: 2, vazias: 0, comErro: 0, achados: 4, mostrados: 4 },
      { tribunal: "tjgo", buscasFeitas: 2, vazias: 2, comErro: 0, achados: 0, mostrados: 0 },
    ]);
    expect(r.cabecalhoDeCobertura.listaCortada).toBeUndefined();
  });

  it("tribunal com todas as buscas com erro aparece \"com erro\", não \"0 achados\"", async () => {
    const { cliente } = siteFalso((tribunal, texto) =>
      tribunal === "tjgo" ? formatoDesconhecido() : respostaJson({ results: [bruto(texto, 0.5)] }),
    );

    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b"], tribunais: ["stj", "tjgo"] });

    const tjgo = r.cabecalhoDeCobertura.porTribunal.find((t) => t.tribunal === "tjgo");
    expect(tjgo).toEqual({ tribunal: "tjgo", buscasFeitas: 0, vazias: 0, comErro: 2, situacao: "com erro", motivos: { "formato-inesperado": 2 } });
    expect(tjgo).not.toHaveProperty("achados");
    expect(r.cabecalhoDeCobertura.porTribunal.find((t) => t.tribunal === "stj")).toMatchObject({ comErro: 0, achados: 2 });
  });

  it("tribunal com parte das buscas com erro: conta as duas coisas e mostra os achados das que deram certo", async () => {
    const { cliente } = siteFalso((_t, texto) =>
      texto === "b" ? formatoDesconhecido() : respostaJson({ results: [bruto(texto, 0.5)] }),
    );

    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b", "c"], tribunais: ["stj"] });

    expect(r.cabecalhoDeCobertura.porTribunal).toEqual([{ tribunal: "stj", buscasFeitas: 2, vazias: 0, comErro: 1, motivos: { "formato-inesperado": 1 }, achados: 2, mostrados: 2 }]);
  });

  it("recusa antes de chegar a um tribunal: ele aparece \"não pesquisado\", nunca \"0 achados\"", async () => {
    // O STJ só responde depois da recusa do TJGO: nenhuma das duas filas chega a pegar o TJRS.
    let liberarStj!: () => void;
    const stjLiberado = new Promise<void>((r) => (liberarStj = r));
    let chamadasTjgo = 0;
    const cliente = new Cliente({
      nome: "O site",
      // Vagas em memória: a ordem de saída do teste não depende do tempo de disco da coordenação em arquivo.
      vagas: new Vagas(2),
      esperar: async () => {},
      fetch: (async (url: string) => {
        if (String(url).includes("/stj/")) {
          await stjLiberado;
          return respostaJson({ results: [bruto("stj-1", 0.5)] });
        }
        if (++chamadasTjgo === 2) setTimeout(liberarStj, 0);
        return new Response("", { status: 429 });
      }) as typeof fetch,
    });

    const r = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj", "tjgo", "tjrs"] });

    expect(r.cabecalhoDeCobertura.porTribunal).toEqual([
      { tribunal: "stj", buscasFeitas: 1, vazias: 0, comErro: 0, achados: 1, mostrados: 1 },
      { tribunal: "tjgo", buscasFeitas: 0, vazias: 0, comErro: 1, motivos: { recusa: 1 }, situacao: "com erro" },
      { tribunal: "tjrs", buscasFeitas: 0, vazias: 0, comErro: 0, naoFeitas: 1, motivos: { "nao-executada": 1 }, situacao: "não pesquisado" },
    ]);
  });

  it("recusa no meio de um tribunal: o cabeçalho conta as buscas que não chegaram a ser feitas", async () => {
    const { cliente } = siteFalso((_t, texto, n) => (n < 3 ? respostaJson({ results: [bruto(texto, 0.5)] }) : new Response("", { status: 429 })));
    const formulacoes = Array.from({ length: 10 }, (_, i) => `f${i}`);

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj"] });

    const [stj] = r.cabecalhoDeCobertura.porTribunal;
    expect(stj).toMatchObject({ buscasFeitas: 3, achados: 3 });
    expect(stj.comErro).toBeGreaterThan(0);
    expect(stj.buscasFeitas + stj.comErro + stj.naoFeitas!).toBe(10);
    expect(stj.naoFeitas).toBeGreaterThan(0);
  });

  it("formulação sem acórdão em nenhum tribunal é listada no cabeçalho", async () => {
    const formulacoes = ["dano moral coletivo", "palavras que não acham nada", "dano moral difuso"];
    const { cliente } = siteFalso((tribunal, texto) =>
      respostaJson({ results: texto === formulacoes[1] || (tribunal === "tjgo" && texto === formulacoes[2]) ? [] : [bruto(`${tribunal}-${texto}`, 0.5)] }),
    );

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj", "tjgo"] });

    expect(r.cabecalhoDeCobertura.formulacoesSemAcordao).toEqual(["palavras que não acham nada"]);
  });

  it("formulação cujas buscas só deram erro não é listada como \"sem acórdão\"", async () => {
    const { cliente } = siteFalso((_t, texto) =>
      texto === "b" ? formatoDesconhecido() : respostaJson({ results: [bruto(texto, 0.5)] }),
    );

    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b"], tribunais: ["stj"] });

    expect(r.cabecalhoDeCobertura.formulacoesSemAcordao).toEqual([]);
  });

  it("formulação vazia num tribunal e com erro no outro não é listada: no outro ela não foi verificada", async () => {
    const { cliente } = siteFalso((tribunal, texto) =>
      texto === "b" ? (tribunal === "stj" ? respostaJson({ results: [] }) : formatoDesconhecido()) : respostaJson({ results: [bruto(`${tribunal}-${texto}`, 0.5)] }),
    );

    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b"], tribunais: ["stj", "tjgo"] });

    expect(r.cabecalhoDeCobertura.formulacoesSemAcordao).toEqual([]);
  });

  it("mais achados que o máximo: avisa que a lista foi cortada, com X de Y e o máximo até 200", async () => {
    const { cliente } = siteFalso(() => respostaJson({ results: Array.from({ length: 12 }, (_, i) => bruto(`x-${i}`, 0.5)) }));

    const r = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj"], maximo: 5 });

    expect(r.cabecalhoDeCobertura.listaCortada).toBe("mostrando 5 de 12; limite não é amostra (os primeiros por aderência, não um retrato do todo); peça maximo maior (até 200)");
    expect(r.cabecalhoDeCobertura.porTribunal).toEqual([{ tribunal: "stj", buscasFeitas: 1, vazias: 0, comErro: 0, achados: 12, mostrados: 5 }]);
  });

  it("lista cortada já no máximo de 200: não manda pedir máximo maior", async () => {
    const { cliente } = siteFalso((_t, texto) =>
      respostaJson({ results: Array.from({ length: 100 }, (_, i) => ({ ...bruto(`${texto}-${i}`, 0.5), numero_processo: `${i}${texto.length}/UF` })) }),
    );

    const r = await buscaAmpla(cliente, { formulacoes: ["a", "bb", "ccc"], tribunais: ["stj"], maximo: 200 });

    // 200 itens não cabem em 25 mil caracteres: o corte é pelo teto da resposta, não por "peça maximo maior".
    expect(JSON.stringify(r).length).toBeLessThan(25_000);
    expect(r.cabecalhoDeCobertura.listaCortada).toMatch(new RegExp(`^mostrando ${r.mostrados} de 300; .*25 mil caracteres`));
    expect(r.cabecalhoDeCobertura.listaCortada).not.toMatch(/peça maximo maior/);
  });
});

describe("filtros locais da busca ampla (deveConter, naoPodeConter)", () => {
  const formulacoes = ["dano moral coletivo"];
  /** Acórdão fictício na faixa de cima de aderência, com uma palavra que os filtros dos testes procuram. */
  const comPalavra = (id: string, palavra: string) => bruto(id, 0.5, `DANO MORAL COLETIVO. ${palavra}. EXEMPLO FICTÍCIO ${id}.`);

  it("tira só quem descumpre, sem mudar a ordem dos que ficam; exclusão e lista cortada distintas no cabeçalho", async () => {
    const registros = [
      comPalavra("a", "CONSUMIDOR"),
      comPalavra("b", "TRIBUTÁRIO"),
      comPalavra("c", "CONSUMIDOR"),
      comPalavra("d", "AMBIENTAL"),
      comPalavra("e", "CONSUMIDOR"),
      comPalavra("f", "Consumidor tributário"),
      comPalavra("g", "CONSUMIDOR"),
    ];
    const { cliente } = siteFalso(() => respostaJson({ results: registros }));
    const sem = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj"] });

    const r = await buscaAmpla(cliente, {
      formulacoes,
      tribunais: ["stj"],
      maximo: 3,
      deveConter: [["consumidor", "ambiental"]],
      naoPodeConter: ["tributario"],
    });

    const sobreviventes = ["a", "c", "d", "e", "g"].map((x) => `stj:${x}`);
    expect(sem.acordaos.map((a) => a.id).filter((id) => sobreviventes.includes(id))).toEqual(sobreviventes);
    expect(r.acordaos.map((a) => a.id)).toEqual(sobreviventes.slice(0, 3));
    expect(r.totalAcordaos).toBe(7);
    expect(r.cabecalhoDeCobertura.porTribunal).toEqual([
      {
        tribunal: "stj",
        buscasFeitas: 1,
        vazias: 0,
        comErro: 0,
        achados: 7,
        excluidos: 2,
        mostrados: 3,
      },
    ]);
    // O que o filtro tirou não é lista cortada: o corte conta só os 5 que passaram.
    expect(r.cabecalhoDeCobertura.listaCortada).toBe("mostrando 3 de 5; limite não é amostra (os primeiros por aderência, não um retrato do todo); peça maximo maior (até 200)");
    expect(r.cabecalhoDeCobertura).not.toHaveProperty("filtroLocal");
  });

  it("a reserva por tribunal só vale entre os que passaram pelo filtro", async () => {
    const { cliente } = siteFalso((tribunal) =>
      respostaJson({
        results:
          tribunal === "tjgo"
            ? Array.from({ length: 10 }, (_, i) => bruto(`tj-${i}`, 0.5, "DANO MORAL COLETIVO. CONSUMIDOR. EXEMPLO FICTÍCIO."))
            : [comPalavra("stf-0", "TRIBUTÁRIO"), ...Array.from({ length: 4 }, (_, i) => comPalavra(`stf-${i + 1}`, "CONSUMIDOR"))],
      }),
    );

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["tjgo", "stf"], maximo: 6, naoPodeConter: ["tributário"] });

    expect(r.acordaos.filter((a) => a.tribunal === "stf").map((a) => a.id)).toEqual(["stf:stf-1", "stf:stf-2", "stf:stf-3"]);
  });
});

describe("filtros locais: sem ementa, lista vazia, falha total e precedentes qualificados", () => {
  const formulacoes = ["dano moral coletivo"];

  it("sem ementa, com só naoPodeConter ativo, sai e é contado à parte dos excluídos pelo filtro", async () => {
    const { cliente } = siteFalso(() =>
      respostaJson({
        results: [
          bruto("com", 0.5, "DANO MORAL COLETIVO. EXEMPLO FICTÍCIO."),
          { ...bruto("vazia", 0.5), texto_ementa: "" },
          { ...bruto("sem", 0.5), texto_ementa: null },
        ],
      }),
    );

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj"], naoPodeConter: ["tributário"] });

    expect(r.acordaos.map((a) => a.id)).toEqual(["stj:com"]);
    expect(r.cabecalhoDeCobertura.porTribunal[0]).toEqual({ tribunal: "stj", buscasFeitas: 1, vazias: 0, comErro: 0, achados: 3, excluidos: 0, semEmenta: 2, mostrados: 1 });
    expect(r.cabecalhoDeCobertura.listaCortada).toBeUndefined();
  });

  it("filtro que tira todos: resposta utilizável com lista vazia e o motivo, nunca erro", async () => {
    const { cliente } = siteFalso(() => respostaJson({ results: [bruto("a", 0.5, "DANO MORAL COLETIVO. EXEMPLO FICTÍCIO.")] }));

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stj"], deveConter: [["ambiental"]] });

    expect(r.acordaos).toEqual([]);
    expect(r.completa).toBe(true);
    expect(r.cabecalhoDeCobertura.filtroLocal).toBe(
      "Nenhum dos 1 acórdãos achados passou pelo filtro local (1 excluídos pelo filtro; 0 sem ementa para conferir): " +
        "a lista está vazia por causa do filtro, não por falta de acórdãos achados; afrouxe ou retire o filtro local.",
    );
  });

  it("falha total das buscas com filtro ativo continua sendo erro, nunca lista vazia (ADR-0001)", async () => {
    const { cliente } = siteFalso(() => respostaJson({ mensagem: "formato que o Garimpo não conhece" }));

    await expect(buscaAmpla(cliente, { formulacoes, tribunais: ["stj"], deveConter: [["ambiental"]] })).rejects.toThrow(
      /^Nenhuma das 1 buscas deu resposta/,
    );
  });

  it("precedentes qualificados não passam pelo filtro local e seguem na lista própria", async () => {
    const tema = { numero: 900, tese_firmada: "Tese fictícia sem a palavra exigida.", link: "https://exemplo.test/tema-900" };
    const { cliente } = siteFalso(() =>
      respostaJson({ juris: [bruto("a", 0.5, "DANO MORAL COLETIVO. EXEMPLO FICTÍCIO.")], rg: [tema] }),
    );

    const r = await buscaAmpla(cliente, { formulacoes, tribunais: ["stf"], deveConter: [["ambiental"]] });

    expect(r.acordaos).toEqual([]);
    expect(r.qualificados.map((q) => [q.tipo, q.numero])).toEqual([["repercussão geral", "900"]]);
  });
});

describe("motivo de falha por tribunal na busca ampla", () => {
  /** O tjsp falha como o teste manda; os demais tribunais respondem 1 acórdão (ou o que `outros` devolver). */
  function comFalhaNoTjsp(falha: (url: string) => Promise<Response>, prazoMs?: number) {
    return new (class extends Cliente {
      requisitar(url: string, init: RequestInit = {}): Promise<Response> {
        return url.includes("/tribunais/tjsp/") ? falha(url) : super.requisitar(url, init);
      }
    })({
      nome: "O site",
      esperar: async () => {},
      prazoMs,
      fetch: (async (url: string) => respostaJson({ results: [bruto(`ok-${String(url).length}`, 0.5)] })) as typeof fetch,
    });
  }
  const motivosDoTjsp = async (cliente: Cliente) => {
    const r = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj", "tjsp"] });
    const [stj, tjsp] = r.cabecalhoDeCobertura.porTribunal;
    expect(stj.motivos).toBeUndefined();
    return tjsp.motivos;
  };

  it("recusa do site: motivo recusa", async () => {
    const motivos = await motivosDoTjsp(comFalhaNoTjsp(() => Promise.reject(new RecusaError("O site recusou a chamada duas vezes.", 429))));
    expect(motivos).toEqual({ recusa: 1 });
  });

  it("chamada que nem saiu porque a pausa aberta por uma recusa ainda vale: motivo pausa (e a recusa que a abriu, recusa)", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-ampla-"));
    try {
      const memoria = new Memoria({ dados });
      const cliente = new Cliente({
        nome: "O site",
        vagas: new Vagas(2),
        esperar: async () => {},
        fetch: (async (url: string) =>
          String(url).includes("/tribunais/tjsp/") ? new Response("", { status: 429 }) : respostaJson({ results: [bruto("s", 0.5)] })) as typeof fetch,
      });
      await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj"] }, memoria); // o STJ fica guardado
      // A recusa que abre a pausa.
      const aberta = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj", "tjsp"] }, memoria);
      expect(aberta.cabecalhoDeCobertura.porTribunal[1].motivos).toEqual({ recusa: 1 });
      // Pausa aberta: a chamada ao TJSP nem sai.
      const pausada = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj", "tjsp"] }, memoria);
      expect(pausada.cabecalhoDeCobertura.porTribunal[1].motivos).toEqual({ pausa: 1 });
    } finally {
      await rm(dados, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  it("pausa preventiva do freio: motivo pausa", async () => {
    const motivos = await motivosDoTjsp(comFalhaNoTjsp(() => Promise.reject(new PausaPreventivaError("Pausa preventiva.", Date.now() + 60_000, 60))));
    expect(motivos).toEqual({ pausa: 1 });
  });

  it("estado de proteção ilegível: motivo rede-parada", async () => {
    const motivos = await motivosDoTjsp(comFalhaNoTjsp(() => Promise.reject(new RedeParadaError("Rede parada: estado ilegível."))));
    expect(motivos).toEqual({ "rede-parada": 1 });
  });

  it("formato que o Garimpo não reconhece: motivo formato-inesperado", async () => {
    const motivos = await motivosDoTjsp(comFalhaNoTjsp(() => Promise.reject(new FormatoInesperadoError("Formato inesperado."))));
    expect(motivos).toEqual({ "formato-inesperado": 1 });
  });

  it("prazo da chamada esgotado, de verdade, no cliente: motivo tempo-esgotado", async () => {
    const cliente = new (class extends Cliente {
      requisitar(url: string, init: RequestInit = {}): Promise<Response> {
        return super.requisitar(url, init);
      }
    })({
      nome: "O site",
      esperar: async () => {},
      prazoMs: 20,
      fetch: ((url: string, init: RequestInit) =>
        String(url).includes("/tribunais/tjsp/")
          ? new Promise<Response>((_, rejeitar) => init.signal!.addEventListener("abort", () => rejeitar(new Error("abortado"))))
          : Promise.resolve(respostaJson({ results: [bruto("ok", 0.5)] }))) as typeof fetch,
    });
    expect(await motivosDoTjsp(cliente)).toEqual({ "tempo-esgotado": 1 });
  });

  it("busca vazia nunca recebe motivo (vazio ≠ ausência), e sem falha o campo não existe", async () => {
    const cliente = comFalhaNoTjsp(async () => respostaJson({ results: [] }));
    const r = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj", "tjsp"] });
    const tjsp = r.cabecalhoDeCobertura.porTribunal[1];
    expect(tjsp.vazias).toBe(1);
    expect(tjsp.comErro).toBe(0);
    expect(tjsp.motivos).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("motivos");
  });

  it("rede que não chegou ao site (\"Não foi possível falar com…\") e erro HTTP 5xx: motivo erro-de-rede", async () => {
    const rede = comFalhaNoTjsp(() => Promise.reject(new Error("Não foi possível falar com O site (x). Verifique a conexão.")));
    expect(await motivosDoTjsp(rede)).toEqual({ "erro-de-rede": 1 });
    const http = comFalhaNoTjsp(() => Promise.reject(new ErroHttp("O site respondeu com erro HTTP 503 para u.", 503)));
    expect(await motivosDoTjsp(http)).toEqual({ "erro-de-rede": 1 });
  });

  it("chamada que o cliente nem fez (prova que falhou sem recusa, espera estourada): motivo pausa", async () => {
    const semProva = comFalhaNoTjsp(() => Promise.reject(new Error("Esta chamada não foi feita: a pausa venceu, mas esta ferramenta já fez a sua chamada de prova.")));
    expect(await motivosDoTjsp(semProva)).toEqual({ pausa: 1 });
    const espera = comFalhaNoTjsp(() => Promise.reject(new Error("Esta chamada não foi feita: a decisão não veio em 5 min. Tente mais tarde.")));
    expect(await motivosDoTjsp(espera)).toEqual({ pausa: 1 });
  });

  it("erro que não é de nenhum desses tipos (ex.: HTTP 404) não ganha motivo inventado; segue contado em comErro e no aviso", async () => {
    const cliente = comFalhaNoTjsp(() => Promise.reject(new ErroHttp("O site respondeu com erro HTTP 404 para u.", 404)));
    const r = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj", "tjsp"] });
    const tjsp = r.cabecalhoDeCobertura.porTribunal[1];
    expect(tjsp.comErro).toBe(1);
    expect(tjsp.motivos).toBeUndefined();
    expect(r.avisos.some((a) => /erro HTTP 404/.test(a))).toBe(true);
  });

  it("recusa que para a busca: o que ficou sem executar sai como nao-executada, junto da recusa", async () => {
    const cliente = new Cliente({
      nome: "O site",
      vagas: new Vagas(2),
      esperar: async () => {},
      fetch: (async (url: string) =>
        String(url).includes("/tribunais/stj/") ? respostaJson({ results: [bruto("x", 0.5)] }) : new Response("", { status: 429 })) as typeof fetch,
    });
    // Uma fila só para a ordem ser previsível: stj (3 buscas) ... o tjsp recebe a recusa e deixa as outras sem executar.
    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b", "c", "d", "e", "f"], tribunais: ["stj", "tjsp"] });
    const tjsp = r.cabecalhoDeCobertura.porTribunal[1];
    expect(tjsp.motivos?.recusa).toBeGreaterThanOrEqual(1);
    // Nenhuma das 6 buscas do TJSP deu resposta: todas têm motivo (a que levou a recusa, a que já achou a pausa
    // aberta e as que nem saíram da fila).
    expect(Object.values(tjsp.motivos!).reduce((soma, n) => soma + (n ?? 0), 0)).toBe(6);
    expect(tjsp.motivos?.["nao-executada"]).toBe(tjsp.naoFeitas);
    expect(Object.keys(tjsp.motivos!).every((m) => ["recusa", "pausa", "nao-executada"].includes(m))).toBe(true);
  });

  it("buscas além do teto de páginas do Falcão: nao-executada (nunca vazia); a que a pausa preventiva barrou: pausa", async () => {
    const porPedido = (url: URL) => {
      const trt = url.searchParams.get("tribunais")!;
      const texto = url.searchParams.get("texto")!;
      const n = [...`${trt}${texto}`].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9_000_000, 7) + 1_000_000;
      return pagina([documento({ tribunal: trt, idDocumentoAcordao: String(n), numeroProcesso: `0${n}-00.2024.5.01.0001`, ementa: `<p>${texto}.</p>` })]);
    };
    const doTeto = await buscaAmpla(siteFalso(() => respostaJson({ results: [] })).cliente, {
      formulacoes: ["horas extras", "jornada excessiva", "banco de horas"],
      tribunais: ["trt2", "trt15"],
    }, undefined, { falcao: falcaoFalso(porPedido).cliente });
    const [trt2, trt15] = doTeto.cabecalhoDeCobertura.porTribunal;
    expect(trt2.motivos).toBeUndefined();
    expect(trt15).toMatchObject({ foraDoTeto: 1, vazias: 0, motivos: { "nao-executada": 1 } });

    const pausado = await buscaAmpla(siteFalso(() => respostaJson({ results: [] })).cliente, {
      formulacoes: ["horas extras"],
      tribunais: ["trt1", "trt2", "trt3"],
    }, undefined, { falcao: falcaoFalso((url) => { const r = porPedido(url); r.headers.set("x-rate-limit-remaining", "10"); return r; }).cliente });
    const linhas = pausado.cabecalhoDeCobertura.porTribunal;
    const pausadas = linhas.reduce((s, l) => s + (l.pausaPreventiva ?? 0), 0);
    expect(pausadas).toBeGreaterThan(0);
    expect(linhas.reduce((s, l) => s + (l.motivos?.pausa ?? 0), 0)).toBe(pausadas);
    expect(linhas.every((l) => !l.pausaPreventiva || l.motivos?.pausa === l.pausaPreventiva)).toBe(true);
  });

  it("5 tribunais, 2 deles com falha, campos de tamanho realista: o motivo é curto e a resposta fica < 25 mil caracteres", async () => {
    const { cliente: base } = siteRealista();
    const cliente = new (class extends Cliente {
      requisitar(url: string, init: RequestInit = {}): Promise<Response> {
        if (url.includes("/tribunais/tjmg/")) return Promise.reject(new FormatoInesperadoError("Formato inesperado."));
        if (url.includes("/tribunais/tjpr/")) return Promise.reject(new RedeParadaError("Rede parada."));
        return base.requisitar(url, init);
      }
    })({ nome: "O site", esperar: async () => {} });
    const pedido = { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj", "tjsp", "tjmg", "tjpr"] };
    const r = await buscaAmpla(cliente, pedido);
    const linhas = r.cabecalhoDeCobertura.porTribunal;
    expect(linhas.filter((t) => t.motivos).map((t) => t.tribunal)).toEqual(["tjmg", "tjpr"]);
    const tamanhoDosMotivos = JSON.stringify(linhas.map((t) => t.motivos ?? null)).length;
    expect(tamanhoDosMotivos).toBeLessThan(120);
    // O campo novo é o único acréscimo: sem ele a resposta tem o mesmo tamanho de antes desta mudança.
    const semMotivos = { ...r, cabecalhoDeCobertura: { ...r.cabecalhoDeCobertura, porTribunal: linhas.map(({ motivos: _, ...resto }) => resto) } };
    expect(JSON.stringify(r).length - JSON.stringify(semMotivos).length).toBeLessThan(120);
  });

  it("5 tribunais, 3 com buscas guardadas e 2 com falhas de tipos diferentes: a resposta fica < 25 mil caracteres", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-ampla-"));
    try {
      const memoria = new Memoria({ dados });
      const { cliente: base } = siteRealista();
      await buscaAmpla(base, { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj", "tjsp"] }, memoria);
      const cliente = new (class extends Cliente {
        requisitar(url: string, init: RequestInit = {}): Promise<Response> {
          if (url.includes("/tribunais/tjmg/")) return Promise.reject(new Error("Não foi possível falar com O site (x). Verifique a conexão."));
          if (url.includes("/tribunais/tjpr/")) return Promise.reject(new ErroHttp("O site respondeu com erro HTTP 503 para u.", 503));
          return base.requisitar(url, init);
        }
      })({ nome: "O site", esperar: async () => {} });
      const r = await buscaAmpla(cliente, { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj", "tjsp", "tjmg", "tjpr"], maximo: 40 }, memoria);
      const linhas = r.cabecalhoDeCobertura.porTribunal;
      expect(linhas.filter((t) => t.guardadas).map((t) => t.tribunal)).toEqual(["tjrs", "stj", "tjsp"]);
      expect(linhas.filter((t) => t.motivos).map((t) => t.motivos)).toEqual([{ "erro-de-rede": 3 }, { "erro-de-rede": 3 }]);
      // Com o máximo padrão (50) de acórdãos de campos no tamanho máximo realista, 5 tribunais + 6 avisos passam de 25 mil.
      expect(JSON.stringify(r).length).toBeLessThan(25_000);
    } finally {
      await rm(dados, { recursive: true, force: true, maxRetries: 10 });
    }
  });
});

describe("estimativa antes de buscar e \"limite não é amostra\"", () => {
  const trib3 = ["stj", "tjsp", "tjrs"];
  const seis = ["a", "b", "c", "d", "e", "f"];
  const vazio = () => respostaJson({ results: [] });

  it("6 formulações × 3 tribunais: a estimativa diz até 18 chamadas, 2 por vez, 9 rodadas de ~3 s, e vem antes de tudo", async () => {
    const { cliente } = siteFalso(vazio);
    const r = await buscaAmpla(cliente, { formulacoes: seis, tribunais: trib3 });
    expect(r.estimativa).toMatch(/até 18 chamadas/);
    expect(r.estimativa).toContain("cerca de 27 s (pode passar: espera do site, 429/503, outras janelas)");
    expect(r.estimativa).not.toMatch(/até 27 s/);
    expect(r.estimativa).toMatch(/2 por vez/);
    expect(r.estimativa).toMatch(/guardada/);
    expect(Object.keys(r)[0]).toBe("estimativa");
  });

  it("busca pequena (até 6 chamadas) não leva estimativa", async () => {
    const { cliente } = siteFalso(vazio);
    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b", "c"], tribunais: ["stj", "tjsp"] });
    expect(r.estimativa).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("estimativa");
  });

  it("busca toda na memória não estima espera de rede; busca parcial conta só as chamadas novas", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-ampla-"));
    try {
      const memoria = new Memoria({ dados });
      const { cliente, estado } = siteFalso(vazio);
      await buscaAmpla(cliente, { formulacoes: seis, tribunais: ["stj", "tjsp"] }, memoria);
      const antes = estado.chamadas;
      const toda = await buscaAmpla(cliente, { formulacoes: seis, tribunais: ["stj", "tjsp"] }, memoria);
      expect(estado.chamadas).toBe(antes);
      expect(toda.estimativa).toBeUndefined();
      // Dois tribunais novos: só as 12 buscas deles vão ao site (as 12 do stj e do tjsp seguem na memória).
      const parcial = await buscaAmpla(cliente, { formulacoes: seis, tribunais: ["stj", "tjsp", "tjrs", "tjmg"] }, memoria);
      expect(parcial.estimativa).toMatch(/até 12 chamadas/);
      expect(parcial.estimativa).toMatch(/cerca de 18 s/);
    } finally {
      await rm(dados, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  it("TRT entra na conta pelas páginas que o teto do Falcão deixa executar (5 de 6): 6 + 5 = 11 chamadas, 18 s", async () => {
    const { cliente } = siteFalso(vazio);
    const porPedido = () => pagina([documento({ tribunal: "trt2", idDocumentoAcordao: "1", numeroProcesso: "0000001-00.2024.5.02.0001", ementa: "<p>x.</p>" })]);
    const r = await buscaAmpla(cliente, { formulacoes: seis, tribunais: ["stj", "trt2"] }, undefined, { falcao: falcaoFalso(porPedido).cliente });
    expect(r.estimativa).toMatch(/até 11 chamadas/);
    expect(r.estimativa).toMatch(/cerca de 18 s/);
  });

  it("com a estimativa e a lista cortada, campos de tamanho realista, 9 buscas e 40 acórdãos: continua < 25 mil caracteres", async () => {
    const { cliente } = siteRealista();
    const r = await buscaAmpla(cliente, { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj", "tjsp"], maximo: 40 });
    expect(r.estimativa).toMatch(/até 9 chamadas/);
    expect(r.cabecalhoDeCobertura.listaCortada).toMatch(/limite não é amostra/);
    expect(JSON.stringify(r).length).toBeLessThan(25_000);
  });

  it("lista cortada leva a frase fixa \"limite não é amostra\"; lista inteira, não", async () => {
    const muitos = (tribunal: string, texto: string) =>
      respostaJson({ results: Array.from({ length: 12 }, (_, i) => bruto(`${tribunal}${texto}${i}`, 0.5)) });
    const { cliente } = siteFalso(muitos);
    const cortada = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj"], maximo: 5 });
    expect(cortada.cabecalhoDeCobertura.listaCortada).toMatch(/limite não é amostra/);
    const inteira = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj"], maximo: 50 });
    expect(inteira.cabecalhoDeCobertura.listaCortada).toBeUndefined();
    expect(JSON.stringify(inteira)).not.toMatch(/não é amostra/i);
  });
});

describe("ressalva da grafia na busca ampla (relator ou órgão com poucos achados)", () => {
  const site = (n: number) => siteFalso((_t, texto) => respostaJson({ results: Array.from({ length: n }, (_, i) => bruto(`${texto}${i}`, 0.9 - i / 100)) }));

  it("relator e até 3 acórdãos achados: uma linha no cabeçalho, sem dizer que não existe julgado", async () => {
    const r = await buscaAmpla(site(2).cliente, { formulacoes: ["a"], tribunais: ["stj"], relator: "Fulano" });
    const linha = r.cabecalhoDeCobertura.ressalvaDaGrafia;
    expect(linha).toMatch(/Com filtro de relator, pode ser a grafia/);
    expect(linha).toMatch(/repita sem o filtro/);
    expect(linha).not.toMatch(/não existe|nunca julgou|nunca decidiu/i);
    const o = await buscaAmpla(site(0).cliente, { formulacoes: ["a"], tribunais: ["stj"], relator: "Fulano", orgao: "Segunda Turma" });
    expect(o.cabecalhoDeCobertura.ressalvaDaGrafia).toMatch(/relator e órgão/);
  });

  it("mais de 3 achados, ou sem filtro de relator e órgão: o cabeçalho não leva a linha", async () => {
    const quatro = await buscaAmpla(site(4).cliente, { formulacoes: ["a"], tribunais: ["stj"], relator: "Fulano" });
    expect(quatro.cabecalhoDeCobertura).not.toHaveProperty("ressalvaDaGrafia");
    const semFiltro = await buscaAmpla(site(2).cliente, { formulacoes: ["a"], tribunais: ["stj"] });
    expect(semFiltro.cabecalhoDeCobertura).not.toHaveProperty("ressalvaDaGrafia");
  });
});

describe("campos que o site não mandou (faltam) na busca ampla", () => {
  it("só o acórdão incompleto leva faltam; o completo sai sem o campo", async () => {
    const { cliente } = siteFalso((_t, texto) => {
      const { orgao_julgador: _o, link_pdf: _l, ...incompleto } = bruto(`inc-${texto}`, 0.9);
      return respostaJson({ results: [incompleto, bruto(`ok-${texto}`, 0.5)] });
    });
    const r = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj"] });
    const inc = r.acordaos.find((a) => a.id.includes("inc-"))!;
    const ok = r.acordaos.find((a) => a.id.includes("ok-"))!;
    expect(inc.faltam).toEqual(["orgao", "link"]);
    expect(ok).not.toHaveProperty("faltam");
  });

  it("a memória guarda o acórdão sem faltam (como o obter_ementa): a marca vale só na montagem do item", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-ampla-"));
    try {
      const memoria = new Memoria({ dados });
      const { cliente } = siteFalso((_t, texto) => {
        const { orgao_julgador: _o, link_pdf: _l, ...incompleto } = bruto(`inc-${texto}`, 0.9);
        return respostaJson({ results: [incompleto] });
      });
      const r = await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["stj"] }, memoria);
      expect(r.acordaos[0].faltam).toEqual(["orgao", "link"]);
      const guardado = await memoria.obter(r.acordaos[0].id);
      expect(guardado).toBeDefined();
      expect(guardado!.acordao).not.toHaveProperty("faltam");
    } finally {
      await rm(dados, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  it("50 acórdãos sem órgão e sem link, campos realistas, com a estimativa e a lista cortada: < 25 mil caracteres", async () => {
    const { cliente: base } = siteRealista();
    const cliente = new (class extends Cliente {
      async requisitar(url: string, init: RequestInit = {}): Promise<Response> {
        const corpo = (await (await base.requisitar(url, init)).json()) as { results: Record<string, unknown>[] };
        for (const x of corpo.results) {
          delete x.orgao_julgador;
          delete x.link_pdf;
        }
        return respostaJson(corpo);
      }
    })({ nome: "O site", esperar: async () => {} });
    const r = await buscaAmpla(cliente, { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj", "tjsp"] });
    expect(r.acordaos).toHaveLength(50);
    expect(r.acordaos.every((a) => a.faltam?.join() === "orgao,link")).toBe(true);
    expect(r.estimativa).toMatch(/até 9 chamadas/);
    expect(r.cabecalhoDeCobertura.listaCortada).toMatch(/limite não é amostra/);
    expect(JSON.stringify(r).length).toBeLessThan(25_000);
  });
});

describe("correções da revisão: junção entre formulações, teto de tamanho e ressalva da grafia", () => {
  it("TRT: cópia sem texto numa formulação e com texto noutra: o item mostrado é o de texto real", async () => {
    const ementa = "<p>INTERVALO INTRAJORNADA. Texto ficticio de ementa.</p>";
    const comum = { numeroProcesso: "0000701-00.2024.5.03.0001", ementa, tribunal: "trt3" };
    const falcao = falcaoFalso((url) =>
      url.searchParams.get("texto") === "primeira"
        ? pagina([documento({ ...comum, idDocumentoAcordao: "50000021", textoAcordao: ementa })])
        : pagina([
            documento({ ...comum, idDocumentoAcordao: "50000022", textoAcordao: "<p>RECORRENTE: PARTE FICTICIA A. Acórdão inteiro fictício, bem maior que a ementa.</p>" }),
          ]),
    );
    const { cliente } = siteFalso(() => respostaJson({ results: [] }));
    const r = await buscaAmpla(cliente, { formulacoes: ["primeira", "segunda"], tribunais: ["trt3"] }, undefined, { falcao: falcao.cliente });
    expect(r.acordaos.map((a) => [a.id, a.formulacoes])).toEqual([["trt3:50000022", 2]]);
  });

  it("5 tribunais × 3 formulações, 2 com falhas, maximo padrão (50): a resposta inteira cabe em 25 mil caracteres e diz o corte", async () => {
    const { cliente: base } = siteRealista();
    const cliente = new (class extends Cliente {
      requisitar(url: string, init: RequestInit = {}): Promise<Response> {
        if (url.includes("/tribunais/tjmg/")) return Promise.reject(new Error("Não foi possível falar com O site (x). Verifique a conexão."));
        if (url.includes("/tribunais/tjpr/")) return Promise.reject(new ErroHttp("O site respondeu com erro HTTP 503 para u.", 503));
        return base.requisitar(url, init);
      }
    })({ nome: "O site", esperar: async () => {} });
    const r = await buscaAmpla(cliente, { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj", "tjsp", "tjmg", "tjpr"] });
    expect(JSON.stringify(r).length).toBeLessThan(25_000);
    expect(r.acordaos.length).toBe(r.mostrados);
    expect(r.acordaos.length).toBeGreaterThan(0);
  });

  it("maximo 200 com 5 tribunais e falhas: continua < 25 mil, com o corte e como pedir o resto", async () => {
    const { cliente: base } = siteRealista();
    const cliente = new (class extends Cliente {
      requisitar(url: string, init: RequestInit = {}): Promise<Response> {
        if (url.includes("/tribunais/tjmg/")) return Promise.reject(new Error("Não foi possível falar com O site (x). Verifique a conexão."));
        return base.requisitar(url, init);
      }
    })({ nome: "O site", esperar: async () => {} });
    const r = await buscaAmpla(cliente, { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj", "tjsp", "tjmg", "tjpr"], maximo: 200 });
    expect(JSON.stringify(r).length).toBeLessThan(25_000);
    expect(r.acordaos.length).toBe(r.mostrados);
    expect(r.cabecalhoDeCobertura.listaCortada).toMatch(/25 mil caracteres/);
    expect(r.cabecalhoDeCobertura.listaCortada).toMatch(/tribunais|formulações/);
    const somaPorTribunal = r.cabecalhoDeCobertura.porTribunal.reduce((s, l) => s + (l.mostrados ?? 0), 0);
    expect(somaPorTribunal).toBe(r.acordaos.length);
  });

  it("maximo 200 no pior caso: ordem \"data\" mostra o mesmo conjunto de acórdãos da ordem padrão, mesmo com o corte por tamanho", async () => {
    // Datas decrescentes com o índice: os de maior aderência (índice baixo) são os mais recentes.
    const { cliente } = siteRealista((i) => `${2000 + (99 - i)}-03-04T00:00:00.000Z`);
    const pedido = { formulacoes: FORMULACOES_REALISTAS, tribunais: ["tjrs", "stj", "tjsp", "tjmg", "tjpr"], maximo: 200 };
    const padrao = await buscaAmpla(cliente, pedido);
    const porData = await buscaAmpla(cliente, { ...pedido, ordem: "data" });

    expect(padrao.cabecalhoDeCobertura.listaCortada).toMatch(/25 mil caracteres/);
    expect(porData.acordaos.map((a) => a.id).sort()).toEqual(padrao.acordaos.map((a) => a.id).sort());
    expect(porData.acordaos.map((a) => a.data)).toEqual([...porData.acordaos.map((a) => a.data)].sort());
  });

  it("relator com limitePorBusca 1 e 1 resultado: lista cheia, sem alarme de grafia; limite 100 com 1 resultado alarma", async () => {
    const { cliente } = siteFalso(() => respostaJson({ results: [bruto("unico", 0.9)] }));
    const cheia = await buscaAmpla(cliente, { formulacoes: ["tese x"], tribunais: ["stj"], relator: "Fulano", limitePorBusca: 1 });
    expect(cheia.cabecalhoDeCobertura.ressalvaDaGrafia).toBeUndefined();
    const pouca = await buscaAmpla(cliente, { formulacoes: ["tese x"], tribunais: ["stj"], relator: "Fulano" });
    expect(pouca.cabecalhoDeCobertura.ressalvaDaGrafia).toMatch(/grafia/);
  });
});

describe("busca ampla: decisões em série (mesma ementa)", () => {
  const EMENTA = "EMENTA FICTÍCIA. AGRAVO. DANO MORAL COLETIVO. Recurso inadmissível, pois não houve impugnação.";
  const serie = (id: string, data: string | null, extra: Record<string, unknown> = {}) => ({
    ...bruto(id, 0.5, EMENTA),
    relator: "Fulano de Tal",
    data_julgamento: data,
    ...extra,
  });
  const site = (results: unknown[]) => siteFalso(() => respostaJson({ results }));
  const pedido = { formulacoes: ["dano moral coletivo"], tribunais: ["stj"] };

  it("agrupa a série numa linha: contagem, critério, intervalo de datas e todos os ids; a contagem de acórdãos não muda", async () => {
    const { cliente } = site([
      serie("s1", "2024-05-10T00:00:00.000Z"),
      serie("s2", "2024-01-02T00:00:00.000Z"),
      serie("s3", "2024-03-04T00:00:00.000Z"),
      { ...bruto("unico", 0.5, "EMENTA FICTÍCIA. DANO MORAL COLETIVO. Outra."), relator: "Fulano de Tal" },
    ]);
    const r = await buscaAmpla(cliente, pedido);

    expect(r.totalAcordaos).toBe(4);
    expect(r.mostrados).toBe(4);
    expect(r.cabecalhoDeCobertura.porTribunal[0].mostrados).toBe(4);
    expect(r.acordaos).toHaveLength(2);
    const grupo = r.acordaos.find((a) => a.mesmaEmenta)!;
    expect(grupo.mesmaEmenta).toEqual({
      criterio: "mesma ementa",
      quantidade: 3,
      periodo: "2024-01-02 a 2024-05-10",
      ids: expect.arrayContaining(["stj:s2", "stj:s3"]),
    });
    expect([grupo.id, ...grupo.mesmaEmenta!.ids].sort()).toEqual(["stj:s1", "stj:s2", "stj:s3"]);
    expect(r.avisos.join(" ")).toMatch(/mesma ementa/);
    expect(r.avisos.join(" ")).toMatch(/Não significa mesma tese nem mesmo resultado/);
  });

  it("opção de desligar devolve a lista original, sem campo de grupo", async () => {
    const { cliente } = site([serie("s1", "2024-05-10T00:00:00.000Z"), serie("s2", "2024-01-02T00:00:00.000Z")]);
    const r = await buscaAmpla(cliente, { ...pedido, agrupar: false });
    expect(r.acordaos.map((a) => a.id).sort()).toEqual(["stj:s1", "stj:s2"]);
    expect(r.acordaos.some((a) => a.mesmaEmenta)).toBe(false);
    expect(r.avisos.join(" ")).not.toMatch(/mesma ementa/);
  });

  it("negação, número ou relator diferente, ementa cortada ou relator ausente: não agrupa", async () => {
    const { cliente } = site([
      serie("s1", "2024-05-10T00:00:00.000Z"),
      serie("neg2", "2024-05-10T00:00:00.000Z", { texto_ementa: EMENTA.replace("não houve", "houve") }),
      serie("num3", "2024-05-10T00:00:00.000Z", { texto_ementa: `${EMENTA} Art. 2.` }),
      serie("out4", "2024-05-10T00:00:00.000Z", { relator: "Beltrano" }),
      serie("sem5", "2024-05-10T00:00:00.000Z", { relator: undefined }),
      serie("sem6", "2024-05-10T00:00:00.000Z", { relator: undefined }),
    ]);
    const r = await buscaAmpla(cliente, pedido);
    expect(r.acordaos).toHaveLength(6);
    expect(r.acordaos.some((a) => a.mesmaEmenta)).toBe(false);
  });

  it("só espaços e quebras de linha diferentes: agrupa", async () => {
    const { cliente } = site([
      serie("s1", "2024-05-10T00:00:00.000Z"),
      serie("s2", "2024-05-11T00:00:00.000Z", { texto_ementa: `  ${EMENTA.replace(/ /g, "  ")}\n` }),
    ]);
    const r = await buscaAmpla(cliente, pedido);
    expect(r.acordaos).toHaveLength(1);
    expect(r.acordaos[0].mesmaEmenta?.quantidade).toBe(2);
  });

  it("agrupa depois do filtro e do corte: o que o filtro tirou não entra e a lista cortada segue contando acórdãos", async () => {
    const { cliente } = site([
      serie("s1", "2024-05-10T00:00:00.000Z"),
      serie("s2", "2024-05-11T00:00:00.000Z"),
      serie("s3", "2024-05-12T00:00:00.000Z"),
      { ...bruto("fora", 0.5, "EMENTA FICTÍCIA. DANO MORAL COLETIVO. Tema diverso."), relator: "Fulano de Tal" },
    ]);
    const filtrada = await buscaAmpla(cliente, { ...pedido, naoPodeConter: ["tema diverso"] });
    expect(filtrada.totalAcordaos).toBe(4);
    expect(filtrada.cabecalhoDeCobertura.porTribunal[0].excluidos).toBe(1);
    expect(filtrada.acordaos).toHaveLength(1);
    expect(filtrada.acordaos[0].mesmaEmenta?.quantidade).toBe(3);

    // maximo 2: dos 2 escolhidos pela aderência, os dois são da série; "mostrando 2 de 4" fica como estava.
    const cortada = await buscaAmpla(cliente, { ...pedido, maximo: 2 });
    expect(cortada.mostrados).toBe(2);
    expect(cortada.cabecalhoDeCobertura.listaCortada).toMatch(/^mostrando 2 de 4/);
    expect(cortada.acordaos.reduce((n, a) => n + (a.mesmaEmenta?.quantidade ?? 1), 0)).toBe(2);
  });

  it("em ordem de data, o grupo fica onde está o primeiro da série", async () => {
    const { cliente } = site([
      serie("s1", "2024-05-10T00:00:00.000Z"),
      { ...bruto("antigo", 0.5, "EMENTA FICTÍCIA. DANO MORAL COLETIVO. Outra."), data_julgamento: "2010-01-01T00:00:00.000Z" },
      serie("s2", "2024-01-02T00:00:00.000Z"),
    ]);
    const r = await buscaAmpla(cliente, { ...pedido, ordem: "data" });
    expect(r.acordaos.map((a) => a.id)).toEqual(["stj:antigo", "stj:s2"]);
    expect(r.acordaos[1].mesmaEmenta?.ids).toEqual(["stj:s1"]);
  });
});
