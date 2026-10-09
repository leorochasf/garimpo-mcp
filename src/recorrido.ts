/**
 * Aviso de acórdão recorrido ausente: a busca trouxe um recurso contra outro acórdão (embargos de declaração, agravo
 * interno e similares) sem o acórdão que ele ataca. Só texto, sem chamada nova ao site: o recorrido "não veio nesta
 * busca" e "pode" não estar na base; nunca que ele não existe ou não está na base.
 */

import type { Acordao } from "./busca.js";
import { comparavel } from "./enquadramento.js";

/** Classes de recurso contra acórdão, pelo começo do nome (sem acento, minúsculas). */
const CLASSES = [
  "embargos de declaracao",
  "agravo interno",
  "agravo regimental",
  "embargos infringentes",
  "embargos de divergencia",
];
/** As mesmas classes pela sigla, no começo do número, quando o site não traz a classe (caso do STJ). */
const SIGLAS_DE_RECURSO = ["ed", "edcl", "agint", "agrg", "ei", "eresp", "earesp", "ere", "eag"];
/** Embargos de declaração: a primeira classe e as duas primeiras siglas. */
const EMBARGOS_DE_DECLARACAO = { classe: CLASSES[0], siglas: SIGLAS_DE_RECURSO.slice(0, 2) };

/** Embargos de declaração, pela classe ou, sem ela, pela sigla no começo do número (a primeira linha das tabelas). */
export function ehEmbargosDeDeclaracao(a: Pick<Acordao, "classe" | "numero">): boolean {
  if (a.classe) return comparavel(a.classe).startsWith(EMBARGOS_DE_DECLARACAO.classe);
  return EMBARGOS_DE_DECLARACAO.siglas.includes(siglaDoNumero(a.numero));
}

export function ehRecursoContraAcordao(a: Pick<Acordao, "classe" | "numero">): boolean {
  if (a.classe) {
    const classe = comparavel(a.classe);
    return CLASSES.some((c) => classe.startsWith(c));
  }
  return SIGLAS_DE_RECURSO.includes(siglaDoNumero(a.numero));
}

/** "AgRg no REsp 1.234.567/SP" → "agrg". */
const siglaDoNumero = (numero: string) => comparavel(numero.split(/\s+/)[0] ?? "");

const digitos = (cnj: string) => cnj.replace(/\D/g, "");

/** Teto de números no aviso da busca direta. */
const TETO_DE_NUMEROS = 10;
/**
 * Teto da busca ampla: com 50 acórdãos e 10 qualificados de tamanho real, a resposta já beira os 25 mil caracteres
 * sem o aviso (24,8 mil medidos); nem 5 números cabem (ver o teste de tamanho em tests/recorrido.test.ts).
 */
export const TETO_DE_NUMEROS_AMPLA = 3;

/** Recursos contra acórdão mostrados, com número CNJ, sem registro achado do mesmo número que não seja recurso. */
function ausentes(mostrados: readonly Acordao[], achados: readonly Acordao[]): Acordao[] {
  const comRecorrido = new Set(achados.filter((a) => a.numeroCnj && !ehRecursoContraAcordao(a)).map((a) => digitos(a.numeroCnj!)));
  const porNumero = new Map<string, Acordao>();
  for (const a of mostrados) {
    if (!a.numeroCnj || !ehRecursoContraAcordao(a) || comRecorrido.has(digitos(a.numeroCnj))) continue;
    const chave = `${a.tribunal}:${digitos(a.numeroCnj)}`;
    if (!porNumero.has(chave)) porNumero.set(chave, a);
  }
  return [...porNumero.values()];
}

/** "a, b e mais N", com no máximo `teto` números, na ordem da lista. */
function numeros(lista: readonly Acordao[], teto: number, rotulo: (a: Acordao) => string): string {
  const mais = lista.length > teto ? ` e mais ${lista.length - teto}` : "";
  return lista.slice(0, teto).map(rotulo).join(", ") + mais;
}

/** O aviso da busca direta (um tribunal), ou nada. Dois recursos do mesmo número, sem o mérito, contam como ausente. */
export function avisoDeRecorridoAusente(acordaos: readonly Acordao[]): string | undefined {
  const lista = ausentes(acordaos, acordaos);
  if (!lista.length) return undefined;
  return (
    "Recurso contra outro acórdão sem o acórdão recorrido nesta busca (embargos de declaração, agravo interno e " +
    `similares), processo(s): ${numeros(lista, TETO_DE_NUMEROS, (a) => a.numeroCnj!)}. O acórdão recorrido pode não ` +
    "estar na base do JurisprudênciaIA (às vezes está e só não veio nesta busca): veja os julgamentos registrados " +
    `do processo com julgamentos_do_processo, pelo número, e confira no portal do ${lista[0].tribunal.toUpperCase()}.`
  );
}

/**
 * O aviso da busca ampla, uma vez, curto: só os mostrados entram, mas o recorrido achado e cortado da lista (ou
 * filtrado) não está ausente. Com vários tribunais, cada número vai com a sigla.
 */
export function avisoDeRecorridoAusenteAmplo(mostrados: readonly Acordao[], achados: readonly Acordao[]): string | undefined {
  const lista = ausentes(mostrados, achados);
  if (!lista.length) return undefined;
  const tribunais = new Set(lista.map((a) => a.tribunal));
  const varios = tribunais.size > 1;
  const rotulo = (a: Acordao) => (varios ? `${a.numeroCnj} (${a.tribunal.toUpperCase()})` : a.numeroCnj!);
  return (
    `Recurso contra acórdão sem o recorrido nesta busca (embargos de declaração e similares): ` +
    `${numeros(lista, TETO_DE_NUMEROS_AMPLA, rotulo)}. O recorrido pode não estar na base do JurisprudênciaIA: ` +
    "veja os julgamentos com julgamentos_do_processo."
  );
}

/** O aviso do obter_ementa: um acórdão só, sem comparação de mesmo número. */
export function avisoRecorridoDoAcordao(a: Acordao): string | undefined {
  if (!a.numeroCnj || !ehRecursoContraAcordao(a)) return undefined;
  return (
    `Este acórdão julga recurso contra outro acórdão do processo ${a.numeroCnj}. O acórdão recorrido não vem nesta ` +
    "resposta; se a busca que trouxe este também não o trouxe, ele pode não estar na base do JurisprudênciaIA: veja " +
    `os julgamentos registrados com julgamentos_do_processo, pelo número ${a.numeroCnj}, e confira no portal do ` +
    `${a.tribunal.toUpperCase()}.`
  );
}
