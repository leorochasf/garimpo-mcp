/**
 * Aderência e ordem da busca ampla.
 *
 * Aderência = a melhor fração, entre as formulações, das palavras da formulação presentes na ementa inteira.
 * Mede proximidade do texto com a tese, não relevância jurídica (ver CONTEXT.md).
 */

export interface Candidato {
  tribunal: string;
  ementa: string;
  /** Quantas formulações acharam o acórdão. */
  formulacoes: number;
  /** Melhor posição do acórdão nas buscas de origem (0 = primeiro). */
  melhorPosicao: number;
  /** Nota de relevância do site; só vale entre acórdãos do mesmo tribunal. */
  relevancia?: number;
}

export interface Pontuado<T> {
  item: T;
  aderencia: number;
  /** 0 = faixa de cima. */
  faixa: number;
}

const TAMANHO_RADICAL = 6;

/** Palavras vazias de 3 letras ou mais (as menores já caem pelo tamanho). Já sem acento. */
const VAZIAS = new Set(
  ("para com art arts lei leis que dos das nos nas aos pelo pela pelos pelas por uma umas uns sob sobre " +
    "entre como seu sua seus suas ele ela eles elas este esta esse essa isso aquele aquela tal")
    .split(" "),
);

/** Minúsculas e sem acento. */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Só letras e números; sem palavras vazias nem tokens de menos de 3 caracteres. */
function palavras(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !VAZIAS.has(p));
}

/**
 * Cada palavra da formulação vira uma busca pelo radical dela (prefixo de 6 letras) no começo de uma palavra
 * da ementa, com ou sem "im"/"in" na frente; palavra longa que já começa com "im"/"in" também vale sem eles.
 * Assim "prescrição", "prescritível" e "imprescritível" casam entre si, nos dois sentidos.
 * Palavras de mesmo radical ("dano", "danos") contam uma vez só.
 */
function prepararFormulacao(formulacao: string): RegExp[] {
  const porRadical = new Map<string, RegExp>();
  for (const p of palavras(formulacao)) {
    const radical = p.slice(0, TAMANHO_RADICAL);
    if (porRadical.has(radical)) continue;
    const alternativas = [radical];
    if (/^i[mn]/.test(p) && p.length >= TAMANHO_RADICAL + 2) alternativas.push(p.slice(2, 2 + TAMANHO_RADICAL));
    porRadical.set(radical, new RegExp(`(?:^|[^a-z0-9])(?:i[mn])?(?:${alternativas.join("|")})`));
  }
  return [...porRadical.values()];
}

function aderenciaPreparada(ementa: string, formulacoes: RegExp[][]): number {
  const texto = normalizar(ementa);
  let melhor = 0;
  for (const buscas of formulacoes) {
    if (buscas.length === 0) continue;
    const presentes = buscas.filter((b) => b.test(texto)).length;
    melhor = Math.max(melhor, presentes / buscas.length);
  }
  return melhor;
}

/** Melhor fração, entre as formulações, das palavras da formulação presentes na ementa (0 a 1). */
export function aderencia(ementa: string, formulacoes: readonly string[]): number {
  return aderenciaPreparada(ementa, formulacoes.map(prepararFormulacao));
}

/**
 * Faixas de aderência: pisos em ordem decrescente; abaixo do último fica a faixa "resto".
 * Valores iniciais do plano; a calibração é do ticket 10.
 */
export const FAIXAS_PADRAO: readonly number[] = [1, 0.85, 0.7];

/** Índice da faixa (0 = faixa de cima; `faixas.length` = resto). */
export function faixa(aderenciaDoItem: number, faixas: readonly number[] = FAIXAS_PADRAO): number {
  const i = faixas.findIndex((piso) => aderenciaDoItem >= piso);
  return i === -1 ? faixas.length : i;
}

export interface OpcoesOrdem {
  /** Pisos das faixas de aderência (padrão: FAIXAS_PADRAO). */
  faixas?: readonly number[];
}

/**
 * Ordem: faixa de aderência → nº de formulações → melhor posição. Entre acórdãos empatados nesses três, a nota
 * de relevância do site só desempata dentro do mesmo tribunal: cada tribunal mantém as posições que ocupa no
 * empate e reordena nelas os seus acórdãos pela nota; entre tribunais fica a ordem de chegada.
 */
export function ordenarPorAderencia<T extends Candidato>(
  itens: readonly T[],
  formulacoes: readonly string[],
  opcoes: OpcoesOrdem = {},
): Pontuado<T>[] {
  const ordem = (a: Pontuado<T>, b: Pontuado<T>) =>
    a.faixa - b.faixa || b.item.formulacoes - a.item.formulacoes || a.item.melhorPosicao - b.item.melhorPosicao;
  // Sem nota, fica atrás de quem tem; dois sem nota empatam (0, nunca NaN).
  const nota = (p: Pontuado<T>) => p.item.relevancia ?? Number.MIN_SAFE_INTEGER;
  const preparadas = formulacoes.map(prepararFormulacao);
  const r = itens
    .map((item) => {
      const a = aderenciaPreparada(item.ementa, preparadas);
      return { item, aderencia: a, faixa: faixa(a, opcoes.faixas) };
    })
    .sort(ordem);

  for (let inicio = 0; inicio < r.length; ) {
    let fim = inicio + 1;
    while (fim < r.length && ordem(r[inicio], r[fim]) === 0) fim++;
    const lugares = new Map<string, number[]>();
    for (let i = inicio; i < fim; i++) lugares.set(r[i].item.tribunal, [...(lugares.get(r[i].item.tribunal) ?? []), i]);
    for (const posicoes of lugares.values()) {
      const doTribunal = posicoes.map((i) => r[i]).sort((a, b) => nota(b) - nota(a));
      posicoes.forEach((i, k) => (r[i] = doTribunal[k]));
    }
    inicio = fim;
  }
  return r;
}
