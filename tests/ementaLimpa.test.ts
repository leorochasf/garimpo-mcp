import { describe, expect, it } from "vitest";
import { limparEmenta } from "../src/ementaLimpa.js";

// Fixtures saneadas: a estrutura (marcadores, ordem das partes, pontuação dos rótulos) é a vista na base do site em
// 2026-10-29; nomes, números de processo, endereços e textos são fictícios.

/** Ementa fictícia, com quebra de linha dentro dela, como vêm algumas da base. */
const EMENTA =
  "EMENTA Apelação Cível. Exemplo fictício. Dano moral.\n1. Caso de exemplo, sem parte real.\n2. Recurso desprovido.";

describe("ementa limpa: a ementa repetida no campo fica uma vez só", () => {
  it("campo com a mesma ementa 6 vezes: fica uma, literal, e vem aviso com a contagem", () => {
    const limpa = limparEmenta("tjxx", Array(6).fill(EMENTA).join(" "));

    expect(limpa.ementa).toBe(EMENTA);
    expect(limpa.aviso).toContain("6 vezes");
    expect(limpa.separacaoIncerta).toBeUndefined();
  });

  it("TJRJ: 6 cópias e o rodapé do site no fim: fica a última cópia com o rodapé, trecho contínuo da fonte", () => {
    const rodape = "(0000001-11.2024.8.19.0001 - APELAÇÃO. Des(a). EXEMPLO - Julgamento: 03/02/2026 - CÂMARA (ANTIGA 9ª))";
    const campo = `${Array(6).fill(EMENTA).join(" ")} ${rodape}`;

    const limpa = limparEmenta("tjrj", campo);

    expect(limpa.ementa).toBe(`${EMENTA} ${rodape}`);
    expect(campo.endsWith(limpa.ementa)).toBe(true);
    expect(limpa.aviso).toContain("6 vezes");
  });

  it("a separação entre as cópias pode variar (espaços, quebras de linha); fica a última como está na fonte", () => {
    const campo = `${EMENTA.replace(/\n/g, " ")}\n\n${EMENTA}  ${EMENTA}\n`;

    const limpa = limparEmenta("tjxx", campo);

    expect(limpa.ementa).toBe(EMENTA);
    expect(limpa.aviso).toContain("3 vezes");
  });

  it.each([
    { caso: "ementa sem repetição", campo: EMENTA },
    { caso: "duas ementas diferentes", campo: `${EMENTA} ${EMENTA.replace("desprovido", "provido")}` },
    { caso: "repetição seguida de texto que não é rodapé", campo: `${EMENTA} ${EMENTA} Outro texto qualquer.` },
    { caso: "repetição cortada no meio", campo: `${EMENTA} ${EMENTA.slice(0, 40)}` },
    { caso: "campo vazio", campo: "" },
  ])("$caso: o campo fica como veio, sem aviso", ({ campo }) => {
    expect(limparEmenta("tjxx", campo)).toEqual({ ementa: campo });
  });
});

describe("ementa limpa: cabeçalho do processo antes da ementa (TJPE, TJMT, TJPB)", () => {
  const TJPE =
    "Ementa: Tribunal de Justiça de Pernambuco Poder Judiciário Gabinete do Des. Fulano Exemplo (1ª TCRC) - F:( ) " +
    "APELAÇÃO CÍVEL (198) nº 0000001-11.2020.8.17.0001 APELANTE:EMPRESA EXEMPLO LTDA APELADO(A):PESSOA FICTÍCIA " +
    "Ementa: DIREITO DO CONSUMIDOR. APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO. DESPROVIMENTO. I. CASO EM EXAME Apelação de " +
    "exemplo. IV. DISPOSITIVO E TESE 5. Apelação desprovida. (APELAÇÃO CÍVEL 0000001-11.2020.8.17.0001, Rel. FULANO " +
    "EXEMPLO, Gabinete do Des. Fulano Exemplo (1ª TCRC), julgado em 31/10/2024, DJe )";
  const TJMT =
    "Recurso Inominado: 0000001-11.2021.8.11.0001 Origem: JUIZADO ESPECIAL CÍVEL EXEMPLO Recorrente(s): PESSOA " +
    "FICTÍCIA Recorrido(s): EMPRESA EXEMPLO S.A. Juiz Relator: Fulano Exemplo Data do Julgamento: 05/05/2022 EMENTA " +
    "RECURSO INOMINADO – RELAÇÃO DE CONSUMO – EXEMPLO FICTÍCIO – RECURSO CONHECIDO E PARCIALMENTE PROVIDO. Texto de " +
    "exemplo. (TJ-MT, RECURSO INOMINADO 0000001-11.2021.8.11.0001, Relator(a) FULANO EXEMPLO, TURMA RECURSAL ÚNICA, " +
    "Julgado em 05/05/2022, Publicado em 06/05/2022)";
  const TJPB =
    "Ementa: Poder Judiciário Tribunal de Justiça da Paraíba Gabinete 99 - Des. Fulano Exemplo ACÓRDÃO APELAÇÃO CÍVEL " +
    "Nº 0000001-11.2024.8.15.0001 Origem : 9ª Vara Exemplo Relator : Des. Fulano Exemplo Apelante : Pessoa Fictícia " +
    "Advogado : Advogado Fictício - OAB PB00000-A A pela do : Empresa Exemplo d e Seguro Advogado : Outro Fictício - " +
    "OAB PB00001-A Ementa : DIREITO CIVIL. APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO. RECURSO DESPROVIDO. I. CASO EM EXAME " +
    "Apelação de exemplo. IV. DISPOSITIVO E TESE Recurso desprovido.\n\n(0000001-11.2024.8.15.0001, Rel. Gabinete 99 - " +
    "Des. Fulano Exemplo, APELAÇÃO CÍVEL, 2ª Câmara Cível, juntado em 24/07/2025)";

  it.each([
    { tribunal: "tjpe", campo: TJPE, comeco: "Ementa: DIREITO DO CONSUMIDOR.", nome: "PESSOA FICTÍCIA" },
    { tribunal: "tjmt", campo: TJMT, comeco: "EMENTA RECURSO INOMINADO –", nome: "PESSOA FICTÍCIA" },
    { tribunal: "tjpb", campo: TJPB, comeco: "Ementa : DIREITO CIVIL.", nome: "Pessoa Fictícia" },
  ])("$tribunal: fica da ementa até o fim do campo (com o rodapé), sem o cabeçalho com nomes", ({ tribunal, campo, comeco, nome }) => {
    const limpa = limparEmenta(tribunal, campo);

    expect(limpa.ementa.startsWith(comeco)).toBe(true);
    expect(campo.endsWith(limpa.ementa)).toBe(true);
    expect(limpa.ementa).not.toContain(nome);
    expect(limpa.aviso).toContain("cabeçalho");
    expect(limpa.separacaoIncerta).toBeUndefined();
  });

  it("ementa sem cabeçalho (um só marcador, no começo) fica como veio", () => {
    const campo = "Ementa: DIREITO DO CONSUMIDOR. APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO. DESPROVIMENTO.";
    expect(limparEmenta("tjpe", campo)).toEqual({ ementa: campo });
  });

  it("outro tribunal com o mesmo formato fica como veio (a regra é só dos tribunais em que foi vista)", () => {
    expect(limparEmenta("tjxx", TJPE)).toEqual({ ementa: TJPE });
  });
});

describe("ementa limpa: decisão inteira no campo (TJBA)", () => {
  const TURMA =
    "EMENTA: Tribunal de Justiça do Estado da Bahia PODER JUDICIÁRIO SEGUNDA TURMA RECURSAL - PROJUDI RUA EXEMPLO, " +
    "SALVADOR - BA exemplo@exemplo.test - Tel.: 00 0000-0000 PROCESSO Nº 0000001-11.2024.8.05.0001 RECORRENTE: EMPRESA " +
    "EXEMPLO S A RECORRIDO: PESSOA FICTÍCIA ORIGEM: 99ª VSJE EXEMPLO RELATORA: JUÍZA FULANA EXEMPLO E M E N T A RECURSO " +
    "INOMINADO. CONSUMIDOR. EXEMPLO FICTÍCIO. MERO ABORRECIMENTO. SENTENÇA REFORMADA. RECURSO CONHECIDO E PROVIDO. " +
    "RELATÓRIO Trata-se de recurso inominado de exemplo. Presentes as condições de admissibilidade do recurso, dele " +
    "conheço. VOTO Na origem, alegou a parte autora um fato fictício. Trecho só do voto, para a conferência. Sem custas. " +
    "FULANA EXEMPLO Juíza Relatora ( Classe: Recurso Inominado,Número do Processo: 0000001-11.2024.8.05.0001," +
    "Relator(a): FULANA EXEMPLO,Publicado em: 27/01/2025 )";
  const CAMARA =
    "EMENTA: PODER JUDICIÁRIO TRIBUNAL DE JUSTIÇA DO ESTADO DA BAHIA Segunda Câmara Cível Processo: APELAÇÃO CÍVEL n. " +
    "0000001-11.2013.8.05.0001 Órgão Julgador: Segunda Câmara Cível APELANTE: PESSOA FICTÍCIA e outros (2) Advogado(s): " +
    "ADVOGADO FICTÍCIO APELADO: EMPRESA EXEMPLO LTDA Advogado(s):OUTRO FICTÍCIO ACORDÃO Ementa: DIREITO CIVIL. APELAÇÃO " +
    "CÍVEL. EXEMPLO FICTÍCIO. RECURSO PARCIALMENTE PROVIDO. I. CASO EM EXAME 1. Apelação de exemplo; o relatório da " +
    "sentença é citado aqui. IV. DISPOSITIVO E TESE 8. Recurso parcialmente provido. Jurisprudência relevante citada: " +
    "STJ, Súmula nº 000. ACÓRDÃO Vistos relatados e discutidos os presentes autos de RECURSO DE APELAÇÃO nº " +
    "0000001-11.2013.8.05.0001. ACORDAM os Desembargadores, nos termos do voto do Relator. Sala das sessões, Presidente " +
    "Relator Procurador(a) de Justiça ( Classe: Apelação,Número do Processo: 0000001-11.2013.8.05.0001,Relator(a): " +
    "FULANO EXEMPLO,Publicado em: 18/03/2026 )";

  it("Turma Recursal: fica só a ementa, entre «E M E N T A» e o «RELATÓRIO»; o voto não entra", () => {
    const limpa = limparEmenta("tjba", TURMA);

    expect(limpa.ementa).toBe(
      "E M E N T A RECURSO INOMINADO. CONSUMIDOR. EXEMPLO FICTÍCIO. MERO ABORRECIMENTO. SENTENÇA REFORMADA. RECURSO " +
        "CONHECIDO E PROVIDO.",
    );
    expect(limpa.ementa).not.toContain("Trecho só do voto");
    expect(limpa.aviso).toContain("decisão inteira");
    expect(limpa.separacaoIncerta).toBeUndefined();
  });

  it("Câmara Cível: fica a ementa, do «Ementa:» depois do cabeçalho até o «ACÓRDÃO Vistos»", () => {
    const limpa = limparEmenta("tjba", CAMARA);

    expect(limpa.ementa.startsWith("Ementa: DIREITO CIVIL.")).toBe(true);
    expect(limpa.ementa.endsWith("Jurisprudência relevante citada: STJ, Súmula nº 000.")).toBe(true);
    expect(limpa.ementa).not.toContain("PESSOA FICTÍCIA");
    expect(limpa.ementa).not.toContain("ACORDAM");
  });

  it("sem o fim da ementa reconhecível: vai só o começo, a partir da ementa, com aviso e separação incerta", () => {
    const semFim = TURMA.replace("RELATÓRIO", "Relato").replace("VOTO", "Voto");

    const limpa = limparEmenta("tjba", semFim);

    expect(limpa.separacaoIncerta).toBe(true);
    expect(limpa.ementa.startsWith("E M E N T A RECURSO INOMINADO.")).toBe(true);
    expect(semFim).toContain(limpa.ementa);
    expect(limpa.ementa.length).toBeLessThan(semFim.length);
    expect(limpa.aviso).toContain("começo");
  });

  it("sem marcador de ementa e com o relatório e o voto no campo: só o começo, com aviso", () => {
    const semMarcador = TURMA.replace("E M E N T A", "-").replace(/^EMENTA: /, "");

    const limpa = limparEmenta("tjba", semMarcador);

    expect(limpa.separacaoIncerta).toBe(true);
    expect(semMarcador.startsWith(limpa.ementa)).toBe(true);
    expect(limpa.ementa.length).toBeLessThan(semMarcador.length);
  });

  it("campo do TJBA que é só a ementa fica como veio", () => {
    const campo = "RECURSO INOMINADO. CONSUMIDOR. EXEMPLO FICTÍCIO. RECURSO CONHECIDO E PROVIDO.";
    expect(limparEmenta("tjba", campo)).toEqual({ ementa: campo });
  });
});
