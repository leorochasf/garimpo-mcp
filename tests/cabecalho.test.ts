import { describe, expect, it } from "vitest";
import { processoNoCabecalho, type RegiaoDoCabecalho, regiaoInvalida } from "../src/cabecalho.js";
import { CABECALHO_DO_TJCE } from "../src/cabecalhoTjce.js";

// Ticket 16 da frente dos TJs: a identidade do processo só se lê na região do cabeçalho que o tribunal declara, e uma
// vez só. Textos fictícios (tribunal 99).

const CNJ = "0000001-11.2025.8.99.0001";
const OUTRO = "0000002-22.2025.8.99.0001";

const REGIAO: RegiaoDoCabecalho = {
  titulos: /\b(?:EMENTA|AC[ÓO]RD[ÃA]O|RELAT[ÓO]RIO|VOTO)\b/,
  maximo: 600,
  numero: /Processo:\s*(\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4})/,
};

describe("processoNoCabecalho (a regra do molde, uma vez só)", () => {
  it("um número na região antes do 1º título: é a identidade, como está escrito", () => {
    expect(processoNoCabecalho(`TRIBUNAL FICTÍCIO\nProcesso: ${CNJ}\nEMENTA: texto. VOTO: cita ${OUTRO}.`, REGIAO)).toBe(CNJ);
  });

  it("cabeçalho sem número e o número citado no corpo (até com o mesmo rótulo): recusa", () => {
    expect(processoNoCabecalho(`TRIBUNAL FICTÍCIO\nPartes fictícias\nEMENTA: texto. Processo: ${CNJ}.`, REGIAO)).toBeUndefined();
  });

  it("dois números diferentes no cabeçalho: recusa; o mesmo com e sem máscara é um só", () => {
    expect(processoNoCabecalho(`Processo: ${CNJ}\nProcesso: ${OUTRO}\nEMENTA`, REGIAO)).toBeUndefined();
    expect(processoNoCabecalho(`Processo: ${CNJ}\nProcesso: ${CNJ.replace(/\D/g, "")}\nEMENTA`, REGIAO)).toBe(CNJ);
  });

  it("sem título nenhum, a região para no teto de caracteres", () => {
    expect(processoNoCabecalho(`${"x".repeat(600)} Processo: ${CNJ}`, REGIAO)).toBeUndefined();
    expect(processoNoCabecalho(`${"x".repeat(500)} Processo: ${CNJ}`, REGIAO)).toBe(CNJ);
  });

  it("com início máximo declarado, o rótulo tem de abrir o documento", () => {
    const comInicio = { ...REGIAO, inicioMaximo: 300 };
    expect(processoNoCabecalho(`${"x".repeat(350)} Processo: ${CNJ}`, comInicio)).toBeUndefined();
    expect(processoNoCabecalho(`${"x".repeat(250)} Processo: ${CNJ}`, comInicio)).toBe(CNJ);
  });

  it("expressões declaradas com /g não guardam estado entre uma página e outra", () => {
    const global = { ...REGIAO, titulos: /EMENTA/g, numero: /Processo:\s*(\S+)/g };
    for (let i = 0; i < 3; i++) expect(processoNoCabecalho(`Processo: ${CNJ}\nEMENTA`, global)).toBe(CNJ);
  });
});

describe("regiaoInvalida (o registro recusa declaração sem região do cabeçalho)", () => {
  it("região completa passa; a do PDF do TJCE também (o TJBA é conferido no registro do molde)", () => {
    expect(regiaoInvalida(REGIAO)).toBeUndefined();
    expect(regiaoInvalida({ ...REGIAO, inicioMaximo: 300 })).toBeUndefined();
    expect(regiaoInvalida(CABECALHO_DO_TJCE)).toBeUndefined();
  });

  it.each([
    ["ausente", undefined],
    ["sem títulos", { ...REGIAO, titulos: undefined }],
    ["títulos que não são expressão", { ...REGIAO, titulos: "EMENTA" }],
    ["teto zero", { ...REGIAO, maximo: 0 }],
    ["teto fracionário", { ...REGIAO, maximo: 10.5 }],
    ["número sem grupo de captura", { ...REGIAO, numero: /Processo:\s*\d+/ }],
    ["início máximo além do teto", { ...REGIAO, inicioMaximo: 700 }],
  ])("%s: recusa", (_, regiao) => {
    expect(regiaoInvalida(regiao)).toMatch(/cabeçalho/);
  });
});
