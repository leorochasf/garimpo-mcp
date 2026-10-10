/**
 * Régua do banco de provas, sem rede (G-72). Roda a busca ampla de verdade (src/ampla.ts) sobre as respostas gravadas
 * do site e falha se um acórdão obrigatório sair do topo ou se a precisão ou a cobertura cair abaixo do limiar —
 * no total, em cada tribunal e em cada tese, para a média boa não esconder a queda num tribunal.
 *
 * - Respostas: tests/fixtures/banco-de-provas/tese-NN.json, recorte da gravação da rodada 2 (132 buscas, 2026-10-08)
 *   SEM dado real: ids, números, órgãos e links sintéticos; a ementa guarda só um marcador das cópias do mesmo acórdão
 *   e as palavras que casam com as formulações (as únicas que a aderência olha). Mudança de ordem que dependa de outra
 *   parte da ementa (ou da nota do site, que o recorte não guarda) não é medida aqui: pede gravação nova.
 * - Gabarito: o do dono (CONTEXT.md, "Banco de provas"; docs/banco-de-provas/teses-propostas.md), na forma da
 *   rodada 2: lista unificada da rodada 1 + pré-marcação por IA dos acórdãos novos + as marcas do dono da lista curta.
 *   Precisão = relevantes ÷ mostrados (sem marca e dúvida contam como não relevantes); cobertura = relevantes
 *   mostrados ÷ relevantes da lista unificada (só nas 7 teses que têm lista unificada).
 * - Limiares e obrigatórios: tests/fixtures/banco-de-provas/regua.json, com a data e a base da medição de partida e a
 *   folga escrita. Afrouxar um limiar para uma mudança passar não vale: o caso sai da régua, com o motivo no commit.
 *
 * NÃO TREINAR PARA A PROVA: tese ou consulta nova entra julgada ANTES de olhar o que o Garimpo devolve — tese,
 * formulações e acórdãos obrigatórios escritos e commitados primeiro; a gravação e a medição vêm depois. Ajustar a
 * ordem olhando o gabarito destas teses e medir nas mesmas teses é treinar para a prova.
 */
import { describe, expect, it } from "vitest";
import { carregarRecorte, carregarRegua, conferirRegua, medir, rodarBanco, rodarTese } from "./apoioBancoDeProvas.js";

describe("banco de provas sobre o recorte gravado (sem rede)", () => {
  it("a tese 18 (só TSE) reproduz a medição da rodada 2: 50 mostrados, todos relevantes, cobertura 50 de 92", async () => {
    const recorte = carregarRecorte(18);
    const lista = await rodarTese(recorte);
    expect(lista).toHaveLength(50);
    const m = medir([{ recorte, lista }]);
    expect(m.porTribunal.tse).toEqual({ mostrados: 50, relevantes: 50, precisao: 1, relevantesNaLista: 92, achados: 50, cobertura: 50 / 92 });
  });

  it("a régua acusa o tribunal abaixo do limiar mesmo com a média global boa, e o obrigatório fora do topo", () => {
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

  it("a busca ampla atual passa na régua: obrigatórios no topo, precisão e cobertura por tribunal e por tese", async () => {
    const regua = carregarRegua();
    const { medicao, posicoes } = await rodarBanco();
    expect(conferirRegua(medicao, posicoes, regua)).toEqual([]);
  });

  it("a régua pega regressão: com a ordem embaralhada, falha nos obrigatórios e na qualidade por tribunal", async () => {
    const { medicao, posicoes } = await rodarBanco({ embaralhar: true });
    const falhas = conferirRegua(medicao, posicoes, carregarRegua());
    expect(falhas.some((f) => /obrigatório/.test(f))).toBe(true);
    expect(falhas.some((f) => /^(STF|STJ|TJSP|TJMG|TJRS|TSE|TST): precisão/.test(f))).toBe(true);
  });
});
