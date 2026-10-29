/**
 * Busca ampla: várias formulações × um ou mais tribunais, juntadas sem acórdão repetido (registros equivalentes
 * viram um acórdão só) e ordenadas pela aderência → nº de formulações → melhor posição na busca de origem. Os TRTs vão
 * ao Falcão, 1 página por formulação × TRT, com teto de páginas por chamada (ADR-0018).
 */

import { Cliente, ErroHttp, FormatoInesperadoError, PausaPreventivaError, RecusaError, TETO_DIARIO_DO_FALCAO, umaProvaPorFerramenta } from "./cliente.js";
import { RedeParadaError } from "./coordenacao.js";
import {
  type Acordao,
  buscaDiretaSemMarca,
  type CampoAusente,
  camposAusentes,
  type FiltrosBusca,
  lerBuscaGuardada,
  type ParametrosBusca,
  RESSALVA_ROTULO,
  type ResultadoBusca,
} from "./busca.js";
import { nomesDoFiltro, ressalvaSePoucos } from "./grafia.js";
import { ART_927_CONFERIDO_EM } from "./enquadramento.js";
import { conferirPedidoAoFalcao } from "./falcao.js";
import { avisoDeLinkDoTjgo, ehDoFalcao, infoTribunal, ROTULO_FALCAO, TRTS } from "./tribunais.js";
import { juntarEquivalentes, type Ocorrencia } from "./equivalencia.js";
import { agruparEmSerie, CRITERIO_DA_SERIE } from "./emSerie.js";
import { filtroLocal, type FiltrosLocais } from "./filtroLocal.js";
import { diaEHora, FalhaNaMemoriaError, type Memoria } from "./memoria.js";
import { ordenarPorAderencia, ordenarPorData, trecho } from "./pontuacao.js";
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
  /** Caracteres do trecho da ementa na saída compacta (padrão 110, sem o rótulo "Ementa:"). */
  tamanhoTrecho?: number;
  /** Ignora as buscas guardadas e faz todas no site; a que falhar é busca com erro. */
  renovar?: boolean;
  /**
   * Apresentação da lista (padrão "aderencia"). Com "data", os mesmos acórdãos escolhidos pela aderência saem do
   * julgamento mais antigo ao mais recente; o corte pelo máximo continua pela aderência.
   */
  ordem?: "aderencia" | "data";
  /**
   * Agrupa, na lista mostrada, os acórdãos do mesmo tribunal, órgão e relator com a mesma ementa inteira (padrão: sim).
   * Só muda a apresentação: com `false`, a lista sai como antes.
   */
  agrupar?: boolean;
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
  /** Só quando o site não mandou órgão, data ou link do acórdão: quais faltam. */
  faltam?: CampoAusente[];
  /** Só quando o site mandou, no lugar do link, um endereço que não é página do tribunal: o aviso da busca direta. */
  avisoDeLink?: string;
  /** Só quando a busca inclui TRT: a fonte do acórdão ("Falcão (CSJT)" ou "JurisprudênciaIA"); o rótulo vem em fontes. */
  fonte?: string;
  /** Só no primeiro de uma série: os demais com a mesma ementa inteira, todos acessíveis pelo id. */
  mesmaEmenta?: SerieDeMesmaEmenta;
}

/** Os outros acórdãos de uma série. Diz só o critério; não afirma mesma tese nem mesmo resultado. */
export interface SerieDeMesmaEmenta {
  criterio: typeof CRITERIO_DA_SERIE;
  /** Acórdãos da série, contando o do próprio item. */
  quantidade: number;
  /** Menor e maior data de julgamento da série (dos que têm data). */
  periodo?: string;
  /** Ids dos demais acórdãos da série (o do próprio item é o `id` dele); servem para obter_ementa e inteiro teor. */
  ids: string[];
}

/** Por que uma busca não deu resposta: vocabulário fechado, uma palavra, derivado do tipo de erro do cliente. */
export type MotivoDeFalha = "recusa" | "pausa" | "rede-parada" | "tempo-esgotado" | "formato-inesperado" | "erro-de-rede" | "nao-executada";

/** Começo fixo da mensagem do cliente (src/cliente.ts) para a chamada que não saiu porque a pausa do serviço já valia. */
const CHAMADA_NAO_FEITA = "Esta chamada não foi feita";

/** Começo fixo da mensagem do cliente (src/cliente.ts) quando a rede não chegou ao site. */
const SEM_REDE = "Não foi possível falar com";

/**
 * O motivo certo de cada tipo de erro do cliente; erro de outro tipo (ex.: HTTP 4xx) fica sem motivo: o vocabulário
 * é fechado e não inventa. O prazo esgotado, a rede que não chegou ao site e a chamada que nem saiu (prova que
 * falhou sem recusa, espera estourada) não têm classe própria no cliente: são reconhecidos pela frase fixa dele.
 */
function motivoDoErro(e: unknown): MotivoDeFalha | undefined {
  if (e instanceof PausaPreventivaError) return "pausa";
  // Recusa com pausa: a que acabou de abrir a pausa é recusa; a chamada que nem saiu porque a pausa já valia é pausa.
  if (e instanceof RecusaError) return e.pausa && e.message.startsWith(CHAMADA_NAO_FEITA) ? "pausa" : "recusa";
  if (e instanceof RedeParadaError) return "rede-parada";
  if (e instanceof FormatoInesperadoError) return "formato-inesperado";
  if (e instanceof ErroHttp) return e.status >= 500 ? "erro-de-rede" : undefined;
  if (e instanceof Error && /não respondeu em \d+ s;/.test(e.message)) return "tempo-esgotado";
  if (e instanceof Error && e.message.startsWith(CHAMADA_NAO_FEITA)) return "pausa";
  if (e instanceof Error && e.message.startsWith(SEM_REDE)) return "erro-de-rede";
  return undefined;
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
   * Só quando alguma busca não deu resposta: quantas, por motivo (palavra fixa). Busca vazia nunca entra aqui; vazio
   * não é falha (ADR-0001). Os campos acima continuam dizendo o mesmo em números.
   */
  motivos?: Partial<Record<MotivoDeFalha, number>>;
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
  /** Só com filtro de relator ou órgão e até 3 acórdãos achados: pode ser a grafia do nome; nunca diz que não há julgado. */
  ressalvaDaGrafia?: string;
  /** Só quando o filtro local tirou todos os acórdãos achados: o motivo da lista vazia. */
  filtroLocal?: string;
  /** Só quando o teto de páginas do Falcão deixou combinações formulação × TRT sem executar. */
  tetoDoFalcao?: string;
  /** Só quando o pedido usou o agrupador "trt": o custo em páginas do Falcão e o que ficou para repetir. */
  agrupadorTrt?: string;
}

export interface ResultadoAmplo {
  /** Só em busca grande que vai ao site: quantas chamadas ("até": é teto de verdade) e o tempo ("cerca de": estimativa que pode passar). */
  estimativa?: string;
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
/** A estimativa só aparece com mais de 6 chamadas ao site (a de 6 com 50 acórdãos de campos longos já beira o teto); abaixo disso não há o que avisar. */
const CHAMADAS_PARA_ESTIMAR = 7;
/** Tempo por rodada de 2 chamadas simultâneas: número de partida, não medido (pico ~7 s por busca, prazo 120 s, Retry-After até 30 s, vagas divididas com outras janelas); por isso a estimativa diz "cerca de", nunca "até". */
const SEGUNDOS_POR_RODADA = 3;

/**
 * Uma linha: chamadas que vão ao site (as guardadas não entram) e o tempo. O intervalo de 1 s por chamada ao Falcão
 * (src/cliente.ts) cabe dentro da rodada de 3 s para 2 chamadas, então não muda a conta.
 */
function estimar(chamadas: number): string | undefined {
  if (chamadas < CHAMADAS_PARA_ESTIMAR) return undefined;
  const segundos = Math.ceil(chamadas / 2) * SEGUNDOS_POR_RODADA;
  return (
    `Estimativa: até ${chamadas} chamadas (2 por vez), cerca de ${segundos} s (pode passar: espera do site, 429/503, outras janelas); busca guardada reduz.`
  );
}

/** Acórdãos por busca num TRT na busca ampla: 1 página do Falcão. */
const LIMITE_TRT_NA_AMPLA = 10;

/** O campo semEmenta só vai quando há acórdão sem ementa para conferir (a resposta beira o teto de 25 mil caracteres). */
const semEmentaDoTribunal = (n: number) => (n ? { semEmenta: n } : {});

/** O agrupador "trt" vale por trt1 a trt24, no lugar em que foi pedido e sem repetir TRT já pedido pelo nome. */
export const AGRUPADOR_TRT = "trt";

export function expandirAgrupadorTrt(tribunais: string[]): string[] {
  if (!tribunais.some((t) => t.toLowerCase() === AGRUPADOR_TRT)) return tribunais;
  const nomeados = new Set(tribunais.map((t) => t.toLowerCase()));
  const vistos = new Set<string>();
  return tribunais
    .flatMap((t) => (t.toLowerCase() === AGRUPADOR_TRT ? TRTS.filter((x) => !nomeados.has(x)) : [t]))
    .filter((t) => {
      if (!ehDoFalcao(t)) return true;
      const sigla = t.toLowerCase();
      if (vistos.has(sigla)) return false;
      vistos.add(sigla);
      return true;
    });
}

export async function buscaAmpla(
  cliente: Cliente,
  pedido: ParametrosAmpla,
  memoria?: Memoria,
  {
    tabela,
    tabelaStf,
    falcao,
    acrescimos,
  }: {
    tabela?: TabelaDePrecedentes;
    tabelaStf?: TabelaDoStf;
    falcao?: Cliente;
    /** Campos que quem chama põe na resposta final: entram na medida do teto, que vale para o texto inteiro. */
    acrescimos?: (r: ResultadoAmplo) => object;
  } = {},
): Promise<ResultadoAmplo> {
  const p = { ...pedido, tribunais: expandirAgrupadorTrt(pedido.tribunais) };
  const comAgrupador = pedido.tribunais.some((t) => t.toLowerCase() === AGRUPADOR_TRT);
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
      /** Motivo da busca com erro, derivado do tipo do erro; sem ele, o erro não é de nenhum tipo conhecido. */
      codigo: undefined as MotivoDeFalha | undefined,
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
  // Para a ressalva da grafia: registros recebidos somando as buscas (antes de juntar equivalentes) e se alguma veio
  // cheia (tantos quanto o limite efetivo dela): lista cheia é explicada pelo limite, não pelo filtro.
  let recebidos = 0;
  let algumaCheia = false;
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
    recebidos += r.acordaos.length;
    if (r.acordaos.length >= (parametros(t).limite ?? 100)) algumaCheia = true;
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
            lerBuscaGuardada(memoria, parametros(t), { tabela, tabelaStf }).catch((e) => {
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
        t.resposta = await buscaDiretaSemMarca(cliente, parametros(t), memoria, {
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
        t.codigo = motivoDoErro(e);
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
  // tese" (ADR-0001). A mensagem de recusa vai junto, com o "espere e tente de novo"; a recusa e a pausa originais
  // vão em `cause`, para a marca de pausa do servidor.
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
      { cause: [recusa, pausaDoFalcao].filter((x) => x !== undefined) },
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
  // Entre cópias equivalentes, o acórdão mostrado é o que tem texto integral real (como na busca do Falcão); a outra
  // cópia segue alcançável pelo próprio id, com o texto dela.
  const porIdDaCopia = new Map([...juntos.values()].map((o) => [o.registro.id, o.registro]));
  for (const j of juncao.acordaos) {
    if (!j.registro.motivoSemTextoIntegral) continue;
    const comTexto = j.ids.map((id) => porIdDaCopia.get(id)).find((r) => r && !r.motivoSemTextoIntegral);
    if (comTexto) j.registro = comTexto;
  }
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
  const tamanho = p.tamanhoTrecho ?? 110;
  const cabecalho: CabecalhoDeCobertura = {
    porTribunal: [...porTribunal].map(([tribunal, { planejadas, guardadas, maisAntiga, ...contas }]) => {
      const doTribunal = tarefas.filter((t) => t.tribunal === tribunal);
      const foraDoTeto = doTribunal.filter((t) => t.naoExecutada === "teto").length;
      const pausaPreventiva = doTribunal.filter((t) => t.naoExecutada === "pausa").length;
      const motivos: Partial<Record<MotivoDeFalha, number>> = {};
      for (const t of doTribunal) {
        // Sem resposta e sem nunca ter saído da fila (a recusa parou a busca) = não executada.
        const m = t.resposta ? undefined : motivoDaTarefa(t);
        if (m) motivos[m] = (motivos[m] ?? 0) + 1;
      }
      const naoFeitas = planejadas - contas.buscasFeitas - contas.comErro - foraDoTeto - pausaPreventiva;
      const linha: CoberturaTribunal = {
        tribunal,
        ...contas,
        ...(naoFeitas ? { naoFeitas } : {}),
        ...(foraDoTeto ? { foraDoTeto } : {}),
        ...(pausaPreventiva ? { pausaPreventiva } : {}),
        ...(Object.keys(motivos).length ? { motivos } : {}),
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
  if (comAgrupador) {
    const feitasAgora = doFalcao.filter((t) => t.resposta).length;
    const pausadas = doFalcao.filter((t) => t.naoExecutada === "pausa").length;
    const semResposta = doFalcao.length - feitasAgora - foraDoTeto - pausadas;
    cabecalho.agrupadorTrt =
      `Agrupador "trt": ${TRTS.length} TRTs (trt1 a trt${TRTS.length}). Esta chamada recebeu ${feitasAgora} páginas novas do Falcão (teto de ${PAGINAS_DO_FALCAO_POR_CHAMADA} páginas) ` +
      `(as buscas guardadas não gastam página); ${foraDoTeto} buscas (formulação × TRT) ficaram foraDoTeto${foraDoTeto ? ": repita a mesma busca para executar as próximas (as já feitas voltam da memória)" : ""}. ` +
      `${pausadas} buscas não executadas por pausa preventiva; ${semResposta} buscas sem resposta (erro ou parada por recusa). ` +
      `Cobrir uma página por TRT e formulação exige ${TRTS.length * p.formulacoes.length} chamadas sem memória nem novas tentativas; ` +
      `novas tentativas também contam no teto diário próprio do Garimpo de ${TETO_DIARIO_DO_FALCAO} chamadas.`;
  }
  // Lista vazia por causa do filtro diz isso com todas as letras: não se lê como "os tribunais nunca decidiram".
  if (ordenados.length && !sobreviventes.length) {
    cabecalho.filtroLocal =
      `Nenhum dos ${ordenados.length} acórdãos achados passou pelo filtro local (${excluidos.size} excluídos pelo ` +
      `filtro; ${semEmenta.size} sem ementa para conferir): a lista está vazia por causa do filtro, não por falta de ` +
      "acórdãos achados; afrouxe ou retire o filtro local.";
  }
  const grafia = algumaCheia ? undefined : ressalvaSePoucos(nomesDoFiltro(p), recebidos);
  if (grafia) cabecalho.ressalvaDaGrafia = grafia;
  // Com filtro local, conta só os que passaram por ele: o que o filtro tirou não é lista cortada.
  if (mostrados.length < sobreviventes.length) {
    // "Limite não é amostra" entra no lugar de palavras antigas: a resposta com 50 acórdãos já beira o teto de 25 mil.
    cabecalho.listaCortada =
      `mostrando ${mostrados.length} de ${sobreviventes.length}; limite não é amostra (os primeiros por aderência, não um retrato do todo); ` +
      (maximo < 200 ? "peça maximo maior (até 200)" : "200 é o máximo por resposta");
  }
  // Uma vez, nunca por item: o recorrido achado e cortado da lista (ou filtrado) não está ausente.
  const recorrido = avisoDeRecorridoAusenteAmplo(
    mostrados.map((x) => x.acordao),
    ordenados.map((x) => x.acordao),
  );
  if (recorrido) avisos.push(recorrido);
  const estimativa = estimar(noSite.length);
  const itemDe = ({ acordao: a, formulacoes }: (typeof mostrados)[number], tamanhoDoTrecho: number): ItemAmplo => {
    const ementa = a.ementa.replace(/^\s*ementa\b\s*[:.\-–—]?\s*/i, "");
    const faltam = camposAusentes(a);
    const item: ItemAmplo = {
      id: a.id,
      numero: a.numero,
      tribunal: a.tribunal,
      data: a.dataJulgamento,
      orgao: a.orgao,
      trecho: trecho(ementa, p.formulacoes, tamanhoDoTrecho),
      link: a.link ?? a.linkConsulta,
      formulacoes,
      ...(faltam.length && { faltam }),
      ...(a.avisoDeLink && { avisoDeLink: a.avisoDeLink }),
      ...(comTrt && { fonte: infoTribunal(a.tribunal)?.fonte }),
    };
    if (!ementa.trim() && ehDoFalcao(a.tribunal)) item.trecho = "sem ementa no Falcão";
    return item;
  };
  const resultado: ResultadoAmplo = {
    ...(estimativa && { estimativa }),
    buscasFeitas: feitas,
    buscasPlanejadas: tarefas.length,
    completa: !recusa && !pausaDoFalcao && feitas === tarefas.length,
    totalAcordaos: ordenados.length,
    mostrados: mostrados.length,
    cabecalhoDeCobertura: cabecalho,
    acordaos: [],
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
  // Ordem por data só depois da escolha e do corte pela aderência (inclusive o do teto): muda a apresentação, nunca
  // quem entra na lista.
  const ordenar = (lista: typeof mostrados) =>
    p.ordem === "data" ? ordenarPorData(lista, (x) => x.acordao.dataJulgamento) : { itens: lista, semData: 0 };
  const agrupar = p.agrupar !== false;
  return ajustarAoTeto(resultado, mostrados, ordenar, itemDe, tamanho, sobreviventes.length, acrescimos, ({ acordao: a }) => a, agrupar);
}

function serieDe<T>(principal: T, outros: T[], paraAcordao: (x: T) => Acordao): SerieDeMesmaEmenta {
  const todos = [principal, ...outros].map(paraAcordao);
  const datas = todos.flatMap((a) => (a.dataJulgamento ? [a.dataJulgamento.slice(0, 10)] : [])).sort();
  return {
    criterio: CRITERIO_DA_SERIE,
    quantidade: todos.length,
    ...(datas.length && { periodo: datas[0] === datas[datas.length - 1] ? datas[0] : `${datas[0]} a ${datas[datas.length - 1]}` }),
    ids: todos.slice(1).map((a) => a.id),
  };
}

/** Motivo de uma busca que não deu resposta (nunca chamada para busca vazia, que deu resposta). */
function motivoDaTarefa(t: { naoExecutada?: "teto" | "pausa"; motivo?: string; codigo?: MotivoDeFalha }): MotivoDeFalha | undefined {
  if (t.naoExecutada === "teto") return "nao-executada";
  if (t.naoExecutada === "pausa") return "pausa";
  return t.motivo === undefined ? "nao-executada" : t.codigo;
}

/** Por que a busca não saiu, na resposta de erro da falha total. */
function motivoDaNaoFeita(naoExecutada: "teto" | "pausa" | undefined): string {
  if (naoExecutada === "teto") return `não executada (teto de ${PAGINAS_DO_FALCAO_POR_CHAMADA} páginas do Falcão por chamada)`;
  if (naoExecutada === "pausa") return "não executada (pausa preventiva do Falcão)";
  return "não feita (a busca parou na recusa)";
}

/** Teto de caracteres da resposta inteira (JSON final): avisos, cobertura e qualificados contam, não só os itens. */
const TETO_DA_RESPOSTA = 25_000;
/** Menor trecho a que o teto reduz antes de começar a tirar itens. */
const TRECHO_MINIMO = 40;

/**
 * Faz a resposta caber no teto: primeiro encurta os trechos, depois tira itens do fim da lista (os de menor
 * aderência) e diz o corte e como pedir o resto. Abaixo do teto, a resposta sai como veio.
 */
function ajustarAoTeto<T>(
  r: ResultadoAmplo,
  apresentados: readonly T[],
  ordenar: (lista: T[]) => { itens: T[]; semData: number },
  itemDe: (x: T, tamanho: number) => ItemAmplo,
  tamanho: number,
  sobreviventes: number,
  acrescimos: ((r: ResultadoAmplo) => object) | undefined,
  paraAcordao: (x: T) => Acordao,
  agrupar = false,
): ResultadoAmplo {
  const avisosBase = r.avisos;
  const listaBase = r.cabecalhoDeCobertura.listaCortada;
  const mostradosBase = r.cabecalhoDeCobertura.porTribunal.map((l) => l.mostrados);
  const montar = (tam: number, n: number, medindo = false, agruparLista = agrupar): ResultadoAmplo => {
    // O corte pega os n de maior aderência; só então a ordem de apresentação (data) se aplica aos que ficam.
    const porOrdem = ordenar(apresentados.slice(0, n));
    // Séries de mesma ementa só depois do corte e da ordem: o grupo fica onde está o primeiro dele.
    const grupos = agruparLista
      ? agruparEmSerie(porOrdem.itens.map((x) => ({ x, ...paraAcordao(x) }))).map((g) => ({
          principal: g.principal.x,
          outros: g.outros.map((o) => o.x),
        }))
      : porOrdem.itens.map((x) => ({ principal: x, outros: [] as T[] }));
    const itens = grupos.map((g) => {
      const item = itemDe(g.principal, tam);
      return g.outros.length ? { ...item, mesmaEmenta: serieDe(g.principal, g.outros, paraAcordao) } : item;
    });
    const semData =
      medindo || porOrdem.semData === 0
        ? []
        : [
            porOrdem.semData === 1
              ? "Ordem por data: 1 acórdão sem data foi para o fim da lista."
              : `Ordem por data: ${porOrdem.semData} acórdãos sem data foram para o fim da lista.`,
          ];
    // Decidido depois do corte: só avisa se algum acórdão do TJGO ficou na lista. Parte do acórdão de origem,
    // porque o item da lista não leva o número CNJ.
    const linkTjgo = avisoDeLinkDoTjgo(porOrdem.itens.map(paraAcordao));
    // Conta acórdãos, não linhas: os agrupados continuam mostrados.
    const porTribunal = r.cabecalhoDeCobertura.porTribunal.map((l, i) =>
      mostradosBase[i] === undefined
        ? l
        : { ...l, mostrados: porOrdem.itens.filter((x) => paraAcordao(x).tribunal === l.tribunal).length },
    );
    const emSerie = grupos.filter((g) => g.outros.length);
    const avisoDaSerie = emSerie.length
      ? [
          `Agrupados por ${CRITERIO_DA_SERIE} (texto idêntico, mesmo tribunal, órgão e relator): ${emSerie.length} ` +
            `${emSerie.length === 1 ? "grupo reúne" : "grupos reúnem"} ${emSerie.reduce((n, g) => n + 1 + g.outros.length, 0)} ` +
            "acórdãos; os ids dos demais vêm em mesmaEmenta. Não significa mesma tese nem mesmo resultado; " +
            "agrupar=false lista cada acórdão.",
        ]
      : [];
    const cortada = n < apresentados.length;
    const listaCortada = cortada
      ? `mostrando ${n} de ${sobreviventes}; resposta limitada a cerca de ${TETO_DA_RESPOSTA / 1000} mil caracteres; ` +
        "para ver o resto, repita com menos tribunais ou formulações por chamada (as buscas já feitas voltam da memória)"
      : listaBase;
    return {
      ...r,
      mostrados: n,
      acordaos: itens,
      cabecalhoDeCobertura: { ...r.cabecalhoDeCobertura, porTribunal, ...(listaCortada && { listaCortada }) },
      avisos: tam < tamanho ? [...avisosBase, ...semData, ...linkTjgo, ...avisoDaSerie, `Trechos encurtados para ${tam} caracteres para a resposta caber em ${TETO_DA_RESPOSTA / 1000} mil caracteres.`] : [...avisosBase, ...semData, ...linkTjgo, ...avisoDaSerie],
    };
  };
  // Mede o texto final: os campos que o servidor acrescenta (tabelas, aviso de natureza jurídica) contam.
  // O corte é decidido uma vez, igual nas duas ordens: mede-se sem o aviso de datas ausentes e reserva-se o espaço
  // do pior caso dele (todos os acórdãos sem data), que nunca é excedido — assim a ordem não muda quem entra.
  const reservaDoAviso = JSON.stringify(
    `Ordem por data: ${apresentados.length} acórdãos sem data foram para o fim da lista.`,
  ).length + 1;
  const cabe = (tam: number, n: number) => {
    const x = montar(tam, n, true, false);
    return JSON.stringify({ ...x, ...acrescimos?.(x) }).length + reservaDoAviso <= TETO_DA_RESPOSTA;
  };
  // O agrupamento não participa da seleção nem do corte pelo teto. Se os campos da série fizerem a resposta
  // crescer além do teto (grupos pequenos), preserva-se a lista individual, sem tirar nenhum acórdão.
  const finalizar = (tam: number, n: number) => {
    const x = montar(tam, n);
    return JSON.stringify({ ...x, ...acrescimos?.(x) }).length + reservaDoAviso <= TETO_DA_RESPOSTA
      ? x
      : montar(tam, n, false, false);
  };
  if (cabe(tamanho, apresentados.length)) return finalizar(tamanho, apresentados.length);
  for (const tam of [80, 60, TRECHO_MINIMO].filter((t) => t < tamanho)) {
    if (cabe(tam, apresentados.length)) return finalizar(tam, apresentados.length);
  }
  const tam = Math.min(tamanho, TRECHO_MINIMO);
  let [baixo, alto] = [0, apresentados.length - 1];
  while (baixo < alto) {
    const meio = Math.ceil((baixo + alto) / 2);
    if (cabe(tam, meio)) baixo = meio;
    else alto = meio - 1;
  }
  return finalizar(tam, baixo);
}
