import { describe, expect, it } from "vitest";
import { conferirNaEmenta, conferirNoInteiroTeor, lerCitacao } from "../src/conferencia.js";
import type { ConferenciaFeita, ResultadoDaFonte } from "../src/conferencia.js";
import type { InteiroTeorParaConferir } from "../src/leitura.js";

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
