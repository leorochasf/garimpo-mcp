import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { RecusaError, USER_AGENT } from "../src/cliente.js";
import { obterInteiroTeor, opcoesDoTribunal } from "../src/inteiroTeor.js";
import { lerTextoIntegral } from "../src/leitura.js";
import { Memoria } from "../src/memoria.js";
import { documentoDoTjpr, infoTribunal } from "../src/tribunais.js";
import { clienteFalso } from "./apoio.js";

const LINK = "https://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001/Ac%C3%B3rd%C3%A3o-0000001-11.2024.8.16.0001";
const CNJ = "0000001-11.2024.8.16.0001";
const PAGINA = readFileSync(new URL("./fixtures/tjpr-documento.html", import.meta.url), "utf8");
const pagina = (html = PAGINA) => () => new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });

function memoriaComAcordao(sobre: Partial<Acordao> = {}) {
  const memoria = new Memoria();
  const acordao = {
    id: "tjpr:77",
    tribunal: "tjpr",
    numero: CNJ,
    numeroCnj: CNJ,
    semNumero: false,
    ementa: "APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO DE EMENTA DO TJPR PARA TESTE.",
    link: LINK,
    ...sobre,
  } as Acordao;
  memoria.lembrar([{ ids: [acordao.id], registro: acordao }]);
  return memoria;
}

describe("inteiro teor — TJPR (ADR-0030): a íntegra vem na página pública do acórdão, um GET por documento", () => {
  it("o tribunal é marcado como texto do portal", () => {
    expect(infoTribunal("tjpr")?.inteiroTeor).toBe("portal");
  });

  it("pede a página do link (uma chamada, UA honesto, sem seguir redirecionamento), guarda só a íntegra e ensina a ler pelo id", async () => {
    const memoria = memoriaComAcordao();
    const { cliente, chamadas } = clienteFalso([pagina()]);
    const r = await obterInteiroTeor({ id: "tjpr:77" }, () => cliente, memoria);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(LINK);
    expect(chamadas[0].init.redirect).toBe("manual");
    expect(new Headers(chamadas[0].init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/texto do portal do tribunal/);
    expect(r.explicacao).toMatch(/ler_inteiro_teor com o id tjpr:77/);
    const guardado = await memoria.obterTexto("tjpr:77");
    expect(guardado?.texto).toMatch(/^VISTOS, relatados e discutidos/);
    expect(guardado?.texto).toMatch(/I – RELATÓRIO/);
    expect(guardado?.texto).toMatch(/dar provimento ao recurso fictício\.$/);
    // Menu, ementa da lista, aviso de transcrição e rodapé do portal não são texto do acórdão.
    expect(guardado?.texto).not.toMatch(/Selecionar Todos|Intranet|EXEMPLO FICTÍCIO DE EMENTA|transcrição|certidão/);
  });

  it("link com o nome sem codificação (/Acórdão), como vem de parte da base, pede o mesmo documento", async () => {
    const memoria = memoriaComAcordao({ link: "https://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001/Acórdão" });
    const { cliente, chamadas } = clienteFalso([pagina()]);
    await obterInteiroTeor({ id: "tjpr:77" }, () => cliente, memoria);
    expect(chamadas[0].url).toBe("https://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001/Ac%C3%B3rd%C3%A3o");
    expect((await memoria.obterTexto("tjpr:77"))?.texto).toMatch(/^VISTOS/);
  });

  it("já na memória: não chama o portal de novo", async () => {
    const memoria = memoriaComAcordao();
    await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina()]).cliente, memoria);
    const { cliente, chamadas } = clienteFalso([]);
    await obterInteiroTeor({ id: "tjpr:77" }, () => cliente, memoria);
    expect(chamadas).toHaveLength(0);
  });

  it("página de outro processo que o da busca: texto não verificado, nada guardado", async () => {
    const memoria = memoriaComAcordao({ numeroCnj: "0000002-22.2024.8.16.0001" });
    const r = await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina()]).cliente, memoria);
    expect(r.baixado ? "" : r.explicacao).toMatch(/texto não verificado/);
    expect(await memoria.obterTexto("tjpr:77")).toBeUndefined();
  });

  it("íntegra de outro documento que o do link: não verificado, nada guardado", async () => {
    const memoria = memoriaComAcordao({ link: "https://portal.tjpr.jus.br/jurisprudencia/j/4100000000000002/Acórdão" });
    const r = await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina()]).cliente, memoria);
    expect(r.baixado ? "" : r.explicacao).toMatch(/texto não verificado/);
    expect(await memoria.obterTexto("tjpr:77")).toBeUndefined();
  });

  it("página certa com a íntegra de outro acórdão (sem o número do processo da página): não verificado, nada guardado", async () => {
    // Visto ao vivo em 2026-10-29: mesmo processo e mesmo documento no cabeçalho, íntegra de outro caso.
    const memoria = memoriaComAcordao();
    const html = PAGINA.replace(
      /(<div id="texto4100000000000001">)[\s\S]*?(<\/div>\s*<\/td>)/,
      "$1Relatório. Trata-se de agravo de instrumento fictício interposto em face de decisão interlocutória de outro " +
        "processo, também fictício, sobre gratuidade da justiça. Voto. O pedido de gratuidade é indeferido porque a " +
        "renda declarada supera o limite do exemplo. Conclusão. Voto por conhecer e negar provimento ao recurso.$2",
    );
    const r = await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina(html)]).cliente, memoria);
    expect(r.baixado ? "" : r.explicacao).toMatch(/íntegra de outro acórdão/);
    expect(await memoria.obterTexto("tjpr:77")).toBeUndefined();
  });

  it("página sem o campo «Processo:»: não verificado, mesmo quando a busca não trouxe o número CNJ", async () => {
    const memoria = memoriaComAcordao({ numeroCnj: undefined });
    const html = PAGINA.replace("<b>Processo:</b>", "<b>Outro campo:</b>");
    await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina(html)]).cliente, memoria);
    expect(await memoria.obterTexto("tjpr:77")).toBeUndefined();
  });

  it("sem o aviso de transcrição do tribunal antes do bloco: não verificado, nada guardado", async () => {
    const memoria = memoriaComAcordao();
    const html = PAGINA.replace("O texto abaixo representa a transcrição de Acórdão.", "Texto de outra coisa.");
    await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina(html)]).cliente, memoria);
    expect(await memoria.obterTexto("tjpr:77")).toBeUndefined();
  });

  it("bloco da íntegra curto demais não vira texto integral", async () => {
    const memoria = memoriaComAcordao();
    const html = PAGINA.replace(/(<div id="texto4100000000000001">)[\s\S]*?(<\/div>\s*<\/td>)/, "$1Documento indisponível.$2");
    const r = await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina(html)]).cliente, memoria);
    expect(await memoria.obterTexto("tjpr:77")).toBeUndefined();
    expect(r.baixado ? "" : r.explicacao).toMatch(/não verificado/i);
  });

  it("página de aviso ou erro do portal: não verificado, nada guardado", async () => {
    const memoria = memoriaComAcordao({ numeroCnj: undefined });
    const html = "<html><body><h1>Nenhum registro encontrado</h1></body></html>";
    await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina(html)]).cliente, memoria);
    expect(await memoria.obterTexto("tjpr:77")).toBeUndefined();
  });

  it("acórdão em segredo de justiça: o texto da página não é guardado; vai o motivo", async () => {
    const memoria = memoriaComAcordao();
    const html = PAGINA.replace(/(<b>Segredo de Justiça:<\/b>\s*)Não/, "$1Sim");
    const r = await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina(html)]).cliente, memoria);
    expect(r.baixado ? "" : r.explicacao).toMatch(/segredo de justiça/);
    expect((await memoria.obterTexto("tjpr:77"))?.texto).toBe("");
  });

  it.each([
    "https://outro.test/jurisprudencia/j/4100000000000001/Acórdão",
    "http://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001/Acórdão",
    "/jurisprudencia/j/999/Acórdão",
  ])("redirecionamento para %s não é seguido nem guarda texto", async (destino) => {
    const memoria = memoriaComAcordao();
    const { cliente, chamadas } = clienteFalso([new Response(null, { status: 302, headers: { location: destino } })]);
    const r = await obterInteiroTeor({ id: "tjpr:77" }, () => cliente, memoria);
    expect(chamadas).toHaveLength(1);
    expect(await memoria.obterTexto("tjpr:77")).toBeUndefined();
    expect(r.baixado ? "" : r.explicacao).toMatch(/não verificado/i);
  });

  it("sem content-type HTML: não guarda texto", async () => {
    const memoria = memoriaComAcordao();
    const { cliente } = clienteFalso([new Response(PAGINA, { headers: { "content-type": "application/json" } })]);
    await obterInteiroTeor({ id: "tjpr:77" }, () => cliente, memoria);
    expect(await memoria.obterTexto("tjpr:77")).toBeUndefined();
  });

  it.each([
    "https://outro.test/jurisprudencia/j/4100000000000001/Acórdão",
    "http://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001/Acórdão",
    "https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do",
  ])("link fora do formato do TJPR (%s) é recusado antes de qualquer chamada", async (link) => {
    const memoria = memoriaComAcordao({ link });
    const { cliente, chamadas } = clienteFalso([]);
    await expect(obterInteiroTeor({ id: "tjpr:77" }, () => cliente, memoria)).rejects.toThrow(/fora do formato/);
    expect(chamadas).toHaveLength(0);
  });

  it("502 do portal: espera e faz UMA nova tentativa; 502 de novo para com recusa", async () => {
    const opcoes = { statusAdicionaisDeEspera: opcoesDoTribunal("tjpr").statusAdicionaisDeEspera };
    const passa = clienteFalso([new Response("", { status: 502 }), pagina()], opcoes);
    await obterInteiroTeor({ id: "tjpr:77" }, () => passa.cliente, memoriaComAcordao());
    expect(passa.chamadas).toHaveLength(2);
    expect(passa.esperas).toHaveLength(1);

    const recusa = clienteFalso([new Response("", { status: 502 }), new Response("", { status: 502 })], opcoes);
    const e = await obterInteiroTeor({ id: "tjpr:77" }, () => recusa.cliente, memoriaComAcordao()).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(recusa.chamadas).toHaveLength(2);
  });

  it("só o TJPR trata 502 como pedido de espera", () => {
    expect(opcoesDoTribunal("tjpr").statusAdicionaisDeEspera).toEqual([502]);
    expect(opcoesDoTribunal("tjpi").statusAdicionaisDeEspera).toBeUndefined();
  });
});

describe("documento do portal do TJPR no link", () => {
  it.each([
    ["https://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001/Acórdão", "4100000000000001"],
    ["https://portal.tjpr.jus.br/jurisprudencia/j/2100000000000003/Ac%C3%B3rd%C3%A3o-0000001-11.2024.8.16.0001", "2100000000000003"],
    ["https://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001", "4100000000000001"],
    ["http://portal.tjpr.jus.br/jurisprudencia/j/4100000000000001/Acórdão", undefined],
    ["https://outro.test/jurisprudencia/j/4100000000000001/Acórdão", undefined],
    ["https://portal.tjpr.jus.br/jurisprudencia/j/abc/Acórdão", undefined],
    ["não é link", undefined],
    [undefined, undefined],
  ])("%s → %s", (link, documento) => {
    expect(documentoDoTjpr(link)).toBe(documento);
  });
});

describe("ler_inteiro_teor — texto do portal do TJPR pelo id", () => {
  it("lê com o rótulo do portal do TJPR, dizendo que é transcrição sem as imagens", async () => {
    const memoria = memoriaComAcordao();
    await obterInteiroTeor({ id: "tjpr:77" }, () => clienteFalso([pagina()]).cliente, memoria);

    const p = await lerTextoIntegral("tjpr:77", 1, memoria);
    expect(p.cabecalho.tribunal).toBe("TJPR");
    expect(p.cabecalho.fonte).toMatch(/portal de jurisprudência do TJPR \(portal\.tjpr\.jus\.br\)/);
    expect(p.cabecalho.natureza).toMatch(/^texto do portal do tribunal \(TJPR\).*imagens suprimidas/);
    expect(JSON.stringify(p.cabecalho)).not.toMatch(/TJTO/);
  });
});
