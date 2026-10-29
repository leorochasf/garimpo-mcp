import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cliente, Vagas } from "../src/cliente.js";
import { ROTULO_TEXTO_DA_BASE } from "../src/textoDaBase.js";
import { respostaJson } from "./apoio.js";
import { chamar, conectar, falcaoFalso } from "./apoioFalcao.js";

// Ticket 07: o texto da base de TJES e TJMA, de ponta a ponta (busca → obter → ler → conferir), pelo servidor MCP.
// O oficial prevalece: tribunal com caminho oficial não usa o texto da base. HTML sintético / fixtures saneadas.

const ROTULO = "texto da base do JurisprudênciaIA, não oficial";
const FRASE = "o recurso é conhecido e provido para reformar a sentença fictícia";

const html = `<html><body><h2>Inteiro Teor</h2><p>EMENTA: APELAÇÃO CÍVEL. Texto fictício de ementa.</p>
<p>VOTO fictício: ${FRASE}, com razões bastantes para o teste.</p></body></html>`;
const dataUri = (h = html) => "data:text/html;base64," + Buffer.from(h, "utf8").toString("base64");

const registro = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  texto_ementa: "APELAÇÃO CÍVEL. Texto fictício de ementa.",
  link_pdf: dataUri(),
  ...extra,
});

/** Site que responde à busca com estes registros e anota todas as chamadas (qualquer rota). */
function site(registros: unknown[]) {
  const chamadas: string[] = [];
  const cliente = new Cliente({
    nome: "O site",
    vagas: new Vagas(2),
    esperar: async () => {},
    fetch: (async (url: string) => {
      chamadas.push(url);
      return respostaJson({ results: registros });
    }) as typeof fetch,
  });
  return { cliente, chamadas };
}

async function montar(tribunal: string, registros: unknown[], extra: Parameters<typeof conectar>[2] = {}) {
  const s = site(registros);
  const { mcp } = await conectar(s.cliente, falcaoFalso().cliente, extra);
  const busca = await chamar(mcp, "busca_direta", { tribunal, texto: "exemplo" });
  expect(busca.isError).toBe(false);
  return { mcp, s, busca };
}

describe("texto da base — TJES e TJMA, de ponta a ponta", () => {
  it.each(["tjes", "tjma"])("%s: obter_inteiro_teor devolve o aviso com o rótulo, sem nenhuma chamada nova", async (t) => {
    const { mcp, s, busca } = await montar(t, [registro(5)]);
    expect(busca.texto).not.toMatch(/data:text|base64/);
    const antes = s.chamadas.length;
    const r = await chamar(mcp, "obter_inteiro_teor", { id: `${t}:5` });
    expect(r.isError).toBe(false);
    expect(r.dado.baixado).toBe(false);
    expect(r.dado.explicacao).toContain(ROTULO);
    expect(r.dado.explicacao).toMatch(/Não é o PDF do tribunal/);
    expect(r.dado.explicacao).toContain(`ler_inteiro_teor com o id ${t}:5`);
    expect(s.chamadas).toHaveLength(antes);
    expect(r.texto).not.toMatch(/data:text|base64/);
  });

  it("ler_inteiro_teor pelo id: o rótulo é a fonte, a natureza diz que não é oficial, e o texto vem convertido", async () => {
    const { mcp } = await montar("tjes", [registro(5)]);
    const r = await chamar(mcp, "ler_inteiro_teor", { id: "tjes:5" });
    expect(r.isError).toBe(false);
    expect(r.dado.cabecalho.fonte).toBe(ROTULO);
    expect(r.dado.cabecalho.fonte).toBe(ROTULO_TEXTO_DA_BASE);
    expect(r.dado.cabecalho.natureza).toContain(ROTULO);
    expect(r.dado.cabecalho.natureza).toMatch(/não é PDF, não tem recibo de origem e não foi conferido com o tribunal/);
    expect(r.dado.texto).toContain(FRASE);
    expect(r.dado.texto).not.toMatch(/<|base64/);
  });

  it("conferir_citacao pelo id: acha no texto da base e diz, na origem, que é a base, não oficial", async () => {
    const { mcp } = await montar("tjma", [registro(9)]);
    const r = await chamar(mcp, "conferir_citacao", { citacoes: [{ citacao: FRASE, id: "tjma:9" }] });
    expect(r.isError).toBe(false);
    const fonte = r.dado.resultados[0].fontes.find((f: { fonte: string }) => f.fonte === "texto integral");
    expect(fonte.veredito).toBe("encontrado literalmente");
    expect(fonte.origem).toContain(ROTULO);
  });

  it("metadados que faltam no registro não são inventados (TJMA sem número, órgão nem data)", async () => {
    const { mcp } = await montar("tjma", [registro(9, { numero_processo: undefined, orgao_julgador: undefined, data_julgamento: undefined })]);
    const r = await chamar(mcp, "ler_inteiro_teor", { id: "tjma:9" });
    expect(r.dado.cabecalho.numero).toBe("não informado");
    expect(r.dado.cabecalho.julgadoEm).toBe("não informado");
    expect(r.dado.cabecalho.juntadoEm).toBe("não informado");
  });

  it("registro sem o HTML e sem link do tribunal: a frase pede para procurar no portal, com a sigla, e a ponte segue", async () => {
    const { mcp } = await montar("tjes", [registro(5, { link_pdf: undefined })]);
    const o = await chamar(mcp, "obter_inteiro_teor", { id: "tjes:5" });
    expect(o.dado.baixado).toBe(false);
    expect(o.dado.explicacao).toContain(
      "O registro deste acórdão na base do JurisprudênciaIA não trouxe o texto embutido, e o Garimpo não tem caminho " +
        "oficial para baixar o inteiro teor do TJES; procure o acórdão no portal do tribunal.",
    );
    expect(o.dado.explicacao).not.toMatch(/abra o link/);
    expect(o.dado.chamadaPronta).toBeDefined();
  });

  it("registro sem o HTML e com link https do tribunal: a frase manda abrir o link, que sai na resposta", async () => {
    const { mcp } = await montar("tjma", [registro(5, { link_pdf: undefined, link_consulta: "https://exemplo.jus.br/acordao/5" })]);
    const o = await chamar(mcp, "obter_inteiro_teor", { id: "tjma:5" });
    expect(o.dado.explicacao).toContain(
      "O registro deste acórdão na base do JurisprudênciaIA não trouxe o texto embutido, e o Garimpo não tem caminho " +
        "oficial para baixar o inteiro teor do TJMA; abra o link no navegador.",
    );
    expect(o.dado.link).toBe("https://exemplo.jus.br/acordao/5");
    expect(o.dado.chamadaPronta).toBeDefined();
  });

  it("texto fora da memória: a leitura diz que o texto não está com o rótulo, sem a vírgula solta, e manda refazer a busca", async () => {
    const { mcp } = await montar("tjes", [registro(5, { link_pdf: undefined })]);
    const l = await chamar(mcp, "ler_inteiro_teor", { id: "tjes:5" });
    expect(l.isError).toBe(true);
    expect(l.texto).toContain(
      "O acórdão tjes:5 não está na memória do Garimpo com o texto da base do JurisprudênciaIA, não oficial; a memória guarda esse texto por 24 h desde a busca. Refaça a busca que o trouxe (uma busca nova pode não trazer o mesmo acórdão).",
    );
  });

  it("listar_tribunais: TJES e TJMA dizem o rótulo; não aparecem como «só link»", async () => {
    const { mcp } = await montar("tjes", []);
    const r = await chamar(mcp, "listar_tribunais", {});
    for (const t of ["tjes", "tjma"]) {
      const linha = r.dado.find((x: { tribunal: string }) => x.tribunal === t);
      expect(linha.inteiroTeor).toBe("base");
      expect(linha.motivo).toContain(ROTULO);
    }
  });
});

describe("texto da base — o caminho oficial prevalece", () => {
  it("tribunal que baixa o PDF (TJMG) com data: no registro: o texto da base não é guardado nem usado", async () => {
    const { mcp } = await montar("tjmg", [registro(5)]);
    const l = await chamar(mcp, "ler_inteiro_teor", { id: "tjmg:5" });
    expect(l.isError).toBe(true);
    expect(l.texto).not.toContain(FRASE);
    const o = await chamar(mcp, "obter_inteiro_teor", { id: "tjmg:5" });
    expect(o.texto).not.toContain(ROTULO);
  });
});

describe("texto da base — fixtures saneadas do TJES e do TJMA de ponta a ponta", () => {
  const ler = (a: string) => readFileSync(new URL(`./fixtures/${a}`, import.meta.url), "utf8");
  it.each([
    ["tjes", "texto-da-base-tjes.html", /I\. CASO EM EXAME/],
    ["tjma", "texto-da-base-tjma.html", /RELATÓRIO/],
  ])("%s: a leitura devolve o texto da fixture com o rótulo", async (t, arq, marca) => {
    const { mcp } = await montar(t, [registro(1, { link_pdf: dataUri(ler(arq)) })]);
    const r = await chamar(mcp, "ler_inteiro_teor", { id: `${t}:1` });
    expect(r.isError).toBe(false);
    expect(r.dado.cabecalho.fonte).toBe(ROTULO);
    expect(r.dado.texto).toMatch(marca);
  });
});
