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
/**
 * TJBA, Câmara Cível: o cabeçalho acaba em «ACORDÃO» (ou «ACÓRDÃO»), e a ementa começa logo depois da palavra, com ou
 * sem «Ementa:». «ACÓRDÃO Vistos…» é o fecho, não o fim do cabeçalho.
 */
const MARCADOR_DA_EMENTA_TJBA = new RegExp(`${MARCADOR_DA_EMENTA.source}|\\bAC[OÓ]RD[AÃ]O\\s+(?!Vistos\\b)`, "g");
/** Cabeçalho mais longo que isso não é cabeçalho: o marcador achado deve estar no meio do texto. */
const LIMITE_DO_CABECALHO = 1_500;
/**
 * Prova de cabeçalho antes do marcador: o rótulo de uma parte com dois-pontos («APELANTE:», «Recorrente(s):»,
 * «APELADO(A):», «Apelante :»). Sem ele, um «EMENTA» no meio é texto da própria ementa.
 */
const ROTULO_DE_PARTE =
  /\b(?:apelante|apelad[oa]|recorrente|recorrid[oa]|agravante|agravad[oa]|embargante|embargad[oa]|impetrante|impetrad[oa]|requerente|requerid[oa])(?:\s*\([^)]{1,3}\))?\s*:/i;
/**
 * A ficha do processo no cabeçalho da Câmara Cível do TJBA, antes do «ACORDÃO»: começa por «PODER JUDICIÁRIO» (depois
 * de «EMENTA:», se houver) e traz «Processo:». Mais os rótulos de duas partes (fichaDaCamaraTjba).
 */
const COMECO_DA_FICHA_TJBA = /^(?:EMENTA\s*:\s*)?PODER\s+JUDICI[AÁ]RIO\b/;
const PROCESSO_NA_FICHA = /\bProcesso\s*:/;
/** TJBA: o que vem depois da ementa, na Turma Recursal («RELATÓRIO») e na Câmara («ACÓRDÃO Vistos…»). */
const FIM_DA_EMENTA_TJBA = /\sRELATÓRIO\s|\sACÓRDÃO\s+Vistos\b/;
/**
 * Câmara Cível do TJBA sem «ACÓRDÃO Vistos»: o fecho «Vistos, relatados e discutidos estes autos…» (no campo da base,
 * «estes autos» vem logo depois, a um espaço). Vale só a última ocorrência, e só com «Acordam» e o rodapé «( Classe:»
 * depois dela; a mesma expressão dentro da ementa, seguida de outra coisa, não é fecho.
 */
const FECHO_TJBA = /\sVistos,?\s+relatados\s+e\s+discutidos(?=\s{1,3}(?:estes|os\s+presentes)\s+autos\b)/g;
const DEPOIS_DO_FECHO_TJBA = [/\bAcordam\b/i, /\(\s*Classe\s*:/];
/**
 * Títulos de relatório e voto (e o fecho do acórdão): em maiúsculas, seguidos de pontuação ou do começo de uma frase
 * («RELATÓRIO Trata-se», «VOTO:», «RELATORIO -»); em qualquer caixa, só com dois-pontos («Voto:»). «VOTO VENCIDO» e
 * «RELATÓRIO DE IMPACTO» são palavras da ementa, não títulos.
 */
const TITULO_DE_DECISAO =
  /\b(?:RELAT[ÓO]RIO|VOTO)(?:\s*[:.–—-]|\s+[A-ZÀ-Ý][a-zà-ÿ])|\bACORDAM\b|\bACÓRDÃO\s+Vistos\b/;
const TITULO_COM_DOIS_PONTOS = /\b(?:relat[óo]rio|voto)\s*:/i;
/** O começo mostrado quando a ementa não se separa com segurança. */
const TAMANHO_DO_COMECO = 600;

/**
 * As regras se compõem: a repetição escolhe uma cópia, e a separação do tribunal continua sobre ela. O que fica é
 * sempre um trecho contínuo do campo, e os avisos se somam.
 */
export function limparEmenta(tribunal: string, campo: string): EmentaLimpa {
  const repetida = semRepeticao(campo);
  const texto = repetida?.ementa ?? campo;
  const separada = COM_CABECALHO.has(tribunal) ? separar(tribunal, texto.trim()) : undefined;
  if (!repetida && !separada) return { ementa: campo };
  const avisos = [repetida && avisoDeRepeticao(repetida.vezes), separada?.aviso].filter(Boolean);
  return {
    ementa: separada?.ementa ?? texto,
    aviso: avisos.join(" "),
    ...(separada?.separacaoIncerta && { separacaoIncerta: true as const }),
  };
}

/**
 * Cabeçalho (TJPE, TJMT, TJPB) e decisão inteira (TJBA). Sobrou título de relatório ou voto no que seria a ementa:
 * a separação não é segura e vai só o começo. Nada a separar: undefined.
 */
function separar(tribunal: string, texto: string): EmentaLimpa | undefined {
  const marcador = tribunal === "tjba" ? MARCADOR_DA_EMENTA_TJBA : MARCADOR_DA_EMENTA;
  const inicio = inicioDaEmentaDepoisDoCabecalho(texto, marcador);
  if (inicio === undefined) return temTituloDeDecisao(texto) ? soOComeco(texto) : undefined;
  const depois = texto.slice(inicio);
  // TJBA: o campo traz a decisão inteira; a ementa vai até o relatório (Turma Recursal) ou o fecho (Câmara).
  const fim = tribunal === "tjba" ? (FIM_DA_EMENTA_TJBA.exec(depois) ?? fechoConfirmado(depois)) : undefined;
  if (tribunal === "tjba" && !fim) return soOComeco(depois);
  const ementa = fim ? depois.slice(0, fim.index).trimEnd() : depois;
  if (temTituloDeDecisao(ementa)) return soOComeco(ementa);
  if (!fim) return { ementa, aviso: AVISO_DE_CABECALHO };
  return { ementa, aviso: fim[0].includes("RELATÓRIO") ? AVISO_DE_DECISAO_INTEIRA : AVISO_DE_CABECALHO_E_FECHO };
}

/** A última ocorrência do fecho «Vistos, relatados e discutidos», só se o «Acordam» e o rodapé vierem depois dela. */
function fechoConfirmado(depois: string): RegExpExecArray | undefined {
  const ultimo = [...depois.matchAll(FECHO_TJBA)].at(-1);
  if (!ultimo) return undefined;
  const resto = depois.slice(ultimo.index + ultimo[0].length);
  return DEPOIS_DO_FECHO_TJBA.every((r) => r.test(resto)) ? (ultimo as RegExpExecArray) : undefined;
}

/**
 * A ficha do processo antes do «ACORDÃO» da Câmara Cível do TJBA, como no campo da base: «PODER JUDICIÁRIO» no
 * começo, «Processo:» e os rótulos de duas partes («APELANTE:», «APELADO:»). Um rótulo solto no corpo não é ficha.
 */
function fichaDaCamaraTjba(prefixo: string): boolean {
  const rotulos = prefixo.match(new RegExp(ROTULO_DE_PARTE.source, "gi"))?.length ?? 0;
  return COMECO_DA_FICHA_TJBA.test(prefixo) && PROCESSO_NA_FICHA.test(prefixo) && rotulos >= 2;
}

function temTituloDeDecisao(texto: string): boolean {
  return TITULO_DE_DECISAO.test(texto) || TITULO_COM_DOIS_PONTOS.test(texto);
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

/**
 * O primeiro marcador de ementa depois do começo do texto (o do começo, se houver, é o do cabeçalho) com o rótulo de
 * uma parte antes dele, dentro do limite do cabeçalho.
 */
function inicioDaEmentaDepoisDoCabecalho(texto: string, marcador: RegExp): number | undefined {
  for (const m of texto.matchAll(marcador)) {
    if (m.index > LIMITE_DO_CABECALHO) return undefined;
    if (m.index === 0 || !ROTULO_DE_PARTE.test(texto.slice(0, m.index))) continue;
    if (!/^AC[OÓ]RD[AÃ]O/.test(m[0])) return m.index;
    // «ACORDÃO» só fecha a ficha do processo, e não é da ementa: ela começa depois da palavra.
    if (fichaDaCamaraTjba(texto.slice(0, m.index))) return m.index + m[0].length;
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

const AVISO_DE_CABECALHO_E_FECHO =
  "O campo de ementa do JurisprudênciaIA traz, além da ementa, o cabeçalho do processo e o fecho do acórdão, com " +
  "nomes das partes; o Garimpo mostra só a ementa, com o texto como veio. O resto fica no inteiro teor.";

const AVISO_DE_COMECO =
  "O campo de ementa do JurisprudênciaIA traz mais que a ementa, e o Garimpo não conseguiu separá-la com segurança: vai " +
  "só o começo, que pode ter parte do relatório ou do voto. Confira no inteiro teor.";
