/**
 * Medição do filtro "não pode conter X perto de Y" (I-09 / G-65), sem rede, sobre as ementas já marcadas nas rodadas 2
 * e 3 do banco de provas. O critério de ganho foi escrito ANTES de medir (TICKETS/b16-onda-0/06-filtro-nao-perto-de.md
 * e docs/banco-de-provas/medicao-filtro-perto-de.md): a forma "perto de" só segue se tirar, na validação cruzada,
 * pelo menos 10 irrelevantes a mais que a forma simples, em pelo menos 4 teses, sem derrubar mais relevantes.
 *
 * As ementas ficam FORA do repositório (regra 2): este script só imprime contagens, nunca ementa, número, órgão ou os
 * termos escolhidos.
 *
 *   npx vite-node scripts/rodarMedirPertoDe.ts <pasta banco-de-provas-resultados>
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Janela do "perto de": caracteres entre o fim de uma palavra e o começo da outra (G-65: ~60). */
export const JANELA = 60;
/** Irrelevantes que a regra precisa tirar no lote em que é escolhida. */
export const MINIMO_NA_ESCOLHA = 2;
/** Teses com menos irrelevantes marcadas que isto não entram (não dá para dividir em duas metades). */
export const MINIMO_DE_IRRELEVANTES_NA_TESE = 6;
/** Limiares de ganho do critério escrito antes da medição. */
export const GANHO_MINIMO = 10;
export const TESES_MINIMAS = 4;

/** Mesma normalização do filtro local (src/filtroLocal.ts): minúsculas, sem acento, espaços reduzidos. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface Palavra {
  texto: string;
  inicio: number;
  fim: number;
}

function palavras(texto: string): Palavra[] {
  return [...normalizar(texto).matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    texto: m[0],
    inicio: m.index,
    fim: m.index + m[0].length,
  }));
}

/** Palavra solta só vale com 4 letras ou mais; palavra de 3 letras ou menos solta casaria com quase tudo. */
const TAMANHO_MINIMO = 4;

/** O que o `naoPodeConter` de hoje aceita: palavra solta ou expressão de até 3 palavras seguidas. */
export function regrasSimples(ementa: string): Set<string> {
  const p = palavras(ementa).map((x) => x.texto);
  const regras = new Set<string>();
  for (let i = 0; i < p.length; i++) {
    if (p[i].length >= TAMANHO_MINIMO) regras.add(p[i]);
    for (let n = 2; n <= 3 && i + n <= p.length; n++) regras.add(p.slice(i, i + n).join(" "));
  }
  return regras;
}

/** Pares de palavras (4 letras ou mais, diferentes) a até JANELA caracteres uma da outra, em qualquer ordem. */
export function regrasPerto(ementa: string): Set<string> {
  const p = palavras(ementa);
  const regras = new Set<string>();
  for (let i = 0; i < p.length; i++) {
    if (p[i].texto.length < TAMANHO_MINIMO) continue;
    for (let j = i + 1; j < p.length && p[j].inicio - p[i].fim <= JANELA; j++) {
      if (p[j].texto.length < TAMANHO_MINIMO || p[j].texto === p[i].texto) continue;
      regras.add(p[i].texto < p[j].texto ? `${p[i].texto}|${p[j].texto}` : `${p[j].texto}|${p[i].texto}`);
    }
  }
  return regras;
}

export interface Amostra {
  irrelevante: boolean;
  regras: Set<string>;
}

export interface Contagem {
  irrelevantesTirados: number;
  relevantesPerdidos: number;
  regrasEscolhidas: number;
}

/**
 * A regra segura (não tira relevante) que mais tira irrelevantes, com pelo menos `minimo`; empate pela ordem alfabética.
 * Sem regra assim, undefined.
 */
export function melhorRegra(lote: readonly Amostra[], minimo = MINIMO_NA_ESCOLHA): string | undefined {
  const irrelevantes = new Map<string, number>();
  const comRelevante = new Set<string>();
  for (const a of lote) {
    for (const r of a.regras) {
      if (a.irrelevante) irrelevantes.set(r, (irrelevantes.get(r) ?? 0) + 1);
      else comRelevante.add(r);
    }
  }
  let melhor: string | undefined;
  let melhorN = 0;
  for (const [r, n] of irrelevantes) {
    if (n < minimo || comRelevante.has(r)) continue;
    if (n > melhorN || (n === melhorN && melhor !== undefined && r < melhor)) {
      melhor = r;
      melhorN = n;
    }
  }
  return melhor;
}

function contar(regra: string | undefined, lote: readonly Amostra[]): Contagem {
  if (regra === undefined) return { irrelevantesTirados: 0, relevantesPerdidos: 0, regrasEscolhidas: 0 };
  let irrelevantesTirados = 0;
  let relevantesPerdidos = 0;
  for (const a of lote) {
    if (!a.regras.has(regra)) continue;
    if (a.irrelevante) irrelevantesTirados++;
    else relevantesPerdidos++;
  }
  return { irrelevantesTirados, relevantesPerdidos, regrasEscolhidas: 1 };
}

const somar = (a: Contagem, b: Contagem): Contagem => ({
  irrelevantesTirados: a.irrelevantesTirados + b.irrelevantesTirados,
  relevantesPerdidos: a.relevantesPerdidos + b.relevantesPerdidos,
  regrasEscolhidas: a.regrasEscolhidas + b.regrasEscolhidas,
});

/** Escolhe numa metade (posições pares ou ímpares) e conta na outra, nos dois sentidos. */
export function validacaoCruzada(lote: readonly Amostra[], minimo = MINIMO_NA_ESCOLHA): Contagem {
  let total: Contagem = { irrelevantesTirados: 0, relevantesPerdidos: 0, regrasEscolhidas: 0 };
  for (const resto of [0, 1]) {
    const treino = lote.filter((_, i) => i % 2 === resto);
    const teste = lote.filter((_, i) => i % 2 !== resto);
    total = somar(total, contar(melhorRegra(treino, minimo), teste));
  }
  return total;
}

/** Limite superior otimista: escolhe e conta no lote inteiro (não é critério). */
export function teto(lote: readonly Amostra[], minimo = MINIMO_NA_ESCOLHA): Contagem {
  return contar(melhorRegra(lote, minimo), lote);
}

export interface ResultadoDaTese {
  tese: number;
  simples: Contagem;
  perto: Contagem;
}

export interface Decisao {
  segue: boolean;
  ganhoLiquido: number;
  tesesComGanho: number;
  relevantesPerdidosSimples: number;
  relevantesPerdidosPerto: number;
}

/** O critério escrito antes da medição: +10 irrelevantes, em 4 teses ou mais, sem perder mais relevantes. */
export function decidir(teses: readonly ResultadoDaTese[]): Decisao {
  const soma = (f: (t: ResultadoDaTese) => number) => teses.reduce((s, t) => s + f(t), 0);
  const ganhoLiquido = soma((t) => t.perto.irrelevantesTirados - t.simples.irrelevantesTirados);
  const tesesComGanho = teses.filter((t) => t.perto.irrelevantesTirados > t.simples.irrelevantesTirados).length;
  const relevantesPerdidosSimples = soma((t) => t.simples.relevantesPerdidos);
  const relevantesPerdidosPerto = soma((t) => t.perto.relevantesPerdidos);
  return {
    segue:
      ganhoLiquido >= GANHO_MINIMO && tesesComGanho >= TESES_MINIMAS && relevantesPerdidosPerto <= relevantesPerdidosSimples,
    ganhoLiquido,
    tesesComGanho,
    relevantesPerdidosSimples,
    relevantesPerdidosPerto,
  };
}

/** Ementa marcada, de uma rodada gravada. */
export interface Marcada {
  tese: number;
  ementa: string;
  marca: string;
}

const lerJson = async <T>(arquivo: string): Promise<T> => JSON.parse(await readFile(arquivo, "utf8")) as T;
const numeroDaTese = (arquivo: string): number => Number(/tese-(\d+)\.json$/.exec(arquivo)?.[1]);

/** Lê as marcações das rodadas 2 (a-marcar + marcacoes-r2) e 3 (pools/pool-marcado) em `raiz`. */
export async function carregarMarcadas(raiz: string): Promise<Marcada[]> {
  const marcadas: Marcada[] = [];
  const r2 = path.join(raiz, "rodada-2");
  for (const f of (await readdir(path.join(r2, "a-marcar"))).filter((x) => /^tese-\d+\.json$/.test(x))) {
    const itens = (await lerJson<{ itens: { id: string; ementa: string }[] }>(path.join(r2, "a-marcar", f))).itens;
    const marcas = await lerJson<{ id: string; marca: string }[]>(path.join(r2, "marcacoes-r2", f));
    const porId = new Map(marcas.map((m) => [m.id, m.marca]));
    for (const i of itens) {
      const marca = porId.get(i.id);
      if (marca && i.ementa) marcadas.push({ tese: numeroDaTese(f), ementa: i.ementa, marca });
    }
  }
  const r3 = path.join(raiz, "rodada-3", "pools");
  for (const f of (await readdir(r3)).filter((x) => /^pool-marcado-tese-\d+\.json$/.test(x))) {
    for (const i of await lerJson<{ ementa: string; marca: string }[]>(path.join(r3, f))) {
      if (i.marca && i.ementa) marcadas.push({ tese: numeroDaTese(f), ementa: i.ementa, marca: i.marca });
    }
  }
  return marcadas;
}

export interface Relatorio {
  teses: ResultadoDaTese[];
  tetos: { tese: number; simples: Contagem; perto: Contagem }[];
  decisao: Decisao;
  totais: {
    ementas: number;
    relevantes: number;
    irrelevantes: number;
    duvida: number;
    tesesMedidas: number;
    tesesSemIrrelevantesSuficientes: number;
  };
}

/** Mede tudo: junta as rodadas sem repetir a mesma ementa na mesma tese, descarta dúvida e roda as duas formas. */
export function medirTudo(marcadas: readonly Marcada[]): Relatorio {
  const porTese = new Map<number, Map<string, { ementa: string; irrelevante: boolean }>>();
  let duvida = 0;
  for (const m of marcadas) {
    if (m.marca === "duvida") {
      duvida++;
      continue;
    }
    if (m.marca !== "relevante" && m.marca !== "irrelevante") continue;
    const chave = normalizar(m.ementa);
    const lote = porTese.get(m.tese) ?? new Map();
    if (!lote.has(chave)) lote.set(chave, { ementa: m.ementa, irrelevante: m.marca === "irrelevante" });
    porTese.set(m.tese, lote);
  }
  const teses: ResultadoDaTese[] = [];
  const tetos: Relatorio["tetos"] = [];
  let relevantes = 0;
  let irrelevantes = 0;
  let tesesSemIrrelevantesSuficientes = 0;
  for (const tese of [...porTese.keys()].sort((a, b) => a - b)) {
    const itens = [...porTese.get(tese)!.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
    const nIrrelevantes = itens.filter((i) => i.irrelevante).length;
    irrelevantes += nIrrelevantes;
    relevantes += itens.length - nIrrelevantes;
    if (nIrrelevantes < MINIMO_DE_IRRELEVANTES_NA_TESE) {
      tesesSemIrrelevantesSuficientes++;
      continue;
    }
    const simples = itens.map((i) => ({ irrelevante: i.irrelevante, regras: regrasSimples(i.ementa) }));
    const perto = itens.map((i) => ({ irrelevante: i.irrelevante, regras: regrasPerto(i.ementa) }));
    teses.push({ tese, simples: validacaoCruzada(simples), perto: validacaoCruzada(perto) });
    tetos.push({ tese, simples: teto(simples), perto: teto(perto) });
  }
  return {
    teses,
    tetos,
    decisao: decidir(teses),
    totais: {
      ementas: relevantes + irrelevantes,
      relevantes,
      irrelevantes,
      duvida,
      tesesMedidas: teses.length,
      tesesSemIrrelevantesSuficientes,
    },
  };
}

/** Texto para o registro: só contagens por tese e totais. */
export function resumo(r: Relatorio): string {
  const l = (c: Contagem) => `${c.irrelevantesTirados} tirados / ${c.relevantesPerdidos} relevantes perdidos`;
  const linhas = [
    `Ementas medidas: ${r.totais.ementas} (${r.totais.relevantes} relevantes, ${r.totais.irrelevantes} irrelevantes; ${r.totais.duvida} dúvidas fora da conta).`,
    `Teses com irrelevantes suficientes (${MINIMO_DE_IRRELEVANTES_NA_TESE}+): ${r.totais.tesesMedidas}; sem: ${r.totais.tesesSemIrrelevantesSuficientes}.`,
    "",
    "| Tese | Simples (validação) | Perto de (validação) | Teto simples | Teto perto de |",
    "|---|---|---|---|---|",
    ...r.teses.map((t, i) => `| ${t.tese} | ${l(t.simples)} | ${l(t.perto)} | ${l(r.tetos[i].simples)} | ${l(r.tetos[i].perto)} |`),
    "",
    `Ganho líquido (perto − simples, validação): ${r.decisao.ganhoLiquido}; teses com ganho: ${r.decisao.tesesComGanho}; ` +
      `relevantes perdidos: simples ${r.decisao.relevantesPerdidosSimples}, perto ${r.decisao.relevantesPerdidosPerto}.`,
    `Decisão: ${r.decisao.segue ? "SEGUE" : "NÃO SEGUE"}.`,
  ];
  return linhas.join("\n");
}
