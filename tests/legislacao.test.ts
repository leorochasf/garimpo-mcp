import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FormatoInesperadoError, Vagas } from "../src/cliente.js";
import { servicoDe } from "../src/disjuntor.js";
import { clienteDaLegislacao, lerDispositivo, textoDeLei } from "../src/legislacao.js";
import { Memoria } from "../src/memoria.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

// Recorte da resposta real de https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:lei:2015-03-16;13105
// (obtida em 14/10/2026): topo da norma + os artigos 9, 12, 85, 699-A, 945 e 1.045 com a subárvore que a fonte entregou.
// Os textos esperados abaixo são literais copiados dessa página, não calculados pelo código.
const CPC = fixture("legislacao/cpc-recorte.json");
const AGORA = new Date(2026, 9, 14, 10, 30).getTime();
const URL_ESPERADA =
  "https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:lei:2015-03-16;13105&&tipo_documento=maior-detalhe";

const consultar = (diploma: string, dispositivo: string, resposta: unknown = CPC) => {
  const { cliente, chamadas } = clienteFalso([respostaJson(resposta)]);
  return textoDeLei({ diploma, dispositivo }, { cliente, agora: () => AGORA }).then((r) => ({ r, chamadas }));
};

async function encontrado(diploma: string, dispositivo: string, resposta: unknown = CPC) {
  const { r } = await consultar(diploma, dispositivo, resposta);
  if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);
  return r;
}

describe("texto_de_lei — texto literal do dispositivo", () => {
  it("devolve o texto literal do § 2º do art. 85 do CPC e os incisos que a fonte pendura nele, com fonte e data", async () => {
    const { r, chamadas } = await consultar("CPC", "art. 85, § 2º");

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(URL_ESPERADA);
    if (r.resultado !== "encontrado") throw new Error(`esperava encontrado, veio ${r.resultado}`);
    expect(r.diploma).toEqual({ sigla: "CPC", nome: "Lei nº 13.105, de 16 de março de 2015" });
    expect(r.dispositivo).toBe("art. 85, § 2º");
    expect(r.urlOficial).toBe("https://normas.leg.br/?urn=urn:lex:br:federal:lei:2015-03-16;13105!art85_par2");
    expect(r.dataDeObtencao).toBe("14/10/2026");
    expect(r.aviso).toBe("texto conforme a página oficial em 14/10/2026; o Garimpo não afirma vigência");
    expect(r.licenca).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(r.versaoDaFonte).toEqual({ modificadaEm: "2025-03-13", publicadaEm: "2026-04-08" });
    expect(r.partes[0]).toMatchObject({
      dispositivo: "art. 85, § 2º",
      rotuloNaFonte: "§ 2º",
      texto:
        "Os honorários serão fixados entre o mínimo de dez e o máximo de vinte por cento sobre o valor da condenação, do proveito econômico obtido ou, não sendo possível mensurá-lo, sobre o valor atualizado da causa, atendidos:",
    });
    expect(r.partes[1]).toMatchObject({
      dispositivo: "art. 85, § 2º, inciso I",
      rotuloNaFonte: "I –",
      texto: "o grau de zelo do profissional;",
    });
    expect(r.partes[2]).toMatchObject({ texto: "o lugar de prestação do serviço;" });
  });


  it("preserva data, tipo e marcas de uma redação única", async () => {
    const r = await encontrado("CPC", "art. 85, § 6º-A");
    expect(r.partes[0].versoesNaFonte).toHaveLength(1);
    expect(r.partes[0].versoesNaFonte![0]).toMatchObject({
      data: "2022-06-02", tipoNaFonte: "Insertion_Version", alteradoPor: "Lei nº 14.365 de 02/06/2022",
    });
  });

  it("várias redações sem texto não comprovam texto", async () => {
    const semTexto = structuredClone(CPC);
    const limpar = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      delete o.text;
      Object.values(o).forEach(limpar);
    };
    limpar(semTexto);
    expect((await consultar("CPC", "art. 12, caput", semTexto)).r.resultado).toBe("não verificado");
  });

  it("pelo artigo inteiro, traz o caput e os parágrafos na ordem da fonte, sem a linha vazia do rótulo do artigo", async () => {
    const r = await encontrado("CPC", "art. 85");

    expect(r.partes[0]).toMatchObject({
      dispositivo: "art. 85, caput",
      texto: "A sentença condenará o vencido a pagar honorários ao advogado do vencedor.",
    });
    expect(r.partes[1].dispositivo).toBe("art. 85, § 1º");
    expect(r.partes.map((p) => p.dispositivo)).toContain("art. 85, § 6º-A");
    expect(r.partes.every((p) => p.texto || p.versoesNaFonte)).toBe(true);
  });

  it("mostra as redações que a fonte lista, da mais antiga para a mais recente, sem concluir qual vale", async () => {
    const r = await encontrado("CPC", "art. 12, caput");

    expect(r.partes).toHaveLength(1);
    expect(r.partes[0].texto).toBe(
      "Os juízes e os tribunais atenderão, preferencialmente, à ordem cronológica de conclusão para proferir sentença ou acórdão.",
    );
    expect(r.partes[0].versoesNaFonte).toEqual([
      {
        data: "2015-03-16",
        tipoNaFonte: "Original_Version",
        texto: "Os juízes e os tribunais deverão obedecer à ordem cronológica de conclusão para proferir sentença ou acórdão.",
        periodoNaFonte: "2015-03-16/2016-02-03",
        forcaMarcadaPelaFonte: "NotInForce",
      },
      {
        data: "2016-02-04",
        tipoNaFonte: "Text_Change_Version",
        texto: "Os juízes e os tribunais atenderão, preferencialmente, à ordem cronológica de conclusão para proferir sentença ou acórdão.",
        alteradoPor: "Lei nº 13.256 de 04/02/2016",
      },
    ]);
  });

  it("dispositivo revogado: mostra a marca da fonte e a redação antiga como histórico dela, e só a aviso fala de vigência", async () => {
    const r = await encontrado("CPC", "art. 945, caput");

    expect(r.partes[0].texto).toBe("(Revogado)");
    expect(r.partes[0].marcaDaFonteNoDispositivo).toBe("NotInForce");
    expect(r.partes[0].versoesNaFonte![0].texto).toBe(
      "A critério do órgão julgador, o julgamento dos recursos e dos processos de competência originária que não admitem sustentação oral poderá realizar-se por meio eletrônico.",
    );
    expect(r.partes[0].versoesNaFonte![1]).toMatchObject({ tipoNaFonte: "Repeal_Version", alteradoPor: "Lei nº 13.256 de 04/02/2016" });
    const { aviso, ...semAviso } = r;
    expect(aviso).toMatch(/não afirma vigência/);
    expect(JSON.stringify(semAviso)).not.toMatch(/vigent|vigên|em vigor|revogad[oa] expressamente/i);
  });

  it("decisão judicial que a fonte anota na redação vem como nota da fonte, não como conclusão do Garimpo", async () => {
    const r = await encontrado("CPC", "art. 85, § 19");

    expect(r.dispositivo).toBe("art. 85, § 19");
    expect(r.partes[0].versoesNaFonte![1]).toMatchObject({
      tipoNaFonte: "Court_Decision_Version",
      notaDaFonte:
        "Foi conferida interpretação conforme a Constituição ao art. 85, § 19, de forma a estabelecer que a somatória dos subsídios e honorários de sucumbência percebidos mensalmente pelos advogados públicos não poderá exceder ao teto dos Ministros do Supremo Tribunal Federal, conforme o que dispõe o art. 37, XI, da Constituição Federal.",
    });
  });

  it("acha o parágrafo único e o dispositivo acrescentado por outra lei (§ 6º-A, art. 699-A)", async () => {
    const unico = await encontrado("CPC", "art. 9º, parágrafo único");
    expect(unico.partes[0]).toMatchObject({ dispositivo: "art. 9º, parágrafo único", texto: "O disposto no caput não se aplica:" });

    const acrescentado = await encontrado("CPC", "art. 85, § 6º-A");
    expect(acrescentado.partes[0].texto).toMatch(/^Quando o valor da condenação ou do proveito econômico obtido/);
    expect(acrescentado.partes[0].rotuloNaFonte).toBe("§ 6º-A.");

    const artigoA = await encontrado("CPC", "art. 699-A");
    expect(artigoA.partes[0].texto).toMatch(/^Nas ações de guarda, antes de iniciada a audiência de mediação e conciliação/);
  });

  it("alínea direto no caput, que o CPC não tem no art. 85: não verificado", async () => {
    const { r } = await consultar("CPC", "art. 85, alínea a");
    expect(r.resultado).toBe("não verificado");
    expect(r.dispositivo).toBe("art. 85, caput, alínea a");
  });

  it("sem o dispositivo na fonte: não verificado, nunca texto de memória", async () => {
    const { r } = await consultar("CPC", "art. 7.000");

    expect(r.resultado).toBe("não verificado");
    expect(r).not.toHaveProperty("partes");
    expect(r.dataDeObtencao).toBe("14/10/2026");
    expect(r.aviso).toBe("nenhum texto verificado em 14/10/2026; o Garimpo não afirma vigência nem existência do dispositivo");
  });

  it("dispositivo que a fonte lista sem texto algum: não verificado", async () => {
    const semTexto = structuredClone(CPC) as Record<string, unknown>;
    const limpar = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(limpar);
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      if (typeof o.legislationIdentifier === "string" && o.legislationIdentifier.includes("!art1045")) delete o.text;
      for (const v of Object.values(o)) limpar(v);
    };
    limpar(semTexto);

    const { r } = await consultar("CPC", "art. 1.045", semTexto);

    expect(r.resultado).toBe("não verificado");
    expect(r).toMatchObject({ motivo: "A fonte não traz texto para este dispositivo." });
  });

  it("dois dispositivos da fonte com a mesma identificação: pede que o usuário diga qual, sem escolher um", async () => {
    // Variante sintética do recorte: o § 6º-A do art. 85 duplicado, como se outra lei também o tivesse acrescentado.
    const duplicado = structuredClone(CPC) as Record<string, unknown>;
    const duplicar = (n: unknown): void => {
      if (Array.isArray(n)) {
        const i = n.findIndex((x) => x?.legislationIdentifier?.includes("!art85_par6-1,"));
        if (i >= 0) {
          const copia = structuredClone(n[i]);
          copia.legislationIdentifier = "urn:lex:br:federal:lei:2015-03-16;13105!art85_par6-1,lei-99999-2030-01-01";
          copia["@id"] = "https://normas.leg.br/?urn=urn:lex:br:federal:lei:2015-03-16;13105!art85_par6-1,lei-99999-2030-01-01";
          n.splice(i + 1, 0, copia);
          return;
        }
        n.forEach(duplicar);
        return;
      }
      if (n && typeof n === "object") Object.values(n).forEach(duplicar);
    };
    duplicar(duplicado);

    const { r } = await consultar("CPC", "art. 85, § 6º-A", duplicado);

    expect(r.resultado).toBe("identificação necessária");
    if (r.resultado !== "identificação necessária") return;
    expect(r.candidatos).toHaveLength(2);
    expect(r.candidatos.map((c) => c.urlOficial)).toEqual([
      "https://normas.leg.br/?urn=urn:lex:br:federal:lei:2015-03-16;13105!art85_par6-1,lei-14365-2022-06-02",
      "https://normas.leg.br/?urn=urn:lex:br:federal:lei:2015-03-16;13105!art85_par6-1,lei-99999-2030-01-01",
    ]);
  });
});

describe("texto_de_lei — diploma e dispositivo pedidos", () => {
  it.each(["CPC", "cpc", "CPC/2015", "Código de Processo Civil", "codigo de processo civil", "Lei 13.105/2015"])(
    "reconhece o diploma %s",
    async (diploma) => {
      expect((await consultar(diploma, "art. 85, § 2º")).r.diploma.sigla).toBe("CPC");
    },
  );

  it("diploma desconhecido: erro que ensina, com a lista, e nenhuma chamada", async () => {
    const { cliente, chamadas } = clienteFalso([]);

    await expect(textoDeLei({ diploma: "Lei da Mata Atlântica", dispositivo: "art. 1" }, { cliente })).rejects.toThrow(
      /não reconheceu o diploma "Lei da Mata Atlântica".*CPC/,
    );
    expect(chamadas).toHaveLength(0);
  });

  it.each([
    ["art. 85", "art85"],
    ["Art. 85º", "art85"],
    ["art 85 caput", "art85_cpt"],
    ["artigo 1.045", "art1045"],
    ["art. 85, § 2º", "art85_par2"],
    ["art. 85, §2º", "art85_par2"],
    ["art. 85, § 6º-A", "art85_par6-1"],
    ["art. 85, § 2º, inciso III", "art85_par2_inc3"],
    ["art. 85, § 2º, III, a", "art85_par2_inc3_ali1"],
    ["art. 85, § 2º, inciso III, alínea b", "art85_par2_inc3_ali2"],
    ["art. 9º, parágrafo único", "art9_par1u"],
    ["art. 12, inciso IV", "art12_cpt_inc4"],
    ["art. 12, caput, inciso IX", "art12_cpt_inc9"],
    ["art. 699-A", "art699-1"],
    ["art. 359-M-A", "art359-13-1"],
    ["art. 359-M", "art359-13"],
    ["art. 85, alínea a", "art85_cpt_ali1"],
    ["art. 482, a", "art482_cpt_ali1"],
    ["art. 443, § 2º, alínea a", "art443_par2_ali1"],
    ["art. 443, § 2º, a", "art443_par2_ali1"],
    ["art. 9º, parágrafo único, alínea b", "art9_par1u_ali2"],
  ])("lê o dispositivo %j como %s", (texto, chave) => {
    expect(lerDispositivo(texto).chave).toBe(chave);
  });

  it.each([
    "art. 85, § 2º, inciso IIII",
    "art. 85, § 2º, inciso IIV",
    "§ 2º",
    "o artigo do honorário",
    "arts. 85 e 86",
    "art. 85, alínea a, alínea b",
    "art. 85, § 2º, § 3º",
    "art. 85, inciso I, inciso II",
    "art. 85, § 2º, inciso I, alínea a, item 1",
    "",
  ])("não entende %j e diz como escrever, sem chamada", async (texto) => {
    expect(() => lerDispositivo(texto)).toThrow(/Não entendi o dispositivo.*art\. 85/);
    const { cliente, chamadas } = clienteFalso([]);
    await expect(textoDeLei({ diploma: "CPC", dispositivo: texto }, { cliente })).rejects.toThrow(/Não entendi o dispositivo/);
    expect(chamadas).toHaveLength(0);
  });
});

describe("texto_de_lei — memória, formato e freios", () => {
  it("a consulta repetida volta da memória com a data da primeira obtenção, sem nova chamada", async () => {
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "legislacao-"));
    let relogio = AGORA;
    const memoria = new Memoria({ dados, agora: () => relogio });
    const { cliente, chamadas } = clienteFalso([respostaJson(CPC), respostaJson(CPC)]);
    const fontes = { cliente, memoria, agora: () => relogio };

    const primeira = await textoDeLei({ diploma: "CPC", dispositivo: "art. 85, § 2º" }, fontes);
    relogio = new Date(2026, 9, 15, 9, 0).getTime();
    const segunda = await textoDeLei({ diploma: "CPC", dispositivo: "Art. 85, §2º" }, fontes);

    expect(chamadas).toHaveLength(1);
    expect(primeira.obtido).toBe("consultado no normas.leg.br em 14/10/2026");
    expect(segunda.obtido).toMatch(/^consulta guardada: fotografia da consulta feita no normas\.leg\.br em 14\/10\/2026/);
    expect(segunda.aviso).toBe("texto conforme a página oficial em 14/10/2026; o Garimpo não afirma vigência");
    if (segunda.resultado !== "encontrado") throw new Error("esperava encontrado");
    expect(segunda.partes[0].texto).toMatch(/^Os honorários serão fixados/);
    relogio = AGORA + 24 * 60 * 60 * 1_000 + 1;
    const terceira = await textoDeLei({ diploma: "CPC", dispositivo: "art. 85, § 2º" }, fontes);
    expect(chamadas).toHaveLength(2);
    expect(terceira.dataDeObtencao).toBe("15/10/2026");
    expect(terceira.obtido).toBe("consultado no normas.leg.br em 15/10/2026");
  });

  it("resposta que não é JSON da norma: erro de formato, nunca texto inventado", async () => {
    const { cliente } = clienteFalso([new Response("<html><body>manutenção</body></html>", { headers: { "content-type": "text/plain" } })]);

    await expect(textoDeLei({ diploma: "CPC", dispositivo: "art. 85" }, { cliente })).rejects.toBeInstanceOf(FormatoInesperadoError);
  });

  it("resposta JSON sem a árvore da norma (a fonte só ecoa a URN): não verificado", async () => {
    const { r } = await consultar("CPC", "art. 85", { urn: "urn:lex:br:federal:lei:2015-03-16;13105" });

    expect(r.resultado).toBe("não verificado");
  });


  it("não atribui ao CPC o texto devolvido de outro diploma", async () => {
    const outraNorma = structuredClone(CPC) as Record<string, unknown>;
    outraNorma.legislationIdentifier = "urn:lex:br:federal:lei:2002-01-10;10406";
    await expect(consultar("CPC", "art. 85", outraNorma)).rejects.toBeInstanceOf(FormatoInesperadoError);
  });

  it.each([undefined, "https://exemplo.invalid/?urn=outro", "https://normas.leg.br/?urn=outro"])(
    "recusa URL ausente ou que não comprova o dispositivo: %s", async (url) => {
      const resposta = structuredClone(CPC);
      const mudar = (n: unknown): void => {
        if (!n || typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        if (o.legislationIdentifier === "urn:lex:br:federal:lei:2015-03-16;13105!art85") o["@id"] = url;
        Object.values(o).forEach(mudar);
      };
      mudar(resposta);
      await expect(consultar("CPC", "art. 85", resposta)).rejects.toBeInstanceOf(FormatoInesperadoError);
    },
  );

  it("não segue redirecionamento para destino não verificado", async () => {
    const { cliente, chamadas } = clienteFalso([new Response(null, { status: 302, headers: { location: "https://exemplo.invalid" } })]);
    await expect(textoDeLei({ diploma: "CPC", dispositivo: "art. 85" }, { cliente })).rejects.toBeInstanceOf(FormatoInesperadoError);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].init?.redirect).toBe("manual");
  });

  it("é o serviço normas.leg.br nos freios, 1 s entre chamadas ao host", async () => {
    expect(servicoDe(URL_ESPERADA)).toBe("normas.leg.br");
    const relogio = { agora: 1_000_000 };
    const esperas: number[] = [];
    let chamadas = 0;
    const cliente = clienteDaLegislacao({
      vagas: new Vagas(2),
      agora: () => relogio.agora,
      esperar: async (ms) => {
        esperas.push(ms);
        relogio.agora += ms;
      },
      fetch: (async () => {
        chamadas++;
        return respostaJson(CPC);
      }) as typeof fetch,
    });

    await textoDeLei({ diploma: "CPC", dispositivo: "art. 85" }, { cliente });
    await textoDeLei({ diploma: "CPC", dispositivo: "art. 12" }, { cliente });

    expect(chamadas).toBe(2);
    expect(esperas).toEqual([1_000]);
  });
});
