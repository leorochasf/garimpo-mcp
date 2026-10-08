import { describe, expect, it } from "vitest";
import { buscaDireta, normalizar } from "../src/busca.js";
import { FormatoInesperadoError } from "../src/cliente.js";
import { Memoria } from "../src/memoria.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

describe("busca direta", () => {
  it("STF: lê os acórdãos do campo juris e avisa que o site devolve poucos acórdãos do STF", async () => {
    const { cliente, chamadas } = clienteFalso([respostaJson(fixture("stf-juris.json"))]);
    const r = await buscaDireta(cliente, { tribunal: "STF", texto: "exemplo", limite: 50 });
    expect(r.acordaos.map((a) => a.numero)).toEqual(["RE 100001", "ARE 100002"]);
    expect(r.acordaos[0]).toMatchObject({ orgao: "Tribunal Pleno", dataJulgamento: "2020-03-11" });
    expect(r.avisos.join(" ")).toMatch(/poucos acórdãos do STF por busca \(de 2 a 7 na medição de out\/2026\)/);
    expect(r.avisos.join(" ")).not.toMatch(/no máximo/);
    expect(r.avisos.join(" ")).toMatch(/sem ementa/);
    expect(r.qualificados.map((q) => q.tipo)).toEqual(["súmula vinculante", "repercussão geral"]);
    const corpo = JSON.parse(String(chamadas[0].init.body));
    expect(chamadas[0].url).toMatch(/\/api\/tribunais\/stf\/search$/);
    expect(corpo).toMatchObject({ query: "exemplo", limit: 50, include_rg: true });
  });

  it("STJ sem classe: não quebra, mantém o número e segue a ordem reranqueada", async () => {
    const { cliente } = clienteFalso([respostaJson(fixture("stj-sem-classe.json"))]);
    const memoria = new Memoria();
    const r = await buscaDireta(cliente, { tribunal: "stj", texto: "exemplo" }, memoria);
    expect(r.acordaos.map((a) => a.id)).toEqual(["stj:202", "stj:201"]);
    const semClasse = r.acordaos[1];
    expect(semClasse.numero).toBe("1.000.001/SP");
    expect(semClasse.classe).toBeUndefined();
    expect(semClasse.relevancia).toBe(0.1);
    expect(semClasse.link).toMatch(/num_registro=202000000001/);
    expect((await memoria.obter("stj:201"))?.acordao.ementa).toMatch(/EXEMPLO FICTÍCIO/);
  });

  it("precedentes qualificados ficam separados dos acórdãos (súmula do reranqueamento não vira acórdão)", () => {
    const r = normalizar("stj", fixture("stj-sem-classe.json"));
    expect(r.acordaos).toHaveLength(2);
    expect(r.qualificados).toEqual([
      {
        tipo: "tema repetitivo",
        numero: "1001",
        texto: "Tese fictícia de tema repetitivo.",
        orgao: "PRIMEIRA SEÇÃO",
        link: "https://processo.stj.jus.br/repetitivos/exemplo",
        enquadramento927: expect.objectContaining({ inciso: "III" }),
      },
      {
        tipo: "súmula",
        numero: "2",
        texto: "Enunciado fictício de súmula do STJ.",
        orgao: "PRIMEIRA SEÇÃO",
        link: "https://scon.stj.jus.br/SCON/exemplo",
        enquadramento927: expect.objectContaining({ inciso: "não classificado" }),
      },
    ]);
  });

  it("TJGO: acórdão completo com CNJ, classe, câmara, data e link", () => {
    const [a] = normalizar("tjgo", fixture("tjgo.json")).acordaos;
    expect(a).toMatchObject({
      id: "tjgo:301",
      numero: "0000001-11.2025.8.09.0001",
      numeroCnj: "0000001-11.2025.8.09.0001",
      classe: "Apelação Cível",
      orgao: "1ª Câmara Cível",
      dataJulgamento: "2026-03-13",
    });
    expect(a.ementa).toMatch(/^EMENTA/);
    expect(a.link).toMatch(/^https:\/\/projudi/);
  });

  it("duas cópias do mesmo acórdão viram um só; o id de qualquer cópia acha o registro mantido", async () => {
    const ementa = "APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO DE ACÓRDÃO EM DOIS REGISTROS.";
    const comum = { data_julgamento: "2025-05-06T00:00:00.000Z", orgao_julgador: "Câmara Exemplo" };
    const { cliente } = clienteFalso([
      respostaJson({
        results: [
          // Cópia sem número de processo (o site põe só o id) e com "Ementa:" no começo.
          { id: "copia-a", texto_ementa: `Ementa: ${ementa}`, ...comum },
          { id: "copia-b", texto_ementa: ementa, numero_processo: "0000009-99.2024.8.21.0001", link_pdf: "https://exemplo.test/b", ...comum },
          { id: "outro", texto_ementa: "OUTRA EMENTA FICTÍCIA.", numero_processo: "0000008-88.2024.8.21.0001", ...comum },
        ],
      }),
    ]);
    const memoria = new Memoria();
    const r = await buscaDireta(cliente, { tribunal: "tjrs", texto: "exemplo" }, memoria);

    expect(r.acordaos.map((a) => a.id)).toEqual(["tjrs:copia-b", "tjrs:outro"]);
    expect((await memoria.obter("tjrs:copia-a"))?.acordao.numero).toBe("0000009-99.2024.8.21.0001");
    expect((await memoria.obter("tjrs:copia-a"))?.acordao.link).toBe("https://exemplo.test/b");
  });

  it("formato inesperado vira erro claro, não lista vazia", () => {
    expect(() => normalizar("stj", { mensagem: "outra coisa" })).toThrow(FormatoInesperadoError);
  });

  it("tribunal fora da cobertura é recusado antes de chamar o site", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    await expect(buscaDireta(cliente, { tribunal: "trf1", texto: "x" })).rejects.toThrow(/não é coberto/);
    expect(chamadas).toHaveLength(0);
  });
});

describe("cabeçalho de cobertura da busca direta", () => {
  const registros = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `d${i}`, texto_ementa: `EMENTA FICTÍCIA ${i}.`, numero_processo: `${i}/UF` }));
  const cabecalho = async (tribunal: string, n: number, p: { limite?: number; de?: string } = {}) => {
    const { cliente } = clienteFalso([respostaJson({ results: registros(n) })]);
    return (await buscaDireta(cliente, { tribunal, texto: "exemplo", ...p })).cabecalhoDeCobertura;
  };

  it("veio o número pedido: pode haver mais", async () => {
    expect(await cabecalho("stj", 3, { limite: 3 })).toBe(
      "O site devolveu os 3 registros pedidos; pode haver mais: aumente o limite (até 100) ou use a busca ampla.",
    );
  });

  it("veio o número pedido no limite de 100: só a busca ampla traz mais", async () => {
    expect(await cabecalho("stj", 100, { limite: 100 })).toBe("O site devolveu os 100 registros pedidos; pode haver mais: use a busca ampla.");
  });

  it("veio menos que o pedido: a base não tem mais para este texto", async () => {
    expect(await cabecalho("stj", 2)).toBe("O site devolveu 2 registros, menos que os 10 pedidos: a base não tem mais para este texto.");
  });

  it("veio menos que o pedido com filtro: a base não tem mais para este texto e estes filtros", async () => {
    expect(await cabecalho("stj", 0, { de: "2024-01-01" })).toBe(
      "O site devolveu 0 registros, menos que os 10 pedidos: a base não tem mais para este texto e estes filtros.",
    );
  });

  it("STF com menos que o pedido: não diz que a base acabou, porque o site devolve poucos por busca", async () => {
    expect(await cabecalho("stf", 3)).toBe(
      "O site devolveu 3 registros; neste tribunal ele devolve poucos por busca (até 7), " +
        "então pode haver mais: use a busca ampla com outras formulações.",
    );
  });

  it("cópias juntadas não fazem a busca parecer menor que o pedido", async () => {
    const ementa = "EMENTA FICTÍCIA DO MESMO ACÓRDÃO EM DOIS REGISTROS.";
    const comum = { data_julgamento: "2025-05-06T00:00:00.000Z", orgao_julgador: "Câmara Exemplo", texto_ementa: ementa };
    const { cliente } = clienteFalso([respostaJson({ results: [{ id: "a", ...comum }, { id: "b", ...comum }] })]);
    const r = await buscaDireta(cliente, { tribunal: "stj", texto: "exemplo", limite: 2 });
    expect(r.acordaos).toHaveLength(1);
    expect(r.cabecalhoDeCobertura).toMatch(/^O site devolveu os 2 registros pedidos; pode haver mais/);
  });
});
