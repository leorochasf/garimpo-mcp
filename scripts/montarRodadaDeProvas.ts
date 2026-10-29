/**
 * Monta, sem rede, as consultas da rodada de gravação do banco de provas (ticket 21 do B15; G-73 e G-74).
 * Só lê as tabelas oficiais (processosParadigma em src/tabelaDePrecedentes.ts e src/tabelaDoStf.ts) e o texto de
 * docs/banco-de-provas/teses-propostas.md; quem faz a rede é scripts/rodarRodadaDeProvas.ts.
 *
 * Duas famílias de consulta, cada uma com 1 busca por item (1 chamada ao JurisprudênciaIA):
 * - PARADIGMA (G-73): para uma amostra de temas com um único processo paradigma identificado com segurança, busca-se a
 *   tese do tema e confere-se se o acórdão do paradigma aparece. Cresce sem ninguém rotular à mão. Mede cobertura de
 *   UM item por tema, nunca precisão; e o texto oficial da tese infla o acerto (a busca recebe quase as palavras do
 *   próprio acórdão).
 * - TESE (G-74): cada tese do banco de provas em versão técnica, versão de leigo e só palavras (colunas do documento).
 *
 * O teto de chamadas é do piloto (80 na rodada inteira, conservador): a amostra sai de um sorteio com semente fixa,
 * registrada no relatório.
 */

import type { LinhaDaTabela } from "../src/tabelaDePrecedentes.js";
import type { LinhaDoStf } from "../src/tabelaDoStf.js";

export type TribunalDaAmostra = "stj" | "stf";
export type VersaoDaTese = "tecnica" | "leiga" | "palavras";

export const TETO_DE_CHAMADAS = 80;
export const SEMENTE = 20261010;
/** Quantos temas entram por tribunal na amostra (12 + 12 = 24 de até 30; o resto do teto fica para a verificação). */
export const TEMAS_POR_TRIBUNAL = 12;
/** A busca recebe no máximo isto da tese oficial (caracteres, cortado em palavra inteira). */
export const TAMANHO_MAXIMO_DA_BUSCA = 300;
/** Quantos resultados se pede por busca (como nas rodadas anteriores) e até que posição vale "no topo". */
export const LIMITE_DA_BUSCA = 100;
export const TOPO = 10;

/** Situações em que a tese está firmada; as demais (afetado, em julgamento, cancelado…) ficam de fora da amostra. */
const SITUACOES_FIRMADAS_STJ = new Set(["Trânsito em Julgado", "Acórdão Publicado", "Acórdão Publicado - RE Pendente"]);
const SITUACOES_FIRMADAS_STF = new Set([
  "Trânsito em Julgado",
  "Acórdão de Repercussão Geral publicado",
  "Acórdão de mérito publicado",
  "Mérito julgado",
]);

export interface Paradigma {
  /** Como a tabela escreve: "REsp 1604412". */
  texto: string;
  sigla: string;
  /** Só os dígitos do número, sem zeros à esquerda. */
  numero: string;
}

export interface TemaDaAmostra {
  tribunal: TribunalDaAmostra;
  tipo: string;
  numero: number;
  paradigma: Paradigma;
  tese: string;
}

export interface Consulta {
  id: string;
  fase: "paradigma" | "tese" | "verificacao";
  tribunal: string;
  texto: string;
  /** O texto oficial passou do tamanho máximo e foi cortado. */
  cortada: boolean;
  limite: number;
  /** Fase paradigma e verificação. */
  tema?: TemaDaAmostra;
  /** Fase tese. */
  tese?: number;
  versao?: VersaoDaTese;
}

export interface TeseDoBanco {
  numero: number;
  tecnica: string;
  leiga: string;
  palavras: string;
  /** Tribunal onde a rodada busca a tese: um só, entre os da lista do documento que o site cobre. */
  tribunal: string;
}

export interface Rodada {
  semente: number;
  teto: number;
  /** Amostra de temas (fase paradigma) e as 21 teses × técnica/leiga: saem primeiro, nesta ordem. */
  principais: Consulta[];
  /** "Só palavras": usadas só com o que sobrar do teto depois da verificação. Já na ordem do sorteio. */
  palavras: Consulta[];
  /** Quantas chamadas as principais consomem; o resto do teto é a reserva de verificação e de "só palavras". */
  reserva: number;
}

/** "REsp 1604412" → sigla e número; sem número reconhecível, nada (não é paradigma identificado com segurança). */
export function lerParadigma(texto: string): Paradigma | undefined {
  const m = texto.trim().match(/^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)\s+([\d.]+)(?:\/[A-Z]{2})?$/);
  if (!m) return undefined;
  const numero = m[2].replace(/\./g, "").replace(/^0+/, "");
  return numero ? { texto: texto.trim(), sigla: m[1].replace(/\s+/g, " "), numero } : undefined;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * O número do acórdão que o site devolveu ("REsp 1.234.567/TO", "1234567") é o do paradigma? Mesmo número e, quando o
 * site traz a classe, a mesma classe: "AREsp 1234" não é o "REsp 1234".
 */
export function ehOParadigma(numeroDoAcordao: string, p: Paradigma): boolean {
  const m = numeroDoAcordao.trim().match(/^(?:([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)\s+)?([\d.]+)(?:\/[A-Z]{2})?$/);
  if (!m) return false;
  const numero = m[2].replace(/\./g, "").replace(/^0+/, "");
  if (numero !== p.numero) return false;
  return !m[1] || semAcento(m[1].replace(/\s+/g, " ")) === semAcento(p.sigla);
}

/** Posição (1 = primeiro) do paradigma na lista devolvida pelo site; nenhuma se não veio. */
export function posicaoDoParadigma(numerosDaLista: readonly string[], p: Paradigma): number | undefined {
  const i = numerosDaLista.findIndex((n) => ehOParadigma(n, p));
  return i < 0 ? undefined : i + 1;
}

/** Corta em palavra inteira; diz se cortou. */
export function cortarEmPalavra(texto: string, maximo = TAMANHO_MAXIMO_DA_BUSCA): { texto: string; cortada: boolean } {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= maximo) return { texto: limpo, cortada: false };
  const ate = limpo.slice(0, maximo + 1);
  const espaco = ate.lastIndexOf(" ");
  return { texto: ate.slice(0, espaco > 0 ? espaco : maximo).trimEnd(), cortada: true };
}

/** Gerador pseudoaleatório fixo (mulberry32): mesma semente, mesmo sorteio. */
export function sorteio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embaralhar<T>(lista: readonly T[], semente: number): T[] {
  const copia = [...lista];
  const r = sorteio(semente);
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function candidatos(
  tribunal: TribunalDaAmostra,
  linhas: readonly (LinhaDaTabela | LinhaDoStf)[],
  tipos: readonly string[],
  firmadas: ReadonlySet<string>,
): TemaDaAmostra[] {
  const saida: TemaDaAmostra[] = [];
  for (const l of linhas) {
    if (!tipos.includes(l.tipo) || !l.situacao || !firmadas.has(l.situacao)) continue;
    // "Identificado com segurança": um único processo paradigma que a tabela traz e que se lê como classe + número.
    if (l.processosParadigma?.length !== 1) continue;
    const paradigma = lerParadigma(l.processosParadigma[0]);
    const tese = l.teseFirmada?.replace(/\s+/g, " ").trim();
    if (!paradigma || !tese) continue;
    saida.push({ tribunal, tipo: l.tipo, numero: l.numero, paradigma, tese });
  }
  return saida.sort((a, b) => a.numero - b.numero || a.tipo.localeCompare(b.tipo));
}

/** Amostra estratificada STJ/STF, sorteada com semente fixa. */
export function amostrarTemas(
  stj: readonly LinhaDaTabela[],
  stf: readonly LinhaDoStf[],
  { porTribunal = TEMAS_POR_TRIBUNAL, semente = SEMENTE } = {},
): TemaDaAmostra[] {
  const doStj = candidatos("stj", stj, ["tema repetitivo", "IAC"], SITUACOES_FIRMADAS_STJ);
  const doStf = candidatos("stf", stf, ["repercussão geral"], SITUACOES_FIRMADAS_STF);
  return [...embaralhar(doStj, semente).slice(0, porTribunal), ...embaralhar(doStf, semente + 1).slice(0, porTribunal)];
}

/** Tribunal da tese: o primeiro, nesta ordem, entre os que a lista do documento cita e o site cobre diretamente. */
const PREFERENCIA_DE_TRIBUNAL = ["stj", "tst", "tse", "stf"] as const;

export function tribunalDaTese(tribunaisDoDocumento: string): string {
  const citados = new Set(tribunaisDoDocumento.toLowerCase().match(/\b(stj|stf|tst|tse)\b/g) ?? []);
  return PREFERENCIA_DE_TRIBUNAL.find((t) => citados.has(t)) ?? "stj";
}

const celulas = (linha: string) =>
  linha
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/**
 * Lê de docs/banco-de-provas/teses-propostas.md a tabela das teses (técnica) e a das versões (leiga e só palavras),
 * pela numeração. Tese sem versão leiga ou sem "só palavras" é erro: a rodada não parte de coluna pela metade.
 */
export function lerTeses(markdown: string): TeseDoBanco[] {
  const [tabelaTeses, resto] = markdown.split(/^## Versão leiga/m);
  if (resto === undefined) throw new Error("teses-propostas.md: falta a seção \"Versão leiga\"");
  const linhas = (texto: string, colunas: number) =>
    texto
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("|"))
      .map(celulas)
      .filter((c) => c.length === colunas && /^\d+$/.test(c[0]));
  const versoes = new Map(linhas(resto, 3).map(([n, leiga, palavras]) => [Number(n), { leiga, palavras }]));
  const teses = linhas(tabelaTeses, 4).map(([n, , tese, tribunais]) => {
    const numero = Number(n);
    const v = versoes.get(numero);
    if (!v?.leiga || !v.palavras) throw new Error(`teses-propostas.md: a tese ${numero} não tem versão leiga e "só palavras"`);
    return { numero, tecnica: tese.replace(/\*/g, ""), leiga: v.leiga, palavras: v.palavras, tribunal: tribunalDaTese(tribunais) };
  });
  if (teses.length === 0) throw new Error("teses-propostas.md: nenhuma tese lida");
  return teses;
}

const consultaDeTese = (t: TeseDoBanco, versao: VersaoDaTese): Consulta => {
  const { texto, cortada } = cortarEmPalavra(t[versao === "tecnica" ? "tecnica" : versao === "leiga" ? "leiga" : "palavras"]);
  return { id: `tese-${String(t.numero).padStart(2, "0")}-${versao}`, fase: "tese", tribunal: t.tribunal, texto, cortada, limite: LIMITE_DA_BUSCA, tese: t.numero, versao };
};

const idDoTema = (t: TemaDaAmostra) => `${t.tribunal}-${t.tipo === "IAC" ? "iac" : t.tribunal === "stf" ? "rg" : "tema"}-${t.numero}`;

export function consultaDeParadigma(t: TemaDaAmostra): Consulta {
  const { texto, cortada } = cortarEmPalavra(t.tese);
  return { id: idDoTema(t), fase: "paradigma", tribunal: t.tribunal, texto, cortada, limite: LIMITE_DA_BUSCA, tema: t };
}

/** Para um paradigma que não apareceu: busca pelo próprio número, para dizer "não indexado" × "fora do topo". */
export function consultaDeVerificacao(t: TemaDaAmostra): Consulta {
  return { id: `${idDoTema(t)}-verificacao`, fase: "verificacao", tribunal: t.tribunal, texto: t.paradigma.texto, cortada: false, limite: TOPO, tema: t };
}

/**
 * A rodada completa. Ordem: temas da amostra, depois as teses (técnica e leiga de cada uma, lado a lado). A reserva
 * (teto − principais) paga primeiro a verificação dos paradigmas que não apareceram e, só com a sobra, o "só palavras"
 * das teses na ordem do sorteio.
 */
export function montarRodada(
  stj: readonly LinhaDaTabela[],
  stf: readonly LinhaDoStf[],
  teses: readonly TeseDoBanco[],
  { teto = TETO_DE_CHAMADAS, semente = SEMENTE, porTribunal = TEMAS_POR_TRIBUNAL } = {},
): Rodada {
  const temas = amostrarTemas(stj, stf, { porTribunal, semente });
  const principais = [
    ...temas.map(consultaDeParadigma),
    ...teses.flatMap((t) => [consultaDeTese(t, "tecnica"), consultaDeTese(t, "leiga")]),
  ];
  if (principais.length > teto) throw new Error(`a rodada pede ${principais.length} chamadas, acima do teto de ${teto}`);
  const palavras = embaralhar(teses, semente + 2).map((t) => consultaDeTese(t, "palavras"));
  return { semente, teto, principais, palavras, reserva: teto - principais.length };
}

/**
 * Trava da rodada ao vivo, sem rede e sem tocar o disco (quem lê a pasta passa `existe`). Devolve o motivo da recusa,
 * ou undefined se pode rodar. A rodada custa até TETO_DE_CHAMADAS chamadas ao site: só sai com pasta escolhida de
 * propósito (`--saida`), com `--ao-vivo`, e numa pasta que ainda não tenha plano.json nem gravacao/ (o plano é gravado
 * antes da 1ª chamada, então a pasta de uma rodada interrompida também recusa).
 */
export function recusaDaRodada(
  opcoes: { saida?: string; aoVivo: boolean },
  existe: (caminhoRelativo: string) => boolean,
): string | undefined {
  if (!opcoes.saida) return "informe a pasta de gravação com --saida <pasta>: a rodada faz chamadas de verdade ao site.";
  if (!opcoes.aoVivo) return "falta --ao-vivo: a rodada faz até " + TETO_DE_CHAMADAS + " chamadas de verdade ao site.";
  if (existe("plano.json") || existe("gravacao"))
    return "a pasta já tem plano.json ou gravacao/ (rodada feita ou interrompida). A rodada é feita uma vez só; use outra pasta só se o dono mandar.";
  return undefined;
}
