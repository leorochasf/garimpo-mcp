import { describe, expect, it } from "vitest";
import { infoTribunal, paginaDeTribunais } from "../src/tribunais.js";

/** I-23 / G-24 (DQ-24b): o motivo do "só link" só aparece onde o Garimpo tem prova própria, com a data; sem rede. */
const NAO_TESTADO =
  "O Garimpo ainda não testou o download automático do portal deste tribunal; abra o link no navegador.";

const motivo = (sigla: string) => infoTribunal(sigla)?.motivoLink ?? "";

describe("motivo do só link com prova própria (datado, sem prometer download futuro)", () => {
  const COM_PROVA: [string, RegExp[]][] = [
    ["tjrj", [/termo de uso/i, /veda/i, /permissão expressa por escrito/i, /29\/10\/2026/]],
    ["tjse", [/robots\.txt/, /Disallow: \//, /\/portal/, /29\/10\/2026/]],
    ["tjpe", [/robots\.txt do TJPE \(www\.tjpe\.jus\.br\)/, /Disallow: \//, /29\/10\/2026/]],
    ["tjpb", [/juris\.tjpb\.jus\.br/, /Disallow: \//, /pje-jurisprudencia\.tjpb\.jus\.br/, /Cloudflare/, /29\/10\/2026/]],
    ["tjrs", [/robots\.txt do TJRS \(www\.tjrs\.jus\.br\)/, /Disallow: \/busca/, /\/buscas\/jurisprudencia\//, /29\/10\/2026/]],
    ["tjpa", [/jurisprudencia\.tjpa\.jus\.br/, /tela de pesquisa/i, /sem o acórdão/i, /número do processo/i, /29\/10\/2026/]],
    ["tjmt", [/hellsgate\.tjmt\.jus\.br/, /HTTP 401/, /chave de API/, /29\/10\/2026/]],
    ["tjsc", [/eproc1g\.tjsc\.jus\.br/, /bloqueio/i, /não autorizado/i, /29\/10\/2026/]],
    ["tjro", [/juris\.tjro\.jus\.br/, /HTTP 200/, /verificação anti-robô/i, /29\/10\/2026/]],
    ["tjal", [/www2\.tjal\.jus\.br/, /código da figura/i, /captcha/i, /29\/10\/2026/]],
    ["tjam", [/consultasaj\.tjam\.jus\.br/, /código da figura/i, /captcha/i, /29\/10\/2026/]],
    ["tjac", [/esaj\.tjac\.jus\.br/, /código da figura/i, /captcha/i, /29\/10\/2026/]],
    ["tjap", [/tucujuris\.tjap\.jus\.br/, /HTTP 403/, /Cloudflare/, /29\/10\/2026/]],
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
    for (const sigla of ["stm", "tjes", "tjma"]) {
      expect(motivo(sigla), sigla).toBe(NAO_TESTADO);
    }
  });

  it("os TJs com barreira provada em 29/10 não ficam com a data antiga nem com a explicação genérica", () => {
    for (const sigla of ["tjpa", "tjmt", "tjpb", "tjpe", "tjse", "tjrj", "tjsc", "tjro", "tjal", "tjam", "tjac", "tjap", "tjrs"]) {
      const info = infoTribunal(sigla);
      expect(info?.dataDaProva, sigla).toBe("2026-10-29");
      expect(info?.motivoLink, sigla).not.toMatch(/14\/10\/2026|2026-10-14|ainda não testou/);
    }
  });

  it("o TJRN segue inconclusivo, com o resultado de 2026-10-09", () => {
    expect(motivo("tjrn")).toMatch(/^Testado em 2026-10-09 sem conclusão/);
    expect(infoTribunal("tjrn")?.dataDaProva).toBe("2026-10-09");
  });

  it("a página garimpo://tribunais traz os motivos novos", () => {
    const pagina = paginaDeTribunais();
    expect(pagina).toMatch(/\| TJRJ \|.*termo de uso/);
    expect(pagina).toMatch(/\| TJSE \|.*Disallow/);
    expect(pagina).toMatch(/\| TJAL \|.*desafio técnico; registro de 2026-10-29.*captcha/);
  });
});
