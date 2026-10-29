/**
 * A região do cabeçalho do documento do tribunal (ticket 16 da frente dos TJs): a identidade do processo só se lê ali,
 * e uma vez só. O acórdão cita números de outros processos no corpo, às vezes com o mesmo rótulo do cabeçalho; tomar um
 * deles como a identidade do documento foi o defeito achado três vezes em 2026-10-29 (molde, TJCE e TJBA). Cada
 * tribunal declara onde o cabeçalho termina e como o número aparece nele; a regra fica aqui, a mesma para a página com
 * íntegra (src/paginaComIntegra.ts) e para o PDF (src/cabecalhoTjce.ts).
 */

/** O que o tribunal declara sobre o cabeçalho do documento dele. */
export interface RegiaoDoCabecalho {
  /** Os títulos de seção que encerram o cabeçalho (EMENTA, ACÓRDÃO, RELATÓRIO, VOTO…): o primeiro achado corta. */
  titulos: RegExp;
  /** Teto de caracteres da região, contado do início do texto: mais longe que isso, é citação. */
  maximo: number;
  /** O número com o rótulo do cabeçalho; o grupo 1 é o número. */
  numero: RegExp;
  /** Opcional: o rótulo tem de começar até aqui (o cabeçalho real abre o documento). */
  inicioMaximo?: number;
}

const algarismos = (numero: string) => numero.replace(/\D/g, "");
const inteiroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Por que a declaração não serve (o registro recusa), ou undefined. */
export function regiaoInvalida(regiao: unknown): string | undefined {
  const r = regiao as Partial<RegiaoDoCabecalho> | undefined;
  if (typeof r !== "object" || r === null) return "a declaração não diz onde fica o cabeçalho do documento (região do cabeçalho)";
  if (!(r.titulos instanceof RegExp)) return "a região do cabeçalho não declara os títulos que a encerram";
  if (!inteiroPositivo(r.maximo)) return "a região do cabeçalho precisa de um teto de caracteres (inteiro positivo)";
  // Grupos de captura da expressão: a alternativa vazia casa com "" e devolve um item por grupo.
  if (!(r.numero instanceof RegExp) || new RegExp(`${r.numero.source}|`).exec("")!.length < 2) {
    return "a região do cabeçalho precisa da expressão do número, com o número no grupo 1";
  }
  if (r.inicioMaximo !== undefined && (!inteiroPositivo(r.inicioMaximo) || r.inicioMaximo > r.maximo)) {
    return "o início máximo do número no cabeçalho precisa ser um inteiro positivo dentro do teto da região";
  }
  return undefined;
}

/**
 * O número do processo do cabeçalho, como está escrito, só se for um: a região vai do início do texto até o primeiro
 * título declarado ou o teto. Contam só os números CNJ completos (20 algarismos); o mesmo número com e sem máscara é um
 * só. Cabeçalho sem número, ou com dois diferentes, = undefined.
 */
export function processoNoCabecalho(texto: string, regiao: RegiaoDoCabecalho): string | undefined {
  // search ignora o estado de uma expressão /g declarada; o matchAll trabalha numa cópia com /g.
  const titulo = texto.search(regiao.titulos);
  const fim = Math.min(titulo < 0 ? texto.length : titulo, regiao.maximo);
  const numero = new RegExp(regiao.numero.source, regiao.numero.flags.includes("g") ? regiao.numero.flags : `${regiao.numero.flags}g`);
  const achados = [...texto.slice(0, fim).matchAll(numero)]
    .filter((m) => regiao.inicioMaximo === undefined || m.index <= regiao.inicioMaximo)
    .map((m) => m[1])
    .filter((n) => n !== undefined && algarismos(n).length === 20);
  return new Set(achados.map(algarismos)).size === 1 ? achados[0] : undefined;
}
