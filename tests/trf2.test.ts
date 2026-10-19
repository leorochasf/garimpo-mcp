import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buscaDireta } from "../src/busca.js";
import { FormatoInesperadoError, USER_AGENT } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { lerTextoIntegral } from "../src/leitura.js";
import { Memoria } from "../src/memoria.js";
import { criarServidor } from "../src/servidor.js";
import { infoTribunal, SIGLAS } from "../src/tribunais.js";
import { lerResultadosDoTrf2 } from "../src/trf2.js";
import { clienteFalso } from "./apoio.js";

const FORMULARIO = "https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar";
const LISTAR = "https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/listar_resultados";
const LINK_1 =
  "https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/download_inteiro_teor&id_jurisprudencia=20000000000000000000000000001&termosPesquisados=YXBvc2VudGFkb3JpYXxlc3BlY2lhbA==";
const CONSULTA_1 =
  "https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=processo_seleciona_publica&acao_origem=processo_consulta_publica&acao_retorno=processo_consulta_publica&num_processo=00000011120254025101";
const CNJ_1 = "0000001-11.2025.4.02.5101";
const ID = "trf2:20000000000000000000000000001";

const RESULTADOS = readFileSync(new URL("./fixtures/trf2-resultados.html", import.meta.url), "latin1")
  .replace('name="hdnTotalResultado" type="hidden" value="21122"', 'name="hdnTotalResultado" type="hidden" value="2"');
const INTEIRO_TEOR = readFileSync(new URL("./fixtures/trf2-inteiro-teor.html", import.meta.url), "utf8");
/** O e-Proc responde em ISO-8859-1: os bytes da fixture saem em latin1, como no portal. */
const html = (texto: string, tipo = "text/html; charset=iso-8859-1") =>
  new Response(Buffer.from(texto, "latin1"), { headers: { "content-type": tipo } });
const formulario = () =>
  new Response("<html><form>pesquisa</form></html>", {
    headers: { "content-type": "text/html; charset=iso-8859-1", "set-cookie": "PHPSESSID=abc123; path=/; HttpOnly" },
  });

describe("TRF2 — busca oficial do e-Proc do tribunal: o que o usuário vê na lista", () => {
  it("o TRF2 está na tabela de tribunais, fonte própria, inteiro teor como texto do portal", () => {
    const info = infoTribunal("trf2");
    expect(info?.fonte).toBe("e-Proc do TRF2");
    expect(info?.inteiroTeor).toBe("portal");
    expect(info?.tetoResultados).toBe(10);
    expect(SIGLAS).toContain("trf2");
  });

  it("tools/list informa a fonte e as limitações do TRF2 nas duas buscas", async () => {
    const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
    const servidor = criarServidor(clienteFalso([]).cliente);
    const mcp = new Client({ name: "teste-trf2", version: "0" });
    await servidor.connect(ladoServidor);
    await mcp.connect(ladoCliente);
    try {
      const { tools } = await mcp.listTools();
      for (const nome of ["busca_direta", "busca_ampla"]) {
        const t = tools.find((t) => t.name === nome)!;
        expect(t.description).toMatch(/TRF2 vem do e-Proc/);
        expect(t.description).toMatch(/precedentes qualificados do TRF2 não são pesquisados/);
      }
    } finally {
      await mcp.close();
      await servidor.close();
    }
  });

  it("2 chamadas (formulário e busca), UA honesto, cookie da sessão; devolve ementa, órgão e link do inteiro teor", async () => {
    const { cliente, chamadas } = clienteFalso([formulario(), () => html(RESULTADOS)]);
    const r = await buscaDireta(cliente, { tribunal: "trf2", texto: "aposentadoria especial" }, undefined, { eproc: cliente });

    expect(chamadas.map((c) => c.url)).toEqual([FORMULARIO, LISTAR]);
    expect(chamadas[1].init.method).toBe("POST");
    for (const c of chamadas) expect(new Headers(c.init.headers).get("user-agent")).toBe(USER_AGENT);
    const cab = new Headers(chamadas[1].init.headers);
    expect(cab.get("cookie")).toBe("PHPSESSID=abc123");
    expect(cab.get("referer")).toBe(FORMULARIO);
    expect(Object.fromEntries(new URLSearchParams(String(chamadas[1].init.body)))).toEqual({
      txtPesquisa: "aposentadoria especial",
      rdoCampo: "E",
      "selOrigem[]": "1",
      "selTipoDocumento[]": "1",
      chkAgruparResultados: "on",
      hdnInfraPrefixoCookie: "TRF2_Eproc_",
    });

    expect(r.tribunal).toBe("trf2");
    expect(r.fonte).toMatch(/e-Proc do TRF2/);
    expect(r.acordaos).toHaveLength(2);
    expect(r.acordaos[0]).toMatchObject({
      id: ID,
      tribunal: "trf2",
      numero: `RemNec ${CNJ_1}`,
      numeroCnj: CNJ_1,
      semNumero: false,
      classe: "Remessa Necessária Cível",
      orgao: "6ª TURMA ESPECIALIZADA",
      relator: "DESEMBARGADOR FICTÍCIO UM",
      dataJulgamento: "2026-08-27",
      dataPublicacao: "2026-08-28",
      link: LINK_1,
      linkConsulta: CONSULTA_1,
    });
    expect(r.acordaos[0].ementa).toMatch(/^DIREITO PREVIDENCIÁRIO\. REMESSA NECESSÁRIA/);
    expect(r.acordaos[0].ementa).not.toMatch(/EMENTA:|DECISÃO|Decisão fictícia/);
    expect(r.cabecalhoDeCobertura).toMatch(/e-Proc do TRF2 informou 2/);
    expect(r.qualificados).toEqual([]);
    expect(r.ressalvaQualificados).toMatch(/Precedentes qualificados do TRF2 não são pesquisados/);
  });

  it("regressão: cada processo recebe o id e o link do seu próprio card", () => {
    const { acordaos, blocos } = lerResultadosDoTrf2(RESULTADOS);
    expect(blocos).toBe(2);
    for (const a of acordaos) expect(new URL(a.link!).searchParams.get("id_jurisprudencia")).toBe(a.id.slice(5));
    expect(acordaos[1].numeroCnj).toBe("0000002-22.2024.4.02.5001");
  });

  it.each([
    ["total ausente com registros", RESULTADOS.replace(/<input[^>]*name="hdnTotalResultado"[^>]*>/, "")],
    ["total contradiz a lista", RESULTADOS.replace('value="2"', 'value="0"')],
    ["host de terceiro", RESULTADOS.replace('data-link="externo_controlador.php', 'data-link="https://exemplo.invalid/externo_controlador.php')],
    ["consulta processual fora do e-Proc", RESULTADOS.replace('data-link="https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=processo_seleciona_publica', 'data-link="https://exemplo.invalid/?acao=processo_seleciona_publica')],
    ["formato de um registro mudou", RESULTADOS.replace('<div class="resLabel">PROCESSO</div>', '<div class="resLabel">AUTOS</div>')],
    ["processo de outro tribunal no cabeçalho", RESULTADOS.replaceAll("/TRF2", "/TRF4")],
  ])("formato presumido divergente (%s) = erro, sem guardar acórdãos", async (_caso, pagina) => {
    const memoria = new Memoria();
    const { cliente } = clienteFalso([formulario(), () => html(pagina)]);
    await expect(buscaDireta(cliente, { tribunal: "trf2", texto: "x" }, memoria, { eproc: cliente }))
      .rejects.toBeInstanceOf(FormatoInesperadoError);
    expect(await memoria.obter(ID)).toBeUndefined();
  });

  it("filtros e opções que o e-Proc não recebe dão erro que ensina, antes de qualquer chamada", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    await expect(buscaDireta(cliente, { tribunal: "trf2", texto: "x", relator: "Fulano" }, undefined, { eproc: cliente }))
      .rejects.toThrow(/TRF2/);
    await expect(buscaDireta(cliente, { tribunal: "trf2", texto: "x", precedentes: true }, undefined, { eproc: cliente }))
      .rejects.toThrow(/TRF2/);
    expect(chamadas).toHaveLength(0);
  });

  it("a busca do TRF2 não é devolvida como busca do TRF4 pela memória", async () => {
    const memoria = new Memoria();
    const a = clienteFalso([formulario(), () => html(RESULTADOS)]);
    await buscaDireta(a.cliente, { tribunal: "trf2", texto: "mesmo texto" }, memoria, { eproc: a.cliente });
    const b = clienteFalso([formulario(), () => html(RESULTADOS)]);
    await buscaDireta(b.cliente, { tribunal: "trf4", texto: "mesmo texto" }, memoria, { eproc: b.cliente }).catch(() => undefined);
    // O TRF4 foi ao e-Proc (a fixture do TRF2 lhe é inválida): não recebeu da memória a busca do TRF2.
    expect(b.chamadas.length).toBeGreaterThan(0);
  });
});

describe("TRF2 — inteiro teor em HTML: texto do portal do tribunal", () => {
  async function memoriaComBusca() {
    const memoria = new Memoria();
    const a = clienteFalso([formulario(), () => html(RESULTADOS)]);
    await buscaDireta(a.cliente, { tribunal: "trf2", texto: "aposentadoria especial" }, memoria, { eproc: a.cliente });
    return memoria;
  }

  it("2 chamadas (formulário e download); guarda como texto do portal do TRF2 e ensina a ler pelo id", async () => {
    const memoria = await memoriaComBusca();
    const { cliente, chamadas } = clienteFalso([formulario(), () => html(INTEIRO_TEOR)]);
    const r = await obterInteiroTeor({ id: ID }, () => cliente, memoria);

    expect(chamadas.map((c) => c.url)).toEqual([FORMULARIO, LINK_1]);
    for (const c of chamadas) expect(new Headers(c.init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/texto do portal do tribunal/);
    expect(r.explicacao).toMatch(new RegExp(`ler_inteiro_teor com o id ${ID}`));
    expect((await memoria.obterTexto(ID))?.texto).toMatch(/Documento eletrônico assinado por/);

    const lida = await lerTextoIntegral(ID, 1, memoria);
    expect(lida.cabecalho.fonte).toMatch(/TRF2/);
    expect(lida.cabecalho.natureza).toMatch(/texto do portal do tribunal \(TRF2\).*não é PDF/);
    expect(lida.cabecalho.natureza).not.toMatch(/inteiro teor oficial/);
  });

  it("página sem a assinatura eletrônica (aviso do portal) = «não verificado», nada guardado", async () => {
    const memoria = await memoriaComBusca();
    const { cliente } = clienteFalso([formulario(), () => html("<html><body><p>Sessão expirada. Faça nova pesquisa.</p></body></html>")]);
    const r = await obterInteiroTeor({ id: ID }, () => cliente, memoria);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/e-Proc do TRF2/);
    expect(r.explicacao).toMatch(/não verificado/);
    expect(await memoria.obterTexto(ID)).toBeUndefined();
  });

  it("acórdão de outro processo (CNJ ausente do texto) = nada guardado", async () => {
    const memoria = await memoriaComBusca();
    const { cliente } = clienteFalso([formulario(), () => html(INTEIRO_TEOR.replace(CNJ_1, "0000999-99.2020.4.02.5101"))]);
    await obterInteiroTeor({ id: ID }, () => cliente, memoria);
    expect(await memoria.obterTexto(ID)).toBeUndefined();
  });

  it("a consulta processual nunca é chamada; link de outro acórdão não é associado ao id pedido", async () => {
    const memoria = await memoriaComBusca();
    const { cliente, chamadas } = clienteFalso([]);
    const outro = LINK_1.replace("20000000000000000000000000001", "20000000000000000000000000002");
    await expect(obterInteiroTeor({ id: ID, link: outro }, () => cliente, memoria)).rejects.toThrow(/difere do acórdão/);
    await expect(obterInteiroTeor({ id: ID, link: CONSULTA_1 }, () => cliente, memoria)).rejects.toThrow(/fora do formato/);
    expect(chamadas).toHaveLength(0);
  });
});
