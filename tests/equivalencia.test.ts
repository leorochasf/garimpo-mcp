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

describe("equivalência no TJPR (ADR-0030): o mesmo documento do portal no link é o mesmo acórdão", () => {
  const CNJ = "0000001-11.2024.8.16.0001";
  const comOrgao = (id: string, extra: Partial<Registro> = {}): Registro =>
    registro(id, {
      id: `tjpr:${id}`,
      tribunal: "tjpr",
      numero: CNJ,
      orgao: "99ª Câmara Cível",
      ementa: `EMENTA: APELAÇÃO. EXEMPLO FICTÍCIO. (TJPR - 99ª Câmara Cível - ${CNJ} - Cidade - J. 05.03.2024)`,
      link: `https://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001/Ac%C3%B3rd%C3%A3o-${CNJ}`,
      ...extra,
    });
  const doOutroLote = (id: string, extra: Partial<Registro> = {}): Registro =>
    comOrgao(id, {
      orgao: undefined,
      ementa: `Ementa: APELAÇÃO. EXEMPLO FICTÍCIO. (TJPR – AC ${CNJ}, julg.: 05/03/2024, public.: 07/03/2024)`,
      link: "https://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001/Acórdão",
      ...extra,
    });

  it("cópias de lotes diferentes, com rodapés de ementa diferentes, viram um acórdão só; fica a com órgão", () => {
    const fica = comOrgao("701");
    const { acordaos, porId } = juntarEquivalentes([ocorrencia(doOutroLote("702"), [0], 0), ocorrencia(fica, [1], 1)]);

    expect(acordaos).toHaveLength(1);
    expect(acordaos[0].registro).toBe(fica);
    expect(acordaos[0].melhorPosicao).toBe(0);
    expect(porId.get("tjpr:702")).toBe(acordaos[0]);
  });

  it("documentos diferentes no link continuam acórdãos distintos, mesmo com a mesma ementa", () => {
    const outro = doOutroLote("704", { link: "https://portal.tjpr.jus.br/jurisprudencia/j/4100000000000009/Acórdão" });
    const { acordaos } = juntarEquivalentes([ocorrencia(comOrgao("703"), [0]), ocorrencia(outro, [0])]);
    expect(acordaos).toHaveLength(2);
  });

  it("mesmo documento com números de processo que se contradizem: não junta", () => {
    const outro = doOutroLote("706", { numero: "0000002-22.2024.8.16.0001" });
    const { acordaos } = juntarEquivalentes([ocorrencia(comOrgao("705"), [0]), ocorrencia(outro, [0])]);
    expect(acordaos).toHaveLength(2);
  });

  it("o link no formato do portal do TJPR não junta registros de outro tribunal", () => {
    const deOutro = (id: string, ementa: string) =>
      comOrgao(id, { id: `tjxx:${id}`, tribunal: "tjxx", ementa });
    const { acordaos } = juntarEquivalentes([
      ocorrencia(deOutro("707", "APELAÇÃO. UMA EMENTA."), [0]),
      ocorrencia(deOutro("708", "APELAÇÃO. OUTRA EMENTA."), [0]),
    ]);
    expect(acordaos).toHaveLength(2);
  });
});

describe("equivalência no TJRS: as duas cópias da base juntam pela regra geral", () => {
  // Par visto na base: uma cópia com «Ementa:» no começo e link da consulta processual, outra sem o prefixo, com o
  // número sem máscara e link do ementário. Dados fictícios.
  const CNJ = "0000001-11.2021.8.21.0001";
  const daConsulta = (id: string, extra: Partial<Registro> = {}): Registro =>
    registro(id, {
      id: `tjrs:${id}`,
      tribunal: "tjrs",
      numero: CNJ,
      orgao: "99ª Câmara Cível",
      ementa: "Ementa: APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO. DANO MORAL. RECURSO DESPROVIDO.",
      linkConsulta: `https://consulta.tjrs.jus.br/consulta-processual/processo/resumo?numeroProcesso=${CNJ.replace(/\D/g, "")}`,
      ...extra,
    });
  const doEmentario = (id: string, extra: Partial<Registro> = {}): Registro =>
    daConsulta(id, {
      numero: CNJ.replace(/\D/g, ""),
      ementa: "APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO. DANO MORAL. RECURSO DESPROVIDO.",
      linkConsulta: `https://www.tjrs.jus.br/novo/buscas-solr/?aba=jurisprudencia&q=${CNJ}&site=ementario`,
      ...extra,
    });

  it("cópia com «Ementa:» e cópia sem o prefixo, de links diferentes, viram um acórdão só", () => {
    const { acordaos, porId } = juntarEquivalentes([ocorrencia(daConsulta("801"), [0]), ocorrencia(doEmentario("802"), [1])]);

    expect(acordaos).toHaveLength(1);
    expect(porId.get("tjrs:801")).toBe(acordaos[0]);
    expect(porId.get("tjrs:802")).toBe(acordaos[0]);
  });

  it("mesma ementa e data com números de processo diferentes continuam acórdãos distintos", () => {
    const outro = doEmentario("804", { numero: "00000022220218210001" });
    expect(juntarEquivalentes([ocorrencia(daConsulta("803"), [0]), ocorrencia(outro, [0])]).acordaos).toHaveLength(2);
  });
});

describe("equivalência no TJBA: o mesmo documento do portal no link é o mesmo acórdão", () => {
  // Par visto na base: o mesmo link do portal e o mesmo número em duas cópias com datas diferentes (5 dias); o texto
  // só muda na data do rodapé, que acompanha a do campo. Dados fictícios.
  const CNJ = "0000001-11.2018.8.05.0001";
  const UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const linkDoPortal = (uuid: string) => `https://jurisprudenciaws.tjba.jus.br/inteiroTeor/${uuid}`;
  const comRodape = (publicado: string) =>
    `APELAÇÃO. EXEMPLO FICTÍCIO. RECURSO PROVIDO. ( Classe: Apelação,Número do Processo: ${CNJ},` +
    `Relator(a): EXEMPLO,Publicado em: ${publicado} )`;
  const copia = (id: string, extra: Partial<Registro> = {}): Registro =>
    registro(id, {
      id: `tjba:${id}`,
      tribunal: "tjba",
      numero: CNJ,
      orgao: "99ª Câmara Cível",
      dataJulgamento: "2024-03-20",
      ementa: comRodape("20/03/2024"),
      link: linkDoPortal(UUID),
      ...extra,
    });
  const daOutraData = (id: string, extra: Partial<Registro> = {}): Registro =>
    copia(id, { dataJulgamento: "2024-03-15", ementa: comRodape("15/03/2024"), ...extra });

  it("cópias com o mesmo documento no link e datas diferentes viram um acórdão só", () => {
    const { acordaos, porId } = juntarEquivalentes([ocorrencia(copia("901"), [0], 3), ocorrencia(daOutraData("902"), [1], 1)]);

    expect(acordaos).toHaveLength(1);
    expect(acordaos[0].melhorPosicao).toBe(1);
    expect([...acordaos[0].formulacoes].sort()).toEqual([0, 1]);
    expect(porId.get("tjba:901")).toBe(acordaos[0]);
  });

  it("o documento vale também na página de consulta e sem diferença de maiúsculas", () => {
    const naConsulta = daOutraData("904", { link: undefined, linkConsulta: linkDoPortal(UUID.toUpperCase()) });
    expect(juntarEquivalentes([ocorrencia(copia("903"), [0]), ocorrencia(naConsulta, [0])]).acordaos).toHaveLength(1);
  });

  it("mesmo documento com números de processo que se contradizem: não junta", () => {
    const outro = daOutraData("906", { numero: "0000002-22.2018.8.05.0001" });
    expect(juntarEquivalentes([ocorrencia(copia("905"), [0]), ocorrencia(outro, [0])]).acordaos).toHaveLength(2);
  });

  it.each([
    { caso: "documento diferente", link: linkDoPortal("ffffffff-4e5f-4a6b-8c7d-9e0f1a2b3c4d") },
    { caso: "sem https", link: `http://jurisprudenciaws.tjba.jus.br/inteiroTeor/${UUID}` },
    { caso: "outro host", link: `https://exemplo.test/inteiroTeor/${UUID}` },
    { caso: "outro caminho", link: `https://jurisprudenciaws.tjba.jus.br/inteiroTeor/${UUID}/anexo` },
  ])("não junta pelo link quando é $caso", ({ link }) => {
    const { acordaos } = juntarEquivalentes([ocorrencia(copia("907"), [0]), ocorrencia(daOutraData("908", { link }), [0])]);
    expect(acordaos).toHaveLength(2);
  });

  it("o link no formato do portal do TJBA não junta registros de outro tribunal", () => {
    const deOutro = (id: string) => daOutraData(id, { id: `tjxx:${id}`, tribunal: "tjxx" });
    const { acordaos } = juntarEquivalentes([
      ocorrencia(copia("909", { id: "tjxx:909", tribunal: "tjxx" }), [0]),
      ocorrencia(deOutro("910"), [0]),
    ]);
    expect(acordaos).toHaveLength(2);
  });
});
