import { describe, expect, it } from "vitest";
import { infoTribunal, paginaDeTribunais } from "../src/tribunais.js";

/** I-23 / G-24 (DQ-24b): o motivo do "só link" só aparece onde o Garimpo tem prova própria, com a data; sem rede. */
const NAO_TESTADO =
  "O Garimpo ainda não testou o download automático do portal deste tribunal; abra o link no navegador.";

const motivo = (sigla: string) => infoTribunal(sigla)?.motivoLink ?? "";

describe("motivo do só link com prova própria (datado, sem prometer download futuro)", () => {
  const COM_PROVA: [string, RegExp[]][] = [
    ["tjrj", [/termo de uso/i, /veda/i, /permissão expressa por escrito/i, /14\/10\/2026/]],
    ["tjse", [/robots\.txt/, /Disallow: \//, /\/portal/, /14\/10\/2026/]],
    ["tjpa", [/casca do aplicativo/i, /sem o acórdão/i, /14\/10\/2026/]],
    ["tjsc", [/bloqueio/i, /não autorizado/i, /14\/10\/2026/]],
    ["stf", [/redir\.stf\.jus\.br/, /202/, /14\/10\/2026/]],
    ["stj", [/robots\.txt de processo\.stj\.jus\.br/, /2026-10-13/]],
  ];

  for (const [sigla, padroes] of COM_PROVA) {
    it(`${sigla.toUpperCase()} diz o motivo real, com a data da prova`, () => {
      const texto = motivo(sigla);
      expect(texto).not.toBe(NAO_TESTADO);
      for (const p of padroes) expect(texto, `${sigla} ${p}`).toMatch(p);
      expect(texto, sigla).not.toMatch(/em breve|futuramente|passará a|vai passar/i);
      expect(texto, sigla).toMatch(/; abra o link no navegador\.$/);
    });
  }

  it("tribunais sem prova própria seguem com o texto antigo \"ainda não testou\"", () => {
    for (const sigla of ["stm", "tjac", "tjal", "tjam", "tjap", "tjba", "tjce", "tjes", "tjma", "tjmt", "tjpb", "tjpe", "tjro", "tjrs"]) {
      expect(motivo(sigla), sigla).toBe(NAO_TESTADO);
    }
  });

  it("a página garimpo://tribunais traz os motivos novos", () => {
    const pagina = paginaDeTribunais();
    expect(pagina).toMatch(/\| TJRJ \|.*termo de uso/);
    expect(pagina).toMatch(/\| TJSE \|.*Disallow/);
  });
});
