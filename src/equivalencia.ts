/**
 * Equivalência de registros: reconhece quando dois registros da base do site são o mesmo acórdão
 * (mesmo tribunal + mesma data de julgamento + mesma ementa, sem números de processo que se contradigam)
 * e os junta num acórdão só.
 */

/** O mínimo de um registro que a regra precisa olhar. */
export interface Registro {
  /** Id composto "tribunal:id". */
  id: string;
  tribunal: string;
  numero: string;
  /** Sinal explícito: o site não trouxe número de processo de verdade (o `numero` é só o id do site). */
  semNumero?: boolean;
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
    // Sem data ou sem ementa não há como afirmar que é o mesmo acórdão: o registro fica sozinho.
    const chave =
      o.registro.dataJulgamento && ementa ? `${o.registro.tribunal}|${o.registro.dataJulgamento}|${ementa}` : `sozinho:${i}`;
    const grupo = grupos.get(chave);
    if (grupo) grupo.push(o);
    else grupos.set(chave, [o]);
  });

  // ...depois separa, dentro do grupo, os números de processo que se contradizem.
  const acordaos: AcordaoJuntado<R>[] = [];
  for (const grupo of grupos.values()) {
    const numeros = new Set(grupo.filter((o) => !o.registro.semNumero).map((o) => o.registro.numero));
    if (numeros.size <= 1) {
      acordaos.push(juntar(grupo));
      continue;
    }
    // Vários números de verdade: cada número é um acórdão; o registro sem número não tem a qual se juntar.
    const porNumero = new Map<string, Ocorrencia<R>[]>();
    for (const o of grupo) {
      if (o.registro.semNumero) acordaos.push(juntar([o]));
      else porNumero.set(o.registro.numero, [...(porNumero.get(o.registro.numero) ?? []), o]);
    }
    for (const copias of porNumero.values()) acordaos.push(juntar(copias));
  }
  const porId = new Map<string, AcordaoJuntado<R>>();
  for (const a of acordaos) for (const id of a.ids) porId.set(id, a);
  return { acordaos, porId };
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

/** Sem o "Ementa:" do começo, sem espaços repetidos e sem diferença de maiúsculas. */
function ementaNormalizada(ementa: string): string {
  return ementa.trim().replace(/^ementa\s*:\s*/i, "").replace(/\s+/g, " ").toLowerCase();
}
