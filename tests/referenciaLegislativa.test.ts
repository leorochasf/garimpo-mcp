import { describe, expect, it } from "vitest";
import { lerReferenciasLegislativas } from "../src/referenciaLegislativa.js";

/** Recortes escritos à mão no formato do campo `referenciasLegislativas` dos Espelhos de Acórdãos (um texto por ato). */
const CPC =
  "LEG:FED LEI:013105 ANO:2015\n*****  CPC-15    CÓDIGO DE PROCESSO CIVIL DE 2015\n" +
  "        ART:00219 ART:00994 INC:00006 ART:01003 PAR:00005";

const CPC_LEI = { esfera: "FED", tipo: "LEI", numero: "13105", ano: 2015, sigla: "CPC-15" };

function cpcCom(corpo: string): string {
  return `LEG:FED LEI:013105 ANO:2015\n*****  CPC-15    CÓDIGO DE PROCESSO CIVIL DE 2015\n        ${corpo}`;
}

describe("lerReferenciasLegislativas", () => {
  it("transforma artigo, inciso e parágrafo em pares com a lei e o ano", () => {
    expect(lerReferenciasLegislativas(CPC)).toEqual([
      { ...CPC_LEI, artigo: "219" },
      { ...CPC_LEI, artigo: "994", inciso: "6" },
      { ...CPC_LEI, artigo: "1003", paragrafo: "5" },
    ]);
  });

  it('lê PAR:ÚNICO como "único"', () => {
    expect(lerReferenciasLegislativas(cpcCom("ART:00006 ART:00009 PAR:ÚNICO ART:00010"))).toEqual([
      { ...CPC_LEI, artigo: "6" },
      { ...CPC_LEI, artigo: "9", paragrafo: "único" },
      { ...CPC_LEI, artigo: "10" },
    ]);
  });

  it("aceita quebras \\r\\n e ignora a quebra de linha dentro do nome da lei", () => {
    const texto =
      "LEG:FED LEI:009494 ANO:1997\r\n*****  LTAF- 1997    LEI DA TUTELA ANTECIPADA CONTRA A FAZENDA\r\n" +
      "PÚBLICA\r\n        ART:00001 PAR:00002\r\n        ART:00005\r\n";
    const lei = { esfera: "FED", tipo: "LEI", numero: "9494", ano: 1997, sigla: "LTAF-" };
    expect(lerReferenciasLegislativas(texto)).toEqual([
      { ...lei, artigo: "1", paragrafo: "2" },
      { ...lei, artigo: "5" },
    ]);
  });

  it("mantém o sufixo de letra do artigo (ART:0256N) e tira só os zeros da frente", () => {
    expect(lerReferenciasLegislativas(cpcCom("ART:0256N ART:0001F"))).toEqual([
      { ...CPC_LEI, artigo: "256N" },
      { ...CPC_LEI, artigo: "1F" },
    ]);
  });

  it("guarda a observação livre entre parênteses sem ler o que há dentro dela", () => {
    const texto = `${cpcCom("ART:0001F")}\n(COM A REDAÇÃO DADA PELA LEI 11.960/2009 ART:00099)`;
    expect(lerReferenciasLegislativas(texto)).toEqual([
      { ...CPC_LEI, artigo: "1F", observacao: "COM A REDAÇÃO DADA PELA LEI 11.960/2009 ART:00099" },
    ]);
  });

  it("devolve número e ano nulos quando a fonte traz asteriscos", () => {
    const cf = "LEG:FED CFB:****** ANO:1988\n*****  CF-1988    CONSTITUIÇÃO FEDERAL DE 1988\n        ART:00005 INC:00027";
    expect(lerReferenciasLegislativas(cf)).toEqual([
      { esfera: "FED", tipo: "CFB", numero: null, ano: 1988, sigla: "CF-1988", artigo: "5", inciso: "27" },
    ]);
    const sumula =
      "LEG:FED SUM:****** ANO:****\n*****  SUM(STJ)    SÚMULA DO SUPERIOR TRIBUNAL DE JUSTIÇA\n        SUM:000233 SUM:000258";
    const lei = { esfera: "FED", tipo: "SUM", numero: null, ano: null, sigla: "SUM(STJ)" };
    expect(lerReferenciasLegislativas(sumula)).toEqual([
      { ...lei, enunciado: "233" },
      { ...lei, enunciado: "258" },
    ]);
  });

  it("abre um par novo quando o mesmo nível se repete e guarda a alínea", () => {
    const texto =
      "LEG:FED CFB:****** ANO:1988\n*****  CF-1988    CONSTITUIÇÃO FEDERAL DE 1988\n" +
      "        ART:00046 INC:00001 LET:A INC:00007 INC:00008 ART:00049 PAR:00001 PAR:00002";
    const lei = { esfera: "FED", tipo: "CFB", numero: null, ano: 1988, sigla: "CF-1988" };
    expect(lerReferenciasLegislativas(texto)).toEqual([
      { ...lei, artigo: "46", inciso: "1", alinea: "A" },
      { ...lei, artigo: "46", inciso: "7" },
      { ...lei, artigo: "46", inciso: "8" },
      { ...lei, artigo: "49", paragrafo: "1" },
      { ...lei, artigo: "49", paragrafo: "2" },
    ]);
  });

  it("devolve um par só com a lei quando a referência não traz artigo", () => {
    expect(lerReferenciasLegislativas("LEG:FED DEL:075699 ANO:1975")).toEqual([
      { esfera: "FED", tipo: "DEL", numero: "75699", ano: 1975, sigla: null },
    ]);
  });

  it("aceita a lista de textos que o campo traz e junta os pares na ordem", () => {
    const pares = lerReferenciasLegislativas([CPC, "LEG:FED DEL:075699 ANO:1975"]);
    expect(pares).toHaveLength(4);
    expect(pares[3]).toMatchObject({ tipo: "DEL", numero: "75699" });
  });

  it("devolve lista vazia para vazio, nulo ou texto fora do formato", () => {
    expect(lerReferenciasLegislativas("")).toEqual([]);
    expect(lerReferenciasLegislativas(null)).toEqual([]);
    expect(lerReferenciasLegislativas(undefined)).toEqual([]);
    expect(lerReferenciasLegislativas("ART:00001 PAR:00002 sem cabeçalho")).toEqual([]);
  });

  it("não transforma cabeçalhos ou dispositivos malformados em referências", () => {
    for (const texto of [
      "LEG:FED LEI:desconhecida ANO:2015\nART:00001",
      "LEG:FED LEI:013105 ANO:2015x\nART:00001",
      "LEG:FED LEI:013105 ANO:2e3\nART:00001",
      cpcCom("ART:desconhecido"),
      cpcCom("ART:00085?"),
      cpcCom("ART:00085 PAR:qualquer"),
      cpcCom("ART:00085 INC:???"),
    ]) expect(lerReferenciasLegislativas(texto)).toEqual([]);
  });

  it("não lê marcas de dispositivo dentro de observações aninhadas ou incompletas", () => {
    expect(lerReferenciasLegislativas(`${cpcCom("ART:00085")}\n(NOTA (REDAÇÃO) ART:00999)`)).toEqual([
      { ...CPC_LEI, artigo: "85", observacao: "NOTA (REDAÇÃO) ART:00999" },
    ]);
    expect(lerReferenciasLegislativas(`${cpcCom("ART:00085")}\n(NOTA ART:00999`)).toEqual([]);
  });

  it("lê dispositivos na mesma linha do cabeçalho sem reler o cabeçalho como corpo", () => {
    expect(lerReferenciasLegislativas("LEG:FED LEI:013105 ANO:2015 ART:00085 PAR:00008")).toEqual([
      { esfera: "FED", tipo: "LEI", numero: "13105", ano: 2015, sigla: null, artigo: "85", paragrafo: "8" },
    ]);
    expect(lerReferenciasLegislativas("LEG:FED SUM:000233 ANO:****")).toEqual([
      { esfera: "FED", tipo: "SUM", numero: "233", ano: null, sigla: null },
    ]);
  });
});
