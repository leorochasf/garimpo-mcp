/**
 * Conferência de citação (ADR-0006): compara, por regra fixa e sem IA, a citação com o texto da fonte (a ementa ou o
 * inteiro teor) e devolve o veredito, a posição de cada ocorrência e as equivalências de diagramação usadas. Pura:
 * sem rede e sem disco. "Citação é literal ou não é citação": só diagramação conta como literal.
 */

import type { InteiroTeorParaConferir, UnidadeDoInteiroTeor } from "./leitura.js";

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

/** Onde fica uma passagem na ementa ou no texto integral do Falcão (texto corrido, sem páginas). */
interface OndeNaEmenta {
  local: "na ementa" | "no texto integral";
}

/** Onde fica uma passagem no inteiro teor: página do PDF (nunca "fl."), parte do ler_inteiro_teor e segmento. */
interface OndeNoInteiroTeor {
  local: "no inteiro teor";
  paginasDoPdf: string;
  parte: string;
  /** Só quando a passagem está numa página grande demais, dividida em segmentos. */
  segmento?: string;
}

type Onde = OndeNaEmenta | OndeNoInteiroTeor;

/** Onde a citação (ou um pedaço dela) está na fonte. */
export type Posicao = Onde & {
  /** Só na ementa: a frase que contém a passagem, copiada da fonte. */
  frase?: string;
  /** Só no "difere só em maiúsculas/pontuação": a passagem exata da fonte, para citar por ela. */
  textoDaFonte?: string;
  /** Só no inteiro teor: a seção do acórdão pelo último título de seção antes da passagem, ou "não identificada". */
  secao?: string;
  /** Indício, na fonte, de que a passagem pode não ser do tribunal (na ementa, só aspas). */
  sinalDeOutroAutor?: string;
};

/** Sem supressão, a posição da passagem; com supressão, a de cada pedaço, na ordem. */
export type Ocorrencia = Posicao | { local: Onde["local"]; pedacos: Posicao[] };

/** Sugestão para corrigir a citação: copiada da fonte e sempre diferente do texto informado. */
export type PassagemParecida = Onde & {
  texto: string;
  palavrasEmComum: string;
  aviso: string;
};

/**
 * Passagem do PDF que só fecha com a citação retirando um hífen de fim de linha ou pulando linhas na quebra de
 * página: nunca confirmada, só mostrada para o usuário conferir no PDF (ADR-0006).
 */
export type PassagemCandidata = OndeNoInteiroTeor & {
  texto: string;
  motivo: string;
  aviso: string;
};

/** Fonte sem texto a conferir: só o motivo, sem contagem. */
export interface NaoVerificavel {
  veredito: "não verificável";
  motivo: string;
  /** Só no inteiro teor com página sem texto extraível: as páginas em que a citação não pôde ser procurada. */
  paginasSemTexto?: string;
  passagemParecida?: PassagemParecida;
  passagemCandidata?: PassagemCandidata;
}

export type ResultadoDaFonte = ConferenciaFeita | NaoVerificavel;

export function naoVerificavel(motivo: string): NaoVerificavel {
  return { veredito: "não verificável", motivo };
}

export interface ConferenciaFeita {
  veredito: Exclude<Veredito, "não verificável">;
  ocorrencias: Ocorrencia[];
  /** Ocorrências apuradas na fonte; com supressão, as combinações dos pedaços não são contadas. */
  total: number | "não apurado";
  equivalencias: string[];
  aviso?: string;
  passagemParecida?: PassagemParecida;
  passagemCandidata?: PassagemCandidata;
}

const MINIMO_DE_PALAVRAS = 5;
const MAXIMO_DE_CARACTERES = 3000;
const MAXIMO_DE_OCORRENCIAS = 10;
/** Supressão no PDF: do 1º ao último pedaço, no máximo 3 páginas seguidas. */
const MAXIMO_DE_PAGINAS_DA_SUPRESSAO = 3;

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

/** O texto de uma fonte e o que a conferência precisa saber dele, com as formas normalizadas guardadas. */
interface Fonte {
  texto: string;
  /** Onde fica o intervalo [a, b) do texto. */
  onde(a: number, b: number): Onde;
  /** Na ementa: a frase que contém o intervalo. */
  frase?(a: number, b: number): string;
  /** No inteiro teor: a seção do acórdão em que fica o intervalo. */
  secao?(a: number, b: number): string;
  sinal(a: number, b: number): string | undefined;
  /** Com supressão: se a cadeia de pedaços de a até b cabe na fonte (no PDF, até 3 páginas seguidas). */
  cadeiaAceita(a: number, b: number): boolean;
  /** Se a passagem [a, b) pode dar "difere só em maiúsculas/pontuação" (no PDF, não se tem hífen de fim de linha). */
  soltaAceita?(a: number, b: number): boolean;
  normalizados: Map<Set<Regra>, Normalizado>;
}

function normalizado(fonte: Fonte, regras: Set<Regra>): Normalizado {
  let n = fonte.normalizados.get(regras);
  if (!n) fonte.normalizados.set(regras, (n = normalizar(fonte.texto, regras)));
  return n;
}

export function conferirNaEmenta(
  ementa: string,
  citacao: Citacao,
  semEmenta = "O acórdão veio sem ementa do JurisprudênciaIA: não há texto para conferir.",
): ResultadoDaFonte {
  if (!ementa.trim()) return naoVerificavel(semEmenta);
  return conferirNoTextoCorrido(ementa, citacao, "na ementa");
}

/**
 * Conferência no texto integral do repositório oficial (Falcão), convertido do HTML: texto corrido, como a ementa, com
 * a posição como a frase que contém a passagem (não há página de PDF).
 */
export function conferirNoTextoIntegral(texto: string, citacao: Citacao): ResultadoDaFonte {
  if (!texto.trim()) return naoVerificavel("O texto integral veio vazio do Falcão: não há texto para conferir.");
  return conferirNoTextoCorrido(texto, citacao, "no texto integral");
}

function conferirNoTextoCorrido(texto: string, citacao: Citacao, local: OndeNaEmenta["local"]): ResultadoDaFonte {
  const fonte: Fonte = {
    texto,
    onde: () => ({ local }),
    frase: (a, b) => fraseEm(texto, a, b),
    sinal: (a, b) =>
      entreAspas(texto, a, b) ? `pode ser de outro autor: a passagem está entre aspas ${local}` : undefined,
    cadeiaAceita: () => true,
    normalizados: new Map(),
  };
  return conferir(fonte, citacao) ?? naoEncontrado(fonte, citacao);
}

/** Intervalo achado na fonte: um, sem supressão; um por pedaço, com supressão. */
type Intervalos = [number, number][];

interface Achado {
  literal: boolean;
  ocorrencias: Intervalos[];
  total: number | "não apurado";
}

/**
 * Procura a citação primeiro só com as equivalências de diagramação (literal) e, sem achar, também sem caixa e
 * pontuação ("difere só em maiúsculas/pontuação", nunca literal).
 */
function procurar(fonte: Fonte, { pedacos, comSupressao }: Citacao): Achado | undefined {
  for (const regras of [LITERAL, SOLTO]) {
    const n = normalizado(fonte, regras);
    const literal = regras === LITERAL;
    const aceita = (achada: Intervalos) => literal || achada.every(([a, b]) => fonte.soltaAceita?.(a, b) ?? true);
    if (!comSupressao) {
      const achados = [...ocorrencias(n, normalizar(pedacos[0], regras).texto.trim())]
        .map((o): Intervalos => [original(n, o)])
        .filter(aceita);
      if (achados.length) return { literal, ocorrencias: achados, total: achados.length };
      continue;
    }
    const cadeia = encadear(fonte, n, pedacos.map((p) => normalizar(p, regras).texto.trim()));
    if (cadeia && aceita(cadeia)) return { literal, ocorrencias: [cadeia], total: "não apurado" };
  }
  return undefined;
}

/**
 * Pedaços na ordem, sem sobreposição: a partir de cada ocorrência do 1º pedaço, cada pedaço seguinte no 1º lugar
 * depois do fim do anterior; vale a 1ª cadeia que a fonte aceita (no PDF, até 3 páginas seguidas).
 */
function encadear(fonte: Fonte, n: Normalizado, pedacos: string[]): Intervalos | undefined {
  for (const primeiro of ocorrencias(n, pedacos[0])) {
    const cadeia = [primeiro];
    for (const p of pedacos.slice(1)) {
      const achado = ocorrencias(n, p, cadeia[cadeia.length - 1][1]).next();
      if (achado.done) return undefined; // começando mais adiante, também não fecharia
      cadeia.push(achado.value);
    }
    const [a] = original(n, cadeia[0]);
    const [, b] = original(n, cadeia[cadeia.length - 1]);
    if (fonte.cadeiaAceita(a, b)) return cadeia.map((o) => original(n, o));
  }
  return undefined;
}

/** O veredito e as posições do que foi achado, ou nada se a citação não está na fonte. */
function conferir(fonte: Fonte, citacao: Citacao): ConferenciaFeita | undefined {
  const achado = procurar(fonte, citacao);
  if (!achado) return undefined;
  const { literal, ocorrencias: achadas } = achado;
  const mostradas = achadas.slice(0, MAXIMO_DE_OCORRENCIAS);
  const pares = achadas.flatMap((achada) =>
    achada.map(([a, b], k): [string, string] => [fonte.texto.slice(a, b), citacao.pedacos[k]]),
  );
  return {
    veredito: !literal
      ? "difere só em maiúsculas/pontuação"
      : citacao.comSupressao
        ? "encontrado com supressão indicada"
        : "encontrado literalmente",
    ocorrencias: mostradas.map((achada) =>
      citacao.comSupressao
        ? {
            local: fonte.onde(achada[0][0], achada[0][1]).local,
            pedacos: achada.map(([a, b]) => posicao(fonte, a, b, literal)),
          }
        : posicao(fonte, achada[0][0], achada[0][1], literal),
    ),
    total: achado.total,
    equivalencias: literal ? equivalenciasUsadas(pares) : [],
    ...(citacao.comSupressao
      ? { aviso: AVISO_SUPRESSAO }
      : achadas.length > mostradas.length
        ? { aviso: `Mostradas ${mostradas.length} de ${achadas.length} ocorrências.` }
        : {}),
  };
}

/** "Não encontrado", com a passagem parecida quando houver (com supressão, pelas palavras de todos os pedaços). */
function naoEncontrado(fonte: Fonte, citacao: Citacao): ConferenciaFeita {
  const parecida = passagemParecida(fonte, citacao.pedacos.join(" "));
  return {
    veredito: "não encontrado",
    ocorrencias: [],
    total: 0,
    equivalencias: [],
    ...(parecida ? { passagemParecida: parecida } : {}),
  };
}

function posicao(fonte: Fonte, a: number, b: number, literal: boolean): Posicao {
  const sinal = fonte.sinal(a, b);
  return {
    ...fonte.onde(a, b),
    ...(fonte.frase ? { frase: fonte.frase(a, b) } : {}),
    ...(literal ? {} : { textoDaFonte: fonte.texto.slice(a, b) }),
    ...(fonte.secao ? { secao: fonte.secao(a, b) } : {}),
    ...(sinal ? { sinalDeOutroAutor: sinal } : {}),
  };
}

/** Separador de uma página sem texto extraível no texto corrido do PDF: nenhuma citação passa por ele. */
const PAGINA_SEM_TEXTO = "\u0000";

/** O texto corrido do inteiro teor e onde começa cada unidade (página ou segmento) nele. */
interface FonteDoInteiroTeor extends Fonte {
  unidades: UnidadeDoInteiroTeor[];
  inicios: number[];
}

interface Variante {
  fonte: Fonte;
  /** O texto de origem de um intervalo da variante. */
  origem(a: number, b: number): [number, number];
  motivo: string;
}

const fontesDoInteiroTeor = new WeakMap<InteiroTeorParaConferir, FonteDoInteiroTeor>();

/**
 * Conferência no inteiro teor (ADR-0006): no texto corrido de todas as páginas do PDF, com a posição como página do
 * PDF, parte do ler_inteiro_teor e segmento. A quebra de página só é atravessada quando é limpa; com hífen de fim de
 * linha ou possível cabeçalho/rodapé no meio, no máximo uma passagem candidata, nunca confirmada.
 */
export function conferirNoInteiroTeor(leitura: InteiroTeorParaConferir, citacao: Citacao): ResultadoDaFonte {
  const semTexto = leitura.unidades.filter((t) => !t.texto).map((t) => t.pagina);
  if (semTexto.length === leitura.unidades.length) {
    return naoVerificavel(
      "Nenhuma página deste PDF tem texto extraível; pode ser escaneado. O Garimpo não faz OCR: confira a citação " +
        "abrindo o arquivo. Isso não quer dizer que a citação não esteja no PDF.",
    );
  }
  let fonte = fontesDoInteiroTeor.get(leitura);
  if (!fonte) fontesDoInteiroTeor.set(leitura, (fonte = fonteDoInteiroTeor(leitura)));
  const feita = conferir(fonte, citacao);
  if (feita) return feita;
  const candidata = passagemCandidata(fonte, citacao);
  const resultado: ConferenciaFeita = candidata
    ? { veredito: "não encontrado", ocorrencias: [], total: 0, equivalencias: [], passagemCandidata: candidata }
    : naoEncontrado(fonte, citacao);
  if (!semTexto.length) return resultado;
  // Região sem texto extraível: a citação pode estar nela, então nunca "não encontrado".
  const paginas = listaDePaginas(semTexto);
  const uma = semTexto.length === 1;
  return {
    ...naoVerificavel(
      `Não achada nas páginas com texto extraível, mas ${uma ? "a" : "as"} ${paginas} não ${uma ? "tem" : "têm"} ` +
        `texto extraível (o Garimpo não faz OCR) e não ${uma ? "foi conferida" : "foram conferidas"}: a citação pode ` +
        `estar ${uma ? "nela" : "nelas"}. Abra o arquivo para conferir.`,
    ),
    paginasSemTexto: `${paginas} de ${leitura.totalDePaginas}`,
    ...(resultado.passagemCandidata ? { passagemCandidata: resultado.passagemCandidata } : {}),
    ...(resultado.passagemParecida ? { passagemParecida: resultado.passagemParecida } : {}),
  };
}

/** "página 4" ou "páginas 2, 4 e 7". */
function listaDePaginas(paginas: number[]): string {
  if (paginas.length === 1) return `página ${paginas[0]}`;
  return `páginas ${paginas.slice(0, -1).join(", ")} e ${paginas[paginas.length - 1]}`;
}

function fonteDoInteiroTeor(leitura: InteiroTeorParaConferir): FonteDoInteiroTeor {
  const { unidades, totalDePaginas, totalDePartes } = leitura;
  const inicios: number[] = [];
  let texto = "";
  unidades.forEach((t, k) => {
    if (k) texto += "\n";
    inicios.push(texto.length);
    texto += t.texto || PAGINA_SEM_TEXTO;
  });
  const unidadeEm = (i: number): UnidadeDoInteiroTeor => {
    let [lo, hi] = [0, inicios.length - 1];
    while (lo < hi) {
      const meio = Math.ceil((lo + hi) / 2);
      if (inicios[meio] <= i) lo = meio;
      else hi = meio - 1;
    }
    return unidades[lo];
  };
  const titulos = titulosDeSecao(texto, (i) => unidadeEm(i).pagina);
  return {
    texto,
    unidades,
    inicios,
    onde(a, b) {
      const [x, y] = [unidadeEm(a), unidadeEm(b - 1)];
      const segmento = (t: UnidadeDoInteiroTeor) =>
        t.segmento ? `segmento ${t.segmento.numero} de ${t.segmento.de} da página ${t.pagina}` : `página ${t.pagina}`;
      /** "página 3 de 10" ou "páginas 3–4 de 10"; o mesmo para a parte. */
      const intervalo = (nome: string, de: number, ate: number, total: number) =>
        de === ate ? `${nome} ${de} de ${total}` : `${nome}s ${de}–${ate} de ${total}`;
      return {
        local: "no inteiro teor",
        paginasDoPdf: intervalo("página", x.pagina, y.pagina, totalDePaginas),
        parte: intervalo("parte", x.parte, y.parte, totalDePartes),
        ...(x.segmento || y.segmento ? { segmento: x === y ? segmento(x) : `${segmento(x)} até ${segmento(y)}` } : {}),
      };
    },
    secao: (a, b) => nomeDaSecao(secoesEm(titulos, a, b)),
    sinal: (a, b) => sinalNoInteiroTeor(texto, a, b, secoesEm(titulos, a, b)),
    // Sem caixa e pontuação, o hífen de fim de linha viraria espaço e a palavra partida passaria por pontuação.
    soltaAceita: (a, b) => !HIFEN_DE_FIM_DE_LINHA.test(texto.slice(a, b)),
    cadeiaAceita: (a, b) => unidadeEm(b - 1).pagina - unidadeEm(a).pagina < MAXIMO_DE_PAGINAS_DA_SUPRESSAO,
    normalizados: new Map(),
  };
}

/** Janela antes da passagem onde se procura a aspa que a abre. */
const JANELA_DAS_ASPAS = 3000;
/** Janela curta antes da passagem onde se procura o marcador de transcrição. */
const JANELA_DO_MARCADOR = 200;
/** Marcadores fixos de transcrição: o que vem depois deles costuma ser texto de outro autor. */
const MARCADORES = [
  "in verbis",
  "verbis",
  "ipsis litteris",
  "in litteris",
  "litteris",
  "ad litteram",
  "confira-se",
  "confiram-se",
  "veja-se",
  "vejam-se",
  "nas palavras d[aoe]s?",
  "transcrevo",
  "transcreve-se",
  "transcrevem-se",
  "colaciono",
  "colaciona-se",
];
const MARCADOR = new RegExp(`(?<![\\p{L}\\p{N}])(?:${MARCADORES.join("|")})(?![\\p{L}\\p{N}])`, "giu");

/**
 * Sinal de outro autor no inteiro teor: a passagem no relatório ou num voto vencido (aviso forte, pelo título de
 * seção), entre aspas, ou com um marcador de transcrição ("in verbis", "confira-se"…) logo antes dela, copiado como
 * está na fonte. É indício, não autoria; a falta dele não prova nada.
 */
function sinalNoInteiroTeor(texto: string, a: number, b: number, secoes: Secoes): string | undefined {
  const sinais: string[] = [];
  const fortes = secoes.titulos.flatMap((t) => {
    const aviso = AVISO_DA_SECAO[t.secao];
    return aviso ? [aviso(t)] : [];
  });
  if (fortes.length) {
    sinais.push(`${fortes.join("; ")}; não a cite como fundamento do tribunal sem conferir no PDF`);
  }
  if (entreAspas(texto, a, b, Math.max(0, a - JANELA_DAS_ASPAS))) {
    sinais.push("a passagem está entre aspas no inteiro teor");
  }
  const marcadores = [...texto.slice(Math.max(0, a - JANELA_DO_MARCADOR), a).normalize("NFC").matchAll(MARCADOR)];
  if (marcadores.length) {
    sinais.push(`logo antes da passagem há o marcador de transcrição "${marcadores[marcadores.length - 1][0]}"`);
  }
  if (!sinais.length) return undefined;
  return `${fortes.length ? "ATENÇÃO, pode" : "pode"} ser de outro autor: ${sinais.join("; ")}`;
}

type Secao = "ementa" | "acórdão" | "relatório" | "voto" | "voto-vista" | "voto vencido" | "voto vogal" | "certidão";

/**
 * Títulos fixos com forma de seção e a seção do acórdão que cada um abre. A chave é o título sem espaços nem hífens,
 * para casar "VOTO-VISTA" com "VOTO VISTA" e as letras espaçadas ("V O T O  V E N C I D O").
 */
const SECOES: Record<string, Secao> = {
  EMENTA: "ementa",
  ACÓRDÃO: "acórdão",
  RELATÓRIO: "relatório",
  VOTO: "voto",
  VOTOVISTA: "voto-vista",
  VOTOVENCIDO: "voto vencido",
  VOTOVOGAL: "voto vogal",
  CERTIDÃO: "certidão",
  CERTIDÃODEJULGAMENTO: "certidão",
};

/** Título de seção achado no PDF: onde começa, a seção que abre, a linha como está na fonte e a página do PDF. */
interface TituloDeSecao {
  inicio: number;
  secao: Secao;
  titulo: string;
  pagina: number;
}

/** Seções com aviso forte: o texto nelas costuma não ser fundamento do tribunal. Indício, nunca autoria. */
const AVISO_DA_SECAO: Partial<Record<Secao, (t: TituloDeSecao) => string>> = {
  relatório: (t) =>
    `a passagem está no relatório (título "${t.titulo}" na página ${t.pagina} do PDF), que costuma reproduzir ` +
    "alegações das partes e decisões anteriores",
  "voto vencido": (t) =>
    `a passagem está num voto vencido (título "${t.titulo}" na página ${t.pagina} do PDF), que, pelo título, não ` +
    "prevaleceu no julgamento",
};

/** Seções que um "EMENTA" ou "ACÓRDÃO" sozinho na linha não fecha: é a transcrição de outra decisão dentro delas. */
const TRANSCREVEM_DECISOES: Secao[] = ["relatório", "voto vencido"];

/**
 * Os títulos de seção do PDF, em ordem: só a linha que é inteira um dos títulos fixos — em maiúsculas ou só com a 1ª
 * letra maiúscula ("Voto vencido") —, sem nada depois além de ":" (ponto final não: "NULIDADE DO\nRELATÓRIO." é fim
 * de frase de ementa em maiúsculas, não título). Em maiúsculas, "VOTO VENCIDO" pode vir seguido do nome do julgador.
 * "Voto" ou "relatório" no corpo do texto não abrem seção.
 */
function titulosDeSecao(texto: string, paginaEm: (i: number) => number): TituloDeSecao[] {
  const titulos: TituloDeSecao[] = [];
  for (const m of texto.matchAll(/^[^\n]{1,80}$/gm)) {
    const titulo = m[0].trim();
    const linha = titulo.normalize("NFC").replace(/\s*:$/, "");
    const maiusculas = /^[\p{Lu}\s-]+$/u.test(linha);
    if (!maiusculas && !/^\p{Lu}[\p{Ll}\s-]+$/u.test(linha)) continue;
    const chave = linha.toUpperCase().replace(/[\s-]/g, "");
    const secao = SECOES[chave] ?? (maiusculas && chave.startsWith("VOTOVENCIDO") ? "voto vencido" : undefined);
    if (!secao) continue;
    const anterior = titulos[titulos.length - 1];
    if ((secao === "ementa" || secao === "acórdão") && anterior && TRANSCREVEM_DECISOES.includes(anterior.secao)) {
      continue;
    }
    titulos.push({ inicio: m.index, secao, titulo, pagina: paginaEm(m.index) });
  }
  return titulos;
}

/** As seções por que passa o intervalo [a, b): a do último título antes dele (se houver) e as que se abrem nele. */
interface Secoes {
  identificada: boolean;
  titulos: TituloDeSecao[];
}

function secoesEm(titulos: TituloDeSecao[], a: number, b: number): Secoes {
  const antes = titulos.filter((t) => t.inicio <= a).pop();
  const dentro = titulos.filter((t) => t.inicio > a && t.inicio < b);
  return { identificada: Boolean(antes), titulos: antes ? [antes, ...dentro] : dentro };
}

/** "voto", "não identificada" ou, atravessando título, "relatório e voto (a passagem atravessa um título de seção)". */
function nomeDaSecao({ identificada, titulos }: Secoes): string {
  const nomes = [...(identificada ? [] : ["não identificada"]), ...titulos.map((t) => t.secao)];
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]} (a passagem atravessa um título de seção)`;
}

/**
 * Passagem candidata: a citação procurada de novo numa variante do texto do PDF — sem o hífen de fim de linha (ou só
 * sem a quebra depois dele), ou pulando até 3 linhas no fim de uma página e no começo da seguinte. Achar assim
 * nunca confirma: o hífen pode ser da palavra e a linha pulada pode ser texto do acórdão.
 */
function passagemCandidata(fonte: FonteDoInteiroTeor, citacao: Citacao): PassagemCandidata | undefined {
  for (const variante of variantes(fonte, citacao)) {
    const achado = procurar(variante.fonte, citacao);
    if (!achado) continue;
    const achada = achado.ocorrencias[0];
    const [a] = variante.origem(...achada[0]);
    const [, b] = variante.origem(...achada[achada.length - 1]);
    return {
      texto: fonte.texto.slice(a, b),
      ...(fonte.onde(a, b) as OndeNoInteiroTeor),
      motivo: achado.literal ? variante.motivo : `${variante.motivo}; e ainda difere em maiúsculas/pontuação`,
      aviso:
        "Passagem candidata copiada do PDF: não confirmada. Confira no PDF se ela é mesmo o texto citado antes de " +
        "citar.",
    };
  }
  return undefined;
}

/** Hífen no fim de uma linha do PDF, entre letras: pode ser da palavra ou só de translineação. */
const HIFEN_DE_FIM_DE_LINHA = /(?<=\p{L})-[ \t]*\n[ \t]*(?=\p{L})/u;

/** Até quantas linhas, no fim de uma página e no começo da seguinte, podem ser cabeçalho ou rodapé. */
const LINHAS_DE_CABECALHO = 3;

const MOTIVO_SEM_HIFEN =
  "a citação só fecha retirando o hífen de fim de linha do PDF, e o Garimpo nunca o retira: ele pode ser da palavra";
const MOTIVO_COM_HIFEN =
  "a citação só fecha juntando a palavra partida pelo hífen de fim de linha do PDF, e o Garimpo não junta: o hífen " +
  "pode ser só de translineação";

const emMinusculas = (texto: string) => texto.normalize("NFC").toLowerCase();

/**
 * As variantes do texto do PDF que podem fechar com esta citação, cada uma numa janela em volta dos hífens ou da
 * quebra de página: só os hífens que partem uma palavra da citação e só os pulos de linha que colam duas palavras
 * vizinhas na citação. Assim, um PDF longo não é refeito inteiro a cada variante.
 */
function* variantes(fonte: FonteDoInteiroTeor, citacao: Citacao): Generator<Variante> {
  const { texto, unidades, inicios } = fonte;
  const citado = emMinusculas(citacao.pedacos.join(" "));
  const janela = 3 * citado.length + 1000;

  // Só os hífens que partem uma palavra da citação; numa janela, todos os do mesmo jeito saem juntos.
  const semHifen: Corte[] = [];
  const comHifen: Corte[] = [];
  for (const m of texto.matchAll(new RegExp(HIFEN_DE_FIM_DE_LINHA, "gu"))) {
    const fim = m.index + m[0].length;
    const antes = emMinusculas(/[\p{L}\p{M}]+$/u.exec(texto.slice(Math.max(0, m.index - 100), m.index))?.[0] ?? "");
    const depois = emMinusculas(/^[\p{L}\p{M}]+/u.exec(texto.slice(fim, fim + 100))?.[0] ?? "");
    if (citado.includes(antes + depois)) semHifen.push({ de: m.index, ate: fim, por: "" });
    if (citado.includes(`${antes}-${depois}`)) comHifen.push({ de: m.index + 1, ate: fim, por: "" });
  }
  for (const [cortes, motivo] of [
    [semHifen, MOTIVO_SEM_HIFEN],
    [comHifen, MOTIVO_COM_HIFEN],
  ] as const) {
    // Hífens próximos vão na mesma janela: uma variante por grupo, não por hífen.
    for (let k = 0; k < cortes.length; ) {
      let j = k;
      while (j + 1 < cortes.length && cortes[j + 1].de - cortes[j].ate < 2 * janela) j++;
      const [de, ate] = [Math.max(0, cortes[k].de - janela), Math.min(texto.length, cortes[j].ate + janela)];
      yield derivar(fonte, de, ate, cortes.slice(k, j + 1), motivo);
      k = j + 1;
    }
  }

  // Pulando linhas, a última palavra antes do pulo e a 1ª depois dele ficam coladas: precisam ser vizinhas na citação.
  const vizinhas = new Set(
    citacao.pedacos.flatMap((p) => palavras(p).flatMap((w, i, ps) => (i ? [`${ps[i - 1].palavra} ${w.palavra}`] : []))),
  );
  const ultimaPalavra = (fim: number) => palavras(texto.slice(Math.max(0, fim - 100), fim)).pop()?.palavra;
  const primeiraPalavra = (inicio: number) => palavras(texto.slice(inicio, inicio + 100))[0]?.palavra;
  const linhas = (n: number) => `${n} ${n === 1 ? "linha" : "linhas"}`;
  for (let k = 1; k < unidades.length; k++) {
    // Quebra de página entre duas páginas com texto: o "\n" que junta a última unidade de uma à 1ª da seguinte.
    if (unidades[k].pagina === unidades[k - 1].pagina || !unidades[k].texto || !unidades[k - 1].texto) continue;
    const juncao = inicios[k] - 1;
    const comeco = inicios[unidades.findIndex((u) => u.pagina === unidades[k - 1].pagina)];
    const final = finalDaPagina(unidades, inicios, k);
    const [de, ate] = [Math.max(comeco, juncao - janela), Math.min(final, juncao + janela)];
    for (let s = 0; s <= LINHAS_DE_CABECALHO; s++) {
      for (let t = 0; t <= LINHAS_DE_CABECALHO; t++) {
        if (!s && !t) continue;
        let x = juncao;
        for (let i = 0; i < s && x >= comeco; i++) x = texto.lastIndexOf("\n", x - 1);
        let y = juncao;
        for (let i = 0; i < t && y >= 0 && y < final; i++) y = texto.indexOf("\n", y + 1);
        // A página toda pulada não é cabeçalho nem rodapé.
        if (x < comeco || y < 0 || y >= final) continue;
        if (!vizinhas.has(`${ultimaPalavra(x)} ${primeiraPalavra(y + 1)}`)) continue;
        const pulado = [s ? `${linhas(s)} do fim da página` : "", t ? `${linhas(t)} do começo da seguinte` : ""];
        yield derivar(
          fonte,
          Math.min(de, x),
          Math.max(ate, y + 1),
          [{ de: x, ate: y + 1, por: "\n" }],
          `a citação só fecha pulando, na quebra de página, ${pulado.filter(Boolean).join(" e ")}, que ` +
            `${s + t === 1 ? "pode" : "podem"} ser cabeçalho ou rodapé — ou texto do acórdão`,
        );
      }
    }
  }
}

/** Onde termina a página da unidade k (o "\n" antes da página seguinte, ou o fim do texto). */
function finalDaPagina(unidades: UnidadeDoInteiroTeor[], inicios: number[], k: number): number {
  let j = k;
  while (j + 1 < unidades.length && unidades[j + 1].pagina === unidades[k].pagina) j++;
  return j + 1 < unidades.length ? inicios[j + 1] - 1 : inicios[j] + unidades[j].texto.length;
}

interface Corte {
  de: number;
  ate: number;
  por: string;
}

/**
 * Variante do texto da fonte entre `inicio` e `fim`, com os cortes (em ordem, sem sobreposição) trocados, que sabe
 * de onde veio cada caractere
 * (posição no texto inteiro da fonte).
 */
function derivar(
  fonte: Fonte,
  inicio: number,
  fim: number,
  cortes: Corte[],
  motivo: string,
): Variante {
  const de: number[] = [];
  const ate: number[] = [];
  const copiar = (a: number, b: number) => {
    for (let i = a; i < b; i++) {
      de.push(i);
      ate.push(i + 1);
    }
    return fonte.texto.slice(a, b);
  };
  let texto = "";
  let i = inicio;
  for (const corte of cortes) {
    texto += copiar(i, corte.de);
    for (const ch of corte.por) {
      texto += ch;
      de.push(corte.de);
      ate.push(corte.ate);
    }
    i = corte.ate;
  }
  texto += copiar(i, fim);
  const origem = (a: number, b: number): [number, number] => [de[a], ate[b - 1]];
  return {
    motivo,
    origem,
    fonte: {
      texto,
      onde: (a, b) => fonte.onde(...origem(a, b)),
      sinal: () => undefined,
      cadeiaAceita: (a, b) => fonte.cadeiaAceita(...origem(a, b)),
      normalizados: new Map(),
    },
  };
}

/** Aspa que abre: tipográfica de abertura, ou reta no começo do texto ou depois de espaço ou parêntese. */
function abreAspas(texto: string, i: number): boolean {
  if (texto[i] === "“" || texto[i] === "«") return true;
  return texto[i] === '"' && (i === 0 || /[\s([{—–-]/.test(texto[i - 1]));
}

/**
 * Sinal de outro autor por aspas: a passagem começa dentro de aspas abertas (a partir de `desde`) e não fechadas, ou
 * tem aspa de abertura dentro dela. Aspa reta depois de número (polegada) não conta. É indício, não autoria; a falta
 * dele não prova nada.
 */
function entreAspas(texto: string, inicio: number, fim: number, desde = 0): boolean {
  let aberta = false;
  for (let i = desde; i < inicio; i++) {
    if (abreAspas(texto, i)) aberta = true;
    else if (texto[i] === "”" || texto[i] === "»") aberta = false;
    else if (texto[i] === '"' && !/\d/.test(texto[i - 1])) aberta = false;
  }
  for (let i = inicio; !aberta && i < fim; i++) aberta = abreAspas(texto, i);
  return aberta;
}

/** Teto de janelas comparadas em ordem na busca da passagem parecida: mantém a resposta rápida em fonte longa. */
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
function passagemParecida(fonte: Fonte, citacao: string): PassagemParecida | undefined {
  const cit = palavras(citacao).map((p) => p.palavra);
  const src = palavras(fonte.texto);
  const n = cit.length;
  if (!n) return undefined;
  // Com 80% em comum, a 1ª palavra casada da citação está entre as primeiras 20%, e a janela tem, fora de ordem,
  // ao menos 80% das palavras da citação. Só as janelas com mais palavras em comum passam pela comparação em ordem.
  const comeco = new Set(cit.slice(0, Math.floor(n / 5) + 1));
  // Janela do dobro da citação: cobre a citação de que se tirou, sem marcar com (...), até metade da frase da fonte.
  const largura = 2 * n;
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
    // Passagem que atravessa página sem texto extraível não é copiada da fonte: há um pedaço que não foi lido.
    if (r.comum && fonte.texto.slice(src[s + r.de].inicio, src[s + r.ate].fim).includes(PAGINA_SEM_TEXTO)) continue;
    if (r.comum && (!melhor || r.comum > melhor.comum || (r.comum === melhor.comum && s + r.de < melhor.de))) {
      melhor = { comum: r.comum, de: s + r.de, ate: s + r.ate };
    }
  }
  if (!melhor || melhor.comum * 5 < n * 4) return undefined;
  const [a, b] = [src[melhor.de].inicio, src[melhor.ate].fim];
  return {
    texto: fonte.texto.slice(a, b),
    ...fonte.onde(a, b),
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
  if (!procurado || procurado.includes(PAGINA_SEM_TEXTO)) return;
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
