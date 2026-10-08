/**
 * Busca ampla: várias formulações × um ou mais tribunais, juntadas sem acórdão repetido (registros equivalentes
 * viram um acórdão só) e ordenadas pela aderência → nº de formulações → melhor posição na busca de origem.
 */

import { Cliente, RecusaError } from "./cliente.js";
import { type Acordao, buscaDireta, type FiltrosBusca, lembrar } from "./busca.js";
import { juntarEquivalentes, type Ocorrencia } from "./equivalencia.js";
import { ordenarPorAderencia, trecho } from "./pontuacao.js";
import { juntarQualificados, type QualificadoAmplo, type QualificadosDaBusca, reservarPorTribunal } from "./saida.js";

export interface ParametrosAmpla extends FiltrosBusca {
  formulacoes: string[];
  tribunais: string[];
  /** Acórdãos pedidos por busca (1 a 100; padrão 100). */
  limitePorBusca?: number;
  /** Máximo de itens na saída compacta (padrão 50). */
  maximo?: number;
  /** Caracteres do trecho da ementa na saída compacta (padrão 120, sem o rótulo "Ementa:"). */
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
  /** Precedentes qualificados que as buscas devolveram, sem repetidos. */
  qualificados: QualificadoAmplo[];
  avisos: string[];
}

export async function buscaAmpla(cliente: Cliente, p: ParametrosAmpla): Promise<ResultadoAmplo> {
  const tarefas = p.tribunais.flatMap((tribunal) => p.formulacoes.map((texto, f) => ({ tribunal, texto, f })));
  const juntos = new Map<string, Ocorrencia<Acordao>>();
  const qualificados: QualificadosDaBusca[] = [];
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
        qualificados.push({ tribunal: t.tribunal.toLowerCase(), formulacao: t.f, qualificados: r.qualificados });
        r.acordaos.forEach((a, posicao) => {
          const atual = juntos.get(a.id) ?? { registro: a, formulacoes: new Set(), melhorPosicao: Infinity };
          atual.formulacoes.add(t.f);
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
    avisos.push("O site costuma devolver poucos acórdãos do STF por busca (de 2 a 7 na medição de out/2026); " +
        "a cobertura dele depende do número de formulações.");
  }

  // Cópias do mesmo acórdão achadas em buscas diferentes viram um acórdão só (mesmo tribunal, data e ementa,
  // sem números de processo que se contradigam).
  const juncao = juntarEquivalentes([...juntos.values()]);
  for (const j of juncao.acordaos) lembrar(j.ids, j.registro);
  // A nota de relevância do site fica de fora de propósito: só os primeiros de cada busca são reranqueados
  // (rerank_score), os demais vêm com score de outra escala, e notas de buscas diferentes não se comparam.
  // A melhor posição na busca de origem já põe os reranqueados na frente.
  const ordenados = ordenarPorAderencia(
    juncao.acordaos.map((j) => ({
      acordao: j.registro,
      tribunal: j.registro.tribunal,
      ementa: j.registro.ementa,
      formulacoes: j.formulacoes.size,
      melhorPosicao: j.melhorPosicao,
    })),
    p.formulacoes,
  );
  const maximo = p.maximo ?? 50;
  // Cada tribunal com acórdão na faixa de aderência de cima tem vagas garantidas na lista mostrada.
  const mostrados = reservarPorTribunal(ordenados, { maximo, naFaixaDeCima: (x) => x.faixa === 0 });
  // Tamanhos escolhidos para 50 acórdãos + 10 qualificados caberem numa resposta (< 25 mil caracteres) com campos
  // de tamanho real (número CNJ, links longos): ver o teste de tamanho em tests/ampla.test.ts.
  const tamanho = p.tamanhoTrecho ?? 120;
  return {
    buscasFeitas: feitas,
    buscasPlanejadas: tarefas.length,
    completa: !recusa && feitas === tarefas.length,
    totalAcordaos: ordenados.length,
    mostrados: mostrados.length,
    acordaos: mostrados.map(({ acordao: a, formulacoes }) => {
      const ementa = a.ementa.replace(/^\s*ementa\b\s*[:.\-–—]?\s*/i, "");
      const item: ItemAmplo = {
        id: a.id,
        numero: a.numero,
        tribunal: a.tribunal,
        data: a.dataJulgamento,
        orgao: a.orgao,
        trecho: trecho(ementa, p.formulacoes, tamanho),
        link: a.link ?? a.linkConsulta,
        formulacoes,
      };
      return item;
    }),
    qualificados: juntarQualificados(qualificados, { tamanhoTexto: 200 }),
    avisos,
  };
}
