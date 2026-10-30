import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FormatoInesperadoError, Vagas } from "../src/cliente.js";
import { clienteDaLegislacao, textoDeLei } from "../src/legislacao.js";
import { Memoria } from "../src/memoria.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

// Gravações do normas.leg.br obtidas em 23/10/2026 (B1.4): a resposta da norma (`<sigla>-norma.json`, maior-detalhe) e o
// recorte do HTML da compilação que ela marca como "Current" (`<sigla>-compilacao-recorte.html`): a marcação da fonte
// nos trechos das armadilhas, um elemento por linha, sem o <head> com nome de pessoa, sem o brasão e sem as assinaturas.
// Os textos esperados são literais copiados dessas páginas, não calculados pelo código.
const html = (sigla: string) =>
  readFileSync(new URL(`./fixtures/legislacao/${sigla}-compilacao-recorte.html`, import.meta.url), "utf8");
const respostaHtml = (corpo: string) => new Response(corpo, { headers: { "content-type": "text/html" } });
const AGORA = new Date(2026, 9, 23, 10, 30).getTime();

interface Variante {
  diploma?: string;
  norma?: unknown;
  texto?: string;
}

async function consultar(sigla: string, dispositivo: string, { diploma = sigla.toUpperCase(), norma, texto }: Variante = {}) {
  const { cliente, chamadas } = clienteFalso([
    respostaJson(norma ?? fixture(`legislacao/${sigla}-norma.json`)),
    respostaHtml(texto ?? html(sigla)),
  ]);
  const r = await textoDeLei({ diploma, dispositivo }, { cliente, agora: () => AGORA });
  return { r, chamadas };
}

/** O recorte com um parágrafo a mais, sintético, logo antes do fim do arquivo (onde a fonte põe as assinaturas). */
const comParagrafoNoFim = (sigla: string, texto: string) =>
  html(sigla).replace("</div></body>", `<p><span>${texto}</span></p>\n</div></body>`);

describe("texto_de_lei — compilação do normas.leg.br (CP, CPP, CLT, CDC)", () => {
  it("CDC art. 1º: o caput literal do HTML 'Current', com a URL da norma, o arquivo lido e a marca de valor legal da fonte", async () => {
    const { r, chamadas } = await consultar("cdc", "art. 1º");

    expect(chamadas.map((c) => c.url)).toEqual([
      "https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:lei:1990-09-11;8078&&tipo_documento=maior-detalhe",
      "https://normas.leg.br/api/public/binario/1cc33b77-e5a0-4723-b7fa-ec501fd65c46/texto",
    ]);
    expect(chamadas.map((c) => c.init.redirect)).toEqual(["manual", "manual"]);
    if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);
    expect(r.diploma).toEqual({ sigla: "CDC", nome: "Lei nº 8.078, de 11 de setembro de 1990" });
    expect(r.dispositivo).toBe("art. 1º");
    expect(r.urlOficial).toBe("https://normas.leg.br/?urn=urn:lex:br:federal:lei:1990-09-11;8078");
    expect(r.arquivoDaFonte).toEqual({
      url: "https://normas.leg.br/api/public/binario/1cc33b77-e5a0-4723-b7fa-ec501fd65c46/texto",
      versaoNaFonte: "Current",
      tipoNaFonte: "CompilacaoMonoVigenteNaCD",
      valorLegalMarcadoPelaFonte: "UnofficialLegalValue",
    });
    expect(r.partes).toEqual([
      {
        dispositivo: "art. 1º, caput",
        rotuloNaFonte: "Art. 1º",
        texto:
          "O presente código estabelece normas de proteção e defesa do consumidor, de ordem pública e interesse social, nos termos dos arts. 5º, inciso XXXII, 170, inciso V, da Constituição Federal e art. 48 de suas Disposições Transitórias.",
      },
    ]);
    expect(r.versaoDaFonte).toEqual({ publicadaEm: "2026-10-09" });
    expect(r.aviso).toBe("texto conforme a página oficial em 23/10/2026; o Garimpo não afirma vigência");
  });

  it("pelo artigo inteiro, o caput e o parágrafo único na ordem da fonte; pelo parágrafo único, só ele", async () => {
    const artigo = await encontrado("cdc", "art. 2º");
    expect(artigo.partes).toEqual([
      {
        dispositivo: "art. 2º, caput",
        rotuloNaFonte: "Art. 2º",
        texto: "Consumidor é toda pessoa física ou jurídica que adquire ou utiliza produto ou serviço como destinatário final.",
      },
      {
        dispositivo: "art. 2º, parágrafo único",
        rotuloNaFonte: "Parágrafo único.",
        texto:
          "Equipara-se a consumidor a coletividade de pessoas, ainda que indetermináveis, que haja intervindo nas relações de consumo.",
      },
    ]);

    const unico = await encontrado("cdc", "art. 2º, parágrafo único");
    expect(unico.partes.map((p) => p.dispositivo)).toEqual(["art. 2º, parágrafo único"]);
  });

  it("acha o § e o inciso com as alíneas penduradas nele", async () => {
    const paragrafo = await encontrado("cdc", "art. 3º, § 1º");
    expect(paragrafo.partes).toEqual([
      { dispositivo: "art. 3º, § 1º", rotuloNaFonte: "§ 1º", texto: "Produto é qualquer bem, móvel ou imóvel, material ou imaterial." },
    ]);

    const inciso = await encontrado("cdc", "art. 4º, inciso II");
    expect(inciso.partes.map((p) => [p.dispositivo, p.rotuloNaFonte])).toEqual([
      ["art. 4º, caput, inciso II", "II -"],
      ["art. 4º, caput, inciso II, alínea a", "a)"],
      ["art. 4º, caput, inciso II, alínea b", "b)"],
      ["art. 4º, caput, inciso II, alínea c", "c)"],
      ["art. 4º, caput, inciso II, alínea d", "d)"],
    ]);
    expect(inciso.partes[0].texto).toBe("ação governamental no sentido de proteger efetivamente o consumidor:");

    const alinea = await encontrado("cdc", "art. 4º, II, d");
    expect(alinea.partes).toEqual([
      {
        dispositivo: "art. 4º, caput, inciso II, alínea d",
        rotuloNaFonte: "d)",
        texto: "pela garantia dos produtos e serviços com padrões adequados de qualidade, segurança, durabilidade e desempenho.",
      },
    ]);
  });

  it("o cabeçalho estrutural (CAPÍTULO, TÍTULO e o nome dele) encerra o artigo anterior", async () => {
    const terceiro = await encontrado("cdc", "art. 3º");
    expect(terceiro.partes.map((p) => p.dispositivo)).toEqual(["art. 3º, caput", "art. 3º, § 1º", "art. 3º, § 2º"]);
    expect(terceiro.partes[2].texto).toBe(
      "Serviço é qualquer atividade fornecida no mercado de consumo, mediante remuneração, inclusive as de natureza bancária, financeira, de crédito e securitária, salvo as decorrentes das relações de caráter trabalhista.",
    );

    const quarto = await encontrado("cdc", "art. 4º");
    expect(quarto.partes.at(-1)).toEqual({
      dispositivo: "art. 4º, caput, inciso X",
      rotuloNaFonte: "X -",
      texto:
        "prevenção e tratamento do superendividamento como forma de evitar a exclusão social do consumidor. (Inciso acrescido pela Lei nº 14.181, de 1º/7/2021)",
    });
  });

  it("o texto acaba no fecho: o que a fonte põe depois dele (as assinaturas) não entra no último artigo", async () => {
    const { r } = await consultar("cdc", "art. 119", { texto: comParagrafoNoFim("cdc", "NOME FICTÍCIO DE QUEM ASSINA") });
    if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);

    expect(r.partes).toEqual([{ dispositivo: "art. 119, caput", rotuloNaFonte: "Art. 119.", texto: "Revogam-se as disposições em contrário." }]);
  });
});

describe("texto_de_lei — Código Penal: rubricas e penas", () => {
  it("lê o CP do arquivo da compilação dele, pela sigla, pelo nome ou pelo número do decreto-lei", async () => {
    for (const diploma of ["CP", "Código Penal", "Decreto-Lei 2.848/1940"]) {
      const { r, chamadas } = await consultar("cp", "art. 1º", { diploma });
      expect(r.diploma).toEqual({ sigla: "CP", nome: "Decreto-Lei nº 2.848, de 07 de dezembro de 1940" });
      expect(chamadas.map((c) => c.url)).toEqual([
        "https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:decreto.lei:1940-12-07;2848&&tipo_documento=maior-detalhe",
        "https://normas.leg.br/api/public/binario/412689ff-f565-494a-9adb-8301e314f40d/texto",
      ]);
    }
  });

  it("a rubrica solta (o nome jurídico) e a nota dela entre parênteses ficam fora do texto; a pena fica no caput ou no §", async () => {
    const r = await encontrado("cp", "art. 146-A");

    expect(r.partes).toEqual([
      {
        dispositivo: "art. 146-A, caput",
        rotuloNaFonte: "Art. 146-A.",
        texto:
          "Intimidar sistematicamente, individualmente ou em grupo, mediante violência física ou psicológica, uma ou mais pessoas, de modo intencional e repetitivo, sem motivação evidente, por meio de atos de intimidação, de humilhação ou de discriminação ou de ações verbais, morais, sexuais, sociais, psicológicas, físicas, materiais ou virtuais:\n" +
          "Pena - multa, se a conduta não constituir crime mais grave. (“Caput” do artigo acrescido pela Lei nº 14.811, de 12/1/2024)",
      },
      {
        dispositivo: "art. 146-A, parágrafo único",
        rotuloNaFonte: "Parágrafo único.",
        texto:
          "Se a conduta é realizada por meio da rede de computadores, de rede social, de aplicativos, de jogos on-line ou por qualquer outro meio ou ambiente digital, ou transmitida em tempo real:\n" +
          "Pena - reclusão, de 2 (dois) anos a 4 (quatro) anos, e multa, se a conduta não constituir crime mais grave. (Parágrafo único acrescido pela Lei nº 14.811, de 12/1/2024)",
      },
    ]);
  });

  it("art. 121: a pena depois do último inciso é do § 2º, numa parte própria, na ordem da fonte; as rubricas do meio ficam fora", async () => {
    const r = await encontrado("cp", "art. 121");

    expect(r.partes[0]).toEqual({ dispositivo: "art. 121, caput", rotuloNaFonte: "Art. 121.", texto: "Matar alguém:\nPena - reclusão, de seis a vinte anos." });
    const x = r.partes.findIndex((p) => p.dispositivo === "art. 121, § 2º, inciso X");
    expect(r.partes[x + 1]).toEqual({ dispositivo: "art. 121, § 2º", texto: "Pena - reclusão, de doze a trinta anos." });
    expect(r.partes[x + 2].dispositivo).toBe("art. 121, § 2º-A");
    expect(r.partes.find((p) => p.dispositivo === "art. 121, § 2º-D")?.texto).toBe(
      "Se o homicídio doloso é cometido por integrante de organização criminosa ultraviolenta, grupo paramilitar ou milícia privada, no contexto da atuação ou para a consecução das condutas previstas no art. 2º da lei que institui o marco legal do combate ao crime organizado no Brasil.\n" +
        "Pena - reclusão, de 20 (vinte) a 40 (quarenta anos). (Parágrafo acrescido pela Lei nº 15.358, de 24/3/2026)",
    );
    const textos = r.partes.map((p) => p.texto).join("\n");
    for (const rubrica of ["Caso de diminuição de pena", "Homicídio qualificado", "Feminicídio", "(Nome jurídico", "Homicídio culposo", "Aumento de pena"]) {
      expect(textos).not.toContain(rubrica);
    }
    expect(r.partes.at(-1)?.dispositivo).toBe("art. 121, § 7º");
  });

  it("pelo inciso, sem a pena do §; pelo §, a pena vem depois dos incisos", async () => {
    const inciso = await encontrado("cp", "art. 121, § 2º, inciso X");
    expect(inciso.partes).toEqual([
      {
        dispositivo: "art. 121, § 2º, inciso X",
        rotuloNaFonte: "X -",
        texto: "nas dependências de instituição de ensino: (Inciso acrescido pela Lei nº 15.159, de 3/7/2025)",
      },
    ]);

    const paragrafo = await encontrado("cp", "art. 121, § 2º");
    expect(paragrafo.partes[0]).toEqual({ dispositivo: "art. 121, § 2º", rotuloNaFonte: "§ 2º", texto: "Se o homicídio é cometido:" });
    expect(paragrafo.partes.at(-1)).toEqual({ dispositivo: "art. 121, § 2º", texto: "Pena - reclusão, de doze a trinta anos." });
  });
});

describe("texto_de_lei — Código Penal: sufixo duplo", () => {
  it("art. 359-M-A e 359-M-B são artigos próprios, separados do 359-M", async () => {
    const m = await encontrado("cp", "art. 359-M");
    expect(m.partes).toEqual([
      {
        dispositivo: "art. 359-M, caput",
        rotuloNaFonte: "Art. 359-M.",
        texto:
          "Tentar depor, por meio de violência ou grave ameaça, o governo legitimamente constituído:\n" +
          "Pena - reclusão, de 4 (quatro) a 12 (doze) anos, além da pena correspondente à violência. (Artigo acrescido pela Lei nº 14.197, de 1º/9/2021, publicada no DOU de 2/9/2021, em vigor 90 dias após a publicação)",
      },
    ]);

    const ma = await encontrado("cp", "art. 359-M-A");
    expect(ma.dispositivo).toBe("art. 359-M-A");
    expect(ma.partes).toEqual([
      {
        dispositivo: "art. 359-M-A, caput",
        rotuloNaFonte: "Art. 359-M-A.",
        texto:
          "Quando os delitos deste Capítulo estão inseridos no mesmo contexto, a pena deverá ser aplicada, ainda que existente desígnio autônomo, na forma do concurso formal próprio de que trata a primeira parte do art. 70, vedando-se a aplicação do cômputo cumulativo previsto na segunda parte desse dispositivo e no art. 69, todos deste Código. (Artigo acrescido pela Lei nº 15.402, de 8/5/2026)",
      },
    ]);

    const mb = await encontrado("cp", "art. 359-M-B");
    expect(mb.partes[0].texto).toMatch(/^Quando os crimes previstos neste Capítulo forem praticados em contexto de multidão/);
  });
});

describe("texto_de_lei — CLT", () => {
  it("o texto começa em 'CONSOLIDAÇÃO DAS LEIS DO TRABALHO': os arts. 1º e 2º são os da CLT, não os do decreto-lei que a aprova", async () => {
    const { r, chamadas } = await consultar("clt", "art. 2º");
    expect(chamadas[1].url).toBe("https://normas.leg.br/api/public/binario/5e35b26e-26a7-44d7-8a95-b8f0852cabe1/texto");
    if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);
    expect(r.diploma).toEqual({ sigla: "CLT", nome: "Decreto-Lei nº 5.452, de 01 de maio de 1943" });
    expect(r.partes.map((p) => p.dispositivo)).toEqual(["art. 2º, caput", "art. 2º, § 1º", "art. 2º, § 2º", "art. 2º, § 3º"]);
    expect(r.partes[0].texto).toBe(
      "Considera-se empregador a empresa individual ou coletiva, que, assumindo os riscos de atividade econômica, admite, assalaria e dirige a prestação pessoal de serviços.",
    );

    const primeiro = await encontrado("clt", "art. 1º");
    expect(primeiro.partes).toEqual([
      {
        dispositivo: "art. 1º, caput",
        rotuloNaFonte: "Art. 1º",
        texto: "Esta Consolidação estatui as normas que regulam as relações individuais e coletivas de trabalho nela previstas.",
      },
    ]);
  });

  it("sem o parágrafo 'CONSOLIDAÇÃO DAS LEIS DO TRABALHO', é formato inesperado (não lê os artigos do decreto-lei como da CLT)", async () => {
    // O <title> do <head> tem o mesmo texto, mas só o parágrafo do corpo marca o começo.
    const texto = html("clt").replace(">CONSOLIDAÇÃO DAS LEIS DO TRABALHO</span>", ">CONSOLIDAÇÃO</span>");
    expect(texto).not.toBe(html("clt"));
    const { cliente } = clienteFalso([respostaJson(fixture("legislacao/clt-norma.json")), respostaHtml(texto)]);
    await expect(textoDeLei({ diploma: "CLT", dispositivo: "art. 2º" }, { cliente })).rejects.toBeInstanceOf(FormatoInesperadoError);
  });

  it("só pela sigla ou pelo nome: o número do decreto-lei (que tem artigos próprios) não é aceito como CLT", async () => {
    expect((await encontrado("clt", "art. 1º", { diploma: "Consolidação das Leis do Trabalho" })).diploma.sigla).toBe("CLT");
    const { cliente, chamadas } = clienteFalso([]);
    await expect(textoDeLei({ diploma: "Decreto-Lei 5.452/1943", dispositivo: "art. 1º" }, { cliente })).rejects.toThrow(
      /não reconheceu o diploma "Decreto-Lei 5\.452\/1943"/,
    );
    expect(chamadas).toHaveLength(0);
  });

  it("alínea direto no caput (art. 482) ou no § (art. 443, § 2º), sem inciso", async () => {
    const artigo = await encontrado("clt", "art. 482");
    expect(artigo.partes.map((p) => p.rotuloNaFonte)).toEqual([
      "Art. 482.", "a)", "b)", "c)", "d)", "e)", "f)", "g)", "h)", "i)", "j)", "k)", "l)", "m)", "Parágrafo único.",
    ]);
    expect(artigo.partes[0].texto).toBe("Constituem justa causa para rescisão do contrato de trabalho pelo empregador:");

    const a = await encontrado("clt", "art. 482, alínea a");
    expect(a.partes).toEqual([{ dispositivo: "art. 482, caput, alínea a", rotuloNaFonte: "a)", texto: "ato de improbidade;" }]);

    const doParagrafo = await encontrado("clt", "art. 443, § 2º, a");
    expect(doParagrafo.partes).toEqual([
      {
        dispositivo: "art. 443, § 2º, alínea a",
        rotuloNaFonte: "a)",
        texto: "de serviço cuja natureza ou transitoriedade justifique a predeterminação do prazo;",
      },
    ]);
  });
});

describe("texto_de_lei — faixa de artigos num parágrafo só ('Arts. 498 a 502.')", () => {
  it("CPP art. 500: o parágrafo da faixa, literal, com a observação de que a fonte junta os artigos", async () => {
    const { r, chamadas } = await consultar("cpp", "art. 500");
    expect(chamadas[1].url).toBe("https://normas.leg.br/api/public/binario/f673d457-87d9-45cb-b467-a3d59aaaad4e/texto");
    if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);
    expect(r.partes).toEqual([
      {
        dispositivo: "art. 500",
        rotuloNaFonte: "Arts. 498 a 502.",
        texto: "(Revogados pela Lei nº 11.719, de 20/6/2008, publicada no DOU de 23/6/2008, em vigor 60 dias após a publicação)",
        observacao: "A fonte traz os arts. 498 a 502 num só parágrafo; o texto é o dele.",
      },
    ]);
    expect((await encontrado("cpp", "art. 498")).partes[0].rotuloNaFonte).toBe("Arts. 498 a 502.");
    expect((await encontrado("cpp", "art. 502")).partes[0].rotuloNaFonte).toBe("Arts. 498 a 502.");
  });

  it("dispositivo dentro de artigo da faixa, ou artigo fora dela: não verificado", async () => {
    expect((await consultar("cpp", "art. 500, § 1º")).r.resultado).toBe("não verificado");
    expect((await consultar("cpp", "art. 503")).r.resultado).toBe("não verificado");
  });

  it("CLT art. 23: a faixa acaba no cabeçalho da seção seguinte", async () => {
    const r = await encontrado("clt", "art. 23");
    expect(r.partes).toEqual([
      {
        dispositivo: "art. 23",
        rotuloNaFonte: "Arts. 22 a 24.",
        texto: "(Revogados pelo Decreto-Lei nº 926, de 10/10/1969)",
        observacao: "A fonte traz os arts. 22 a 24 num só parágrafo; o texto é o dele.",
      },
    ]);
  });
});

describe("texto_de_lei — rótulo com número ilegível na fonte ('Art. l97.', '§ lº')", () => {
  it("CLT art. 682: o '§ lº' encerra o inciso XIV e entra no artigo como parte própria, sem número lido", async () => {
    const inciso = await encontrado("clt", "art. 682, inciso XIV");
    expect(inciso.partes).toEqual([
      {
        dispositivo: "art. 682, caput, inciso XIV",
        rotuloNaFonte: "XIV -",
        texto: "assinar as folhas de pagamento dos vogais e servidores do Tribunal. (Inciso com redação dada pelo Decreto-Lei nº 8.737, de 19/1/1946)",
      },
    ]);

    const artigo = await encontrado("clt", "art. 682");
    expect(artigo.partes.map((p) => p.dispositivo).slice(-3)).toEqual([
      "art. 682, § lº (número ilegível na fonte)",
      "art. 682, § 2º",
      "art. 682, § 3º",
    ]);
    expect(artigo.partes.at(-3)).toMatchObject({
      rotuloNaFonte: "§ lº",
      texto: expect.stringMatching(/^Na falta ou impedimento do presidente da Junta e do substituto da mesma localidade/),
    });

    expect((await consultar("clt", "art. 682, § 1º")).r.resultado).toBe("não verificado");
  });

  it("CP 'Art. l97.': o artigo com número ilegível não se cola no anterior, e o pedido pelo número fica não verificado", async () => {
    // Variante sem o cabeçalho que separa os arts. 196 e l97 no recorte: sem ele, só o rótulo segura o limite.
    const texto = html("cp")
      .replace('<p class="BodyTextIndent" style="text-indent:0pt; text-align:center; font-size:1.2em"><span>TÍTULO IV</span></p>', "")
      .replace(
        '<p class="BodyTextIndent" style="text-indent:0pt; text-align:center; font-size:1.2em"><span>DOS CRIMES CONTRA A ORGANIZAÇÃO DO TRABALHO</span></p>',
        "",
      );
    expect(texto).not.toMatch(/TÍTULO IV/);

    const anterior = await encontrado("cp", "art. 196", { texto });
    expect(anterior.partes).toEqual([
      {
        dispositivo: "art. 196, caput",
        rotuloNaFonte: "Art. 196.",
        texto: "(Revogado pela Lei nº 9.279, de 14/5/1996, publicada no DOU de 15/5/1996, em vigor 1 ano após a publicação)",
      },
    ]);

    const { r } = await consultar("cp", "art. 197");
    expect(r.resultado).toBe("não verificado");
  });
});

describe("texto_de_lei — texto de outra lei entre aspas (CDC, arts. 110 e seguintes)", () => {
  it("art. 113: as aspas abertas no § 4º só fecham no § 6º; os três §§ citados são texto do caput, não §§ do CDC", async () => {
    const r = await encontrado("cdc", "art. 113");
    expect(r.partes).toEqual([
      {
        dispositivo: "art. 113, caput",
        rotuloNaFonte: "Art. 113.",
        texto:
          "Acrescente-se os seguintes §§ 4º, 5º e 6º ao art. 5º da Lei nº 7.347, de 24 de julho de 1985:\n" +
          '"§ 4º O requisito da pré-constituição poderá ser dispensado pelo juiz, quando haja manifesto interesse social evidenciado pela dimensão ou característica do dano, ou pela relevância do bem jurídico a ser protegido.\n' +
          "§ 5º Admitir-se-á o litisconsórcio facultativo entre os Ministérios Públicos da União, do Distrito Federal e dos Estados na defesa dos interesses e direitos de que cuida esta lei.\n" +
          '§ 6º Os órgãos públicos legitimados poderão tomar dos interessados compromisso de ajustamento de sua conduta às exigências legais, mediante combinações, que terá eficácia de título executivo extrajudicial."',
      },
    ]);
    expect((await consultar("cdc", "art. 113, § 5º")).r.resultado).toBe("não verificado");
    expect((await encontrado("cdc", "art. 114")).partes[0].texto).toMatch(/^O art\. 15 da Lei nº 7\.347/);
  });

  it("art. 110: o inciso citado entre aspas é texto do caput", async () => {
    const r = await encontrado("cdc", "art. 110");
    expect(r.partes).toEqual([
      {
        dispositivo: "art. 110, caput",
        rotuloNaFonte: "Art. 110.",
        texto:
          "Acrescente-se o seguinte inciso IV ao art. 1º da Lei nº 7.347, de 24 de julho de 1985:\n" +
          '"IV - a qualquer outro interesse difuso ou coletivo."',
      },
    ]);
  });
});

describe("texto_de_lei — linhas sem rótulo que são texto do dispositivo", () => {
  it("CPP art. 472: a exortação e o juramento ficam no caput", async () => {
    const r = await encontrado("cpp", "art. 472");
    expect(r.partes[0]).toEqual({
      dispositivo: "art. 472, caput",
      rotuloNaFonte: "Art. 472.",
      texto:
        "Formado o Conselho de Sentença, o presidente, levantando-se, e, com ele, todos os presentes, fará aos jurados a seguinte exortação:\n" +
        "Em nome da lei, concito-vos a examinar esta causa com imparcialidade e a proferir a vossa decisão de acordo com a vossa consciência e os ditames da justiça.\n" +
        "Os jurados, nominalmente chamados pelo presidente, responderão:\n" +
        "Assim o prometo. (“Caput” do artigo com redação dada pela Lei nº 11.689, de 9/6/2008, publicada no DOU de 10/6/2008, em vigor 60 dias após a publicação)",
    });
    expect(r.partes.map((p) => p.dispositivo)).toEqual(["art. 472, caput", "art. 472, parágrafo único"]);
  });

  it("CPP art. 483, § 2º: o quesito ('O jurado absolve o acusado?') é texto do §", async () => {
    const r = await encontrado("cpp", "art. 483, § 2º");
    expect(r.partes).toEqual([
      {
        dispositivo: "art. 483, § 2º",
        rotuloNaFonte: "§ 2º",
        texto:
          "Respondidos afirmativamente por mais de 3 (três) jurados os quesitos relativos aos incisos I e II do caput deste artigo será formulado quesito com a seguinte redação:\n" +
          "O jurado absolve o acusado? (Parágrafo acrescido pela Lei nº 11.689, de 9/6/2008, publicada no DOU de 10/6/2008, em vigor 60 dias após a publicação) (Vide ADPF nº 779/2021)",
      },
    ]);
  });

  it("CLT art. 580, inciso III: a tabela (cabeçalho, faixas e alíquotas) e a nota vêm no inciso", async () => {
    const r = await encontrado("clt", "art. 580, inciso III");
    expect(r.partes).toEqual([
      {
        dispositivo: "art. 580, caput, inciso III",
        rotuloNaFonte: "III -",
        texto: [
          "para os empregadores, numa importância proporcional ao capital social da firma ou empresa, registrado nas respectivas Juntas Comerciais ou órgãos equivalentes, mediante a aplicação de alíquotas, conforme a seguinte tabela progressiva:",
          "CLASSE DE CAPITAL",
          "ALÍQUOTA",
          "1 - até 150 vezes o maior valor-de- referência",
          "0,8%",
          "2 - acima de 150 até 1.500 vezes o maior valor-\nde-referência",
          "0,2%",
          "3 - acima de 1.500 até 150.000 vezes o\nmaior valor-de-referência",
          "0,1%",
          "4 - acima de 150.000 até 800.000 vezes o\nmaior valor-de-referência",
          "0,02%",
          "(Inciso acrescido pela Lei nº 6.386, de 9/12/1976, com redação dada pela Lei nº 7.047, de 1/12/1982)",
        ].join("\n"),
      },
    ]);
  });

  it("CLT art. 674: as 24 regiões ficam no caput; o parágrafo partido do art. 791-A fica inteiro no caput", async () => {
    const regioes = await encontrado("clt", "art. 674, caput");
    const linhas = regioes.partes[0].texto!.split("\n");
    expect(linhas).toHaveLength(25);
    expect(linhas[1]).toBe("1ª Região - Estado do Rio de Janeiro; (Lei nº 5.839, de 5/12/1972)");
    expect(linhas[24]).toBe(
      "24ª Região – Estado do Mato Grosso do Sul; (Lei nº 8.431, de 9/6/1992) (“Caput” do artigo atualizado em conformidade com as leis citadas)",
    );

    const honorarios = await encontrado("clt", "art. 791-A, caput");
    expect(honorarios.partes[0].texto).toBe(
      "Ao advogado, ainda que atue em causa própria, serão devidos honorários de sucumbência, fixados entre o mínimo de 5% (cinco por cento) e o máximo de 15% (quinze por\n" +
        "cento) sobre o valor que resultar da liquidação da sentença, do proveito econômico obtido ou, não sendo possível mensurá-lo, sobre o valor atualizado da causa.",
    );
  });

  it("CLT art. 168: o hífen invisível antes de 'I - na admissão;' não esconde o inciso", async () => {
    const r = await encontrado("clt", "art. 168, inciso I");
    expect(r.partes).toEqual([
      { dispositivo: "art. 168, caput, inciso I", rotuloNaFonte: "I -", texto: "na admissão; (Inciso acrescido pela Lei nº 7.855, de 24/10/1989)" },
    ]);
  });

  it("CP art. 359-T: o '(VETADO …)' solto depois do caput é texto dele, não nota de rubrica", async () => {
    const r = await encontrado("cp", "art. 359-T");
    expect(r.partes).toHaveLength(1);
    expect(r.partes[0].texto).toMatch(/com propósitos sociais\. \(Artigo acrescido pela Lei nº 14\.197.*\)\n\(VETADO na Lei nº 14\.197, de 1º\/9\/2021\)$/s);
  });
});

describe("texto_de_lei — compilação: identificação repetida, dispositivo sem texto, memória e freios", () => {
  it("dois artigos com a mesma identificação: identificação necessária, com o começo de cada um, sem escolher", async () => {
    // Variante sintética: o art. 2º do recorte repetido depois do art. 3º.
    const art2 = /<p[^>]*><span>Art\. 2º Consumidor[\s\S]*?<\/p>/.exec(html("cdc"))![0];
    const texto = html("cdc").replace(/(<p[^>]*><span>CAPÍTULO II<\/span><\/p>)/, `${art2}\n$1`);

    for (const dispositivo of ["art. 2º", "art. 2º, parágrafo único"]) {
      const { r } = await consultar("cdc", dispositivo, { texto });
      expect(r.resultado).toBe("identificação necessária");
      if (r.resultado !== "identificação necessária") return;
      expect(r.candidatos).toEqual([
        expect.objectContaining({ dispositivo: "art. 2º", rotuloNaFonte: "Art. 2º", urlOficial: "https://normas.leg.br/?urn=urn:lex:br:federal:lei:1990-09-11;8078" }),
        expect.objectContaining({ dispositivo: "art. 2º", rotuloNaFonte: "Art. 2º" }),
      ]);
      expect(r.candidatos[0]).toMatchObject({ textoNaFonte: expect.stringMatching(/^Consumidor é toda pessoa física/) });
    }
  });

  it("dispositivo que a fonte rotula sem texto nenhum: não verificado", async () => {
    const texto = html("cdc").replace("Art. 119. Revogam-se as disposições em contrário.", "Art. 119.");
    const { r } = await consultar("cdc", "art. 119", { texto });
    expect(r).toMatchObject({ resultado: "não verificado", motivo: "A fonte não traz texto para este dispositivo." });
  });

  it("a consulta repetida volta da memória, com o arquivo e a data da primeira obtenção, sem nova chamada", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "legislacao-compilacao-"));
    let relogio = AGORA;
    const memoria = new Memoria({ dados, agora: () => relogio });
    const { cliente, chamadas } = clienteFalso([respostaJson(fixture("legislacao/cdc-norma.json")), respostaHtml(html("cdc"))]);
    const fontes = { cliente, memoria, agora: () => relogio };

    const primeira = await textoDeLei({ diploma: "CDC", dispositivo: "art. 1º" }, fontes);
    relogio = new Date(2026, 9, 24, 9, 0).getTime();
    const segunda = await textoDeLei({ diploma: "Código de Defesa do Consumidor", dispositivo: "Art. 1º" }, fontes);

    expect(chamadas).toHaveLength(2);
    expect(segunda.obtido).toMatch(/^consulta guardada: fotografia da consulta feita no normas\.leg\.br em 23\/10\/2026/);
    if (segunda.resultado !== "encontrado" || primeira.resultado !== "encontrado") throw new Error("esperava encontrado");
    expect(segunda.partes).toEqual(primeira.partes);
    expect(segunda.arquivoDaFonte).toEqual(primeira.arquivoDaFonte);
  });

  it("as duas chamadas saem pelo cliente do normas.leg.br, com 1 s entre elas", async () => {
    const relogio = { agora: 1_000_000 };
    const esperas: number[] = [];
    const respostas = [respostaJson(fixture("legislacao/cdc-norma.json")), respostaHtml(html("cdc"))];
    const cliente = clienteDaLegislacao({
      vagas: new Vagas(2),
      agora: () => relogio.agora,
      esperar: async (ms) => {
        esperas.push(ms);
        relogio.agora += ms;
      },
      fetch: (async () => respostas.shift()!) as typeof fetch,
    });

    const r = await textoDeLei({ diploma: "CDC", dispositivo: "art. 1º" }, { cliente });

    expect(r.resultado).toBe("encontrado");
    expect(respostas).toHaveLength(0);
    expect(esperas).toEqual([1_000]);
  });

  it("diploma desconhecido: o erro lista os sete diplomas, sem chamada", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    await expect(textoDeLei({ diploma: "ECA", dispositivo: "art. 1º" }, { cliente })).rejects.toThrow(
      /Diplomas que sabe buscar: CPC, CC, CF, CP, CPP, CLT, CDC\./,
    );
    expect(chamadas).toHaveLength(0);
  });
});

describe("texto_de_lei — compilação: formato conferido, senão erro e nenhum texto", () => {
  type Norma = { legislationIdentifier: string; encoding: Record<string, unknown>[] };
  const norma = () => structuredClone(fixture("legislacao/cdc-norma.json")) as Norma;
  const atual = (n: Norma) => n.encoding.find((e) => e.version === "Current")!;

  async function recusa(variante: Variante, chamadasEsperadas: number) {
    const { cliente, chamadas } = clienteFalso([
      respostaJson(variante.norma ?? fixture("legislacao/cdc-norma.json")),
      respostaHtml(variante.texto ?? html("cdc")),
    ]);
    await expect(textoDeLei({ diploma: "CDC", dispositivo: "art. 1º" }, { cliente })).rejects.toBeInstanceOf(FormatoInesperadoError);
    expect(chamadas).toHaveLength(chamadasEsperadas);
  }

  it("sem versão 'Current', ou com duas, o Garimpo não escolhe e não baixa nada", async () => {
    const sem = norma();
    sem.encoding = sem.encoding.filter((e) => e.version !== "Current");
    await recusa({ norma: sem }, 1);

    const duas = norma();
    duas.encoding.push(structuredClone(atual(duas)));
    await recusa({ norma: duas }, 1);
  });

  it.each([
    "http://normas.leg.br/api/binario/1cc33b77-e5a0-4723-b7fa-ec501fd65c46/texto",
    "https://exemplo.invalid/api/binario/1cc33b77-e5a0-4723-b7fa-ec501fd65c46/texto",
    "https://normas.leg.br/api/binario/../../outra/texto",
    "https://normas.leg.br/api/binario/1cc33b77-e5a0-4723-b7fa-ec501fd65c46/texto?x=1",
    "/api/binario/1cc33b77-e5a0-4723-b7fa-ec501fd65c46/texto",
    undefined,
  ])("endereço do arquivo fora do formato conferido (%s): nada é baixado", async (contentUrl) => {
    const n = norma();
    atual(n).contentUrl = contentUrl;
    await recusa({ norma: n }, 1);
  });

  it("arquivo 'Current' que não é HTML não é lido", async () => {
    const n = norma();
    atual(n).encodingFormat = "http://www.iana.org/assignments/media-types/application/pdf";
    await recusa({ norma: n }, 1);
  });

  it("resposta de outra norma não é lida como o CDC", async () => {
    const n = norma();
    n.legislationIdentifier = "urn:lex:br:federal:lei:1990-07-13;8069";
    await recusa({ norma: n }, 1);
  });

  it("URL da norma que não comprova o CDC: nada é baixado", async () => {
    const n = norma() as Norma & { "@id": string };
    n["@id"] = "https://normas.leg.br/?urn=urn:lex:br:federal:lei:1990-07-13;8069";
    await recusa({ norma: n }, 1);
  });

  it("o arquivo da compilação redirecionado ou fora de HTML não é seguido nem lido", async () => {
    const { cliente, chamadas } = clienteFalso([
      respostaJson(fixture("legislacao/cdc-norma.json")),
      new Response(null, { status: 302, headers: { location: "https://exemplo.invalid/" } }),
    ]);
    await expect(textoDeLei({ diploma: "CDC", dispositivo: "art. 1º" }, { cliente })).rejects.toBeInstanceOf(FormatoInesperadoError);
    expect(chamadas.map((c) => c.init.redirect)).toEqual(["manual", "manual"]);

    const pdf = clienteFalso([
      respostaJson(fixture("legislacao/cdc-norma.json")),
      new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
    ]);
    await expect(textoDeLei({ diploma: "CDC", dispositivo: "art. 1º" }, { cliente: pdf.cliente })).rejects.toBeInstanceOf(
      FormatoInesperadoError,
    );
  });

  it("sem o parágrafo de início do diploma (ou com ele repetido) ou sem o fecho, é formato inesperado", async () => {
    const titulo = "LEI Nº 8.078, DE 11 DE SETEMBRO DE 1990";
    await recusa({ texto: html("cdc").replace(titulo, "LEI Nº 9.999, DE 1º DE JANEIRO DE 2030") }, 2);
    await recusa({ texto: comParagrafoNoFim("cdc", titulo) }, 2);
    await recusa({ texto: html("cdc").replace("Brasília, 11 de setembro de 1990;", "Em 11 de setembro de 1990;") }, 2);
  });

  it("decodifica o arquivo pelo charset que ele declara no <meta>, sem charset no cabeçalho", async () => {
    // Variante sintética em ISO-8859-1, com os parágrafos do recorte: em UTF-8, "Nº" e "º" viriam trocados.
    const latino =
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1" /></head><body><div>' +
      "<p>LEI Nº 8.078, DE 11 DE SETEMBRO DE 1990</p><p>Art. 2º Consumidor é toda pessoa física ou jurídica que adquire " +
      "ou utiliza produto ou serviço como destinatário final.</p><p>Brasília, 11 de setembro de 1990; 169º da " +
      "Independência e 102º da República.</p></div></body></html>";
    const { cliente } = clienteFalso([
      respostaJson(fixture("legislacao/cdc-norma.json")),
      new Response(Buffer.from(latino, "latin1"), { headers: { "content-type": "text/html" } }),
    ]);

    const r = await textoDeLei({ diploma: "CDC", dispositivo: "art. 2º" }, { cliente });

    if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);
    expect(r.partes[0]).toEqual({
      dispositivo: "art. 2º, caput",
      rotuloNaFonte: "Art. 2º",
      texto: "Consumidor é toda pessoa física ou jurídica que adquire ou utiliza produto ou serviço como destinatário final.",
    });
  });
});

async function encontrado(sigla: string, dispositivo: string, variante?: Variante) {
  const { r } = await consultar(sigla, dispositivo, variante);
  if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);
  return r;
}
