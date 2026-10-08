/**
 * Conferência de citação (ADR-0006): compara, por regra fixa e sem IA, a citação com o texto da fonte e devolve o
 * veredito, a posição de cada ocorrência e as equivalências de diagramação usadas. Pura: sem rede e sem disco.
 * "Citação é literal ou não é citação": só diagramação conta como literal.
 */

export type Veredito =
  | "encontrado literalmente"
  | "encontrado com supressão indicada"
  | "difere só em maiúsculas/pontuação"
  | "não encontrado"
  | "não verificável";

/** Citação lida: os pedaços entre cortes, na ordem. */
export interface Citacao {
  pedacos: string[];
  comSupressao: boolean;
}

export interface OpcoesCitacao {
  /** Reticências soltas ("...", "…") valem como corte; padrão: são procuradas como texto. */
  reticenciasComoCorte: boolean;
}

/** Onde a citação (ou um pedaço dela) está na ementa. */
export interface PosicaoNaEmenta {
  local: "na ementa";
  /** A frase da ementa que contém a passagem, copiada da fonte. */
  frase: string;
  /** Só no "difere só em maiúsculas/pontuação": a passagem exata da fonte, para citar por ela. */
  textoDaFonte?: string;
  /** Indício, na fonte, de que a passagem pode não ser do tribunal (na ementa, só aspas). */
  sinalDeOutroAutor?: string;
}

/** Sem supressão, a posição da passagem; com supressão, a de cada pedaço, na ordem. */
export type OcorrenciaNaEmenta = PosicaoNaEmenta | { local: "na ementa"; pedacos: PosicaoNaEmenta[] };

/** Sugestão para corrigir a citação: copiada da fonte e sempre diferente do texto informado. */
export interface PassagemParecida {
  texto: string;
  local: "na ementa";
  palavrasEmComum: string;
  aviso: string;
}

/** Fonte sem texto a conferir: só o motivo, sem contagem. */
export interface NaoVerificavel {
  veredito: "não verificável";
  motivo: string;
}

export type ResultadoDaFonte = ConferenciaFeita | NaoVerificavel;

export function naoVerificavel(motivo: string): NaoVerificavel {
  return { veredito: "não verificável", motivo };
}

export interface ConferenciaFeita {
  veredito: Exclude<Veredito, "não verificável">;
  ocorrencias: OcorrenciaNaEmenta[];
  /** Ocorrências apuradas na fonte; com supressão, as combinações dos pedaços não são contadas. */
  total: number | "não apurado";
  equivalencias: string[];
  aviso?: string;
  passagemParecida?: PassagemParecida;
}

const MINIMO_DE_PALAVRAS = 5;
const MAXIMO_DE_CARACTERES = 3000;
const MAXIMO_DE_OCORRENCIAS = 10;

/** Corte marcado (ADR-0006): só "(...)" e "[...]". */
const CORTE = /\(\.\.\.\)|\[\.\.\.\]/;
/** Com a opção ligada, reticências soltas ("...", "…") também cortam, com ou sem parênteses ou colchetes. */
const CORTE_COM_RETICENCIAS = /[([](?:\.\.\.|…)[)\]]|\.\.\.|…/;

const AVISO_SUPRESSAO =
  "Achados os pedaços na ordem, sem sobreposição. A supressão não confirma fidelidade ao sentido: confira o que foi " +
  "cortado. Mostrada a 1ª combinação dos pedaços; o total de combinações não foi apurado.";

function nPalavras(n: number): string {
  return `${n} ${n === 1 ? "palavra" : "palavras"}`;
}

/**
 * Lê a citação e a parte nos cortes indicados. Recusa, com frase que ensina a corrigir, citação acima de 3 mil
 * caracteres, com menos de 5 palavras ou com pedaço entre cortes de menos de 5 palavras.
 */
export function lerCitacao(texto: string, { reticenciasComoCorte }: OpcoesCitacao): Citacao {
  const citacao = texto.trim();
  if (citacao.length > MAXIMO_DE_CARACTERES) {
    throw new Error(
      `A citação tem ${citacao.length} caracteres; o máximo é 3 mil. Divida-a em citações menores (até 20 por chamada).`,
    );
  }
  const corte = reticenciasComoCorte ? CORTE_COM_RETICENCIAS : CORTE;
  const comSupressao = corte.test(citacao);
  const pedacos = citacao.split(corte).map((p) => p.trim()).filter(Boolean);
  if (!comSupressao) {
    const n = palavras(citacao).length;
    if (n < MINIMO_DE_PALAVRAS) {
      throw new Error(
        `A citação tem ${nPalavras(n)}; o mínimo é 5, para não confirmar fragmento banal. Mande a passagem com pelo ` +
          "menos 5 palavras.",
      );
    }
    return { pedacos: [citacao], comSupressao };
  }
  if (!pedacos.length) throw new Error("A citação só tem cortes, sem texto: mande a passagem a conferir.");
  pedacos.forEach((p, k) => {
    const n = palavras(p).length;
    if (n < MINIMO_DE_PALAVRAS) {
      throw new Error(
        `O pedaço ${k + 1} entre os cortes ("${p}") tem ${nPalavras(n)}; cada pedaço entre (...) ou [...] precisa de ` +
          "pelo menos 5 palavras, para não confirmar fragmento banal. Aumente o pedaço com as palavras da fonte ou " +
          "retire-o da citação.",
      );
    }
  });
  return { pedacos, comSupressao };
}

export function conferirNaEmenta(ementa: string, citacao: Citacao): ResultadoDaFonte {
  if (!ementa.trim()) return naoVerificavel("O acórdão veio sem ementa do JurisprudênciaIA: não há texto para conferir.");
  return citacao.comSupressao ? comSupressao(ementa, citacao.pedacos) : semSupressao(ementa, citacao.pedacos[0]);
}

function semSupressao(ementa: string, citado: string): ConferenciaFeita {
  for (const regras of [LITERAL, SOLTO]) {
    const fonte = normalizar(ementa, regras);
    const achados = [...ocorrencias(fonte, normalizar(citado, regras).texto.trim())].map((o) => original(fonte, o));
    if (!achados.length) continue;
    const literal = regras === LITERAL;
    const mostrados = achados.slice(0, MAXIMO_DE_OCORRENCIAS);
    return {
      veredito: literal ? "encontrado literalmente" : "difere só em maiúsculas/pontuação",
      ocorrencias: mostrados.map(([a, b]) => posicao(ementa, a, b, literal)),
      total: achados.length,
      equivalencias: literal ? equivalenciasUsadas(achados.map(([a, b]) => [ementa.slice(a, b), citado])) : [],
      ...(achados.length > mostrados.length
        ? { aviso: `Mostradas ${mostrados.length} de ${achados.length} ocorrências.` }
        : {}),
    };
  }
  return naoEncontrado(ementa, citado);
}

/** "Não encontrado", com a passagem parecida quando houver (com supressão, pelas palavras de todos os pedaços). */
function naoEncontrado(ementa: string, citado: string): ConferenciaFeita {
  const parecida = passagemParecida(ementa, citado);
  return {
    veredito: "não encontrado",
    ocorrencias: [],
    total: 0,
    equivalencias: [],
    ...(parecida ? { passagemParecida: parecida } : {}),
  };
}

/** Pedaços na ordem, sem sobreposição: cada um procurado a partir do fim do anterior (o 1º encaixe basta). */
function comSupressao(ementa: string, pedacos: string[]): ConferenciaFeita {
  for (const regras of [LITERAL, SOLTO]) {
    const fonte = normalizar(ementa, regras);
    const cadeia: [number, number][] = [];
    let desde = 0;
    for (const p of pedacos) {
      const achado = ocorrencias(fonte, normalizar(p, regras).texto.trim(), desde).next();
      if (achado.done) break;
      cadeia.push(original(fonte, achado.value));
      desde = achado.value[1];
    }
    if (cadeia.length < pedacos.length) continue;
    const literal = regras === LITERAL;
    return {
      veredito: literal ? "encontrado com supressão indicada" : "difere só em maiúsculas/pontuação",
      ocorrencias: [{ local: "na ementa", pedacos: cadeia.map(([a, b]) => posicao(ementa, a, b, literal)) }],
      total: "não apurado",
      equivalencias: literal ? equivalenciasUsadas(cadeia.map(([a, b], k) => [ementa.slice(a, b), pedacos[k]])) : [],
      aviso: AVISO_SUPRESSAO,
    };
  }
  return naoEncontrado(ementa, pedacos.join(" "));
}

function posicao(ementa: string, a: number, b: number, literal: boolean): PosicaoNaEmenta {
  return {
    local: "na ementa",
    frase: fraseEm(ementa, a, b),
    ...(literal ? {} : { textoDaFonte: ementa.slice(a, b) }),
    ...(entreAspas(ementa, a, b) ? { sinalDeOutroAutor: "pode ser de outro autor: a passagem está entre aspas na ementa" } : {}),
  };
}

/** Aspa que abre: tipográfica de abertura, ou reta no começo do texto ou depois de espaço ou parêntese. */
function abreAspas(texto: string, i: number): boolean {
  if (texto[i] === "“" || texto[i] === "«") return true;
  return texto[i] === '"' && (i === 0 || /[\s([{—–-]/.test(texto[i - 1]));
}

/**
 * Sinal de outro autor na ementa (ADR-0006, só aspas): a passagem começa dentro de aspas abertas e não fechadas,
 * ou tem aspa de abertura dentro dela. Aspa reta depois de número (polegada) não conta. É indício, não autoria; a
 * falta dele não prova nada.
 */
function entreAspas(texto: string, inicio: number, fim: number): boolean {
  let aberta = false;
  for (let i = 0; i < inicio; i++) {
    if (abreAspas(texto, i)) aberta = true;
    else if (texto[i] === "”" || texto[i] === "»") aberta = false;
    else if (texto[i] === '"' && !/\d/.test(texto[i - 1])) aberta = false;
  }
  for (let i = inicio; !aberta && i < fim; i++) aberta = abreAspas(texto, i);
  return aberta;
}

/** Teto de janelas comparadas em ordem na busca da passagem parecida: mantém a resposta rápida em ementa longa. */
const MAXIMO_DE_JANELAS = 50;

/** Palavras (letras e números) com a posição no texto original. */
function palavras(texto: string) {
  return [...texto.matchAll(/[\p{L}\p{N}\p{M}]+/gu)].map((m) => ({
    palavra: m[0].normalize("NFC").toLowerCase(),
    inicio: m.index,
    fim: m.index + m[0].length,
  }));
}

/**
 * Passagem parecida: a janela da fonte com mais palavras da citação na mesma ordem (maior subsequência comum de
 * palavras), aceita com 80% ou mais. Comparação fixa, sem IA; o texto devolvido é copiado da fonte.
 */
function passagemParecida(fonte: string, citacao: string): PassagemParecida | undefined {
  const cit = palavras(citacao).map((p) => p.palavra);
  const src = palavras(fonte);
  const n = cit.length;
  if (!n) return undefined;
  // Com 80% em comum, a 1ª palavra casada da citação está entre as primeiras 20%, e a janela tem, fora de ordem,
  // ao menos 80% das palavras da citação. Só as janelas com mais palavras em comum passam pela comparação em ordem.
  const comeco = new Set(cit.slice(0, Math.floor(n / 5) + 1));
  const largura = n + Math.ceil(n / 4);
  const precisa = Math.ceil((n * 4) / 5);
  const naCitacao = new Map<string, number>();
  for (const p of cit) naCitacao.set(p, (naCitacao.get(p) ?? 0) + 1);
  const naJanela = new Map<string, number>();
  let emComum = 0;
  const mover = (palavra: string, d: 1 | -1) => {
    const antes = naJanela.get(palavra) ?? 0;
    naJanela.set(palavra, antes + d);
    const limite = naCitacao.get(palavra) ?? 0;
    if (d === 1 && antes < limite) emComum++;
    if (d === -1 && antes <= limite) emComum--;
  };
  const candidatas: { s: number; emComum: number }[] = [];
  for (let j = 0; j < Math.min(largura, src.length); j++) mover(src[j].palavra, 1);
  for (let s = 0; s < src.length; s++) {
    if (s > 0) {
      mover(src[s - 1].palavra, -1);
      if (s + largura - 1 < src.length) mover(src[s + largura - 1].palavra, 1);
    }
    if (comeco.has(src[s].palavra) && emComum >= precisa) candidatas.push({ s, emComum });
  }
  let melhor: { comum: number; de: number; ate: number } | undefined;
  for (const { s } of candidatas.sort((x, y) => y.emComum - x.emComum || x.s - y.s).slice(0, MAXIMO_DE_JANELAS)) {
    const janela = src.slice(s, s + largura).map((p) => p.palavra);
    const r = subsequenciaComum(cit, janela);
    if (r.comum && (!melhor || r.comum > melhor.comum || (r.comum === melhor.comum && s + r.de < melhor.de))) {
      melhor = { comum: r.comum, de: s + r.de, ate: s + r.ate };
    }
  }
  if (!melhor || melhor.comum * 5 < n * 4) return undefined;
  return {
    texto: fonte.slice(src[melhor.de].inicio, src[melhor.ate].fim),
    local: "na ementa",
    palavrasEmComum: `${melhor.comum} de ${n} palavras da citação, na mesma ordem`,
    aviso: "Passagem parecida copiada da fonte: não é o texto informado. Corrija a citação pela fonte antes de citar.",
  };
}

/** Maior subsequência comum entre as palavras, com o índice da 1ª e da última palavra casada em `b`. */
function subsequenciaComum(a: string[], b: string[]): { comum: number; de: number; ate: number } {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  let de = -1;
  let ate = -1;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      if (de < 0) de = j;
      ate = j;
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  }
  return { comum: t[0][0], de, ate };
}

/**
 * Equivalências de diagramação (ADR-0006): as únicas diferenças que ainda contam como literal. "solto" é só para o
 * veredito "difere só em maiúsculas/pontuação", que nunca é literal.
 */
type Regra = "espaco" | "nbsp" | "unicode" | "aspas" | "solto";

const NOME_DA_EQUIVALENCIA: Record<Exclude<Regra, "solto">, string> = {
  espaco: "espaço ou quebra de linha",
  nbsp: "espaço não separável",
  unicode: "forma Unicode dos acentos",
  aspas: "aspas ou apóstrofo tipográfico",
};

const DIAGRAMACAO = Object.keys(NOME_DA_EQUIVALENCIA) as Exclude<Regra, "solto">[];
const LITERAL = new Set<Regra>(DIAGRAMACAO);
const SOLTO = new Set<Regra>([...DIAGRAMACAO, "solto"]);

const ESPACO = /^[\t\n\v\f\r \u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]$/;
const NBSP = /^[\u00a0\u2007\u202f]$/;
/** Pontuação que o "difere só em maiúsculas/pontuação" ignora; símbolos (%, §, &, /) não: mudam o texto. */
const PONTUACAO = /^[.,;:!?()[\]{}"'“”„‟‘’‚‛«»…¡¿‐‑‒–—-]$/;
const ASPAS: Record<string, string> = { "“": '"', "”": '"', "„": '"', "‟": '"', "‘": "'", "’": "'", "‚": "'", "‛": "'" };

/** Texto normalizado com, para cada caractere, o intervalo [inicio, fim) de onde ele veio no original. */
interface Normalizado {
  texto: string;
  inicio: number[];
  fim: number[];
}

function normalizar(original: string, regras: Set<Regra>): Normalizado {
  let texto = "";
  const inicio: number[] = [];
  const fim: number[] = [];
  let emEspaco = false;
  // Letra com os acentos que vêm em seguida (forma decomposta): um grupo só, normalizado junto.
  for (const g of original.matchAll(/\P{M}\p{M}*|\p{M}+/gsu)) {
    const a = g.index;
    const b = a + g[0].length;
    const espaco =
      (regras.has("espaco") && ESPACO.test(g[0])) ||
      (regras.has("nbsp") && NBSP.test(g[0])) ||
      // Pontuação entre algarismos é parte do número ("10.000" não é "10,000").
      (regras.has("solto") && PONTUACAO.test(g[0]) && !(/\d/.test(original[a - 1]) && /\d/.test(original[b])));
    if (espaco && emEspaco && regras.has("espaco")) {
      fim[fim.length - 1] = b;
      continue;
    }
    emEspaco = espaco;
    let s = espaco ? " " : regras.has("unicode") ? g[0].normalize("NFC") : g[0];
    if (regras.has("aspas")) s = ASPAS[s] ?? s;
    if (regras.has("solto")) s = s.toLowerCase();
    for (const c of s) {
      texto += c;
      inicio.push(a);
      fim.push(b);
    }
  }
  return { texto, inicio, fim };
}

const LETRA_OU_NUMERO = /[\p{L}\p{N}]/u;

/**
 * Ocorrências da citação normalizada na fonte normalizada, a partir de `desde`, como intervalos do texto
 * normalizado. A citação não pode começar nem terminar no meio de uma palavra da fonte.
 */
function* ocorrencias(fonte: Normalizado, procurado: string, desde = 0): Generator<[number, number]> {
  if (!procurado) return;
  const bordaInicio = LETRA_OU_NUMERO.test(procurado[0]);
  const bordaFim = LETRA_OU_NUMERO.test(procurado[procurado.length - 1]);
  for (let i = fonte.texto.indexOf(procurado, desde); i >= 0; i = fonte.texto.indexOf(procurado, i + 1)) {
    const j = i + procurado.length;
    if (bordaInicio && i > 0 && LETRA_OU_NUMERO.test(fonte.texto[i - 1])) continue;
    if (bordaFim && j < fonte.texto.length && LETRA_OU_NUMERO.test(fonte.texto[j])) continue;
    yield [i, j];
  }
}

/** O intervalo do texto original de onde veio um intervalo do texto normalizado. */
function original(fonte: Normalizado, [i, j]: [number, number]): [number, number] {
  return [fonte.inicio[i], fonte.fim[j - 1]];
}

/** As equivalências sem as quais alguma passagem achada e o texto citado dela deixariam de ser iguais. */
function equivalenciasUsadas(pares: [string, string][]): string[] {
  return DIAGRAMACAO.filter((regra) => {
    const sem = new Set(DIAGRAMACAO.filter((r) => r !== regra));
    return pares.some(([achado, citado]) => normalizar(achado, sem).texto.trim() !== normalizar(citado, sem).texto.trim());
  }).map((r) => NOME_DA_EQUIVALENCIA[r]);
}

/** Abreviaturas comuns em ementa: o ponto delas não encerra frase ("Rel. Min. Fulano", "art. 37"). */
const ABREVIATURAS = new Set(
  ("art arts inc incs al fl fls p pp pág págs rel min des desa dr dra sr sra exmo exma cf ob op cit n nº v vol ed " +
    "julg publ dj dje proc sec cap par parág ag resp agrg agint edcl ex obs").split(" "),
);

/** A palavra que termina logo antes de `fim` (sem pontuação de abertura) e onde ela começa. */
function palavraAntes(texto: string, fim: number): { palavra: string; inicio: number } {
  let k = fim - 1;
  while (k >= 0 && !/\s/.test(texto[k])) k--;
  return { palavra: texto.slice(k + 1, fim).replace(/^[("“«[]+/, "").toLowerCase(), inicio: k + 1 };
}

function abreviatura(palavra: string): boolean {
  return ABREVIATURAS.has(palavra) || /^\p{L}$/u.test(palavra);
}

/**
 * Começo de frase: depois de ".", "!" ou "?" seguido de espaço e de maiúscula ou de número de item ("2."); ou
 * depois de quebra de linha. Não encerram frase o ponto de abreviatura nem o do próprio número de item ("1. A…"),
 * salvo número logo depois de abreviatura ("art. 37. O dano…").
 */
function inicioDeFrase(texto: string, i: number): boolean {
  if (i === 0) return true;
  let j = i - 1;
  if (!/\s/.test(texto[j])) return false;
  for (; j >= 0 && /\s/.test(texto[j]); j--) if (texto[j] === "\n") return true;
  if (j < 0 || !/[.!?]/.test(texto[j])) return false;
  const antes = palavraAntes(texto, j);
  if (abreviatura(antes.palavra)) return false;
  if (/^\d+$/.test(antes.palavra)) {
    let k = antes.inicio - 1;
    while (k >= 0 && /\s/.test(texto[k])) k--;
    const anterior = k >= 0 && texto[k] === "." ? palavraAntes(texto, k).palavra : "";
    if (!abreviatura(anterior)) return false;
  }
  return /^(\p{Lu}|\d+[.)]\s)/u.test(texto.slice(i, i + 12));
}

/** A frase (ou frases) da fonte que contém o intervalo [inicio, fim), sem os espaços das pontas. */
function fraseEm(texto: string, inicio: number, fim: number): string {
  let a = inicio;
  while (a > 0 && !inicioDeFrase(texto, a)) a--;
  let b = fim;
  while (b < texto.length && !inicioDeFrase(texto, b)) b++;
  return texto.slice(a, b).trim();
}
