import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { infoTribunal, paginaDeTribunais, TRIBUNAIS } from "../src/tribunais.js";
import { clienteFalso } from "./apoio.js";

/**
 * B2.2: cada tribunal "só link" tem o motivo classificado e datado pela fotografia da B0.1 (onda0/realidade.md, tabela 2,
 * de 2026-10-23, sem rede). A data é a da prova registrada, não a de uma reconferência. O TJPR, só link na fotografia,
 * saiu do grupo na 1.1.2 com o texto do portal (ADR-0030).
 */
const FOTOGRAFIA_B01: Record<string, [string, string | undefined]> = {
  stj: ["vedação escrita", "2026-10-13"],
  tjrj: ["vedação escrita", "2026-10-14"],
  tjse: ["vedação escrita", "2026-10-14"],
  stf: ["desafio técnico", "2026-10-14"],
  tjsc: ["desafio técnico", "2026-10-14"],
  tjpa: ["rota quebrada", "2026-10-14"],
  tst: ["não testado", "2026-10-09"],
  tjrn: ["não testado", "2026-10-09"],
  ...Object.fromEntries(
    ["stm", "tjac", "tjal", "tjam", "tjap", "tjce", "tjes", "tjma", "tjmt", "tjpb", "tjpe", "tjro", "tjrs"].map(
      (s): [string, [string, undefined]] => [s, ["não testado", undefined]],
    ),
  ),
};

/** Pasta que não existe: o só link não grava nada, e a procura do PDF já baixado não acha nada. */
const SEM_PASTA = join(tmpdir(), "garimpo-b22-pasta-que-nao-existe");

describe("motivo do só link classificado e datado (fotografia B0.1)", () => {
  it("os 21 tribunais só link, e só eles, têm a classe e a data da fotografia", () => {
    const soLink = TRIBUNAIS.filter((t) => t.inteiroTeor === "link").map((t) => t.sigla);
    expect(soLink.sort()).toEqual(Object.keys(FOTOGRAFIA_B01).sort());
    for (const t of TRIBUNAIS) {
      const esperado = FOTOGRAFIA_B01[t.sigla];
      expect(t.classeDoMotivo, t.sigla).toBe(esperado?.[0]);
      expect(t.dataDaProva, t.sigla).toBe(esperado?.[1]);
    }
  });

  it("a data da prova é a mesma que o texto do motivo já diz", () => {
    for (const [sigla, [, data]] of Object.entries(FOTOGRAFIA_B01)) {
      if (!data) continue;
      const [a, m, d] = data.split("-");
      expect(infoTribunal(sigla)?.motivoLink, sigla).toMatch(new RegExp(`${data}|${d}/${m}/${a}`));
    }
  });

  it("a página garimpo://tribunais diz a classe e a data, ou que não há prova própria", () => {
    const pagina = paginaDeTribunais();
    expect(pagina).toMatch(/\| TJRJ \|.*só link \(vedação escrita; registro de 2026-10-14, sem nova conferência\): .*termo de uso/);
    expect(pagina).toMatch(/\| TJPA \|.*só link \(rota quebrada; registro de 2026-10-14, sem nova conferência\)/);
    expect(pagina).toMatch(/\| TJAP \|.*só link \(não testado; sem prova própria\)/);
  });

  it("a resposta do obter_inteiro_teor no só link traz a classe e a data, sem chamada", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    const stj = await obterInteiroTeor({ tribunal: "stj", link: "https://exemplo.test/stj/1", pasta: SEM_PASTA }, () => cliente);
    expect(stj).toMatchObject({ baixado: false, classeDoMotivo: "vedação escrita", dataDaProva: "2026-10-13" });
    const tjap = await obterInteiroTeor({ tribunal: "tjap", link: "https://exemplo.test/tjap/1", pasta: SEM_PASTA }, () => cliente);
    expect(tjap).toMatchObject({ baixado: false, classeDoMotivo: "não testado" });
    expect(tjap).not.toHaveProperty("dataDaProva");
    expect(chamadas).toHaveLength(0);
  });
});
