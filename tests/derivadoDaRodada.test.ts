import { describe, expect, it } from "vitest";
import { destinoInvalido, exportarDerivado, validarDerivado, type RodadaCrua } from "../scripts/derivadoDaRodada.js";

// Rodada crua falsa, no formato que o gravador escreve na pasta externa. Número fictício (tribunal 99), relator e
// ementa inventados: o teste prova que nada disso passa para o derivado.
const NUMERO = "0000123-45.2019.8.99.0000";
const RELATOR = "Ministro Fictício Exemplar";
const EMENTA = "EMENTA: RECURSO FICTÍCIO. A TESE INVENTADA PARA O TESTE NÃO SE APLICA.";
const CHAVE = "a".repeat(64);

const crua = (): RodadaCrua => ({
  estado: {
    iniciadoEm: "2026-10-23T10:00:00.000Z",
    terminadoEm: "2026-10-23T10:05:00.000Z",
    chamadasAoSite: 3,
    recusasDoSite: [{ consulta: "tese-01-tecnica", status: 429 }],
    motivoDaParada: `tese-01-tecnica: RecusaError: ${RELATOR}`,
    completa: false,
  },
  resultados: [
    {
      id: "tese-01-tecnica",
      fase: "tese",
      tribunal: "stj",
      versao: "tecnica",
      tese: 1,
      chamadas: 2,
      mostrados: 2,
      numeros: [NUMERO, "REsp 1.234.567/SP"],
      acordaos: [{ numero: NUMERO, tribunal: "stj", data: "2020-01-01", relator: RELATOR, ementa: EMENTA }],
    },
    { id: "stj-tema-7", fase: "paradigma", tribunal: "stj", chamadas: 1, mostrados: 0, numeros: [] },
    { id: "stj-tema-8", fase: "paradigma", tribunal: "stj", chamadas: 0, erro: `Error: ${EMENTA}` },
  ],
  registros: [
    { seq: 1, consulta: "tese-01-tecnica", ms: 120, status: 429, resposta: EMENTA },
    { seq: 2, consulta: "tese-01-tecnica", ms: 80, status: 200, resposta: `{"relator":"${RELATOR}"}` },
    { seq: 3, consulta: "stj-tema-7", ms: 50, status: 200 },
  ],
});

const meta = { versaoDoGarimpo: "1.1.1", commit: "cc956b4" };

describe("exportarDerivado", () => {
  it("leva contagens, tempos e hashes, sem número, relator nem ementa em claro", () => {
    const d = exportarDerivado(crua(), CHAVE, meta);
    const texto = JSON.stringify(d);
    for (const proibido of [NUMERO, "1.234.567", "1234567", "0000123", RELATOR, "Fictício", "EMENTA", "RecusaError", "2020-01-01"])
      expect(texto).not.toContain(proibido);
    expect(validarDerivado(d)).toEqual([]);
    expect(d.rodada).toEqual({
      iniciadoEm: "2026-10-23T10:00:00.000Z",
      terminadoEm: "2026-10-23T10:05:00.000Z",
      chamadasAoSite: 3,
      recusas: 1,
      parou: true,
      completa: false,
      consultas: 3,
    });
    const [tese, tema7, tema8] = d.consultas;
    expect(tese).toMatchObject({ fase: "tese", tribunal: "stj", versao: "tecnica", chamadas: 2, mostrados: 2, ms: 200, erro: false });
    expect(tese.acordaos).toHaveLength(2);
    for (const h of tese.acordaos) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(tema7).toMatchObject({ fase: "paradigma", mostrados: 0, ms: 50, erro: false, acordaos: [] });
    expect(tema8).toMatchObject({ erro: true, chamadas: 0, ms: 0 });
    // Ids opacos: a ordem da rodada, nunca o id original.
    expect(d.consultas.map((c) => c.id)).toEqual(["c001", "c002", "c003"]);
  });

  it("o mesmo acórdão dá o mesmo hash com a mesma chave (pontuação não importa) e outro com outra chave", () => {
    const r = crua();
    r.resultados[1].numeros = ["0000123452019899" + "0000"];
    const a = exportarDerivado(r, CHAVE, meta);
    expect(a.consultas[1].acordaos[0]).toBe(a.consultas[0].acordaos[0]);
    expect(a.consultas[0].hashDoId).toBe(exportarDerivado(crua(), CHAVE, meta).consultas[0].hashDoId);
    const b = exportarDerivado(crua(), "b".repeat(64), meta);
    expect(b.consultas[0].acordaos[0]).not.toBe(a.consultas[0].acordaos[0]);
    expect(b.consultas[0].hashDoId).not.toBe(a.consultas[0].hashDoId);
  });

  it("leva um identificador da chave (não a chave): derivados de chaves diferentes não se comparam por engano", () => {
    const a = exportarDerivado(crua(), CHAVE, meta);
    expect(a.chave).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(a)).not.toContain(CHAVE);
    expect(exportarDerivado(crua(), CHAVE, meta).chave).toBe(a.chave);
    expect(exportarDerivado(crua(), "b".repeat(64), meta).chave).not.toBe(a.chave);
    const semChave = JSON.parse(JSON.stringify(a));
    delete semChave.chave;
    expect(validarDerivado(semChave).join("\n")).toMatch(/chave/);
  });

  it("recusa chave curta ou fora de hexadecimal: o hash sem segredo deixaria adivinhar o número", () => {
    expect(() => exportarDerivado(crua(), "abc", meta)).toThrow(/chave/);
    expect(() => exportarDerivado(crua(), "z".repeat(64), meta)).toThrow(/chave/);
  });

  it("não exporta campo cru de enumeração desconhecida (fase, versão, tribunal com texto): falha antes de gravar", () => {
    const r = crua();
    r.resultados[0].tribunal = RELATOR;
    expect(() => exportarDerivado(r, CHAVE, meta)).toThrow(/tribunal/);
    const s = crua();
    s.resultados[0].fase = EMENTA;
    expect(() => exportarDerivado(s, CHAVE, meta)).toThrow(/fase/);
  });
});

describe("exportarDerivado da linha de base (busca_ampla em vários tribunais, E5 e júri)", () => {
  const ampla = (): RodadaCrua => ({
    estado: { iniciadoEm: "2026-10-24T10:00:00.000Z", chamadasAoSite: 20, recusasDoSite: [], completa: true },
    resultados: [
      {
        id: "e1-t01-tecnica",
        fase: "tese",
        versao: "tecnica",
        tribunais: ["stf", "stj"],
        chamadas: 6,
        mostrados: 2,
        msParede: 1234.4,
        numeros: [NUMERO, NUMERO],
        acordaos: [{ numero: NUMERO, tribunal: "stf", relator: RELATOR }, { numero: NUMERO, tribunal: "stj", ementa: EMENTA }],
        cobertura: [{ tribunal: "stf", buscasFeitas: 3, vazias: 0, comErro: 0, maisAntiga: "24/10 10:00", achados: 9 }],
      },
      {
        id: "e5-5trts-fria",
        fase: "trt",
        memoria: "fria",
        tribunais: ["trt1", "trt2"],
        chamadas: 2,
        mostrados: 0,
        numeros: [],
        cobertura: [{ tribunal: "trt1", buscasFeitas: 1, vazias: 1, comErro: 0, foraDoTeto: 1 }],
      },
    ],
    registros: [{ seq: 1, consulta: "e1-t01-tecnica", ms: 300, status: 200, resposta: EMENTA }],
  });
  const apuracao = { linhas: 40, controles: { total: 4, julgadosN: 4 }, semMaioria: 1, porPedido: { "e1-t01-tecnica": { S: 1, P: 1, C: 0, N: 0, semMaioria: 0 } } };

  it("leva tribunais, memória, tempo de parede, cobertura e contagens do júri, e nada de texto de caso", () => {
    const d = exportarDerivado(ampla(), CHAVE, meta, apuracao);
    expect(validarDerivado(d)).toEqual([]);
    const texto = JSON.stringify(d);
    for (const proibido of [NUMERO, RELATOR, "Fictício", "EMENTA", "24/10", "maisAntiga", "achados"]) expect(texto).not.toContain(proibido);
    const [e1, e5] = d.consultas;
    expect(e1).toMatchObject({ tribunais: ["stf", "stj"], msParede: 1234, ms: 300, juri: { S: 1, P: 1, C: 0, N: 0, semMaioria: 0 } });
    expect(e1.tribunal).toBeUndefined();
    expect(e5).toMatchObject({ memoria: "fria", cobertura: [{ tribunal: "trt1", buscasFeitas: 1, vazias: 1, comErro: 0, foraDoTeto: 1, guardadas: 0, feitasAgora: 0 }] });
    expect(d.juri).toEqual({ linhas: 40, controles: 4, controlesN: 4, semMaioria: 1 });
  });

  it("o mesmo número em dois tribunais são dois acórdãos (o tribunal entra no hash)", () => {
    const [h1, h2] = exportarDerivado(ampla(), CHAVE, meta).consultas[0].acordaos;
    expect(h1).not.toBe(h2);
  });

  it("um, e só um, entre tribunal e tribunais; cobertura e júri são objetos fechados; memória só da lista", () => {
    const bom = () => JSON.parse(JSON.stringify(exportarDerivado(ampla(), CHAVE, meta, apuracao)));
    const casos: [string, (d: Record<string, any>) => void][] = [
      ["consultas\\[0\\]\\.tribunal", (d) => (d.consultas[0].tribunal = "stf")],
      ["consultas\\[1\\]\\.tribunal", (d) => delete d.consultas[1].tribunais],
      ["consultas\\[0\\]\\.tribunais", (d) => (d.consultas[0].tribunais = [RELATOR])],
      ["consultas\\[1\\]\\.cobertura", (d) => (d.consultas[1].cobertura[0].maisAntiga = "24/10 10:00")],
      ["consultas\\[1\\]\\.cobertura", (d) => (d.consultas[1].cobertura[0].tribunal = RELATOR)],
      ["consultas\\[0\\]\\.juri", (d) => (d.consultas[0].juri.motivo = EMENTA)],
      ["juri\\.motivo", (d) => (d.juri.motivo = EMENTA)],
      ["consultas\\[1\\]\\.memoria", (d) => (d.consultas[1].memoria = "morna")],
    ];
    for (const [campo, estragar] of casos) {
      const d = bom();
      estragar(d);
      const problemas = validarDerivado(d).join("\n");
      expect(problemas, campo).toMatch(new RegExp(campo));
      expect(problemas).not.toContain(RELATOR);
    }
  });
});

describe("destinoInvalido (R04: a exportação não apaga a chave nem outro arquivo)", () => {
  const derivado = JSON.stringify(exportarDerivado(crua(), CHAVE, meta));

  it("recusa --para igual a --chave, inclusive com outra caixa e outra barra", () => {
    expect(destinoInvalido("E:/provas/chave.json", "E:/provas/chave.json", undefined)).toMatch(/chave/);
    expect(destinoInvalido(String.raw`e:\Provas\CHAVE.json`, "E:/provas/chave.json", CHAVE)).toMatch(/chave/);
  });

  it("recusa sobrescrever arquivo que não é um derivado do esquema (ex.: a chave guardada em .json)", () => {
    expect(destinoInvalido("E:/provas/a.json", "E:/provas/chave.txt", CHAVE)).toMatch(/não é um derivado/);
    expect(destinoInvalido("E:/provas/a.json", "E:/provas/chave.txt", "{")).toMatch(/não é um derivado/);
  });

  it("aceita destino novo ou um derivado anterior a substituir", () => {
    expect(destinoInvalido("E:/provas/a.json", "E:/provas/chave.txt", undefined)).toBeUndefined();
    expect(destinoInvalido("E:/provas/a.json", "E:/provas/chave.txt", derivado)).toBeUndefined();
  });
});

describe("validarDerivado (esquema fechado)", () => {
  const bom = () => exportarDerivado(crua(), CHAVE, meta) as unknown as Record<string, any>;

  it("campo a mais em qualquer nível é recusado", () => {
    const raiz = bom();
    raiz.observacao = "qualquer coisa";
    expect(validarDerivado(raiz).join("\n")).toMatch(/observacao/);
    const rodada = bom();
    rodada.rodada.motivo = "parou";
    expect(validarDerivado(rodada).join("\n")).toMatch(/rodada\.motivo/);
    const consulta = bom();
    consulta.consultas[0].relator = RELATOR;
    expect(validarDerivado(consulta).join("\n")).toMatch(/consultas\[0\]\.relator/);
  });

  it("texto livre num campo permitido é recusado: só enumeração, hash, data, versão ou id opaco", () => {
    const casos: [string, (d: Record<string, any>) => void][] = [
      ["tribunal", (d) => (d.consultas[0].tribunal = RELATOR)],
      ["id", (d) => (d.consultas[0].id = NUMERO)],
      ["acordaos", (d) => (d.consultas[0].acordaos = [NUMERO])],
      ["hashDoId", (d) => (d.consultas[0].hashDoId = "tese-01-tecnica")],
      ["versaoDoGarimpo", (d) => (d.versaoDoGarimpo = EMENTA)],
      ["commit", (d) => (d.commit = "não é hash")],
      ["iniciadoEm", (d) => (d.rodada.iniciadoEm = "ontem à tarde")],
      ["fase", (d) => (d.consultas[0].fase = "livre")],
    ];
    for (const [campo, estragar] of casos) {
      const d = bom();
      estragar(d);
      expect(validarDerivado(d).join("\n"), campo).toMatch(new RegExp(campo));
    }
  });

  it("número fora de inteiro não negativo é recusado; campo obrigatório ausente também", () => {
    const d = bom();
    d.consultas[0].ms = -1;
    d.rodada.chamadasAoSite = 1.5;
    delete d.consultas[1].acordaos;
    const problemas = validarDerivado(d).join("\n");
    expect(problemas).toMatch(/consultas\[0\]\.ms/);
    expect(problemas).toMatch(/rodada\.chamadasAoSite/);
    expect(problemas).toMatch(/consultas\[1\]\.acordaos/);
  });

  it("nome herdado de Object.prototype (constructor, toString, __proto__) não passa por campo do esquema", () => {
    const vazamento = { numero: NUMERO, relator: RELATOR, ementa: EMENTA };
    for (const nome of ["constructor", "toString", "__proto__"]) {
      for (const [onde, caminho] of [["raiz", ""], ["rodada", "rodada."], ["consulta", "consultas[0]."]] as const) {
        const d = JSON.parse(JSON.stringify(bom()));
        const alvo = onde === "raiz" ? d : onde === "rodada" ? d.rodada : d.consultas[0];
        // Propriedade própria, como JSON.parse cria ("__proto__" por atribuição trocaria o protótipo).
        Object.defineProperty(alvo, nome, { value: vazamento, enumerable: true, configurable: true, writable: true });
        const problemas = validarDerivado(d).join("\n");
        expect(problemas, `${onde}.${nome}`).toContain(`${caminho}${nome}: campo fora do esquema`);
        expect(problemas).not.toContain(RELATOR);
      }
    }
  });

  it("aceita só o esquema e a versão declarados", () => {
    const d = bom();
    d.esquema = "outro";
    expect(validarDerivado(d).join("\n")).toMatch(/esquema/);
    expect(validarDerivado(null)).not.toEqual([]);
    expect(validarDerivado([])).not.toEqual([]);
  });
});
