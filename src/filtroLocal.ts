/**
 * Filtros locais da busca ampla (ADR-0013): condições sobre as ementas já recebidas, sem nova chamada ao site.
 * Casam a expressão inteira, sem diferenciar acento e maiúscula, com fronteira de palavra e espaços normalizados;
 * sem radical e sem sinônimo inventado: os sinônimos vêm de quem chama.
 */

export interface FiltrosLocais {
  /** Grupos de sinônimos: basta um de cada grupo; todos os grupos são exigidos. */
  deveConter?: string[][];
  /** Termos: qualquer um exclui. */
  naoPodeConter?: string[];
}

/** Minúsculas, sem acento e com os espaços (inclusive quebras de linha) reduzidos a um. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** A expressão inteira, sem letra ou número colado antes ou depois. */
function expressao(termo: string): RegExp {
  const escapado = normalizar(termo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapado}(?![\\p{L}\\p{N}])`, "u");
}

/** Diz se a ementa passa pelos filtros locais; sem filtro nenhum (listas ausentes ou vazias), undefined. */
export function filtroLocal(f: FiltrosLocais): ((ementa: string) => boolean) | undefined {
  const deve = (f.deveConter ?? []).map((grupo) => grupo.map(expressao));
  const nao = (f.naoPodeConter ?? []).map(expressao);
  if (!deve.length && !nao.length) return undefined;
  return (ementa) => {
    const texto = normalizar(ementa);
    return deve.every((grupo) => grupo.some((r) => r.test(texto))) && !nao.some((r) => r.test(texto));
  };
}

const FORMATO_DEVE_CONTER =
  'O deveConter não está no formato aceito: lista de grupos de sinônimos, como [["improbidade"], ["dolo", "dolosa"]] ' +
  "(basta um termo de cada grupo; todos os grupos são exigidos), ou um termo só, em texto.";
const FORMATO_NAO_PODE_CONTER =
  'O naoPodeConter não está no formato aceito: lista de termos, como ["multa administrativa", "tributário"] ' +
  "(qualquer um exclui), ou um termo só, em texto.";

/**
 * Lista mandada como texto (ADR-0002): texto de lista JSON vira a lista; outro texto é texto solto (undefined aqui),
 * que vale como um item só, nunca partido por vírgula.
 */
export function listaJson(texto: string): unknown[] | undefined {
  try {
    const lido: unknown = JSON.parse(texto);
    if (Array.isArray(lido)) return lido;
  } catch {
    // Não é JSON: texto solto.
  }
  return undefined;
}

/** Termo com texto de verdade; termo vazio casaria com qualquer ementa. */
const termo = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";

/**
 * Confere e converte os filtros locais como chegam na ferramenta, antes de qualquer chamada ao site. Texto solto em
 * deveConter vale um grupo com um termo; lista de textos soltos é recusada, porque não diz se os termos são
 * sinônimos (um grupo) ou exigências separadas (um grupo cada). Lista vazia não ativa filtro.
 */
export function lerFiltrosLocais(entrada: { deveConter?: unknown; naoPodeConter?: unknown }): FiltrosLocais {
  const filtros: FiltrosLocais = {};
  if (entrada.deveConter !== undefined) {
    const valor = entrada.deveConter;
    const grupos = typeof valor === "string" ? (listaJson(valor) ?? [[valor]]) : valor;
    if (!Array.isArray(grupos)) throw new Error(`${FORMATO_DEVE_CONTER} Veio: ${JSON.stringify(entrada.deveConter)}.`);
    grupos.forEach((grupo, i) => {
      if (!Array.isArray(grupo)) {
        throw new Error(`${FORMATO_DEVE_CONTER} O item ${i + 1} não é um grupo (lista de termos): ${JSON.stringify(grupo)}.`);
      }
      if (!grupo.length) throw new Error(`${FORMATO_DEVE_CONTER} O grupo ${i + 1} está vazio.`);
      if (!grupo.every(termo)) throw new Error(`${FORMATO_DEVE_CONTER} O grupo ${i + 1} tem termo vazio ou que não é texto.`);
    });
    filtros.deveConter = grupos as string[][];
  }
  if (entrada.naoPodeConter !== undefined) {
    const valor = entrada.naoPodeConter;
    const termos = typeof valor === "string" ? (listaJson(valor) ?? [valor]) : valor;
    if (!Array.isArray(termos)) throw new Error(`${FORMATO_NAO_PODE_CONTER} Veio: ${JSON.stringify(entrada.naoPodeConter)}.`);
    termos.forEach((x, i) => {
      if (!termo(x)) throw new Error(`${FORMATO_NAO_PODE_CONTER} O termo ${i + 1} está vazio ou não é texto: ${JSON.stringify(x)}.`);
    });
    filtros.naoPodeConter = termos as string[];
  }
  return filtros;
}
