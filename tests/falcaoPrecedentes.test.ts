import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Cliente, PausaPreventivaError } from "../src/cliente.js";
import { CoordenacaoEmArquivo } from "../src/coordenacao.js";
import { buscaNoFalcao, chaveNoFalcao, normalizarPrecedentesDoFalcao } from "../src/falcao.js";
import { fixture, respostaJson } from "./apoio.js";
import { chamar, conectar, falcaoFalso, pagina, PESQUISA, siteFalso } from "./apoioFalcao.js";

/**
 * Precedentes dos TRTs pela coleção `precedentes` do Falcão (I-26 / G-55, PV-13c). A fixture é sintética, no formato
 * visto em 2 chamadas reais (2026-10-14); ver o campo _nota dela. Nenhum teste sai da máquina.
 */
const PRECEDENTES = fixture("falcao-precedentes.json") as { documentos: Record<string, unknown>[]; quantidadeTotal: number };

/** Falcão falso: a coleção `precedentes` responde a fixture de precedentes; `acordaos`, a de acórdãos. */
function falcaoDasDuasColecoes() {
  return falcaoFalso((url) =>
    url.searchParams.get("colecao") === "precedentes"
      ? pagina(PRECEDENTES.documentos, PRECEDENTES.quantidadeTotal)
      : pagina(PESQUISA.documentos),
  );
}

const porNumero = (qs: { numero?: string }[], n: string) => qs.find((q) => q.numero === n) as any;

describe("normalizarPrecedentesDoFalcao: cada tipo como a fonte rotula", () => {
  const { qualificados, descartados } = normalizarPrecedentesDoFalcao("trt3", PRECEDENTES.documentos);

  it("IRDR e IAC saem com o rótulo da categoria da fonte; SUMULA vira \"súmula\"; tipo desconhecido fica como veio", () => {
    expect(qualificados.map((q) => [q.tipo, q.numero])).toEqual([
      ["IRDR", "901"],
      ["IRDR", "902"],
      ["súmula", "77"],
      ["IAC", "903"],
      ["XYZ", "904"],
    ]);
  });

  it("a tese vem sem etiquetas; sem tese, a súmula traz o enunciado e o resto traz só a questão submetida, nunca como tese", () => {
    expect(porNumero(qualificados, "902").texto).toContain("A verba X é devida na hipótese Y.");
    expect(porNumero(qualificados, "902").texto).not.toMatch(/<|&/);
    expect(porNumero(qualificados, "77").texto).toContain("Enunciado fictício da súmula.");
    expect(porNumero(qualificados, "901").texto).toBe("");
    expect(porNumero(qualificados, "901").questao).toMatch(/^Questão fictícia submetida/);
  });

  it("a situação é a da fonte, com a data; sem situação, \"não verificado\"; nunca vigência", () => {
    expect(porNumero(qualificados, "901").situacaoNaFonte).toMatch(/^Suscitado, em 19\/08\/2026 \(segundo o Falcão/);
    expect(porNumero(qualificados, "77").situacaoNaFonte).toMatch(/^Criada \(segundo o Falcão/);
    expect(porNumero(qualificados, "903").situacaoNaFonte).toMatch(/^não verificado/);
    for (const q of qualificados) expect(q.situacaoNaFonte).not.toMatch(/vigente|em vigor/i);
  });

  it("nenhum inciso do art. 927 sai sem prova: todos \"não classificado\", com motivo, sem base legal", () => {
    for (const q of qualificados) {
      expect(q.enquadramento927.inciso).toBe("não classificado");
      expect(q.enquadramento927.motivo).toBeTruthy();
      expect(q.enquadramento927.baseLegal).toBeUndefined();
    }
  });

  it("só o IRDR de TRT ganha o âmbito \"tribunal de origem\", condicional (I-06)", () => {
    expect(porNumero(qualificados, "901").enquadramento927.ambito).toMatch(/^tribunal de origem \(se .*tese\).*TRT3.*art\. 985, I/);
    for (const n of ["77", "903", "904"]) expect(porNumero(qualificados, n).enquadramento927.ambito).toBeUndefined();
  });

  it("item de outro tribunal é descartado e contado, nunca completado", () => {
    expect(descartados).toBe(1);
    expect(qualificados.some((q) => q.numero === "905")).toBe(false);
  });
});

describe("busca_direta nos TRTs com precedentes", () => {
  it("sem a opção, uma chamada só e a lista de qualificados vazia, como antes", async () => {
    const falcao = falcaoDasDuasColecoes();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "verba x" });
    expect(falcao.pedidos).toHaveLength(1);
    expect(falcao.pedidos[0].searchParams.get("colecao")).toBe("acordaos");
    expect(r.dado.qualificados).toEqual([]);
    expect(r.dado.ressalvaQualificados).toMatch(/não são pesquisados/);
  });

  it("com precedentes:true, uma chamada a mais à coleção precedentes do mesmo TRT, e a ressalva diz de onde vêm", async () => {
    const falcao = falcaoDasDuasColecoes();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "verba x", precedentes: true });
    expect(r.isError).toBe(false);
    expect(falcao.pedidos.map((u) => u.searchParams.get("colecao"))).toEqual(["acordaos", "precedentes"]);
    expect(falcao.pedidos[1].searchParams.get("tribunais")).toBe("TRT3");
    expect(falcao.pedidos[1].searchParams.get("texto")).toBe("verba x");
    expect(r.dado.qualificados).toHaveLength(5);
    expect(r.dado.ressalvaQualificados).toMatch(/coleção .precedentes. do Falcão/);
    expect(r.dado.ressalvaQualificados).toMatch(/não prova.*vigência/);
    expect(r.dado.acordaos.length).toBeGreaterThan(0);
  });

  it("repetida, volta da memória com os precedentes e sem chamada nova", async () => {
    const falcao = falcaoDasDuasColecoes();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "verba x", precedentes: true });
    const repetida = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "verba x", precedentes: true });
    expect(falcao.pedidos).toHaveLength(2);
    expect(repetida.dado.buscaGuardada).toBeDefined();
    expect(repetida.dado.qualificados).toHaveLength(5);
  });

  it("a busca com precedentes é outra busca guardada: a chave muda só quando a opção é pedida", () => {
    const p = { tribunal: "trt3", texto: "verba x" };
    expect(chaveNoFalcao({ ...p, precedentes: false })).toBe(chaveNoFalcao(p));
    expect(chaveNoFalcao({ ...p, precedentes: true })).not.toBe(chaveNoFalcao(p));
  });

  it("fora dos TRTs a opção é recusada com frase que ensina", async () => {
    const { mcp } = await conectar(siteFalso().cliente, falcaoDasDuasColecoes().cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "stj", texto: "verba x", precedentes: true });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/precedentes só vale nos TRTs/);
  });

  it("a coleção que falha depois dos acórdãos não derruba a busca: acórdãos ficam, o aviso diz o motivo e nada é guardado", async () => {
    const falcao = falcaoFalso((url) =>
      url.searchParams.get("colecao") === "precedentes" ? respostaJson({}) : pagina(PESQUISA.documentos),
    );
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "verba x", precedentes: true });
    expect(r.isError).toBe(false);
    expect(r.dado.acordaos.length).toBeGreaterThan(0);
    expect(r.dado.qualificados).toEqual([]);
    expect(r.dado.avisos.join(" ")).toMatch(/precedentes do Falcão não vieram/);
    await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "verba x", precedentes: true });
    expect(falcao.pedidos).toHaveLength(4);
  });
});

describe("a coleção precedentes gasta o teto diário do Falcão (I-05)", () => {
  let pasta: string;
  beforeEach(async () => {
    pasta = await mkdtemp(join(tmpdir(), "garimpo-falcao-precedentes-"));
  });
  afterEach(() => rm(pasta, { recursive: true, force: true }));

  function clienteComTeto(chamadas: number, pedidos: string[]) {
    // Relógio próprio que a espera avança: o 1 s entre chamadas ao Falcão não vira espera real nem laço.
    let agora = Date.parse("2026-10-14T14:00:00-03:00");
    return new Cliente({
      nome: "O Falcão",
      vagas: new CoordenacaoEmArquivo({ pasta, agora: () => agora }),
      agora: () => agora,
      esperar: async (ms) => {
        agora += ms;
      },
      orcamentoPorServico: { jt: { chamadas, largurasMs: [], diario: true } },
      fetch: (async (url: string) => {
        pedidos.push(url);
        return new URL(url).searchParams.get("colecao") === "precedentes"
          ? pagina(PRECEDENTES.documentos, PRECEDENTES.quantidadeTotal)
          : pagina(PESQUISA.documentos);
      }) as typeof fetch,
    });
  }

  it("com teto de 2 chamadas por dia, a busca com precedentes usa as 2 e a próxima pausa sem sair da máquina", async () => {
    const pedidos: string[] = [];
    const cliente = clienteComTeto(2, pedidos);
    const r = await buscaNoFalcao(cliente, { tribunal: "trt3", texto: "verba x", precedentes: true });
    expect(r.qualificados).toHaveLength(5);
    expect(pedidos).toHaveLength(2);
    await expect(buscaNoFalcao(cliente, { tribunal: "trt3", texto: "outra tese" })).rejects.toBeInstanceOf(PausaPreventivaError);
    expect(pedidos).toHaveLength(2);
  });

  it("com teto de 1, os acórdãos ficam e a pausa dos precedentes vira aviso", async () => {
    const pedidos: string[] = [];
    const r = await buscaNoFalcao(clienteComTeto(1, pedidos), { tribunal: "trt3", texto: "verba x", precedentes: true });
    expect(pedidos).toHaveLength(1);
    expect(r.acordaos.length).toBeGreaterThan(0);
    expect(r.qualificados).toEqual([]);
    expect(r.avisos.join(" ")).toMatch(/precedentes do Falcão não vieram/);
  });
});
