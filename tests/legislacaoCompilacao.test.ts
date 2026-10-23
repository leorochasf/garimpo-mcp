import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FormatoInesperadoError } from "../src/cliente.js";
import { textoDeLei } from "../src/legislacao.js";
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
