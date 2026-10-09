import { describe, expect, it } from "vitest";
import { chamar, conectar, documento, falcaoFalso, pagina, PESQUISA, siteFalso } from "./apoioFalcao.js";

const ROTULO = "Falcão — repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024)";

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

const linha = (r: { dado: any }, tribunal: string) =>
  r.dado.cabecalhoDeCobertura.porTribunal.find((l: { tribunal: string }) => l.tribunal === tribunal);

describe("TRTs na busca ampla", () => {
  it("TRT e outro tribunal juntos: cada acórdão com a fonte, os rótulos em fontes e o aviso das duas fontes", async () => {
    const falcao = falcaoFalso(() => pagina(PESQUISA.documentos));
    const site = siteFalso([
      { id: "s1", texto_ementa: "INTERVALO INTRAJORNADA. Ementa ficticia do site.", numero_processo: "1.000.001/UF", data_julgamento: "2024-01-02" },
    ]);
    const { mcp } = await conectar(site.cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", {
      formulacoes: ["intervalo intrajornada", "supressão do intervalo"],
      tribunais: ["tst", "trt3"],
    });
    expect(r.isError).toBe(false);
    expect(site.chamadas).toHaveLength(2);
    expect(falcao.pedidos).toHaveLength(2);
    expect(falcao.pedidos.every((u) => u.searchParams.get("size") === "10" && u.searchParams.get("page") === "0")).toBe(true);
    const trt = r.dado.acordaos.filter((a: { tribunal: string }) => a.tribunal === "trt3");
    const tst = r.dado.acordaos.filter((a: { tribunal: string }) => a.tribunal === "tst");
    expect(trt.length).toBeGreaterThan(0);
    expect(tst.length).toBeGreaterThan(0);
    for (const a of trt) expect(a.fonte).toBe("Falcão (CSJT)");
    for (const a of tst) expect(a.fonte).toBe("JurisprudênciaIA");
    expect(r.dado.fontes["Falcão (CSJT)"]).toBe(ROTULO);
    expect(r.dado.fontes.JurisprudênciaIA).toMatch(/não oficial/);
    expect(trt.find((a: { id: string }) => a.id === "trt3:10000002").trecho).toBe("sem ementa no Falcão");
    // O aviso cita as duas fontes sem estender a oficialidade do Falcão ao JurisprudênciaIA.
    expect(r.dado.avisoNaturezaJuridica).toMatch(/^Acórdãos do JurisprudênciaIA: Resultado de busca em base não oficial\./);
    expect(r.dado.avisoNaturezaJuridica).toMatch(/Acórdãos dos TRTs: Resultado obtido do repositório oficial/);
    expect(r.dado.completa).toBe(true);
  });

  it("teto de 5 páginas do Falcão por chamada: primeiro a 1ª formulação de cada TRT, na ordem; o resto fica foraDoTeto, nunca vazio", async () => {
    const falcao = falcaoFalso(porPedido);
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const args = { formulacoes: ["horas extras", "jornada excessiva", "banco de horas"], tribunais: ["trt2", "trt15"] };
    const r = await chamar(mcp, "busca_ampla", args);
    expect(r.isError).toBe(false);
    const feitas = falcao.pedidos.map((u) => `${u.searchParams.get("tribunais")}/${u.searchParams.get("texto")}`).sort();
    expect(feitas).toEqual(
      ["TRT2/horas extras", "TRT15/horas extras", "TRT2/jornada excessiva", "TRT15/jornada excessiva", "TRT2/banco de horas"].sort(),
    );
    expect(linha(r, "trt2")).toMatchObject({ buscasFeitas: 3 });
    expect(linha(r, "trt2").foraDoTeto).toBeUndefined();
    expect(linha(r, "trt15")).toMatchObject({ buscasFeitas: 2, foraDoTeto: 1, vazias: 0 });
    expect(linha(r, "trt15").naoFeitas).toBeUndefined();
    expect(r.dado.cabecalhoDeCobertura.tetoDoFalcao).toMatch(/1 de 6 buscas .* não executadas pelo teto de 5 páginas/);
    expect(r.dado.cabecalhoDeCobertura.formulacoesSemAcordao).toEqual([]);
    expect(r.dado.completa).toBe(false);

    // Repetir a mesma chamada executa só a que faltou: as outras voltam da memória.
    const de_novo = await chamar(mcp, "busca_ampla", args);
    expect(falcao.pedidos).toHaveLength(6);
    expect(falcao.pedidos[5].searchParams.get("tribunais")).toBe("TRT15");
    expect(falcao.pedidos[5].searchParams.get("texto")).toBe("banco de horas");
    expect(de_novo.dado.cabecalhoDeCobertura.tetoDoFalcao).toBeUndefined();
  });

  it("pausa preventiva no meio: as buscas no Falcão que faltam ficam como pausaPreventiva; o outro tribunal segue", async () => {
    let n = 0;
    const falcao = falcaoFalso((url) => {
      n++;
      const r = porPedido(url);
      r.headers.set("x-rate-limit-remaining", "10");
      return r;
    });
    const site = siteFalso([{ id: "s1", texto_ementa: "HORAS EXTRAS. Ementa ficticia.", numero_processo: "1.000.001/UF" }]);
    const { mcp } = await conectar(site.cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", { formulacoes: ["horas extras"], tribunais: ["trt1", "trt2", "trt3", "tst"] });
    expect(r.isError).toBe(false);
    expect(site.chamadas).toHaveLength(1);
    const trts = ["trt1", "trt2", "trt3"].map((t) => linha(r, t));
    const pausadas = trts.reduce((s, l) => s + (l.pausaPreventiva ?? 0), 0);
    const feitas = trts.reduce((s, l) => s + l.buscasFeitas, 0);
    expect(pausadas).toBeGreaterThan(0);
    expect(feitas + pausadas).toBe(3);
    expect(feitas).toBe(n);
    expect(r.dado.avisos[0]).toMatch(/^BUSCA INCOMPLETA NOS TRTs: .*pausa preventiva/);
    expect(r.dado.completa).toBe(false);
  });

  it("ordem final do Garimpo (aderência), não o score do Falcão; filtro local vale para os TRTs", async () => {
    const falcao = falcaoFalso(() =>
      pagina([
        documento({ idDocumentoAcordao: "50000001", numeroProcesso: "0000051-00.2024.5.03.0001", ementa: "<p>Outro assunto ficticio qualquer.</p>", score: 99 }),
        documento({ idDocumentoAcordao: "50000002", numeroProcesso: "0000052-00.2024.5.03.0001", ementa: "<p>ADICIONAL NOTURNO. Ementa ficticia.</p>", score: 1 }),
      ]),
    );
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", { formulacoes: ["adicional noturno"], tribunais: ["trt3"] });
    expect(r.dado.acordaos.map((a: { id: string }) => a.id)).toEqual(["trt3:50000002", "trt3:50000001"]);
    // Só TRT: só a fonte usada aparece, e o aviso é só o do Falcão.
    expect(Object.keys(r.dado.fontes)).toEqual(["Falcão (CSJT)"]);
    expect(r.dado.avisoNaturezaJuridica).toMatch(/^Resultado obtido do repositório oficial/);
    const filtrada = await chamar(mcp, "busca_ampla", { formulacoes: ["adicional noturno"], tribunais: ["trt3"], deveConter: "noturno" });
    expect(filtrada.dado.acordaos.map((a: { id: string }) => a.id)).toEqual(["trt3:50000002"]);
    expect(linha(filtrada, "trt3")).toMatchObject({ excluidos: 1 });
    expect(falcao.pedidos).toHaveLength(1);
  });

  it("filtros de, ate, relator, orgao e classe com TRT na busca ampla: erro que ensina, nenhuma chamada", async () => {
    const falcao = falcaoFalso();
    const site = siteFalso();
    const { mcp } = await conectar(site.cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_ampla", { formulacoes: ["horas extras"], tribunais: ["tst", "trt2"], de: "2024-01-01" });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/ainda não disponível no TRT2/);
    expect(falcao.pedidos).toHaveLength(0);
    expect(site.chamadas).toHaveLength(0);
  });

  it("sem TRT, a resposta não muda: sem fonte por acórdão nem fontes", async () => {
    const site = siteFalso([{ id: "s1", texto_ementa: "HORAS EXTRAS. Ementa ficticia.", numero_processo: "1.000.001/UF" }]);
    const { mcp } = await conectar(site.cliente, falcaoFalso().cliente);
    const r = await chamar(mcp, "busca_ampla", { formulacoes: ["horas extras"], tribunais: ["tst"] });
    expect(r.dado.fontes).toBeUndefined();
    expect(r.dado.acordaos[0].fonte).toBeUndefined();
  });
});
