import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVISO_DE_ORGAO_DO_FECHO,
  SINAIS_DE_QUEM_DISSE,
  avisoDeOrgaoDoFecho,
  conferirNaEmenta,
  conferirNoInteiroTeor,
  conferirNoTextoIntegral,
  lerCitacao,
} from "../src/conferencia.js";
import type { ConferenciaFeita, ResultadoDaFonte } from "../src/conferencia.js";
import { htmlParaTexto } from "../src/html.js";
import { lerParaConferir } from "../src/leitura.js";
import type { InteiroTeorParaConferir } from "../src/leitura.js";
import {
  FRASES_DE_AUTORIA,
  pdfComDispositivoECertidao,
  pdfComSinaisDeAutoria,
  pdfEmentaPadronizada,
  pdfSintetico,
  pdfUnanimeComDivergencia,
} from "./pdfSintetico.js";

/** Ementa fictícia, sem processo real (regra 2). */
const EMENTA =
  "EMENTA FICTÍCIA. ADMINISTRATIVO. RESPONSABILIDADE CIVIL DO ESTADO. 1. A responsabilidade civil do Estado " +
  "por omissão exige a demonstração do nexo causal entre a falta do serviço e o dano sofrido. 2. Recurso " +
  "conhecido e não provido.";

function conferirBruto(ementa: string, citacao: string, reticenciasComoCorte = false): ResultadoDaFonte {
  return conferirNaEmenta(ementa, lerCitacao(citacao, { reticenciasComoCorte }));
}

/** Conferência que chegou a ser feita; estreita a união para os testes lerem os campos dela. */
function conferir(ementa: string, citacao: string, reticenciasComoCorte = false): ConferenciaFeita {
  const r = conferirBruto(ementa, citacao, reticenciasComoCorte);
  if (r.veredito === "não verificável") throw new Error(`conferência não verificável: ${r.motivo}`);
  return r;
}

describe("conferência de citação na ementa — encontrado literalmente", () => {
  it("citação verdadeira: encontrado literalmente, na ementa, com a frase que a contém e sem equivalência", () => {
    const r = conferir(EMENTA, "exige a demonstração do nexo causal entre a falta do serviço");
    expect(r.veredito).toBe("encontrado literalmente");
    expect(r.total).toBe(1);
    expect(r.ocorrencias).toEqual([
      {
        local: "na ementa",
        frase:
          "1. A responsabilidade civil do Estado por omissão exige a demonstração do nexo causal entre a falta do " +
          "serviço e o dano sofrido.",
      },
    ]);
    expect(r.equivalencias).toEqual([]);
  });

  it.each([
    ["quebra de linha e espaço repetido", "o nexo\n causal entre  a falta do serviço", "nexo causal entre a falta do serviço", "espaço ou quebra de linha"],
    ["espaço não separável", "o nexo\u00a0causal entre a falta do serviço", "nexo causal entre a falta do serviço", "espaço não separável"],
    ["acento decomposto (NFD)", "a demonstração do nexo causal entre".normalize("NFD"), "a demonstração do nexo causal entre", "forma Unicode dos acentos"],
    ["aspas tipográficas", "dito “sem prova do nexo causal” não se indeniza", 'dito "sem prova do nexo causal" não se indeniza', "aspas ou apóstrofo tipográfico"],
    ["apóstrofo tipográfico", "a falta d’água no serviço público municipal", "a falta d'água no serviço público municipal", "aspas ou apóstrofo tipográfico"],
  ])("%s: encontrado literalmente, com a equivalência avisada", (_caso, fonte, citacao, equivalencia) => {
    const r = conferir(`EMENTA FICTÍCIA. Para ${fonte} e mais nada.`, citacao);
    expect(r.veredito).toBe("encontrado literalmente");
    expect(r.equivalencias).toEqual([equivalencia]);
    // A frase vem copiada da fonte, com a diagramação dela.
    expect((r.ocorrencias[0] as { frase: string }).frase).toContain(fonte.trim());
  });

  it("a equivalência vale também quando a diagramação diferente está na citação", () => {
    const r = conferir(EMENTA, "exige a demonstração\ndo nexo causal entre a falta do serviço");
    expect(r.veredito).toBe("encontrado literalmente");
    expect(r.equivalencias).toEqual(["espaço ou quebra de linha"]);
  });
});

describe("conferência de citação na ementa — nunca validar texto alterado", () => {
  it("uma palavra alterada: não encontrado, com a passagem parecida copiada da fonte e rotulada como diferente", () => {
    const r = conferir(EMENTA, "exige a demonstração do nexo causal entre a culpa do serviço e o dano sofrido");
    expect(r.veredito).toBe("não encontrado");
    expect(r.ocorrencias).toEqual([]);
    expect(r.passagemParecida).toEqual({
      texto: "exige a demonstração do nexo causal entre a falta do serviço e o dano sofrido",
      local: "na ementa",
      palavrasEmComum: "14 de 15 palavras da citação, na mesma ordem",
      aviso: "Passagem parecida copiada da fonte: não é o texto informado. Corrija a citação pela fonte antes de citar.",
    });
  });

  it("menos de 80% das palavras na mesma ordem: não encontrado, sem passagem parecida", () => {
    const r = conferir(EMENTA, "exige a prova do dano moral coletivo causado pela culpa do agente");
    expect(r.veredito).toBe("não encontrado");
    expect(r.passagemParecida).toBeUndefined();
  });

  it.each([
    ["acento diferente", "exige a demonstracao do nexo causal entre a falta do serviço"],
    ["número diferente", "EMENTA FICTÍCIA. ADMINISTRATIVO. RESPONSABILIDADE CIVIL DO ESTADO. 3. A responsabilidade"],
    ["frases juntadas sem marcador de corte", "exige a demonstração do nexo causal entre a falta do serviço e o dano sofrido. Recurso conhecido e não provido."],
  ])("%s: não encontrado", (_caso, citacao) => {
    expect(conferir(EMENTA, citacao).veredito).toBe("não encontrado");
  });

  it.each([
    ["maiúscula diferente", "Exige a demonstração do nexo causal entre a falta do serviço"],
    ["pontuação diferente", "exige a demonstração do nexo causal, entre a falta do serviço"],
    ["traço trocado (hífen por travessão)", "a ação de cobrança – ajuizada em data anterior ao prazo"],
  ])("%s: difere só em maiúsculas/pontuação (não literal), com o texto exato da fonte", (caso, citacao) => {
    const fonte = caso.startsWith("traço") ? `EMENTA FICTÍCIA. Na espécie, a ação de cobrança - ajuizada em data anterior ao prazo - foi extinta.` : EMENTA;
    const r = conferir(fonte, citacao);
    expect(r.veredito).toBe("difere só em maiúsculas/pontuação");
    expect((r.ocorrencias as { textoDaFonte?: string }[]).map((o) => o.textoDaFonte)).toEqual([
      caso.startsWith("traço")
        ? "a ação de cobrança - ajuizada em data anterior ao prazo"
        : "exige a demonstração do nexo causal entre a falta do serviço",
    ]);
  });

  it("hífen, meia-risca e travessão nunca são iguais entre si para o literal", () => {
    const fonte = "EMENTA FICTÍCIA. O prazo – contado da citação – foi respeitado pela parte autora.";
    expect(conferir(fonte, "O prazo — contado da citação — foi respeitado").veredito).not.toMatch(/^encontrado/);
    expect(conferir(fonte, "O prazo - contado da citação - foi respeitado").veredito).not.toMatch(/^encontrado/);
    expect(conferir(fonte, "O prazo – contado da citação – foi respeitado").veredito).toBe("encontrado literalmente");
  });
});

describe("conferência de citação na ementa — supressão indicada", () => {
  it.each(["(...)", "[...]"])("cortes com %s, pedaços na ordem: encontrado com supressão indicada, com a frase de cada pedaço", (corte) => {
    const r = conferir(EMENTA, `A responsabilidade civil do Estado ${corte} a falta do serviço e o dano sofrido. ${corte} Recurso conhecido e não provido.`);
    expect(r.veredito).toBe("encontrado com supressão indicada");
    expect(r.ocorrencias).toHaveLength(1);
    expect((r.ocorrencias as { pedacos: { frase: string }[] }[])[0].pedacos.map((p) => p.frase)).toEqual([
      "1. A responsabilidade civil do Estado por omissão exige a demonstração do nexo causal entre a falta do serviço e o dano sofrido.",
      "1. A responsabilidade civil do Estado por omissão exige a demonstração do nexo causal entre a falta do serviço e o dano sofrido.",
      "2. Recurso conhecido e não provido.",
    ]);
    expect(r.total).toBe("não apurado");
    expect(r.aviso).toMatch(/não confirma fidelidade ao sentido/);
  });

  it("pedaços fora de ordem: não encontrado", () => {
    const r = conferir(EMENTA, "Recurso conhecido e não provido. (...) A responsabilidade civil do Estado por omissão");
    expect(r.veredito).toBe("não encontrado");
  });

  it("um pedaço com uma palavra alterada derruba a citação inteira: não encontrado", () => {
    const r = conferir(EMENTA, "A responsabilidade civil do Estado (...) a culpa do serviço e o dano sofrido.");
    expect(r.veredito).toBe("não encontrado");
  });

  it("reticências soltas são procuradas como texto por padrão", () => {
    const fonte = "EMENTA FICTÍCIA. O autor alegou que o prazo... foi cumprido em tempo hábil pelo réu.";
    expect(conferir(fonte, "alegou que o prazo... foi cumprido em tempo hábil").veredito).toBe("encontrado literalmente");
    expect(conferir(EMENTA, "A responsabilidade civil do Estado ... a falta do serviço e o dano sofrido.").veredito).toBe("não encontrado");
  });

  it("reticências soltas valem como corte só com a opção ligada", () => {
    const r = conferir(EMENTA, "A responsabilidade civil do Estado … a falta do serviço e o dano sofrido.", true);
    expect(r.veredito).toBe("encontrado com supressão indicada");
  });
});

describe("conferência de citação — erro de entrada ensina a corrigir", () => {
  it.each([
    ["menos de 5 palavras", "nexo causal do dano", /tem 4 palavras; o mínimo é 5/],
    ["pedaço entre cortes com menos de 5 palavras", "A responsabilidade civil do Estado (...) o dano sofrido", /pedaço 2 .*tem 3 palavras.*pelo menos 5/],
    ["mais de 3 mil caracteres", "palavra ".repeat(400), /tem 3199 caracteres; o máximo é 3 mil/],
  ])("%s: recusa com frase que ensina a corrigir", (_caso, citacao, mensagem) => {
    expect(() => lerCitacao(citacao, { reticenciasComoCorte: false })).toThrow(mensagem);
  });
});

describe("conferência de citação — ocorrências e fonte sem texto", () => {
  it("mostra até 10 ocorrências, com o total e o aviso de corte", () => {
    const fonte = Array.from({ length: 12 }, (_, i) => `${i + 1}. O prazo prescricional é de cinco anos.`).join(" ");
    const r = conferir(fonte, "O prazo prescricional é de cinco anos");
    expect(r.veredito).toBe("encontrado literalmente");
    expect(r.ocorrencias).toHaveLength(10);
    expect(r.total).toBe(12);
    expect(r.aviso).toMatch(/10 de 12 ocorrências/);
  });

  it("ementa vazia: não verificável, nunca não encontrado", () => {
    const r = conferirBruto("   ", "exige a demonstração do nexo causal");
    expect(r.veredito).toBe("não verificável");
    if (r.veredito !== "não verificável") return;
    expect(r.motivo).toMatch(/sem ementa/);
  });
});

describe("conferência de citação na ementa — sinal de outro autor (só aspas)", () => {
  const SINAL = "pode ser de outro autor: a passagem está entre aspas na ementa";

  it.each([
    ["aspas tipográficas", "EMENTA FICTÍCIA. Como diz a doutrina, “o dano moral coletivo prescinde de prova do abalo psíquico”, e assim decidiu a corte."],
    ["aspas retas", 'EMENTA FICTÍCIA. Como diz a doutrina, "o dano moral coletivo prescinde de prova do abalo psíquico", e assim decidiu a corte.'],
  ])("passagem entre %s: aviso com o sinal observado, sem dizer de quem é", (_caso, fonte) => {
    const r = conferir(fonte, "dano moral coletivo prescinde de prova do abalo psíquico");
    expect(r.veredito).toBe("encontrado literalmente");
    expect((r.ocorrencias as { sinalDeOutroAutor?: string }[])[0].sinalDeOutroAutor).toBe(SINAL);
  });

  it("passagem fora de aspas: sem sinal (a falta de sinal não é afirmada como prova de nada)", () => {
    const fonte = "EMENTA FICTÍCIA. Disse “isto” antes. O dano moral coletivo prescinde de prova do abalo psíquico. Fim “aqui”.";
    const r = conferir(fonte, "dano moral coletivo prescinde de prova do abalo psíquico");
    expect((r.ocorrencias as { sinalDeOutroAutor?: string }[])[0].sinalDeOutroAutor).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/do tribunal/);
  });
});

describe("conferência de citação — casos achados na revisão", () => {
  it("abreviatura (\"Rel. Min.\") e número de artigo (\"art. 37.\") não cortam a frase no lugar errado", () => {
    const fonte = "EMENTA FICTÍCIA. Conforme o voto do Rel. Min. Fulano de Tal, a omissão estatal gera o dever de indenizar. Aplica-se o art. 37. O dano decorre da falta do serviço público.";
    const frase = (citacao: string) => (conferir(fonte, citacao).ocorrencias as { frase: string }[])[0].frase;
    expect(frase("a omissão estatal gera o dever de indenizar")).toBe(
      "Conforme o voto do Rel. Min. Fulano de Tal, a omissão estatal gera o dever de indenizar.",
    );
    expect(frase("O dano decorre da falta do serviço")).toBe("O dano decorre da falta do serviço público.");
  });

  it("aspa reta depois de número (polegada) não abre aspas", () => {
    const r = conferir('EMENTA FICTÍCIA. A medida de 5" foi aceita. O dano decorre da falta do serviço público.', "O dano decorre da falta do serviço");
    expect((r.ocorrencias as { sinalDeOutroAutor?: string }[])[0].sinalDeOutroAutor).toBeUndefined();
  });

  it("citação que começa na própria aspa de abertura também recebe o sinal", () => {
    const r = conferir("EMENTA FICTÍCIA. Diz a doutrina: “o dano moral coletivo prescinde de prova do abalo”.", "“o dano moral coletivo prescinde de prova");
    expect(r.veredito).toBe("encontrado literalmente");
    expect((r.ocorrencias as { sinalDeOutroAutor?: string }[])[0].sinalDeOutroAutor).toMatch(/entre aspas/);
  });

  it("número com separador diferente (10.000 × 10,000) não é \"difere só em pontuação\"", () => {
    const r = conferir("EMENTA FICTÍCIA. A indenização foi fixada em R$ 10.000 pelo juízo de origem.", "A indenização foi fixada em R$ 10,000 pelo juízo");
    expect(r.veredito).toBe("não encontrado");
  });

  it.each([0.1, 0.25, 0.4])(
    "trecho do meio tirado sem (...) (%s das palavras): não encontrado, com a passagem parecida da frase inteira",
    (fracao) => {
      const frase =
        "A tutela coletiva do patrimônio público exige demonstração concreta da lesão ao erário causada pelo ato " +
        "administrativo impugnado nos autos originários";
      const ementa = `EMENTA FICTÍCIA. ADMINISTRATIVO. 1. ${frase}. 2. Recurso conhecido e não provido.`;
      const p = frase.split(" ");
      const tirar = Math.round(p.length * fracao);
      const de = Math.floor((p.length - tirar) / 2);
      const citacao = [...p.slice(0, de), ...p.slice(de + tirar)].join(" ");

      const r = conferir(ementa, citacao);
      expect(r.veredito).toBe("não encontrado");
      expect(r.passagemParecida?.texto).toBe(frase);
      expect(r.passagemParecida?.palavrasEmComum).toBe(`${p.length - tirar} de ${p.length - tirar} palavras da citação, na mesma ordem`);
    },
  );

  it("passagem parecida em ementa longa de palavras comuns sai em tempo de uso (menos de 1 s)", () => {
    const comuns = ["a", "de", "o", "que", "e", "do", "da", "em", "um", "para"];
    const fonte = Array.from({ length: 3000 }, (_, i) => comuns[(i * 7) % comuns.length]).join(" ");
    const citacao = Array.from({ length: 300 }, (_, i) => comuns[(i * 3) % comuns.length]).join(" ") + " fim";
    const t = performance.now();
    conferir(fonte, citacao);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe("conferência de citação — ajustes da revisão de spec", () => {
  it.each([
    ["sinal de porcentagem", "EMENTA FICTÍCIA. Juros de 1% ao mês desde a citação válida.", "Juros de 1 ao mês desde a citação"],
    ["sinal de parágrafo", "EMENTA FICTÍCIA. Nos termos do art. 5º, § 2º, da lei de regência aplicável.", "Nos termos do art. 5º, 2º, da lei de regência"],
  ])("%s que some não é \"difere só em pontuação\": não encontrado", (_caso, fonte, citacao) => {
    expect(conferir(fonte, citacao).veredito).toBe("não encontrado");
  });

  it("passagem que contém a aspa de abertura (começa antes dela) também recebe o sinal", () => {
    const r = conferir("EMENTA FICTÍCIA. Diz a doutrina, “o dano moral coletivo prescinde de prova do abalo”.", "Diz a doutrina, “o dano moral coletivo prescinde");
    expect((r.ocorrencias as { sinalDeOutroAutor?: string }[])[0].sinalDeOutroAutor).toMatch(/entre aspas/);
  });

  it("citação com corte não encontrada: vem a passagem parecida, copiada da fonte", () => {
    const r = conferir(EMENTA, "A responsabilidade civil do Município (...) exige a demonstração do nexo causal");
    expect(r.veredito).toBe("não encontrado");
    expect(r.passagemParecida?.texto).toBe("A responsabilidade civil do Estado por omissão exige a demonstração do nexo causal");
  });

  it("\"(…)\" com reticência de um caractere só não é corte por padrão (ADR-0006: só (...) e [...]); com a opção, é", () => {
    const citacao = "A responsabilidade civil do Estado (…) a falta do serviço e o dano sofrido.";
    expect(conferir(EMENTA, citacao).veredito).toBe("não encontrado");
    expect(conferir(EMENTA, citacao, true).veredito).toBe("encontrado com supressão indicada");
  });

  it("não verificável vem só com o motivo, sem contagem", () => {
    expect(conferirBruto("", "exige a demonstração do nexo causal")).toEqual({
      veredito: "não verificável",
      motivo: "O acórdão veio sem ementa do JurisprudênciaIA: não há texto para conferir.",
    });
  });
});

describe("conferência de citação no inteiro teor — limites (módulo puro)", () => {
  /** Inteiro teor fictício: uma página do PDF por texto ("" = página sem texto extraível), tudo na parte 1. */
  function inteiroTeor(paginas: string[]): InteiroTeorParaConferir {
    return {
      origem: "não conferida",
      totalDePaginas: paginas.length,
      totalDePartes: 1,
      unidades: paginas.map((texto, i) => ({ pagina: i + 1, parte: 1, texto })),
    };
  }
  const conferirPdf = (paginas: string[], citacao: string) =>
    conferirNoInteiroTeor(inteiroTeor(paginas), lerCitacao(citacao, { reticenciasComoCorte: false }));
  const PRIMEIRO = "Primeiro pedaco ficticio da fundamentacao.";
  const SEGUNDO = "Segundo pedaco ficticio da mesma fundamentacao.";
  const SUPRIMIDA = "Primeiro pedaco ficticio da fundamentacao (...) Segundo pedaco ficticio da mesma fundamentacao";

  it.each([
    ["na página seguinte", [PRIMEIRO, SEGUNDO], "encontrado com supressão indicada"],
    ["3 páginas seguidas", [PRIMEIRO, "Texto do meio.", SEGUNDO], "encontrado com supressão indicada"],
    ["4 páginas", [PRIMEIRO, "Texto do meio.", "Mais texto.", SEGUNDO], "não encontrado"],
  ])("supressão com os pedaços espalhados em %s: %s", (_caso, paginas, veredito) => {
    expect(conferirPdf(paginas, SUPRIMIDA).veredito).toBe(veredito);
  });

  it("supressão: vale a cadeia que cabe em 3 páginas, mesmo com o 1º pedaço também numa página distante antes", () => {
    const r = conferirPdf([PRIMEIRO, "a", "b", "c", PRIMEIRO, SEGUNDO], SUPRIMIDA);
    expect(r.veredito).toBe("encontrado com supressão indicada");
  });

  it.each([
    [3, true],
    [4, false],
  ])("quebra de página com %i linhas de rodapé no meio: passagem candidata só até 3 linhas", (n, candidata) => {
    const rodape = Array.from({ length: n }, (_, i) => `Rodape ficticio ${i + 1}`).join("\n");
    const r = conferirPdf(
      [`Texto antes.\nEm resumo, a responsabilidade civil do ente\n${rodape}`, "ficticio exige prova do nexo causal.\nTexto depois."],
      "a responsabilidade civil do ente ficticio exige prova do nexo causal",
    );
    expect(r.veredito).toBe("não encontrado");
    expect("passagemCandidata" in r).toBe(candidata);
  });

  it("a página inteira pulada não é cabeçalho nem rodapé: sem passagem candidata", () => {
    const r = conferirPdf(
      ["Texto antes.\nEm resumo, a responsabilidade civil do ente", "LINHA UNICA", "ficticio exige prova do nexo causal.\nTexto depois."],
      "a responsabilidade civil do ente ficticio exige prova do nexo causal",
    );
    expect(r.veredito).toBe("não encontrado");
    expect("passagemCandidata" in r).toBe(false);
  });

  it("caixa diferente no PDF: difere só em maiúsculas/pontuação, com o texto exato da fonte e a página", () => {
    const r = conferirPdf(["Texto.\nA RESPONSABILIDADE CIVIL DO ENTE FICTICIO exige prova."], "a responsabilidade civil do ente ficticio exige prova");
    expect(r.veredito).toBe("difere só em maiúsculas/pontuação");
    expect("ocorrencias" in r && r.ocorrencias[0]).toEqual({
      local: "no inteiro teor",
      paginasDoPdf: "página 1 de 1",
      parte: "parte 1 de 1",
      textoDaFonte: "A RESPONSABILIDADE CIVIL DO ENTE FICTICIO exige prova",
      secao: "não identificada",
    });
  });

  it("marcador de transcrição longe da passagem (fora da janela curta) não dá sinal", () => {
    const longe = `Confira-se: ${"texto generico ficticio de permeio ".repeat(10)}`;
    const r = conferirPdf([`${longe}\na responsabilidade civil do ente ficticio exige prova`], "a responsabilidade civil do ente ficticio exige prova");
    expect(r.veredito).toBe("encontrado literalmente");
    expect("ocorrencias" in r && r.ocorrencias[0]).not.toHaveProperty("sinalDeOutroAutor");
  });

  it("passagem candidata com maiúsculas diferentes diz isso no motivo, além do hífen", () => {
    const r = conferirPdf(
      ["Texto.\nA RESPONSABILIDADE CIVIL DO ENTE FIC-\nTICIO exige prova."],
      "a responsabilidade civil do ente ficticio exige prova",
    );
    expect(r.veredito).toBe("não encontrado");
    expect("passagemCandidata" in r && r.passagemCandidata?.motivo).toMatch(/nunca o retira.*; e ainda difere em maiúsculas\/pontuação$/);
  });
});

describe("conferência de citação no inteiro teor — seção do acórdão (módulo puro)", () => {
  function inteiroTeor(paginas: string[]): InteiroTeorParaConferir {
    return {
      origem: "não conferida",
      totalDePaginas: paginas.length,
      totalDePartes: 1,
      unidades: paginas.map((texto, i) => ({ pagina: i + 1, parte: 1, texto })),
    };
  }
  const CITACAO = "a responsabilidade civil do ente ficticio exige prova do nexo causal";
  /** A 1ª ocorrência da citação no PDF fictício. */
  function ocorrencia(paginas: string[], citacao = CITACAO) {
    const r = conferirNoInteiroTeor(inteiroTeor(paginas), lerCitacao(citacao, { reticenciasComoCorte: false }));
    expect(r.veredito).toBe("encontrado literalmente");
    return (r as { ocorrencias: { secao?: string; sinalDeOutroAutor?: string }[] }).ocorrencias[0];
  }

  it.each([
    ["EMENTA", "ementa"],
    ["ACÓRDÃO", "acórdão"],
    ["VOTO", "voto"],
    ["VOTO-VISTA", "voto-vista"],
    ["VOTO VISTA", "voto-vista"],
    ["VOTO VOGAL", "voto vogal"],
    ["CERTIDÃO", "certidão"],
    ["CERTIDÃO DE JULGAMENTO", "certidão"],
    ["V O T O", "voto"],
    ["V O T O  V E N C I D O", "voto vencido"],
    ["V O T O V E N C I D O", "voto vencido"],
    ["VOTO-VENCIDO", "voto vencido"],
    ["VOTO VENCIDO DO DESEMBARGADOR FICTICIO", "voto vencido"],
    ["Voto vencido", "voto vencido"],
    ["Relatório", "relatório"],
    ["Voto", "voto"],
    ["VOTO:", "voto"],
  ])("título \"%s\" sozinho na linha: seção %s (aviso forte só no relatório e no voto vencido)", (titulo, secao) => {
    const o = ocorrencia([`Cabecalho ficticio.
${titulo}
Texto antes.
Para ${CITACAO}.`]);
    expect(o.secao).toBe(secao);
    expect(Boolean(o.sinalDeOutroAutor)).toBe(secao === "relatório" || secao === "voto vencido");
  });

  it.each(["RELATÓRIO.", "VOTO VENCIDO."])("fim de frase de ementa em maiúsculas (\"%s\" sozinho na linha) não é título: segue a ementa, sem aviso", (linha) => {
    const o = ocorrencia([`EMENTA
PROCESSUAL CIVIL. FICTICIO. NULIDADE DO
${linha}
Tese: ${CITACAO}.`]);
    expect(o.secao).toBe("ementa");
    expect(o.sinalDeOutroAutor).toBeUndefined();
  });

  it("ementa transcrita dentro do relatório (\"EMENTA\" sozinho na linha) não fecha o relatório: aviso forte mantido", () => {
    const o = ocorrencia([`EMENTA
Texto da ementa ficticia.
RELATÓRIO
A sentenca ficticia tem esta ementa:
EMENTA
Para ${CITACAO}.
VOTO
Texto do voto.`]);
    expect(o.secao).toBe("relatório");
    expect(o.sinalDeOutroAutor).toMatch(/^ATENÇÃO, pode ser de outro autor: a passagem está no relatório/);
  });

  it("passagem no relatório: aviso forte, com o título e a página do PDF dele, sem atribuir autoria", () => {
    const o = ocorrencia(["EMENTA\nTexto da ementa ficticia.", `RELATÓRIO\nO autor alega que ${CITACAO}.`, "VOTO\nTexto do voto."]);
    expect(o.secao).toBe("relatório");
    expect(o.sinalDeOutroAutor).toBe(
      'ATENÇÃO, pode ser de outro autor: a passagem está no relatório (título "RELATÓRIO" na página 2 do PDF), que ' +
        "costuma reproduzir alegações das partes e decisões anteriores; não a cite como fundamento do tribunal sem " +
        "conferir no PDF",
    );
  });

  it("passagem no voto vencido: aviso forte; o voto antes dele não muda isso", () => {
    const o = ocorrencia(["VOTO\nTexto do voto do relator.", `VOTO VENCIDO\nDivirjo, porque ${CITACAO}.`]);
    expect(o.secao).toBe("voto vencido");
    expect(o.sinalDeOutroAutor).toBe(
      'ATENÇÃO, pode ser de outro autor: a passagem está num voto vencido (título "VOTO VENCIDO" na página 2 do ' +
        "PDF), que, pelo título, não prevaleceu no julgamento; não a cite como fundamento do tribunal sem conferir no " +
        "PDF",
    );
  });

  it("aviso forte da seção vem junto do marcador de transcrição, quando os dois aparecem", () => {
    const o = ocorrencia([`RELATÓRIO\nAlega o recorrente, in verbis:\n${CITACAO}.`]);
    expect(o.sinalDeOutroAutor).toMatch(/^ATENÇÃO, pode ser de outro autor: a passagem está no relatório .*; logo antes da passagem há o marcador de transcrição "in verbis"$/);
  });

  it("sem título com forma de seção antes da passagem: não identificada, sem sinal", () => {
    const o = ocorrencia([`Texto ficticio sem titulo nenhum.\nPara ${CITACAO}.`, "RELATÓRIO\nDepois da passagem."]);
    expect(o.secao).toBe("não identificada");
    expect(o.sinalDeOutroAutor).toBeUndefined();
  });

  it.each([
    ["depois de linha que termina em dois-pontos", "Cabecalho ficticio\nO tribunal ja decidiu caso generico assim:"],
    ["depois de marcador de transcrição", "Cabecalho ficticio\nCita-se o precedente generico, in verbis"],
    ["depois de linha de corpo que fecha frase", "Texto ficticio da decisao, sem titulo nenhum, sobre caso generico.\nCabecalho"],
  ])("decisão sem títulos citando \"EMENTA: …\" %s: ementa de outro julgado, seção não identificada", (_caso, antes) => {
    const o = ocorrencia([`${antes}\nEMENTA: PROCESSUAL CIVIL. FICTICIO.\nPara ${CITACAO}.`]);
    expect(o.secao).toBe("não identificada");
  });

  it("\"EMENTA: …\" no começo do documento, depois só do cabeçalho: abre a ementa", () => {
    const o = ocorrencia([`PODER JUDICIARIO\nApelacao Civel ficticia n. 0000\nEMENTA: PROCESSUAL CIVIL. FICTICIO.\nPara ${CITACAO}.`]);
    expect(o.secao).toBe("ementa");
  });

  it.each([
    ["\"voto\" no corpo do texto", "Acompanho o voto do relator, no sentido de que"],
    ["\"relatório\" no corpo do texto", "Conforme o relatório, adoto o entendimento de que"],
    ["título em minúsculas no meio da frase", "voto vencido"],
    ["título que só começa com letra maiúscula, com mais palavras", "Voto vencido do Desembargador ficticio no ponto"],
  ])("%s não muda a seção", (_caso, linha) => {
    const o = ocorrencia([`VOTO\nTexto do voto.\n${linha}\n${CITACAO}.`]);
    expect(o.secao).toBe("voto");
    expect(o.sinalDeOutroAutor).toBeUndefined();
  });

  it("passagem que atravessa um título de seção: as duas seções, com o aviso forte se uma delas o pede", () => {
    const o = ocorrencia(
      ["RELATÓRIO\nTexto do relatorio termina aqui com estas palavras finais\nVOTO\nE o voto comeca com estas palavras iniciais."],
      "termina aqui com estas palavras finais VOTO E o voto comeca",
    );
    expect(o.secao).toBe("relatório e voto (a passagem atravessa um título de seção)");
    expect(o.sinalDeOutroAutor).toMatch(/^ATENÇÃO, pode ser de outro autor: a passagem está no relatório/);
  });

  it("supressão: cada pedaço com a sua seção", () => {
    const r = conferirNoInteiroTeor(
      inteiroTeor(["RELATÓRIO\nPrimeiro pedaco ficticio da fundamentacao.", "VOTO\nSegundo pedaco ficticio da mesma fundamentacao."]),
      lerCitacao("Primeiro pedaco ficticio da fundamentacao (...) Segundo pedaco ficticio da mesma fundamentacao", {
        reticenciasComoCorte: false,
      }),
    );
    expect(r.veredito).toBe("encontrado com supressão indicada");
    const [{ pedacos }] = (r as { ocorrencias: { pedacos: { secao: string }[] }[] }).ocorrencias;
    expect(pedacos.map((p) => p.secao)).toEqual(["relatório", "voto"]);
  });

  it("na ementa do JurisprudênciaIA não há seção: o campo não aparece", () => {
    const r = conferirNaEmenta(`EMENTA FICTÍCIA. Para ${CITACAO}.`, lerCitacao(CITACAO, { reticenciasComoCorte: false }));
    expect((r as { ocorrencias: object[] }).ocorrencias[0]).not.toHaveProperty("secao");
  });
});

describe("conferência de citação — posição no julgado (G-09)", () => {
  /** Lê um PDF sintético como o conferir_citacao lê o PDF trazido: gravado numa pasta temporária. */
  async function lerPdf(bytes: Uint8Array): Promise<InteiroTeorParaConferir> {
    const pasta = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-posicao-"));
    const caminho = join(pasta, "acordao-ficticio.pdf");
    await writeFile(caminho, bytes);
    return lerParaConferir(caminho);
  }
  function inteiroTeor(paginas: string[]): InteiroTeorParaConferir {
    return {
      origem: "não conferida",
      totalDePaginas: paginas.length,
      totalDePartes: 1,
      unidades: paginas.map((texto, i) => ({ pagina: i + 1, parte: 1, texto })),
    };
  }
  /** O veredito, o total e a seção e a subparte de cada ocorrência. */
  function posicoes(r: ResultadoDaFonte) {
    if (r.veredito === "não verificável") throw new Error(`conferência não verificável: ${r.motivo}`);
    return {
      veredito: r.veredito,
      total: r.total,
      posicoes: (r.ocorrencias as { secao?: string; subparte?: string }[]).map(({ secao, subparte }) => ({ secao, subparte })),
    };
  }
  const citar = (citacao: string) => lerCitacao(citacao, { reticenciasComoCorte: false });
  const FRASE = "o prazo generico de prescricao e de cinco anos";

  it.each([
    ["Apelacao contra sentenca que julgou improcedente o pedido", "caso em exame"],
    ["Ha duas questoes em discussao: (i) a validade do negocio", "questão em discussão"],
    ["O negocio e valido quando presentes os requisitos legais genericos", "razões de decidir"],
    ["Tese de julgamento: o negocio generico e valido", "dispositivo e tese"],
  ])("ementa padronizada (títulos I a IV): \"%s\" fica na ementa, em %s", async (citacao, subparte) => {
    const r = conferirNoInteiroTeor(await lerPdf(pdfEmentaPadronizada()), citar(citacao));
    expect(posicoes(r)).toEqual({ veredito: "encontrado literalmente", total: 1, posicoes: [{ secao: "ementa", subparte }] });
  });

  it("depois da ementa padronizada, o relatório (título sem acento) não herda a subparte da ementa", async () => {
    const r = conferirNoInteiroTeor(await lerPdf(pdfEmentaPadronizada()), citar("Trata-se de apelacao interposta contra sentenca"));
    expect(posicoes(r).posicoes).toEqual([{ secao: "relatório", subparte: undefined }]);
  });

  it.each([
    ["Trata-se de recurso contra decisao generica de primeiro grau", "relatório", undefined],
    [
      "Fundamentacao generica do relator. Ante o exposto, voto",
      "voto",
      "fundamentação e dispositivo (a passagem atravessa a fórmula que abre o dispositivo)",
    ],
    ["Ante o exposto, voto por dar provimento ao recurso", "voto", "dispositivo"],
    ["proferiu a seguinte decisao: recurso provido", "certidão", undefined],
  ])("voto com dispositivo aberto por \"Ante o exposto\" e certidão: \"%s\" em %s, %s", async (citacao, secao, subparte) => {
    const r = conferirNoInteiroTeor(await lerPdf(pdfComDispositivoECertidao()), citar(citacao));
    expect(posicoes(r).posicoes).toEqual([{ secao, subparte }]);
  });

  it("texto integral do Falcão sem títulos: seção não identificada, sem subparte inventada", () => {
    const texto =
      "Texto ficticio do acordao trabalhista sem titulo nenhum. A responsabilidade do ente ficticio exige prova do " +
      "nexo causal. Ante o exposto, nega-se provimento ao recurso ficticio.";
    const r = conferirNoTextoIntegral(texto, citar("Ante o exposto, nega-se provimento ao recurso ficticio"));
    expect(posicoes(r)).toEqual({
      veredito: "encontrado literalmente",
      total: 1,
      posicoes: [{ secao: "não identificada", subparte: undefined }],
    });
    expect((r as ConferenciaFeita).ocorrencias[0]).not.toHaveProperty("subparte");
  });

  it("a posição nunca amplia nem restringe a busca: com ou sem títulos, o mesmo veredito e as mesmas ocorrências", () => {
    const comTitulos = [
      `EMENTA\nI. Caso em exame\n1. Recurso ficticio.\nII. Questão em discussão\n2. Saber se ${FRASE}.`,
      `VOTO\nNo merito, ${FRASE}, como ja decidido.\nAnte o exposto, nego provimento.`,
    ];
    const semTitulos = [`Texto ficticio.\n1. Recurso ficticio.\n2. Saber se ${FRASE}.`, `No merito, ${FRASE}, como ja decidido.`];
    const com = posicoes(conferirNoInteiroTeor(inteiroTeor(comTitulos), citar(FRASE)));
    const sem = posicoes(conferirNoInteiroTeor(inteiroTeor(semTitulos), citar(FRASE)));
    expect(com).toEqual({
      veredito: "encontrado literalmente",
      total: 2,
      posicoes: [
        { secao: "ementa", subparte: "questão em discussão" },
        { secao: "voto", subparte: "fundamentação" },
      ],
    });
    expect({ ...sem, posicoes: undefined }).toEqual({ ...com, posicoes: undefined });
    expect(sem.posicoes).toEqual([
      { secao: "não identificada", subparte: undefined },
      { secao: "não identificada", subparte: undefined },
    ]);
  });

  it("passagem que atravessa o título da subparte: as duas subpartes, ditas como atravessadas", () => {
    const paginas = ["EMENTA\nI. Caso em exame\n1. Recurso ficticio generico de apelacao.\nII. Questão em discussão\n2. Saber algo."];
    const r = conferirNoInteiroTeor(
      inteiroTeor(paginas),
      citar("Recurso ficticio generico de apelacao. II. Questão em discussão 2. Saber"),
    );
    expect(posicoes(r).posicoes).toEqual([
      { secao: "ementa", subparte: "caso em exame e questão em discussão (a passagem atravessa um título)" },
    ]);
  });

  it.each([
    ["título da ementa padronizada fora da ementa (no voto)", `VOTO\nQuestão em discussão\nNo merito, ${FRASE}.`],
    ["\"ante o exposto\" no meio da frase do voto", `VOTO\nO autor, ante o exposto na inicial, pede algo. No merito, ${FRASE}.`],
  ])("%s: voto sem fórmula inequívoca do dispositivo, sem subparte (na dúvida, não dar subparte)", (_caso, pagina) => {
    const r = conferirNoInteiroTeor(inteiroTeor([pagina]), citar(FRASE));
    expect(posicoes(r).posicoes).toEqual([{ secao: "voto", subparte: undefined }]);
  });

  it("\"ante o exposto\" no começo de linha que continua a frase (quebra depois da vírgula): fundamentação do voto", () => {
    const pagina = `VOTO\nO autor,\nante o exposto na inicial, insiste. No merito, ${FRASE}.\nAnte o exposto, nego provimento.`;
    const r = conferirNoInteiroTeor(inteiroTeor([pagina]), citar(FRASE));
    expect(posicoes(r).posicoes).toEqual([{ secao: "voto", subparte: "fundamentação" }]);
  });

  it.each(["Voto", "Voto-vista", "Voto vogal", "VOTO"])(
    "título \"%s\" logo antes de \"Ante o exposto\": a fórmula abre o dispositivo (o título não continua a frase)",
    (titulo) => {
      const r = conferirNoInteiroTeor(inteiroTeor([`${titulo}\nAnte o exposto, ${FRASE}.`]), citar(FRASE));
      expect(posicoes(r).posicoes[0].subparte).toBe("dispositivo");
    },
  );

  it("\"Ante o exposto\" no relatório não abre dispositivo: só o voto tem dispositivo", () => {
    const r = conferirNoInteiroTeor(inteiroTeor([`RELATÓRIO\nAnte o exposto, o autor pede que ${FRASE}.`]), citar(FRASE));
    expect(posicoes(r).posicoes).toEqual([{ secao: "relatório", subparte: undefined }]);
  });

  it("texto integral do Falcão em HTML com títulos: \"Ante o exposto\" em parágrafo próprio abre o dispositivo", () => {
    const html =
      "<p>RELATÓRIO</p><p>Trata-se de recurso.</p><p>Voto</p>" +
      "<p>Ante o exposto, nego provimento ao recurso interposto pela parte.</p>";
    const r = conferirNoTextoIntegral(htmlParaTexto(html), citar("nego provimento ao recurso interposto pela parte"));
    expect(posicoes(r).posicoes).toEqual([{ secao: "voto", subparte: "dispositivo" }]);
  });

  it("precedente citado sem ponto final no parágrafo anterior não impede o dispositivo do parágrafo seguinte", () => {
    const html =
      "<p>VOTO</p><p>Nesse sentido: REsp 1.234/XX, Rel. Min. Fulano, DJe 10/10/2020</p>" +
      "<p>Ante o exposto, nego provimento ao recurso ficticio.</p>";
    const r = conferirNoTextoIntegral(htmlParaTexto(html), citar("nego provimento ao recurso ficticio"));
    expect(posicoes(r).posicoes).toEqual([{ secao: "voto", subparte: "dispositivo" }]);
  });

  it("decisão transcrita depois de dois-pontos: a fundamentação seguinte nunca vira dispositivo (na dúvida, sem subparte)", () => {
    const pagina =
      "VOTO\nA sentença assim decidiu:\nAnte o exposto, julgo procedente o pedido inicial.\n" +
      "No entanto, a responsabilidade civil exige a demonstração do nexo causal entre a falta e o dano.\n" +
      "Ante o exposto, nego provimento.";
    const r = conferirNoInteiroTeor(
      inteiroTeor([pagina]),
      citar("a responsabilidade civil exige a demonstração do nexo causal"),
    );
    const [{ secao, subparte }] = posicoes(r).posicoes;
    expect(secao).toBe("voto");
    expect(subparte).not.toBe("dispositivo");
    expect([undefined, "fundamentação"]).toContain(subparte);
  });

  it.each([
    ["só a última fórmula vale: a primeira, seguida de outra, não abre o dispositivo",
      `VOTO\nAnte o exposto na inicial, o autor insiste.\nNo merito, ${FRASE}.\nAnte o exposto, nego provimento.`, "fundamentação"],
    ["fórmula depois de aspas abertas (transcrição) não abre o dispositivo",
      `VOTO\nConsta da sentença: “Fundamentos genericos.\nAnte o exposto, ${FRASE}.”`, undefined],
    ["fórmula depois de \"in verbis\" não abre o dispositivo",
      `VOTO\nA sentença decidiu, in verbis.\nAnte o exposto, ${FRASE}.`, undefined],
    ["fórmula no meio da linha, depois de ponto, não abre o dispositivo",
      `VOTO\nFundamentos genericos. Ante o exposto, ${FRASE}.`, undefined],
  ])("%s", (_caso, pagina, subparte) => {
    const r = conferirNoInteiroTeor(inteiroTeor([pagina]), citar(FRASE));
    expect(posicoes(r).posicoes).toEqual([{ secao: "voto", subparte }]);
  });

  it("na ementa do JurisprudênciaIA não há subparte: o campo não aparece", () => {
    const r = conferirNaEmenta(`EMENTA FICTÍCIA. I. Caso em exame. 1. Para ${FRASE}.`, citar(FRASE));
    expect((r as ConferenciaFeita).ocorrencias[0]).not.toHaveProperty("subparte");
  });
});

describe("conferência de citação — sinais de \"quem disse\" (G-08), desligados por padrão e ligados um a um", () => {
  async function lerPdf(bytes: Uint8Array): Promise<InteiroTeorParaConferir> {
    const pasta = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-quem-disse-"));
    const caminho = join(pasta, "acordao-ficticio.pdf");
    await writeFile(caminho, bytes);
    return lerParaConferir(caminho);
  }
  function inteiroTeor(paginas: string[]): InteiroTeorParaConferir {
    return {
      origem: "não conferida",
      totalDePaginas: paginas.length,
      totalDePartes: 1,
      unidades: paginas.map((texto, i) => ({ pagina: i + 1, parte: 1, texto })),
    };
  }
  const citar = (citacao: string) => lerCitacao(citacao, { reticenciasComoCorte: false });
  /** O sinal de outro autor da 1ª ocorrência (a citação tem de ser achada literalmente). */
  function sinal(r: ResultadoDaFonte): string | undefined {
    expect(r.veredito).toBe("encontrado literalmente");
    return (r as { ocorrencias: { sinalDeOutroAutor?: string }[] }).ocorrencias[0].sinalDeOutroAutor;
  }
  /** O aviso de hoje para a passagem no relatório aberto na página `pagina` do PDF. */
  const avisoDoRelatorio = (pagina: number) =>
    `ATENÇÃO, pode ser de outro autor: a passagem está no relatório (título "RELATORIO" na página ${pagina} do PDF), ` +
    "que costuma reproduzir alegações das partes e decisões anteriores; não a cite como fundamento do tribunal sem " +
    "conferir no PDF";

  it("os cinco interruptores existem e nascem desligados", () => {
    expect(SINAIS_DE_QUEM_DISSE).toEqual({
      negacao: false,
      alegacaoDaParte: false,
      ementaTranscrita: false,
      divergencia: false,
      raciocinioHipotetico: false,
    });
  });

  it.each([
    ["negação", "o negocio generico e nulo por vicio de forma", 1],
    ["alegação da parte", "o prazo generico seria decenal", 2],
    ["ementa transcrita", "A prescricao da pretensao generica ocorre em tres anos", 2],
    ["voto divergente", "para negar provimento, por entender valido o negocio generico", 2],
    ["raciocínio hipotético", "o resultado seria o mesmo, pois o prazo ja estaria vencido", 2],
  ])("desligados, a passagem de %s tem o mesmo aviso de hoje (só o do relatório)", async (_caso, citacao, pagina) => {
    const leitura = await lerPdf(pdfComSinaisDeAutoria());
    expect(sinal(conferirNoInteiroTeor(leitura, citar(citacao)))).toBe(avisoDoRelatorio(pagina));
  });

  /** Só o sinal pedido ligado. */
  const so = (sinal: keyof typeof SINAIS_DE_QUEM_DISSE) => ({ ...SINAIS_DE_QUEM_DISSE, [sinal]: true });

  it("negação ligada: \"não\" logo antes, na mesma oração, vira sinal (o sentido pode estar invertido)", async () => {
    const leitura = await lerPdf(pdfComSinaisDeAutoria());
    const r = conferirNoInteiroTeor(leitura, citar("o negocio generico e nulo por vicio de forma"), so("negacao"));
    expect(sinal(r)).toBe(
      `${avisoDoRelatorio(1)}; logo antes da passagem, na mesma oração, há a negação "Nao": o sentido pode estar ` +
        "invertido",
    );
  });

  it.each([
    ["em outra frase", "VOTO\nNao ha custas. Por isso o negocio generico e nulo por vicio de forma."],
    ["em outra oração (depois da vírgula)", "VOTO\nEmbora nao conste do pedido, o negocio generico e nulo por vicio de forma."],
    [
      "longe da passagem",
      "VOTO\nNao resta duvida depois de longa e cuidadosa analise de toda a prova produzida nos autos que o negocio generico e nulo por vicio de forma.",
    ],
  ])("negação ligada: \"não\" que nega outra coisa (%s) não vira sinal", (_caso, pagina) => {
    const r = conferirNoInteiroTeor(inteiroTeor([pagina]), citar("o negocio generico e nulo por vicio de forma"), so("negacao"));
    expect(sinal(r)).toBeUndefined();
  });

  it("alegação da parte ligada: parte com verbo de alegação antes, na mesma frase, vira sinal", async () => {
    const leitura = await lerPdf(pdfComSinaisDeAutoria());
    const r = conferirNoInteiroTeor(leitura, citar("o prazo generico seria decenal"), so("alegacaoDaParte"));
    expect(sinal(r)).toMatch(
      /; antes da passagem, na mesma frase, há "O apelante sustenta": pode ser alegação da parte, não fundamento do tribunal$/,
    );
  });

  it("alegação da parte ligada: verbo antes da parte (\"Alega a defesa que\") também vira sinal", () => {
    const r = conferirNoInteiroTeor(
      inteiroTeor(["VOTO\nAlega a defesa que o prazo generico seria decenal."]),
      citar("o prazo generico seria decenal"),
      so("alegacaoDaParte"),
    );
    expect(sinal(r)).toBe(
      'pode ser de outro autor: antes da passagem, na mesma frase, há "Alega a defesa": pode ser alegação da parte, ' +
        "não fundamento do tribunal",
    );
  });

  it.each([
    ["\"sustenta\" na fundamentação do relator", "VOTO\nO entendimento que este relator sustenta e que o prazo generico seria decenal."],
    ["alegação em outra frase", "VOTO\nO apelante sustenta a nulidade. Entendo que o prazo generico seria decenal."],
  ])("alegação da parte ligada: %s não vira sinal", (_caso, pagina) => {
    const r = conferirNoInteiroTeor(inteiroTeor([pagina]), citar("o prazo generico seria decenal"), so("alegacaoDaParte"));
    expect(sinal(r)).toBeUndefined();
  });

  it("ementa transcrita ligada: fecho entre parênteses com relator e data logo depois vira sinal", async () => {
    const leitura = await lerPdf(pdfComSinaisDeAutoria());
    const r = conferirNoInteiroTeor(
      leitura,
      citar("A prescricao da pretensao generica ocorre em tres anos"),
      so("ementaTranscrita"),
    );
    expect(sinal(r)).toMatch(
      /; logo depois da passagem há o fecho "\(TJXX, Apelacao 0000000-00\.2000\.0\.00\.0000, Rel\. Fulano, j\. 01\/01\/2000\)", como o de ementa de outro julgado transcrita$/,
    );
  });

  it.each([
    ["parênteses sem relator nem data", "VOTO\nO prazo generico e de cinco anos (art. 205 do Codigo Civil ficticio)."],
    [
      "fecho de outra transcrição, aberta por dois-pontos",
      "VOTO\nO prazo generico e de cinco anos, como no precedente assim ementado: Prazo trienal (TJXX, Rel. Fulano, j. 01/01/2000).",
    ],
    [
      "fecho longe da passagem",
      `VOTO\nO prazo generico e de cinco anos. ${"Texto ficticio de fundamentacao do relator. ".repeat(8)}(TJXX, Rel. Fulano, j. 01/01/2000).`,
    ],
  ])("ementa transcrita ligada: %s não vira sinal", (_caso, pagina) => {
    const r = conferirNoInteiroTeor(inteiroTeor([pagina]), citar("O prazo generico e de cinco anos"), so("ementaTranscrita"));
    expect(sinal(r)).toBeUndefined();
  });

  it("divergência ligada: fórmula de divergência antes, em acórdão que não se diz unânime, vira sinal", async () => {
    const leitura = await lerPdf(pdfComSinaisDeAutoria());
    const r = conferirNoInteiroTeor(
      leitura,
      citar("para negar provimento, por entender valido o negocio generico"),
      so("divergencia"),
    );
    expect(sinal(r)).toMatch(
      /; antes da passagem ou nela há a fórmula de divergência "Divirjo", e o acórdão não se diz unânime: pode ser de um voto divergente sem título$/,
    );
  });

  it("divergência ligada: proclamação por maioria não impede o sinal", () => {
    const r = conferirNoInteiroTeor(
      inteiroTeor(["VOTO\nPeco venia para divergir, pois o prazo generico e de cinco anos.\nAcordam, por maioria, em negar provimento."]),
      citar("o prazo generico e de cinco anos"),
      so("divergencia"),
    );
    expect(sinal(r)).toMatch(/fórmula de divergência "venia para divergir"/);
  });

  it("divergência ligada: \"por maioria\" de precedente citado não conta; vale a proclamação unânime da certidão", () => {
    const r = conferirNoInteiroTeor(
      inteiroTeor([
        "VOTO\nDivirjo da sentenca, pois o prazo generico e de cinco anos. O precedente citado foi decidido por maioria.",
        "CERTIDÃO DE JULGAMENTO\nCertifico que a Turma, por unanimidade, deu provimento ao recurso.",
      ]),
      citar("o prazo generico e de cinco anos"),
      so("divergencia"),
    );
    expect(sinal(r)).toBeUndefined();
  });

  it("divergência ligada: fecho com abreviaturas (\"Exmos. Srs.\") ainda é lido inteiro até \"por unanimidade\"", () => {
    const r = conferirNoInteiroTeor(
      inteiroTeor([
        "VOTO\nDivirjo da sentenca, pois o prazo generico e de cinco anos. O precedente citado foi decidido por maioria.\n" +
          "Acordam os Exmos. Srs. Desembargadores da Turma, por unanimidade, em dar provimento.",
      ]),
      citar("o prazo generico e de cinco anos"),
      so("divergencia"),
    );
    expect(sinal(r)).toBeUndefined();
  });

  it("divergência ligada: \"por unanimidade\" de precedente citado não faz o acórdão se dizer unânime", () => {
    const r = conferirNoInteiroTeor(
      inteiroTeor(["VOTO\nDivirjo, pois o prazo generico e de cinco anos. O precedente citado foi decidido por unanimidade."]),
      citar("o prazo generico e de cinco anos"),
      so("divergencia"),
    );
    expect(sinal(r)).toMatch(/fórmula de divergência "Divirjo", e o acórdão não se diz unânime/);
  });

  it("divergência ligada: acórdão unânime com a palavra \"divergência\" não vira sinal (só o aviso do relatório)", async () => {
    const leitura = await lerPdf(pdfUnanimeComDivergencia());
    const r = conferirNoInteiroTeor(leitura, citar("Ha divergencia na jurisprudencia sobre o tema"), so("divergencia"));
    expect(sinal(r)).toBe(avisoDoRelatorio(1));
  });

  it("divergência ligada: fórmula de divergência em acórdão unânime (o relator diverge da sentença) não vira sinal", () => {
    const r = conferirNoInteiroTeor(
      inteiroTeor([
        "VOTO\nDivirjo da sentenca, pois o prazo generico e de cinco anos.\nAcordam os Magistrados, por unanimidade, em dar provimento.",
      ]),
      citar("o prazo generico e de cinco anos"),
      so("divergencia"),
    );
    expect(sinal(r)).toBeUndefined();
  });

  it("raciocínio hipotético ligado: a marca logo antes vira sinal, só como localização", async () => {
    const leitura = await lerPdf(pdfComSinaisDeAutoria());
    const r = conferirNoInteiroTeor(
      leitura,
      citar("o resultado seria o mesmo, pois o prazo ja estaria vencido"),
      so("raciocinioHipotetico"),
    );
    expect(sinal(r)).toMatch(/; logo antes da passagem há marca de raciocínio hipotético \("Ainda que assim nao fosse"\)$/);
  });

  it.each([
    ["\"ainda que\" sem hipótese", "VOTO\nAinda que tardia, a prova mostra que o prazo generico e de cinco anos."],
    [
      "marca longe da passagem",
      `VOTO\nAinda que assim nao fosse, nada mudaria. ${"Texto ficticio de fundamentacao do relator. ".repeat(6)}Assim, o prazo generico e de cinco anos.`,
    ],
  ])("raciocínio hipotético ligado: %s não vira sinal", (_caso, pagina) => {
    const r = conferirNoInteiroTeor(inteiroTeor([pagina]), citar("o prazo generico e de cinco anos"), so("raciocinioHipotetico"));
    expect(sinal(r)).toBeUndefined();
  });

  /** Texto integral fictício como o Falcão devolve, convertido do HTML: uma passagem para cada sinal, sem títulos. */
  const TEXTO_DO_FALCAO = [
    FRASES_DE_AUTORIA.negada,
    FRASES_DE_AUTORIA.alegacaoDaParte,
    FRASES_DE_AUTORIA.ementaTranscrita,
    FRASES_DE_AUTORIA.votoDivergente,
    FRASES_DE_AUTORIA.hipotetica,
    'Ha quem diga que "o prazo generico seria trienal" na doutrina.',
  ].join("\n");
  const DO_FALCAO = [
    ["negação", "o negocio generico e nulo por vicio de forma", "negacao", "a negação"],
    ["alegação da parte", "o prazo generico seria decenal", "alegacaoDaParte", "alegação da parte"],
    ["ementa transcrita", "A prescricao da pretensao generica ocorre em tres anos", "ementaTranscrita", "ementa de outro julgado"],
    ["voto divergente", "para negar provimento, por entender valido o negocio generico", "divergencia", "fórmula de divergência"],
    ["raciocínio hipotético", "o resultado seria o mesmo, pois o prazo ja estaria vencido", "raciocinioHipotetico", "raciocínio hipotético"],
  ] as const;

  it.each(DO_FALCAO)("texto integral do Falcão, desligados: a passagem de %s fica sem sinal, como hoje", (_caso, citacao) => {
    expect(sinal(conferirNoTextoIntegral(TEXTO_DO_FALCAO, citar(citacao)))).toBeUndefined();
  });

  it("texto integral do Falcão, desligados: o sinal de aspas continua igual ao de hoje", () => {
    expect(sinal(conferirNoTextoIntegral(TEXTO_DO_FALCAO, citar("o prazo generico seria trienal")))).toBe(
      "pode ser de outro autor: a passagem está entre aspas no texto integral",
    );
  });

  it.each(DO_FALCAO)("texto integral do Falcão, %s ligado: vira sinal", (_caso, citacao, interruptor, esperado) => {
    const aviso = sinal(conferirNoTextoIntegral(TEXTO_DO_FALCAO, citar(citacao), so(interruptor)));
    expect(aviso).toMatch(/^pode ser de outro autor: /);
    expect(aviso).toContain(esperado);
  });

  it("texto integral sem título antes da passagem que atravessa um título: a divergência é procurada antes dela", () => {
    const texto = "Divirjo do relator, pois o prazo generico e de cinco anos\nVOTO\ncontados do fato generico.";
    const aviso = sinal(conferirNoTextoIntegral(texto, citar("o prazo generico e de cinco anos VOTO contados"), so("divergencia")));
    expect(aviso).toContain('fórmula de divergência "Divirjo"');
  });

  it("todos ligados: cada passagem tem o seu sinal, e nenhum aviso diz \"obiter\" nem \"autoria\"", async () => {
    const leitura = await lerPdf(pdfComSinaisDeAutoria());
    const todos = { negacao: true, alegacaoDaParte: true, ementaTranscrita: true, divergencia: true, raciocinioHipotetico: true };
    const avisos = [
      ["o negocio generico e nulo por vicio de forma", "a negação"],
      ["o prazo generico seria decenal", "alegação da parte"],
      ["A prescricao da pretensao generica ocorre em tres anos", "ementa de outro julgado"],
      ["para negar provimento, por entender valido o negocio generico", "fórmula de divergência"],
      ["o resultado seria o mesmo, pois o prazo ja estaria vencido", "raciocínio hipotético"],
    ].map(([citacao, esperado]) => {
      const aviso = sinal(conferirNoInteiroTeor(leitura, citar(citacao), todos));
      expect(aviso).toContain(esperado);
      return aviso;
    });
    for (const aviso of avisos) expect(aviso).not.toMatch(/obiter|autoria/i);
  });
});

describe("órgão julgador no fecho × órgão do registro (G-13)", () => {
  /** Lê um PDF sintético como o conferir_citacao lê o PDF trazido: gravado numa pasta temporária. */
  async function lerPdf(bytes: Uint8Array): Promise<InteiroTeorParaConferir> {
    const pasta = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-orgao-"));
    const caminho = join(pasta, "acordao-ficticio.pdf");
    await writeFile(caminho, bytes);
    return lerParaConferir(caminho);
  }

  it("ligado: fecho de outra câmara vira aviso \"órgão no texto ≠ órgão do registro\", com os dois órgãos", async () => {
    const leitura = await lerPdf(pdfComDispositivoECertidao(3));
    const aviso = avisoDeOrgaoDoFecho(leitura, { tribunal: "trt15", orgao: "1ª Câmara Cível" }, true);
    expect(aviso).toBe(
      'órgão no texto ≠ órgão do registro: o fecho do acórdão diz "3ª Camara Civel", e o registro da busca diz ' +
        '"1ª Câmara Cível". Confira na certidão de julgamento qual órgão julgou; o Garimpo não corrige o registro.',
    );
  });

  it("ligado: fecho do mesmo órgão do registro, com outra caixa e sem acento, não dá aviso", async () => {
    const leitura = await lerPdf(pdfComDispositivoECertidao(3));
    expect(avisoDeOrgaoDoFecho(leitura, { tribunal: "trt15", orgao: "3ª CÂMARA CÍVEL" }, true)).toBeUndefined();
  });

  it("ligado: sem fecho no texto, nada (silêncio, não aviso)", async () => {
    const leitura = await lerPdf(pdfEmentaPadronizada());
    expect(avisoDeOrgaoDoFecho(leitura, { tribunal: "trt15", orgao: "1ª Câmara Cível" }, true)).toBeUndefined();
  });

  it("o interruptor nasce desligado e, desligado, nada muda: nem o órgão diferente dá aviso", async () => {
    expect(AVISO_DE_ORGAO_DO_FECHO).toBe(false);
    const leitura = await lerPdf(pdfComDispositivoECertidao(3));
    expect(avisoDeOrgaoDoFecho(leitura, { tribunal: "trt15", orgao: "1ª Câmara Cível" })).toBeUndefined();
  });

  /** PDF de uma página com o fecho dado no acórdão (fórmula genérica do tribunal, sem nome real) e um voto genérico. */
  const comFecho = (...fecho: string[]) =>
    lerPdf(pdfSintetico([["ACORDAO", ...fecho, "VOTO", "Fundamentacao generica do relator."]]));
  const ENCHER = "Texto ficticio de enchimento do inteiro teor, em linguagem comum e sem dado real, para a pagina contar como lida.";

  it.each([
    ["7ª Câmara de Direito Privado", undefined],
    ["7ª Câmara de Direito Público", 'o fecho do acórdão diz "7ª Camara de Direito Privado"'],
  ])("ligado, nome do órgão com hífen de fim de linha (\"Pri-\" / \"vado\"): a palavra se junta (registro %s)", async (orgao, esperado) => {
    const leitura = await comFecho(
      "ACORDAM, em sessao permanente e virtual da 7ª Camara de Direito Pri-",
      "vado do Tribunal de Justica, proferir a seguinte decisao.",
    );
    const aviso = avisoDeOrgaoDoFecho(leitura, { tribunal: "tjsp", orgao }, true);
    if (esperado) expect(aviso).toContain(esperado);
    else expect(aviso).toBeUndefined();
  });

  it.each([
    ["1ª Câmara Cível", undefined],
    ["2ª Câmara Cível", 'o fecho do acórdão diz "1ª CAMARA CIVEL"'],
  ])("ligado, TJMG com o órgão em maiúsculas partido por hífen (\"CI-\" / \"VEL\"): a palavra se junta (registro %s)", async (orgao, esperado) => {
    const leitura = await comFecho("Vistos etc., acorda, em Turma, a 1ª CAMARA CI-", "VEL do Tribunal de Justica do Estado, na conformidade da ata.");
    const aviso = avisoDeOrgaoDoFecho(leitura, { tribunal: "tjmg", orgao }, true);
    if (esperado) expect(aviso).toContain(esperado);
    else expect(aviso).toBeUndefined();
  });

  it("ligado, \"ACORDAO\" sozinho na linha dentro do voto (precedente transcrito): o fecho dele não conta", async () => {
    const leitura = await lerPdf(
      pdfSintetico([
        ["ACORDAO", "Acordam os Magistrados da 3ª Turma do Tribunal, por unanimidade.", ENCHER],
        ["VOTO", "O precedente generico tem este acordao:", "ACORDAO", "Acordam os Magistrados da 9ª Turma do Tribunal, por maioria.", ENCHER],
      ]),
    );
    expect(avisoDeOrgaoDoFecho(leitura, { tribunal: "trt2", orgao: "3ª Turma" }, true)).toBeUndefined();
    expect(avisoDeOrgaoDoFecho(leitura, { tribunal: "trt2", orgao: "1ª Turma" }, true)).toContain('o fecho do acórdão diz "3ª Turma"');
  });

  it("ligado, nome do órgão que cruza a quebra de página (cabeçalho no meio): silêncio", async () => {
    const leitura = await lerPdf(
      pdfSintetico([
        ["ACORDAO", ENCHER, "ACORDAM, em sessao permanente e virtual da 7ª Camara de Direito"],
        ["PODER JUDICIARIO", "Privado do Tribunal de Justica, proferir a seguinte decisao.", ENCHER],
      ]),
    );
    expect(avisoDeOrgaoDoFecho(leitura, { tribunal: "tjsp", orgao: "7ª Câmara de Direito Privado" }, true)).toBeUndefined();
  });

  it.each([
    ["no relatório", ["RELATORIO", "Trata-se de recurso contra acordao que decidiu assim.", "Acordam os Magistrados da 9ª Turma do Tribunal, por maioria."]],
    ["no voto", ["VOTO", "O precedente generico concluiu de outro modo.", "Acordam os Magistrados da 9ª Turma do Tribunal, por maioria."]],
    ["entre aspas", ["EMENTA", "Conforme precedente generico, \"Acordam os Magistrados da 9ª Turma do Tribunal, por maioria.\""]],
  ])("ligado, fecho de outro julgado transcrito %s não conta: vale só o fecho do acórdão", async (_caso, transcrito) => {
    const leitura = await lerPdf(
      pdfSintetico([
        ["ACORDAO", "Acordam os Magistrados da 3ª Turma do Tribunal, por unanimidade.", ENCHER],
        [...transcrito, ENCHER],
      ]),
    );
    expect(avisoDeOrgaoDoFecho(leitura, { tribunal: "trt2", orgao: "3ª Turma" }, true)).toBeUndefined();
    expect(avisoDeOrgaoDoFecho(leitura, { tribunal: "trt2", orgao: "1ª Turma" }, true)).toContain(
      'o fecho do acórdão diz "3ª Turma"',
    );
  });

  it("ligado, só fecho de outro julgado (no relatório): nada (silêncio)", async () => {
    const leitura = await lerPdf(
      pdfSintetico([["RELATORIO", "Trata-se de recurso contra acordao que decidiu assim.", "Acordam os Magistrados da 9ª Turma do Tribunal, por maioria."]]),
    );
    expect(avisoDeOrgaoDoFecho(leitura, { tribunal: "trt2", orgao: "1ª Turma" }, true)).toBeUndefined();
  });

  it.each([
    [
      "STJ, fecho do acórdão",
      "stj",
      ["Vistos e relatados estes autos, acordam os Ministros da Segunda Turma do Superior Tribunal de Justica,", "por unanimidade, negar provimento."],
      "Primeira Turma",
      "Segunda Turma",
    ],
    [
      "STJ, certidão",
      "stj",
      ["CERTIDAO DE JULGAMENTO", "Certifico que a egregia SEGUNDA TURMA, ao apreciar o processo em epigrafe, proferiu a seguinte decisao."],
      "1ª Turma",
      "SEGUNDA TURMA",
    ],
    [
      "TJMG",
      "tjmg",
      ["Vistos etc., acorda, em Turma, a 5ª CAMARA CIVEL do Tribunal de Justica do Estado, na conformidade da ata."],
      "2ª Câmara Cível",
      "5ª CAMARA CIVEL",
    ],
    [
      "TJMG, ordinal composto por extenso",
      "tjmg",
      ["acorda, em Turma, a DECIMA SEGUNDA CAMARA CIVEL do Tribunal de Justica, na conformidade da ata."],
      "11ª Câmara Cível",
      "DECIMA SEGUNDA CAMARA CIVEL",
    ],
    [
      "TRT, fecho com \"Exmos. Srs.\"",
      "trt3",
      ["ACORDAM os Exmos. Srs. Desembargadores da Segunda Turma do Egregio Tribunal Regional do Trabalho, por unanimidade."],
      "1ª Turma",
      "Segunda Turma",
    ],
    [
      "TJSP",
      "tjsp",
      ["ACORDAM, em sessao permanente e virtual da 7ª Camara de Direito Privado do Tribunal de Justica,", "proferir a seguinte decisao."],
      "7ª Câmara de Direito Público",
      "7ª Camara de Direito Privado",
    ],
    [
      "TSE (só o Plenário julga)",
      "tse",
      ["Acordam os ministros do Tribunal Superior Eleitoral, por unanimidade, em negar provimento ao recurso."],
      "Primeira Turma",
      "Plenário",
    ],
  ])("ligado, %s: fecho de outro órgão vira aviso com o órgão do texto", async (_caso, tribunal, fecho, doRegistro, doTexto) => {
    const aviso = avisoDeOrgaoDoFecho(await comFecho(...fecho), { tribunal, orgao: doRegistro }, true);
    expect(aviso).toContain(`o fecho do acórdão diz "${doTexto}", e o registro da busca diz "${doRegistro}"`);
  });

  it.each([
    ["STJ, por extenso × algarismo", "stj", ["acordam os Ministros da Primeira Turma do Superior Tribunal de Justica, por unanimidade."], "1ª Turma"],
    ["TSE × Plenário do registro", "tse", ["Acordam os ministros do Tribunal Superior Eleitoral, por unanimidade, em negar provimento."], "Tribunal Pleno"],
    ["TJMG, décima segunda × 12ª", "tjmg", ["acorda, em Turma, a DECIMA SEGUNDA CAMARA CIVEL do Tribunal de Justica, na conformidade da ata."], "12ª Câmara Cível"],
  ])("ligado, %s: mesmo órgão, sem aviso", async (_caso, tribunal, fecho, orgao) => {
    expect(avisoDeOrgaoDoFecho(await comFecho(...fecho), { tribunal, orgao }, true)).toBeUndefined();
  });

  it.each([
    ["tribunal sem fórmula (ainda)", "tjxx", ["Acordam os Magistrados da 3ª Camara Civel do Tribunal, por unanimidade."], "1ª Câmara Cível"],
    [
      "dois fechos que discordam (outro julgado transcrito)",
      "trt2",
      ["Acordam os Magistrados da 3ª Turma do Tribunal, por unanimidade.", "Acordam os Magistrados da 9ª Turma do Tribunal, por maioria."],
      "1ª Turma",
    ],
    ["órgão do registro ilegível", "trt2", ["Acordam os Magistrados da 3ª Turma do Tribunal, por unanimidade."], "Gabinete generico"],
  ])("ligado, %s: nada (silêncio)", async (_caso, tribunal, fecho, orgao) => {
    expect(avisoDeOrgaoDoFecho(await comFecho(...fecho), { tribunal, orgao }, true)).toBeUndefined();
  });

  it("o aviso nunca dá juízo: não diz qual órgão está certo nem corrige o registro", async () => {
    const aviso = avisoDeOrgaoDoFecho(await lerPdf(pdfComDispositivoECertidao(3)), { tribunal: "trt15", orgao: "1ª Câmara Cível" }, true);
    expect(aviso).toMatch(/não corrige o registro/);
    expect(aviso).not.toMatch(/correto|errado|nulo|nulidade|incompet/i);
  });

  it("desligado, a conferência da citação no mesmo PDF sai como antes, sem campo de órgão", async () => {
    const leitura = await lerPdf(pdfComDispositivoECertidao(3));
    const r = conferirNoInteiroTeor(leitura, lerCitacao("voto por dar provimento ao recurso", { reticenciasComoCorte: false }));
    expect(JSON.stringify(r)).not.toMatch(/órgão/);
  });
});

describe("conferência no inteiro teor com páginas não lidas (teto de leitura, ticket 06)", () => {
  const LINHA = "Texto ficticio do inteiro teor, em linguagem comum e sem dado real, para a pagina contar como lida.";
  /** Grava o PDF e lê como o conferir_citacao, com o teto de páginas dado. */
  async function ler(paginas: string[][], tetoDePaginas: number): Promise<InteiroTeorParaConferir> {
    const pasta = await mkdtemp(join(process.env.GARIMPO_DADOS!, "garimpo-nao-lidas-"));
    const caminho = join(pasta, "acordao-ficticio.pdf");
    await writeFile(caminho, pdfSintetico(paginas));
    return lerParaConferir(caminho, { tetoDePaginas });
  }
  const pagina = (k: number) => [`Pagina ${k}.`, LINHA, LINHA];
  const citar = (texto: string) => lerCitacao(texto, { reticenciasComoCorte: false });
  const AUSENTE = "frase que so existe numa pagina que nao foi lida";

  it("frase ausente das lidas, com páginas além do teto: não verificável, ditas não lidas (não \"sem texto extraível\")", async () => {
    const leitura = await ler([1, 2, 3, 4, 5, 6].map(pagina), 2);
    const r = conferirNoInteiroTeor(leitura, citar(AUSENTE));
    expect(r).toEqual({
      veredito: "não verificável",
      motivo:
        "Não achada nas páginas lidas, mas as páginas 3 a 6 não foram lidas (teto de leitura) e não foram conferidas: " +
        "a citação pode estar nelas. Abra o arquivo para conferir.",
      paginasNaoLidas: "páginas 3 a 6 de 6",
    });
  });

  it("página sem texto e páginas não lidas: as duas listas, cada uma com o seu motivo", async () => {
    const leitura = await ler([pagina(1), [], pagina(3), pagina(4)], 3);
    const r = conferirNoInteiroTeor(leitura, citar(AUSENTE));
    expect(r).toMatchObject({
      veredito: "não verificável",
      motivo:
        "Não achada nas páginas lidas com texto extraível, mas a página 2 não tem texto extraível (o Garimpo não faz " +
        "OCR) e não foi conferida, e a página 4 não foi lida (teto de leitura) e não foi conferida: a citação pode " +
        "estar nelas. Abra o arquivo para conferir.",
      paginasSemTexto: "página 2 de 4",
      paginasNaoLidas: "página 4 de 4",
    });
  });

  it("frase numa página lida: encontrada, mesmo com páginas não lidas depois", async () => {
    const leitura = await ler([1, 2, 3].map(pagina), 1);
    expect(conferirNoInteiroTeor(leitura, citar("em linguagem comum e sem dado real")).veredito).toBe("encontrado literalmente");
  });
});
