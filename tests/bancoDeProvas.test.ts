/**
 * Banco de provas, sem rede (G-72). Duas coisas distintas, que não se confundem:
 *
 * 1. TRAVA DE REGRESSÃO DA ORDEM (NÃO é medida de qualidade). Roda a busca ampla de verdade (src/ampla.ts) sobre as
 *    respostas gravadas do site e compara com a ordem e a pré-marcação por IA gravadas hoje: falha se um acórdão
 *    "obrigatório" sair do topo ou se a precisão ou a cobertura (pela pré-marcação) cair abaixo do limiar — no total,
 *    em cada tribunal e em cada tese. Ela diz "a ordem piorou em relação a hoje", não "a ordem é boa".
 * 2. QUALIDADE CONTRA O GABARITO DO DONO. Conta só as marcas confirmadas pelo dono (campo doDono). Com poucas
 *    confirmações o teste é pulado com a lacuna escrita (motivo), nunca aprovado.
 *
 * - Respostas: tests/fixtures/banco-de-provas/tese-NN.json, recorte da gravação da rodada 2 (132 buscas, 2026-10-08)
 *   SEM dado real: ids, números, órgãos e links sintéticos; a ementa guarda só um marcador das cópias do mesmo acórdão
 *   e as palavras que casam com as formulações (as únicas que a aderência olha). Mudança de ordem que dependa de outra
 *   parte da ementa (ou da nota do site, que o recorte não guarda) não é medida aqui: pede gravação nova.
 * - Pré-marcação (trava de ordem): lista unificada da rodada 1 + pré-marcação por IA dos acórdãos novos + as marcas do dono
 *   da lista curta (CONTEXT.md, "Banco de provas"; docs/banco-de-provas/teses-propostas.md). NÃO é o gabarito do dono: a
 *   grande maioria dos "relevantes" é marca da IA. Precisão = relevantes ÷ mostrados (sem marca e dúvida contam como não
 *   relevantes); cobertura = relevantes mostrados ÷ relevantes da lista unificada (só nas 7 teses que têm lista unificada).
 * - Gabarito do dono: só as marcas com doDono = 1; mede precisão (a cobertura precisaria da lista de relevantes do dono).
 * - Limiares e obrigatórios: tests/fixtures/banco-de-provas/regua.json, com a data e a base da medição de partida e a
 *   folga escrita. Os obrigatórios são PROVISÓRIOS, aguardando confirmação do dono. Afrouxar um limiar para uma mudança passar não vale: o caso sai da régua, com o motivo no commit.
 *
 * NÃO TREINAR PARA A PROVA: tese ou consulta nova entra julgada ANTES de olhar o que o Garimpo devolve — tese,
 * formulações e acórdãos obrigatórios escritos e commitados primeiro; a gravação e a medição vêm depois. Ajustar a
 * ordem olhando o gabarito destas teses e medir nas mesmas teses é treinar para a prova.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { acharNaTabela, tabelaEmpacotada } from "../src/tabelaDePrecedentes.js";
import { acharNoStf, tabelaDoStfEmpacotada } from "../src/tabelaDoStf.js";
import { carregarParadigmasOficiais, carregarRecorte, carregarRegua, carregarRodadaD15, conferirParadigmasOficiais, conferirRegua, contarConfirmadosDoDono, medir, posicoesDosParadigmas, relatarParadigmas, rodarBanco, rodarTese } from "./apoioBancoDeProvas.js";

describe("trava de regressão da ordem sobre o recorte gravado (sem rede; NÃO é medida de qualidade)", () => {
  it("a tese 18 (só TSE) reproduz a medição da rodada 2: 50 mostrados, todos relevantes, cobertura 50 de 92", async () => {
    const recorte = carregarRecorte(18);
    const lista = await rodarTese(recorte);
    expect(lista).toHaveLength(50);
    const m = medir([{ recorte, lista }]);
    expect(m.porTribunal.tse).toEqual({ mostrados: 50, relevantes: 50, precisao: 1, relevantesNaLista: 92, achados: 50, cobertura: 50 / 92 });
  });

  it("a trava acusa o tribunal abaixo do limiar mesmo com a média global boa, e o obrigatório fora do topo", () => {
    const conta = (precisao: number, cobertura?: number) => ({ mostrados: 10, relevantes: 10 * precisao, precisao, ...(cobertura !== undefined && { cobertura }) });
    const medicao = {
      global: conta(0.95, 0.5),
      porTribunal: { stj: conta(1, 0.6), stf: conta(0.5, 0.2) },
      porTese: { 1: conta(0.95, 0.5) },
    };
    const regua = {
      topo: 10,
      limiares: {
        global: { precisao: 0.9, cobertura: 0.4 },
        porTribunal: { stj: { precisao: 0.9, cobertura: 0.5 }, stf: { precisao: 0.8, cobertura: 0.3 } },
        porTese: { 1: { precisao: 0.9, cobertura: 0.4 } },
      },
      obrigatorios: { 1: [7, 8] },
    };
    const posicoes = { 1: [3, 0, 1, 2, 4, 5, 6, 9, 10, 11, 12, 8] }; // o 7 sumiu; o 8 está na 12ª posição
    expect(conferirRegua(medicao, posicoes, regua)).toEqual([
      "STF: precisão 50,0% abaixo do limiar 80,0%",
      "STF: cobertura 20,0% abaixo do limiar 30,0%",
      "tese 1: obrigatório 7 fora da lista",
      "tese 1: obrigatório 8 na posição 12, fora do topo 10",
    ]);
  });

  it("a ordem de hoje não piorou em relação à gravada: obrigatórios provisórios no topo, precisão e cobertura (pré-marcação) por tribunal e por tese", async () => {
    const regua = carregarRegua();
    const { medicao, posicoes } = await rodarBanco();
    expect(conferirRegua(medicao, posicoes, regua)).toEqual([]);
  });

  it("a trava pega regressão da ordem: com a ordem embaralhada, falha nos obrigatórios e na qualidade por tribunal", async () => {
    const { medicao, posicoes } = await rodarBanco({ embaralhar: true });
    const falhas = conferirRegua(medicao, posicoes, carregarRegua());
    expect(falhas.some((f) => /obrigatório/.test(f))).toBe(true);
    expect(falhas.some((f) => /^(STF|STJ|TJSP|TJMG|TJRS|TSE|TST): precisão/.test(f))).toBe(true);
  });
});

describe("qualidade contra o gabarito do dono (só marcas doDono)", () => {
  const sintetico = (marcas: [string, "r" | "i" | null, boolean][]) => {
    const recorte = { tese: 1, nome: "sintética", grupo: "controle", tribunais: [], formulacoes: [], vocabulario: [], buscas: [], acordaos: [] };
    const lista = marcas.map(([tribunal, marca, doDono], indice) => ({ indice, tribunal, marca, chave: indice, doDono }));
    return [{ recorte: recorte as never, lista }];
  };

  it("a pré-marcação da IA não conta como confirmação do dono: só doDono entra na precisão de qualidade", () => {
    const itens = sintetico([
      ["stj", "r", true],
      ["stj", "r", false],
      ["stj", "i", true],
      ["stj", null, false],
    ]);
    expect(medir(itens, "preMarcacao").global.precisao).toBe(2 / 4);
    expect(medir(itens, "dono").global).toMatchObject({ mostrados: 4, relevantes: 1, precisao: 1 / 4 });
    expect(contarConfirmadosDoDono(itens)).toEqual({ relevantesConfirmados: 1, mostrados: 4 });
  });

  it("mede a qualidade só com confirmações suficientes; sem elas, registra a lacuna em vez de passar", async (ctx) => {
    const { qualidadeDoDono } = carregarRegua();
    expect(qualidadeDoDono, "regua.json precisa declarar qualidadeDoDono.minimoDeRelevantesConfirmados").toBeDefined();
    const { itens } = await rodarBanco();
    const { relevantesConfirmados, mostrados } = contarConfirmadosDoDono(itens);
    if (relevantesConfirmados < qualidadeDoDono!.minimoDeRelevantesConfirmados) {
      ctx.skip(
        `LACUNA: ${relevantesConfirmados} relevantes confirmados pelo dono entre ${mostrados} mostrados; mínimo ${qualidadeDoDono!.minimoDeRelevantesConfirmados}. Qualidade NÃO medida: aguarda confirmação do dono.`,
      );
    }
    expect(qualidadeDoDono!.limiarDePrecisao, "defina limiarDePrecisao em regua.json: já há confirmações suficientes").toBeDefined();
    expect(medir(itens, "dono").global.precisao).toBeGreaterThanOrEqual(qualidadeDoDono!.limiarDePrecisao!);
  });
});

describe("obrigatórios oficiais: processo paradigma da tabela oficial (ticket 21; sem rede)", () => {
  const achar = (tribunal: "stj" | "stf", tipo: "tema repetitivo" | "repercussão geral", numero: number) =>
    tribunal === "stj"
      ? acharNaTabela(tabelaEmpacotada(), tipo as "tema repetitivo", numero)?.processosParadigma
      : acharNoStf(tabelaDoStfEmpacotada(), tipo as "repercussão geral", numero)?.processosParadigma;

  it("são os 9 do STJ e os 11 do STF que a rodada achou no topo; cada um segue sendo o paradigma da tabela oficial e segue no topo da busca REAL de hoje", async () => {
    const p = carregarParadigmasOficiais();
    expect(p.obrigatoriosOficiais.filter((o) => o.tribunal === "stj")).toHaveLength(9);
    expect(p.obrigatoriosOficiais.filter((o) => o.tribunal === "stf")).toHaveLength(11);
    expect(conferirParadigmasOficiais(p, achar, await posicoesDosParadigmas(p))).toEqual([]);
  });

  it("o recorte anonimizado reproduz as posições gravadas pela rodada (fidelidade do recorte; mudança intencional da ordem pede regravar)", async () => {
    const p = carregarParadigmasOficiais();
    const posicoes = await posicoesDosParadigmas(p);
    for (const o of p.obrigatoriosOficiais) expect(posicoes[`${o.tribunal}/${o.numero}`], `${o.tribunal} ${o.numero}`).toBe(o.posicaoNaRodada);
  });

  it("a régua pega regressão: com a ordem do site embaralhada, os paradigmas do STJ saem do topo e a régua oficial FALHA", async () => {
    const p = carregarParadigmasOficiais();
    const stj = p.obrigatoriosOficiais.filter((o) => o.tribunal === "stj").map((o) => `${o.tribunal}/${o.numero}`);
    const falhas = conferirParadigmasOficiais(p, achar, await posicoesDosParadigmas(p, { rebaixar: stj }));
    // O tema 938 devolve um acórdão só (o paradigma): não tem para onde cair; ele é coberto pelo teste de "sumiu".
    expect(falhas).toHaveLength(stj.length - 1);
    expect(falhas.every((f) => /^STJ tema repetitivo \d+: recuperado fora do topo-10 \(paradigma REsp \d+ na posição \d+\)$/.test(f))).toBe(true);
    expect(falhas.some((f) => f.includes("tema repetitivo 938"))).toBe(false);
  });

  it("a régua pega UM paradigma rebaixado para o fim da lista, e só ele", async () => {
    const p = carregarParadigmasOficiais();
    const falhas = conferirParadigmasOficiais(p, achar, await posicoesDosParadigmas(p, { rebaixar: ["stj/1311"] }));
    expect(falhas).toEqual(["STJ tema repetitivo 1311: recuperado fora do topo-10 (paradigma REsp 2057984 na posição 97)"]);
  });

  it("a régua pega paradigma que sumiu da busca (STJ e STF), e só ele", async () => {
    const p = carregarParadigmasOficiais();
    const falhas = conferirParadigmasOficiais(p, achar, await posicoesDosParadigmas(p, { remover: ["stj/400", "stf/364"] }));
    expect(falhas).toEqual([
      "STF repercussão geral 364: não recuperado (paradigma RE 607886 fora da lista da busca)",
      "STJ tema repetitivo 400: não recuperado (paradigma REsp 1143320 fora da lista da busca)",
    ]);
  });

  it("os 3 não indexados e o fora do topo ficam fora da régua, anotados, e nenhum deles é obrigatório", () => {
    const p = carregarParadigmasOficiais();
    expect(p.foraDaRegua.map((o) => `${o.tribunal}/${o.numero}`)).toEqual(["stf/141", "stj/143", "stj/181", "stj/687"]);
    expect(p.foraDaRegua).toHaveLength(4);
    expect(p.foraDaRegua.every((o) => !!o.motivo)).toBe(true);
    const obrigatorios = new Set(p.obrigatoriosOficiais.map((o) => `${o.tribunal}/${o.numero}`));
    expect(p.foraDaRegua.some((o) => obrigatorios.has(`${o.tribunal}/${o.numero}`))).toBe(false);
  });

  it("D-02: cada obrigatório registra a identidade do acórdão e a fotografia da tabela, e a fotografia bate com a tabela empacotada", () => {
    const p = carregarParadigmasOficiais();
    const tabelas = { stj: tabelaEmpacotada(), stf: tabelaDoStfEmpacotada() };
    for (const o of [...p.obrigatoriosOficiais, ...p.foraDaRegua]) {
      const rotulo = `${o.tribunal} ${o.numero}`;
      expect(`${o.acordao.classe} ${o.acordao.numero}`, rotulo).toBe(o.paradigma);
      const linha = (tabelas[o.tribunal].linhas as { tipo: string; numero: number; situacao?: string; dataJulgamento?: string; teseFirmada?: string }[]).find((l) => l.tipo === o.tipo && l.numero === o.numero);
      expect(linha?.situacao, rotulo).toBe(o.tabela.situacao);
      expect(linha?.dataJulgamento, rotulo).toBe(o.tabela.dataJulgamento);
      expect(createHash("sha256").update(linha?.teseFirmada ?? "").digest("hex").slice(0, 16), rotulo).toBe(o.tabela.teseSha256);
    }
  });

  it("D-02: N fixado e registrado, e os 20 são de recuperação: o registro não os chama de gabarito nem de relevantes", () => {
    const p = carregarParadigmasOficiais();
    expect(p.topo).toBe(10);
    expect(p.topoFixadoEm).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.obrigatoriosOficiais).toHaveLength(20);
    expect(p.obrigatoriosOficiais.every((o) => !("marca" in o) && !("doDono" in o) && !("relevante" in o))).toBe(true);
  });

  it("D-02: a régua reporta as três situações, e o registro dos 4 de fora usa duas delas (não indexado é inferência; fora do topo foi medido)", async () => {
    const p = carregarParadigmasOficiais();
    const hoje = relatarParadigmas(p, await posicoesDosParadigmas(p));
    expect(hoje).toMatchObject({ topo: 10, obrigatorios: 20, recuperadosForaDoTopo: [], naoRecuperados: [] });
    expect(hoje.recuperadosNoTopo).toHaveLength(20);
    expect(hoje.foraDaRegua).toEqual({
      naoIndexadosNaFonte: ["stf/141", "stj/143", "stj/181"],
      recuperadosForaDoTopo: ["stj/687"],
    });
    expect(p.foraDaRegua.filter((o) => o.situacaoNaRodada === "nao-indexado-na-fonte").every((o) => /não verificado/.test(o.motivo ?? ""))).toBe(true);

    const pior = relatarParadigmas(p, await posicoesDosParadigmas(p, { rebaixar: ["stj/1311"], remover: ["stf/364"] }));
    expect(pior.recuperadosForaDoTopo).toEqual([{ chave: "stj/1311", posicao: 97 }]);
    expect(pior.naoRecuperados).toEqual(["stf/364"]);
    expect(pior.recuperadosNoTopo).toHaveLength(18);
  });
});

describe("rodada de D-15 (plano; sem rede): teses e formulações escolhidas antes da medição", () => {
  it("5 teses de áreas diferentes que têm lista de relevantes, 4 formulações cada (assunto × conclusão; técnica × leiga), dentro do teto de chamadas", () => {
    const r = carregarRodadaD15();
    expect(r.teses).toHaveLength(5);
    expect(r.teses.reduce((n, t) => n + t.variantes.length, 0)).toBeLessThanOrEqual(r.tetoDeChamadas);
    expect(r.tetoDeChamadas).toBe(24);
    for (const t of r.teses) {
      const recorte = carregarRecorte(t.tese);
      expect(recorte.relevantesNaLista, `tese ${t.tese}`).toBeDefined();
      expect(Object.keys(recorte.relevantesNaLista ?? {}), `tese ${t.tese}`).toContain(t.tribunal);
      expect(t.variantes.map((v) => v.id)).toEqual(["tecnica-assunto", "tecnica-conclusao", "leiga-assunto", "leiga-conclusao"]);
      for (const v of t.variantes) expect(v.busca.trim().length, `tese ${t.tese} ${v.id}`).toBeGreaterThan(0);
      // Nenhuma formulação nova repete uma que o recorte já gravou: a medição é de formulação nova.
      for (const v of t.variantes) expect(recorte.formulacoes, `tese ${t.tese} ${v.id}`).not.toContain(v.busca);
    }
    expect(new Set(r.teses.map((t) => t.tese)).size).toBe(5);
  });
});

describe("obrigatórios oficiais: conferência sobre tabela falsa (sem rede)", () => {
  it("acusa paradigma que mudou na tabela, tema que sumiu, paradigma fora da lista e posição fora do topo", () => {
    const p = {
      topo: 10,
      obrigatoriosOficiais: [
        { tribunal: "stj", tipo: "tema repetitivo", numero: 1, paradigma: "REsp 1" },
        { tribunal: "stj", tipo: "tema repetitivo", numero: 2, paradigma: "REsp 2" },
        { tribunal: "stf", tipo: "repercussão geral", numero: 3, paradigma: "RE 3" },
        { tribunal: "stf", tipo: "repercussão geral", numero: 4, paradigma: "RE 4" },
      ],
      foraDaRegua: [],
    } as const;
    const tabela = (_tribunal: string, _tipo: string, n: number) => (n === 1 ? ["REsp 9"] : n === 2 || n === 4 ? [n === 2 ? "REsp 2" : "RE 4"] : undefined);
    expect(conferirParadigmasOficiais(p as never, tabela, { "stj/1": 2, "stj/2": 11, "stf/3": 1, "stf/4": undefined })).toEqual([
      "STJ tema repetitivo 1: paradigma REsp 1 não é mais o da tabela oficial",
      "STJ tema repetitivo 2: recuperado fora do topo-10 (paradigma REsp 2 na posição 11)",
      "STF repercussão geral 3: tema não está na tabela oficial",
      "STF repercussão geral 4: não recuperado (paradigma RE 4 fora da lista da busca)",
    ]);
  });
});
