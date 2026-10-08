import { describe, expect, it } from "vitest";
import { conferirNaEmenta, lerCitacao } from "../src/conferencia.js";

/** Ementa fictícia, sem processo real (regra 2). */
const EMENTA =
  "EMENTA FICTÍCIA. ADMINISTRATIVO. RESPONSABILIDADE CIVIL DO ESTADO. 1. A responsabilidade civil do Estado " +
  "por omissão exige a demonstração do nexo causal entre a falta do serviço e o dano sofrido. 2. Recurso " +
  "conhecido e não provido.";

function conferir(ementa: string, citacao: string, reticenciasComoCorte = false) {
  return conferirNaEmenta(ementa, lerCitacao(citacao, { reticenciasComoCorte }));
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
    expect(r.ocorrencias[0].frase).toContain(fonte.trim());
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
    const r = conferir("   ", "exige a demonstração do nexo causal");
    expect(r.veredito).toBe("não verificável");
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
    expect(conferir("", "exige a demonstração do nexo causal")).toEqual({
      veredito: "não verificável",
      motivo: "O acórdão veio sem ementa do JurisprudênciaIA: não há texto para conferir.",
    });
  });
});
