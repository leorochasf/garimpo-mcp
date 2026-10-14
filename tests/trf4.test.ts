import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buscaDireta, lerBuscaGuardada } from "../src/busca.js";
import { FormatoInesperadoError, USER_AGENT } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { lerTextoIntegral } from "../src/leitura.js";
import { Memoria } from "../src/memoria.js";
import { infoTribunal, SIGLAS } from "../src/tribunais.js";
import { lerResultadosDoTrf4 } from "../src/trf4.js";
import { clienteFalso } from "./apoio.js";

const FORMULARIO = "https://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar";
const LISTAR = "https://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php?acao=jurisprudencia@jurisprudencia/listar_resultados";
const LINK_1 =
  "https://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php?acao=jurisprudencia@jurisprudencia/download_inteiro_teor&id_jurisprudencia=10000000000000000000000000001&termosPesquisados=YXV4aWxpb3xkb2VuY2F8Y2FyZW5jaWE=";
const ACOMPANHAMENTO_1 =
  "http://www.trf4.jus.br/trf4/processos/acompanhamento/resultado_pesquisa.php?selForma=NU&selOrigem=TRF&txtValor=00000011120254049999";
const CNJ_1 = "0000001-11.2025.4.04.9999";

const lido = (nome: string) => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), "utf8");
// O recorte tem 2 dos 10 cards: só o total é ajustado para testar uma página completa de 2.
const RESULTADOS = readFileSync(new URL("./fixtures/trf4-resultados.html", import.meta.url), "latin1")
  .replace('name="hdnTotalResultado" type="hidden" value="30196"', 'name="hdnTotalResultado" type="hidden" value="2"');
const INTEIRO_TEOR = lido("trf4-inteiro-teor.html");
/** O e-Proc responde em ISO-8859-1: os bytes da fixture saem em latin1, como no portal. */
const html = (texto: string, tipo = "text/html; charset=iso-8859-1") =>
  new Response(Buffer.from(texto, "latin1"), { headers: { "content-type": tipo } });
const formulario = () =>
  new Response("<html><form>pesquisa</form></html>", {
    headers: { "content-type": "text/html; charset=iso-8859-1", "set-cookie": "TRF4_Eproc_sessao=abc123; path=/; HttpOnly" },
  });
const comTotal = (total: string | undefined) =>
  total === undefined
    ? RESULTADOS.replace(/<input[^>]*name="hdnTotalResultado"[^>]*>/, "")
    : RESULTADOS.replace('value="2"', `value="${total}"`);

describe("TRF4 — busca oficial do e-Proc (D-07 / G-31): o que o usuário vê na lista", () => {
  it("regressão: cada processo recebe o id e o link do seu próprio card, nunca do vizinho", () => {
    const { acordaos } = lerResultadosDoTrf4(RESULTADOS);
    expect(acordaos.map((a) => [a.numeroCnj, a.id])).toEqual([
      [CNJ_1, "trf4:10000000000000000000000000001"],
      ["0000002-22.2024.4.04.7200", "trf4:10000000000000000000000000002"],
    ]);
    for (const a of acordaos) expect(new URL(a.link!).searchParams.get("id_jurisprudencia")).toBe(a.id.slice(5));
  });

  it("regressão: ementa é o campo EMENTA após DECISÃO, sem RELATOR/RELATORA nem dispositivo", () => {
    const { acordaos } = lerResultadosDoTrf4(RESULTADOS);
    expect(acordaos[0].ementa).toBe("DIREITO PREVIDENCIÁRIO. APELAÇÃO CÍVEL. AUXÍLIO-DOENÇA. EXEMPLO FICTÍCIO DE EMENTA. 1. Primeiro item fictício da ementa. 2. Segundo item fictício, sobre o período de carência exemplar.");
    expect(acordaos[1].ementa).toBe("PREVIDENCIÁRIO. AUXÍLIO-DOENÇA. SEGUNDO EXEMPLO FICTÍCIO. 1. Item fictício. 2. Recurso desprovido.");
    expect(acordaos.map((a) => a.relator)).toEqual(["JUIZ FICTÍCIO UM", "JUÍZA FICTÍCIA DOIS"]);
  });

  it("regressão: preserva o último card antes do modal de citação", () => {
    const r = lerResultadosDoTrf4(RESULTADOS);
    expect(r.blocos).toBe(2);
    expect(r.acordaos).toHaveLength(2);
    expect(r.acordaos.at(-1)?.id).toBe("trf4:10000000000000000000000000002");
    expect(r.acordaos.at(-1)?.ementa).not.toMatch(/Citação|Copiar|Fechar/);
  });

  it("o TRF4 está na tabela de tribunais, fonte própria, inteiro teor como texto do portal", () => {
    const info = infoTribunal("trf4");
    expect(info?.fonte).toBe("e-Proc do TRF4");
    expect(info?.inteiroTeor).toBe("portal");
    expect(info?.tetoResultados).toBe(10);
    expect(SIGLAS).toContain("trf4");
  });

  it("2 chamadas (formulário e busca), UA honesto, cookie da sessão, corpo da prova; devolve ementa e link do inteiro teor", async () => {
    const { cliente, chamadas } = clienteFalso([formulario(), () => html(RESULTADOS)]);
    const r = await buscaDireta(cliente, { tribunal: "trf4", texto: "aposentadoria especial" }, undefined, { eproc: cliente });

    expect(chamadas.map((c) => c.url)).toEqual([FORMULARIO, LISTAR]);
    expect(chamadas[0].init.method ?? "GET").toBe("GET");
    expect(chamadas[1].init.method).toBe("POST");
    for (const c of chamadas) expect(new Headers(c.init.headers).get("user-agent")).toBe(USER_AGENT);
    const cab = new Headers(chamadas[1].init.headers);
    expect(cab.get("cookie")).toBe("TRF4_Eproc_sessao=abc123");
    expect(cab.get("referer")).toBe(FORMULARIO);
    expect(cab.get("content-type")).toMatch(/application\/x-www-form-urlencoded/);
    const corpo = new URLSearchParams(String(chamadas[1].init.body));
    expect(Object.fromEntries(corpo)).toEqual({
      txtPesquisa: "aposentadoria especial",
      rdoCampo: "E",
      "selOrigem[]": "1",
      "selTipoDocumento[]": "1",
      chkAgruparResultados: "on",
      hdnInfraPrefixoCookie: "TRF4_Eproc_",
    });

    expect(r.tribunal).toBe("trf4");
    expect(r.fonte).toMatch(/e-Proc do TRF4/);
    expect(r.acordaos).toHaveLength(2);
    const a = r.acordaos[0];
    expect(a).toMatchObject({
      id: "trf4:10000000000000000000000000001",
      tribunal: "trf4",
      numero: `AC ${CNJ_1}`,
      numeroCnj: CNJ_1,
      semNumero: false,
      classe: "Apelação Cível",
      orgao: "Turma Exemplar Fictícia",
      dataJulgamento: "2026-10-13",
      dataPublicacao: "2026-10-13",
      link: LINK_1,
      linkConsulta: ACOMPANHAMENTO_1,
    });
    expect(a.ementa).toMatch(/^DIREITO PREVIDENCIÁRIO\. APELAÇÃO CÍVEL/);
    expect(a.ementa).toMatch(/período de carência exemplar\./);
    // O que não é ementa (rótulo, dispositivo, botões) não entra nela.
    expect(a.ementa).not.toMatch(/EMENTA:|DECISÃO|Inteiro teor|Acompanhamento/);
    expect(r.acordaos[1].classe).toBe("Apelação Cível");
    expect(r.acordaos[1].link).toMatch(/id_jurisprudencia=10000000000000000000000000002/);
    expect(r.cabecalhoDeCobertura).toMatch(/informou 2/);
    expect(r.cabecalhoDeCobertura).toMatch(/recebeu 2/);
    expect(r.qualificados).toEqual([]);
  });

  it("o link de acompanhamento processual sai como veio (http), sem https forçado, e NUNCA é chamado", async () => {
    const { cliente, chamadas } = clienteFalso([formulario(), () => html(RESULTADOS)]);
    const r = await buscaDireta(cliente, { tribunal: "trf4", texto: "x" }, undefined, { eproc: cliente });
    expect(r.acordaos[0].linkConsulta).toBe(ACOMPANHAMENTO_1);
    expect(r.acordaos[0].linkConsulta).toMatch(/^http:\/\//);
    expect(chamadas.map((c) => c.url).join(" ")).not.toMatch(/trf4\/processos/);
  });

  it("termo com acento vai ao e-Proc em ISO-8859-1 (percent-encoded), não em UTF-8", async () => {
    const { cliente, chamadas } = clienteFalso([formulario(), () => html(RESULTADOS)]);
    await buscaDireta(cliente, { tribunal: "trf4", texto: "ação previdenciária" }, undefined, { eproc: cliente });
    expect(String(chamadas[1].init.body)).toContain("txtPesquisa=a%E7%E3o+previdenci%E1ria");
  });

  it("texto fora do ISO-8859-1 é erro que ensina, antes de qualquer chamada", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    await expect(buscaDireta(cliente, { tribunal: "trf4", texto: "tese 🙂" }, undefined, { eproc: cliente })).rejects.toThrow(
      /ISO-8859-1/,
    );
    expect(chamadas).toHaveLength(0);
  });

  it("total 0 declarado = busca vazia (não é erro)", async () => {
    const vazio = comTotal("0").replace(/<div class="card mb-3 resultadoItem"[\s\S]*<\/body>/, "</body>");
    const { cliente } = clienteFalso([formulario(), () => html(vazio)]);
    const r = await buscaDireta(cliente, { tribunal: "trf4", texto: "nada" }, undefined, { eproc: cliente });
    expect(r.acordaos).toEqual([]);
    expect(r.cabecalhoDeCobertura).toMatch(/informou 0/);
  });

  it("total ausente = erro de formato (nunca lista vazia); total acima de zero sem resultado legível também", async () => {
    const semTotal = comTotal(undefined).replace(/<div class="card mb-3 resultadoItem"[\s\S]*<\/body>/, "</body>");
    const a = clienteFalso([formulario(), () => html(semTotal)]);
    await expect(buscaDireta(a.cliente, { tribunal: "trf4", texto: "x" }, undefined, { eproc: a.cliente })).rejects.toBeInstanceOf(
      FormatoInesperadoError,
    );
    const semBlocos = comTotal("50").replace(/<div class="card mb-3 resultadoItem"[\s\S]*<\/body>/, "</body>");
    const b = clienteFalso([formulario(), () => html(semBlocos)]);
    await expect(buscaDireta(b.cliente, { tribunal: "trf4", texto: "x" }, undefined, { eproc: b.cliente })).rejects.toThrow(
      /formato/i,
    );
  });

  it.each([
    ["total ausente com registros", comTotal(undefined)],
    ["total truncado", comTotal("0xyz")],
    ["total contradiz a lista", comTotal("0")],
    ["página incompleta", comTotal("50")],
    ["total duplicado", RESULTADOS.replace('<body>', '<body><input name="hdnTotalResultado" value="2">')],
    ["zero com cabeçalhos fora dos blocos", comTotal("0").replaceAll('class="card mb-3 resultadoItem"', 'class="outro"')],
    ["id repetido para acórdãos diferentes", RESULTADOS.replaceAll('10000000000000000000000000002', '10000000000000000000000000001')],
    ["ação ambígua", RESULTADOS.replace('&id_jurisprudencia=', '&acao=outra&id_jurisprudencia=')],
    ["host de terceiro", RESULTADOS.replace('data-link="externo_controlador.php', 'data-link="https://exemplo.invalid/externo_controlador.php')],
    ["campo com nome apenas parecido", RESULTADOS.replaceAll('hdnTotalResultado', 'outrohdnTotalResultado')],
    ["cabeçalho incompleto antes do seguinte", RESULTADOS.replace('<div class="resLabel">DATA DA PUBLICAÇÃO</div>', '')],
    ["formato de um registro mudou", RESULTADOS.replace('<div class="resLabel">PROCESSO</div>', '<div class="resLabel">AUTOS</div>')],
    ["ementa fora do campo previsto", RESULTADOS.replace('class="resLabel">EMENTA', 'class="outro">EMENTA')],
    ["links de registros juntos", RESULTADOS.replace('class="card mb-3 resultadoItem"', 'class="outro"')],
    ["campo de ementa duplicado", RESULTADOS.replace('<div class="resLabel">EMENTA</div>', '<div class="resLabel">EMENTA</div><div class="resValue completo">texto</div><div class="resLabel">EMENTA</div>')],
    ["link com id diferente do card", RESULTADOS.replace('id_jurisprudencia=10000000000000000000000000001', 'id_jurisprudencia=10000000000000000000000000002')],
    ["último card truncado", RESULTADOS.slice(0, RESULTADOS.indexOf('<div class="modal mt-3"') - 15)],
    ["relator ambíguo", RESULTADOS.replace('<div class="resLabel">RELATOR</div>', '<div class="resLabel">RELATORA</div><div class="resValue completo">outra pessoa fictícia</div><div class="resLabel">RELATOR</div>')],
  ])("formato presumido divergente (%s) = erro, sem guardar acórdãos", async (_caso, pagina) => {
    const memoria = new Memoria();
    const { cliente } = clienteFalso([formulario(), () => html(pagina)]);
    await expect(buscaDireta(cliente, { tribunal: "trf4", texto: "x" }, memoria, { eproc: cliente }))
      .rejects.toBeInstanceOf(FormatoInesperadoError);
    expect(await memoria.obter("trf4:10000000000000000000000000001")).toBeUndefined();
  });

  it("filtros e opções que o e-Proc não recebe dão erro que ensina, antes de qualquer chamada (nunca ignorados)", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    for (const filtro of [{ de: "2026-01-01" }, { ate: "2026-02-01" }, { relator: "Fulano" }, { orgao: "Turma" }, { classe: "AC" }]) {
      await expect(
        buscaDireta(cliente, { tribunal: "trf4", texto: "x", ...filtro }, undefined, { eproc: cliente }),
      ).rejects.toThrow(/TRF4.*(filtro|não)/i);
    }
    await expect(
      buscaDireta(cliente, { tribunal: "trf4", texto: "x", ordenacao: "recentes" }, undefined, { eproc: cliente }),
    ).rejects.toThrow(/TRF4/);
    expect(chamadas).toHaveLength(0);
  });

  it("limite acima de 10 vale 10 (uma página), com aviso no cabeçalho de cobertura", async () => {
    const { cliente, chamadas } = clienteFalso([formulario(), () => html(RESULTADOS)]);
    const r = await buscaDireta(cliente, { tribunal: "trf4", texto: "x", limite: 100 }, undefined, { eproc: cliente });
    expect(chamadas).toHaveLength(2);
    expect(r.acordaos).toHaveLength(2);
    expect(r.avisos.join(" ")).toMatch(/10 por busca|uma página/i);
  });

  it("total acima de 10 aceita exatamente a primeira página de 10 e aplica o limite pedido", async () => {
    const inicio = RESULTADOS.indexOf('<div class="card mb-3 resultadoItem"');
    const fim = RESULTADOS.indexOf('<div class="card mb-3 resultadoItem"', inicio + 1);
    const primeiro = RESULTADOS.slice(inicio, fim);
    const pagina = comTotal("50").slice(0, inicio) + Array.from({ length: 10 }, (_, i) =>
      primeiro.replaceAll(CNJ_1, `${String(i + 1).padStart(7, "0")}-11.2025.4.04.9999`)
        .replaceAll('10000000000000000000000000001', String(i + 1).padStart(30, "0")),
    ).join("") + '</body></html>';
    for (const [limite, quantidade] of [[100, 10], [1, 1]]) {
      const { cliente, chamadas } = clienteFalso([formulario(), () => html(pagina)]);
      const r = await buscaDireta(cliente, { tribunal: "trf4", texto: "x", limite }, undefined, { eproc: cliente });
      expect(r.acordaos).toHaveLength(quantidade);
      expect(r.cabecalhoDeCobertura).toMatch(/informou 50.*recebeu 10/);
      expect(chamadas).toHaveLength(2);
    }
  });

  it("resultado sem o link do inteiro teor aborta a lista (sem id o Garimpo não inventa)", async () => {
    const sem = RESULTADOS.replace(/<a\b[^>]*class="text-dark inteiroTeor"[^>]*>[\s\S]*?<\/a>/, "");
    const { cliente } = clienteFalso([formulario(), () => html(sem)]);
    await expect(buscaDireta(cliente, { tribunal: "trf4", texto: "x" }, undefined, { eproc: cliente }))
      .rejects.toBeInstanceOf(FormatoInesperadoError);
  });

  it("link do inteiro teor que viria em http (ou de outro host) não é aceito nem trocado por https", async () => {
    const http = RESULTADOS.replace(
      /data-link="externo_controlador\.php\?acao=jurisprudencia@jurisprudencia\/download_inteiro_teor/,
      'data-link="http://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php?acao=jurisprudencia@jurisprudencia/download_inteiro_teor',
    );
    const { cliente } = clienteFalso([formulario(), () => html(http)]);
    await expect(buscaDireta(cliente, { tribunal: "trf4", texto: "x" }, undefined, { eproc: cliente }))
      .rejects.toBeInstanceOf(FormatoInesperadoError);
  });

  it("busca repetida sai da memória, sem chamada; a busca guardada não leva o texto pesquisado", async () => {
    // A busca guardada só existe com pasta de dados (temporária, nunca a do usuário).
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-trf4-"));
    const memoria = new Memoria({ dados });
    const a = clienteFalso([formulario(), () => html(RESULTADOS)]);
    const p = { tribunal: "trf4", texto: "aposentadoria especial" };
    await buscaDireta(a.cliente, p, memoria, { eproc: a.cliente });
    const b = clienteFalso([]);
    const r = await buscaDireta(b.cliente, p, memoria, { eproc: b.cliente });
    expect(b.chamadas).toHaveLength(0);
    expect(r.buscaGuardada).toMatch(/no e-Proc do TRF4/);
    expect(r.acordaos).toHaveLength(2);
    expect((await lerBuscaGuardada(memoria, p))?.resultado.acordaos).toHaveLength(2);
  });
});

describe("TRF4 — inteiro teor em HTML assinado: texto do portal do tribunal", () => {
  async function memoriaComBusca() {
    const memoria = new Memoria();
    const a = clienteFalso([formulario(), () => html(RESULTADOS)]);
    await buscaDireta(a.cliente, { tribunal: "trf4", texto: "aposentadoria especial" }, memoria, { eproc: a.cliente });
    return memoria;
  }
  const ID = "trf4:10000000000000000000000000001";

  it("2 chamadas (formulário para a sessão e o download), UA honesto; guarda como texto do portal e ensina a ler pelo id", async () => {
    const memoria = await memoriaComBusca();
    const { cliente, chamadas } = clienteFalso([formulario(), () => html(INTEIRO_TEOR)]);
    const r = await obterInteiroTeor({ id: ID }, () => cliente, memoria);

    expect(chamadas.map((c) => c.url)).toEqual([FORMULARIO, LINK_1]);
    expect(new Headers(chamadas[1].init.headers).get("cookie")).toBe("TRF4_Eproc_sessao=abc123");
    for (const c of chamadas) expect(new Headers(c.init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/texto do portal do tribunal/);
    expect(r.explicacao).toMatch(/não é o PDF/);
    expect(r.explicacao).toMatch(new RegExp(`ler_inteiro_teor com o id ${ID}`));
    const guardado = await memoria.obterTexto(ID);
    expect(guardado?.texto).toMatch(/RELATÓRIO/);
    expect(guardado?.texto).toMatch(/VOTO/);
    expect(guardado?.texto).toMatch(/Documento eletrônico assinado por/);
    expect(guardado?.texto).toMatch(/atividade especial exige prova/);

    const lida = await lerTextoIntegral(ID, 1, memoria);
    expect(lida.cabecalho.fonte).toMatch(/TRF4/);
    expect(lida.cabecalho.natureza).toMatch(/texto do portal do tribunal \(TRF4\).*não é PDF/);
    expect(lida.cabecalho.natureza).not.toMatch(/inteiro teor oficial/);
  });

  it("já na memória: nenhuma chamada nova", async () => {
    const memoria = await memoriaComBusca();
    await obterInteiroTeor({ id: ID }, () => clienteFalso([formulario(), () => html(INTEIRO_TEOR)]).cliente, memoria);
    const { cliente, chamadas } = clienteFalso([]);
    const r = await obterInteiroTeor({ id: ID }, () => cliente, memoria);
    expect(chamadas).toHaveLength(0);
    expect(r.baixado).toBe(false);
  });

  it("página que não é o acórdão assinado (aviso do portal) = «não verificado», nada guardado", async () => {
    const memoria = await memoriaComBusca();
    const { cliente } = clienteFalso([formulario(), () => html("<html><body><p>Sessão expirada. Faça nova pesquisa.</p></body></html>")]);
    const r = await obterInteiroTeor({ id: ID }, () => cliente, memoria);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/não verificado/);
    expect(r.link).toBe(LINK_1);
    expect(await memoria.obterTexto(ID)).toBeUndefined();
  });

  it("acórdão de outro processo (número CNJ não está no texto) = «não verificado», nada guardado", async () => {
    const memoria = await memoriaComBusca();
    const outro = INTEIRO_TEOR.replace(CNJ_1, "0000999-99.2020.4.04.1234");
    const { cliente } = clienteFalso([formulario(), () => html(outro)]);
    const r = await obterInteiroTeor({ id: ID }, () => cliente, memoria);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/não verificado/);
    expect(await memoria.obterTexto(ID)).toBeUndefined();
  });

  it("redirecionamento do download não é seguido: nada guardado", async () => {
    const memoria = await memoriaComBusca();
    const { cliente, chamadas } = clienteFalso([
      formulario(),
      () => new Response(null, { status: 302, headers: { location: "https://eproc-jur.trf4.jus.br/outra" } }),
    ]);
    const r = await obterInteiroTeor({ id: ID }, () => cliente, memoria);
    expect(chamadas).toHaveLength(2);
    expect(r.baixado).toBe(false);
    expect(await memoria.obterTexto(ID)).toBeUndefined();
  });

  it("link de outro acórdão do mesmo processo não é associado ao id pedido", async () => {
    const memoria = await memoriaComBusca();
    const { cliente, chamadas } = clienteFalso([]);
    const outro = LINK_1.replace('10000000000000000000000000001', '10000000000000000000000000002');
    await expect(obterInteiroTeor({ id: ID, link: outro }, () => cliente, memoria)).rejects.toThrow(/difere do acórdão/);
    expect(chamadas).toHaveLength(0);
    expect(await memoria.obterTexto(ID)).toBeUndefined();
  });

  it("nunca chama o link de acompanhamento processual (/trf4/processos/), nem como link do inteiro teor", async () => {
    const memoria = await memoriaComBusca();
    await expect(
      obterInteiroTeor({ tribunal: "trf4", link: ACOMPANHAMENTO_1, id: ID }, () => clienteFalso([]).cliente, memoria),
    ).rejects.toThrow(/fora do formato/);
  });
});
