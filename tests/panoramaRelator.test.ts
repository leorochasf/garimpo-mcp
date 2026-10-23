import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { panorama, respostaDoPanorama, TETO_DA_RESPOSTA, TETO_DO_PANORAMA } from "../src/panorama.js";
import { ROTULO_FALCAO, ROTULO_TNU, ROTULO_TRF2, ROTULO_TRF4 } from "../src/tribunais.js";
import { lerResultadosDoTrf4 } from "../src/trf4.js";

let seq = 0;
/** Acórdão mínimo e fictício: só o que o panorama lê. */
function acordao(tribunal: string, relator?: string, fonte?: string): Acordao {
  seq += 1;
  return { id: `${tribunal}:${seq}`, tribunal, numero: `N ${seq}`, semNumero: false, relator, fonte, ementa: "Ementa fictícia." } as Acordao;
}

const ROTULO_DO_EPROC: Record<string, string> = { trf2: ROTULO_TRF2, trf4: ROTULO_TRF4, tnu: ROTULO_TNU };
/** Registro como o adaptador do e-Proc o monta: tribunal e rótulo da fonte do próprio e-Proc. */
const doEproc = (tribunal: "trf2" | "trf4" | "tnu", relator?: string) => acordao(tribunal, relator, ROTULO_DO_EPROC[tribunal]);

describe("panorama por relator — contagem simples", () => {
  it("conta por tribunal: o mesmo nome em tribunais diferentes não se soma", () => {
    const p = panorama([
      acordao("stj", "Fulano de Tal"),
      acordao("stj", "Fulano de Tal"),
      acordao("tjgo", "Fulano de Tal"),
      acordao("tjgo", "Beltrano de Tal"),
    ]);
    expect(p.porRelator.stj.relatores.valores).toEqual({ "Fulano de Tal": 2 });
    expect(p.porRelator.tjgo.relatores.valores).toEqual({ "Beltrano de Tal": 1, "Fulano de Tal": 1 });
  });

  it("põe o relator ausente, vazio ou só de espaços em naoInformado, longe dos nomes", () => {
    const p = panorama([acordao("stj", "Fulano de Tal"), acordao("stj"), acordao("stj", ""), acordao("stj", "   \t")]);
    expect(p.porRelator.stj.naoInformado).toBe(3);
    expect(p.porRelator.stj.relatores.valores).toEqual({ "Fulano de Tal": 1 });
  });

  it("não funde grafias diferentes do mesmo nome: caixa, espaço e acento ficam como a fonte deu", () => {
    const grafias = ["Fulano de Tal", "FULANO DE TAL", "Fulano  de Tal", "Fulano de Tal ", "Fulaño de Tal", "Fulano de T."];
    const p = panorama(grafias.map((g) => acordao("stj", g)));
    expect(Object.keys(p.porRelator.stj.relatores.valores).sort()).toEqual([...grafias].sort());
    expect(Object.values(p.porRelator.stj.relatores.valores)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("ordena do mais frequente ao menos e, no empate, por nome", () => {
    const p = panorama([
      acordao("stj", "Zélia"), acordao("stj", "Abel"), acordao("stj", "Abel"), acordao("stj", "Bruno"), acordao("stj", "Zélia"),
      acordao("stj", "Carlos"), acordao("stj", "Carlos"), acordao("stj", "Carlos"),
    ]);
    expect(Object.entries(p.porRelator.stj.relatores.valores)).toEqual([["Carlos", 3], ["Abel", 2], ["Zélia", 2], ["Bruno", 1]]);
  });

  it("aceita relator com nome de propriedade de Object", () => {
    const p = panorama(["constructor", "__proto__", "toString"].map((r) => acordao("stj", r)));
    expect(Object.keys(p.porRelator.stj.relatores.valores).sort()).toEqual(["__proto__", "constructor", "toString"]);
    expect(Object.getPrototypeOf(p.porRelator.stj.relatores.valores)).toBe(Object.prototype);
  });

  it("a soma dos nomes, de outros, de relator para o acórdão e de naoInformado fecha com o total do tribunal", () => {
    const registros = [
      ...Array.from({ length: 30 }, (_, i) => doEproc("trf4", `Relator ${i}`)),
      doEproc("trf4"),
      doEproc("trf4", "Fulano (relator para o acórdão: Beltrano)"),
    ];
    const p = panorama(registros);
    const r = p.porRelator.trf4;
    const soma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(
      soma(r.relatores.valores) + r.relatores.outros + soma(r.paraOAcordao.valores) + r.paraOAcordao.outros + r.naoInformado,
    ).toBe(p.porTribunal.trf4);
  });
});

describe("panorama por relator — top-N e outros", () => {
  it("mostra os 20 relatores mais frequentes por tribunal e soma o resto em outros", () => {
    // 25 relatores distintos: Relator 0 com 5 acórdãos, 1 com 4 ... e os demais com 1; o resto soma 5.
    const registros = Array.from({ length: 25 }, (_, i) => acordao("stj", `Relator ${String(i).padStart(2, "0")}`));
    registros.push(...Array.from({ length: 4 }, () => acordao("stj", "Relator 00")));
    const p = panorama(registros);
    expect(Object.keys(p.porRelator.stj.relatores.valores)).toHaveLength(20);
    expect(p.porRelator.stj.relatores.valores["Relator 00"]).toBe(5);
    expect(p.porRelator.stj.relatores.outros).toBe(5);
  });

  it("outros é um campo à parte: um relator chamado 'outros' não se mistura com o resto", () => {
    const registros = [
      acordao("stj", "outros"),
      ...Array.from({ length: 25 }, (_, i) => acordao("stj", `Relator ${String(i).padStart(2, "0")}`)),
    ];
    const p = panorama(registros);
    expect(p.porRelator.stj.relatores.valores["outros"]).toBe(1);
    expect(p.porRelator.stj.relatores.outros).toBe(6);
  });

  it("texto de relator maior que 200 caracteres nunca é mostrado: conta em outros, para a resposta não estourar", () => {
    const longo = "Fulano ".repeat(100);
    const p = panorama([acordao("stj", longo), acordao("stj", longo), acordao("stj", "Fulano")]);
    expect(p.porRelator.stj.relatores.valores).toEqual({ Fulano: 1 });
    expect(p.porRelator.stj.relatores.outros).toBe(2);
  });
});

describe("panorama por relator — relator para o acórdão (formato exato do e-Proc)", () => {
  it("separa só o formato «<relator> (relator para o acórdão: <nome>)» e mantém o texto original", () => {
    const texto = "JUIZ FICTÍCIO UM (relator para o acórdão: JUÍZA FICTÍCIA TRÊS)";
    const p = panorama([doEproc("trf4", texto), doEproc("trf4", texto), doEproc("trf4", "JUIZ FICTÍCIO UM")]);
    expect(p.porRelator.trf4.paraOAcordao.valores).toEqual({ [texto]: 2 });
    expect(p.porRelator.trf4.relatores.valores).toEqual({ "JUIZ FICTÍCIO UM": 1 });
  });

  it.each([
    ["sem os dois pontos", "Fulano (relator para o acórdão Beltrano)"],
    ["caixa diferente", "Fulano (Relator para o acórdão: Beltrano)"],
    ["relatora no feminino", "Fulano (relatora para o acórdão: Beltrana)"],
    ["sobra texto depois", "Fulano (relator para o acórdão: Beltrano) e outro"],
    ["sobra texto antes do nome", "Fulano - (relator para o acórdão: Beltrano"],
    ["sem relator antes", "(relator para o acórdão: Beltrano)"],
    ["sem nome depois", "Fulano (relator para o acórdão: )"],
    ["sem espaço antes do parêntese", "Fulano(relator para o acórdão: Beltrano)"],
    ["parêntese dentro do nome", "Fulano (Conv.) (relator para o acórdão: Beltrano)"],
    ["marcador repetido", "Fulano (relator para o acórdão: A) (relator para o acórdão: B)"],
    ["espaço sobrando", "Fulano  (relator para o acórdão: Beltrano)"],
    ["relator vencido por outro texto", "Fulano, vencido; relator para o acórdão: Beltrano"],
  ])("qualquer outro texto conta inteiro como relator (%s)", (_motivo, texto) => {
    const p = panorama([doEproc("trf4", texto)]);
    expect(p.porRelator.trf4.relatores.valores).toEqual({ [texto]: 1 });
    expect(p.porRelator.trf4.paraOAcordao).toEqual({ valores: {}, outros: 0 });
  });

  const COMPOSTO = "Fulano (relator para o acórdão: Beltrano)";

  it.each(["trf2", "trf4", "tnu"] as const)("separa o formato exato nos três e-Procs (%s)", (t) => {
    const p = panorama([doEproc(t, COMPOSTO)]);
    expect(p.porRelator[t].paraOAcordao.valores).toEqual({ [COMPOSTO]: 1 });
    expect(p.porRelator[t].relatores.valores).toEqual({});
  });

  it.each([
    ["JurisprudênciaIA (sem rótulo de fonte)", () => acordao("stj", COMPOSTO), "stj"],
    ["JurisprudênciaIA em tribunal federal sem rótulo de e-Proc", () => acordao("trf4", COMPOSTO), "trf4"],
    ["Falcão (rótulo do Falcão)", () => acordao("trt2", COMPOSTO, ROTULO_FALCAO), "trt2"],
    ["rótulo do e-Proc de outro tribunal", () => acordao("trf4", COMPOSTO, ROTULO_TRF2), "trf4"],
    ["rótulo do e-Proc em tribunal que não é dele", () => acordao("stj", COMPOSTO, ROTULO_TRF4), "stj"],
  ])("fora do e-Proc comprovado o texto composto fica inteiro em relatores, sem separar (%s)", (_origem, registro, t) => {
    const p = panorama([registro()]);
    expect(p.porRelator[t].relatores.valores).toEqual({ [COMPOSTO]: 1 });
    expect(p.porRelator[t].paraOAcordao).toEqual({ valores: {}, outros: 0 });
  });

  it("também limita a lista de relator para o acórdão em 20, com o resto em outros", () => {
    const registros = Array.from({ length: 23 }, (_, i) => doEproc("trf4", `Relator ${String(i).padStart(2, "0")} (relator para o acórdão: Outro)`));
    const p = panorama(registros);
    expect(Object.keys(p.porRelator.trf4.paraOAcordao.valores)).toHaveLength(20);
    expect(p.porRelator.trf4.paraOAcordao.outros).toBe(3);
  });
});

describe("panorama por relator — fixture compartilhada com o leitor do e-Proc", () => {
  // O recorte do TRF4 tem 2 dos 10 cards: só o total é ajustado para ser uma página completa de 2.
  const RESULTADOS = readFileSync(new URL("./fixtures/trf4-resultados.html", import.meta.url), "latin1")
    .replace('name="hdnTotalResultado" type="hidden" value="30196"', 'name="hdnTotalResultado" type="hidden" value="2"');
  const RELATOR_DO_PRIMEIRO = '<div class="resValue completo">JUIZ FICTÍCIO UM</div>';
  const comRelatorParaOAcordao = RESULTADOS.replace(
    RELATOR_DO_PRIMEIRO,
    RELATOR_DO_PRIMEIRO +
      '<div class="resLabel">RELATOR PARA ACÓRDÃO</div><div class="resValue completo">JUÍZA FICTÍCIA TRÊS</div>',
  );

  it("o registro que o leitor do e-Proc monta é separado pelo panorama; o outro continua relator", () => {
    expect(comRelatorParaOAcordao).not.toBe(RESULTADOS);
    const { acordaos } = lerResultadosDoTrf4(comRelatorParaOAcordao);
    // Se o formato do relator no e-Proc mudar, esta linha quebra...
    expect(acordaos.map((a) => a.relator)).toEqual([
      "JUIZ FICTÍCIO UM (relator para o acórdão: JUÍZA FICTÍCIA TRÊS)",
      "JUÍZA FICTÍCIA DOIS",
    ]);
    // ...e, se o panorama deixar de reconhecer o formato, esta.
    const p = panorama(acordaos);
    expect(p.porRelator.trf4.paraOAcordao.valores).toEqual({
      "JUIZ FICTÍCIO UM (relator para o acórdão: JUÍZA FICTÍCIA TRÊS)": 1,
    });
    expect(p.porRelator.trf4.relatores.valores).toEqual({ "JUÍZA FICTÍCIA DOIS": 1 });
    expect(p.porRelator.trf4.naoInformado).toBe(0);
  });
});

describe("panorama — teto de tamanho da resposta inteira (órgãos e relatores juntos)", () => {
  const nome = (prefixo: string, i: number, tamanho: number) => `${prefixo} ${String(i).padStart(2, "0")} `.padEnd(tamanho, "Fictício ");
  const soma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const cinco = ["stj", "tjgo", "tjsp", "tjmg", "tjto"];
  const comOrgaoERelator = (t: string, i: number, orgao: string, relator: string) =>
    ({ ...acordao(t, relator), orgao, dataJulgamento: `20${10 + (i % 12)}-01-01` }) as Acordao;

  /** Nenhuma contagem se perde: o que não cabe na lista soma em outros. */
  function conferirConservacao(p: ReturnType<typeof panorama>, porTribunal: number) {
    for (const t of Object.keys(p.porTribunal)) {
      expect(soma(p.porOrgao[t])).toBe(porTribunal);
      const r = p.porRelator[t];
      expect(soma(r.relatores.valores) + r.relatores.outros + soma(r.paraOAcordao.valores) + r.paraOAcordao.outros + r.naoInformado).toBe(porTribunal);
    }
  }

  it("200 acórdãos em 5 tribunais, 20 órgãos de 200 caracteres e 20 relatores de 110 (o caso da revisão): cabe no teto", () => {
    const registros = cinco.flatMap((t) =>
      Array.from({ length: 40 }, (_, i) => comOrgaoERelator(t, i, nome("Orgao", i % 20, 200), nome("Relator", i % 20, 110))),
    );
    const p = panorama(registros);
    expect(p.total).toBe(200);
    expect(JSON.stringify(p).length).toBeLessThanOrEqual(TETO_DO_PANORAMA);
    conferirConservacao(p, 40);
  });

  it("nomes de 190 caracteres em órgão, relator e relator para o acórdão ao mesmo tempo, em 5 e em 40 tribunais", () => {
    const outros = (n: number) => Array.from({ length: n }, (_, i) => `tj${i}`);
    for (const tribunais of [["trf2", "trf4", "tnu", "stj", "tjgo"], ["trf2", "trf4", "tnu", ...outros(37)]]) {
      const por = 200 / tribunais.length;
      const registros = tribunais.flatMap((t) =>
        Array.from({ length: por }, (_, i) => {
          // Relator para o acórdão só existe no e-Proc: os três levam o rótulo de fonte certo; o resto, não.
          const relator = nome("Relator", i % 20, 150).trim() + (i % 2 ? " (relator para o acórdão: Fulano)" : "");
          return { ...comOrgaoERelator(t, i, nome("Orgao", i % 20, 190), relator), fonte: ROTULO_DO_EPROC[t] } as Acordao;
        }),
      );
      const p = panorama(registros);
      // O cenário anunciado existe de fato: nos três e-Procs as duas listas têm valores.
      for (const t of ["trf2", "trf4", "tnu"]) {
        expect(Object.keys(p.porRelator[t].relatores.valores).length).toBeGreaterThan(0);
        expect(Object.keys(p.porRelator[t].paraOAcordao.valores).length).toBeGreaterThan(0);
      }
      expect(JSON.stringify(p).length).toBeLessThanOrEqual(TETO_DO_PANORAMA);
      conferirConservacao(p, por);
    }
  });

  it("órgão chamado 'outros' não perde a contagem quando o corte por tamanho também soma o resto em outros", () => {
    // 5 tribunais: 5 acórdãos de órgão 'outros' e 35 em 19 órgãos de 200 caracteres (caso da reconferência).
    const registros = cinco.flatMap((t) =>
      Array.from({ length: 40 }, (_, i) => comOrgaoERelator(t, i, i < 5 ? "outros" : nome("Orgao", i % 19, 200), "Relator")),
    );
    const p = panorama(registros);
    for (const t of cinco) {
      expect(soma(p.porOrgao[t])).toBe(40);
      expect(p.porOrgao[t].outros).toBeGreaterThanOrEqual(5);
    }
    conferirConservacao(p, 40);
  });

  it("órgão chamado 'outros' soma ao resto mesmo quando o corte é só por quantidade (mais de 20 órgãos)", () => {
    const registros = [
      ...Array.from({ length: 4 }, () => comOrgaoERelator("stj", 0, "outros", "R")),
      ...Array.from({ length: 25 }, (_, i) => comOrgaoERelator("stj", i, `Turma ${String(i).padStart(2, "0")}`, "R")),
    ];
    const p = panorama(registros);
    expect(soma(p.porOrgao.stj)).toBe(29);
    conferirConservacao(p, 29);
  });

  it("caso comum continua inteiro: 5 tribunais, órgãos e relatores de tamanho normal aparecem todos (20 + outros)", () => {
    const registros = cinco.flatMap((t) =>
      Array.from({ length: 40 }, (_, i) => comOrgaoERelator(t, i, `Câmara Cível ${i % 25}`, `Desembargador Fulano ${i % 25}`)),
    );
    const p = panorama(registros);
    for (const t of cinco) {
      expect(Object.keys(p.porOrgao[t])).toHaveLength(21);
      expect(Object.keys(p.porRelator[t].relatores.valores)).toHaveLength(20);
    }
    conferirConservacao(p, 40);
  });

  it("o texto longo demais que lidera a contagem não encerra a lista dos nomes que cabem", () => {
    const longo = "Fulano ".repeat(100);
    const p = panorama([acordao("stj", longo), acordao("stj", longo), acordao("stj", longo), acordao("stj", "Abel"), acordao("stj", "Bruno")]);
    expect(p.porRelator.stj.relatores).toEqual({ valores: { Abel: 1, Bruno: 1 }, outros: 3 });
  });
});

describe("respostaDoPanorama — teto de 25 mil caracteres da resposta inteira, no pior caso", () => {
  const nome = (prefixo: string, i: number, tamanho: number) => `${prefixo} ${String(i).padStart(2, "0")} `.padEnd(tamanho, "Fictício ");
  const cinco = ["stj", "tjgo", "tjsp", "tjmg", "tjto"];
  const guardados = cinco.flatMap((t, k) =>
    Array.from({ length: 20 }, (_, i) =>
      ({ ...acordao(t, nome("Relator", i, 200)), orgao: nome("Orgao", i, 200), dataJulgamento: `20${10 + ((i + k) % 12)}-01-01` }) as Acordao,
    ),
  );
  const avisoLongo = "Aviso de natureza jurídica das cinco fontes. ".repeat(40);

  it.each([
    ["100 ids ausentes de ~96 caracteres (o caso da reconferência)", 100, 96],
    ["100 ids ausentes de 3 mil caracteres", 100, 3000],
    ["ids ausentes curtos", 100, 12],
  ])("%s: a resposta serializada nunca passa de 25 mil e cada ausente fica identificado", (_caso, quantos, tamanho) => {
    const ausentes = Array.from({ length: quantos }, (_, i) => ({
      id: `stj:${i}x${"9".repeat(tamanho - 5 - String(i).length)}`,
      posicao: 101 + i,
    }));
    const r = respostaDoPanorama(guardados, ausentes, avisoLongo);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(TETO_DA_RESPOSTA);
    expect(r.total).toBe(100);
    const posicoesListadas = r.foraDaMemoria.map((id) => ausentes.find((a) => a.id === id)!.posicao);
    const todas = [...posicoesListadas, ...(r.foraDaMemoriaSemEspaco ?? [])].sort((a, b) => a - b);
    expect(todas).toEqual(ausentes.map((a) => a.posicao));
    conferirContagem(r);
  });

  it("sem ausentes não aparece foraDaMemoriaSemEspaco nem aviso de refazer a busca", () => {
    const r = respostaDoPanorama(guardados, [], "aviso");
    expect(r.foraDaMemoria).toEqual([]);
    expect(r).not.toHaveProperty("foraDaMemoriaSemEspaco");
    expect(r).not.toHaveProperty("aviso");
  });

  it("ids que cabem vêm inteiros, na ordem recebida, sem posições de reserva", () => {
    const ausentes = [{ id: "stj:9001", posicao: 3 }, { id: "tjgo:9002", posicao: 7 }];
    const r = respostaDoPanorama(guardados, ausentes, "aviso");
    expect(r.foraDaMemoria).toEqual(["stj:9001", "tjgo:9002"]);
    expect(r).not.toHaveProperty("foraDaMemoriaSemEspaco");
    expect(r.aviso).toMatch(/refaça a busca/i);
  });

  function conferirContagem(r: ReturnType<typeof respostaDoPanorama>) {
    const soma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    for (const t of cinco) {
      expect(soma(r.porOrgao[t])).toBe(20);
      const rel = r.porRelator[t];
      expect(soma(rel.relatores.valores) + rel.relatores.outros + soma(rel.paraOAcordao.valores) + rel.paraOAcordao.outros + rel.naoInformado).toBe(20);
    }
  }
});
