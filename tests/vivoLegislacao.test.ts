import { describe, expect, it } from "vitest";
import { type OpcoesCliente, Vagas } from "../src/cliente.js";
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
 * Um GET aceito por endereço nesta execução: cada diploma sai uma vez (o JSON da norma e o HTML da compilação, 2
 * chamadas pelo cliente com os freios), e as outras consultas ao mesmo diploma leem os bytes dessa ida. Só a resposta
 * aceita (2xx) fica guardada: recusa (429/503), outro erro HTTP e falha de rede passam como vieram, e a nova tentativa
 * do cliente (regra 3) vai de fato à rede.
 */
function umaIdaPorEndereco(transporte: typeof fetch = fetch, extra: Partial<OpcoesCliente> = {}) {
  const aceitas = new Map<string, { status: number; headers: Headers; corpo: ArrayBuffer }>();
  /** Todas as idas à rede, com as novas tentativas. */
  const idas: string[] = [];
  const buscar = (async (url: string, init?: RequestInit) => {
    let aceita = aceitas.get(url);
    if (!aceita) {
      idas.push(url);
      const resposta = await transporte(url, init);
      if (!resposta.ok) return resposta;
      aceita = { status: resposta.status, headers: resposta.headers, corpo: await resposta.arrayBuffer() };
      aceitas.set(url, aceita);
    }
    return new Response(aceita.corpo.slice(0), { status: aceita.status, headers: aceita.headers });
  }) as typeof fetch;
  return { cliente: clienteDaLegislacao({ ...extra, fetch: buscar }), aceitas, idas };
}

describe("texto_de_lei — o auxiliar do teste ao vivo, sem rede", () => {
  const ENDERECO = "https://normas.leg.br/api/public/binario/1cc33b77-e5a0-4723-b7fa-ec501fd65c46/texto";

  /** Transporte falso: entrega as respostas (ou falhas) na ordem e conta as idas. */
  function transporteFalso(...respostas: (Response | Error)[]) {
    const falso = { idas: 0 };
    const transporte = (async () => {
      falso.idas++;
      const r = respostas.shift();
      if (!r) throw new Error("sem resposta gravada");
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch;
    return { transporte, falso };
  }

  /** Freios do cliente com relógio falso: a espera depois da recusa e o 1 s entre chamadas não dormem de verdade. */
  function freiosDeTeste(): Partial<OpcoesCliente> {
    const relogio = { agora: 1_000_000 };
    return {
      vagas: new Vagas(2),
      agora: () => relogio.agora,
      esperar: async (ms) => {
        relogio.agora += ms;
      },
    };
  }

  it.each([429, 503])("a recusa %i não fica guardada: a nova tentativa do cliente vai à rede, e só a aceita é reaproveitada", async (status) => {
    const { transporte, falso } = transporteFalso(new Response("recusa", { status }), new Response("texto da norma", { status: 200 }));
    const { cliente, aceitas, idas } = umaIdaPorEndereco(transporte, freiosDeTeste());

    const primeira = await cliente.requisitar(ENDERECO);
    expect(primeira.status).toBe(200);
    expect(await primeira.text()).toBe("texto da norma");
    expect(falso.idas).toBe(2);

    expect(await (await cliente.requisitar(ENDERECO)).text()).toBe("texto da norma");
    expect(falso.idas).toBe(2);
    expect(idas).toEqual([ENDERECO, ENDERECO]);
    expect(aceitas.size).toBe(1);
  });

  it("falha de rede não fica guardada: a consulta seguinte vai à rede de novo", async () => {
    const { transporte, falso } = transporteFalso(new TypeError("fetch failed"), new Response("texto da norma", { status: 200 }));
    const { cliente } = umaIdaPorEndereco(transporte, freiosDeTeste());

    await expect(cliente.requisitar(ENDERECO)).rejects.toThrow(/Não foi possível falar com o normas\.leg\.br/i);
    expect(await (await cliente.requisitar(ENDERECO)).text()).toBe("texto da norma");
    expect(falso.idas).toBe(2);
  });
});

// Teste ao vivo opcional do B1.4: CP, CPP, CLT e CDC lidos da compilação "Current", um caso de cada armadilha.
// 8 endereços (2 por diploma), ~4,3 MB; a nova tentativa depois de 429/503, se houver, é uma ida a mais. Só com
// GARIMPO_VIVO=1.
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

  it("CDC: texto de outra lei entre aspas abertas, pena e fim no fecho; 8 endereços, cada um aceito uma vez", { timeout: 180_000 }, async () => {
    const citado = await encontrado("CDC", "art. 113");
    marcaDaFonte(citado, "urn:lex:br:federal:lei:1990-09-11;8078");
    expect(citado.partes).toHaveLength(1);
    expect(citado.partes[0].texto).toMatch(/\n"§ 4º [\s\S]*\n§ 5º [\s\S]*\n§ 6º [\s\S]*extrajudicial\."$/);
    expect((await consultar("CDC", "art. 113, § 5º")).resultado).toBe("não verificado");

    expect((await encontrado("CDC", "art. 63")).partes[0].texto).toMatch(/\nPena - Detenção de seis meses a dois anos e multa\.$/);
    expect((await encontrado("CDC", "art. 119")).partes).toEqual([
      { dispositivo: "art. 119, caput", rotuloNaFonte: "Art. 119.", texto: "Revogam-se as disposições em contrário." },
    ]);

    // 8 endereços, cada um aceito uma vez (2 por diploma); a nova tentativa depois de 429/503, se houver, conta à parte.
    expect(ida?.aceitas.size).toBe(8);
    expect(new Set(ida?.idas).size).toBe(8);
  });
});
