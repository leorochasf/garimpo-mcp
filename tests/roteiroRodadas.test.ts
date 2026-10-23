import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";

/**
 * Roteiro 1.2 do pesquisar_tese (B1.1 (b) a (e); texto ratificado pelo Codex Sol em 2026-10-23, D12, com os ajustes E1
 * e E2 da revisão): o contrário sempre, a regra dos TRTs, a 2ª rodada pela união das formulações e o orçamento
 * orientador. Travas de frase, como as do ADR-0014: não provam que uma IA siga o roteiro. O que o servidor faz com o que
 * o roteiro manda está em rodadasNoServidor.test.ts.
 */

/** Números de D11 (aprovados pelo dono em 2026-10-23) que o roteiro tem de trazer. */
const D11 = { formulacoes: 8, gatilho: 5, ementas: 10, inteirosTeores: 3 };

const semRede = new Cliente({
  nome: "O site",
  esperar: async () => {},
  fetch: (async () => {
    throw new Error("o roteiro chamou a rede");
  }) as typeof fetch,
});

async function roteiro(): Promise<string> {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "rodadas-"));
  await criarServidor(semRede, { dados }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  const r = await mcp.getPrompt({ name: "pesquisar_tese", arguments: { tese: "{tese}" } });
  return (r.messages[0].content as { text: string }).text;
}

const linhas = (texto: string) => texto.split("\n");
const indice = (texto: string, prefixo: string) => linhas(texto).findIndex((l) => l.startsWith(prefixo));
const linha = (texto: string, prefixo: string) => linhas(texto)[indice(texto, prefixo)] ?? "";

/** Frases que cada linha nova tem de trazer inteiras (prefixo da linha → frases). */
const REGRAS: [string, string[]][] = [
  [
    "Orçamento desta pesquisa",
    [
      "é orientação, não trava: o servidor limita cada chamada, não a pesquisa inteira",
      `até ${D11.formulacoes} formulações por tese, somando as rodadas`,
      "uma busca_ampla por rodada e, com TRT, no máximo uma repetição para o que ficar foraDoTeto",
      `até ${D11.ementas} ementas e até ${D11.inteirosTeores} inteiros teores, como nos passos 4 e 7`,
      "Gasta orçamento cada busca que foi ao site (no cabecalhoDeCobertura, buscasFeitas menos guardadas), cada ementa e cada inteiro teor obtidos",
      "uma busca ou um inteiro teor pode custar mais de uma chamada ao site (nova tentativa, redirecionamento)",
    ],
  ],
  [
    "1. ",
    [
      "Entre elas vai sempre ao menos uma formulação da posição contrária ou de exceção",
      "mesmo que a tese pareça pacífica, em 2º lugar na lista, salvo a regra dos TRTs logo abaixo do passo 2",
    ],
  ],
  [
    "Com TRT: ",
    [
      "cada formulação em cada TRT gasta uma das 5 páginas do Falcão por chamada, primeiro a 1ª formulação em cada TRT, na ordem dada, depois as seguintes",
      "o que não couber sai no cabecalhoDeCobertura como foraDoTeto, que não é busca vazia",
      "deixe-a em 2º lugar com até 2 TRTs; com 3 TRTs ou mais, ponha-a em 1º lugar",
      "Para executar o foraDoTeto, repita a mesma chamada no máximo uma vez na pesquisa inteira, somente com a memória ligada e legível, buscas guardadas ainda válidas e sem renovar",
      "As já feitas podem voltar da memória; confira as guardadas no cabecalhoDeCobertura",
      "Com renovar, memória desligada ou sem buscas válidas guardadas, repetir refaz no site as páginas já feitas e gasta orçamento novamente: avise desse custo e não repita para tentar executar o foraDoTeto",
      "Se a memória falhar na repetição e as já feitas não voltarem como guardadas, não repita de novo",
      "diga ao usuário quais formulações não rodaram em quais TRTs e que a busca do contrário ficou incompleta neles",
    ],
  ],
  [
    "Segunda rodada, ",
    [
      `uma só e só com gatilho: se menos de ${D11.gatilho} das ementas lidas no passo 4 servirem à tese (leitura sua)`,
      "termos técnicos copiados das ementas devolvidas",
      "cada termo com o id da ementa de onde saiu; nunca nome de parte, número de processo, termo de memória nem dado do caso",
      `Mande numa só busca_ampla a união das formulações (até ${D11.formulacoes})`,
      "as da primeira rodada na mesma ordem e grafia, seguidas das novas, com os mesmos tribunais, filtros e limite por busca",
      "mostre ao usuário, antes dos resultados, os termos novos e de onde saiu cada um",
      "As da primeira rodada podem voltar da memória do Garimpo, sem renovar, se ela estiver ligada e legível e as buscas estiverem guardadas e válidas por menos de 24 h",
      "com renovar ou sem busca válida guardada, vão ao site de novo e gastam orçamento",
      "Confira no cabecalhoDeCobertura quais voltaram como guardadas",
      `refaça os passos 3 e 4 dentro do saldo do orçamento de até ${D11.ementas} ementas obtidas, somando as rodadas; não zere a contagem ao mudar de rodada`,
    ],
  ],
  [
    "5. ",
    [
      "Diga se a formulação contrária rodou em cada tribunal pedido (cabecalhoDeCobertura)",
      "sem acórdão contrário na lista, diga que a busca não o achou, não que ele não existe",
    ],
  ],
];

/** Frases que faltam nas linhas novas (lista vazia = todas inteiras). */
function regrasFaltando(texto: string): string[] {
  return REGRAS.flatMap(([prefixo, frases]) => {
    const l = linha(texto, prefixo);
    return frases.filter((f) => !l.includes(f)).map((f) => `${prefixo}… ${f}`);
  });
}

describe("pesquisar_tese 1.2: o texto (B1.1)", () => {
  it("as linhas novas trazem as regras inteiras, com os números de D11", async () => {
    expect(regrasFaltando(await roteiro())).toEqual([]);
  });

  it("cada linha nova fica no lugar dela: orçamento antes do passo 1, TRT logo depois do 2, 2ª rodada logo depois do 4", async () => {
    const texto = await roteiro();
    expect(indice(texto, "Orçamento desta pesquisa")).toBe(indice(texto, "Período: ") + 1);
    expect(indice(texto, "Orçamento desta pesquisa")).toBeLessThan(indice(texto, "1. "));
    expect(indice(texto, "Com TRT: ")).toBe(indice(texto, "2. Rode a busca_ampla") + 1);
    expect(indice(texto, "Segunda rodada, ")).toBe(indice(texto, "4. Leia pelo obter_ementa") + 1);
    expect(indice(texto, "5. ")).toBe(indice(texto, "Segunda rodada, ") + 1);
    // Os passos numerados seguem de 1 a 12, sem passo novo: as referências "passo 7", "passo 11" etc. continuam valendo.
    expect(linhas(texto).filter((l) => /^\d+\. /.test(l)).map((l) => l.split(".")[0])).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 1)),
    );
  });

  it("a trava das regras novas rejeita remoção ou troca de cada uma", async () => {
    const texto = await roteiro();
    const variantes = [
      texto.replace(", mesmo que a tese pareça pacífica", ""),
      texto.replace("com 3 TRTs ou mais, ponha-a em 1º lugar", "com 3 TRTs ou mais, deixe-a em 2º lugar"),
      texto.replace("somente com a memória ligada e legível, buscas guardadas ainda válidas e sem renovar", "sempre"),
      texto.replace("no máximo uma vez na pesquisa inteira", "quantas vezes precisar"),
      texto.replace(" e não repita para tentar executar o foraDoTeto", ""),
      texto.replace("Se a memória falhar na repetição e as já feitas não voltarem como guardadas, não repita de novo", ""),
      texto.replace("e que a busca do contrário ficou incompleta neles", ""),
      texto.replace(`menos de ${D11.gatilho} das ementas`, "menos de 3 das ementas"),
      texto.replace("na mesma ordem e grafia", "em qualquer ordem"),
      texto.replace("nunca nome de parte, número de processo, termo de memória nem dado do caso", "à vontade"),
      texto.replace(", sem renovar, se ela estiver", " se ela estiver"),
      texto.replace(" Confira no cabecalhoDeCobertura quais voltaram como guardadas.", ""),
      texto.replace("; não zere a contagem ao mudar de rodada", ""),
      texto.replace(`até ${D11.formulacoes} formulações por tese`, "até 12 formulações por tese"),
      texto.replace("é orientação, não trava", "é trava"),
      texto.replace(", não que ele não existe", ""),
    ];
    expect(regrasFaltando(texto)).toEqual([]);
    for (const v of variantes) {
      expect(v).not.toBe(texto);
      expect(regrasFaltando(v).length).toBeGreaterThan(0);
    }
  });

  it("E1 da revisão: a 2ª rodada não promete a memória; com renovar ou sem busca válida guardada, as antigas gastam orçamento", async () => {
    const texto = await roteiro();
    const segunda = linha(texto, "Segunda rodada, ");
    // O texto anterior prometia que as antigas voltam da memória, sem ressalvar renovar nem a busca válida guardada.
    const anterior =
      "As da primeira rodada voltam da memória do Garimpo se ela estiver ligada e legível e a busca tiver menos de 24 h; " +
      "senão, vão ao site de novo e gastam orçamento. Com a lista nova, refaça os passos 3 e 4, sem passar de 10 ementas " +
      "apresentadas.";
    expect(segunda).not.toMatch(/\bvoltam da memória/);
    const comOAnterior = texto.replace(segunda.slice(segunda.indexOf("As da primeira rodada")), anterior);
    expect(comOAnterior).not.toBe(texto);
    expect(regrasFaltando(comOAnterior)).not.toEqual([]);
  });

  it("E2 da revisão: no TRT, repetir só com a memória valendo e sem renovar; nos outros casos, avisar o custo e não repetir", async () => {
    const texto = await roteiro();
    const trt = linha(texto, "Com TRT: ");
    // O texto anterior deixava repetir com renovar ou sem memória depois do aviso: a repetição só refazia as páginas.
    const anterior =
      "Repetir a mesma chamada, sem renovar, executa o foraDoTeto e traz as já feitas da memória do Garimpo só se ela " +
      "estiver ligada e legível; com renovar ou com a memória desligada, a repetição refaz no site as páginas já feitas: " +
      "avise o usuário desse custo antes de repetir. Se, na repetição, as já feitas não voltarem como guardadas no " +
      "cabecalhoDeCobertura, as páginas foram refeitas: não repita de novo.";
    expect(trt).not.toContain("antes de repetir");
    const comOAnterior = texto.replace(
      trt.slice(trt.indexOf("Para executar o foraDoTeto"), trt.indexOf(" Contrária sem rodar")),
      anterior,
    );
    expect(comOAnterior).not.toBe(texto);
    expect(regrasFaltando(comOAnterior)).not.toEqual([]);
  });

  it("as linhas novas não trazem número de precedente nem de processo: os números são de D11, passos, páginas e TRTs", async () => {
    const texto = await roteiro();
    const novas = REGRAS.map(([prefixo]) => linha(texto, prefixo));
    const NUMERO_DE_PRECEDENTE =
      /\b(súmulas?|temas?|sv|iac|irdr|repercussão geral|repetitivos?|precedentes?|enunciados?)\s+(vinculantes?\s+)?(n[º°.]?\s*)?\d/i;
    for (const l of novas) {
      expect(l).not.toMatch(NUMERO_DE_PRECEDENTE);
      expect(l).not.toMatch(/\d{7}-?\d{2}\.?\d{4}/);
      expect(l).not.toMatch(/\b(REsp|RE|AREsp)\s+(n[º°.]?\s*)?\d/);
    }
    const numeros = new Set(novas.join(" ").match(/\d+/g));
    expect([...numeros].sort((a, b) => Number(a) - Number(b))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "10", "24"]);
  });
});
