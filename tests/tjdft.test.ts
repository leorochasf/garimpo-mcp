import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { lerTextoIntegral } from "../src/leitura.js";
import { Memoria } from "../src/memoria.js";
import { infoTribunal, paginaDeTribunais } from "../src/tribunais.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

const API = "https://jurisdf.tjdft.jus.br/api/v1/pesquisa";
const UUID = "11111111-2222-4333-8444-555555555555";
const LINK = `https://jurisdf.tjdft.jus.br/acordaos/9000001/inteiro-teor/${UUID}`;
const CNJ = "0000001-11.2025.8.07.0001";

/** Resposta gravada (e saneada à mão) da API do TJDFT; cada teste a ajusta numa cópia. */
type Registro = Record<string, unknown>;
const gravada = () => fixture("tjdft-pesquisa.json") as { hits: { value: number }; registros: Registro[] };
const resposta = (mexer: (r: Registro) => void = () => {}, cabecalhos: Record<string, string> = {}) => {
  const dado = gravada();
  mexer(dado.registros[0]);
  return () =>
    new Response(JSON.stringify(dado), {
      headers: { "content-type": "application/json", "x-ratelimit-limit": "60", "x-ratelimit-remaining": "59", ...cabecalhos },
    });
};

function memoriaComAcordao(sobre: Partial<Acordao> = {}) {
  const memoria = new Memoria();
  const acordao: Acordao = {
    id: "tjdft:123",
    tribunal: "tjdft",
    numero: CNJ,
    numeroCnj: CNJ,
    semNumero: false,
    ementa: "APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO DE EMENTA DO TJDFT PARA TESTE. DANO MORAL.",
    link: LINK,
    ...sobre,
  } as Acordao;
  memoria.lembrar([{ ids: [acordao.id], registro: acordao }]);
  return memoria;
}

describe("inteiro teor — TJDFT entrega o texto do portal do tribunal pela API", () => {
  it("pede à API o acórdão do link (identificador), guarda o texto na memória e ensina a ler pelo id; nada é salvo como PDF", async () => {
    const memoria = memoriaComAcordao();
    const { cliente, chamadas } = clienteFalso([resposta()]);
    const r = await obterInteiroTeor({ id: "tjdft:123" }, () => cliente, memoria);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(API);
    expect(chamadas[0].init.method).toBe("POST");
    const corpo = JSON.parse(String(chamadas[0].init.body));
    expect(corpo.termosAcessorios).toEqual([{ campo: "identificador", valor: "9000001" }]);
    expect(corpo.retornaInteiroTeor).toBe(true);
    expect(typeof corpo.query).toBe("string");

    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.link).toBe(LINK);
    expect(r.explicacao).toMatch(/texto do portal do tribunal/);
    expect(r.explicacao).toMatch(/ler_inteiro_teor com o id tjdft:123/);
    expect(r.explicacao).not.toMatch(/inteiro teor oficial/);
    const guardado = await memoria.obterTexto("tjdft:123");
    expect(guardado?.texto).toMatch(/O dano moral decorrente de protesto indevido é presumido/);
    expect(guardado?.motivoSemTexto).toBeUndefined();
  });
});

describe("inteiro teor — TJDFT: só o registro certo vira texto; o resto é não verificado", () => {
  async function obter(r: () => Response, sobre: Partial<Acordao> = {}) {
    const memoria = memoriaComAcordao(sobre);
    const { cliente } = clienteFalso([r]);
    const resultado = await obterInteiroTeor({ id: "tjdft:123" }, () => cliente, memoria);
    return { resultado, memoria };
  }

  it("API sem registro: texto não verificado, nada guardado, link para conferir", async () => {
    const vazia = () => respostaJson({ hits: { value: 0 }, registros: [] });
    const { resultado, memoria } = await obter(vazia);
    expect(resultado).toMatchObject({ baixado: false, link: LINK });
    expect(resultado.baixado ? "" : resultado.explicacao).toMatch(/não verificado/);
    expect(await memoria.obterTexto("tjdft:123")).toBeUndefined();
  });

  it("registro de outro uuid (mesmo identificador): não verificado, nada guardado", async () => {
    const { resultado, memoria } = await obter(resposta((g) => (g.uuid = "99999999-2222-4333-8444-555555555555")));
    expect(resultado.baixado ? "" : resultado.explicacao).toMatch(/não verificado/);
    expect(await memoria.obterTexto("tjdft:123")).toBeUndefined();
  });

  it("registro de outro processo que o da busca: não verificado, nada guardado", async () => {
    const { resultado, memoria } = await obter(resposta((g) => (g.processo = "0000002-22.2025.8.07.0001")));
    expect(resultado.baixado ? "" : resultado.explicacao).toMatch(/não verificado/);
    expect(await memoria.obterTexto("tjdft:123")).toBeUndefined();
  });

  it.each([
    ["segredo de justiça", (g: Registro) => (g.segredoJustica = true), /segredo de justiça/],
    ["possuiInteiroTeor falso", (g: Registro) => (g.possuiInteiroTeor = false), /não tem inteiro teor/],
    ["texto ausente", (g: Registro) => delete g.inteiroTeor, /não mandou o texto/],
  ])("%s: sem texto, com o motivo; o texto que a API mandar nunca é guardado", async (_nome, mexer, motivo) => {
    const { resultado, memoria } = await obter(resposta(mexer));
    expect(resultado.baixado ? "" : resultado.explicacao).toMatch(/não verificado/);
    const guardado = await memoria.obterTexto("tjdft:123");
    expect(guardado?.texto).toBe("");
    expect(guardado?.motivoSemTexto).toMatch(motivo);
  });

  it("link fora do formato do TJDFT é recusado antes de qualquer chamada", async () => {
    const memoria = memoriaComAcordao({ link: "https://outro.test/acordaos/9000001/inteiro-teor/" + UUID });
    const { cliente, chamadas } = clienteFalso([]);
    await expect(obterInteiroTeor({ id: "tjdft:123" }, () => cliente, memoria)).rejects.toThrow(/fora do formato/);
    expect(chamadas).toHaveLength(0);
  });

  it("já na memória: não chama a API de novo", async () => {
    const memoria = memoriaComAcordao();
    await obterInteiroTeor({ id: "tjdft:123" }, () => clienteFalso([resposta()]).cliente, memoria);
    const { cliente, chamadas } = clienteFalso([]);
    await obterInteiroTeor({ id: "tjdft:123" }, () => cliente, memoria);
    expect(chamadas).toHaveLength(0);
  });
});

describe("ler_inteiro_teor — texto do portal do TJDFT pelo id", () => {
  it("lê da memória com o rótulo do TJDFT, nunca como TJTO, Falcão ou inteiro teor oficial", async () => {
    const memoria = memoriaComAcordao();
    await obterInteiroTeor({ id: "tjdft:123" }, () => clienteFalso([resposta()]).cliente, memoria);

    const p = await lerTextoIntegral("tjdft:123", 1, memoria);
    expect(p.cabecalho.tribunal).toBe("TJDFT");
    expect(p.cabecalho.numero).toBe(CNJ);
    expect(p.cabecalho.fonte).toMatch(/TJDFT/);
    expect(p.cabecalho.natureza).toMatch(/^texto do portal do tribunal/);
    expect(JSON.stringify(p.cabecalho)).not.toMatch(/Falcão|TJTO|inteiro teor oficial/);
    expect(p.texto).toMatch(/EXEMPLO FICTÍCIO DE EMENTA DO TJDFT/);
  });

  it("acórdão sem texto: a leitura diz que o texto não foi verificado", async () => {
    const memoria = memoriaComAcordao();
    await obterInteiroTeor({ id: "tjdft:123" }, () => clienteFalso([resposta((g) => (g.segredoJustica = true))]).cliente, memoria);
    const p = await lerTextoIntegral("tjdft:123", 1, memoria);
    expect(p.cabecalho.completo).toMatch(/^não: .*segredo de justiça/);
    expect(p.avisos.join(" ")).toMatch(/Sem texto integral/);
  });
});

describe("tabela de tribunais — TJDFT", () => {
  it("o TJDFT entrega o texto do portal do tribunal; os outros tribunais de link não mudam", () => {
    expect(infoTribunal("tjdft")?.inteiroTeor).toBe("portal");
    expect(infoTribunal("tjto")?.inteiroTeor).toBe("portal");
    expect(infoTribunal("tjrj")?.inteiroTeor).toBe("link");
    expect(paginaDeTribunais()).toMatch(/\| TJDFT \|[^\n]*texto do portal do tribunal/);
  });
});
