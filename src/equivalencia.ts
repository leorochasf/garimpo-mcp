/**
 * Equivalência de registros: reconhece quando dois registros da base do site são o mesmo acórdão
 * (mesmo tribunal + mesma data de julgamento + mesma ementa, sem números de processo que se contradigam)
 * e os junta num acórdão só. No TJPR (ADR-0030) e no TJBA, o mesmo documento do portal no link também basta.
 */

import { documentoDoTjpr } from "./tribunais.js";

/** O mínimo de um registro que a regra precisa olhar. */
export interface Registro {
  /** Id composto "tribunal:id". */
  id: string;
  tribunal: string;
  numero: string;
  /**
   * Sinal explícito: o site não trouxe número de processo de verdade (o `numero` é só o id do site).
   * Obrigatório de propósito: quem monta o registro tem de dizer, e a regra nunca adivinha pelo texto.
   */
  semNumero: boolean;
  dataJulgamento?: string;
  ementa: string;
  orgao?: string;
  /** Link do PDF do inteiro teor. */
  link?: string;
  /** Página oficial de consulta, quando não há PDF. */
  linkConsulta?: string;
}

/** Um registro como foi achado na busca: por quais formulações e em que melhor posição. */
export interface Ocorrencia<R extends Registro> {
  registro: R;
  formulacoes: Set<number>;
  melhorPosicao: number;
}

/** Um acórdão depois da junção: o registro mais completo, as formulações somadas e os ids de todas as cópias. */
export interface AcordaoJuntado<R extends Registro> {
  registro: R;
  ids: string[];
  formulacoes: Set<number>;
  melhorPosicao: number;
}

export interface Juncao<R extends Registro> {
  acordaos: AcordaoJuntado<R>[];
  /** Cada id de cada cópia aponta para o acórdão juntado, para ler a ementa e pedir o inteiro teor. */
  porId: Map<string, AcordaoJuntado<R>>;
}

export function juntarEquivalentes<R extends Registro>(ocorrencias: Ocorrencia<R>[]): Juncao<R> {
  // Primeiro agrupa por tribunal + data + ementa (sem comparar todos contra todos)...
  const grupos = new Map<string, Ocorrencia<R>[]>();
  ocorrencias.forEach((o, i) => {
    const ementa = ementaNormalizada(o.registro.ementa);
    const documento = documentoNoTribunal(o.registro);
    // Sem data ou sem ementa não há como afirmar que é o mesmo acórdão: o registro fica sozinho.
    const chave = documento
      ? `${o.registro.tribunal}|documento:${documento}`
      : o.registro.dataJulgamento && ementa
        ? `${o.registro.tribunal}|${o.registro.dataJulgamento}|${ementa}`
        : `sozinho:${i}`;
    const grupo = grupos.get(chave);
    if (grupo) grupo.push(o);
    else grupos.set(chave, [o]);
  });

  // ...depois separa, dentro do grupo, os números de processo que se contradizem.
  const acordaos: AcordaoJuntado<R>[] = [];
  for (const grupo of grupos.values()) {
    const numeros = new Set(grupo.filter((o) => !o.registro.semNumero).map((o) => digitos(o.registro.numero)));
    if (numeros.size <= 1) {
      acordaos.push(juntar(grupo));
      continue;
    }
    // Vários números de verdade: cada número é um acórdão; o registro sem número não tem a qual se juntar.
    const porNumero = new Map<string, Ocorrencia<R>[]>();
    for (const o of grupo) {
      if (o.registro.semNumero) acordaos.push(juntar([o]));
      else porNumero.set(digitos(o.registro.numero), [...(porNumero.get(digitos(o.registro.numero)) ?? []), o]);
    }
    for (const copias of porNumero.values()) acordaos.push(juntar(copias));
  }
  const porId = new Map<string, AcordaoJuntado<R>>();
  for (const a of acordaos) for (const id of a.ids) porId.set(id, a);
  return { acordaos, porId };
}

/**
 * O documento do portal no link, nos tribunais em que a base do site traz o mesmo acórdão em cópias de texto ou data
 * diferentes: o documento é o mesmo nas cópias.
 */
function documentoNoTribunal(r: Registro): string | undefined {
  // TJPR (ADR-0030): dois lotes, com rodapés de ementa diferentes.
  if (r.tribunal === "tjpr") return documentoDoTjpr(r.link ?? r.linkConsulta);
  // TJBA: duas cópias com datas diferentes, e a data muda também no rodapé da ementa.
  if (r.tribunal === "tjba") return documentoDoTjba(r.link) ?? documentoDoTjba(r.linkConsulta);
  return undefined;
}

const HOST_TJBA = "jurisprudenciaws.tjba.jus.br";
// O caminho é o exato da prova; só os dígitos hexadecimais do uuid podem vir em maiúsculas.
const CAMINHO_DO_DOCUMENTO_TJBA =
  /^\/inteiroTeor\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

function documentoDoTjba(link: string | undefined): string | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.host !== HOST_TJBA) return undefined;
    return CAMINHO_DO_DOCUMENTO_TJBA.exec(url.pathname)?.[1].toLowerCase();
  } catch {
    return undefined;
  }
}

function juntar<R extends Registro>(copias: Ocorrencia<R>[]): AcordaoJuntado<R> {
  const escolhida = copias.reduce(maisCompleta);
  const formulacoes = new Set<number>();
  for (const o of copias) for (const f of o.formulacoes) formulacoes.add(f);
  return {
    registro: escolhida.registro,
    ids: copias.map((o) => o.registro.id),
    formulacoes,
    melhorPosicao: Math.min(...copias.map((o) => o.melhorPosicao)),
  };
}

/** Critérios de completude, em ordem de importância; o empate final vai para a melhor posição. */
const CRITERIOS: ((r: Registro) => boolean)[] = [
  (r) => !r.semNumero,
  (r) => Boolean(r.orgao),
  (r) => Boolean(r.link ?? r.linkConsulta),
];

function maisCompleta<R extends Registro>(a: Ocorrencia<R>, b: Ocorrencia<R>): Ocorrencia<R> {
  for (const tem of CRITERIOS) {
    if (tem(a.registro) !== tem(b.registro)) return tem(a.registro) ? a : b;
  }
  return b.melhorPosicao < a.melhorPosicao ? b : a;
}

/** Números de processo comparados só pelos dígitos: a sigla da classe e a pontuação não os contradizem. */
function digitos(numero: string): string {
  return numero.replace(/\D/g, "");
}

/** Sem o "Ementa:" do começo, sem espaços repetidos e sem diferença de maiúsculas. */
function ementaNormalizada(ementa: string): string {
  return ementa.trim().replace(/^ementa\s*:\s*/i, "").replace(/\s+/g, " ").toLowerCase();
}
