import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Cliente, PausaPreventivaError } from "../src/cliente.js";
import { CoordenacaoEmArquivo } from "../src/coordenacao.js";
import { buscaNoFalcao, chaveNoFalcao, type OrdenacaoNoFalcao } from "../src/falcao.js";
import { fixture } from "./apoio.js";
import { chamar, conectar, pagina, siteFalso, falcaoFalso } from "./apoioFalcao.js";

/**
 * Opções da busca nos TRTs: pesquisaSomenteNasEmentas e ordenacao (I-24 / G-36, PV-13). A fixture vem de 3 respostas
 * reais do Falcão (TRT3, 2026-10-13) com identificação trocada; ver o campo _nota dela.
 */
const PV13 = fixture("falcao-pv13.json") as {
  casos: Record<string, { texto: string; quantidadeTotal: number; documentos: Record<string, unknown>[] }>;
};
const ROTULO = "Falcão — repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024)";
const TEXTO = PV13.casos["sem-parametro"].texto;

/** Falcão falso que responde, a cada pedido, com o caso da fixture que combina com os parâmetros recebidos. */
function falcaoPeloParametro() {
  return falcaoFalso((url) => {
    const caso = url.searchParams.has("ordenacao")
      ? "mais-recente"
      : url.searchParams.has("pesquisaSomenteNasEmentas")
        ? "somente-ementas"
        : "sem-parametro";
    const { documentos, quantidadeTotal } = PV13.casos[caso];
    return pagina(documentos, quantidadeTotal);
  });
}

describe("somenteEmentas e ordenacao nos TRTs (Falcão)", () => {
  it("sem as opções, o pedido segue como antes: nenhum dos dois parâmetros vai à fonte", async () => {
    const falcao = falcaoPeloParametro();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO });
    expect(r.isError).toBe(false);
    expect(falcao.pedidos[0].searchParams.has("pesquisaSomenteNasEmentas")).toBe(false);
    expect(falcao.pedidos[0].searchParams.has("ordenacao")).toBe(false);
    expect(r.dado.ordenacao).toBe("relevancia");
    expect(r.dado.somenteEmentas).toBeUndefined();
  });

  it("somenteEmentas vai ao pedido como pesquisaSomenteNasEmentas=true, e o resultado diz que só as ementas foram pesquisadas", async () => {
    const falcao = falcaoPeloParametro();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO, somenteEmentas: true });
    expect(r.isError).toBe(false);
    expect(falcao.pedidos).toHaveLength(1);
    expect(falcao.pedidos[0].searchParams.get("pesquisaSomenteNasEmentas")).toBe("true");
    expect(falcao.pedidos[0].searchParams.has("ordenacao")).toBe(false);
    expect(r.dado.fonte).toBe(ROTULO);
    expect(r.dado.somenteEmentas).toBe(true);
    expect(r.dado.avisos.join(" ")).toMatch(/só nas ementas.*sem ementa.*não são pesquisados/);
    // Medido ao vivo: com o filtro, todas as 10 vieram com ementa.
    expect(r.dado.acordaos).toHaveLength(10);
    expect(r.dado.acordaos.every((a: { ementa: string }) => a.ementa !== "")).toBe(true);
  });

  it("ordenacao 'recentes' vai como mais_recente, a lista sai na ordem da fonte (juntada decrescente) e o resultado devolve a ordenação", async () => {
    const falcao = falcaoPeloParametro();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO, ordenacao: "recentes", limite: 10 });
    expect(r.isError).toBe(false);
    expect(falcao.pedidos[0].searchParams.get("ordenacao")).toBe("mais_recente");
    expect(falcao.pedidos[0].searchParams.has("pesquisaSomenteNasEmentas")).toBe(false);
    expect(r.dado.fonte).toBe(ROTULO);
    expect(r.dado.ordenacao).toBe("recentes");
    expect(r.dado.avisos.join(" ")).toMatch(/mais recentes primeiro.*não por relevância/);
    const datas = r.dado.acordaos.map((a: { dataJuntada: string }) => a.dataJuntada);
    expect([...datas].sort().reverse()).toEqual(datas);
    // A prova trouxe todas as datas iguais: só comparar datas não detecta inversão dos acórdãos.
    expect(r.dado.acordaos.map((a: { id: string }) => a.id)).toEqual(
      PV13.casos["mais-recente"].documentos.map((d) => `trt3:${d.idDocumentoAcordao}`),
    );
  });

  it("ordenacao 'relevancia' é a ordem padrão da fonte: não manda parâmetro nenhum", async () => {
    const falcao = falcaoPeloParametro();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO, ordenacao: "relevancia" });
    expect(falcao.pedidos[0].searchParams.has("ordenacao")).toBe(false);
    expect(r.dado.ordenacao).toBe("relevancia");
  });

  it("valor de ordenacao desconhecido é recusado antes de qualquer chamada", async () => {
    const falcao = falcaoPeloParametro();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO, ordenacao: "antigas" });
    expect(r.isError).toBe(true);
    expect(falcao.pedidos).toHaveLength(0);
  });

  it.each(["antigas", "toString", "constructor", "__proto__"])(
    "a busca interna também recusa ordenacao %s antes de qualquer chamada",
    async (ordenacao) => {
      const falcao = falcaoPeloParametro();
      await expect(buscaNoFalcao(falcao.cliente, {
        tribunal: "trt3", texto: TEXTO, ordenacao: ordenacao as OrdenacaoNoFalcao,
      })).rejects.toThrow(/ordenacao.*aceita relevancia ou recentes/);
      expect(falcao.pedidos).toHaveLength(0);
    },
  );

  it("fora dos TRTs as duas opções são recusadas com erro que ensina, sem chamada ao site", async () => {
    const site = siteFalso();
    const { mcp } = await conectar(site.cliente, falcaoPeloParametro().cliente);
    for (const extra of [{ somenteEmentas: true }, { ordenacao: "recentes" }]) {
      const r = await chamar(mcp, "busca_direta", { tribunal: "stj", texto: TEXTO, ...extra });
      expect(r.isError).toBe(true);
      expect(r.texto).toMatch(/só valem? nos TRTs/);
    }
    expect(site.chamadas).toHaveLength(0);
  });

  it("as opções entram na chave da busca guardada: outra ordem ou outro alcance não devolve a busca de antes", async () => {
    const falcao = falcaoPeloParametro();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO });
    await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO, ordenacao: "recentes" });
    await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO, somenteEmentas: true });
    expect(falcao.pedidos).toHaveLength(3);
    const base = { tribunal: "trt3", texto: TEXTO };
    const chaves = new Set([
      chaveNoFalcao(base),
      chaveNoFalcao({ ...base, ordenacao: "recentes" }),
      chaveNoFalcao({ ...base, somenteEmentas: true }),
    ]);
    expect(chaves.size).toBe(3);
    // 'relevancia' explícita e somenteEmentas falso são o pedido sem a opção: mesma chave de antes.
    expect(chaveNoFalcao({ ...base, ordenacao: "relevancia", somenteEmentas: false })).toBe(chaveNoFalcao(base));
    // Repetir a busca com ordenação devolve a guardada, ainda com a ordenação pedida.
    const repetida = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: TEXTO, ordenacao: "recentes" });
    expect(falcao.pedidos).toHaveLength(3);
    expect(repetida.dado.buscaGuardada).toBeDefined();
    expect(repetida.dado.ordenacao).toBe("recentes");
  });
});

describe("a consulta com as opções gasta o teto diário do Falcão (I-05)", () => {
  let pasta: string;
  beforeEach(async () => {
    pasta = await mkdtemp(join(tmpdir(), "garimpo-falcao-opcoes-"));
  });
  afterEach(() => rm(pasta, { recursive: true, force: true, maxRetries: 10 }));

  it("com teto de 1 chamada por dia, a 2ª consulta pausa sem sair da máquina", async () => {
    const agora = Date.parse("2026-10-13T14:00:00-03:00");
    const pedidos: string[] = [];
    const cliente = new Cliente({
      nome: "O Falcão",
      vagas: new CoordenacaoEmArquivo({ pasta, agora: () => agora }),
      agora: () => agora,
      esperar: async () => {},
      orcamentoPorServico: { jt: { chamadas: 1, largurasMs: [], diario: true } },
      fetch: (async (url: string) => {
        pedidos.push(url);
        return pagina(PV13.casos["mais-recente"].documentos, 10_000, "39");
      }) as typeof fetch,
    });
    const primeira = await buscaNoFalcao(cliente, { tribunal: "trt3", texto: TEXTO, ordenacao: "recentes" });
    expect(primeira.ordenacao).toBe("recentes");
    await expect(buscaNoFalcao(cliente, { tribunal: "trt3", texto: "outra tese", somenteEmentas: true })).rejects.toBeInstanceOf(
      PausaPreventivaError,
    );
    expect(pedidos).toHaveLength(1);
  });
});
