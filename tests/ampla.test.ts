import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buscaAmpla } from "../src/ampla.js";
import { buscaDireta } from "../src/busca.js";
import { Cliente, RecusaError, Vagas } from "../src/cliente.js";
import { Memoria } from "../src/memoria.js";
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

// A tese no meio da ementa: o trecho sai do meio, com "…" nas duas pontas (o caso mais longo).
const FORMULACOES_REALISTAS = ["dano moral coletivo", "dano moral difuso", "dano moral transindividual"];

/**
 * Site falso com campos de tamanho realista: tudo fictício, mas com o tamanho dos campos reais: id longo, número CNJ
 * com sigla, órgão por extenso, link de ~95 caracteres, ementa longa; qualificados com tese longa, paradigma e link longo.
 */
function siteRealista() {
  const link = (i: number) => `https://jurisprudencia.tribunal-exemplo.invalid/consulta/inteiro-teor/documento?id=${String(i).padStart(10, "0")}`;
  const realista = (texto: string, i: number) => ({
    id: `${texto}${String(i).padStart(9, "0")}`,
    texto_ementa:
      `EMENTA: APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO ${texto}-${i}. ${"Texto fictício de ementa. ".repeat(75)}` +
      `DANO MORAL COLETIVO RECONHECIDO. ${"Texto fictício de ementa. ".repeat(75)}`,
    sigla_classe: "ApCiv",
    numero_processo: `50${String(i).padStart(5, "0")}-${texto.length}1.2024.8.21.0001`,
    orgao_julgador: "Décima Segunda Câmara Cível",
    data_julgamento: "2024-01-02T00:00:00.000Z",
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
    const dados = await mkdtemp(join(tmpdir(), "garimpo-ampla-"));
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
    expect(tjgo).toEqual({ tribunal: "tjgo", buscasFeitas: 0, vazias: 0, comErro: 2, situacao: "com erro" });
    expect(tjgo).not.toHaveProperty("achados");
    expect(r.cabecalhoDeCobertura.porTribunal.find((t) => t.tribunal === "stj")).toMatchObject({ comErro: 0, achados: 2 });
  });

  it("tribunal com parte das buscas com erro: conta as duas coisas e mostra os achados das que deram certo", async () => {
    const { cliente } = siteFalso((_t, texto) =>
      texto === "b" ? formatoDesconhecido() : respostaJson({ results: [bruto(texto, 0.5)] }),
    );

    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b", "c"], tribunais: ["stj"] });

    expect(r.cabecalhoDeCobertura.porTribunal).toEqual([{ tribunal: "stj", buscasFeitas: 2, vazias: 0, comErro: 1, achados: 2, mostrados: 2 }]);
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
      { tribunal: "tjgo", buscasFeitas: 0, vazias: 0, comErro: 1, situacao: "com erro" },
      { tribunal: "tjrs", buscasFeitas: 0, vazias: 0, comErro: 0, naoFeitas: 1, situacao: "não pesquisado" },
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

    expect(r.cabecalhoDeCobertura.listaCortada).toBe("mostrando 5 de 12; para ver mais, peça máximo maior (até 200)");
    expect(r.cabecalhoDeCobertura.porTribunal).toEqual([{ tribunal: "stj", buscasFeitas: 1, vazias: 0, comErro: 0, achados: 12, mostrados: 5 }]);
  });

  it("lista cortada já no máximo de 200: não manda pedir máximo maior", async () => {
    const { cliente } = siteFalso((_t, texto) =>
      respostaJson({ results: Array.from({ length: 100 }, (_, i) => ({ ...bruto(`${texto}-${i}`, 0.5), numero_processo: `${i}${texto.length}/UF` })) }),
    );

    const r = await buscaAmpla(cliente, { formulacoes: ["a", "bb", "ccc"], tribunais: ["stj"], maximo: 200 });

    expect(r.cabecalhoDeCobertura.listaCortada).toBe("mostrando 200 de 300; 200 é o máximo por resposta");
  });
});
