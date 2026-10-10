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
  /**
   * Só no inteiro teor e no texto integral: a seção do acórdão pelo último título de seção antes da passagem, ou "não
   * identificada".
   */
  secao?: string;
  /**
   * Só com a seção identificada, e só quando há: na ementa, a parte do modelo padronizado pelo último título dela
   * ("caso em exame", "questão em discussão", "razões de decidir", "dispositivo e tese"); no voto, "fundamentação" ou
   * "dispositivo" (aberto por fórmula como "Ante o exposto"). É informação de lugar: não muda o veredito nem a busca.
   */
  subparte?: string;
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
  /** Só no inteiro teor lido em parte: as páginas além do teto de leitura, que não foram lidas nem conferidas. */
  paginasNaoLidas?: string;
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
  /** No inteiro teor e no texto integral: a seção do acórdão em que fica o intervalo. */
  secao?(a: number, b: number): string;
  /** No inteiro teor e no texto integral: a subparte da seção em que fica o intervalo, se identificada. */
  subparte?(a: number, b: number): string | undefined;
  sinal(a: number, b: number, ligados: SinaisDeQuemDisse): string | undefined;
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
 * a posição como a frase que contém a passagem (não há página de PDF). `ligados` escolhe os sinais de "quem disse"
 * (G-08), como no inteiro teor; o padrão é SINAIS_DE_QUEM_DISSE.
 */
export function conferirNoTextoIntegral(
  texto: string,
  citacao: Citacao,
  ligados: SinaisDeQuemDisse = SINAIS_DE_QUEM_DISSE,
): ResultadoDaFonte {
  if (!texto.trim()) return naoVerificavel("O texto integral veio vazio do Falcão: não há texto para conferir.");
  return conferirNoTextoCorrido(texto, citacao, "no texto integral", ligados);
}

function conferirNoTextoCorrido(
  texto: string,
  citacao: Citacao,
  local: OndeNaEmenta["local"],
  ligados: SinaisDeQuemDisse = SINAIS_DE_QUEM_DISSE,
): ResultadoDaFonte {
  // No texto integral (convertido do HTML, com linhas), a posição no julgado pelos mesmos títulos do PDF; sem página.
  const marcas = local === "no texto integral" ? marcasDoJulgado(texto, () => 0) : undefined;
  let proclamado: string | undefined;
  const fonte: Fonte = {
    texto,
    onde: () => ({ local }),
    frase: (a, b) => fraseEm(texto, a, b),
    ...(marcas
      ? {
          secao: (a: number, b: number) => nomeDaSecao(secoesEm(marcas.titulos, a, b)),
          subparte: (a: number, b: number) => subparteEm(marcas, a, b),
        }
      : {}),
    sinal: (a, b, ligados) => {
      const secoes = marcas && secoesEm(marcas.titulos, a, b);
      const sinais = [
        ...(entreAspas(texto, a, b) ? [`a passagem está entre aspas ${local}`] : []),
        ...(marcas && secoes
          ? sinaisDeQuemDisse(
              texto,
              a,
              b,
              secoes.identificada ? secoes.titulos[0].inicio : 0,
              ligados,
              (proclamado ??= proclamacao(texto, marcas.titulos)),
            )
          : []),
      ];
      return sinais.length ? `pode ser de outro autor: ${sinais.join("; ")}` : undefined;
    },
    cadeiaAceita: () => true,
    normalizados: new Map(),
  };
  return conferir(fonte, citacao, ligados) ?? naoEncontrado(fonte, citacao);
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
function conferir(
  fonte: Fonte,
  citacao: Citacao,
  ligados: SinaisDeQuemDisse = SINAIS_DE_QUEM_DISSE,
): ConferenciaFeita | undefined {
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
            pedacos: achada.map(([a, b]) => posicao(fonte, a, b, literal, ligados)),
          }
        : posicao(fonte, achada[0][0], achada[0][1], literal, ligados),
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

function posicao(fonte: Fonte, a: number, b: number, literal: boolean, ligados: SinaisDeQuemDisse): Posicao {
  const sinal = fonte.sinal(a, b, ligados);
  const subparte = fonte.subparte?.(a, b);
  return {
    ...fonte.onde(a, b),
    ...(fonte.frase ? { frase: fonte.frase(a, b) } : {}),
    ...(literal ? {} : { textoDaFonte: fonte.texto.slice(a, b) }),
    ...(fonte.secao ? { secao: fonte.secao(a, b) } : {}),
    ...(subparte ? { subparte } : {}),
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
 * linha ou possível cabeçalho/rodapé no meio, no máximo uma passagem candidata, nunca confirmada. `ligados` escolhe os
 * sinais de "quem disse" (G-08); o padrão é SINAIS_DE_QUEM_DISSE.
 */
export function conferirNoInteiroTeor(
  leitura: InteiroTeorParaConferir,
  citacao: Citacao,
  ligados: SinaisDeQuemDisse = SINAIS_DE_QUEM_DISSE,
): ResultadoDaFonte {
  const semTexto = [...new Set(leitura.unidades.filter((t) => !t.texto && !t.naoLida).map((t) => t.pagina))];
  const naoLidas = [...new Set(leitura.unidades.filter((t) => t.naoLida).map((t) => t.pagina))];
  if (!naoLidas.length && leitura.unidades.every((t) => !t.texto)) {
    return naoVerificavel(
      "Nenhuma página deste PDF tem texto extraível; pode ser escaneado. O Garimpo não faz OCR: confira a citação " +
        "abrindo o arquivo. Isso não quer dizer que a citação não esteja no PDF.",
    );
  }
  let fonte = fontesDoInteiroTeor.get(leitura);
  if (!fonte) fontesDoInteiroTeor.set(leitura, (fonte = fonteDoInteiroTeor(leitura)));
  const feita = conferir(fonte, citacao, ligados);
  if (feita) return feita;
  const candidata = passagemCandidata(fonte, citacao);
  const resultado: ConferenciaFeita = candidata
    ? { veredito: "não encontrado", ocorrencias: [], total: 0, equivalencias: [], passagemCandidata: candidata }
    : naoEncontrado(fonte, citacao);
  if (!semTexto.length && !naoLidas.length) return resultado;
  // Região sem texto extraível ou não lida (teto de leitura): a citação pode estar nela, então nunca "não encontrado".
  const semTextoDito = semTexto.length
    ? `${semTexto.length === 1 ? "a" : "as"} ${listaDePaginas(semTexto)} não ${semTexto.length === 1 ? "tem" : "têm"} ` +
      `texto extraível (o Garimpo não faz OCR) e não ${semTexto.length === 1 ? "foi conferida" : "foram conferidas"}`
    : "";
  const naoLidasDito = naoLidas.length
    ? `${naoLidas.length === 1 ? "a" : "as"} ${intervaloDePaginas(naoLidas)} não ` +
      `${naoLidas.length === 1 ? "foi lida" : "foram lidas"} (teto de leitura) e não ` +
      `${naoLidas.length === 1 ? "foi conferida" : "foram conferidas"}`
    : "";
  const uma = semTexto.length + naoLidas.length === 1;
  return {
    ...naoVerificavel(
      `Não achada nas páginas ${naoLidas.length ? "lidas" : ""}${semTexto.length && naoLidas.length ? " " : ""}` +
        `${semTexto.length ? "com texto extraível" : ""}, mas ${[semTextoDito, naoLidasDito].filter(Boolean).join(", e ")}: ` +
        `a citação pode estar ${uma ? "nela" : "nelas"}. Abra o arquivo para conferir.`,
    ),
    ...(semTexto.length ? { paginasSemTexto: `${listaDePaginas(semTexto)} de ${leitura.totalDePaginas}` } : {}),
    ...(naoLidas.length ? { paginasNaoLidas: `${intervaloDePaginas(naoLidas)} de ${leitura.totalDePaginas}` } : {}),
    ...(resultado.passagemCandidata ? { passagemCandidata: resultado.passagemCandidata } : {}),
    ...(resultado.passagemParecida ? { passagemParecida: resultado.passagemParecida } : {}),
  };
}

/** "página 4" ou "páginas 2, 4 e 7". */
function listaDePaginas(paginas: number[]): string {
  if (paginas.length === 1) return `página ${paginas[0]}`;
  return `páginas ${paginas.slice(0, -1).join(", ")} e ${paginas[paginas.length - 1]}`;
}

/** Como listaDePaginas, mas páginas seguidas (as que passaram do teto, às vezes milhares) viram "páginas 3 a 6". */
function intervaloDePaginas(paginas: number[]): string {
  const seguidas = paginas.length > 2 && paginas.every((p, i) => i === 0 || p === paginas[i - 1] + 1);
  return seguidas ? `páginas ${paginas[0]} a ${paginas[paginas.length - 1]}` : listaDePaginas(paginas);
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
  const marcas = marcasDoJulgado(texto, (i) => unidadeEm(i).pagina);
  const { titulos } = marcas;
  let proclamado: string | undefined;
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
    subparte: (a, b) => subparteEm(marcas, a, b),
    sinal: (a, b, ligados) =>
      sinalNoInteiroTeor(texto, a, b, secoesEm(titulos, a, b), ligados, (proclamado ??= proclamacao(texto, titulos))),
    // Sem caixa e pontuação, o hífen de fim de linha viraria espaço e a palavra partida passaria por pontuação.
    soltaAceita: (a, b) => !HIFEN_DE_FIM_DE_LINHA.test(texto.slice(a, b)),
    cadeiaAceita: (a, b) => unidadeEm(b - 1).pagina - unidadeEm(a).pagina < MAXIMO_DE_PAGINAS_DA_SUPRESSAO,
    normalizados: new Map(),
  };
}

/**
 * Sinais de "quem disse" (G-08), além dos de seção, aspas e marcador de transcrição: cada um tem interruptor próprio
 * e só entra ligado depois de medido às cegas (G-75, ticket 10). Todos são sinal de outro autor — indício, nunca
 * autoria nem juízo sobre a passagem.
 */
export interface SinaisDeQuemDisse {
  /** "Não" (ou "nem", "nunca", "jamais") logo antes da passagem, na mesma oração: o sentido pode estar invertido. */
  negacao: boolean;
  /** Parte com verbo de alegação antes da passagem, na mesma frase ("o apelante sustenta que…"). */
  alegacaoDaParte: boolean;
  /** Fecho de ementa de outro julgado logo depois: parênteses com relator e data. */
  ementaTranscrita: boolean;
  /** Fórmula de divergência antes da passagem ("divirjo"…), em julgamento que não se diz unânime. */
  divergencia: boolean;
  /** Marca de raciocínio hipotético logo antes ("ainda que assim não fosse"): só a localização. */
  raciocinioHipotetico: boolean;
}

/** Os interruptores de hoje: todos desligados até a medição (G-75). */
export const SINAIS_DE_QUEM_DISSE: Readonly<SinaisDeQuemDisse> = Object.freeze({
  negacao: false,
  alegacaoDaParte: false,
  ementaTranscrita: false,
  divergencia: false,
  raciocinioHipotetico: false,
});

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
const MARCADOR = palavra(MARCADORES);

/** Palavra inteira, em qualquer caixa, de uma das formas dadas (expressões regulares). */
function palavra(formas: string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${formas.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

/** Janela curta antes da passagem onde se procura a negação. */
const JANELA_DA_NEGACAO = 40;
/** Negações que invertem o que vem logo depois; "nao" para o PDF que perdeu o til. */
const NEGACAO = palavra(["n[aã]o", "nem", "nunca", "jamais"]);

/** As partes do processo, pelo nome que recebem no acórdão. */
const PARTES =
  "(?:o|a|os|as)\\s+(?:parte\\s+)?(?:apelante|apelad[oa]|recorrente|recorrid[oa]|agravante|agravad[oa]|embargante|" +
  "embargad[oa]|impetrante|impetrad[oa]|autor|autora|r[ée]u|r[ée]|requerente|requerid[oa]|reclamante|reclamad[oa]|" +
  "exequente|executad[oa]|demandante|demandad[oa]|acusad[oa]|defesa|parte)s?";
/** Verbos de alegação, em qualquer flexão ("sustenta", "alegou", "aduzem"…). */
const ALEGA = "(?:sustent|aleg|aduz|argument|afirm|defend|assever|pretend|insist|pugn|postul|argu)\\p{L}*";
/** Parte e verbo de alegação, em qualquer ordem: "o apelante, em suas razões, sustenta" ou "alega a defesa". */
const ALEGACAO = palavra([`${PARTES}(?![\\p{L}\\p{N}])[^.!?;]{0,40}?(?<![\\p{L}\\p{N}])${ALEGA}`, `${ALEGA}\\s+${PARTES}`]);
/** Janela antes da passagem onde se procura a alegação da parte, na mesma frase. */
const JANELA_DA_ALEGACAO = 200;

/** Janela depois da passagem onde se procura o fecho de ementa transcrita. */
const JANELA_DO_FECHO = 300;
/** Relator abreviado ou por extenso, dentro do fecho. */
const RELATOR = /(?<![\p{L}\p{N}])Rel(?:\.|ator|atora)(?![\p{L}\p{N}])/iu;
/** Data do julgamento ou da publicação, dentro do fecho: "01/01/2000", "1.1.2000". */
const DATA = /(?<!\d)\d{1,2}[./]\d{1,2}[./]\d{2,4}(?!\d)/;

/**
 * O fecho de ementa de outro julgado logo depois da passagem: os primeiros parênteses depois dela, com relator e data
 * dentro, sem dois-pontos no caminho (que abririam outra transcrição, de que o fecho seria).
 */
function fechoDeEmenta(texto: string, b: number): string | undefined {
  const depois = texto.slice(b, b + JANELA_DO_FECHO);
  const parenteses = /\([^()]*\)/.exec(depois);
  if (!parenteses || depois.slice(0, parenteses.index).includes(":")) return undefined;
  const dentro = parenteses[0];
  return RELATOR.test(dentro) && DATA.test(dentro) ? dentro.replace(/\s+/g, " ") : undefined;
}

/** Janela antes da passagem (sem passar do título da seção) onde se procura a fórmula de divergência. */
const JANELA_DA_DIVERGENCIA = 3000;
/** Fórmulas com que um julgador abre a divergência; "divergência" sozinha não conta. */
const DIVERGENCIA = palavra([
  "divirjo",
  "dissinto",
  "ous[oa]\\s+divergir",
  "v[eê]nia\\s+para\\s+divergir",
  "(?:inauguro|abro|instauro)\\s+(?:a\\s+)?diverg[eê]ncia",
  "voto\\s+divergente",
]);
/** Proclamação de julgamento unânime; e o que mostra que não foi. */
const UNANIME = palavra(["(?:por|[àa])\\s+unanimidade"]);
const NAO_UNANIME = palavra([
  "por\\s+maioria",
  "vencid[oa]s?\\s+(?:o|a|os|as)\\s+(?:eminente|relator|relatora|desembargador|desembargadora|ministro|ministra|ju[ií]z|ju[ií]za)",
]);

/** Abreviaturas comuns no fecho ("Exmos. Srs. Des."), cujo ponto não fecha a frase. */
const FRASE_DO_FECHO =
  /(?<![\p{L}\p{N}])acordam?(?![\p{L}\p{N}])(?:[^.!?]|\.(?<=(?<![\p{L}\p{N}])(?:exm[oa]s?|srs?|sras?|des|desa|min|dra?|rel)\.)){0,400}/giu;

/**
 * A proclamação do julgamento deste acórdão: o texto das seções de certidão e a frase do fecho ("Acordam…"). A
 * votação de precedentes citados no corpo ("foi decidido por maioria") fica de fora.
 */
function proclamacao(texto: string, titulos: TituloDeSecao[]): string {
  const certidoes = titulos.flatMap((t, k) =>
    t.secao === "certidão" ? [texto.slice(t.inicio, titulos[k + 1]?.inicio ?? texto.length)] : [],
  );
  const fechos = [...texto.normalize("NFC").matchAll(FRASE_DO_FECHO)].map((m) => m[0]);
  return [...certidoes, ...fechos].join("\n");
}

/** Marcas de raciocínio hipotético: só localizam a passagem, nunca dizem o que ela é. */
const HIPOTESE = palavra([
  "(?:ainda|mesmo)\\s+que\\s+assim\\s+n[aã]o\\s+fosse",
  "se\\s+assim\\s+n[aã]o\\s+fosse",
  "(?:ainda|mesmo)\\s+que\\s+(?:assim\\s+)?se\\s+admitisse",
  "ad\\s+argumentandum(?:\\s+tantum)?",
  "apenas\\s+para\\s+argumentar",
  "por\\s+amor\\s+ao\\s+debate",
  "a\\s+t[ií]tulo\\s+de\\s+argumenta[cç][aã]o",
]);

/** O texto depois da última pontuação dada, ou o texto todo se não houver nenhuma. */
function depoisDaUltima(texto: string, pontuacao: RegExp): string {
  const ultimo = [...texto.matchAll(pontuacao)].pop();
  return ultimo ? texto.slice(ultimo.index + ultimo[0].length) : texto;
}

/** A última ocorrência da expressão no texto, como está nele. */
function ultima(texto: string, expressao: RegExp): string | undefined {
  return [...texto.normalize("NFC").matchAll(expressao)].pop()?.[0];
}

/**
 * Os sinais de "quem disse" ligados (SinaisDeQuemDisse) para a passagem [a, b), no inteiro teor ou no texto integral
 * do Falcão. `inicioDaSecao` limita a procura da divergência; `proclamado` é a proclamação do julgamento (certidão e
 * fecho), onde se lê se o acórdão se diz unânime.
 */
function sinaisDeQuemDisse(
  texto: string,
  a: number,
  b: number,
  inicioDaSecao: number,
  ligados: SinaisDeQuemDisse,
  proclamado: string,
): string[] {
  const sinais: string[] = [];
  const negacao =
    ligados.negacao && ultima(depoisDaUltima(texto.slice(Math.max(0, a - JANELA_DA_NEGACAO), a), /[.!?;:,]/g), NEGACAO);
  if (negacao) {
    sinais.push(`logo antes da passagem, na mesma oração, há a negação "${negacao}": o sentido pode estar invertido`);
  }
  const alegacao =
    ligados.alegacaoDaParte &&
    ultima(depoisDaUltima(texto.slice(Math.max(0, a - JANELA_DA_ALEGACAO), a), /[.!?;]/g), ALEGACAO);
  if (alegacao) {
    sinais.push(
      `antes da passagem, na mesma frase, há "${alegacao}": pode ser alegação da parte, não fundamento do tribunal`,
    );
  }
  const fecho = ligados.ementaTranscrita && fechoDeEmenta(texto, b);
  if (fecho) {
    sinais.push(`logo depois da passagem há o fecho "${fecho}", como o de ementa de outro julgado transcrita`);
  }
  const divergencia =
    ligados.divergencia && ultima(texto.slice(Math.max(inicioDaSecao, a - JANELA_DA_DIVERGENCIA), b), DIVERGENCIA);
  if (divergencia && !(proclamado.search(UNANIME) >= 0 && proclamado.search(NAO_UNANIME) < 0)) {
    sinais.push(
      `antes da passagem ou nela há a fórmula de divergência "${divergencia}", e o acórdão não se diz unânime: pode ser de ` +
        "um voto divergente sem título",
    );
  }
  const hipotese = ligados.raciocinioHipotetico && ultima(texto.slice(Math.max(0, a - JANELA_DO_MARCADOR), a), HIPOTESE);
  if (hipotese) sinais.push(`logo antes da passagem há marca de raciocínio hipotético ("${hipotese}")`);
  return sinais;
}

/**
 * Sinal de outro autor no inteiro teor: a passagem no relatório ou num voto vencido (aviso forte, pelo título de
 * seção), entre aspas, ou com um marcador de transcrição ("in verbis", "confira-se"…) logo antes dela, copiado como
 * está na fonte; e, se ligados, os sinais de "quem disse" (SinaisDeQuemDisse). É indício, não autoria; a falta dele
 * não prova nada.
 */
function sinalNoInteiroTeor(
  texto: string,
  a: number,
  b: number,
  secoes: Secoes,
  ligados: SinaisDeQuemDisse,
  proclamado: string,
): string | undefined {
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
  sinais.push(...sinaisDeQuemDisse(texto, a, b, secoes.identificada ? secoes.titulos[0].inicio : 0, ligados, proclamado));
  if (!sinais.length) return undefined;
  return `${fortes.length ? "ATENÇÃO, pode" : "pode"} ser de outro autor: ${sinais.join("; ")}`;
}

type Secao = "ementa" | "acórdão" | "relatório" | "voto" | "voto-vista" | "voto vencido" | "voto vogal" | "certidão";

/**
 * Títulos fixos com forma de seção e a seção do acórdão que cada um abre. A chave é o título sem espaços, hífens nem
 * acentos, para casar "VOTO-VISTA" com "VOTO VISTA", as letras espaçadas ("V O T O  V E N C I D O") e o PDF que
 * perdeu os acentos ("RELATORIO").
 */
const SECOES: Record<string, Secao> = {
  EMENTA: "ementa",
  ACORDAO: "acórdão",
  RELATORIO: "relatório",
  VOTO: "voto",
  VOTOVISTA: "voto-vista",
  VOTOVENCIDO: "voto vencido",
  VOTOVOGAL: "voto vogal",
  CERTIDAO: "certidão",
  CERTIDAODEJULGAMENTO: "certidão",
};

const semAcentos = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "");

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

/** "EMENTA:" (ou "EMENTA –") seguido do texto da ementa na mesma linha. */
const EMENTA_COM_TEXTO = /^EMENTA\s*[:\u2013\u2014-]\s*\S/;

/**
 * Palavras mínimas para a linha que fecha frase ser de corpo de texto, não de cabeçalho ("Relator: Des. Ficticio.").
 */
const PALAVRAS_DE_LINHA_DE_CORPO = 6;

/** Palavras a partir das quais a linha que fecha frase é de corpo mesmo com cara de cabeçalho. */
const PALAVRAS_DE_CORPO_SEGURO = 12;

/** Cara de cabeçalho: nº de processo no padrão CNJ ou rótulo de peça/parte ("Comarca", "Relator", "Apelante"…). */
const CARA_DE_CABECALHO =
  /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}|\b(?:Comarca|Relatora?|Apelante|Agravante|Recorrente)\b/iu;

/** Linha de corpo de texto: fecha frase, tem 6+ palavras e, parecendo cabeçalho, só conta com 12+ palavras. */
function ehLinhaDeCorpo(linha: string): boolean {
  if (!FECHA_FRASE.test(linha)) return false;
  const palavras = linha.split(/\s+/).length;
  if (palavras < PALAVRAS_DE_LINHA_DE_CORPO) return false;
  return palavras >= PALAVRAS_DE_CORPO_SEGURO || !CARA_DE_CABECALHO.test(linha);
}

/** Seções que um "EMENTA" ou "ACÓRDÃO" sozinho na linha não fecha: é a transcrição de outra decisão dentro delas. */
const TRANSCREVEM_DECISOES: Secao[] = ["relatório", "voto vencido"];

/**
 * Os títulos de seção do PDF, em ordem: só a linha que é inteira um dos títulos fixos — em maiúsculas ou só com a 1ª
 * letra maiúscula ("Voto vencido") —, sem nada depois além de ":" (ponto final não: "NULIDADE DO\nRELATÓRIO." é fim
 * de frase de ementa em maiúsculas, não título). Em maiúsculas, "VOTO VENCIDO" pode vir seguido do nome do julgador.
 * "Voto" ou "relatório" no corpo do texto não abrem seção. "EMENTA:" com o texto na mesma linha só abre a ementa
 * no começo do documento — 1º título, antes de qualquer linha de corpo que feche frase e sem a linha anterior
 * anunciar transcrição ("assim decidiu:", "in verbis"): fora disso, costuma ser a ementa de outro julgado transcrita.
 */
function titulosDeSecao(texto: string, paginaEm: (i: number) => number): TituloDeSecao[] {
  const titulos: TituloDeSecao[] = [];
  let corpoAntes = false;
  let linhaDeAntes = "";
  for (const m of texto.matchAll(/^[^\n]+$/gm)) {
    const titulo = m[0].trim();
    const linhaAnterior = linhaDeAntes;
    if (titulo) linhaDeAntes = titulo;
    if (
      !titulos.length &&
      !corpoAntes &&
      EMENTA_COM_TEXTO.test(titulo) &&
      !ANUNCIA_TRANSCRICAO.test(`${linhaAnterior}\n`)
    ) {
      titulos.push({ inicio: m.index, secao: "ementa", titulo, pagina: paginaEm(m.index) });
      continue;
    }
    if (ehLinhaDeCorpo(titulo)) corpoAntes = true;
    if (titulo.length > 80) continue;
    const linha = titulo.normalize("NFC").replace(/\s*:$/, "");
    const maiusculas = /^[\p{Lu}\s-]+$/u.test(linha);
    if (!maiusculas && !/^\p{Lu}[\p{Ll}\s-]+$/u.test(linha)) continue;
    const chave = semAcentos(linha.toUpperCase()).replace(/[\s-]/g, "");
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
  return juntarNomes([...(identificada ? [] : ["não identificada"]), ...titulos.map((t) => t.secao)], "um título de seção");
}

function juntarNomes(nomes: string[], atravessa: string): string {
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]} (a passagem atravessa ${atravessa})`;
}

/** Os títulos de seção e as marcas de subparte do acórdão, achados uma vez por fonte. */
interface MarcasDoJulgado {
  titulos: TituloDeSecao[];
  /** Títulos da ementa padronizada ("I. Caso em exame"…), onde quer que estejam; só valem dentro da ementa. */
  daEmenta: { inicio: number; nome: string }[];
  /**
   * Fórmulas de dispositivo ("Ante o exposto"…), onde quer que estejam, com a marca de inequívoca; só vale a última de
   * cada seção de voto, e só se inequívoca.
   */
  dispositivos: { inicio: number; inequivoca: boolean }[];
}

/** Os títulos da ementa padronizada, pela forma sem acentos e em minúsculas. */
const SUBPARTES_DA_EMENTA: Record<string, string> = {
  "caso em exame": "caso em exame",
  "questao em discussao": "questão em discussão",
  "razoes de decidir": "razões de decidir",
  "dispositivo e tese": "dispositivo e tese",
};

/** Linha que é inteira um título da ementa padronizada, com ou sem o numeral romano: "II. Questão em discussão". */
const TITULO_DA_EMENTA = /^(?:(?:I{1,3}|IV)\s*[.)\u2013\u2014-]\s*)?([\p{L}\p{M} ]+?)\s*:?$/iu;

/**
 * Fórmula de dispositivo, no começo da linha ou da frase ("Ante o exposto", "Pelo exposto", "Isto posto", "Com essas
 * considerações"…); no meio da frase ("o autor, ante o exposto na inicial") não conta. Se abre mesmo o dispositivo,
 * quem decide é `inequivoca`.
 */
const DISPOSITIVO = new RegExp(
  "(?<=^[ \\t]*|[.!?]\\s+)(?:" +
    [
      "(?:ante|diante\\s+de|em\\s+face\\s+de|por)\\s+(?:todo\\s+)?o\\s+exposto",
      "(?:diante\\s+d|em\\s+face\\s+d|d|pel)o\\s+exposto",
      "is[st]o\\s+posto",
      "posto\\s+isso",
      "com\\s+(?:essas|estas|tais)\\s+considera(?:ç|c\\p{M})(?:õ|o\\p{M})es",
    ].join("|") +
    ")(?![\\p{L}\\p{N}])",
  "gimu",
);

/** Linha que fecha frase: termina em ponto, exclamação ou interrogação, talvez seguidos de aspas ou parêntese. */
const FECHA_FRASE = /[.!?][”"')\]]*[ \t]*$/u;

/**
 * Nos 200 caracteres antes da fórmula, sinal de que ela pode ser de outra decisão transcrita: dois-pontos no fim da
 * linha ou antes de aspas ("A sentença assim decidiu:"), ou marcador de transcrição ("in verbis", "(...)").
 */
const ANUNCIA_TRANSCRICAO =
  /:[ \t]*(?:\n|[“«"'])|\b(?:in\s+verbis|verbis|(?:ipsis\s+|in\s+)?litteris|transcrevo|transcreve-se|confira-se)\b|\(\s*\.\.\.\s*\)|\[\s*\.\.\.\s*\]/iu;

/** Aspas abertas e não fechadas no trecho: a fórmula estaria dentro de uma transcrição. */
function aspasAbertas(trecho: string): boolean {
  const conta = (r: RegExp) => trecho.match(r)?.length ?? 0;
  return conta(/“/g) > conta(/”/g) || conta(/«/g) > conta(/»/g) || conta(/"/g) % 2 === 1;
}

/**
 * A fórmula abre o dispositivo sem dúvida: começa parágrafo (no começo da linha, depois de linha em branco, de título
 * de seção ou de linha que fecha frase) e nada nos 200 caracteres antes anuncia transcrição. Na dúvida, não: a
 * subparte é omitida, nunca adivinhada.
 */
function inequivoca(texto: string, i: number, fimDeTitulo: Set<number>): boolean {
  const inicioDaLinha = texto.lastIndexOf("\n", i - 1);
  if (texto.slice(inicioDaLinha + 1, i).trim()) return false;
  const antes = texto.slice(0, Math.max(0, inicioDaLinha));
  const linhaAnterior = antes.slice(antes.lastIndexOf("\n") + 1);
  const comecaParagrafo =
    inicioDaLinha < 0 || !linhaAnterior.trim() || fimDeTitulo.has(inicioDaLinha) || FECHA_FRASE.test(linhaAnterior);
  const janela = texto.slice(Math.max(0, i - 200), i);
  return comecaParagrafo && !ANUNCIA_TRANSCRICAO.test(janela) && !aspasAbertas(janela);
}

/** Seções de voto: a parte delas antes da fórmula do dispositivo é a fundamentação. */
const VOTOS: Secao[] = ["voto", "voto-vista", "voto vencido", "voto vogal"];

function marcasDoJulgado(texto: string, paginaEm: (i: number) => number): MarcasDoJulgado {
  const daEmenta: MarcasDoJulgado["daEmenta"] = [];
  for (const m of texto.matchAll(/^[^\n]{1,80}$/gm)) {
    const titulo = TITULO_DA_EMENTA.exec(m[0].trim());
    const nome = titulo ? SUBPARTES_DA_EMENTA[semAcentos(titulo[1]).toLowerCase()] : undefined;
    if (nome) daEmenta.push({ inicio: m.index, nome });
  }
  const titulos = titulosDeSecao(texto, paginaEm);
  // A linha de título de seção é limite: a letra minúscula do fim dela ("Voto vogal") não continua a frase.
  const fimDeTitulo = new Set(titulos.map((t) => texto.indexOf("\n", t.inicio)));
  return {
    titulos,
    daEmenta,
    dispositivos: [...texto.matchAll(DISPOSITIVO)].map((m) => ({
      inicio: m.index,
      inequivoca: inequivoca(texto, m.index, fimDeTitulo),
    })),
  };
}

/**
 * A subparte em que fica [a, b), só dentro de uma seção identificada e sem atravessar título de seção: na ementa, pelo
 * último título da ementa padronizada antes da passagem; no voto, pela última fórmula de dispositivo da seção, só se
 * inequívoca: "dispositivo" depois dela e "fundamentação" antes. Fora disso, nenhuma: a posição não se inventa.
 */
function subparteEm({ titulos, daEmenta, dispositivos }: MarcasDoJulgado, a: number, b: number): string | undefined {
  const secoes = secoesEm(titulos, a, b);
  if (!secoes.identificada || secoes.titulos.length !== 1) return undefined;
  const [titulo] = secoes.titulos;
  const naSecao = (i: number) => i > titulo.inicio;
  if (titulo.secao === "ementa") {
    const marcas = daEmenta.filter((m) => naSecao(m.inicio));
    const antes = marcas.filter((m) => m.inicio <= a).pop();
    const dentro = marcas.filter((m) => m.inicio > a && m.inicio < b);
    if (!antes && !dentro.length) return undefined;
    return juntarNomes([antes?.nome ?? "não identificada", ...dentro.map((m) => m.nome)], "um título");
  }
  if (!VOTOS.includes(titulo.secao)) return undefined;
  const fim = titulos.find((t) => t.inicio > titulo.inicio)?.inicio ?? Infinity;
  const ultima = dispositivos.filter((d) => naSecao(d.inicio) && d.inicio < fim).pop();
  if (!ultima?.inequivoca) return undefined;
  if (ultima.inicio <= a) return "dispositivo";
  if (ultima.inicio < b) return juntarNomes(["fundamentação", "dispositivo"], "a fórmula que abre o dispositivo");
  return "fundamentação";
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

/** O interruptor do aviso de órgão do fecho (G-13): desligado até a medição (G-75, ticket 10). */
export const AVISO_DE_ORGAO_DO_FECHO = false;

/** O órgão julgador como veio no registro da busca, e o tribunal dele (a sigla do Garimpo: "stj", "tjsp", "trt1"…). */
export interface OrgaoDoRegistro {
  tribunal: string;
  orgao: string;
}

/**
 * Sem acento e em minúsculas, letra a letra, com o mesmo comprimento do texto: o que se acha nele aponta para o texto
 * original.
 */
function dobrado(texto: string): string {
  return Array.from(texto, (c) => {
    const base = c.normalize("NFD")[0].toLowerCase();
    return c.length === 1 && base.length === 1 ? base : c;
  }).join("");
}

/** Expressão de fecho: cada espaço da fórmula aceita qualquer espaço ou quebra de linha. */
function formulaDeFecho(formula: string): RegExp {
  return new RegExp(formula.replace(/ /g, "\\s+"), "dg");
}

/** O órgão como aparece no fecho: um trecho curto, sem vírgula nem ponto. */
const ORGAO = "([^,;.:()]{3,80}?)";

/** Fecho dos acórdãos dos TRTs: "acordam os Magistrados (ou Desembargadores) da 1ª Turma do Tribunal…". */
const FECHO_DO_TRT = formulaDeFecho(
  `acordam,? (?:os )?(?:exm[oa]s?\\.? )?(?:srs?\\.? )?(?:magistrad[oa]s|desembargador(?:a|e)s|juiz(?:a|e)s)` +
    `(?: (?:integrantes|membros))? d[ao] ${ORGAO} do (?:egregio )?tribunal`,
);

/** Uma fórmula de fecho; sem grupo, o órgão é fixo (no TSE, "acordam os ministros do Tribunal…" é o Plenário). */
interface Fecho {
  formula: RegExp;
  orgao?: string;
}

/** Fórmulas genéricas dos demais tribunais, sem nome real; não medidas em PDF real (aviso falso possível). */
const FECHOS: Record<string, Fecho[]> = {
  stj: [
    { formula: formulaDeFecho(`acordam,? (?:os )?(?:srs?\\.? )?ministros da ${ORGAO} do superior tribunal`) },
    { formula: formulaDeFecho(`certifico que a (?:egregia )?${ORGAO},? ao apreciar`) },
  ],
  tjmg: [{ formula: formulaDeFecho(`acorda,? em turma,? a ${ORGAO} do tribunal`) }],
  tjsp: [
    {
      formula: formulaDeFecho(
        `acordam,? em (?:sessao (?:permanente e )?(?:virtual |extraordinaria |ordinaria )?d[ao] )?${ORGAO} do tribunal`,
      ),
    },
  ],
  tse: [
    { formula: formulaDeFecho("acordam,? (?:os )?(?:ministros|membros) do tribunal superior eleitoral"), orgao: "Plenário" },
  ],
};

/** As fórmulas fixas do fecho, por tribunal; tribunal sem fórmula = silêncio. */
function formulasDoFecho(tribunal: string): Fecho[] {
  const sigla = tribunal.toLowerCase();
  if (/^trt\d+$/.test(sigla)) return [{ formula: FECHO_DO_TRT }];
  return FECHOS[sigla] ?? [];
}

/** Ordinais por extenso, pelo radical: "primeira" = 1, "decima segunda" = 12. */
const ORDINAIS: [string, number][] = [
  ["primeir", 1], ["segund", 2], ["terceir", 3], ["quart", 4], ["quint", 5], ["sext", 6], ["setim", 7],
  ["oitav", 8], ["non", 9], ["decim", 10], ["vigesim", 20], ["trigesim", 30],
];

/** O órgão como número + tipo + complemento ("1ª Câmara Cível" = 1 · camara · civel); sem tipo conhecido = não lido. */
interface OrgaoLido {
  numero?: number;
  tipo: string;
  complemento: string;
}

const TIPOS_DE_ORGAO = /^(camara|turma|secao|grupo de camaras|orgao especial|corte especial|tribunal pleno|pleno|plenario)\b/;

function lerOrgao(nome: string): OrgaoLido | undefined {
  // Sem acento, em minúsculas e com um espaço só: vale para o PDF que perdeu os acentos.
  let resto = semAcentos(nome).toLowerCase().replace(/\s+/g, " ").trim();
  let numero: number | undefined;
  const digitos = /^(\d{1,2})\s*(?:\.?\s*[ªºao°])?\.?\s+/.exec(resto);
  if (digitos) {
    numero = Number(digitos[1]);
    resto = resto.slice(digitos[0].length);
  } else {
    let soma = 0;
    for (;;) {
      const ordinal = ORDINAIS.find(([radical]) => new RegExp(`^${radical}[oa]s?\\s+`).test(resto));
      if (!ordinal) break;
      soma += ordinal[1];
      resto = resto.replace(/^\S+\s+/, "");
    }
    if (soma) numero = soma;
  }
  const tipo = TIPOS_DE_ORGAO.exec(resto);
  if (!tipo) return undefined;
  const complemento = resto.slice(tipo[0].length).trim();
  // "Tribunal Pleno", "Pleno" e "Plenário" são o mesmo órgão.
  return { ...(numero ? { numero } : {}), tipo: /pleno|plenario/.test(tipo[1]) ? "pleno" : tipo[1], complemento };
}

/** Seções onde um fecho costuma ser de outro julgado transcrito: o relatório e os votos. */
const TRANSCREVEM_FECHOS: Secao[] = ["relatório", ...VOTOS];

/**
 * O fecho em `i` é do próprio acórdão: fora do relatório e dos votos, fora de ementa ou acórdão aberto depois deles
 * ("ACÓRDÃO" sozinho na linha dentro do voto é de precedente transcrito) e fora de aspas abertas na seção (de outro
 * julgado transcrito, o órgão seria de outro processo).
 *
 * Limitação conhecida: o fecho do próprio acórdão numa seção ACÓRDÃO depois do voto é tratado como transcrito e fica
 * em silêncio (sem aviso, nunca aviso errado); a medir no G-75.
 */
function fechoDoProprioAcordao(texto: string, titulos: TituloDeSecao[], i: number): boolean {
  const antes = titulos.filter((t) => t.inicio <= i);
  const secao = antes.pop();
  if (secao && TRANSCREVEM_FECHOS.includes(secao.secao)) return false;
  if (
    (secao?.secao === "ementa" || secao?.secao === "acórdão") &&
    antes.some((t) => TRANSCREVEM_FECHOS.includes(t.secao))
  ) {
    return false;
  }
  return !aspasAbertas(texto.slice(secao?.inicio ?? 0, i));
}

/**
 * Aviso de órgão julgador (G-13): lê no fecho do acórdão, por fórmulas fixas do tribunal, o órgão que julgou e avisa
 * quando ele difere do órgão do registro da busca. É aviso, nunca correção: o Garimpo não diz qual dos dois está certo.
 * Sem fecho reconhecível, fecho ambíguo ou órgão do registro ilegível: nada (silêncio, não aviso). Desligado: nada.
 */
export function avisoDeOrgaoDoFecho(
  leitura: InteiroTeorParaConferir,
  registro: OrgaoDoRegistro,
  ligado = AVISO_DE_ORGAO_DO_FECHO,
): string | undefined {
  if (!ligado) return undefined;
  const doRegistro = lerOrgao(registro.orgao);
  if (!doRegistro) return undefined;
  const textos = leitura.unidades.map((t) => t.texto.normalize("NFC"));
  const texto = textos.join("\n");
  // Onde começa cada unidade (página ou parte) depois da primeira, no texto juntado.
  let soma = 0;
  const fronteiras = textos.slice(0, -1).map((t) => (soma += t.length + 1));
  const titulos = titulosDeSecao(texto, () => 0);
  const comparavel = dobrado(texto);
  const lidos = formulasDoFecho(registro.tribunal).flatMap(({ formula, orgao }) =>
    [...comparavel.matchAll(formula)].flatMap((m) => {
      if (!fechoDoProprioAcordao(texto, titulos, m.index)) return [];
      const [inicio, fim] = m.indices![1] ?? m.indices![0];
      // Nome que cruza a fronteira de unidade pode ter engolido cabeçalho ou rodapé da página: silêncio.
      if (fronteiras.some((f) => inicio < f && f < fim)) return [];
      const nome =
        orgao ??
        texto
          .slice(inicio, fim)
          // Hífen de fim de linha: "Pri-\nvado" e, em maiúsculas, "CI-\nVEL".
          .replace(/(\p{L})-[ \t]*\n\s*(?=\p{Ll})|(\p{Lu})-[ \t]*\n\s*(?=\p{Lu})/gu, "$1$2")
          .replace(/\s+/g, " ");
      const lido = lerOrgao(nome);
      return lido ? [{ nome, lido }] : [];
    }),
  );
  if (!lidos.length) return undefined;
  const chave = (o: OrgaoLido) => `${o.numero ?? ""}|${o.tipo}|${o.complemento}`;
  // Fechos que discordam entre si (outro julgado transcrito, certidão de outra sessão): ambíguo, silêncio.
  if (new Set(lidos.map((a) => chave(a.lido))).size > 1) return undefined;
  if (chave(lidos[0].lido) === chave(doRegistro)) return undefined;
  return (
    `órgão no texto ≠ órgão do registro: o fecho do acórdão diz "${lidos[0].nome}", e o registro da busca diz ` +
    `"${registro.orgao}". Confira na certidão de julgamento qual órgão julgou; o Garimpo não corrige o registro.`
  );
}
