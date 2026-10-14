import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analisarListaTcu, lerRegistrosTcu } from "../src/tcu.js";
import { acordaoFicticio, csvDoTcu } from "./apoioTcu.js";

describe("lista de arquivos do TCU", () => {
  it("acha a data da base, o ano, a URL e o tamanho de cada arquivo anual", () => {
    const lista = [
      '"02/10/2026"',
      '"Acórdãos 2026"|"https://sites.tcu.gov.br/dados-abertos/jurisprudencia/arquivos/acordao-completo/acordao-completo-2026.csv"|"308.50 MB"',
      '"Acórdãos 1992"|"https://sites.tcu.gov.br/dados-abertos/jurisprudencia/arquivos/acordao-completo/acordao-completo-1992.csv"|"15.07 MB"',
      '"Súmulas"|"https://sites.tcu.gov.br/dados-abertos/jurisprudencia/arquivos/sumula/sumula.csv"|"804.40 KB"',
    ].join("\n");
    const r = analisarListaTcu(lista);
    expect(r.baseEm).toBe("02/10/2026");
    expect(r.anos.map((a) => a.ano)).toEqual([1992, 2026]);
    expect(r.anos[1]).toMatchObject({
      ano: 2026,
      url: "https://sites.tcu.gov.br/dados-abertos/jurisprudencia/arquivos/acordao-completo/acordao-completo-2026.csv",
      tamanhoMb: 308.5,
    });
  });
});

describe("leitor de CSV do TCU em fluxo", () => {
  async function* pedacos(texto: string, tamanho: number) {
    for (let i = 0; i < texto.length; i += tamanho) yield texto.slice(i, i + tamanho);
  }

  it("lê registros com quebra de linha e aspas dentro do campo, mesmo com cortes de bloco no meio do campo", async () => {
    const csv = csvDoTcu([acordaoFicticio(1), acordaoFicticio(2)]);
    for (const tamanho of [7, 64, 100_000]) {
      const lidos: Record<string, string>[] = [];
      for await (const r of lerRegistrosTcu(pedacos(csv, tamanho))) lidos.push(r);
      expect(lidos.map((r) => r.KEY)).toEqual(["ACORDAO-COMPLETO-100001", "ACORDAO-COMPLETO-100002"]);
      expect(lidos[0].RELATORIO).toBe('<p>Relatório fictício com\nquebra de linha e "aspas" dentro do campo.</p>');
    }
  });

  it("não devolve INTERESSADOS nem ADVOGADO", async () => {
    const lidos: Record<string, string>[] = [];
    for await (const r of lerRegistrosTcu(pedacos(csvDoTcu([acordaoFicticio(1)]), 50))) lidos.push(r);
    expect(Object.keys(lidos[0])).not.toContain("INTERESSADOS");
    expect(Object.keys(lidos[0])).not.toContain("ADVOGADO");
    expect(JSON.stringify(lidos)).not.toContain("SEGREDO-");
  });

  it("para com erro claro se o cabeçalho não for o esperado", async () => {
    await expect(async () => {
      for await (const _ of lerRegistrosTcu(pedacos('"A"|"B"\n"1"|"2"\n', 10))) void _;
    }).rejects.toThrow(/cabeçalho/);
  });
});


import { lerAcordaoTcu, pesquisarTcu } from "../src/tcuLocal.js";
import { gravarAnoTcu } from "./apoioTcu.js";

async function pastaComAnos() {
  const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-"));
  await gravarAnoTcu(dados, 2025, [
    acordaoFicticio(1),
    acordaoFicticio(2, { SUMARIO: "SUMARIO FICTICIO 2. Convênio. Prestação de contas.", VOTO: "<p>Voto sobre convênio.</p>", RELATOR: "MINISTRA OUTRA", COLEGIADO: "Primeira Câmara" }),
    acordaoFicticio(3, { TIPO: "ACÓRDÃO DE RELAÇÃO", SUMARIO: "", RELATORIO: "", VOTO: "", ACORDAO: "<p>Texto da relação sobre sobrepreço em obra.</p>" }),
    acordaoFicticio(4, { SITUACAO: "INVALIDADO", SUMARIO: "sobrepreço invalidado", ACORDAO: "", RELATORIO: "", VOTO: "" }),
  ]);
  return dados;
}

describe("pesquisa local no TCU", () => {
  it("acha por palavras, mostra sumário (não ementa), situação, link e a data da base; nunca INTERESSADOS/ADVOGADO", async () => {
    const dados = await pastaComAnos();
    const r = await pesquisarTcu(dados, { consulta: "sobrepreço" });
    expect(r.resultados.map((x) => x.chave)).toEqual(["ACORDAO-COMPLETO-100003", "ACORDAO-COMPLETO-100001"]);
    const a = r.resultados.find((x) => x.numero === "1")!;
    expect(a).toMatchObject({ numero: "1", ano: "2025", colegiado: "Plenário", tipo: "ACÓRDÃO", situacao: "OFICIALIZADO", relator: "MINISTRO EXEMPLO", dataSessao: "08/12/2025" });
    expect(a.sumario).toContain("Sobrepreço em contratação");
    expect(a.trechos.join(" ")).toMatch(/obrepreço/);
    expect(a.linkOficial).toBe("https://pesquisa.apps.tcu.gov.br/redireciona/acordao-completo/ACORDAO-COMPLETO-100001");
    expect(r.excluidosPorSituacao).toBe(1);
    expect(r.anosUsados).toEqual([expect.objectContaining({ ano: 2025 })]);
    expect(r.atribuicao).toMatch(/dados abertos do TCU/);
    expect(JSON.stringify(r)).not.toContain("SEGREDO-");
    expect(JSON.stringify(r)).not.toMatch(/"ementa"/);
  });

  it("filtra por tipo, colegiado e relator, e exige todas as palavras (frase entre aspas vale inteira)", async () => {
    const dados = await pastaComAnos();
    expect((await pesquisarTcu(dados, { consulta: "sobrepreço", tipo: "ACÓRDÃO DE RELAÇÃO" })).resultados.map((x) => x.numero)).toEqual(["3"]);
    expect((await pesquisarTcu(dados, { consulta: "convenio", colegiado: "primeira camara" })).resultados.map((x) => x.numero)).toEqual(["2"]);
    expect((await pesquisarTcu(dados, { consulta: "convenio", relator: "outra" })).resultados.map((x) => x.numero)).toEqual(["2"]);
    expect((await pesquisarTcu(dados, { consulta: "pregão convênio" })).resultados).toEqual([]);
    expect((await pesquisarTcu(dados, { consulta: '"sobrepreço pregão"' })).resultados).toEqual([]);
    expect((await pesquisarTcu(dados, { consulta: '"pregão eletrônico"' })).resultados.map((x) => x.numero)).toEqual(["1"]);
  });

  it("acha palavra escrita com entidade HTML no arquivo (sobrepre&ccedil;o) e com tag no meio da frase", async () => {
    const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-"));
    await gravarAnoTcu(dados, 2025, [
      acordaoFicticio(7, { SUMARIO: "", ACORDAO: "<p>Houve sobrepre&ccedil;o em obra.</p>", RELATORIO: "", VOTO: "" }),
      acordaoFicticio(8, { SUMARIO: "", ACORDAO: "<p>Pregão</p><p>eletrônico sem disputa.</p>", RELATORIO: "", VOTO: "" }),
    ]);
    expect((await pesquisarTcu(dados, { consulta: "sobrepreco" })).resultados.map((x) => x.numero)).toEqual(["7"]);
    expect((await pesquisarTcu(dados, { consulta: '"pregão eletrônico"' })).resultados.map((x) => x.numero)).toEqual(["8"]);
    expect((await pesquisarTcu(dados, { consulta: "inexistente" })).resultados).toEqual([]);
  });

  it("limita a quantidade, conta o total e avisa dos anos pedidos que não estão baixados", async () => {
    const dados = await pastaComAnos();
    const r = await pesquisarTcu(dados, { consulta: "sobrepreço", limite: 1, anos: [2025, 2024] });
    expect(r.resultados).toHaveLength(1);
    expect(r.total).toBe(2);
    expect(r.anosSemArquivo).toEqual([2024]);
  });

  it("sem nenhum ano baixado, diz como baixar e não pesquisa", async () => {
    const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-"));
    const r = await pesquisarTcu(dados, { consulta: "qualquer" });
    expect(r.resultados).toEqual([]);
    expect(r.anosUsados).toEqual([]);
    expect(r.aviso).toMatch(/baixar_anos_tcu/);
  });
});

describe("leitura de um acórdão do TCU", () => {
  it("lê relatório e voto do acórdão comum, em texto limpo e com a data da base", async () => {
    const dados = await pastaComAnos();
    const v = await lerAcordaoTcu(dados, { ano: 2025, chave: "ACORDAO-COMPLETO-100001", parte: "voto" });
    expect(v).toMatchObject({ situacao: "OFICIALIZADO", parte: "voto", pagina: 1, totalPaginas: 1 });
    expect(v.texto).toBe("Voto fictício 1 sobre sobrepreço.");
    const rel = await lerAcordaoTcu(dados, { ano: 2025, numero: "1", colegiado: "Plenário", parte: "relatorio" });
    expect(rel.texto).toBe('Relatório fictício com quebra de linha e "aspas" dentro do campo.');
    expect(rel.base).toBeDefined();
  });

  it("acórdão de relação não tem relatório nem voto: diz isso em vez de devolver vazio; o texto vem em 'acordao'", async () => {
    const dados = await pastaComAnos();
    const v = await lerAcordaoTcu(dados, { ano: 2025, chave: "ACORDAO-COMPLETO-100003", parte: "voto" });
    expect(v.texto).toBeUndefined();
    expect(v.aviso).toMatch(/relação/);
    const a = await lerAcordaoTcu(dados, { ano: 2025, chave: "ACORDAO-COMPLETO-100003", parte: "acordao" });
    expect(a.texto).toContain("Texto da relação");
  });

  it("acórdão invalidado não entrega texto; chave inexistente diz que não achou no ano baixado", async () => {
    const dados = await pastaComAnos();
    const inv = await lerAcordaoTcu(dados, { ano: 2025, chave: "ACORDAO-COMPLETO-100004", parte: "sumario" });
    expect(inv.texto).toBeUndefined();
    expect(inv.aviso).toMatch(/INVALIDADO/);
    const nada = await lerAcordaoTcu(dados, { ano: 2025, chave: "ACORDAO-COMPLETO-999", parte: "acordao" });
    expect(nada.encontrado).toBe(false);
    const semAno = await lerAcordaoTcu(dados, { ano: 2020, chave: "ACORDAO-COMPLETO-1", parte: "acordao" });
    expect(semAno.aviso).toMatch(/baixar_anos_tcu/);
  });

  it("divide texto longo em partes numeradas", async () => {
    const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-"));
    const paragrafos = Array.from({ length: 40 }, (_, i) => `<p>${`Parágrafo ${i} `.repeat(150)}</p>`).join("");
    await gravarAnoTcu(dados, 2025, [acordaoFicticio(1, { VOTO: paragrafos })]);
    const p1 = await lerAcordaoTcu(dados, { ano: 2025, chave: "ACORDAO-COMPLETO-100001", parte: "voto" });
    expect(p1.totalPaginas).toBeGreaterThan(1);
    const pn = await lerAcordaoTcu(dados, { ano: 2025, chave: "ACORDAO-COMPLETO-100001", parte: "voto", pagina: p1.totalPaginas });
    expect(pn.pagina).toBe(p1.totalPaginas);
    expect(p1.texto!.length).toBeLessThanOrEqual(30_000);
  });
});
