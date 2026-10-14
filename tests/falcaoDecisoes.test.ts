import { describe, expect, it } from "vitest";
import { fixture } from "./apoio.js";
import { chamar, conectar, falcaoFalso, pagina, PESQUISA, siteFalso } from "./apoioFalcao.js";

/**
 * Decisões monocráticas e sentenças do Falcão (I-29 / G-38), opção explícita da busca_direta num TRT. A fixture é
 * sintética, no formato visto em 2 chamadas reais (2026-10-14). Nenhum teste sai da máquina.
 */
const DECISOES = fixture("falcao-decisoes.json") as {
  monocraticas: { documentos: Record<string, unknown>[]; quantidadeTotal: number };
  sentencas: { documentos: Record<string, unknown>[]; quantidadeTotal: number };
};

const TEXTO = "adicional de insalubridade";

/** Falcão falso: cada coleção responde o seu formato. */
function falcaoDasColecoes() {
  return falcaoFalso((url) => {
    const colecao = url.searchParams.get("colecao");
    if (colecao === "decisoesmonocraticas") return pagina(DECISOES.monocraticas.documentos, DECISOES.monocraticas.quantidadeTotal);
    if (colecao === "sentencas") return pagina(DECISOES.sentencas.documentos, DECISOES.sentencas.quantidadeTotal);
    return pagina(PESQUISA.documentos);
  });
}

describe("busca_direta com decisoes: monocráticas e sentenças do Falcão", () => {
  it("monocraticas pede a coleção decisoesmonocraticas, uma só página, e devolve metadados na lista decisoes, sem acórdãos", async () => {
    const falcao = falcaoDasColecoes();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt2", texto: TEXTO, decisoes: "monocraticas" });
    expect(r.isError).toBe(false);
    expect(falcao.pedidos).toHaveLength(1);
    expect(falcao.pedidos[0].searchParams.get("colecao")).toBe("decisoesmonocraticas");
    expect(falcao.pedidos[0].searchParams.get("tribunais")).toBe("TRT2");
    expect(falcao.pedidos[0].searchParams.get("page")).toBe("0");
    expect(r.dado.acordaos).toEqual([]);
    expect(r.dado.qualificados).toEqual([]);
    // O documento de outro tribunal e o sem id são descartados e contados.
    expect(r.dado.decisoes).toHaveLength(2);
    expect(r.dado.decisoes[0]).toMatchObject({
      id: "trt2:decisoesmonocraticas:900000001",
      tipo: "decisão monocrática",
      tribunal: "trt2",
      numero: "ROT 0000001-01.2020.5.02.0001",
      numeroCnj: "0000001-01.2020.5.02.0001",
      classe: "Recurso Ordinário Trabalhista",
      orgao: "Vice-Presidência Judicial",
      redator: "Desembargadora Fictícia Um",
      dataJuntada: "2023-01-11",
      origem: "DECISAO_MONOCRATICA_2GRAU",
    });
    expect(r.dado.decisoes[0].dataJulgamento).toBeUndefined();
    expect(r.dado.avisos.join(" ")).toMatch(/2 registro\(s\) do Falcão descartado\(s\)/);
  });

  it("sentencas pede a coleção sentencas e traz o órgão por extenso, a classe e as duas datas", async () => {
    const falcao = falcaoDasColecoes();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt2", texto: TEXTO, decisoes: "sentencas" });
    expect(r.isError).toBe(false);
    expect(falcao.pedidos[0].searchParams.get("colecao")).toBe("sentencas");
    expect(r.dado.decisoes).toHaveLength(1);
    expect(r.dado.decisoes[0]).toMatchObject({
      id: "trt2:sentencas:800000001",
      tipo: "sentença",
      numero: "ATOrd 0000010-10.2019.5.02.0010",
      classe: "Ação Trabalhista - Rito Ordinário",
      orgao: "99ª Vara do Trabalho Fictícia",
      redator: "Juiz Fictício Três",
      dataJulgamento: "2020-11-30",
      dataJuntada: "2020-12-01",
    });
  });

  it("o texto da decisão e os campos anonimizados nunca saem na lista; a natureza diz que não é acórdão nem precedente do art. 927", async () => {
    const { mcp } = await conectar(siteFalso().cliente, falcaoDasColecoes().cliente);
    for (const decisoes of ["monocraticas", "sentencas"]) {
      const r = await chamar(mcp, "busca_direta", { tribunal: "trt2", texto: TEXTO, decisoes });
      expect(r.texto).not.toMatch(/CORPO-SECRETO|Fulano de Tal|Empresa Fictícia/);
      expect(r.dado.ressalvaDecisoes).toMatch(/não são acórdãos/);
      expect(r.dado.ressalvaDecisoes).toMatch(/art\. 927/);
      expect(r.dado.ressalvaDecisoes).toMatch(/texto.*não é devolvido/);
      expect(r.dado.cabecalhoDeCobertura).toMatch(/Falcão informou 10\.000 ou mais/);
      for (const d of r.dado.decisoes) expect(d.natureza).toMatch(/não é acórdão.*não é precedente do art\. 927/);
    }
  });

  it("sem a opção o comportamento é o de antes: coleção acordaos e nenhuma lista decisoes", async () => {
    const falcao = falcaoDasColecoes();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO });
    expect(falcao.pedidos[0].searchParams.get("colecao")).toBe("acordaos");
    expect(r.dado.decisoes).toBeUndefined();
    expect(r.dado.acordaos.length).toBeGreaterThan(0);
  });

  it("fora dos TRTs, com filtro, com outra opção dos TRTs, com limite acima de 10 ou com valor desconhecido: recusa que ensina, sem chamada", async () => {
    const site = siteFalso();
    const falcao = falcaoDasColecoes();
    const { mcp } = await conectar(site.cliente, falcao.cliente);
    const base = { texto: TEXTO, decisoes: "monocraticas" };
    const casos: [Record<string, unknown>, RegExp][] = [
      [{ tribunal: "stj" }, /só vale nos TRTs/],
      [{ tribunal: "trt2", relator: "Fulano" }, /decisoes.*não aceita.*relator/],
      [{ tribunal: "trt2", de: "2024-01-01" }, /decisoes.*não aceita.*de/],
      [{ tribunal: "trt2", precedentes: true }, /decisoes.*não aceita.*precedentes/],
      [{ tribunal: "trt2", somenteEmentas: true }, /decisoes.*não aceita.*somenteEmentas/],
      [{ tribunal: "trt2", ordenacao: "recentes" }, /decisoes.*não aceita.*ordenacao/],
      [{ tribunal: "trt2", limite: 11 }, /decisoes.*até 10/],
      [{ tribunal: "trt2", decisoes: "acordaos" }, /./],
    ];
    for (const [extra, erro] of casos) {
      const r = await chamar(mcp, "busca_direta", { ...base, ...extra });
      expect(r.isError, JSON.stringify(extra)).toBe(true);
      expect(r.texto).toMatch(erro);
    }
    expect(site.chamadas).toHaveLength(0);
    expect(falcao.pedidos).toHaveLength(0);
  });
});
