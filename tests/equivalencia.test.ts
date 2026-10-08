import { describe, expect, it } from "vitest";
import { juntarEquivalentes, type Ocorrencia, type Registro } from "../src/equivalencia.js";

/** Registro fictício: mesmo tribunal e data por padrão, para que só o que o teste muda importe. */
function registro(id: string, extra: Partial<Registro> = {}): Registro {
  return {
    id: `tjxx:${id}`,
    tribunal: "tjxx",
    numero: `${id}`,
    semNumero: false,
    dataJulgamento: "2024-03-05",
    ementa: "APELAÇÃO. CONTRATO FICTÍCIO. CLÁUSULA EXEMPLO. RECURSO PROVIDO.",
    ...extra,
  };
}

/** Número de processo fictício compartilhado pelas cópias do mesmo acórdão. */
const NUMERO_COMPARTILHADO = "0006000-00.2024.8.99.0001";

function ocorrencia(r: Registro, formulacoes: number[], melhorPosicao = 0): Ocorrencia<Registro> {
  return { registro: r, formulacoes: new Set(formulacoes), melhorPosicao };
}

describe("equivalência de registros", () => {
  it("duas cópias do mesmo acórdão viram um só, com formulações somadas e o número de processo mantido", () => {
    const comNumero = registro("101", { numero: "0001111-22.2024.8.99.0001" });
    const semNumero = registro("202", {
      semNumero: true,
      ementa: "Ementa: APELAÇÃO. CONTRATO   FICTÍCIO. Cláusula exemplo. RECURSO PROVIDO.",
    });

    const { acordaos } = juntarEquivalentes([ocorrencia(semNumero, [0, 1]), ocorrencia(comNumero, [1, 2])]);

    expect(acordaos).toHaveLength(1);
    expect(acordaos[0].registro).toBe(comNumero);
    expect([...acordaos[0].formulacoes].sort()).toEqual([0, 1, 2]);
  });

  it("mesma ementa e mesma data com números de processo de verdade diferentes continuam acórdãos distintos", () => {
    const muitos = Array.from({ length: 300 }, (_, i) => ocorrencia(registro(`${1000 + i}`, { numero: `${1000 + i}/UF` }), [0]));

    expect(juntarEquivalentes(muitos).acordaos).toHaveLength(300);
  });

  it("mesmo número de processo com datas e ementas diferentes (recurso × embargos) continuam dois acórdãos", () => {
    const recurso = registro("701", { numero: NUMERO_COMPARTILHADO });
    const embargos = registro("702", {
      numero: NUMERO_COMPARTILHADO,
      dataJulgamento: "2024-06-10",
      ementa: "EMBARGOS DE DECLARAÇÃO NA APELAÇÃO. OMISSÃO FICTÍCIA. EMBARGOS REJEITADOS.",
    });

    expect(juntarEquivalentes([ocorrencia(recurso, [0]), ocorrencia(embargos, [0])]).acordaos).toHaveLength(2);
  });

  it("o mesmo número escrito com e sem a sigla da classe não é contradição", () => {
    const { acordaos } = juntarEquivalentes([
      ocorrencia(registro("731", { numero: "ApCiv 0007333-00.2024.8.99.0001" }), [0]),
      ocorrencia(registro("732", { numero: "0007333-00.2024.8.99.0001" }), [1]),
    ]);

    expect(acordaos).toHaveLength(1);
  });

  it("registro sem número não se junta quando a mesma ementa tem dois números de verdade (não há a qual juntar)", () => {
    const { acordaos } = juntarEquivalentes([
      ocorrencia(registro("711", { numero: "0007111-00.2024.8.99.0001" }), [0]),
      ocorrencia(registro("712", { numero: "0007222-00.2024.8.99.0001" }), [0]),
      ocorrencia(registro("713", { semNumero: true }), [0]),
    ]);

    expect(acordaos).toHaveLength(3);
  });

  it("'sem número' vem do sinal explícito, não do texto do número", () => {
    // Os dois "números" são ids do site, diferentes entre si; o sinal diz que não são números de verdade.
    const sinalizados = [registro("721", { semNumero: true }), registro("722", { semNumero: true })];
    // Os mesmos textos sem o sinal são tratados como números de verdade, que se contradizem.
    const semSinal = [registro("721", { semNumero: false }), registro("722", { semNumero: false })];

    expect(juntarEquivalentes(sinalizados.map((r) => ocorrencia(r, [0]))).acordaos).toHaveLength(1);
    expect(juntarEquivalentes(semSinal.map((r) => ocorrencia(r, [0]))).acordaos).toHaveLength(2);
  });

  it("junta 1.000 registros em tempo desprezível, mesmo no pior caso (todos com a mesma ementa e data)", () => {
    // 500 acórdãos fictícios de ementa idêntica, cada um em duas cópias com o mesmo número.
    const ocorrencias = Array.from({ length: 1000 }, (_, i) =>
      ocorrencia(registro(`${9000 + i}`, { numero: `${Math.floor(i / 2)}/UF` }), [i % 2]),
    );

    const inicio = performance.now();
    const { acordaos } = juntarEquivalentes(ocorrencias);
    const decorrido = performance.now() - inicio;

    expect(acordaos).toHaveLength(500);
    expect(acordaos.every((a) => a.formulacoes.size === 2)).toBe(true);
    expect(decorrido).toBeLessThan(250);
  });

  it("ementa vazia nunca junta", () => {
    const vazias = [registro("301", { ementa: "", semNumero: true }), registro("302", { ementa: " Ementa:  ", semNumero: true })];

    expect(juntarEquivalentes(vazias.map((r) => ocorrencia(r, [0]))).acordaos).toHaveLength(2);
  });

  it("registro sem data de julgamento nunca junta", () => {
    const semData = [registro("401", { dataJulgamento: undefined }), registro("402", { dataJulgamento: undefined, semNumero: true })];

    expect(juntarEquivalentes(semData.map((r) => ocorrencia(r, [0]))).acordaos).toHaveLength(2);
  });

  it.each([
    {
      caso: "órgão julgador vence a falta dele",
      fica: registro("601", { numero: NUMERO_COMPARTILHADO, orgao: "Câmara Exemplo" }),
      sai: registro("602", { numero: NUMERO_COMPARTILHADO }),
    },
    {
      caso: "link do inteiro teor vence a falta dele",
      fica: registro("611", { numero: NUMERO_COMPARTILHADO, orgao: "Câmara Exemplo", link: "https://exemplo.test/611" }),
      sai: registro("612", { numero: NUMERO_COMPARTILHADO, orgao: "Câmara Exemplo" }),
    },
    {
      caso: "página de consulta oficial também conta como link",
      fica: registro("621", { numero: NUMERO_COMPARTILHADO, linkConsulta: "https://exemplo.test/consulta/621" }),
      sai: registro("622", { numero: NUMERO_COMPARTILHADO }),
    },
  ])("fica o registro mais completo: $caso", ({ fica, sai }) => {
    const { acordaos } = juntarEquivalentes([ocorrencia(sai, [0], 0), ocorrencia(fica, [1], 5)]);

    expect(acordaos).toHaveLength(1);
    expect(acordaos[0].registro).toBe(fica);
    expect(acordaos[0].melhorPosicao).toBe(0);
  });

  it("empatados no resto, fica o registro na melhor posição", () => {
    const pior = registro("631", { numero: NUMERO_COMPARTILHADO });
    const melhor = registro("632", { numero: NUMERO_COMPARTILHADO });

    const { acordaos } = juntarEquivalentes([ocorrencia(pior, [0], 7), ocorrencia(melhor, [1], 2)]);

    expect(acordaos[0].registro).toBe(melhor);
  });

  it("o id de qualquer das cópias encontra o acórdão juntado", () => {
    const resultado = juntarEquivalentes([
      ocorrencia(registro("501", { semNumero: true }), [0]),
      ocorrencia(registro("502", { numero: "0005555-66.2024.8.99.0001" }), [1]),
    ]);

    const [acordao] = resultado.acordaos;
    expect(resultado.porId.get("tjxx:501")).toBe(acordao);
    expect(resultado.porId.get("tjxx:502")).toBe(acordao);
  });
});
