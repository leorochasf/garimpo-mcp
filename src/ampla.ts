/**
 * Busca ampla: várias formulações × um ou mais tribunais, juntadas sem repetidos e
 * ordenadas por quantas formulações acharam cada acórdão (desempate: relevância).
 */

import { Cliente, RecusaError } from "./cliente.js";
import { type Acordao, buscaDireta, type FiltrosBusca, lembrar } from "./busca.js";
import { juntarEquivalentes } from "./equivalencia.js";

export interface ParametrosAmpla extends FiltrosBusca {
  formulacoes: string[];
  tribunais: string[];
  /** Acórdãos pedidos por busca (1 a 100; padrão 100). */
  limitePorBusca?: number;
  /** Máximo de itens na saída compacta (padrão 50). */
  maximo?: number;
  /** Caracteres do começo da ementa na saída compacta. */
  tamanhoTrecho?: number;
}

export interface ItemAmplo {
  id: string;
  numero: string;
  tribunal: string;
  data?: string;
  orgao?: string;
  trecho: string;
  link?: string;
  formulacoes: number;
}

export interface ResultadoAmplo {
  buscasFeitas: number;
  buscasPlanejadas: number;
  completa: boolean;
  totalAcordaos: number;
  mostrados: number;
  acordaos: ItemAmplo[];
  avisos: string[];
}

interface Acumulado {
  acordao: Acordao;
  formulacoes: Set<number>;
  relevancia: number;
  melhorPosicao: number;
}

export async function buscaAmpla(cliente: Cliente, p: ParametrosAmpla): Promise<ResultadoAmplo> {
  const tarefas = p.tribunais.flatMap((tribunal) => p.formulacoes.map((texto, f) => ({ tribunal, texto, f })));
  const juntos = new Map<string, Acumulado>();
  const avisos: string[] = [];
  let feitas = 0;
  let recusa: RecusaError | undefined;

  // Duas filas de trabalho, como o cliente: depois de uma recusa ninguém pega tarefa nova.
  let proxima = 0;
  const trabalhar = async () => {
    while (!recusa && proxima < tarefas.length) {
      const t = tarefas[proxima++];
      try {
        const r = await buscaDireta(cliente, {
          tribunal: t.tribunal,
          texto: t.texto,
          limite: p.limitePorBusca ?? 100,
          de: p.de,
          ate: p.ate,
          relator: p.relator,
          orgao: p.orgao,
          classe: p.classe,
        });
        feitas++;
        r.acordaos.forEach((a, posicao) => {
          const atual = juntos.get(a.id) ?? { acordao: a, formulacoes: new Set(), relevancia: -Infinity, melhorPosicao: Infinity };
          atual.formulacoes.add(t.f);
          atual.relevancia = Math.max(atual.relevancia, a.relevancia ?? -Infinity);
          atual.melhorPosicao = Math.min(atual.melhorPosicao, posicao);
          juntos.set(a.id, atual);
        });
      } catch (e) {
        if (e instanceof RecusaError) recusa ??= e;
        else avisos.push(`${t.tribunal.toUpperCase()} / formulação ${t.f + 1}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all([trabalhar(), trabalhar()]);

  if (recusa) {
    avisos.unshift(
      `BUSCA INCOMPLETA: ${feitas} de ${tarefas.length} buscas foram feitas antes de o site recusar. ` +
        `A lista abaixo é só o que já tinha sido juntado. ${recusa.message}`,
    );
  }
  if (p.tribunais.some((t) => t.toLowerCase() === "stf")) {
    avisos.push("O STF devolve no máximo 4 acórdãos por busca; a cobertura dele depende do número de formulações.");
  }

  // Cópias do mesmo acórdão achadas em buscas diferentes viram um acórdão só (regra do ticket 06).
  const juncao = juntarEquivalentes(
    [...juntos.values()].map((x) => ({ registro: x.acordao, formulacoes: x.formulacoes, melhorPosicao: x.melhorPosicao })),
  );
  const acordaos = juncao.acordaos.map((j) => {
    lembrar(j.ids, j.registro);
    return {
      acordao: j.registro,
      formulacoes: j.formulacoes,
      relevancia: Math.max(...j.ids.map((id) => juntos.get(id)!.relevancia)),
      melhorPosicao: j.melhorPosicao,
    };
  });
  const ordenados = acordaos.sort(
    (a, b) =>
      b.formulacoes.size - a.formulacoes.size || b.relevancia - a.relevancia || a.melhorPosicao - b.melhorPosicao,
  );
  const maximo = p.maximo ?? 50;
  const tamanho = p.tamanhoTrecho ?? 160;
  return {
    buscasFeitas: feitas,
    buscasPlanejadas: tarefas.length,
    completa: !recusa && feitas === tarefas.length,
    totalAcordaos: ordenados.length,
    mostrados: Math.min(maximo, ordenados.length),
    acordaos: ordenados.slice(0, maximo).map(({ acordao: a, formulacoes }) => {
      const item: ItemAmplo = {
        id: a.id,
        numero: a.numero,
        tribunal: a.tribunal,
        data: a.dataJulgamento,
        orgao: a.orgao,
        trecho: a.ementa.length > tamanho ? `${a.ementa.slice(0, tamanho)}…` : a.ementa,
        link: a.link ?? a.linkConsulta,
        formulacoes: formulacoes.size,
      };
      return item;
    }),
    avisos,
  };
}
