import { describe, expect, it } from "vitest";
import type { ItemAmplo } from "../src/ampla.js";
import { normalizar, type Qualificado } from "../src/busca.js";
import { fixture } from "./apoio.js";
import { juntarQualificados, reservarPorTribunal } from "../src/saida.js";

/** Acórdão fictício já na ordem geral; `deCima` diz se está na faixa de aderência de cima. */
interface AcordaoFicticio {
  id: string;
  tribunal: string;
  deCima: boolean;
}

const naFaixaDeCima = (x: AcordaoFicticio) => x.deCima;

function acordaos(tribunal: string, n: number, deCima = true): AcordaoFicticio[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${tribunal}:${i}`, tribunal, deCima }));
}

describe("reserva mínima por tribunal", () => {
  it("STF com 4 achados por 1 formulação entra com até 3 vagas ao lado de um tribunal grande, sem sair da ordem geral", () => {
    // Ordem geral: os 100 do tribunal grande (achados por 3 formulações) vêm antes dos 4 do STF (achados por 1).
    const ordenados = [...acordaos("tjxx", 100), ...acordaos("stf", 4)];

    const mostrados = reservarPorTribunal(ordenados, { maximo: 50, naFaixaDeCima });

    expect(mostrados).toHaveLength(50);
    expect(mostrados.filter((x) => x.tribunal === "stf").map((x) => x.id)).toEqual(["stf:0", "stf:1", "stf:2"]);
    // A reserva não pula para o topo: a lista mostrada segue a ordem geral.
    const posicoes = mostrados.map((x) => ordenados.indexOf(x));
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    expect(mostrados.slice(0, 47).map((x) => x.id)).toEqual(ordenados.slice(0, 47).map((x) => x.id));
  });

  it("tribunal pedido sem nenhum acórdão não reserva vaga: as vagas vão para os outros", () => {
    // TJYY e STF foram pedidos, mas o site não devolveu nada deles.
    const ordenados = acordaos("tjxx", 100);

    const mostrados = reservarPorTribunal(ordenados, { maximo: 50, naFaixaDeCima });

    expect(mostrados.map((x) => x.id)).toEqual(ordenados.slice(0, 50).map((x) => x.id));
  });

  it("acórdão fora da faixa de aderência de cima não entra pela reserva", () => {
    const ordenados = [...acordaos("tjxx", 100), ...acordaos("stf", 4, false)];

    const mostrados = reservarPorTribunal(ordenados, { maximo: 50, naFaixaDeCima });

    expect(mostrados.some((x) => x.tribunal === "stf")).toBe(false);
    expect(mostrados).toHaveLength(50);
  });

  it("o tamanho da reserva é parâmetro", () => {
    const ordenados = [...acordaos("tjxx", 100), ...acordaos("stf", 4)];

    const com1 = reservarPorTribunal(ordenados, { maximo: 50, vagasPorTribunal: 1, naFaixaDeCima });
    const com0 = reservarPorTribunal(ordenados, { maximo: 50, vagasPorTribunal: 0, naFaixaDeCima });

    expect(com1.filter((x) => x.tribunal === "stf").map((x) => x.id)).toEqual(["stf:0"]);
    expect(com0.some((x) => x.tribunal === "stf")).toBe(false);
  });
});

const tema = (numero: string, texto = `Tese fictícia do tema ${numero}.`): Qualificado => ({
  tipo: "repercussão geral",
  numero,
  texto,
});

describe("seção de precedentes qualificados", () => {
  it("o mesmo tema trazido por duas formulações sai uma vez, com as formulações contadas", () => {
    const secao = juntarQualificados([
      { tribunal: "stf", formulacao: 0, qualificados: [tema("1")] },
      { tribunal: "stf", formulacao: 1, qualificados: [tema("1"), tema("2")] },
    ]);

    expect(secao.map((q) => [q.tribunal, q.numero, q.formulacoes])).toEqual([
      ["stf", "1", 2],
      ["stf", "2", 1],
    ]);
    expect(secao[0].texto).toBe("Tese fictícia do tema 1.");
  });

  it("lê os precedentes qualificados no formato devolvido pelo site (fixture fictícia do STF)", () => {
    const { qualificados } = normalizar("stf", fixture("stf-juris.json"));

    const secao = juntarQualificados([
      { tribunal: "stf", formulacao: 0, qualificados },
      { tribunal: "stf", formulacao: 1, qualificados },
    ]);

    expect(qualificados.length).toBeGreaterThan(0);
    expect(secao).toHaveLength(qualificados.length);
    expect(secao.every((q) => q.tribunal === "stf" && q.formulacoes === 2 && q.texto.length > 0)).toBe(true);
  });

  it("tema de mesmo número em tribunais diferentes não se junta", () => {
    const secao = juntarQualificados([
      { tribunal: "stf", formulacao: 0, qualificados: [tema("10")] },
      { tribunal: "stj", formulacao: 0, qualificados: [tema("10")] },
    ]);

    expect(secao.map((q) => [q.tribunal, q.numero, q.formulacoes])).toEqual([
      ["stf", "10", 1],
      ["stj", "10", 1],
    ]);
  });

  it("respeita o teto e corta o texto", () => {
    const buscas = [{ tribunal: "stj", formulacao: 0, qualificados: Array.from({ length: 30 }, (_, i) => tema(String(i), "Y".repeat(2000))) }];

    const padrao = juntarQualificados(buscas);
    const pequeno = juntarQualificados(buscas, { teto: 4, tamanhoTexto: 50 });

    expect(padrao).toHaveLength(10);
    expect(padrao[0].texto.length).toBeLessThan(2000);
    expect(pequeno).toHaveLength(4);
    expect(pequeno[0].texto).toBe(`${"Y".repeat(50)}…`);
  });

  it("lista mostrada (50) + 10 qualificados com texto cortado cabem numa resposta", () => {
    // Mesmo item compacto que o teste de tamanho da busca ampla já usa (tests/ampla.test.ts), ementa cortada em 160.
    // Com links e números de processo longos, a lista de 50 sozinha já passa de 21 mil: ver comentário do ticket 08.
    const mostrados: ItemAmplo[] = Array.from({ length: 50 }, (_, i) => ({
      id: `stj:a-${i}`,
      numero: `a-${i}/UF`,
      tribunal: "stj",
      data: "2024-01-02",
      orgao: "Turma Exemplo",
      trecho: `${"E".repeat(160)}…`,
      link: `https://exemplo.test/a-${i}`,
      formulacoes: 3,
    }));
    const qualificados = juntarQualificados([
      {
        tribunal: "stf",
        formulacao: 0,
        qualificados: Array.from({ length: 30 }, (_, i) => ({
          tipo: "repercussão geral",
          numero: String(i),
          texto: "T".repeat(5000),
          orgao: "Tribunal Pleno",
          processoParadigma: `RE ${1000 + i}`,
          link: `https://tribunal.exemplo.invalid/temas/tema-de-repercussao-geral?numero=${i}`,
        })),
      },
    ]);

    // Mesmo formato da resposta das ferramentas (src/index.ts).
    const resposta = JSON.stringify({ acordaos: mostrados, qualificados }, null, 1);

    expect(qualificados).toHaveLength(10);
    expect(resposta.length).toBeLessThan(25_000);
  });
});
