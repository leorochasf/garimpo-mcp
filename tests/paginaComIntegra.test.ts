import { beforeAll, describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { lerTextoIntegral } from "../src/leitura.js";
import { Memoria } from "../src/memoria.js";
import { type PortalComIntegra, portalComIntegra, registrarPortal } from "../src/paginaComIntegra.js";
import { clienteFalso } from "./apoio.js";

// Ticket 03 da frente dos TJs: o molde «página com íntegra» com as guardas ligadas por padrão, e o registro de portais.
// Portal fictício no TJAC (hoje «só link»): nenhum tribunal real entra por este ticket.

const CNJ = "0000001-11.2025.8.01.0001";
const LINK = "https://portal.exemplo.jus.br/acordao/77";

const PORTAL: PortalComIntegra = {
  sigla: "tjac",
  host: "portal.exemplo.jus.br",
  caminho: /^\/acordao\/\d+$/,
  rotulo: "portal fictício de jurisprudência do TJAC (portal.exemplo.jus.br)",
  processo: (html) => /id="processo">([^<]*)</.exec(html)?.[1],
  segredo: (html) => /id="segredo">([^<]*)</.exec(html)?.[1],
  integra: (html) => /<div id="integra">([\s\S]*?)<\/div>/.exec(html)?.[1],
};

const CORPO =
  "ACÓRDÃO FICTÍCIO. Vistos, relatados e discutidos os autos do processo " +
  CNJ +
  ". RELATÓRIO fictício para teste do molde, sem nenhum dado real. VOTO fictício: o recurso é conhecido e provido, " +
  "nos termos do voto do relator fictício, com texto bastante para passar do mínimo de texto útil do molde.";

/** `segredo: null` tira o campo de segredo de justiça da página. */
function pagina({ processo = CNJ, segredo = "Não" as string | null, corpo = CORPO } = {}): string {
  const campoDeSegredo = segredo === null ? "" : ` <span>Segredo de Justiça:</span> <b id="segredo">${segredo}</b>`;
  return (
    `<html><body><div class="menu">Início | Pesquisa</div>` +
    `<span>Processo:</span> <b id="processo">${processo}</b>${campoDeSegredo}` +
    `<div id="integra">${corpo}</div><footer>Rodapé do portal</footer></body></html>`
  );
}

const html = (texto: string) => () => new Response(texto, { headers: { "content-type": "text/html; charset=UTF-8" } });

function memoriaComAcordao(sobre: Partial<Acordao> = {}) {
  const memoria = new Memoria();
  const acordao = {
    id: "tjac:77",
    tribunal: "tjac",
    numero: CNJ,
    numeroCnj: CNJ,
    semNumero: false,
    ementa: "APELAÇÃO CÍVEL. EMENTA FICTÍCIA DO TJAC PARA TESTE.",
    link: LINK,
    ...sobre,
  } as Acordao;
  memoria.lembrar([{ ids: [acordao.id], registro: acordao }]);
  return memoria;
}

beforeAll(() => registrarPortal(PORTAL));

describe("molde «página com íntegra»: o portal registrado entrega a íntegra numa página HTML", () => {
  it("guarda só a íntegra, numa chamada, e a leitura sai com o rótulo do próprio portal", async () => {
    const memoria = memoriaComAcordao();
    const { cliente, chamadas } = clienteFalso([html(pagina())]);
    const r = await obterInteiroTeor({ id: "tjac:77" }, () => cliente, memoria);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(LINK);
    expect(chamadas[0].init.redirect).toBe("manual");
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/ler_inteiro_teor com o id tjac:77/);
    const guardado = await memoria.obterTexto("tjac:77");
    expect(guardado?.texto).toMatch(/^ACÓRDÃO FICTÍCIO\./);
    expect(guardado?.texto).not.toMatch(/Início|Rodapé/);

    const lida = await lerTextoIntegral("tjac:77", 1, memoria);
    expect(lida.cabecalho.fonte).toBe(PORTAL.rotulo);
    expect(lida.cabecalho.natureza).toBe(
      "texto do portal do tribunal (TJAC), convertido de HTML pelo Garimpo: não é PDF e não tem recibo de origem",
    );
  });
});

describe("registro: desligar uma guarda exige justificativa na declaração do tribunal", () => {
  it("portal sem o campo de segredo de justiça e sem justificar: o registro recusa", () => {
    const { segredo: _, ...semSegredo } = PORTAL;
    expect(() => registrarPortal({ ...semSegredo, sigla: "tjap" })).toThrow(/segredoDeJustica.*justificativa/);
  });

  it("justificativa vazia não vale", () => {
    expect(() => registrarPortal({ ...PORTAL, sigla: "tjap", desligadas: { numeroNaIntegra: "   " } })).toThrow(
      /numeroNaIntegra.*justificativa/,
    );
  });

  it("sigla declarada em maiúsculas é achada como a do Garimpo (minúscula)", () => {
    registrarPortal({ ...PORTAL, sigla: "TJRO" });
    expect(portalComIntegra("tjro")?.host).toBe(PORTAL.host);
  });

  it("sem o campo de segredo, com justificativa: o registro aceita", () => {
    const { segredo: _, ...semSegredo } = PORTAL;
    expect(() =>
      registrarPortal({
        ...semSegredo,
        sigla: "tjap",
        desligadas: { segredoDeJustica: "a página do portal fictício não tem o campo; acórdão em segredo não é publicado" },
      }),
    ).not.toThrow();
  });
});

/** Uma guarda barra: nada guardado, e a explicação diz o motivo. */
async function barrado(memoria: Memoria, respostas: Parameters<typeof clienteFalso>[0]) {
  const { cliente, chamadas } = clienteFalso(respostas);
  const r = await obterInteiroTeor({ id: "tjac:77" }, () => cliente, memoria);
  expect(r.baixado).toBe(false);
  expect(await memoria.obterTexto("tjac:77")).toBeUndefined();
  return { explicacao: r.baixado ? "" : r.explicacao, chamadas };
}

describe("molde «página com íntegra»: cada guarda, sozinha, barra o texto e diz o motivo", () => {
  it("sem número CNJ na busca: recusa antes de chamar o portal", async () => {
    const { explicacao, chamadas } = await barrado(memoriaComAcordao({ numeroCnj: undefined }), [html(pagina())]);
    expect(chamadas).toHaveLength(0);
    expect(explicacao).toMatch(/a busca não trouxe o número CNJ do acórdão/);
    expect(explicacao).toMatch(/Texto não verificado, nada foi guardado\./);
  });

  it.each([
    ["outro host", "https://outro.exemplo.jus.br/acordao/77"],
    ["outro caminho", "https://portal.exemplo.jus.br/pesquisa?q=77"],
    ["sem https", "http://portal.exemplo.jus.br/acordao/77"],
  ])("link com %s: recusa antes de chamar o portal", async (_, link) => {
    const { explicacao, chamadas } = await barrado(memoriaComAcordao({ link }), [html(pagina())]);
    expect(chamadas).toHaveLength(0);
    expect(explicacao).toMatch(/o link não aponta para um documento do portal do tribunal\./);
  });

  it("redirecionamento: não segue e não guarda", async () => {
    const desvio = () => new Response(null, { status: 302, headers: { location: "https://portal.exemplo.jus.br/aviso" } });
    const { explicacao, chamadas } = await barrado(memoriaComAcordao(), [desvio]);
    expect(chamadas).toHaveLength(1);
    expect(explicacao).toMatch(/o portal mandou para outro endereço, que o Garimpo não segue/);
  });

  it("resposta que não é página HTML: não guarda", async () => {
    const pdf = () => new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } });
    const { explicacao } = await barrado(memoriaComAcordao(), [pdf]);
    expect(explicacao).toMatch(/o portal não respondeu com uma página HTML de tamanho normal/);
  });

  it.each([
    ["página de aviso, sem a íntegra", `<html><body>Documento não encontrado.</body></html>`, /a página não traz a íntegra do documento do link/],
    ["página sem o número do processo", pagina({ processo: "" }), /a página não mostra o número do processo/],
    ["página de outro processo", pagina({ processo: "0000002-22.2025.8.01.0001" }), /a página é de outro processo que o da busca/],
    ["acórdão em segredo de justiça", pagina({ segredo: "Sim" }), /o acórdão está em segredo de justiça/],
    ["íntegra curta demais", pagina({ corpo: `Acórdão ${CNJ}.` }), /a íntegra veio curta demais para ser o acórdão/],
    [
      "íntegra de outro acórdão na página certa",
      pagina({ corpo: CORPO.replace(CNJ, "0000002-22.2025.8.01.0001") }),
      /a íntegra não traz o número do próprio processo \(o portal pode ter mostrado a íntegra de outro acórdão\)/,
    ],
  ])("%s: não guarda e diz o motivo", async (_, corpo, motivo) => {
    const { explicacao, chamadas } = await barrado(memoriaComAcordao(), [html(corpo)]);
    expect(chamadas).toHaveLength(1);
    expect(explicacao).toMatch(motivo);
  });

  it("guarda desligada com justificativa na declaração: a íntegra sem o próprio número passa", async () => {
    registrarPortal({
      ...PORTAL,
      sigla: "tjam",
      rotulo: "portal fictício do TJAM",
      desligadas: { numeroNaIntegra: "na prova do portal fictício, a íntegra nunca repete o número do processo" },
    });
    const memoria = memoriaComAcordao({ id: "tjam:77", tribunal: "tjam" });
    const { cliente } = clienteFalso([html(pagina({ corpo: CORPO.replace(CNJ, "número omitido") }))]);
    await obterInteiroTeor({ id: "tjam:77" }, () => cliente, memoria);
    expect((await memoria.obterTexto("tjam:77"))?.texto).toMatch(/^ACÓRDÃO FICTÍCIO\./);
  });

  // Revisão do 03 (B03-R01): com a guarda ligada, só a página que diz expressamente que não há segredo passa.
  it("B03-R01: página sem o campo de segredo de justiça (guarda ligada): não guarda e diz o motivo", async () => {
    const { explicacao, chamadas } = await barrado(memoriaComAcordao(), [html(pagina({ segredo: null }))]);
    expect(chamadas).toHaveLength(1);
    expect(explicacao).toMatch(
      /a página não informa se o acórdão está em segredo de justiça, e o Garimpo só guarda o texto quando ela diz que não está/,
    );
  });

  it("B03-R01: com a exceção justificada na declaração, a página sem o campo de segredo é guardada", async () => {
    const { segredo: _, ...semSegredo } = PORTAL;
    registrarPortal({
      ...semSegredo,
      sigla: "tjma",
      rotulo: "portal fictício do TJMA",
      desligadas: { segredoDeJustica: "na prova do portal fictício, a página não tem o campo e segredo não é publicado" },
    });
    const memoria = memoriaComAcordao({ id: "tjma:77", tribunal: "tjma" });
    const { cliente } = clienteFalso([html(pagina({ segredo: null }))]);
    await obterInteiroTeor({ id: "tjma:77" }, () => cliente, memoria);
    expect((await memoria.obterTexto("tjma:77"))?.texto).toMatch(/^ACÓRDÃO FICTÍCIO\./);
  });

  // Revisão do 03 (B03-R02): número CNJ só vale com os 20 algarismos, na busca e na página; dois vazios nunca são iguais.
  it.each([
    ["marcador textual", "não informado"],
    ["número incompleto", "0000001-11.2025"],
  ])("B03-R02: busca com %s no lugar do número CNJ: recusa antes de chamar o portal", async (_, numeroCnj) => {
    const { explicacao, chamadas } = await barrado(memoriaComAcordao({ numeroCnj }), [html(pagina({ processo: numeroCnj }))]);
    expect(chamadas).toHaveLength(0);
    expect(explicacao).toMatch(/a busca não trouxe o número CNJ do acórdão, e sem ele o Garimpo não confere/);
  });

  it.each([
    ["marcador textual", "não informado"],
    ["número incompleto", "0000001-11.2025"],
  ])("B03-R02: página com %s no lugar do número do processo: não guarda", async (_, processo) => {
    const { explicacao } = await barrado(memoriaComAcordao(), [html(pagina({ processo, corpo: `${CORPO} ${processo}` }))]);
    expect(explicacao).toMatch(/a página não mostra o número do processo/);
  });

  it("número da página sem máscara, igual em algarismos ao da busca, passa", async () => {
    const memoria = memoriaComAcordao();
    const { cliente } = clienteFalso([html(pagina({ processo: CNJ.replace(/\D/g, "") }))]);
    await obterInteiroTeor({ id: "tjac:77" }, () => cliente, memoria);
    expect((await memoria.obterTexto("tjac:77"))?.texto).toMatch(/^ACÓRDÃO FICTÍCIO\./);
  });
});
