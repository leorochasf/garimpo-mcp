/**
 * Regras da lista final da busca ampla, sem nenhuma chamada a mais ao site:
 * reserva mínima de vagas por tribunal e seção de precedentes qualificados.
 */

import type { Qualificado } from "./busca.js";
import { formaCurta } from "./enquadramento.js";
import { reforcoDaTabela, type TabelaDePrecedentes } from "./tabelaDePrecedentes.js";
import { reforcoDoStf, type TabelaDoStf } from "./tabelaDoStf.js";

export interface OpcoesReserva<T> {
  /** Tamanho da lista mostrada. */
  maximo: number;
  /** Vagas garantidas a cada tribunal (padrão 3). */
  vagasPorTribunal?: number;
  /** Só acórdãos na faixa de aderência de cima entram pela reserva. */
  naFaixaDeCima: (item: T) => boolean;
}

/**
 * Recebe os acórdãos já na ordem geral e devolve a lista mostrada: cada tribunal tem garantidas até
 * `vagasPorTribunal` vagas, preenchidas pelos melhores dele na faixa de aderência de cima; o resto das
 * vagas segue a ordem geral. O resultado continua na ordem geral (a reserva não pula para o topo).
 */
export function reservarPorTribunal<T extends { tribunal: string }>(ordenados: T[], o: OpcoesReserva<T>): T[] {
  const vagas = o.vagasPorTribunal ?? 3;
  const reservados = new Set<T>();
  const usadas = new Map<string, number>();
  for (const item of ordenados) {
    if (reservados.size >= o.maximo) break;
    const ja = usadas.get(item.tribunal) ?? 0;
    if (ja < vagas && o.naFaixaDeCima(item)) {
      reservados.add(item);
      usadas.set(item.tribunal, ja + 1);
    }
  }
  const mostrados: T[] = [];
  let livres = o.maximo - reservados.size;
  for (const item of ordenados) {
    if (reservados.has(item)) mostrados.push(item);
    else if (livres > 0) {
      mostrados.push(item);
      livres--;
    }
  }
  return mostrados;
}

/** Precedentes qualificados devolvidos por uma busca direta da busca ampla. */
export interface QualificadosDaBusca {
  tribunal: string;
  /** Índice da formulação que fez a busca. */
  formulacao: number;
  qualificados: Qualificado[];
}

/**
 * Com o enquadramento927 na forma curta: o completo não cabe no teto de 25 mil caracteres da busca ampla (50 acórdãos
 * + 10 qualificados de tamanho real; ver o teste de tamanho em tests/ampla.test.ts).
 */
export interface QualificadoAmplo extends Omit<Qualificado, "enquadramento927"> {
  /** Forma curta: rótulo e motivo abreviado ("não classificado: …") ou inciso e aviso de situação ("art. 927, II; …"). */
  enquadramento927: string;
  tribunal: string;
  /** Quantas formulações trouxeram este precedente. */
  formulacoes: number;
}

export interface OpcoesQualificados {
  /** Máximo de precedentes na seção (padrão 10). */
  teto?: number;
  /** Caracteres do começo do texto de cada precedente (padrão 300). */
  tamanhoTexto?: number;
  /** Tabela de precedentes do STJ: a forma curta do tema/IAC do STJ casado leva a situação na fonte curta. */
  tabela?: TabelaDePrecedentes;
  /** Tabela do STF: a forma curta de repercussão geral e súmulas do STF casadas leva a situação ou marca curta. */
  tabelaStf?: TabelaDoStf;
}

/**
 * Junta os precedentes qualificados de todas as buscas, sem repetidos (mesmo tribunal, tipo e número),
 * ordenados por quantas formulações trouxeram cada um, com teto e texto cortado.
 */
export function juntarQualificados(buscas: QualificadosDaBusca[], o: OpcoesQualificados = {}): QualificadoAmplo[] {
  const tamanho = o.tamanhoTexto ?? 300;
  const juntos = new Map<string, { q: Qualificado; tribunal: string; formulacoes: Set<number> }>();
  for (const busca of buscas) {
    for (const q of busca.qualificados) {
      const chave = [busca.tribunal, q.tipo, q.numero ?? q.texto].join("|");
      const atual = juntos.get(chave) ?? { q, tribunal: busca.tribunal, formulacoes: new Set<number>() };
      atual.formulacoes.add(busca.formulacao);
      juntos.set(chave, atual);
    }
  }
  return [...juntos.values()]
    .sort((a, b) => b.formulacoes.size - a.formulacoes.size)
    .slice(0, o.teto ?? 10)
    .map(({ q, tribunal, formulacoes }) => ({
      ...q,
      texto: q.texto.length > tamanho ? `${q.texto.slice(0, tamanho)}…` : q.texto,
      enquadramento927: formaCurta(
        { tribunal, tipo: q.tipo, numero: q.numero },
        q.enquadramento927,
        reforcoDaTabela(o.tabela, tribunal, q.tipo, q.numero) ?? reforcoDoStf(o.tabelaStf, tribunal, q.tipo, q.numero),
      ),
      tribunal,
      formulacoes: formulacoes.size,
    }));
}
