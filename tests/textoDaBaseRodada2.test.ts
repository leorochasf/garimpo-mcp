import { describe, expect, it } from "vitest";
import { Cliente, Vagas } from "../src/cliente.js";
import { chamar, conectar, falcaoFalso } from "./apoioFalcao.js";
import { respostaJson } from "./apoio.js";

// Rodada 2 do ticket 07 (revisão B07-R01 e B07-R03). A transição base → portal (B07-R02) fica em
// textoDaBaseTransicao.test.ts, porque o registro de portais é global ao arquivo de teste.

const ROTULO = "texto da base do JurisprudênciaIA, não oficial";
const FRASE = "o recurso é conhecido e provido para reformar a sentença fictícia";
const html = `<html><body><p>EMENTA: APELAÇÃO CÍVEL. Texto fictício de ementa.</p><p>VOTO fictício: ${FRASE}, com razões bastantes.</p></body></html>`;
const dataUri = (h = html) => "data:text/html;base64," + Buffer.from(h, "utf8").toString("base64");

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

describe("B07-R01 — a busca ampla guarda o texto da base, pelo id mostrado", () => {
  it("ampla no TJES: o id mostrado lê, confere e é obtido pelo texto da base, sem expor o data:", async () => {
    const s = site([{ id: 5, texto_ementa: "APELAÇÃO CÍVEL. Texto fictício de ementa.", link_pdf: dataUri() }]);
    const { mcp } = await conectar(s.cliente, falcaoFalso().cliente);
    const ampla = await chamar(mcp, "busca_ampla", { formulacoes: ["dano moral"], tribunais: ["tjes"] });
    expect(ampla.isError).toBe(false);
    expect(ampla.texto).not.toMatch(/data:text|base64/);
    const id = ampla.dado.acordaos[0].id;
    expect(id).toBe("tjes:5");
    const antes = s.chamadas.length;
    const o = await chamar(mcp, "obter_inteiro_teor", { id });
    expect(o.dado.explicacao).toContain(ROTULO);
    expect(o.dado.explicacao).toMatch(/Não é o PDF do tribunal/);
    const l = await chamar(mcp, "ler_inteiro_teor", { id });
    expect(l.isError).toBe(false);
    expect(l.dado.cabecalho.fonte).toBe(ROTULO);
    expect(l.dado.texto).toContain(FRASE);
    const c = await chamar(mcp, "conferir_citacao", { citacoes: [{ citacao: FRASE, id }] });
    const fonte = c.dado.resultados[0].fontes.find((f: { fonte: string }) => f.fonte === "texto integral");
    expect(fonte.veredito).toBe("encontrado literalmente");
    expect(fonte.origem).toContain(ROTULO);
    expect(s.chamadas).toHaveLength(antes);
  });

  it("cópias juntadas na ampla: o texto fica no id que a resposta mostra, venha de qual cópia vier", async () => {
    const igual = { texto_ementa: "EMENTA IGUAL FICTÍCIA.", data_julgamento: "2025-03-04" };
    const s = site([
      { id: 1, link_pdf: undefined, ...igual },
      { id: 2, link_pdf: dataUri(), ...igual },
    ]);
    const { mcp } = await conectar(s.cliente, falcaoFalso().cliente);
    const ampla = await chamar(mcp, "busca_ampla", { formulacoes: ["dano moral"], tribunais: ["tjma"] });
    expect(ampla.dado.acordaos).toHaveLength(1);
    const id = ampla.dado.acordaos[0].id;
    const l = await chamar(mcp, "ler_inteiro_teor", { id });
    expect(l.isError).toBe(false);
    expect(l.dado.texto).toContain(FRASE);
    expect(ampla.texto).not.toMatch(/data:text|base64/);
  });
});

describe("B07-R03 — conferência de texto cortado da base", () => {
  it("diz «o HTML da base», nunca «Falcão», e mantém o alerta de incompletude", async () => {
    const cortado = `<p>EMENTA: APELAÇÃO CÍVEL. ${FRASE}, com razões bastantes e um texto que termina no meio de uma etiq<`;
    const s = site([{ id: 5, texto_ementa: "APELAÇÃO CÍVEL. Texto fictício.", link_pdf: dataUri(cortado) }]);
    const { mcp } = await conectar(s.cliente, falcaoFalso().cliente);
    await chamar(mcp, "busca_direta", { tribunal: "tjes", texto: "exemplo" });
    const c = await chamar(mcp, "conferir_citacao", { citacoes: [{ citacao: FRASE, id: "tjes:5" }] });
    const fonte = c.dado.resultados[0].fontes.find((f: { fonte: string }) => f.fonte === "texto integral");
    expect(fonte.veredito).toBe("encontrado literalmente");
    expect(fonte.aviso).toContain("Texto com indício de corte: o HTML da base parecia terminar no meio");
    expect(fonte.aviso).not.toMatch(/Falcão/);
    expect(fonte.aviso).toMatch(/Uma citação "não encontrada" pode estar no trecho que faltou/);
    expect(fonte.origem).toContain(ROTULO);
  });
});
