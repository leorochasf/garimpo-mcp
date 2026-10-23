import { describe, expect, it } from "vitest";
import { clienteDaLegislacao, type RespostaTextoDeLei, textoDeLei } from "../src/legislacao.js";

// Teste ao vivo opcional: 1 chamada ao normas.leg.br (a norma inteira, ~4 MB). Só com GARIMPO_VIVO=1.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("texto_de_lei — ao vivo", () => {
  it("traz o caput do art. 85 do CPC com URL oficial e o aviso fixo", { timeout: 120_000 }, async () => {
    const r = await textoDeLei({ diploma: "CPC", dispositivo: "art. 85, caput" }, { cliente: clienteDaLegislacao() });

    expect(r.resultado).toBe("encontrado");
    if (r.resultado !== "encontrado") return;
    expect(r.urlOficial).toMatch(/^https:\/\/normas\.leg\.br\/\?urn=urn:lex:br:federal:lei:2015-03-16;13105!art85/);
    expect(r.partes[0].texto).toMatch(/honorários ao advogado do vencedor/);
    expect(r.aviso).toMatch(/não afirma vigência/);
  });
});

/**
 * Um GET por endereço nesta execução: cada diploma sai uma vez (o JSON da norma e o HTML da compilação, 2 chamadas
 * pelo cliente com os freios), e as outras consultas ao mesmo diploma leem os bytes dessa ida.
 */
function umaIdaPorEndereco() {
  const idas = new Map<string, Promise<{ status: number; headers: Headers; corpo: ArrayBuffer }>>();
  const rede: string[] = [];
  const buscar = (async (url: string, init?: RequestInit) => {
    let ida = idas.get(url);
    if (!ida) {
      rede.push(url);
      ida = fetch(url, init).then(async (r) => ({ status: r.status, headers: r.headers, corpo: await r.arrayBuffer() }));
      idas.set(url, ida);
    }
    const { status, headers, corpo } = await ida;
    return new Response(status >= 300 && status < 400 ? null : corpo.slice(0), { status, headers });
  }) as typeof fetch;
  return { cliente: clienteDaLegislacao({ fetch: buscar }), rede };
}

// Teste ao vivo opcional do B1.4: CP, CPP, CLT e CDC lidos da compilação "Current", um caso de cada armadilha.
// 8 chamadas (2 por diploma), ~4,3 MB. Só com GARIMPO_VIVO=1.
describe.skipIf(process.env.GARIMPO_VIVO !== "1")("texto_de_lei — compilação ao vivo (B1.4)", () => {
  // Nasce no primeiro teste, depois do preparo (pasta de dados temporária), nunca na coleta: a coordenação padrão
  // guarda a pasta quando nasce.
  let ida: ReturnType<typeof umaIdaPorEndereco> | undefined;
  const consultar = (diploma: string, dispositivo: string) =>
    textoDeLei({ diploma, dispositivo }, { cliente: (ida ??= umaIdaPorEndereco()).cliente });
  const encontrado = async (diploma: string, dispositivo: string) => {
    const r = await consultar(diploma, dispositivo);
    if (r.resultado !== "encontrado") throw new Error(`${diploma} ${dispositivo}: esperava encontrado, veio ${r.resultado}`);
    return r;
  };
  const marcaDaFonte = (r: RespostaTextoDeLei, urn: string) => {
    if (r.resultado !== "encontrado") throw new Error("esperava encontrado");
    expect(r.urlOficial).toBe(`https://normas.leg.br/?urn=${urn}`);
    expect(r.arquivoDaFonte).toMatchObject({ versaoNaFonte: "Current", valorLegalMarcadoPelaFonte: "UnofficialLegalValue" });
    expect(r.arquivoDaFonte?.url).toMatch(/^https:\/\/normas\.leg\.br\/api\/public\/binario\/[0-9a-f-]{36}\/texto$/);
    expect(r.aviso).toMatch(/^texto conforme a página oficial em \d{2}\/\d{2}\/\d{4}; o Garimpo não afirma vigência$/);
  };

  it("CP: sufixo duplo, rubricas fora, pena do § depois dos incisos, número ilegível e fim no fecho", { timeout: 180_000 }, async () => {
    const ma = await encontrado("CP", "art. 359-M-A");
    marcaDaFonte(ma, "urn:lex:br:federal:decreto.lei:1940-12-07;2848");
    expect(ma.partes).toHaveLength(1);
    expect(ma.partes[0]).toMatchObject({ dispositivo: "art. 359-M-A, caput", rotuloNaFonte: "Art. 359-M-A." });
    expect(ma.partes[0].texto).toMatch(/^Quando os delitos deste Capítulo estão inseridos no mesmo contexto/);
    expect((await encontrado("CP", "art. 359-M")).partes[0].texto).toMatch(/^Tentar depor, por meio de violência ou grave ameaça/);
    expect((await encontrado("CP", "art. 359-M")).partes[0].texto).not.toMatch(/Quando os delitos deste Capítulo/);

    const homicidio = await encontrado("CP", "art. 121");
    expect(homicidio.partes[0]).toMatchObject({ dispositivo: "art. 121, caput", texto: "Matar alguém:\nPena - reclusão, de seis a vinte anos." });
    const x = homicidio.partes.findIndex((p) => p.dispositivo === "art. 121, § 2º, inciso X");
    expect(homicidio.partes[x + 1]).toEqual({ dispositivo: "art. 121, § 2º", texto: "Pena - reclusão, de doze a trinta anos." });
    expect(homicidio.partes.map((p) => p.texto).join("\n")).not.toMatch(/Homicídio qualificado|Caso de diminuição de pena|\(Nome jurídico/);
    const bullying = await encontrado("CP", "art. 146-A");
    expect(bullying.partes.map((p) => p.dispositivo)).toEqual(["art. 146-A, caput", "art. 146-A, parágrafo único"]);
    expect(bullying.partes.map((p) => p.texto).join("\n")).not.toMatch(/Intimidação sistemática|Nome jurídico|Ameaça$/m);

    // "Art. l97." na fonte: o art. 196 não leva o texto dele; pelo número, não verificado (ou, se a fonte corrigir, o texto certo).
    expect((await encontrado("CP", "art. 196")).partes.map((p) => p.texto).join("\n")).not.toMatch(/Constranger alguém/);
    const r197 = await consultar("CP", "art. 197");
    if (r197.resultado === "encontrado") expect(r197.partes[0].texto).toMatch(/^Constranger alguém, mediante violência ou grave ameaça/);
    else expect(r197.resultado).toBe("não verificado");

    expect((await encontrado("CP", "art. 361")).partes).toEqual([
      { dispositivo: "art. 361, caput", rotuloNaFonte: "Art. 361.", texto: "Este Código entrará em vigor no dia 1º de janeiro de 1942." },
    ]);
  });

  it("CPP: faixa 'Arts. 498 a 502.', juramento e quesito sem rótulo, rubrica fora", { timeout: 180_000 }, async () => {
    const faixa = await encontrado("CPP", "art. 500");
    marcaDaFonte(faixa, "urn:lex:br:federal:decreto.lei:1941-10-03;3689");
    expect(faixa.partes).toHaveLength(1);
    expect(faixa.partes[0]).toMatchObject({ dispositivo: "art. 500", rotuloNaFonte: "Arts. 498 a 502." });
    expect(faixa.partes[0].texto).toMatch(/^\(Revogados pela Lei nº 11\.719/);
    expect(faixa.partes[0].observacao).toMatch(/num só parágrafo/);

    const juramento = await encontrado("CPP", "art. 472");
    expect(juramento.partes[0].texto).toMatch(/exortação:\nEm nome da lei, concito-vos[\s\S]*\nAssim o prometo\./);
    expect((await encontrado("CPP", "art. 483, § 2º")).partes[0].texto).toMatch(/\nO jurado absolve o acusado\?/);
    expect((await encontrado("CPP", "art. 3º")).partes.map((p) => p.texto).join("\n")).not.toMatch(/Juiz das Garantias/);
  });

  it("CLT: arts. 1º e 2º da Consolidação, alínea direto no caput e no §, tabela, faixa, § com número ilegível, hífen invisível", { timeout: 180_000 }, async () => {
    const empregador = await encontrado("CLT", "art. 2º");
    marcaDaFonte(empregador, "urn:lex:br:federal:decreto.lei:1943-05-01;5452");
    expect(empregador.partes[0].texto).toMatch(/^Considera-se empregador a empresa individual ou coletiva/);
    expect((await encontrado("CLT", "art. 1º")).partes[0].texto).toMatch(/^Esta Consolidação estatui as normas/);

    expect((await encontrado("CLT", "art. 482, alínea a")).partes).toEqual([
      { dispositivo: "art. 482, caput, alínea a", rotuloNaFonte: "a)", texto: "ato de improbidade;" },
    ]);
    expect((await encontrado("CLT", "art. 443, § 2º, a")).partes[0]).toMatchObject({ dispositivo: "art. 443, § 2º, alínea a", rotuloNaFonte: "a)" });

    const tabela = (await encontrado("CLT", "art. 580, inciso III")).partes[0].texto!;
    expect(tabela).toMatch(/tabela progressiva:\nCLASSE DE CAPITAL\nALÍQUOTA\n1 - até 150 vezes/);
    expect(tabela).toMatch(/\n0,02%\n\(Inciso acrescido pela Lei nº 6\.386/);

    expect((await encontrado("CLT", "art. 23")).partes[0]).toMatchObject({ rotuloNaFonte: "Arts. 22 a 24." });
    expect((await encontrado("CLT", "art. 168, inciso I")).partes[0]).toMatchObject({ rotuloNaFonte: "I -", texto: expect.stringMatching(/^na admissão;/) });

    // "§ lº" na fonte: encerra o inciso XIV e vem como parte própria (com número ilegível, ou "§ 1º" se a fonte corrigir).
    const presidentes = await encontrado("CLT", "art. 682");
    const xiv = presidentes.partes.findIndex((p) => p.dispositivo === "art. 682, caput, inciso XIV");
    expect(presidentes.partes[xiv].texto).not.toMatch(/Na falta ou impedimento/);
    expect(presidentes.partes[xiv + 1].texto).toMatch(/^Na falta ou impedimento do presidente da Junta/);
    expect(presidentes.partes[xiv + 1].dispositivo).toMatch(/^art\. 682, § (lº \(número ilegível na fonte\)|1º)$/);

    expect((await encontrado("CLT", "art. 922")).partes.map((p) => p.dispositivo)).toEqual(["art. 922, caput"]);
  });

  it("CDC: texto de outra lei entre aspas abertas, pena e fim no fecho; 8 chamadas no total", { timeout: 180_000 }, async () => {
    const citado = await encontrado("CDC", "art. 113");
    marcaDaFonte(citado, "urn:lex:br:federal:lei:1990-09-11;8078");
    expect(citado.partes).toHaveLength(1);
    expect(citado.partes[0].texto).toMatch(/\n"§ 4º [\s\S]*\n§ 5º [\s\S]*\n§ 6º [\s\S]*extrajudicial\."$/);
    expect((await consultar("CDC", "art. 113, § 5º")).resultado).toBe("não verificado");

    expect((await encontrado("CDC", "art. 63")).partes[0].texto).toMatch(/\nPena - Detenção de seis meses a dois anos e multa\.$/);
    expect((await encontrado("CDC", "art. 119")).partes).toEqual([
      { dispositivo: "art. 119, caput", rotuloNaFonte: "Art. 119.", texto: "Revogam-se as disposições em contrário." },
    ]);

    expect(ida?.rede).toHaveLength(8);
  });
});
