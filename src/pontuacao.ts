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

/** O acórdão de entrada com a aderência e a faixa dele (0 = faixa de cima). */
export type Pontuado<T> = T & { aderencia: number; faixa: number };

const TAMANHO_RADICAL = 6;

/** Palavras vazias de 3 letras ou mais (as menores já caem pelo tamanho). Já sem acento. */
const VAZIAS = new Set(
  ("para com art arts lei leis que dos das nos nas aos pelo pela pelos pelas por uma umas uns sob sobre " +
    "entre como seu sua seus suas ele ela eles elas este esta esse essa isso aquele aquela tal")
    .split(" "),
);

/** Minúsculas e sem acento. */
function semAcento(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Só letras e números; sem palavras vazias nem tokens de menos de 3 caracteres. */
function palavras(texto: string): string[] {
  return semAcento(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !VAZIAS.has(p));
}

/**
 * Cada palavra da formulação vira uma busca na ementa pelo radical dela (prefixo de 6 letras) no começo de uma
 * palavra, com ou sem "im"/"in" na frente; palavra longa que já começa com "im"/"in" também vale sem eles.
 * Assim "prescrição", "prescritível" e "imprescritível" casam entre si, nos dois sentidos.
 * Palavra de menos de 6 letras é o próprio radical: só casa com a palavra inteira ou o plural ("dano", "danos").
 * Palavras de mesmo radical contam uma vez só.
 */
function prepararFormulacao(formulacao: string): RegExp[] {
  const porRadical = new Map<string, RegExp>();
  for (const p of palavras(formulacao)) {
    const curta = p.length < TAMANHO_RADICAL;
    const radical = curta ? p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p : p.slice(0, TAMANHO_RADICAL);
    if (porRadical.has(radical)) continue;
    if (curta) {
      porRadical.set(radical, new RegExp(`(?:^|[^a-z0-9])${radical}s?(?![a-z0-9])`));
      continue;
    }
    const alternativas = [radical];
    if (/^i[mn]/.test(p) && p.length >= TAMANHO_RADICAL + 2) alternativas.push(p.slice(2, 2 + TAMANHO_RADICAL));
    porRadical.set(radical, new RegExp(`(?:^|[^a-z0-9])(?:i[mn])?(?:${alternativas.join("|")})`));
  }
  return [...porRadical.values()];
}

function aderenciaPreparada(ementa: string, formulacoes: RegExp[][]): number {
  const texto = semAcento(ementa);
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

/** Texto minúsculo e sem acento, com a posição de cada caractere dele no texto de entrada (mais uma, o fim). */
function semAcentoComPosicoes(texto: string): { texto: string; origem: number[] } {
  let saida = "";
  const origem: number[] = [];
  let i = 0;
  for (const letra of texto) {
    const normal = semAcento(letra);
    for (let k = 0; k < normal.length; k++) origem.push(i);
    saida += normal;
    i += letra.length;
  }
  origem.push(texto.length);
  return { texto: saida, origem };
}

const LETRA = /[\p{L}\p{N}]/u;

/**
 * Recorta `texto` entre `inicio` e `fim`, com "…" onde cortou. Palavra partida na ponta sai (se tiver até 20
 * caracteres), para o trecho nunca passar do tamanho pedido (fora as reticências).
 */
function recortar(texto: string, inicio: number, fim: number): string {
  // Nunca corta ao meio um caractere de dois códigos (emoji e afins).
  const meioDePar = (i: number) => i > 0 && i < texto.length && /[\uDC00-\uDFFF]/.test(texto[i]);
  if (meioDePar(inicio)) inicio++;
  if (meioDePar(fim)) fim--;
  const partida = (i: number) => i > 0 && i < texto.length && LETRA.test(texto[i - 1]) && LETRA.test(texto[i]);
  if (partida(inicio)) {
    let i = inicio;
    while (i < texto.length && LETRA.test(texto[i])) i++;
    if (i - inicio <= 20) inicio = i;
  }
  if (partida(fim)) {
    let i = fim;
    while (i > inicio && LETRA.test(texto[i - 1])) i--;
    if (fim - i <= 20) fim = i;
  }
  return `${inicio > 0 ? "…" : ""}${texto.slice(inicio, fim).trim()}${fim < texto.length ? "…" : ""}`;
}

/**
 * Trecho da ementa onde a tese aparece: janela de ~`tamanho` caracteres em torno da maior concentração de palavras
 * da formulação de maior aderência (empate: a primeira), com o mesmo casamento por radical da aderência. Sem
 * nenhuma palavra da tese na ementa, é o começo dela.
 */
export function trecho(ementa: string, formulacoes: readonly string[], tamanho: number): string {
  const texto = ementa.replace(/\s+/g, " ").trim();
  const normal = semAcentoComPosicoes(texto);
  let escolhida: RegExp[] = [];
  let melhor = 0;
  for (const buscas of formulacoes.map(prepararFormulacao)) {
    if (buscas.length === 0) continue;
    const valor = buscas.filter((b) => b.test(normal.texto)).length / buscas.length;
    if (valor > melhor) [melhor, escolhida] = [valor, buscas];
  }

  // Cada palavra casada: início e fim no texto, e qual palavra da formulação ela casou.
  const achadas = escolhida
    .flatMap((busca, palavra) =>
      [...normal.texto.matchAll(new RegExp(busca.source, "g"))].map((m) => {
        const comeco = m.index + (/^[a-z0-9]/.test(m[0]) ? 0 : 1);
        let final = comeco;
        while (final < normal.texto.length && /[a-z0-9]/.test(normal.texto[final])) final++;
        return { inicio: normal.origem[comeco], fim: normal.origem[final], palavra };
      }),
    )
    .sort((a, b) => a.inicio - b.inicio);
  if (achadas.length === 0) return recortar(texto, 0, tamanho);

  // A janela que começa em cada palavra casada: vence a que tem mais palavras diferentes (empate: a primeira).
  let janela = { inicio: 0, fim: 0, palavras: 0 };
  for (let i = 0; i < achadas.length; i++) {
    const dentro = achadas.slice(i).filter((a) => a.fim <= achadas[i].inicio + tamanho);
    const palavras = new Set(dentro.map((a) => a.palavra)).size;
    if (palavras > janela.palavras) {
      janela = { inicio: achadas[i].inicio, fim: Math.max(...dentro.map((a) => a.fim)), palavras };
    }
  }
  // Centraliza as palavras casadas na janela.
  const sobra = Math.max(0, tamanho - (janela.fim - janela.inicio));
  const inicio = Math.max(0, Math.min(janela.inicio - Math.floor(sobra / 2), texto.length - tamanho));
  return recortar(texto, inicio, Math.max(janela.fim, inicio + tamanho));
}

/**
 * Faixas de aderência: pisos em ordem decrescente; abaixo do último fica a faixa "resto".
 * Valores iniciais do plano.
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
 * empate e reordena nelas os seus acórdãos pela nota; entre tribunais fica a ordem da lista recebida.
 */
export function ordenarPorAderencia<T extends Candidato>(
  itens: readonly T[],
  formulacoes: readonly string[],
  opcoes: OpcoesOrdem = {},
): Pontuado<T>[] {
  const comparar = (a: Pontuado<T>, b: Pontuado<T>) =>
    a.faixa - b.faixa || b.formulacoes - a.formulacoes || a.melhorPosicao - b.melhorPosicao;
  // Sem nota (ou nota não finita, como -Infinity) fica atrás de quem tem; dois assim empatam, nunca NaN.
  const nota = (p: Pontuado<T>) =>
    p.relevancia !== undefined && Number.isFinite(p.relevancia) ? p.relevancia : Number.MIN_SAFE_INTEGER;
  const preparadas = formulacoes.map(prepararFormulacao);
  const pontuados = itens
    .map((item) => {
      const valor = aderenciaPreparada(item.ementa, preparadas);
      return { ...item, aderencia: valor, faixa: faixa(valor, opcoes.faixas) };
    })
    .sort(comparar);

  for (let inicio = 0; inicio < pontuados.length; ) {
    let fim = inicio + 1;
    while (fim < pontuados.length && comparar(pontuados[inicio], pontuados[fim]) === 0) fim++;
    const lugaresPorTribunal = new Map<string, number[]>();
    for (let i = inicio; i < fim; i++) {
      const tribunal = pontuados[i].tribunal;
      if (!lugaresPorTribunal.has(tribunal)) lugaresPorTribunal.set(tribunal, []);
      lugaresPorTribunal.get(tribunal)!.push(i);
    }
    for (const lugares of lugaresPorTribunal.values()) {
      const doTribunal = lugares.map((i) => pontuados[i]).sort((a, b) => nota(b) - nota(a));
      for (let k = 0; k < lugares.length; k++) pontuados[lugares[k]] = doTribunal[k];
    }
    inicio = fim;
  }
  return pontuados;
}
