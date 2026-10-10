import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Cliente, UA_NAVEGADOR, USER_AGENT, Vagas } from "../src/cliente.js";
import { dataEHora } from "../src/memoria.js";
import { servicoDe } from "../src/disjuntor.js";
import { criarServidor, type OpcoesServidor } from "../src/servidor.js";
import type { TabelaDePrecedentes } from "../src/tabelaDePrecedentes.js";
import type { TabelaDoStf } from "../src/tabelaDoStf.js";
import { gerarTabela, PAGINA_DO_CONJUNTO, URL_PROCESSOS, URL_TEMAS } from "../scripts/gerarTabela.js";
import { gerarTabelaStf } from "../scripts/gerarTabelaStf.js";
import { clienteFalso } from "./apoio.js";

const gravado = (nome: string) => readFile(new URL(`./fixtures/stj-precedentes/${nome}`, import.meta.url));

/** Tabela do STF das gravações sintéticas (obtidas em 2026-10-09), para o plano B. */
async function tabelaStfSintetica(): Promise<TabelaDoStf> {
  const a = async (nome: string) => ({
    nome,
    bytes: await readFile(new URL(`./fixtures/stf-sintetico/${nome}`, import.meta.url)),
    obtidoEm: "2026-10-09T12:00:00.000Z",
  });
  return gerarTabelaStf(
    {
      repercussaoGeral: await a("RepercussaoGeral.xls"),
      sumulas: await a("sumulas.html"),
      sumulasVinculantes: await a("sumulas-vinculantes.html"),
      paginasDeSumula: [await a("sumulas/sumula-1.html"), await a("sumulas/sv-1.html")],
    },
    "2026-10-09T13:00:00.000Z",
  );
}

const html = (corpo: string) =>
  new Response(`<html><body>${corpo}</body></html>`, { status: 200, headers: { "content-type": "text/html;charset=UTF-8" } });

/** Ficha do tema (tema.asp) do portal do STF. */
function fichaDoTema(numero = 1, situacao = "Trânsito em Julgado - 01/02/2020") {
  const link = `verAndamentoProcesso.asp?incidente=900001&numeroProcesso=100001&classeProcesso=RE&numeroTema=${numero}`;
  return html(`<div class="tema-unico"><div class="tema-titulo">
    <div class="tema-numero"><div>Tema: </div><a target="_blank" href="${link}">
        ${numero}
    </a></div>
    <div class="tema-titulo-link"><div>Título: </div><a target="_blank" href="${link}">
        Título sintético do tema.
    </a></div></div>
  <div class="tema-informacoes"><div class="tema-leadingcase"><div class="tema-campo">Leading Case:</div>
    <p><a href="/processos/detalhe.asp?incidente=900001">
        RE 100001
    </a></p></div>
  <div class="tema-ministro"><div class="tema-campo">Ministro:</div><p>
        MIN. FULANO SINTÉTICO
  </p></div></div>
  <h3 class="tema-subtitulo">Situação atual</h3><div class="tema-situacao"><div class="tema-repercussao">
    <div class="tema-campo">Repercussão geral:</div><p>
        Há repercussão geral
    </p></div>
  <div class="tema-situacao-atual"><div class="tema-campo">Situação:</div>
    <p> ${situacao}</p></div></div></div>`);
}

/** Página do tema com a tese (verAndamentoProcesso.asp). */
function paginaDaTese(numero = 1, tese: string | null = "Tese sintética de repercussão geral.") {
  return html(`<div class="container__RG"><p class="tema__RG"><strong>
      Tema ${numero} - Título sintético do tema.
    </strong></p>
    <dl class="dl-horizontal espacada"><dt>Relator(a):</dt><dd>MIN. FULANO SINTÉTICO</dd>
    <dt>Descrição:</dt><dd>Descrição sintética.</dd>
    ${tese === null ? "" : `<dt>Tese:</dt>\n<dd>${tese}</dd>`}
    </dl></div>`);
}

/** Lista de súmulas vinculantes (base=26), com a marca entre parênteses e o espaço de largura zero do portal. */
function listaDeSv() {
  return html(`<div class="sumarioSumulas"><h3 class="titulo-sumario-sumula">Súmulas Vinculantes</h3><div class="sumula-item"><a target="_blank" href="sumariosumulas.asp?base=26&sumula=7001">
\tSúmula Vinculante&nbsp;1

\t&nbsp;
</a></div><div class="sumula-item"><a target="_blank" href="sumariosumulas.asp?base=26&sumula=7002">
\tSúmula Vinculante 2 <em>(cance&#8203;lada)</em>
</a></div></div>`);
}

function paginaDaSumula(rotulo: string, enunciado: string) {
  return html(`<div class="divider-titulo-formulario"></div><br><div class="titulo">
\t${rotulo}
</div><div class="parCOM"><p>
\t${enunciado}</p>
</div><div class="titulo">
\tPrecedente Representativo
</div><div class="parCOM"><p>Outro texto.</p></div>`);
}

/** A tabela pequena do STJ (gravação de referência, coleta em 2026-10-09), para o plano B. */
async function tabelaPequena(): Promise<TabelaDePrecedentes> {
  return gerarTabela(
    {
      pagina: { url: PAGINA_DO_CONJUNTO, bytes: await gravado("pagina-trecho.html"), coletadoEm: "2026-10-09T12:22:25.614Z" },
      temas: { url: URL_TEMAS, bytes: await gravado("temas-trecho.csv"), coletadoEm: "2026-10-09T12:22:35.742Z" },
      processos: { url: URL_PROCESSOS, bytes: await gravado("processos-trecho.csv"), coletadoEm: "2026-10-09T12:22:47.212Z" },
    },
    "2026-10-09T12:23:00.000Z",
  );
}

// Páginas sintéticas no formato das páginas reais (docs/banco-de-provas/precedentes-ao-vivo-prova.md): mesma
// marcação, textos inventados.

/** Página de precedentes do STJ (ISO-8859-1, como a real). */
function paginaStj({
  letra = "T",
  numero = 1198,
  situacao = "Acórdão Publicado - RE Pendente",
  questao = "Questão sintética submetida a julgamento.",
  tese = "Tese sintética firmada pelo tribunal.",
} = {}): Response {
  const rotulo = letra === "I" ? "IAC" : "Tema Repetitivo";
  const html = `<html><body><form>
<div class="container containerDocumento"><div class="row"><div class="col-3 tituloDocumento">Documento 1</div></div>
<div class="row"><div class="col-3 p-0 borda_clara"><div class="row"><div class="col-12 titulo_campo_processo">
  ${rotulo}
  <span class="dados_campo_processo fonte_destaque highlightBrs">${numero}</span>
  <span><a href="javascript:copiarLinkTema(
      '${letra}',
      '${numero}',
      'iconeCopy-${letra}-${numero}',
      'iconeCheck-${letra}-${numero}');"></a></span>
</div></div></div>
<div class="col-3 p-0 borda_clara"><div class="row">
  <div class="col-6 titulo_campo_processo">
      Situação
  </div>
  <div class="col-6 dados_campo_processo fonte_destaque">
      ${situacao}
  </div>
</div></div>
<div class="col-3 p-0 borda_clara"><div class="row">
  <div class="col-4 titulo_campo_processo">
      Órgão julgador
  </div>
  <div class="col-8 dados_campo_processo">
      CORTE ESPECIAL
  </div>
</div></div></div>
<div class="row ">
  <div class="col-3 titulo_campo campo_texto borda_clara">
      Questão submetida a julgamento
  </div>
  <div class="col-9 dados_campo campo_texto borda_clara">
      <div align="justify"><span><p>${questao}</p></span></div>
  </div>
</div>
${tese === "" ? "" : `<div class="row ">
  <div class="col-3 titulo_campo campo_texto borda_clara">
      Tese Firmada
  </div>
  <div class="col-9 dados_campo campo_texto borda_clara">
      <div align="justify"><span><p>${tese}</p></span></div>
  </div>
</div>`}
<div class="row cabecalho_processo borda_clara oculto_no_resumo"><div class="col-2">
  <span title="Paradigma Principal"><span class="glyphicon">&#xe006;</span></span>
</div><div class="col-8 titulo_campo"><a href="#"><b>REsp 100001/XX</b></a></div></div>
<div class="row borda_clara"><div class="col-12"><div>
Última atualização: 13/08/2026
</div></div></div>
</div></form></body></html>`;
  return new Response(Buffer.from(html, "latin1"), {
    status: 200,
    headers: { "content-type": "text/html;charset=ISO-8859-1" },
  });
}

const SEM_REDE = () =>
  new Cliente({
    nome: "O portal",
    fetch: (async () => {
      throw new Error("sem rede no teste");
    }) as typeof fetch,
  });

async function conectar(opcoes: OpcoesServidor) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
  await criarServidor(SEM_REDE(), { dados, precedentesStj: SEM_REDE(), precedentesStf: SEM_REDE(), ...opcoes }).connect(
    ladoServidor,
  );
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function consultar(mcp: Client, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name: "consultar_precedente", arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { erro: r.isError === true, texto: r.content[0].text, dado: r.isError ? undefined : JSON.parse(r.content[0].text) };
}

const QUANDO = /^consultado no portal do STJ em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(hora local, UTC[+-]\d{2}:\d{2}\)$/;

describe("consultar_precedente — STJ ao vivo", () => {
  it("tema repetitivo: busca a página do tema no portal do STJ e devolve situação, questão e tese literais", async () => {
    const { cliente, chamadas } = clienteFalso([paginaStj()], { nome: "O portal do STJ" });
    const mcp = await conectar({ precedentesStj: cliente });
    const { dado } = await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero: 1198 });
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?novaConsulta=true&tipo_pesquisa=T&cod_tema_inicial=1198&cod_tema_final=1198",
    ]);
    expect(dado.origem).toMatch(QUANDO);
    expect(dado.consta).toBe(true);
    expect(dado.situacaoNaFonte).toBe("Acórdão Publicado - RE Pendente");
    expect(dado.questaoSubmetida).toBe("Questão sintética submetida a julgamento.");
    expect(dado.teseFirmada).toBe("Tese sintética firmada pelo tribunal.");
    expect(dado.orgaoJulgador).toBe("CORTE ESPECIAL");
    expect(dado.processoParadigma).toEqual(["REsp 100001/XX"]);
    expect(dado.ultimaAtualizacaoNoPortal).toBe("13/08/2026");
    expect(dado.enquadramento927.inciso).toBe("III");
    expect(dado.enquadramento927.evidencia).toMatch(/portal do STJ em .*tema repetitivo nº 1198, com tese firmada/);
    expect(dado.tabela).toBeUndefined();
  });

  it("IAC vai com tipo_pesquisa=I", async () => {
    const { cliente, chamadas } = clienteFalso([paginaStj({ letra: "I", numero: 1 })], { nome: "O portal do STJ" });
    const mcp = await conectar({ precedentesStj: cliente });
    const { dado } = await consultar(mcp, { tribunal: "stj", tipo: "IAC", numero: 1 });
    expect(chamadas[0].url).toContain("tipo_pesquisa=I&cod_tema_inicial=1&cod_tema_final=1");
    expect(dado.origem).toMatch(QUANDO);
  });

  it("o portal recusa (403): a tabela responde como plano B, dizendo a data dela e o motivo", async () => {
    const recusa = () => new Response("negado", { status: 403 });
    const { cliente, chamadas } = clienteFalso([recusa], { nome: "O portal do STJ" });
    const mcp = await conectar({ precedentesStj: cliente, tabela: await tabelaPequena() });
    const { dado } = await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero: 1 });
    expect(chamadas).toHaveLength(1);
    expect(dado.origem).toBe("tabela de 2026-10-09, o portal do STJ não respondeu");
    expect(dado.motivoDoPlanoB).toMatch(/O portal do STJ bloqueou a chamada \(HTTP 403/);
    expect(dado.tabela.dataDaColeta).toBe("2026-10-09");
    expect(dado.consta).toBe(true);
    expect(dado.avisoNaturezaJuridica).toMatch(/^Fotografia da tabela de precedentes do STJ/);
  });

  it("página com outro tipo ou número (o portal ignora código errado) não é aceita: vai ao plano B", async () => {
    const { cliente } = clienteFalso([paginaStj({ letra: "T", numero: 1 })], { nome: "O portal do STJ" });
    const mcp = await conectar({ precedentesStj: cliente, tabela: await tabelaPequena() });
    const { dado } = await consultar(mcp, { tribunal: "stj", tipo: "IAC", numero: 1 });
    expect(dado.origem).toBe("tabela de 2026-10-09, o portal do STJ não respondeu");
    expect(dado.motivoDoPlanoB).toMatch(/veio sem o IAC 1/);
  });

  it("sem tabela e sem portal: erro que diz os dois motivos", async () => {
    const { cliente } = clienteFalso([new Response("negado", { status: 403 })], { nome: "O portal do STJ" });
    const mcp = await conectar({ precedentesStj: cliente });
    const r = await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero: 1 });
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/O portal do STJ não respondeu .* e a tabela de precedentes não foi carregada/);
  });

  it("a mesma pergunta dentro de 24 h volta da memória, sem nova chamada, com a hora da consulta original", async () => {
    let agora = Date.parse("2026-10-09T15:00:00Z");
    const { cliente, chamadas } = clienteFalso([paginaStj()], { nome: "O portal do STJ" });
    const mcp = await conectar({ precedentesStj: cliente, agora: () => agora });
    const primeira = await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero: 1198 });
    agora += 3 * 3_600_000;
    const segunda = await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero: 1198 });
    expect(chamadas).toHaveLength(1);
    expect(segunda.dado.teseFirmada).toBe(primeira.dado.teseFirmada);
    expect(segunda.dado.origem).toBe(`${primeira.dado.origem}; da memória do Garimpo (consulta feita nas últimas 24 h)`);
  });
});

const QUANDO_STF = /^consultado no portal do STF em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(hora local, UTC[+-]\d{2}:\d{2}\)$/;

describe("consultar_precedente — STF ao vivo", () => {
  it("repercussão geral: ficha do tema e página da tese (2 chamadas), com UA de navegador", async () => {
    const { cliente, chamadas } = clienteFalso([fichaDoTema(1), paginaDaTese(1)], { nome: "O portal do STF" });
    const mcp = await conectar({ precedentesStf: cliente });
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "repercussão geral", numero: 1 });
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=1",
      "https://portal.stf.jus.br/jurisprudenciaRepercussao/verAndamentoProcesso.asp?incidente=900001&numeroProcesso=100001&classeProcesso=RE&numeroTema=1",
    ]);
    expect(new Headers(chamadas[0].init.headers).get("User-Agent")).toBe(UA_NAVEGADOR);
    expect(dado.origem).toMatch(QUANDO_STF);
    expect(dado.situacaoNaFonte).toBe("Trânsito em Julgado - 01/02/2020");
    expect(dado.teseFirmada).toBe("Tese sintética de repercussão geral.");
    expect(dado.titulo).toBe("Título sintético do tema.");
    expect(dado.processoParadigma).toEqual(["RE 100001"]);
    expect(dado.relator).toBe("MIN. FULANO SINTÉTICO");
    expect(dado.haRepercussao).toBe("Há repercussão geral");
    expect(dado.enquadramento927.inciso).toBe("não classificado");
    expect(dado.enquadramento927.avisoSituacao).toMatch(/"Trânsito em Julgado - 01\/02\/2020" \(portal do STF em /);
  });

  it("tema sem tese na página: diz isso, sem inventar", async () => {
    const { cliente } = clienteFalso([fichaDoTema(2, "Mérito pendente"), paginaDaTese(2, null)], { nome: "O portal do STF" });
    const mcp = await conectar({ precedentesStf: cliente });
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "repercussão geral", numero: 2 });
    expect(dado.teseFirmada).toBe("sem tese na página do tema no portal");
    expect(dado.situacaoNaFonte).toBe("Mérito pendente");
  });

  it("súmula vinculante: lista do tipo e página da súmula; a lista fica na memória e a próxima custa 1 chamada", async () => {
    const { cliente, chamadas } = clienteFalso(
      [
        listaDeSv(),
        paginaDaSumula("Súmula Vinculante 1", "Enunciado sintético <div>um</div> inteiro."),
        paginaDaSumula("Súmula Vinculante 2", "Enunciado sintético dois."),
      ],
      { nome: "O portal do STF" },
    );
    const mcp = await conectar({ precedentesStf: cliente });
    const um = (await consultar(mcp, { tribunal: "stf", tipo: "súmula vinculante", numero: 1 })).dado;
    const dois = (await consultar(mcp, { tribunal: "stf", tipo: "súmula vinculante", numero: 2 })).dado;
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26",
      "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26&sumula=7001",
      "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26&sumula=7002",
    ]);
    expect(um.origem).toMatch(QUANDO_STF);
    expect(um.enunciado).toBe("Enunciado sintético\num\ninteiro.");
    expect(um.situacaoNaFonte).toBe("sem marca de situação na lista do STF");
    expect(um.enquadramento927.inciso).toBe("II");
    expect(dois.enunciado).toBe("Enunciado sintético dois.");
    expect(dois.situacaoNaFonte).toBe('marcada como "cancelada" na lista do STF');
    expect(dois.endereco).toBe("https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26&sumula=7002");
  });

  it('súmula fora da lista do portal: plano B, nunca "não existe"', async () => {
    const { cliente } = clienteFalso([listaDeSv()], { nome: "O portal do STF" });
    const mcp = await conectar({ precedentesStf: cliente, tabelaStf: await tabelaStfSintetica() });
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "súmula vinculante", numero: 99 });
    expect(dado.origem).toBe("tabela de 2026-10-09, o portal do STF não respondeu");
    expect(dado.motivoDoPlanoB).toMatch(/súmula vinculante 99/);
    expect(dado.consta).toBe(false);
  });

  it("ficha de outro tema não é aceita: plano B com a tabela do STF", async () => {
    const { cliente, chamadas } = clienteFalso([fichaDoTema(5)], { nome: "O portal do STF" });
    const mcp = await conectar({ precedentesStf: cliente, tabelaStf: await tabelaStfSintetica() });
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "repercussão geral", numero: 1 });
    expect(chamadas).toHaveLength(1);
    expect(dado.origem).toBe("tabela de 2026-10-09, o portal do STF não respondeu");
    expect(dado.consta).toBe(true);
    expect(dado.avisoNaturezaJuridica).toMatch(/^Fotografia da tabela do STF/);
  });
});

describe("identificação e disjuntor dos portais de precedentes", () => {
  it("o STJ recebe a identificação honesta do Garimpo", async () => {
    const { cliente, chamadas } = clienteFalso([paginaStj()], { nome: "O portal do STJ" });
    const mcp = await conectar({ precedentesStj: cliente });
    await consultar(mcp, { tribunal: "stj", tipo: "tema repetitivo", numero: 1198 });
    expect(new Headers(chamadas[0].init.headers).get("User-Agent")).toBe(USER_AGENT);
  });

  it("serviço próprio no disjuntor: uma recusa nos precedentes não pausa o resto do tribunal", () => {
    expect(servicoDe("https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?x=1")).toBe("stj-precedentes");
    expect(servicoDe("https://processo.stj.jus.br/processo/revista/documento/mediado/?x=1")).toBe("stj");
    expect(servicoDe("https://portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=1")).toBe("stf-precedentes");
    expect(servicoDe("https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26")).toBe("stf-precedentes");
  });
});

describe("achados da revisão Codex (813af04..07c2d2c)", () => {
  it("redirecionamento do portal não é seguido: nenhum pedido ao destino, UA de navegador não sai do portal, plano B com motivo", async () => {
    const pedidos: { caminho: string; ua?: string }[] = [];
    const lista = await listaDeSv().text();
    const pagina = await paginaDaSumula("Súmula Vinculante 1", "Enunciado de outro host.").text();
    const servidor = createServer((req, res) => {
      pedidos.push({ caminho: req.url ?? "", ua: req.headers["user-agent"] });
      if (req.url === "/jurisprudencia/sumariosumulas.asp?base=26") return res.end(lista);
      if (req.url === "/jurisprudencia/sumariosumulas.asp?base=26&sumula=7001") {
        res.writeHead(302, { location: `http://localhost:${porta}/estrangeiro` });
        return res.end();
      }
      res.end(pagina);
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    const porta = (servidor.address() as AddressInfo).port;
    try {
      // Fetch real (segue redirecionamento por padrão), só com o endereço do portal trocado pelo servidor local.
      const cliente = new Cliente({
        nome: "O portal do STF",
        vagas: new Vagas(2),
        fetch: ((url: string, init: RequestInit) =>
          fetch(url.replace("https://portal.stf.jus.br", `http://127.0.0.1:${porta}`), init)) as typeof fetch,
      });
      const mcp = await conectar({ precedentesStf: cliente, tabelaStf: await tabelaStfSintetica() });
      const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "súmula vinculante", numero: 1 });
      expect(pedidos.map((p) => p.caminho)).toEqual([
        "/jurisprudencia/sumariosumulas.asp?base=26",
        "/jurisprudencia/sumariosumulas.asp?base=26&sumula=7001",
      ]);
      expect(pedidos.every((p) => p.ua === UA_NAVEGADOR)).toBe(true);
      expect(dado.origem).toBe("tabela de 2026-10-09, o portal do STF não respondeu");
      expect(dado.motivoDoPlanoB).toMatch(/Não foi possível falar com O portal do STF/);
      expect(dado.enunciado).not.toBe("Enunciado de outro host.");
    } finally {
      servidor.close();
    }
  });

  it("a marca da lista guarda a hora da lista: aparece na situação e a resposta vence junto com a lista", async () => {
    const t0 = Date.parse("2026-10-09T12:00:00Z");
    let agora = t0;
    const { cliente, chamadas } = clienteFalso(
      [
        listaDeSv(),
        paginaDaSumula("Súmula Vinculante 1", "Enunciado sintético um."),
        paginaDaSumula("Súmula Vinculante 2", "Enunciado sintético dois."),
        listaDeSv(),
        paginaDaSumula("Súmula Vinculante 2", "Enunciado sintético dois."),
      ],
      { nome: "O portal do STF" },
    );
    const mcp = await conectar({ precedentesStf: cliente, agora: () => agora });
    await consultar(mcp, { tribunal: "stf", tipo: "súmula vinculante", numero: 1 });
    agora = t0 + 23 * 3_600_000;
    const dois = (await consultar(mcp, { tribunal: "stf", tipo: "súmula vinculante", numero: 2 })).dado;
    expect(chamadas).toHaveLength(3);
    expect(dois.origem).toBe(`consultado no portal do STF em ${dataEHora(agora)}`);
    expect(dois.situacaoEm).toMatch(new RegExp(`^lista do portal do STF em ${escapar(dataEHora(t0))}:`));
    expect(dois.enquadramento927.avisoSituacao).toContain(`(lista do portal do STF em ${dataEHora(t0)})`);
    // Vencida a lista (24 h da obtenção dela), a resposta composta também vence: lista e página são lidas de novo.
    agora = t0 + 25 * 3_600_000;
    const denovo = (await consultar(mcp, { tribunal: "stf", tipo: "súmula vinculante", numero: 2 })).dado;
    expect(chamadas.map((c) => c.url).slice(3)).toEqual([
      "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26",
      "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26&sumula=7002",
    ]);
    expect(denovo.situacaoEm).toMatch(new RegExp(`^lista do portal do STF em ${escapar(dataEHora(agora))}:`));
  });

  it("súmula guardada antes da correção (sem a hora da lista) não é servida: lista e página são lidas de novo", async () => {
    const agora = Date.parse("2026-10-10T12:00:00Z");
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    // Registro no formato gravado por b9b4854 (memória versão 1): resposta composta sem listaObtidaEm, marca antiga.
    const pasta = join(dados, "memoria", "consultas-1");
    await mkdir(pasta, { recursive: true });
    const k = createHash("sha256").update("precedente-ao-vivo|stf|súmula vinculante|2").digest("hex");
    const endereco = "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26&sumula=7002";
    await writeFile(
      join(pasta, `${k}.json`),
      JSON.stringify({
        formato: "garimpo-memoria-consulta",
        versao: 1,
        fonte: "precedentes",
        dado: { linha: { tipo: "súmula vinculante", numero: 2, situacao: "antiga", enunciado: "Enunciado antigo.", link: endereco }, endereco },
        obtidoEm: agora - 3_600_000,
      }),
    );
    const { cliente, chamadas } = clienteFalso(
      [listaDeSv(), paginaDaSumula("Súmula Vinculante 2", "Enunciado sintético dois.")],
      { nome: "O portal do STF" },
    );
    const mcp = await conectar({ precedentesStf: cliente, dados, agora: () => agora });
    const { dado } = await consultar(mcp, { tribunal: "stf", tipo: "súmula vinculante", numero: 2 });
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26",
      endereco,
    ]);
    expect(dado.enunciado).toBe("Enunciado sintético dois.");
    expect(dado.situacaoNaFonte).toBe('marcada como "cancelada" na lista do STF');
    expect(dado.origem).toBe(`consultado no portal do STF em ${dataEHora(agora)}`);
  });
});

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
