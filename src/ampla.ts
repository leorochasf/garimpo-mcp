/**
 * Busca ampla: várias formulações × um ou mais tribunais, juntadas sem acórdão repetido (registros equivalentes
 * viram um acórdão só) e ordenadas pela aderência → nº de formulações → melhor posição na busca de origem. Os TRTs vão
 * ao Falcão, 1 página por formulação × TRT, com teto de páginas por chamada (ADR-0018).
 */

import { Cliente, PausaPreventivaError, RecusaError, umaProvaPorFerramenta } from "./cliente.js";
import {
  type Acordao,
  buscaDireta,
  type FiltrosBusca,
  lerBuscaGuardada,
  type ParametrosBusca,
  RESSALVA_ROTULO,
  type ResultadoBusca,
} from "./busca.js";
import { ART_927_CONFERIDO_EM } from "./enquadramento.js";
import { conferirPedidoAoFalcao } from "./falcao.js";
import { ehDoFalcao, infoTribunal, ROTULO_FALCAO } from "./tribunais.js";
import { juntarEquivalentes, type Ocorrencia } from "./equivalencia.js";
import { filtroLocal, type FiltrosLocais } from "./filtroLocal.js";
import { diaEHora, FalhaNaMemoriaError, type Memoria } from "./memoria.js";
import { ordenarPorAderencia, trecho } from "./pontuacao.js";
import { avisoDeRecorridoAusenteAmplo } from "./recorrido.js";
import type { TabelaDePrecedentes } from "./tabelaDePrecedentes.js";
import type { TabelaDoStf } from "./tabelaDoStf.js";
import { juntarQualificados, type QualificadoAmplo, type QualificadosDaBusca, reservarPorTribunal } from "./saida.js";

export interface ParametrosAmpla extends FiltrosBusca, FiltrosLocais {
  formulacoes: string[];
  tribunais: string[];
  /** Acórdãos pedidos por busca (1 a 100; padrão 100). */
  limitePorBusca?: number;
  /** Máximo de itens na saída compacta (padrão 50). */
  maximo?: number;
  /** Caracteres do trecho da ementa na saída compacta (padrão 120, sem o rótulo "Ementa:"). */
  tamanhoTrecho?: number;
  /** Ignora as buscas guardadas e faz todas no site; a que falhar é busca com erro. */
  renovar?: boolean;
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
  /** Só quando a busca inclui TRT: a fonte do acórdão ("Falcão (CSJT)" ou "JurisprudênciaIA"); o rótulo vem em fontes. */
  fonte?: string;
}

/** Linha do cabeçalho de cobertura de um tribunal. Busca vazia e busca com erro nunca se confundem. */
export interface CoberturaTribunal {
  tribunal: string;
  buscasFeitas: number;
  vazias: number;
  comErro: number;
  /** Só quando uma recusa parou a busca ampla antes de rodar todas as formulações neste tribunal. */
  naoFeitas?: number;
  /** Só em TRT: formulações não executadas pelo teto de páginas do Falcão por chamada (nunca busca vazia). */
  foraDoTeto?: number;
  /** Só em TRT: formulações não executadas pela pausa preventiva do Falcão (nunca busca vazia). */
  pausaPreventiva?: number;
  /**
   * Só quando alguma busca veio da memória (nomes e data curtos: com 2 tribunais, a resposta já beira o teto de 25 mil
   * caracteres): quantas das buscasFeitas são buscas guardadas...
   */
  guardadas?: number;
  /** ...quantas foram feitas no site agora... */
  feitasAgora?: number;
  /** ...e a data e hora (local) em que foi feita no site a guardada mais antiga: "08/10/2026 14:03". */
  maisAntiga?: string;
  /** Só quando alguma busca do tribunal deu resposta: sem nenhuma, não há "0 achados" a mostrar. */
  achados?: number;
  /**
   * Só com filtro local (nomes curtos: com 2 tribunais e buscas guardadas, a resposta já beira o teto de 25 mil
   * caracteres): excluídos pelo filtro, achados com ementa conferível que descumpriram o filtro e saíram da lista...
   */
  excluidos?: number;
  /** ...e, só quando há, os sem ementa para conferir, que saem por não haver texto a conferir. */
  semEmenta?: number;
  mostrados?: number;
  /** Nenhuma busca do tribunal deu resposta: "com erro", ou "não pesquisado" se a busca parou antes dele. */
  situacao?: "com erro" | "não pesquisado";
}

export interface CabecalhoDeCobertura {
  porTribunal: CoberturaTribunal[];
  /** Formulações que não trouxeram nenhum acórdão em nenhum tribunal (todas as buscas delas deram resposta). */
  formulacoesSemAcordao: string[];
  /** Só quando a lista foi cortada pelo máximo. */
  listaCortada?: string;
  /** Só quando o filtro local tirou todos os acórdãos achados: o motivo da lista vazia. */
  filtroLocal?: string;
  /** Só quando o teto de páginas do Falcão deixou combinações formulação × TRT sem executar. */
  tetoDoFalcao?: string;
}

export interface ResultadoAmplo {
  buscasFeitas: number;
  buscasPlanejadas: number;
  completa: boolean;
  totalAcordaos: number;
  mostrados: number;
  cabecalhoDeCobertura: CabecalhoDeCobertura;
  acordaos: ItemAmplo[];
  /** Precedentes qualificados que as buscas devolveram, sem repetidos. */
  qualificados: QualificadoAmplo[];
  /** Vai junto da lista de precedentes qualificados: o rótulo é do site; diz onde está o enquadramento927 completo. */
  ressalvaQualificados: string;
  /** Só quando a busca inclui TRT: o rótulo de cada fonte usada. */
  fontes?: Record<string, string>;
  avisos: string[];
}

/** Teto de páginas do Falcão por chamada da busca ampla (1 página = 1 formulação × TRT). */
export const PAGINAS_DO_FALCAO_POR_CHAMADA = 5;
/** Acórdãos por busca num TRT na busca ampla: 1 página do Falcão. */
const LIMITE_TRT_NA_AMPLA = 10;

/** O campo semEmenta só vai quando há acórdão sem ementa para conferir (a resposta beira o teto de 25 mil caracteres). */
const semEmentaDoTribunal = (n: number) => (n ? { semEmenta: n } : {});

export async function buscaAmpla(
  cliente: Cliente,
  p: ParametrosAmpla,
  memoria?: Memoria,
  { tabela, tabelaStf, falcao }: { tabela?: TabelaDePrecedentes; tabelaStf?: TabelaDoStf; falcao?: Cliente } = {},
): Promise<ResultadoAmplo> {
  const comTrt = p.tribunais.some(ehDoFalcao);
  // Antes de gastar chamada: filtro ainda não verificado num TRT é erro que ensina.
  for (const t of p.tribunais.filter(ehDoFalcao)) conferirPedidoAoFalcao({ ...p, tribunal: t, texto: "" }, { limite: false });
  const tarefas = p.tribunais.flatMap((t) =>
    p.formulacoes.map((texto, f) => ({
      tribunal: t.toLowerCase(),
      texto,
      f,
      rotulo: `${t.toUpperCase()} / formulação ${f + 1}`,
      /** Por que a busca não deu resposta: vai na resposta de erro da falha total. */
      motivo: undefined as string | undefined,
      /** Resposta (guardada ou do site), juntada depois que as duas filas terminam. */
      resposta: undefined as ResultadoBusca | undefined,
      /** Instante em que a busca guardada foi feita no site. */
      guardadaEm: undefined as number | undefined,
      /** Só em TRT: por que não foi executada (teto de páginas do Falcão ou pausa preventiva). */
      naoExecutada: undefined as "teto" | "pausa" | undefined,
    })),
  );
  const juntos = new Map<string, Ocorrencia<Acordao>>();
  const qualificados: QualificadosDaBusca[] = [];
  const avisos: string[] = [];
  let feitas = 0;
  let recusa: RecusaError | undefined;
  let pausaDoFalcao: PausaPreventivaError | undefined;
  const porTribunal = new Map<
    string,
    { planejadas: number; buscasFeitas: number; vazias: number; comErro: number; guardadas: number; maisAntiga: number }
  >();
  for (const t of tarefas) {
    const contas = porTribunal.get(t.tribunal) ?? {
      planejadas: 0,
      buscasFeitas: 0,
      vazias: 0,
      comErro: 0,
      guardadas: 0,
      maisAntiga: Infinity,
    };
    contas.planejadas++;
    porTribunal.set(t.tribunal, contas);
  }
  // Por formulação: quantas buscas dela deram resposta e quantos acórdãos trouxeram somando os tribunais.
  const porFormulacao = p.formulacoes.map(() => ({ respostas: 0, acordaos: 0 }));
  // Acórdãos que vieram de busca feita no site agora: só eles vão para a memória com a data de hoje.
  const doSiteAgora = new Set<string>();
  const parametros = (t: (typeof tarefas)[number]): ParametrosBusca => ({
    tribunal: t.tribunal,
    texto: t.texto,
    limite: ehDoFalcao(t.tribunal) ? LIMITE_TRT_NA_AMPLA : (p.limitePorBusca ?? 100),
    de: p.de,
    ate: p.ate,
    relator: p.relator,
    orgao: p.orgao,
    classe: p.classe,
  });
  /** Junta a resposta de uma busca (do site ou guardada, com o instante em que foi feita no site). */
  const registrar = (t: (typeof tarefas)[number], r: ResultadoBusca, guardadaEm?: number) => {
    feitas++;
    const contas = porTribunal.get(t.tribunal)!;
    contas.buscasFeitas++;
    if (r.acordaos.length === 0) contas.vazias++;
    if (guardadaEm !== undefined) {
      contas.guardadas++;
      contas.maisAntiga = Math.min(contas.maisAntiga, guardadaEm);
    } else {
      for (const a of r.acordaos) doSiteAgora.add(a.id);
    }
    porFormulacao[t.f].respostas++;
    porFormulacao[t.f].acordaos += r.acordaos.length;
    qualificados.push({ tribunal: t.tribunal, formulacao: t.f, qualificados: r.qualificados });
    r.acordaos.forEach((a, posicao) => {
      const atual = juntos.get(a.id) ?? { registro: a, formulacoes: new Set(), melhorPosicao: Infinity };
      atual.formulacoes.add(t.f);
      atual.melhorPosicao = Math.min(atual.melhorPosicao, posicao);
      juntos.set(a.id, atual);
    });
  };

  // Primeiro a memória, sem nenhuma chamada: repetir ou ampliar a busca só leva ao site as combinações novas, e a
  // busca guardada responde mesmo com o serviço pausado.
  // Falha ao ler a memória leva a busca ao site, como busca nova, com aviso.
  let falhasAoLer = 0;
  const guardadas =
    memoria && !p.renovar
      ? await Promise.all(
          tarefas.map((t) =>
            lerBuscaGuardada(memoria, parametros(t)).catch((e) => {
              if (e instanceof FalhaNaMemoriaError) falhasAoLer++;
              return undefined;
            }),
          ),
        )
      : [];
  tarefas.forEach((t, i) => {
    const g = guardadas[i];
    if (g) [t.resposta, t.guardadaEm] = [g.resultado, g.obtidoEm];
  });
  // Teto de páginas do Falcão: primeiro a 1ª formulação em cada TRT pedido, na ordem dada, depois as seguintes.
  const ordemDoTribunal = (t: (typeof tarefas)[number]) => p.tribunais.findIndex((x) => x.toLowerCase() === t.tribunal);
  const doFalcao = tarefas
    .filter((t) => !t.resposta && ehDoFalcao(t.tribunal))
    .sort((a, b) => a.f - b.f || ordemDoTribunal(a) - ordemDoTribunal(b));
  for (const t of doFalcao.slice(PAGINAS_DO_FALCAO_POR_CHAMADA)) t.naoExecutada = "teto";
  const noSite = tarefas.filter((t) => !t.resposta && !t.naoExecutada);

  // Duas filas de trabalho, como o cliente: depois de uma recusa ninguém pega tarefa nova.
  let proxima = 0;
  const trabalhar = async () => {
    while (!recusa && proxima < noSite.length) {
      const t = noSite[proxima++];
      // Depois da pausa preventiva, as buscas no Falcão que faltam não saem: não executadas, nunca vazias.
      if (pausaDoFalcao && ehDoFalcao(t.tribunal)) {
        t.naoExecutada = "pausa";
        continue;
      }
      try {
        // A memória já foi consultada: aqui só vai ao site; os acórdãos são guardados depois de juntar as cópias.
        t.resposta = await buscaDireta(cliente, parametros(t), memoria, {
          renovar: true,
          guardarAcordaos: false,
          tabela,
          tabelaStf,
          falcao,
        });
      } catch (e) {
        if (e instanceof PausaPreventivaError) {
          pausaDoFalcao ??= e;
          t.naoExecutada = "pausa";
          continue;
        }
        porTribunal.get(t.tribunal)!.comErro++;
        if (e instanceof RecusaError) {
          recusa ??= e;
          t.motivo = `${t.rotulo}: recusa`;
        } else {
          t.motivo = `${t.rotulo}: ${(e as Error).message}`;
          avisos.push(t.motivo);
        }
      }
    }
  };
  // Se o serviço estiver aguardando a chamada de prova, a busca ampla inteira faz no máximo uma.
  await umaProvaPorFerramenta(() => Promise.all([trabalhar(), trabalhar()]));
  // Guardadas e do site juntadas na ordem das tarefas (tribunal → formulação), nunca na de chegada ou de leitura dos
  // arquivos, que varia de uma execução para outra: é o desempate final da lista, depois de aderência, nº de
  // formulações e melhor posição.
  for (const t of tarefas) if (t.resposta) registrar(t, t.resposta, t.guardadaEm);

  // Nenhuma busca deu resposta: é erro, nunca lista vazia, que se leria como "os tribunais nunca decidiram a
  // tese" (ADR-0001). A mensagem de recusa vai junto, com o "espere e tente de novo".
  if (feitas === 0) {
    throw new Error(
      [
        `Nenhuma das ${tarefas.length} buscas deu resposta, por isso não há lista de acórdãos ` +
          "(o erro não significa que os tribunais nunca decidiram a tese).",
        ...(recusa ? [recusa.message] : []),
        ...(pausaDoFalcao ? [pausaDoFalcao.message] : []),
        "Motivo de cada busca:",
        ...tarefas.map((t) => t.motivo ?? `${t.rotulo}: ${motivoDaNaoFeita(t.naoExecutada)}`),
      ].join("\n"),
    );
  }

  if (recusa) {
    avisos.unshift(
      `BUSCA INCOMPLETA: ${feitas} de ${tarefas.length} buscas deram resposta (as guardadas incluídas) antes de o site recusar. ` +
        `A lista abaixo é só o que já tinha sido juntado. ${recusa.message}`,
    );
  }
  if (pausaDoFalcao) avisos.unshift(`BUSCA INCOMPLETA NOS TRTs: ${pausaDoFalcao.message}`);
  if (p.tribunais.some((t) => t.toLowerCase() === "stf")) {
    avisos.push("O site costuma devolver poucos acórdãos do STF por busca (de 2 a 7 na medição de out/2026); " +
        "a cobertura dele depende do número de formulações.");
  }
  // Uma frase curta, sem código nem caminho (estão no aviso da busca_direta): a resposta beira o teto de 25 mil.
  const falhouAoGravar = memoria?.avisoDeGravacao() !== undefined;
  // "Tratadas como novas": foram ao site e, se a rede não deixou, estão "com erro" no cabeçalho, como qualquer nova.
  const naoLidas = `ao ler ${falhasAoLer} de ${tarefas.length} buscas`;
  if (falhasAoLer && falhouAoGravar) avisos.push(`Memória do Garimpo falhou ${naoLidas} (tratadas como novas) e ao gravar.`);
  else if (falhasAoLer) avisos.push(`Memória do Garimpo falhou ${naoLidas}: tratadas como buscas novas.`);
  else if (falhouAoGravar) avisos.push("Memória do Garimpo falhou ao gravar: o que esta janela guarda não vale nas outras.");

  // Cópias do mesmo acórdão achadas em buscas diferentes viram um acórdão só (mesmo tribunal, data e ementa,
  // sem números de processo que se contradigam).
  const juncao = juntarEquivalentes([...juntos.values()]);
  // Só as cópias vindas do site agora ganham a data de hoje; as de buscas guardadas já estão na memória com a delas.
  memoria?.lembrar(
    juncao.acordaos
      .map((j) => ({ registro: j.registro, ids: j.ids.filter((id) => doSiteAgora.has(id)) }))
      .filter((j) => j.ids.length),
  );
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
  // Filtro local depois da ordem, que ele não muda: tira acórdãos, e a reserva por tribunal e o corte vêm depois, só
  // entre os que passaram. Sem ementa, com qualquer filtro ativo, sai por não haver texto a conferir.
  const passa = filtroLocal(p);
  const excluidos = new Set<(typeof ordenados)[number]>();
  const semEmenta = new Set<(typeof ordenados)[number]>();
  if (passa) {
    for (const x of ordenados) {
      if (!x.ementa.trim()) semEmenta.add(x);
      else if (!passa(x.ementa)) excluidos.add(x);
    }
  }
  const sobreviventes = ordenados.filter((x) => !excluidos.has(x) && !semEmenta.has(x));
  const maximo = p.maximo ?? 50;
  // Cada tribunal com acórdão na faixa de aderência de cima tem vagas garantidas na lista mostrada.
  const mostrados = reservarPorTribunal(sobreviventes, { maximo, naFaixaDeCima: (x) => x.faixa === 0 });
  // Tamanhos escolhidos para 50 acórdãos + 10 qualificados caberem numa resposta (< 25 mil caracteres) com campos
  // de tamanho real (número CNJ, links longos): ver o teste de tamanho em tests/ampla.test.ts.
  const tamanho = p.tamanhoTrecho ?? 120;
  const cabecalho: CabecalhoDeCobertura = {
    porTribunal: [...porTribunal].map(([tribunal, { planejadas, guardadas, maisAntiga, ...contas }]) => {
      const doTribunal = tarefas.filter((t) => t.tribunal === tribunal);
      const foraDoTeto = doTribunal.filter((t) => t.naoExecutada === "teto").length;
      const pausaPreventiva = doTribunal.filter((t) => t.naoExecutada === "pausa").length;
      const naoFeitas = planejadas - contas.buscasFeitas - contas.comErro - foraDoTeto - pausaPreventiva;
      const linha: CoberturaTribunal = {
        tribunal,
        ...contas,
        ...(naoFeitas ? { naoFeitas } : {}),
        ...(foraDoTeto ? { foraDoTeto } : {}),
        ...(pausaPreventiva ? { pausaPreventiva } : {}),
        ...(guardadas && { guardadas, feitasAgora: contas.buscasFeitas - guardadas, maisAntiga: diaEHora(maisAntiga) }),
      };
      if (contas.buscasFeitas === 0) return { ...linha, situacao: contas.comErro ? "com erro" : "não pesquisado" };
      return {
        ...linha,
        achados: ordenados.filter((x) => x.tribunal === tribunal).length,
        ...(passa && { excluidos: [...excluidos].filter((x) => x.tribunal === tribunal).length }),
        ...semEmentaDoTribunal([...semEmenta].filter((x) => x.tribunal === tribunal).length),
        mostrados: mostrados.filter((x) => x.tribunal === tribunal).length,
      };
    }),
    // Formulação com busca com erro ou não feita em algum tribunal fica de fora: lá ela não foi verificada.
    formulacoesSemAcordao: p.formulacoes.filter(
      (_, f) => porFormulacao[f].respostas === p.tribunais.length && porFormulacao[f].acordaos === 0,
    ),
  };
  const foraDoTeto = tarefas.filter((t) => t.naoExecutada === "teto").length;
  if (foraDoTeto) {
    cabecalho.tetoDoFalcao =
      `${foraDoTeto} de ${tarefas.filter((t) => ehDoFalcao(t.tribunal)).length} buscas (formulação × TRT) não ` +
      `executadas pelo teto de ${PAGINAS_DO_FALCAO_POR_CHAMADA} páginas do Falcão por chamada (não são buscas vazias); ` +
      "repita a mesma busca_ampla para executá-las (as já feitas voltam da memória) ou use menos formulações ou TRTs.";
  }
  // Lista vazia por causa do filtro diz isso com todas as letras: não se lê como "os tribunais nunca decidiram".
  if (ordenados.length && !sobreviventes.length) {
    cabecalho.filtroLocal =
      `Nenhum dos ${ordenados.length} acórdãos achados passou pelo filtro local (${excluidos.size} excluídos pelo ` +
      `filtro; ${semEmenta.size} sem ementa para conferir): a lista está vazia por causa do filtro, não por falta de ` +
      "acórdãos achados; afrouxe ou retire o filtro local.";
  }
  // Com filtro local, conta só os que passaram por ele: o que o filtro tirou não é lista cortada.
  if (mostrados.length < sobreviventes.length) {
    cabecalho.listaCortada =
      `mostrando ${mostrados.length} de ${sobreviventes.length}; ` +
      (maximo < 200 ? "para ver mais, peça máximo maior (até 200)" : "200 é o máximo por resposta");
  }
  // Uma vez, nunca por item: o recorrido achado e cortado da lista (ou filtrado) não está ausente.
  const recorrido = avisoDeRecorridoAusenteAmplo(
    mostrados.map((x) => x.acordao),
    ordenados.map((x) => x.acordao),
  );
  if (recorrido) avisos.push(recorrido);
  return {
    buscasFeitas: feitas,
    buscasPlanejadas: tarefas.length,
    completa: !recusa && !pausaDoFalcao && feitas === tarefas.length,
    totalAcordaos: ordenados.length,
    mostrados: mostrados.length,
    cabecalhoDeCobertura: cabecalho,
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
        ...(comTrt && { fonte: infoTribunal(a.tribunal)?.fonte }),
      };
      if (!ementa.trim() && ehDoFalcao(a.tribunal)) item.trecho = "sem ementa no Falcão";
      return item;
    }),
    // Texto do qualificado em 120 caracteres para caber o enquadramento927 curto (decisão do dono, 2026-10-08).
    qualificados: juntarQualificados(qualificados, { tamanhoTexto: 120, tabela, tabelaStf }),
    ressalvaQualificados:
      `${RESSALVA_ROTULO}Aqui o enquadramento927 vem curto (art. 927 conferido em ${ART_927_CONFERIDO_EM}); completo na ` +
      "busca_direta; o dos acórdãos no obter_ementa.",
    // Só as fontes dos tribunais pedidos.
    ...(comTrt && {
      fontes: {
        "Falcão (CSJT)": ROTULO_FALCAO,
        ...(!p.tribunais.every(ehDoFalcao) && { JurisprudênciaIA: "busca direta do JurisprudênciaIA (base não oficial)" }),
      },
    }),
    avisos,
  };
}

/** Por que a busca não saiu, na resposta de erro da falha total. */
function motivoDaNaoFeita(naoExecutada: "teto" | "pausa" | undefined): string {
  if (naoExecutada === "teto") return `não executada (teto de ${PAGINAS_DO_FALCAO_POR_CHAMADA} páginas do Falcão por chamada)`;
  if (naoExecutada === "pausa") return "não executada (pausa preventiva do Falcão)";
  return "não feita (a busca parou na recusa)";
}
