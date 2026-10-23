import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { ORCAMENTO_DE_RELATORES, panorama } from "../src/panorama.js";
import { lerResultadosDoTrf4 } from "../src/trf4.js";

let seq = 0;
/** Acórdão mínimo e fictício: só o que o panorama lê. */
function acordao(tribunal: string, relator?: string): Acordao {
  seq += 1;
  return { id: `${tribunal}:${seq}`, tribunal, numero: `N ${seq}`, semNumero: false, relator, ementa: "Ementa fictícia." } as Acordao;
}

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
      ...Array.from({ length: 30 }, (_, i) => acordao("stj", `Relator ${i}`)),
      acordao("stj"),
      acordao("stj", "Fulano (relator para o acórdão: Beltrano)"),
    ];
    const p = panorama(registros);
    const r = p.porRelator.stj;
    const soma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(
      soma(r.relatores.valores) + r.relatores.outros + soma(r.paraOAcordao.valores) + r.paraOAcordao.outros + r.naoInformado,
    ).toBe(p.porTribunal.stj);
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
    const p = panorama([acordao("trf4", texto), acordao("trf4", texto), acordao("trf4", "JUIZ FICTÍCIO UM")]);
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
    const p = panorama([acordao("stj", texto)]);
    expect(p.porRelator.stj.relatores.valores).toEqual({ [texto]: 1 });
    expect(p.porRelator.stj.paraOAcordao).toEqual({ valores: {}, outros: 0 });
  });

  it("também limita a lista de relator para o acórdão em 20, com o resto em outros", () => {
    const registros = Array.from({ length: 23 }, (_, i) => acordao("trf4", `Relator ${String(i).padStart(2, "0")} (relator para o acórdão: Outro)`));
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

describe("panorama por relator — teto de tamanho da resposta", () => {
  it("o texto longo demais que lidera a contagem não encerra a lista dos nomes que cabem", () => {
    const longo = "Fulano ".repeat(100);
    const p = panorama([acordao("stj", longo), acordao("stj", longo), acordao("stj", longo), acordao("stj", "Abel"), acordao("stj", "Bruno")]);
    expect(p.porRelator.stj.relatores).toEqual({ valores: { Abel: 1, Bruno: 1 }, outros: 3 });
  });

  const nomeLongo = (i: number, sufixo = "") => `${String(i).padStart(3, "0")} ${"Nome Fictício ".repeat(14)}`.slice(0, 190 - sufixo.length) + sufixo;
  const somaDeCaracteres = (p: ReturnType<typeof panorama>) =>
    Object.values(p.porRelator).reduce(
      (s, r) => s + [...Object.keys(r.relatores.valores), ...Object.keys(r.paraOAcordao.valores)].reduce((t, k) => t + k.length, 0),
      0,
    );

  it("200 acórdãos em 5 tribunais com nomes de 190 caracteres nas duas listas cabem em 25 mil caracteres", () => {
    const registros = ["stj", "tjgo", "tjsp", "tjmg", "tjto"].flatMap((t) => [
      ...Array.from({ length: 20 }, (_, i) => acordao(t, nomeLongo(i))),
      ...Array.from({ length: 20 }, (_, i) => acordao(t, nomeLongo(i, " (relator para o acórdão: Fulano)"))),
    ]);
    const p = panorama(registros);
    expect(p.total).toBe(200);
    expect(somaDeCaracteres(p)).toBeLessThanOrEqual(ORCAMENTO_DE_RELATORES);
    expect(JSON.stringify(p).length).toBeLessThan(25_000);
  });

  it("40 tribunais com 5 acórdãos de nomes longos: o orçamento se divide e o que não cabe soma em outros, sem perder contagem", () => {
    const registros = Array.from({ length: 40 }, (_, t) =>
      Array.from({ length: 5 }, (_, i) => acordao(`trib${t}`, nomeLongo(i))),
    ).flat();
    const p = panorama(registros);
    expect(somaDeCaracteres(p)).toBeLessThanOrEqual(ORCAMENTO_DE_RELATORES);
    for (const r of Object.values(p.porRelator)) {
      const mostrados = Object.values(r.relatores.valores).reduce((a, b) => a + b, 0);
      expect(mostrados + r.relatores.outros).toBe(5);
    }
    expect(JSON.stringify(p).length).toBeLessThan(25_000);
  });
});
