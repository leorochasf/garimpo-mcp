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

  // Ticket 20: o modelo da Câmara sem 2º «Ementa:»; o cabeçalho acaba em «ACORDÃO» e a ementa vai até o fecho.
  // Estrutura do tjba:460750 (cru da API, 2026-10-29); nomes, números e textos fictícios.
  const FECHO =
    "O campo de ementa do JurisprudênciaIA traz, além da ementa, o cabeçalho do processo e o fecho do acórdão, com " +
    "nomes das partes; o Garimpo mostra só a ementa, com o texto como veio. O resto fica no inteiro teor.";
  const EMENTA_CAMARA_2 =
    "DIREITO CIVIL E PROCESSUAL CIVIL. APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO. DANO MORAL. RECURSO CONHECIDO E PROVIDO. I. " +
    "CASO EM EXAME Apelação Cível interposta pela EMPRESA EXEMPLO em face da sentença de exemplo. IV. DISPOSITIVO E " +
    "TESE Recurso conhecido e provido. Jurisprudência relevante citada: STJ - AgInt no AREsp: 0000000 SP, Relator.: " +
    "Ministro FICTÍCIO, Data de Julgamento: 03/06/2024, T4 - QUARTA TURMA, Data de Publicação: DJe 07/06/2024";
  const CAMARA_2 =
    "EMENTA: PODER JUDICIÁRIO TRIBUNAL DE JUSTIÇA DO ESTADO DA BAHIA Quinta Câmara Cível Processo: APELAÇÃO CÍVEL n. " +
    "0000002-22.2018.8.05.0001 Órgão Julgador: Quinta Câmara Cível APELANTE: EMPRESA EXEMPLO LTDA Advogado(s): " +
    "ADVOGADO FICTÍCIO, OUTRA FICTÍCIA APELADO: PESSOA FICTÍCIA e outros Advogado(s):TERCEIRO FICTÍCIO ACORDÃO " +
    `${EMENTA_CAMARA_2} Vistos, relatados e discutidos estes autos de Apelação Cível nº 0000002-22.2018.8.05.0001, ` +
    "oriundos da Comarca de Exemplo, em que figuram como Apelante a EMPRESA EXEMPLO LTDA e como Apelados PESSOA " +
    "FICTÍCIA e OUTRA PESSOA FICTÍCIA. Acordam os Desembargadores integrantes da Quinta Câmara Cível, à unanimidade, " +
    "em DAR PROVIMENTO AO RECURSO, nos termos do voto condutor. Des. FULANO EXEMPLO Presidente / Relator 03 ( Classe: " +
    "Apelação,Número do Processo: 0000002-22.2018.8.05.0001,Relator(a): FULANO EXEMPLO,Publicado em: 15/10/2025 )";

  it("Câmara Cível sem 2º «Ementa:»: fica a ementa, do fim do cabeçalho («ACORDÃO») até o fecho, com o aviso do fecho", () => {
    const limpa = limparEmenta("tjba", CAMARA_2);

    expect(limpa).toEqual({ ementa: EMENTA_CAMARA_2, aviso: FECHO });
    expect(limpa.ementa).not.toContain("PESSOA FICTÍCIA");
    expect(limpa.ementa).not.toContain("Classe:");
  });

  it("Câmara Cível com «ACORDÃO Ementa:» (tjba:645551): a mesma ementa de antes, byte a byte, com o aviso do fecho", () => {
    const antes = CAMARA.slice(CAMARA.indexOf("Ementa: DIREITO CIVIL."), CAMARA.indexOf(" ACÓRDÃO Vistos"));

    expect(limparEmenta("tjba", CAMARA)).toEqual({ ementa: antes, aviso: FECHO });
  });

  it("Turma Recursal (corte pelo RELATÓRIO): segue com o aviso da decisão inteira", () => {
    expect(limparEmenta("tjba", TURMA).aviso).toContain("relatório e voto");
  });

  it("Câmara Cível sem 2º «Ementa:» e sem o fecho reconhecível: só o começo, a partir da ementa, com C1", () => {
    const semFecho = CAMARA_2.replace("Vistos, relatados", "Examinados");

    const limpa = limparEmenta("tjba", semFecho);

    expect(limpa.separacaoIncerta).toBe(true);
    expect(limpa.ementa.startsWith("DIREITO CIVIL E PROCESSUAL CIVIL.")).toBe(true);
    expect(limpa.ementa).not.toContain("APELANTE");
    expect(semFecho).toContain(limpa.ementa);
  });

  it.each([
    ["sem rótulo de parte antes", "DIREITO CIVIL. ACÓRDÃO RECORRIDO MANTIDO. EXEMPLO FICTÍCIO. RECURSO DESPROVIDO."],
    ["só «ACÓRDÃO Vistos»", "EMENTA: DIREITO CIVIL. EXEMPLO. APELANTE: NOME ACÓRDÃO Vistos e relatados. Exemplo."],
  ])("«ACÓRDÃO» que não fecha cabeçalho (%s): não vira começo da ementa", (_caso, campo) => {
    const limpa = limparEmenta("tjba", campo);
    expect(limpa.ementa.startsWith("Vistos")).toBe(false);
    if (!/APELANTE/.test(campo)) expect(limpa).toEqual({ ementa: campo });
  });

  // B20-R01: um «APELANTE:» solto no corpo não faz do «ACÓRDÃO» interno um fim de cabeçalho.
  it.each([
    "EMENTA: DIREITO PROCESSUAL. ALEGAÇÃO DO APELANTE: AUSÊNCIA DE FUNDAMENTAÇÃO. ACÓRDÃO RECORRIDO MANTIDO. RECURSO DESPROVIDO.",
    "EMENTA: DIREITO CIVIL. APELANTE: EXEMPLO. APELADO: OUTRO. ACÓRDÃO RECORRIDO MANTIDO. RECURSO DESPROVIDO.",
    "EMENTA: PODER JUDICIÁRIO. ALEGAÇÃO DO APELANTE: EXEMPLO. ACÓRDÃO RECORRIDO MANTIDO. RECURSO DESPROVIDO.",
  ])("«ACÓRDÃO» interno sem a ficha do cabeçalho antes (%s): o campo fica como veio", (campo) => {
    expect(limparEmenta("tjba", campo)).toEqual({ ementa: campo });
  });

  // B20-R02: «Vistos, relatados» dentro da ementa não é o fecho.
  const INTERNA = "A FÓRMULA Vistos, relatados e discutidos NÃO SUPRE A FUNDAMENTAÇÃO.";
  it("Câmara sem 2º «Ementa:», com a expressão dentro da ementa e o fecho de verdade depois: a ementa vai até o fecho", () => {
    const campo = CAMARA_2.replace("RECURSO CONHECIDO E PROVIDO. I.", `${INTERNA} RECURSO CONHECIDO E PROVIDO. I.`);

    const limpa = limparEmenta("tjba", campo);

    const ementa = EMENTA_CAMARA_2.replace("RECURSO CONHECIDO E PROVIDO. I.", `${INTERNA} RECURSO CONHECIDO E PROVIDO. I.`);
    expect(limpa).toEqual({ ementa, aviso: FECHO });
  });

  it.each([
    ["sem rodapé «( Classe:»", (c: string) => c.slice(0, c.indexOf(" ( Classe:"))],
    ["sem «Acordam»", (c: string) => c.replace("Acordam os Desembargadores", "Os Desembargadores")],
  ])("Câmara sem 2º «Ementa:», com a expressão dentro da ementa e fecho não confirmado (%s): começo + C1", (_caso, tirar) => {
    const campo = tirar(CAMARA_2.replace("RECURSO CONHECIDO E PROVIDO. I.", `${INTERNA} RECURSO CONHECIDO E PROVIDO. I.`));

    const limpa = limparEmenta("tjba", campo);

    expect(limpa.separacaoIncerta).toBe(true);
    expect(limpa.ementa.startsWith("DIREITO CIVIL E PROCESSUAL CIVIL.")).toBe(true);
    expect(limpa.ementa).toContain("NÃO SUPRE");
  });

  // B20-R02, rodada 2: a única ocorrência é a interna; o fecho verdadeiro não usa a expressão.
  it.each([
    [
      "cenário do parecer",
      "EMENTA: PODER JUDICIÁRIO Processo: EXEMPLO APELANTE: PESSOA FICTÍCIA APELADO: OUTRA PESSOA ACORDÃO DIREITO " +
        "PROCESSUAL. A FÓRMULA Vistos, relatados e discutidos NÃO SUPRE A FUNDAMENTAÇÃO. RECURSO PROVIDO. Examinados " +
        "estes autos. Acordam os julgadores. ( Classe: Apelação )",
    ],
    [
      "contraprova: o «Vistos» do fecho real trocado",
      CAMARA_2.replace("RECURSO CONHECIDO E PROVIDO. I.", `${INTERNA} RECURSO CONHECIDO E PROVIDO. I.`).replace(
        "Vistos, relatados e discutidos estes autos",
        "Examinados estes autos",
      ),
    ],
  ])("expressão interna sem fecho verdadeiro com ela (%s): começo + C1, com a fundamentação", (_caso, campo) => {
    const limpa = limparEmenta("tjba", campo);

    expect(limpa.separacaoIncerta).toBe(true);
    expect(limpa.ementa.startsWith("DIREITO")).toBe(true);
    expect(limpa.ementa).toContain("NÃO SUPRE");
  });

  it("modelos antigos com a expressão dentro da ementa: o fim antigo vale, como antes", () => {
    const turma = TURMA.replace("MERO ABORRECIMENTO.", `MERO ABORRECIMENTO. ${INTERNA}`);
    const camara = CAMARA.replace("EXEMPLO FICTÍCIO. RECURSO", `EXEMPLO FICTÍCIO. ${INTERNA} RECURSO`);

    expect(limparEmenta("tjba", turma).ementa.endsWith("RECURSO CONHECIDO E PROVIDO.")).toBe(true);
    expect(limparEmenta("tjba", turma).ementa).toContain("NÃO SUPRE");
    expect(limparEmenta("tjba", camara).ementa.endsWith("Jurisprudência relevante citada: STJ, Súmula nº 000.")).toBe(true);
    expect(limparEmenta("tjba", camara).separacaoIncerta).toBeUndefined();
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

  // B05-R01: as regras se compõem; a repetição escolhe a cópia, e a separação do tribunal continua sobre ela.
  it("decisão inteira repetida 2 vezes: fica uma vez e só a ementa, com os dois avisos", () => {
    const campo = `${TURMA} ${TURMA}`;

    const limpa = limparEmenta("tjba", campo);

    expect(limpa.ementa.startsWith("E M E N T A RECURSO INOMINADO.")).toBe(true);
    expect(limpa.ementa.endsWith("RECURSO CONHECIDO E PROVIDO.")).toBe(true);
    expect(limpa.ementa).not.toContain("Trecho só do voto");
    expect(campo).toContain(limpa.ementa);
    expect(limpa.aviso).toContain("2 vezes");
    expect(limpa.aviso).toContain("decisão inteira");
    expect(limpa.separacaoIncerta).toBeUndefined();
  });

  it("decisão inteira repetida sem o fim reconhecível: incerta", () => {
    const semFim = TURMA.replace("RELATÓRIO", "Relato").replace("VOTO", "Voto");
    const limpa = limparEmenta("tjba", `${semFim} ${semFim}`);
    expect(limpa.separacaoIncerta).toBe(true);
    expect(limpa.aviso).toContain("2 vezes");
  });

  // B05-R02: títulos de relatório e voto com pontuação ou outra caixa não deixam o voto passar por ementa.
  it.each([
    "EMENTA: DIREITO CIVIL. EXEMPLO FICTÍCIO. RELATÓRIO: Relato fictício. VOTO: Trecho só do voto.",
    "EMENTA: DIREITO CIVIL. EXEMPLO FICTÍCIO. Relatório: Relato fictício. Voto: Trecho só do voto.",
    "EMENTA: DIREITO CIVIL. EXEMPLO FICTÍCIO. RELATORIO - Relato fictício. VOTO - Trecho só do voto.",
    "EMENTA: DIREITO CIVIL. EXEMPLO FICTÍCIO. relatório: Relato fictício. voto: Trecho só do voto.",
  ])("títulos com pontuação ou outra caixa (%s): incerta, nunca o campo inteiro como ementa segura", (campo) => {
    const limpa = limparEmenta("tjba", campo);
    expect(limpa.separacaoIncerta).toBe(true);
    expect(limpa.aviso).toContain("começo");
  });

  it("depois do corte, a ementa que ainda traz título de voto é incerta", () => {
    const campo = TURMA.replace("SENTENÇA REFORMADA.", "SENTENÇA REFORMADA. VOTO: Trecho só do voto.");
    expect(limparEmenta("tjba", campo).separacaoIncerta).toBe(true);
  });

  it("a limpeza é idempotente na ementa já limpa (a conferência a reaplica na memória)", () => {
    for (const campo of [TURMA, CAMARA, CAMARA_2, `${TURMA} ${TURMA}`]) {
      const limpa = limparEmenta("tjba", campo);
      expect(limparEmenta("tjba", limpa.ementa)).toEqual({ ementa: limpa.ementa });
    }
  });

  it("palavras de voto e relatório que fazem parte da ementa não a tornam incerta", () => {
    const campo =
      "EMENTA: DIREITO AMBIENTAL. RELATÓRIO DE IMPACTO AMBIENTAL. JULGAMENTO POR MAIORIA. VOTO VENCIDO. RECURSO " +
      "PROVIDO, nos termos do voto do relator e do relatório da sentença.";
    expect(limparEmenta("tjba", campo)).toEqual({ ementa: campo });
  });
});

describe("ementa limpa: só há cabeçalho a tirar se o prefixo tem partes (B05-R03)", () => {
  it.each(["tjba", "tjpe", "tjmt", "tjpb"])(
    "%s: ementa normal que menciona «EMENTA» ou «Ementa:» no texto fica intacta",
    (tribunal) => {
      const campo =
        "Ementa: DIREITO CIVIL. REFERÊNCIA À EMENTA DO JULGADO ANTERIOR. Ementa: transcrita no voto de origem. " +
        "RECURSO DESPROVIDO.";
      expect(limparEmenta(tribunal, campo)).toEqual({ ementa: campo });
    },
  );

  it.each([
    { tribunal: "tjba", campo: "EMENTA: DIREITO CIVIL. RECURSO DESPROVIDO. EMENTA REVISADA PELO RELATOR." },
    { tribunal: "tjmt", campo: "RECURSO INOMINADO. CONSUMIDOR. EMENTA DO JULGADO DE ORIGEM MANTIDA. RECURSO DESPROVIDO." },
  ])("$tribunal: «EMENTA» no meio sem partes antes não é fim de cabeçalho", ({ tribunal, campo }) => {
    expect(limparEmenta(tribunal, campo)).toEqual({ ementa: campo });
  });
});
