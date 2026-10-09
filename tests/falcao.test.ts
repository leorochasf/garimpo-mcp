import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UA_NAVEGADOR } from "../src/cliente.js";
import { chamar, conectar, documento, falcaoFalso, PESQUISA, pagina, siteFalso } from "./apoioFalcao.js";

const ROTULO = "Falcão — repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024)";
const AVISO_FALCAO =
  "Resultado obtido do repositório oficial da Justiça do Trabalho (Falcão) por cliente não oficial (Garimpo); " +
  "confira no portal do tribunal antes de citar.";

/** Os registros (.json), com o conteúdo, de uma pasta (recursivo); o temporário de uma gravação em curso fica de fora. */
async function conteudos(pasta: string): Promise<Map<string, string>> {
  const nomes = (await readdir(pasta, { recursive: true, withFileTypes: true })).filter(
    (d) => d.isFile() && d.name.endsWith(".json"),
  );
  const lidos = await Promise.all(
    nomes.map(async (d) => [join(d.parentPath, d.name), await readFile(join(d.parentPath, d.name), "utf8").catch(() => "")] as const),
  );
  return new Map(lidos);
}

describe("busca direta num TRT pelo Falcão", () => {
  it("pesquisa o TRT no Falcão (acórdãos, 1 página de 10) com o UA de navegador e devolve lista, rótulo, datas e aviso", async () => {
    const falcao = falcaoFalso();
    const site = siteFalso();
    const { mcp } = await conectar(site.cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "intervalo intrajornada" });

    expect(r.isError).toBe(false);
    expect(site.chamadas).toHaveLength(0);
    expect(falcao.pedidos).toHaveLength(1);
    const url = falcao.pedidos[0];
    expect(url.host).toBe("jurisprudencia.jt.jus.br");
    expect(url.pathname).toBe("/jurisprudencia-nacional-backend/api/no-auth/pesquisa");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      texto: "intervalo intrajornada",
      colecao: "acordaos",
      page: "0",
      size: "10",
      tribunais: "TRT3",
    });
    expect(url.searchParams.get("sessionId")).toMatch(/^_[a-z0-9]{7}$/);
    expect(falcao.cabecalhos[0].get("User-Agent")).toBe(UA_NAVEGADOR);

    expect(r.dado.fonte).toBe(ROTULO);
    expect(r.dado.avisoNaturezaJuridica).toBe(AVISO_FALCAO);
    expect(r.dado.cabecalhoDeCobertura).toMatch(/10\.000 ou mais/);
    expect(r.dado.cabecalhoDeCobertura).toMatch(/recebeu 2 e mostra 2/);
    expect(r.dado.qualificados).toEqual([]);
    const [com, sem] = r.dado.acordaos;
    expect(com).toMatchObject({
      id: "trt3:10000001",
      tribunal: "trt3",
      numero: "ROT 0000001-00.2024.5.03.0001",
      numeroCnj: "0000001-00.2024.5.03.0001",
      classe: "RECURSO ORDINÁRIO TRABALHISTA",
      relator: "RELATOR FICTICIO UM",
      orgao: "1a. Turma",
      dataJulgamento: "2024-02-27",
      dataJuntada: "2024-03-05",
      ementa: "INTERVALO INTRAJORNADA. SUPRESSÃO PARCIAL. Texto fictício de ementa.",
      fonte: ROTULO,
    });
    expect(com.dataPublicacao).toBeUndefined();
    expect(com.avisoDeEmenta).toBeUndefined();
    expect(sem).toMatchObject({ id: "trt3:10000002", ementa: "", avisoDeEmenta: "sem ementa no Falcão" });
    expect(r.dado.avisos.join(" ")).toMatch(/juntado em.*não é data de publicação/);
  });

  it("TST continua no JurisprudênciaIA", async () => {
    const falcao = falcaoFalso();
    const site = siteFalso();
    const { mcp } = await conectar(site.cliente, falcao.cliente);
    await chamar(mcp, "busca_direta", { tribunal: "tst", texto: "intervalo intrajornada" });
    expect(site.chamadas).toHaveLength(1);
    expect(falcao.pedidos).toHaveLength(0);
  });

  it("limite: padrão 10 (1 página), até 30 (3 páginas, em série); acima de 30 é erro que ensina, sem chamada", async () => {
    const dez = Array.from({ length: 10 }, (_, i) => documento({ idDocumentoAcordao: String(20000000 + i), tribunal: "TRT2" }));
    let pagina0 = 0;
    const falcao = falcaoFalso((url) => {
      pagina0 = Number(url.searchParams.get("page"));
      return pagina(
        dez.map((d, i) => ({
          ...d,
          idDocumentoAcordao: `${d.idDocumentoAcordao}${pagina0}`,
          numeroProcesso: `00000${pagina0}${i}-00.2024.5.02.0001`,
        })),
      );
    });
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt2", texto: "horas extras", limite: 30 });
    expect(falcao.pedidos.map((u) => u.searchParams.get("page"))).toEqual(["0", "1", "2"]);
    expect(r.dado.acordaos).toHaveLength(30);
    expect(r.dado.cabecalhoDeCobertura).toMatch(/recebeu 30 e mostra 30; pode haver mais: use a busca ampla/);

    const erro = await chamar(mcp, "busca_direta", { tribunal: "trt2", texto: "horas extras", limite: 31 });
    expect(erro.isError).toBe(true);
    expect(erro.texto).toMatch(/até 30/);
    expect(falcao.pedidos).toHaveLength(3);
  });

  it("filtros de, ate, relator, orgao e classe num TRT: erro que ensina, antes de gastar chamada", async () => {
    const falcao = falcaoFalso();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    for (const filtro of [{ de: "2024-01-01" }, { ate: "2024-12-31" }, { relator: "X" }, { orgao: "1a. Turma" }, { classe: "ROT" }]) {
      const r = await chamar(mcp, "busca_direta", { tribunal: "trt1", texto: "horas extras", ...filtro });
      expect(r.isError).toBe(true);
      expect(r.texto).toMatch(/ainda não disponível no TRT1/);
    }
    expect(falcao.pedidos).toHaveLength(0);
  });

  it("id ausente ou tribunal inesperado: registro descartado com aviso, nunca completado; data inválida = não informada", async () => {
    const falcao = falcaoFalso(() =>
      pagina([
        documento({ idDocumentoAcordao: "" }),
        documento({ idDocumentoAcordao: "30000001", tribunal: "TRT15" }),
        documento({ idDocumentoAcordao: "30000002", tribunal: "TJSP" }),
        documento({ idDocumentoAcordao: "30000003", dataJulgamento: "31/02/2024", dataJuntada: "2024-03-05" }),
      ], 4),
    );
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "horas extras" });
    expect(r.dado.acordaos.map((a: { id: string }) => a.id)).toEqual(["trt3:30000003"]);
    expect(r.dado.avisos.join(" ")).toMatch(/3 registro\(s\) do Falcão descartado\(s\)/);
    expect(r.dado.acordaos[0].dataJulgamento).toBeUndefined();
    expect(r.dado.acordaos[0].dataJuntada).toBeUndefined();
    expect(r.dado.cabecalhoDeCobertura).toMatch(/informou 4 acórdãos; o Garimpo recebeu 4 e mostra 1; não há mais/);
  });

  it("ementa vazia com possuiEmenta \"S\" é sem ementa, sinalizada; ementa recebida com \"N\" é mantida, sinalizada", async () => {
    const falcao = falcaoFalso(() =>
      pagina([
        documento({ idDocumentoAcordao: "40000001", ementa: "", possuiEmenta: "S" }),
        documento({ idDocumentoAcordao: "40000002", possuiEmenta: "N" }),
      ]),
    );
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "horas extras" });
    const [vazia, comN] = r.dado.acordaos;
    expect(vazia.ementa).toBe("");
    expect(vazia.avisoDeEmenta).toMatch(/^sem ementa no Falcão \(divergência/);
    expect(comN.ementa).toMatch(/INTERVALO INTRAJORNADA/);
    expect(comN.avisoDeEmenta).toMatch(/Divergência no Falcão: possuiEmenta "N"/);
  });

  it("nomes de partes nunca vão à lista, ao obter_ementa nem à busca guardada; o texto integral fica na memória para leitura", async () => {
    const falcao = falcaoFalso();
    const { mcp, dados } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "intervalo intrajornada" });
    const e = await chamar(mcp, "obter_ementa", { id: "trt3:10000001" });
    expect(e.dado.avisoNaturezaJuridica).toBe(AVISO_FALCAO);
    expect(e.dado.obtidoDoSite).toMatch(/^obtido do Falcão em/);
    for (const resposta of [r.texto, e.texto]) expect(resposta).not.toMatch(/PARTE FICTICIA/);

    // A gravação corre por trás: espera a memória aparecer no disco.
    let arquivos = new Map<string, string>();
    for (let i = 0; i < 100 && ![...arquivos.keys()].some((k) => k.includes("textos-1")); i++) {
      await new Promise((r) => setTimeout(r, 20));
      arquivos = await conteudos(join(dados, "memoria")).catch(() => new Map());
    }
    await new Promise((r) => setTimeout(r, 100));
    arquivos = await conteudos(join(dados, "memoria"));
    for (const [arquivo, conteudo] of arquivos) {
      if (arquivo.includes("textos-1")) continue;
      expect(conteudo, arquivo).not.toMatch(/PARTE FICTICIA/);
    }
    const textos = [...arquivos].filter(([k]) => k.includes("textos-1")).map(([, v]) => v);
    expect(textos).toHaveLength(2);
    expect(textos.join()).toMatch(/RECORRENTE: PARTE FICTICIA A/);
    expect(textos.join()).not.toMatch(/<p>|base64|void 0/);
  });

  it("repetir a busca dentro de 24 h volta da memória, sem chamar o Falcão, com a mesma cobertura", async () => {
    const falcao = falcaoFalso();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const a = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "intervalo intrajornada" });
    const b = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "intervalo intrajornada" });
    expect(falcao.pedidos).toHaveLength(1);
    expect(b.dado.buscaGuardada).toMatch(/fotografia da busca feita no Falcão em/);
    expect(b.dado.cabecalhoDeCobertura).toBe(a.dado.cabecalhoDeCobertura);
    expect(b.dado.acordaos).toEqual(a.dado.acordaos);
  });

  it("resposta fora do formato (sem documentos) é erro que diz isso, nunca lista vazia", async () => {
    const falcao = falcaoFalso(() => pagina(undefined as unknown as unknown[]));
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "busca_direta", { tribunal: "trt3", texto: "horas extras" });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/não trouxe a lista de documentos/);
  });

  it("a fixture é sintética: nenhum número real de processo", () => {
    for (const d of PESQUISA.documentos) expect(String(d.numeroProcesso)).toMatch(/^000000\d-00\./);
  });
});
