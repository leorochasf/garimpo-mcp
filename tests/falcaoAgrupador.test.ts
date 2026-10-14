import { describe, expect, it } from "vitest";
import { chamar, conectar, documento, falcaoFalso, pagina, siteFalso } from "./apoioFalcao.js";

/** Página do Falcão para o TRT e o texto pedidos: um acórdão fictício por (TRT, texto), sem colisão de id. */
function porPedido(url: URL) {
  const trt = url.searchParams.get("tribunais")!;
  const texto = url.searchParams.get("texto")!;
  const n = [...`${trt}${texto}`].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9_000_000, 7) + 1_000_000;
  return pagina([
    documento({
      tribunal: trt,
      idDocumentoAcordao: String(n),
      numeroProcesso: `0${n}-00.2024.5.01.0001`,
      ementa: `<p>${texto.toUpperCase()}. Ementa ficticia generica.</p>`,
    }),
  ]);
}

const pedidos = (falcao: { pedidos: URL[] }) => falcao.pedidos.map((u) => u.searchParams.get("tribunais")).sort();
const linhas = (r: { dado: any }) => r.dado.cabecalhoDeCobertura.porTribunal as { tribunal: string; foraDoTeto?: number; buscasFeitas: number }[];
const ARGS = { formulacoes: ["horas extras"], tribunais: ["trt"] };

describe('agrupador "trt" na busca ampla (I-27)', () => {
  it("expande em trt1..trt24, faz no máximo 5 pedidos ao Falcão e o resto sai foraDoTeto, nunca vazio", async () => {
    const falcao = falcaoFalso(porPedido);
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", ARGS);
    expect(r.isError).toBe(false);
    expect(pedidos(falcao)).toEqual(["TRT1", "TRT2", "TRT3", "TRT4", "TRT5"].sort());
    expect(linhas(r).map((l) => l.tribunal)).toEqual(Array.from({ length: 24 }, (_, i) => `trt${i + 1}`));
    expect(linhas(r).filter((l) => l.foraDoTeto === 1)).toHaveLength(19);
    expect(r.dado.completa).toBe(false);
    expect(JSON.stringify(r.dado).length).toBeLessThan(25_000);
    expect(r.dado.buscasPlanejadas).toBe(24);
    expect(r.dado.cabecalhoDeCobertura.agrupadorTrt).toMatch(/24 TRTs.*5 páginas.*19.*repita.*50/s);
  });

  it("repetir executa os 5 seguintes; os 5 primeiros voltam da memória sem chamada", async () => {
    const falcao = falcaoFalso(porPedido);
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    await chamar(mcp, "busca_ampla", ARGS);
    const de_novo = await chamar(mcp, "busca_ampla", ARGS);
    expect(pedidos(falcao).filter((t) => !["TRT1", "TRT2", "TRT3", "TRT4", "TRT5"].includes(t!))).toEqual(["TRT10", "TRT6", "TRT7", "TRT8", "TRT9"]);
    expect(linhas(de_novo).find((l) => l.tribunal === "trt1")).toMatchObject({ buscasFeitas: 1, guardadas: 1 });
    expect(de_novo.dado.cabecalhoDeCobertura.agrupadorTrt).toMatch(/14/);
  });

  it("junto de outro tribunal e de trt pedido pelo nome: sem duplicar, cada fonte com o seu aviso", async () => {
    const falcao = falcaoFalso(porPedido);
    const site = siteFalso([{ id: "s1", texto_ementa: "HORAS EXTRAS. Ementa ficticia.", numero_processo: "1.000.001/UF", data_julgamento: "2024-01-02" }]);
    const { mcp } = await conectar(site.cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", { formulacoes: ["horas extras"], tribunais: ["tst", "trt3", "trt"] });
    expect(r.isError).toBe(false);
    expect(site.chamadas).toHaveLength(1);
    expect(pedidos(falcao)).toEqual(["TRT1", "TRT2", "TRT3", "TRT4", "TRT5"]);
    expect(linhas(r)).toHaveLength(25);
    expect(r.dado.avisoNaturezaJuridica).toMatch(/Acórdãos dos TRTs/);
  });

  it('"trt" na busca_direta continua recusado', async () => {
    const falcao = falcaoFalso(porPedido);
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt", texto: "horas extras" });
    expect(r.isError).toBe(true);
    expect(falcao.pedidos).toHaveLength(0);
  });

  it("sem o agrupador, o cabeçalho não ganha agrupadorTrt", async () => {
    const falcao = falcaoFalso(porPedido);
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", { formulacoes: ["horas extras"], tribunais: ["trt2"] });
    expect(r.dado.cabecalhoDeCobertura).not.toHaveProperty("agrupadorTrt");
  });
});
