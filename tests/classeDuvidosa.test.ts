import { describe, expect, it } from "vitest";
import { avisoDeClasse, duvidaDaClasse, enquadrarAcordao } from "../src/enquadramento.js";

// Fixtures saneadas: a forma vista na base em 2026-10-29 (TJMT, TJCE); textos e números fictícios.
const RESSALVA =
  "O Garimpo a mostra como veio, mas ela pode estar errada, e o que depende dela também (o enquadramento927 e, se " +
  "vier, o aviso de recurso sem recorrido). Confira a classe no inteiro teor.";

describe("classe da base desmentida pelos próprios dados: órgão no lugar da classe", () => {
  it.each(["TURMA RECURSAL CÍVEL", "Turma Recursal Única", "1ª Câmara Cível", "Segunda Câmara Cível", "Órgão Especial", "Tribunal Pleno", "SEÇÃO CÍVEL"])(
    "%s: dúvida, com o aviso A literal",
    (classe) => {
      const d = duvidaDaClasse({
        classe,
        ementa:
          "Recurso Inominado: 0000001-11.2021.8.11.0001 Origem: Juizado Especial de Exemplo Recorrente(s): EMPRESA " +
          "EXEMPLO Recorrido(s): PESSOA FICTÍCIA EMENTA RECURSO INOMINADO – RELAÇÃO DE CONSUMO – EXEMPLO. (TJ-MT, " +
          "RECURSO INOMINADO 0000001-11.2021.8.11.0001, Relator(a) FULANO, TURMA RECURSAL ÚNICA, Julgado em 05/05/2022)",
      });
      expect(d).toEqual({ tipo: "orgao", classe });
      expect(avisoDeClasse(d!)).toBe(
        `A classe que o JurisprudênciaIA informa ("${classe}") é nome de órgão julgador, não de classe processual. ${RESSALVA}`,
      );
    },
  );
});

describe("classe da base desmentida pelos próprios dados: a ementa nomeia outra classe", () => {
  const TJCE = "Agravo Interno em Recurso Especial em Apelação Cível";

  it("TJCE: a classe principal (agravo interno) não aparece; a ementa nomeia a apelação cível → aviso B literal", () => {
    const d = duvidaDaClasse({
      classe: TJCE,
      ementa: "DIREITO DO CONSUMIDOR. APELAÇÃO CÍVEL. AÇÃO DE EXEMPLO. DANO MORAL. RECURSO CONHECIDO E DESPROVIDO.",
    });
    expect(d).toEqual({ tipo: "ementa", classe: TJCE, principal: "Agravo Interno", nomeada: "APELAÇÃO CÍVEL" });
    expect(avisoDeClasse(d!)).toBe(
      `A classe que o JurisprudênciaIA informa ("${TJCE}") começa por "Agravo Interno", que não aparece na ementa ` +
        `deste acórdão; a ementa nomeia outra classe ("APELAÇÃO CÍVEL"). ${RESSALVA}`,
    );
  });

  it.each([
    "EMENTA: APELAÇÃO CÍVEL. DIREITO CIVIL E CONSUMIDOR. CONTRATO DE EXEMPLO. SENTENÇA DE ORIGEM.",
    "EMENTA : APELAÇÃO CÍVEL. DIREITO CIVIL E CONSUMIDOR. CONTRATO DE EXEMPLO.",
    "APELAÇÃO CÍVEL. DIREITO CIVIL E CONSUMIDOR. CONTRATO DE EXEMPLO.",
    "EMENTA: DIREITO CIVIL E PROCESSUAL CIVIL. RECURSO DE APELAÇÃO CÍVEL. AÇÃO DE EXEMPLO. SENTENÇA MANTIDA.",
  ])("TJCE, a classe na 1ª frase da ementa (%s)", (ementa) => {
    expect(duvidaDaClasse({ classe: TJCE, ementa })).toMatchObject({ tipo: "ementa", nomeada: "APELAÇÃO CÍVEL" });
  });

  const SO_NO_RODAPE =
    "EMENTA: DIREITO DO CONSUMIDOR. DANO MORAL. EXEMPLO FICTÍCIO DE TEXTO LONGO. ".repeat(10) +
    "ACÓRDÃO Acordam os Desembargadores integrantes da Câmara de Exemplo, unanimemente, em conhecer do recurso. " +
    "(Apelação Cível - 0000001-11.2024.8.06.0001, Rel. Desembargador(a) FULANO DE TAL, 2ª Câmara Direito " +
    "Privado, data do julgamento: 29/05/2024, data da publicação: 29/05/2024)";

  it("TJCE, a classe só no rodapé, colada ao número do próprio acórdão: também vale", () => {
    const d = duvidaDaClasse({ classe: TJCE, numeroCnj: "0000001-11.2024.8.06.0001", ementa: SO_NO_RODAPE });
    expect(d).toMatchObject({ tipo: "ementa", principal: "Agravo Interno", nomeada: "Apelação Cível" });
  });

  it.each([
    ["sem número do acórdão", undefined],
    ["com o número de outro processo", "0000009-99.2020.8.06.0001"],
  ])("rodapé que não prova ser deste acórdão (%s): sem dúvida", (_caso, numeroCnj) => {
    expect(duvidaDaClasse({ classe: TJCE, numeroCnj, ementa: SO_NO_RODAPE })).toBeUndefined();
    // Ementa curta: o rodapé cai dentro dos 300 primeiros caracteres e, entre parênteses, não é item do título.
    expect(duvidaDaClasse({ classe: TJCE, numeroCnj, ementa: SO_NO_RODAPE.slice(-260) })).toBeUndefined();
  });

  // B18-R01: a classe de origem, a citação e a abreviação da classe atual não demonstram contradição.
  it.each([
    ["Agravo Interno em Apelação Cível", "APELAÇÃO CÍVEL DE ORIGEM. AGINT. RECURSO CONTRA DECISAO MONOCRATICA. IMPROVIMENTO."],
    ["Agravo Interno em Apelação Cível", "APELAÇÃO CÍVEL. AGINT. RECURSO CONTRA DECISÃO MONOCRÁTICA. IMPROVIMENTO."],
    ["Agravo Interno em Apelação Cível", "APELAÇÃO CÍVEL. AG. INTERNO. DECISÃO MONOCRÁTICA MANTIDA."],
    ["Agravo Interno em Apelação Cível", "APELAÇÃO CÍVEL DE ORIGEM. DIREITO CIVIL. DECISÃO MONOCRÁTICA MANTIDA."],
    ["Agravo Interno em Apelação Cível", "DIREITO CIVIL. APELAÇÃO CÍVEL ORIGINÁRIA. DECISÃO MONOCRÁTICA MANTIDA."],
    ["Agravo Regimental em Apelação Cível", "APELAÇÃO CÍVEL. AGRG. DECISÃO MANTIDA."],
    ["Embargos de Declaração em Apelação Cível", "APELAÇÃO CÍVEL. EDCL. OMISSÃO INEXISTENTE."],
    ["Recurso Especial", "AGRAVO DE INSTRUMENTO DE ORIGEM. RESP. RECURSO CONHECIDO."],
    ["Recurso Especial", "AGRAVO DE INSTRUMENTO. RESP. RECURSO CONHECIDO."],
    ["Agravo em Recurso Especial", "APELAÇÃO CÍVEL. ARESP. DECISÃO DE INADMISSÃO MANTIDA."],
    ["Agravo Interno em Apelação Cível", "DIREITO CIVIL. DANO MORAL (TJCE, Apelação Cível 0000009-99.2020.8.06.0001). EXEMPLO."],
    ["Agravo Interno em Apelação Cível", "DIREITO CIVIL. PRECEDENTE: APELAÇÃO CÍVEL Nº 0000009-99.2020.8.06.0001. EXEMPLO."],
    // Rodada 2 do Revisor: o rótulo antes dos dois-pontos e o parêntese aberto fazem parte do item.
    [TJCE, "CLASSE DE ORIGEM: APELACAO CIVEL. DECISAO MONOCRATICA MANTIDA."],
    [TJCE, "DIREITO CIVIL. PRECEDENTE: APELACAO CIVEL. DECISAO MONOCRATICA MANTIDA."],
    [TJCE, "DIREITO CIVIL (PRECEDENTE: APELACAO CIVEL. ENTENDIMENTO CITADO). DECISAO MONOCRATICA MANTIDA."],
    [TJCE, "DIREITO CIVIL (VER APELAÇÃO CÍVEL. EXEMPLO). DECISÃO MANTIDA."],
  ])("%s, ementa «%s»: sem dúvida", (classe, ementa) => {
    expect(duvidaDaClasse({ classe, ementa, numeroCnj: "0000001-11.2024.8.06.0001" })).toBeUndefined();
  });

  it.each([
    ["mandado de segurança", "ADMINISTRATIVO. MANDADO DE SEGURANÇA. SERVIDOR. EXEMPLO. RECURSO DESPROVIDO."],
    ["embargos à execução", "EMBARGOS À EXECUÇÃO. TÍTULO EXTRAJUDICIAL. EXEMPLO. SENTENÇA MANTIDA."],
  ])("apelação cuja ementa começa pela ação de origem (%s): sem dúvida", (_caso, ementa) => {
    expect(duvidaDaClasse({ classe: "Apelação Cível", ementa })).toBeUndefined();
  });

  it("agravo interno de verdade, cuja ementa cita a apelação de origem: sem dúvida", () => {
    expect(
      duvidaDaClasse({
        classe: TJCE,
        ementa: "DIREITO PROCESSUAL CIVIL. APELAÇÃO CÍVEL. AGRAVO INTERNO EM RECURSO ESPECIAL. EXEMPLO. AGRAVO DESPROVIDO.",
      }),
    ).toBeUndefined();
  });

  it("a classe principal aparece fora do cabeçalho (no meio da ementa): sem dúvida", () => {
    expect(
      duvidaDaClasse({
        classe: TJCE,
        ementa: `APELAÇÃO CÍVEL. EXEMPLO. ${"TEXTO DE EXEMPLO. ".repeat(30)}Trata-se de agravo interno contra decisão.`,
      }),
    ).toBeUndefined();
  });

  it("classe nomeada só no meio da ementa (nem no cabeçalho nem no rodapé): sem dúvida", () => {
    expect(
      duvidaDaClasse({
        classe: TJCE,
        ementa:
          `DIREITO DO CONSUMIDOR. ${"TEXTO DE EXEMPLO. ".repeat(30)}Na apelação cível de origem, o exemplo. ` +
          "TEXTO DE EXEMPLO. ".repeat(30),
      }),
    ).toBeUndefined();
  });
});

describe("classe coerente, ausente ou fora da lista: nada muda", () => {
  it.each([
    ["classe igual à da ementa", "Apelação Cível", "APELAÇÃO CÍVEL. EXEMPLO."],
    ["classe mais curta, compatível", "Apelação", "Ementa: DIREITO CIVIL. APELAÇÃO CÍVEL. EXEMPLO."],
    ["sem acento e em caixa diferente", "APELACAO CIVEL", "Apelação cível. Exemplo."],
    ["ementa sem classe nomeada", "Recurso Inominado", "CONSUMIDOR. DANO MORAL. EXEMPLO."],
    ["classe ausente", undefined, "APELAÇÃO CÍVEL. EXEMPLO."],
    ["NÃO INFORMADO (ausência, não contradição)", "NÃO INFORMADO", "RECURSO INOMINADO. EXEMPLO."],
    ["classe de origem fora da lista", "Procedimento Comum Cível", "APELAÇÃO CÍVEL. EXEMPLO."],
    ["STJ, REsp normal", "RECURSO ESPECIAL", "PROCESSUAL CIVIL. RECURSO ESPECIAL. EXEMPLO."],
    ["STJ, AREsp normal", "AGRAVO EM RECURSO ESPECIAL", "PROCESSUAL CIVIL. AGRAVO EM RECURSO ESPECIAL. EXEMPLO."],
    ["STJ, AgInt no AREsp", "AgInt no AREsp", "PROCESSUAL CIVIL. AGRAVO INTERNO NO AGRAVO EM RECURSO ESPECIAL. EXEMPLO."],
    ["STF, ADI", "AÇÃO DIRETA DE INCONSTITUCIONALIDADE", "Ação direta de inconstitucionalidade. Exemplo."],
    ["ementa vazia", "Agravo Interno em Apelação Cível", ""],
  ])("%s", (_caso, classe, ementa) => {
    expect(duvidaDaClasse({ classe, ementa })).toBeUndefined();
  });
});

describe("enquadramento927 com a classe em dúvida", () => {
  const base = { tribunal: "tjmt", numero: "0000001-11.2021.8.11.0001", semNumero: false, classe: "TURMA RECURSAL CÍVEL" };

  it("órgão: a nota N, sem mudar o inciso nem o motivo", () => {
    const sem = enquadrarAcordao(base);
    const com = enquadrarAcordao({ ...base, duvidaDaClasse: duvidaDaClasse(base) });
    expect(com.inciso).toBe(sem.inciso);
    expect(com.motivo).toBe(sem.motivo);
    expect(com.notas).toEqual([
      ...sem.notas,
      "a classe informada pelo site é posta em dúvida pelos próprios dados (é nome de órgão julgador): este " +
        "enquadramento depende dela e pode estar errado (ver avisoDeClasse)",
    ]);
  });

  it("ementa: a nota N com o nome literal", () => {
    const tjce = { ...base, tribunal: "tjce", classe: "Agravo Interno em Recurso Especial em Apelação Cível" };
    const d = duvidaDaClasse({ ...tjce, ementa: "APELAÇÃO CÍVEL. EXEMPLO." });
    expect(enquadrarAcordao({ ...tjce, duvidaDaClasse: d }).notas).toContain(
      'a classe informada pelo site é posta em dúvida pelos próprios dados (a ementa nomeia "APELAÇÃO CÍVEL"): este ' +
        "enquadramento depende dela e pode estar errado (ver avisoDeClasse)",
    );
  });

  it("sem dúvida: o mesmo enquadramento de antes", () => {
    expect(enquadrarAcordao({ ...base, classe: "Recurso Inominado", duvidaDaClasse: undefined })).toEqual(
      enquadrarAcordao({ ...base, classe: "Recurso Inominado" }),
    );
  });
});
