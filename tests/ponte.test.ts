import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { Memoria } from "../src/memoria.js";
import { clienteFalso, respostaJson } from "./apoio.js";

/** B2.2 (U52, AC-A29): a ponte do "só link" traz a chamada do ler_inteiro_teor pronta e o aviso de identidade; sem rede. */
const CNJ = "0000010-10.2024.8.05.0001";
let pasta: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-ponte-"));
});
afterEach(() => rm(pasta, { recursive: true, force: true, maxRetries: 10 }));

/** Um acórdão fictício guardado na memória por uma busca falsa, com ou sem link do PDF. */
async function guardado(tribunal: string, id: string, linkPdf: string | null) {
  const busca = clienteFalso([
    respostaJson({
      results: [{ id, texto_ementa: "EMENTA FICTÍCIA.", numero_processo: CNJ, numero_processo_cnj: CNJ, link_pdf: linkPdf }],
    }),
  ]);
  const memoria = new Memoria();
  await buscaDireta(busca.cliente, { tribunal, texto: "exemplo" }, memoria);
  return memoria;
}

describe("ponte do só link: chamada pronta pelo id", () => {
  it("TJBA com link: a resposta traz a chamada do ler_inteiro_teor com o id, faltando só o caminho, sem chamada", async () => {
    const memoria = await guardado("tjba", "901", "https://exemplo.tjba.jus.br/acordao/901");
    const { cliente, chamadas } = clienteFalso([]);
    const r = await obterInteiroTeor({ id: "tjba:901", pasta }, () => cliente, memoria);
    expect(r).toMatchObject({
      baixado: false,
      link: "https://exemplo.tjba.jus.br/acordao/901",
      chamadaPronta: {
        ferramenta: "ler_inteiro_teor",
        argumentos: { caminho: "<caminho do PDF que você baixou>", id: "tjba:901" },
      },
    });
    if (!r.baixado) expect(r.explicacao).toMatch(/ler_inteiro_teor com o id tjba:901/);
    expect(chamadas).toHaveLength(0);
  });

  it("aviso de identidade: o PDF trazido pode ser de outro acórdão, com o número a conferir, e a origem segue declarada, não conferida", async () => {
    const memoria = await guardado("tjba", "902", "https://exemplo.tjba.jus.br/acordao/902");
    const r = await obterInteiroTeor({ id: "tjba:902", pasta }, () => clienteFalso([]).cliente, memoria);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/pode ser de outro acórdão/);
    expect(r.explicacao).toContain(CNJ);
    expect(r.explicacao).toMatch(/declarada, não conferida/);
  });

  it("sem link na busca (só link e tribunal que baixa): a mesma chamada pronta, sem mandar abrir link nenhum", async () => {
    for (const [tribunal, id] of [["tjba", "903"], ["tjmg", "904"]]) {
      const memoria = await guardado(tribunal, id, null);
      const { cliente, chamadas } = clienteFalso([]);
      const r = await obterInteiroTeor({ id: `${tribunal}:${id}`, pasta }, () => cliente, memoria);
      expect(r, tribunal).toMatchObject({
        baixado: false,
        chamadaPronta: { ferramenta: "ler_inteiro_teor", argumentos: { id: `${tribunal}:${id}` } },
      });
      if (!r.baixado) expect(r.explicacao, tribunal).not.toMatch(/abr(a|ir) o link/i);
      expect(chamadas, tribunal).toHaveLength(0);
    }
  });

  it("e-SAJ que devolve página no lugar do PDF: a chamada pronta vem com o id", async () => {
    const memoria = await guardado("tjsp", "905", "https://esaj.tjsp.jus.br/cjsg/getArquivo.do?cdAcordao=905");
    const pagina = new Response("<html>página fictícia</html>", { headers: { "content-type": "text/html" } });
    const r = await obterInteiroTeor({ id: "tjsp:905", pasta }, () => clienteFalso([pagina]).cliente, memoria);
    expect(r).toMatchObject({ baixado: false, chamadaPronta: { argumentos: { id: "tjsp:905" } } });
    if (!r.baixado) expect(r.explicacao).toMatch(/pode ser de outro acórdão/);
  });

  it("pedido por tribunal + link, sem id: a chamada pronta leva o tribunal e o texto ensina a informar o id ou o número", async () => {
    const r = await obterInteiroTeor(
      { tribunal: "tjba", link: "https://exemplo.tjba.jus.br/acordao/906", pasta },
      () => clienteFalso([]).cliente,
    );
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.chamadaPronta).toEqual({
      ferramenta: "ler_inteiro_teor",
      argumentos: { caminho: "<caminho do PDF que você baixou>", tribunal: "tjba" },
    });
    expect(r.explicacao).toMatch(/com o id que veio na busca, ou tribunal \+ número/);
    expect(r.explicacao).toMatch(/pode ser de outro acórdão/);
  });

  it("TRT (texto do Falcão, nenhum PDF a trazer): sem chamada pronta", async () => {
    const r = await obterInteiroTeor({ id: "trt2:1", pasta }, () => clienteFalso([]).cliente);
    expect(r).not.toHaveProperty("chamadaPronta");
  });
});
