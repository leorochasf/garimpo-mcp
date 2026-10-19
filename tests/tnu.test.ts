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
import { lerResultadosDaTnu } from "../src/tnu.js";
import { clienteFalso } from "./apoio.js";

const FORMULARIO = "https://eproctnu-jur.cjf.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar";
const LISTAR = "https://eproctnu-jur.cjf.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/listar_resultados";
const LINK_1 =
  "https://eproctnu-jur.cjf.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/download_inteiro_teor&id_jurisprudencia=10000000000000000000000000001&termosPesquisados=YXV4aWxpb3xkb2VuY2F8Y2FyZW5jaWE=";
const CNJ_1 = "0000001-11.2025.4.04.9999";
const ID = "tnu:10000000000000000000000000001";

const RESULTADOS = readFileSync(new URL("./fixtures/tnu-resultados.html", import.meta.url), "latin1")
  .replace('name="hdnTotalResultado" type="hidden" value="30196"', 'name="hdnTotalResultado" type="hidden" value="2"');
const INTEIRO_TEOR = readFileSync(new URL("./fixtures/tnu-inteiro-teor.html", import.meta.url), "utf8");
/** O e-Proc responde em ISO-8859-1: os bytes da fixture saem em latin1, como no portal. */
const html = (texto: string, tipo = "text/html; charset=iso-8859-1") =>
  new Response(Buffer.from(texto, "latin1"), { headers: { "content-type": tipo } });
const formulario = () =>
  new Response("<html><form>pesquisa</form></html>", {
    headers: { "content-type": "text/html; charset=iso-8859-1", "set-cookie": "PHPSESSID=abc123; path=/; HttpOnly" },
  });

describe("TNU — busca oficial do e-Proc do CJF: o que o usuário vê na lista", () => {
  it("a TNU está na tabela de tribunais, fonte própria, inteiro teor como texto do portal", () => {
    const info = infoTribunal("tnu");
    expect(info?.fonte).toBe("e-Proc da TNU");
    expect(info?.inteiroTeor).toBe("portal");
    expect(info?.tetoResultados).toBe(10);
    expect(SIGLAS).toContain("tnu");
  });

  it("tools/list informa a fonte e as limitações da TNU nas duas buscas", async () => {
    const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
    const servidor = criarServidor(clienteFalso([]).cliente);
    const mcp = new Client({ name: "teste-tnu", version: "0" });
    await servidor.connect(ladoServidor);
    await mcp.connect(ladoCliente);
    try {
      const { tools } = await mcp.listTools();
      for (const nome of ["busca_direta", "busca_ampla"]) {
        const t = tools.find((t) => t.name === nome)!;
        expect(t.description).toMatch(/TNU.*e-Proc/);
        expect(t.description).toMatch(/precedentes qualificados da TNU não são pesquisados/);
      }
    } finally {
      await mcp.close();
      await servidor.close();
    }
  });

  it("2 chamadas (formulário e busca), UA honesto, cookie da sessão; devolve ementa e link do inteiro teor", async () => {
    const { cliente, chamadas } = clienteFalso([formulario(), () => html(RESULTADOS)]);
    const r = await buscaDireta(cliente, { tribunal: "tnu", texto: "aposentadoria especial" }, undefined, { eproc: cliente });

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
      hdnInfraPrefixoCookie: "TRF4_Eproc_",
    });

    expect(r.tribunal).toBe("tnu");
    expect(r.fonte).toMatch(/e-Proc da TNU/);
    expect(r.acordaos).toHaveLength(2);
    expect(r.acordaos[0]).toMatchObject({
      id: ID,
      tribunal: "tnu",
      numero: `PUIL ${CNJ_1}`,
      numeroCnj: CNJ_1,
      semNumero: false,
      classe: "Pedido de Uniformização de Interpretação de Lei (Turma)",
      dataJulgamento: "2026-09-30",
      dataPublicacao: "2026-09-30",
      link: LINK_1,
    });
    // A TNU não traz órgão julgador nem link de acompanhamento processual: nada é inventado.
    expect(r.acordaos[0].orgao).toBeUndefined();
    expect(r.acordaos[0].linkConsulta).toBeUndefined();
    expect(r.acordaos[0].relator).toBe("JUIZ FICTÍCIO UM");
    expect(r.acordaos[0].ementa).toMatch(/^DIREITO PREVIDENCIÁRIO\. APELAÇÃO CÍVEL/);
    expect(r.acordaos[0].ementa).not.toMatch(/EMENTA:|DECISÃO|Inteiro teor/);
    expect(r.cabecalhoDeCobertura).toMatch(/e-Proc da TNU informou 2/);
    expect(r.qualificados).toEqual([]);
    expect(r.ressalvaQualificados).toMatch(/Precedentes qualificados da TNU não são pesquisados/);
  });

  it("relator para o acórdão sai junto do relator, sem trocar um pelo outro", () => {
    const { acordaos } = lerResultadosDaTnu(RESULTADOS);
    expect(acordaos[1].relator).toBe("JUÍZA FICTÍCIA DOIS (relator para o acórdão: JUIZ FICTÍCIO TRÊS)");
  });

  it("regressão: cada processo recebe o id e o link do seu próprio card", () => {
    const { acordaos, blocos } = lerResultadosDaTnu(RESULTADOS);
    expect(blocos).toBe(2);
    for (const a of acordaos) expect(new URL(a.link!).searchParams.get("id_jurisprudencia")).toBe(a.id.slice(4));
  });

  it.each([
    ["total ausente com registros", RESULTADOS.replace(/<input[^>]*name="hdnTotalResultado"[^>]*>/, "")],
    ["total contradiz a lista", RESULTADOS.replace('value="2"', 'value="0"')],
    ["host de terceiro", RESULTADOS.replace('data-link="externo_controlador.php', 'data-link="https://exemplo.invalid/externo_controlador.php')],
    ["link a mais onde a TNU não tem", RESULTADOS.replace('class="text-dark gerarPDFDocumento"', 'class="text-dark" data-link="http://www.cjf.jus.br/x"')],
    ["formato de um registro mudou", RESULTADOS.replace('<div class="resLabel">PROCESSO</div>', '<div class="resLabel">AUTOS</div>')],
    ["processo de outra justiça no cabeçalho", RESULTADOS.replaceAll("/TNU", "/TRF4")],
  ])("formato presumido divergente (%s) = erro, sem guardar acórdãos", async (_caso, pagina) => {
    const memoria = new Memoria();
    const { cliente } = clienteFalso([formulario(), () => html(pagina)]);
    await expect(buscaDireta(cliente, { tribunal: "tnu", texto: "x" }, memoria, { eproc: cliente }))
      .rejects.toBeInstanceOf(FormatoInesperadoError);
    expect(await memoria.obter(ID)).toBeUndefined();
  });

  it("filtros e opções que o e-Proc não recebe dão erro que ensina, antes de qualquer chamada", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    await expect(buscaDireta(cliente, { tribunal: "tnu", texto: "x", relator: "Fulano" }, undefined, { eproc: cliente }))
      .rejects.toThrow(/TNU/);
    await expect(buscaDireta(cliente, { tribunal: "tnu", texto: "x", precedentes: true }, undefined, { eproc: cliente }))
      .rejects.toThrow(/TNU/);
    expect(chamadas).toHaveLength(0);
  });

  it("a busca da TNU não é devolvida como busca do TRF4 pela memória", async () => {
    const memoria = new Memoria();
    const a = clienteFalso([formulario(), () => html(RESULTADOS)]);
    await buscaDireta(a.cliente, { tribunal: "tnu", texto: "mesmo texto" }, memoria, { eproc: a.cliente });
    const b = clienteFalso([formulario(), () => html(RESULTADOS)]);
    await buscaDireta(b.cliente, { tribunal: "trf4", texto: "mesmo texto" }, memoria, { eproc: b.cliente }).catch(() => undefined);
    // O TRF4 foi ao e-Proc (a fixture da TNU lhe é inválida): não recebeu da memória a busca da TNU.
    expect(b.chamadas.length).toBeGreaterThan(0);
  });
});

describe("TNU — inteiro teor em HTML: texto do portal do tribunal", () => {
  async function memoriaComBusca() {
    const memoria = new Memoria();
    const a = clienteFalso([formulario(), () => html(RESULTADOS)]);
    await buscaDireta(a.cliente, { tribunal: "tnu", texto: "aposentadoria especial" }, memoria, { eproc: a.cliente });
    return memoria;
  }

  it("2 chamadas (formulário e download); guarda como texto do portal da TNU e ensina a ler pelo id", async () => {
    const memoria = await memoriaComBusca();
    const { cliente, chamadas } = clienteFalso([formulario(), () => html(INTEIRO_TEOR)]);
    const r = await obterInteiroTeor({ id: ID }, () => cliente, memoria);

    expect(chamadas.map((c) => c.url)).toEqual([FORMULARIO, LINK_1]);
    for (const c of chamadas) expect(new Headers(c.init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/texto do portal do tribunal/);
    expect(r.explicacao).toMatch(new RegExp(`ler_inteiro_teor com o id ${ID}`));
    expect((await memoria.obterTexto(ID))?.texto).toMatch(/não há cotejo analítico/);

    const lida = await lerTextoIntegral(ID, 1, memoria);
    expect(lida.cabecalho.fonte).toMatch(/TNU/);
    expect(lida.cabecalho.natureza).toMatch(/texto do portal do tribunal \(TNU\).*não é PDF/);
    expect(lida.cabecalho.natureza).not.toMatch(/inteiro teor oficial/);
  });

  it("página que não é o acórdão (aviso do portal) = «não verificado», nada guardado", async () => {
    const memoria = await memoriaComBusca();
    const { cliente } = clienteFalso([formulario(), () => html("<html><body><p>Sessão expirada. Faça nova pesquisa.</p></body></html>")]);
    const r = await obterInteiroTeor({ id: ID }, () => cliente, memoria);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/TNU/);
    expect(r.explicacao).toMatch(/não verificado/);
    expect(await memoria.obterTexto(ID)).toBeUndefined();
  });

  it("acórdão de outro processo (CNJ ausente do texto) = nada guardado", async () => {
    const memoria = await memoriaComBusca();
    const { cliente } = clienteFalso([formulario(), () => html(INTEIRO_TEOR.replace(CNJ_1, "0000999-99.2020.4.04.1234"))]);
    await obterInteiroTeor({ id: ID }, () => cliente, memoria);
    expect(await memoria.obterTexto(ID)).toBeUndefined();
  });

  it("link de outro acórdão não é associado ao id pedido; link fora do e-Proc nunca é chamado", async () => {
    const memoria = await memoriaComBusca();
    const { cliente, chamadas } = clienteFalso([]);
    const outro = LINK_1.replace("10000000000000000000000000001", "10000000000000000000000000002");
    await expect(obterInteiroTeor({ id: ID, link: outro }, () => cliente, memoria)).rejects.toThrow(/difere do acórdão/);
    await expect(
      obterInteiroTeor({ id: ID, link: "https://jurisprudencia.cjf.jus.br/tnu/index.xhtml" }, () => cliente, memoria),
    ).rejects.toThrow(/fora do formato/);
    expect(chamadas).toHaveLength(0);
  });
});
