/**
 * Ementa limpa: do campo de ementa da base do site, só a ementa, uma vez. Em alguns tribunais o campo traz a ementa
 * repetida (TJRJ), a decisão inteira (TJBA) ou um cabeçalho com nomes de partes (TJPE, TJMT, TJPB). O texto que fica é
 * sempre um trecho contínuo do campo, nunca reescrito; quando o Garimpo mostra menos que o campo inteiro, vem um aviso.
 */

export interface EmentaLimpa {
  /** Trecho literal e contínuo do campo da base. */
  ementa: string;
  /** Presente quando a ementa mostrada não é o campo inteiro. */
  aviso?: string;
  /**
   * Não deu para separar a ementa com segurança: `ementa` é só o começo e pode ter texto do relatório ou do voto.
   * Quem confere citação não pode dizer «na ementa» por esse texto.
   */
  separacaoIncerta?: true;
}

/** Tribunais em que a base põe o cabeçalho do processo (com nomes de partes) antes da ementa. */
const COM_CABECALHO = new Set(["tjba", "tjpe", "tjmt", "tjpb"]);

/** Onde a ementa começa: «EMENTA», «Ementa:» (ou «Ementa :») e, no TJBA, «E M E N T A». */
const MARCADOR_DA_EMENTA = /\bEMENTA\b|\bEmenta\s*:|E M E N T A/g;
/** Cabeçalho mais longo que isso não é cabeçalho: o marcador achado deve estar no meio do texto. */
const LIMITE_DO_CABECALHO = 1_500;
/** TJBA: o que vem depois da ementa, na Turma Recursal («RELATÓRIO») e na Câmara («ACÓRDÃO Vistos…»). */
const FIM_DA_EMENTA_TJBA = /\sRELATÓRIO\s|\sACÓRDÃO\s+Vistos\b/;
/** TJBA: sinais de decisão inteira no campo, quando o marcador da ementa não aparece. */
const SINAL_DE_DECISAO_TJBA = /\bRELATÓRIO\s|\bVOTO\s|\bACÓRDÃO\s+Vistos\b|\bACORDAM\b/;
/** O começo mostrado quando a ementa não se separa com segurança. */
const TAMANHO_DO_COMECO = 600;

export function limparEmenta(tribunal: string, campo: string): EmentaLimpa {
  const repetida = semRepeticao(campo);
  if (repetida) return { ementa: repetida.ementa, aviso: avisoDeRepeticao(repetida.vezes) };
  if (!COM_CABECALHO.has(tribunal)) return { ementa: campo };

  const texto = campo.trim();
  const inicio = inicioDaEmentaDepoisDoCabecalho(texto);
  if (tribunal !== "tjba") {
    return inicio === undefined ? { ementa: campo } : { ementa: texto.slice(inicio), aviso: AVISO_DE_CABECALHO };
  }

  // TJBA: o campo traz a decisão inteira (cabeçalho, ementa, relatório, voto); fica só a ementa.
  if (inicio !== undefined) {
    const depois = texto.slice(inicio);
    const fim = FIM_DA_EMENTA_TJBA.exec(depois);
    if (fim) return { ementa: depois.slice(0, fim.index).trimEnd(), aviso: AVISO_DE_DECISAO_INTEIRA };
    return soOComeco(depois);
  }
  return SINAL_DE_DECISAO_TJBA.test(texto) ? soOComeco(texto) : { ementa: campo };
}

/**
 * O campo inteiro é o mesmo bloco N vezes (N ≥ 2), comparado palavra a palavra (a separação entre as cópias pode
 * variar), seguido ou não de um rodapé do site entre parênteses. Devolve a última cópia até o fim do campo (com o
 * rodapé), que é um trecho contínuo da fonte. Qualquer outra sobra ou diferença = não é repetição.
 */
function semRepeticao(campo: string): { ementa: string; vezes: number } | undefined {
  const palavras = [...campo.matchAll(/\S+/g)];
  const total = palavras.length;
  for (let tamanho = 1; tamanho <= total / 2; tamanho++) {
    let i = tamanho;
    while (i < total && palavras[i][0] === palavras[i - tamanho][0]) i++;
    const vezes = Math.floor(i / tamanho);
    if (vezes < 2) continue;
    const resto = palavras.slice(vezes * tamanho).map((p) => p[0]).join(" ");
    if (resto && !(resto.startsWith("(") && resto.endsWith(")"))) continue;
    return { ementa: campo.slice(palavras[(vezes - 1) * tamanho].index).trimEnd(), vezes };
  }
  return undefined;
}

/** O primeiro marcador de ementa depois do começo do texto (o do começo, se houver, é o do cabeçalho). */
function inicioDaEmentaDepoisDoCabecalho(texto: string): number | undefined {
  for (const m of texto.matchAll(MARCADOR_DA_EMENTA)) {
    if (m.index === 0) continue;
    return m.index <= LIMITE_DO_CABECALHO ? m.index : undefined;
  }
  return undefined;
}

/** Só o começo, cortado num espaço, com o aviso de que a separação não foi segura. */
function soOComeco(texto: string): EmentaLimpa {
  const comeco = texto.length <= TAMANHO_DO_COMECO ? texto : texto.slice(0, TAMANHO_DO_COMECO).replace(/\s+\S*$/, "");
  return { ementa: comeco, aviso: AVISO_DE_COMECO, separacaoIncerta: true };
}

function avisoDeRepeticao(vezes: number): string {
  return (
    `O JurisprudênciaIA trouxe a mesma ementa ${vezes} vezes seguidas neste registro; o Garimpo mostra uma vez só, ` +
    "com o texto como veio."
  );
}

const AVISO_DE_CABECALHO =
  "O campo de ementa do JurisprudênciaIA traz antes da ementa o cabeçalho do processo, com nomes das partes; o Garimpo " +
  "mostra a partir da ementa, com o texto como veio.";

const AVISO_DE_DECISAO_INTEIRA =
  "O campo de ementa do JurisprudênciaIA traz a decisão inteira (cabeçalho do processo com nomes das partes, ementa, " +
  "relatório e voto); o Garimpo mostra só a ementa, com o texto como veio. Relatório e voto ficam no inteiro teor.";

const AVISO_DE_COMECO =
  "O campo de ementa do JurisprudênciaIA traz mais que a ementa, e o Garimpo não conseguiu separá-la com segurança: vai " +
  "só o começo, que pode ter parte do relatório ou do voto. Confira no inteiro teor.";
