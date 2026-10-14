import { describe, expect, it } from "vitest";
import { PESQUISA_FALCAO } from "../src/falcao.js";
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

  it("agrupador repetido e TRT nomeado repetido não duplicam buscas nem cobertura", async () => {
    const falcao = falcaoFalso(porPedido);
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", { ...ARGS, tribunais: ["TRT", "trt", "trt3", "TRT3"] });
    expect(r.isError).toBe(false);
    expect(r.dado.buscasPlanejadas).toBe(24);
    expect(linhas(r)).toHaveLength(24);
    expect(falcao.pedidos).toHaveLength(5);
    expect(new Set(pedidos(falcao)).size).toBe(5);
  });

  it("teto diário acaba no meio: só duas páginas novas, demais buscas não pesquisadas", async () => {
    const falcao = falcaoFalso(porPedido);
    // Consome 48 das 50 chamadas reais do Cliente, com transporte inteiramente falso.
    for (let i = 0; i < 48; i++) {
      await (await falcao.cliente.requisitar(`${PESQUISA_FALCAO}?tribunais=TRT1&texto=preparo`)).json();
    }
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", ARGS);
    expect(r.isError).toBe(false);
    expect(falcao.pedidos).toHaveLength(50);
    expect(r.dado.completa).toBe(false);
    expect(linhas(r).slice(0, 2).every((l) => l.buscasFeitas === 1)).toBe(true);
    expect(linhas(r).slice(2, 5).every((l: any) => l.pausaPreventiva === 1 && l.buscasFeitas === 0 && l.vazias === 0)).toBe(true);
    expect(linhas(r).slice(5).every((l) => l.foraDoTeto === 1 && l.buscasFeitas === 0)).toBe(true);
    expect(r.dado.cabecalhoDeCobertura.agrupadorTrt).toMatch(/2 páginas novas.*3.*pausa/s);
    expect(r.dado.avisos.join(" ")).toMatch(/limite diário do próprio Garimpo/);
    expect(r.dado.cabecalhoDeCobertura.agrupadorTrt).toMatch(/teto diário.*50/);
    const repetida = await chamar(mcp, "busca_ampla", ARGS);
    expect(falcao.pedidos).toHaveLength(50);
    expect(repetida.dado.cabecalhoDeCobertura.agrupadorTrt).toMatch(/0 páginas novas.*pausa/);
  });

  it("sem o agrupador, o cabeçalho não ganha agrupadorTrt", async () => {
    const falcao = falcaoFalso(porPedido);
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", { formulacoes: ["horas extras"], tribunais: ["trt2"] });
    expect(r.dado.cabecalhoDeCobertura).not.toHaveProperty("agrupadorTrt");
  });

  it("cobre os 24 TRTs em cinco chamadas da ferramenta e depois só lê memória", async () => {
    const falcao = falcaoFalso(porPedido);
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    for (let lote = 0; lote < 5; lote++) {
      const r = await chamar(mcp, "busca_ampla", ARGS);
      expect(r.isError).toBe(false);
      expect(falcao.pedidos).toHaveLength(Math.min((lote + 1) * 5, 24));
      expect(r.dado.completa).toBe(lote === 4);
    }
    expect(new Set(pedidos(falcao)).size).toBe(24);
    const guardada = await chamar(mcp, "busca_ampla", ARGS);
    expect(falcao.pedidos).toHaveLength(24);
    expect(guardada.dado.cabecalhoDeCobertura.agrupadorTrt).toMatch(/0 páginas novas/);
    expect(linhas(guardada).every((l: any) => l.guardadas === 1)).toBe(true);
  });

  it("uma nova tentativa custa chamada adicional, sem aumentar as cinco páginas", async () => {
    let primeira = true;
    const falcao = falcaoFalso((url) => {
      if (primeira) {
        primeira = false;
        return new Response("", { status: 503 });
      }
      return porPedido(url);
    });
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", ARGS);
    expect(r.isError).toBe(false);
    expect(falcao.pedidos).toHaveLength(6);
    expect(linhas(r).reduce((s, l) => s + l.buscasFeitas, 0)).toBe(5);
    expect(r.dado.cabecalhoDeCobertura.agrupadorTrt).toMatch(/5 páginas novas.*novas tentativas também contam/s);
  });

  it("filtros, seleção, corte e série preservam o resultado dos mesmos TRTs nomeados", async () => {
    const falcao = falcaoFalso((url) => {
      const tribunal = url.searchParams.get("tribunais")!;
      return pagina(Array.from({ length: 4 }, (_, i) => documento({
        tribunal,
        idDocumentoAcordao: String(6_000_000 + i),
        numeroProcesso: `000000${i + 1}-00.2024.5.01.0001`,
        ementa: i === 3 ? "<p>Outro assunto ficticio.</p>" : "<p>HORAS EXTRAS. Ementa ficticia generica.</p>",
      })));
    });
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const args = { ...ARGS, maximo: 8, deveConter: "horas" };
    const agrupada = await chamar(mcp, "busca_ampla", args);
    const nomeada = await chamar(mcp, "busca_ampla", { ...args, tribunais: ["trt1", "trt2", "trt3", "trt4", "trt5"] });
    const individual = await chamar(mcp, "busca_ampla", { ...args, tribunais: ["trt1", "trt2", "trt3", "trt4", "trt5"], agrupar: false });
    expect(agrupada.isError).toBe(false);
    expect(agrupada.dado.totalAcordaos).toBe(20);
    expect(agrupada.dado.mostrados).toBe(8);
    expect(agrupada.dado.acordaos.some((a: any) => a.mesmaEmenta)).toBe(true);
    expect(agrupada.dado.acordaos).toEqual(nomeada.dado.acordaos);
    const ids = (r: any) => r.dado.acordaos.flatMap((a: any) => [a.id, ...(a.mesmaEmenta?.ids ?? [])]).sort();
    expect(ids(agrupada)).toEqual(ids(individual));
    expect(agrupada.dado.cabecalhoDeCobertura.listaCortada).toMatch(/8 de 15/);
    expect(linhas(agrupada).slice(0, 5).every((l: any) => l.excluidos === 1)).toBe(true);
  });
});
