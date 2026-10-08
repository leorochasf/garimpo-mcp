import { describe, expect, it } from "vitest";
import {
  ART_927_CONFERIDO_EM,
  INCISOS_ART_927,
  enquadrarAcordao,
  enquadrarQualificado,
  type AcordaoParaEnquadrar,
} from "../src/enquadramento.js";

/** Acórdão fictício, só com o que a regra lê. */
function acordao(dados: Partial<AcordaoParaEnquadrar>): AcordaoParaEnquadrar {
  return { tribunal: "stf", numero: "EXEMPLO 1", semNumero: false, ...dados };
}

describe("enquadramento no art. 927 — acórdão do STF em controle concentrado", () => {
  it("STF com sigla exatamente ADI fica no inciso I, com base legal, evidência e data da conferência, sem 'efeito vinculante'", () => {
    const e = enquadrarAcordao(acordao({ siglaClasse: "ADI", numero: "ADI 1001" }));
    expect(e.inciso).toBe("I");
    expect(e.baseLegal).toBe(
      'CPC, art. 927, I: "as decisões do Supremo Tribunal Federal em controle concentrado de constitucionalidade;"',
    );
    expect(e.evidencia).toContain("ADI");
    expect(e.textoLegalConferidoEm).toBe("2026-10-08");
    expect(e.avisoSituacao).toBeTruthy();
    expect(JSON.stringify(e)).not.toMatch(/efeito vinculante/i);
  });

  it("STF com sigla exatamente ADC e classe por extenso coerente também fica no inciso I", () => {
    const e = enquadrarAcordao(acordao({ siglaClasse: "ADC", classe: "AÇÃO DECLARATÓRIA DE CONSTITUCIONALIDADE" }));
    expect(e.inciso).toBe("I");
  });

  it.each([
    ["ADPF", { siglaClasse: "ADPF" }, /ADPF/],
    ["ADO", { siglaClasse: "ADO" }, /ADO/],
    ["sigla composta", { siglaClasse: "ADI-MC" }, /sigla composta \(ADI-MC\)/],
    ["sigla composta com espaço", { siglaClasse: "ADI AgR" }, /sigla composta \(ADI AgR\)/],
    ["classe ausente", {}, /classe não informada/],
    ["ADI fora do STF", { tribunal: "tjgo", siglaClasse: "ADI" }, /Supremo Tribunal Federal/],
    ["dados contraditórios", { siglaClasse: "ADI", classe: "RECURSO EXTRAORDINÁRIO" }, /contraditórios/],
  ])("%s → não classificado, com o motivo", (_caso, dados, motivo) => {
    const e = enquadrarAcordao(acordao(dados));
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toMatch(motivo);
    expect(e.baseLegal).toBeUndefined();
    expect(e.motivo).not.toMatch(/fora do rol/i);
  });
});

describe("enquadramento no art. 927 — precedente qualificado com prova positiva", () => {
  it("súmula vinculante (lista do site) fica no inciso II, com o aviso de que a situação não foi informada", () => {
    const e = enquadrarQualificado({ tribunal: "stf", tipo: "súmula vinculante", numero: "1" });
    expect(e.inciso).toBe("II");
    expect(e.baseLegal).toBe('CPC, art. 927, II: "os enunciados de súmula vinculante;"');
    expect(e.evidencia).toMatch(/súmula vinculante/);
    expect(e.avisoSituacao).toMatch(/revisão|cancelamento/);
    expect(JSON.stringify(e)).not.toMatch(/efeito vinculante/i);
  });

  it.each(["tema repetitivo", "IAC"])("%s do STJ com tese fica no inciso III, com o aviso de situação não verificada", (tipo) => {
    const e = enquadrarQualificado({ tribunal: "stj", tipo, numero: "1001", tese: "Tese fictícia firmada." });
    expect(e.inciso).toBe("III");
    expect(e.baseLegal).toBe(
      'CPC, art. 927, III: "os acórdãos em incidente de assunção de competência ou de resolução de demandas repetitivas ' +
        'e em julgamento de recursos extraordinário e especial repetitivos;"',
    );
    expect(e.evidencia).toMatch(/tese/);
    expect(e.avisoSituacao).toMatch(/não verificada/);
  });

  it.each(["tema repetitivo", "IAC"])("%s do STJ sem tese informada fica não classificado", (tipo) => {
    const e = enquadrarQualificado({ tribunal: "stj", tipo, numero: "1001" });
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toMatch(/sem tese informada/);
  });

  it("súmula vinculante fora do STF é dado contraditório: não classificado", () => {
    const e = enquadrarQualificado({ tribunal: "stj", tipo: "súmula vinculante", numero: "1" });
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toMatch(/contraditórios/);
  });
});

describe("enquadramento no art. 927 — precedente qualificado sem regra positiva", () => {
  it.each([
    ["súmula do STF", "stf", "súmula", /inciso IV exige matéria constitucional/],
    ["súmula do STJ", "stj", "súmula", /inciso IV exige matéria infraconstitucional/],
    ["súmula do TST", "tst", "súmula", /fundamento .*não verificado/],
    ["PUIL", "stj", "PUIL", /fundamento .*não verificado/],
    ["IRR", "tst", "IRR", /fundamento .*não verificado/],
    ["OJ", "tst", "OJ", /fundamento .*não verificado/],
    ["tipo desconhecido", "stj", "enunciado administrativo", /não previsto no texto consultado/],
  ])("%s → não classificado, com o motivo", (_caso, tribunal, tipo, motivo) => {
    const e = enquadrarQualificado({ tribunal, tipo, numero: "7", tese: "Texto fictício." });
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toMatch(motivo);
    expect(e.motivo).not.toMatch(/fora do rol|não (tem|possui) (dever de )?observância/i);
  });

  it("o tipo casa só exatamente com o rótulo da lista: grafia diferente não ganha inciso", () => {
    const e = enquadrarQualificado({ tribunal: "stf", tipo: "Sumula Vinculante", numero: "1" });
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toMatch(/não previsto no texto consultado/);
  });

  it("repercussão geral → não classificado, com o motivo exato decidido, sem dizer que está fora do rol", () => {
    const e = enquadrarQualificado({ tribunal: "stf", tipo: "repercussão geral", numero: "999", tese: "Tese fictícia." });
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toBe(
      "enquadramento no art. 927 não verificado: a repercussão geral não é expressamente mencionada nesse artigo " +
        "e o CPC distingue os regimes no art. 1.035, § 7º",
    );
  });
});

describe("enquadramento no art. 927 — acórdão sem prova positiva, com notas informativas", () => {
  it.each([
    ["sigla IRDR", { tribunal: "tjgo", siglaClasse: "IRDR" }, /IRDR.*não confirmado o julgamento que fixou a tese/],
    ["classe IAC por extenso", { tribunal: "stj", classe: "Incidente de Assunção de Competência" }, /IAC.*não confirmado o julgamento que fixou a tese/],
  ])("%s → não classificado + nota, sem herdar o inciso III", (_caso, dados, nota) => {
    const e = enquadrarAcordao(acordao(dados));
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toMatch(/não confirmado que este acórdão é o julgamento que fixou a tese/);
    expect(e.notas.join(" | ")).toMatch(nota);
  });

  it("acórdão do mesmo processo do paradigma de um tema ganha só a nota, sem herdar o inciso do tema", () => {
    const paradigmas = [{ tribunal: "stj", tipo: "tema repetitivo", numero: "1001", processoParadigma: "REsp 1.000.009/SP" }];
    const e = enquadrarAcordao(
      acordao({ tribunal: "stj", siglaClasse: "REsp", numero: "REsp 1.000.009/SP", orgao: "Primeira Seção" }),
      { paradigmas },
    );
    expect(e.inciso).toBe("não classificado");
    expect(e.notas.join(" | ")).toMatch(/mesmo processo do paradigma do tema repetitivo nº 1001.*não herda/);
  });

  it.each([
    ["número sem a classe", { numero: "1.000.009/SP" }],
    ["outro tribunal", { tribunal: "tjgo", numero: "REsp 1.000.009/SP" }],
    ["número só do site", { numero: "REsp 1.000.009/SP", semNumero: true }],
  ])("número incompleto ou ambíguo não confirma o mesmo processo do paradigma (%s)", (_caso, dados) => {
    const paradigmas = [{ tribunal: "stj", tipo: "tema repetitivo", numero: "1001", processoParadigma: "REsp 1.000.009/SP" }];
    const e = enquadrarAcordao(acordao({ tribunal: "stj", ...dados }), { paradigmas });
    expect(e.notas.join(" | ")).not.toMatch(/paradigma/);
  });

  it("acórdão do STF com numero_tema ganha só a nota do tema", () => {
    const e = enquadrarAcordao(acordao({ siglaClasse: "RE", numero: "RE 100001", numeroTema: "999" }));
    expect(e.inciso).toBe("não classificado");
    expect(e.notas.join(" | ")).toMatch(/tema nº 999.*não herda/);
  });

  it.each(["Tribunal Pleno", "ÓRGÃO ESPECIAL", "Corte Especial"])("acórdão de %s → só a nota do órgão, sem inciso V", (orgao) => {
    const e = enquadrarAcordao(acordao({ tribunal: "stj", siglaClasse: "EREsp", numero: "EREsp 1.000.003/SP", orgao }));
    expect(e.inciso).toBe("não classificado");
    expect(e.notas.join(" | ")).toMatch(new RegExp(`${orgao}.*não comprova .*orientação`, "i"));
  });

  it("Corte Especial: a nota diz que a equivalência ao órgão especial não foi verificada", () => {
    const e = enquadrarAcordao(acordao({ tribunal: "stj", siglaClasse: "EREsp", orgao: "Corte Especial" }));
    expect(e.notas.join(" | ")).toMatch(/equivalência .*órgão especial.*não verificada/);
  });

  it("nota do órgão não apaga o inciso I de uma ADI do Pleno", () => {
    const e = enquadrarAcordao(acordao({ siglaClasse: "ADI", orgao: "Tribunal Pleno" }));
    expect(e.inciso).toBe("I");
    expect(e.notas.join(" | ")).toMatch(/Tribunal Pleno/);
  });

  it("turma com classe conhecida → não classificado com motivo concreto, nunca 'fora do rol'", () => {
    const e = enquadrarAcordao(acordao({ tribunal: "tjgo", classe: "Apelação Cível", orgao: "3ª Câmara Cível" }));
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toMatch(/Apelação Cível/);
    expect(e.motivo).toMatch(/não informam/);
    expect(JSON.stringify(e)).not.toMatch(/fora do rol/i);
  });

  it("REsp do STJ não recebe o inciso III-A só por ser REsp: os dados não indicam o regime da relevância", () => {
    const e = enquadrarAcordao(
      acordao({ tribunal: "stj", siglaClasse: "REsp", classe: "Recurso Especial", numero: "REsp 1.000.002/GO", orgao: "Primeira Turma" }),
    );
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toMatch(/regime da relevância/);
  });

  it("STJ sem classe → não classificado: classe não informada pelo site", () => {
    const e = enquadrarAcordao(acordao({ tribunal: "stj", numero: "1.000.001/SP", orgao: "Segunda Turma" }));
    expect(e.inciso).toBe("não classificado");
    expect(e.motivo).toMatch(/classe não informada/);
  });
});

describe("teste-trava do texto do art. 927 usado pela regra", () => {
  // Texto do CPC no Planalto, conferido em 2026-10-08, já com o III-A da Lei nº 15.484/2026 (ADR-0007).
  // Mudar aqui só com nova conferência da fonte oficial.
  it("a tabela tem os incisos I, II, III, III-A, IV e V, com o texto literal conferido", () => {
    expect(INCISOS_ART_927.map((i) => [i.inciso, i.texto])).toEqual([
      ["I", "as decisões do Supremo Tribunal Federal em controle concentrado de constitucionalidade;"],
      ["II", "os enunciados de súmula vinculante;"],
      [
        "III",
        "os acórdãos em incidente de assunção de competência ou de resolução de demandas repetitivas e em julgamento de recursos extraordinário e especial repetitivos;",
      ],
      [
        "III-A",
        "os acórdãos proferidos em julgamento de recurso especial submetido ao regime da relevância da questão de direito federal infraconstitucional;",
      ],
      [
        "IV",
        "os enunciados das súmulas do Supremo Tribunal Federal em matéria constitucional e do Superior Tribunal de Justiça em matéria infraconstitucional;",
      ],
      ["V", "a orientação do plenário ou do órgão especial aos quais estiverem vinculados."],
    ]);
  });

  it("a data da conferência do texto legal é 2026-10-08", () => {
    expect(ART_927_CONFERIDO_EM).toBe("2026-10-08");
  });
});
