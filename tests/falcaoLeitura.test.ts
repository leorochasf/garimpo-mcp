import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chamar, conectar, documento, falcaoFalso, pagina, PESQUISA, siteFalso } from "./apoioFalcao.js";

const ID = "trt3:10000001";
const SEM_EMENTA = "trt3:10000002";

/** Busca no TRT3 (fixture) e devolve o Garimpo montado, já com os acórdãos e textos na memória. */
async function comBusca(responder = () => pagina(PESQUISA.documentos)) {
  const falcao = falcaoFalso(responder);
  const montado = await conectar(siteFalso().cliente, falcao.cliente);
  const r = await chamar(montado.mcp, "busca_direta", { tribunal: "trt3", texto: "intervalo intrajornada" });
  expect(r.isError).toBe(false);
  return { ...montado, falcao };
}

/** Espera a gravação por trás terminar: o texto de cada acórdão aparece em memoria/textos-1. */
async function esperarTextosNoDisco(dados: string, quantos: number) {
  for (let i = 0; i < 200; i++) {
    const nomes = await readdir(join(dados, "memoria", "textos-1")).catch(() => [] as string[]);
    if (nomes.filter((n) => n.endsWith(".json")).length >= quantos) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("os textos não chegaram ao disco");
}

describe("ler o texto integral de um TRT pelo id", () => {
  it("ler_inteiro_teor com o id, sem caminho: texto convertido, cabeçalho de fonte, julgado/juntado e 'não é PDF'", async () => {
    const { mcp } = await comBusca();
    const r = await chamar(mcp, "ler_inteiro_teor", { id: ID });
    expect(r.isError).toBe(false);
    expect(r.dado.cabecalho).toMatchObject({
      tribunal: "TRT3",
      numero: "ROT 0000001-00.2024.5.03.0001",
      julgadoEm: "2024-02-27",
      juntadoEm: "2024-03-05",
      id: ID,
      fonte: "Falcão — repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024)",
      partes: "parte 1 de 1 (por tamanho do texto; não são páginas de PDF)",
    });
    expect(r.dado.cabecalho.natureza).toMatch(/convertido de HTML.*não é PDF e não tem recibo de origem/);
    expect(r.dado.cabecalho.completo).toBeUndefined();
    expect(r.dado.texto).toMatch(/RECORRENTE: PARTE FICTICIA A/);
    expect(r.dado.texto).toMatch(/Fundamentação fictícia, com etiquetas aninhadas e entidades\./);
    expect(r.dado.texto).not.toMatch(/base64|<p>|void 0|comentario/);
    expect(r.dado.proximaParte).toBeUndefined();
  });

  it("texto longo vem em partes por tamanho, cada resposta abaixo do teto, com a chamada da parte seguinte", async () => {
    const longo = `<p>${Array.from({ length: 900 }, (_, i) => `Paragrafo ficticio ${i} de fundamentacao generica.`).join("</p><p>")}</p>`;
    const { mcp } = await comBusca(() => pagina([documento({ textoAcordao: longo })]));
    const partes = [];
    let pedido: Record<string, unknown> | undefined = { id: ID };
    while (pedido) {
      const r = await chamar(mcp, "ler_inteiro_teor", pedido);
      expect(r.texto.length).toBeLessThanOrEqual(24_000);
      partes.push(r.dado);
      pedido = r.dado.proximaParte?.argumentos;
    }
    expect(partes.length).toBeGreaterThan(1);
    expect(partes[0].cabecalho.partes).toBe(`parte 1 de ${partes.length} (por tamanho do texto; não são páginas de PDF)`);
    const junto = partes.map((p) => p.texto).join("\n");
    expect(junto).toMatch(/Paragrafo ficticio 0 de/);
    expect(junto).toMatch(/Paragrafo ficticio 899 de/);
  });

  it("texto com indício de corte nunca é apresentado como completo", async () => {
    const { mcp } = await comBusca(() => pagina([documento({ textoAcordao: "<p>Fundamentacao ficticia cortada no mei" })]));
    const r = await chamar(mcp, "ler_inteiro_teor", { id: ID });
    expect(r.dado.cabecalho.completo).toMatch(/^não/);
    expect(r.dado.avisos.join(" ")).toMatch(/indício de corte/);
  });

  it("texto fora da memória: erro que ensina a refazer a busca, sem prometer o mesmo acórdão; nenhuma chamada", async () => {
    const falcao = falcaoFalso();
    const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
    const r = await chamar(mcp, "ler_inteiro_teor", { id: ID });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/não está na memória do Garimpo/);
    expect(r.texto).toMatch(/pode não trazer o mesmo acórdão/);
    expect(falcao.pedidos).toHaveLength(0);
  });

  it("sem caminho e sem id de TRT: erro que diz o que informar", async () => {
    const { mcp } = await comBusca();
    const r = await chamar(mcp, "ler_inteiro_teor", { id: "stj:123" });
    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/Informe o caminho do PDF/);
  });

  it("obter_inteiro_teor com id de TRT não baixa nada: explica que é texto e aponta o ler_inteiro_teor", async () => {
    const { mcp, falcao } = await comBusca();
    const r = await chamar(mcp, "obter_inteiro_teor", { id: ID });
    expect(r.isError).toBe(false);
    expect(r.dado.baixado).toBe(false);
    expect(r.dado.explicacao).toMatch(/não PDF/);
    expect(r.dado.explicacao).toMatch(new RegExp(`ler_inteiro_teor com o id ${ID}`));
    expect(falcao.pedidos).toHaveLength(1);
  });
});

describe("conferir citação num acórdão de TRT", () => {
  it("confere na ementa e no texto integral, dizendo em qual achou e que é o texto convertido do HTML", async () => {
    const { mcp } = await comBusca();
    const r = await chamar(mcp, "conferir_citacao", {
      citacoes: [
        { citacao: "Fundamentação fictícia, com etiquetas aninhadas e entidades.", id: ID },
        { citacao: "INTERVALO INTRAJORNADA. SUPRESSÃO PARCIAL. Texto fictício de ementa.", id: ID },
      ],
    });
    expect(r.isError).toBe(false);
    const [soNoTexto, nosDois] = r.dado.resultados;
    const fonte = (res: { fontes: { fonte: string }[] }, nome: string) => res.fontes.find((f) => f.fonte === nome) as any;
    expect(fonte(soNoTexto, "ementa").veredito).toBe("não encontrado");
    expect(fonte(soNoTexto, "texto integral")).toMatchObject({ veredito: "encontrado literalmente", id: ID });
    expect(fonte(soNoTexto, "texto integral").origem).toMatch(/convertido de HTML/);
    expect(fonte(soNoTexto, "texto integral").ocorrencias[0].local).toBe("no texto integral");
    expect(fonte(nosDois, "ementa").veredito).toBe("encontrado literalmente");
    expect(fonte(nosDois, "texto integral").veredito).toBe("encontrado literalmente");
    expect(r.dado.aviso).toMatch(/não autentica o texto nem confere a origem/);
    expect(r.dado.avisoNaturezaJuridica).toMatch(/repositório oficial da Justiça do Trabalho/);
  });

  it("acórdão sem ementa no Falcão: a ementa é \"não verificável\" e o texto integral segue sozinho", async () => {
    const { mcp } = await comBusca();
    const r = await chamar(mcp, "conferir_citacao", {
      citacoes: [{ citacao: "RECORRENTE: PARTE FICTICIA C Acórdão fictício sem ementa.", id: SEM_EMENTA }],
    });
    const [ementa, texto] = r.dado.resultados[0].fontes;
    expect(ementa).toMatchObject({ fonte: "ementa", veredito: "não verificável" });
    expect(ementa.motivo).toMatch(/Sem ementa no Falcão/);
    expect(texto).toMatchObject({ fonte: "texto integral", veredito: "encontrado literalmente" });
  });

  it("texto integral fora da memória: no texto, \"não verificável\" (nunca \"não encontrado\"); a ementa segue", async () => {
    const { dados } = await comBusca();
    await esperarTextosNoDisco(dados, 2);
    await rm(join(dados, "memoria", "textos-1"), { recursive: true, force: true });
    // Outra janela, com a mesma pasta de dados: a memória da janela que buscou não vale aqui.
    const outra = await conectar(siteFalso().cliente, falcaoFalso().cliente, { dados });
    const r = await chamar(outra.mcp, "conferir_citacao", {
      citacoes: [{ citacao: "INTERVALO INTRAJORNADA. SUPRESSÃO PARCIAL. Texto fictício de ementa.", id: ID }],
    });
    const [ementa, texto] = r.dado.resultados[0].fontes;
    expect(ementa.veredito).toBe("encontrado literalmente");
    expect(texto.veredito).toBe("não verificável");
    expect(texto.motivo).toMatch(/Refaça a busca/);
  });

  it("texto com indício de corte: citação não achada ganha o aviso de que pode estar no trecho que faltou", async () => {
    const { mcp } = await comBusca(() => pagina([documento({ textoAcordao: "<p>Fundamentacao ficticia cortada no mei" })]));
    const r = await chamar(mcp, "conferir_citacao", {
      citacoes: [{ citacao: "uma passagem ficticia que nao esta no texto", id: ID }],
    });
    const texto = r.dado.resultados[0].fontes[1];
    expect(texto.veredito).toBe("não encontrado");
    expect(texto.aviso).toMatch(/pode estar no trecho que faltou/);
  });
});
