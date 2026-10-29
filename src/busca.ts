/**
 * Busca direta: uma consulta à base do JurisprudênciaIA, num tribunal (os TRTs vão ao Falcão, em falcao.ts).
 * Normaliza a resposta (acórdãos e precedentes qualificados em listas separadas).
 */

import { createHash } from "node:crypto";
import { Cliente, FormatoInesperadoError } from "./cliente.js";
import {
  avisoDeClasse,
  duvidaDaClasse,
  type Enquadramento927,
  enquadrarAcordao,
  enquadrarQualificado,
  type ParadigmaDoSite,
} from "./enquadramento.js";
import { reforcoDaTabela, type TabelaDePrecedentes } from "./tabelaDePrecedentes.js";
import { reforcoDoStf, type TabelaDoStf } from "./tabelaDoStf.js";
import { juntarEquivalentes } from "./equivalencia.js";
import { limparEmenta } from "./ementaLimpa.js";
import { nomesDoFiltro, ressalvaSePoucos } from "./grafia.js";
import { FalhaNaMemoriaError, fotografiaDaBusca, type Memoria } from "./memoria.js";
import { buscaDecisoesNoFalcao, buscaNoFalcao, clienteDoFalcao, lerBuscaGuardadaNoFalcao, type OrdenacaoNoFalcao } from "./falcao.js";
import { avisoDeRecorridoAusente } from "./recorrido.js";
import { buscaNaTnu, clienteDaTnu, lerBuscaGuardadaNaTnu } from "./tnu.js";
import { buscaNoTrf2, clienteDoTrf2, lerBuscaGuardadaNoTrf2 } from "./trf2.js";
import { buscaNoTrf4, clienteDoTrf4, lerBuscaGuardadaNoTrf4 } from "./trf4.js";
import {
  avisoDeLinkDoTjgo,
  comLinkDoProcessoNoTjgo,
  ehDoFalcao,
  ehDoTnu,
  ehDoTrf2,
  ehDoTrf4,
  infoTribunal,
  linkDoProcessoNoTjgo,
  ROTULO_FALCAO,
} from "./tribunais.js";

export const SITE = "https://www.jurisprudenciaia.com.br";

export interface Acordao {
  /** Id composto "tribunal:id", usado para pedir a ementa inteira ou o inteiro teor. */
  id: string;
  tribunal: string;
  numero: string;
  /** O site não trouxe número de processo: o `numero` é só o id do site. */
  semNumero: boolean;
  numeroCnj?: string;
  /** A classe como o site informa, nunca trocada; o avisoDeClasse diz quando os próprios dados a põem em dúvida. */
  classe?: string;
  /** Só quando o campo de classe traz nome de órgão ou a ementa nomeia outra classe (enquadramento.ts): o aviso. */
  avisoDeClasse?: string;
  relator?: string;
  orgao?: string;
  dataJulgamento?: string;
  dataPublicacao?: string;
  /** Só no Falcão: data de juntada do acórdão aos autos ("juntado em"), que não é data de publicação. */
  dataJuntada?: string;
  ementa: string;
  /** Link do PDF do inteiro teor (link_pdf); no TJGO com número CNJ, a página pública do processo no Projudi. */
  link?: string;
  /** Página oficial de consulta do processo/acórdão (link_consulta, url_acordao ou, no TJPA, link_processo), quando há. */
  linkConsulta?: string;
  /**
   * Só quando a ementa parece ter vindo cortada do site (heurística), quando o campo da base trazia mais que a ementa e
   * vai só o trecho dela (ementaLimpa.ts), ou, no Falcão, quando não veio ("sem ementa no Falcão") ou diverge do
   * possuiEmenta: o aviso. O texto da ementa nunca é reescrito: é sempre um trecho contínuo do campo do site.
   */
  avisoDeEmenta?: string;
  /**
   * A ementa não se separou com segurança do resto do campo da base: `ementa` é só o começo e pode ter texto do
   * relatório ou do voto. A conferência de citação nunca diz «na ementa» por esse texto.
   */
  ementaIncerta?: true;
  /** Posto na junção quando as cópias juntadas trazem datas de julgamento diferentes (equivalencia.ts). */
  avisoDeData?: string;
  /** Só no Falcão: o rótulo da fonte (repositório oficial da Justiça do Trabalho). */
  fonte?: string;
  /** Só no Falcão: por que não há texto integral (ex.: o "texto integral" veio igual à ementa); só a ementa vale. */
  motivoSemTextoIntegral?: string;
  /** Só no TJGO: o Id_Arquivo do link_pdf do site, que é o arquivo «Ementa» do julgamento no Projudi (ADR-0029). */
  idArquivoProjudi?: string;
  /** Só quando o site mandou, no lugar do link, algo que não é endereço do tribunal (`data:`, `gs://`…): o aviso. */
  avisoDeLink?: string;
  /** Link oficial que o Garimpo pediu à rota de link do site, porque a busca não trouxe nenhum (obter_inteiro_teor). */
  linkDaRota?: string;
  relevancia?: number;
  /** Só quando o site não mandou algo: quais campos faltam (vocabulário fixo). Ausente = nada falta. */
  faltam?: CampoAusente[];
  /** Inciso do art. 927 do CPC em que o acórdão se encaixa, com a prova nos dados; ou "não classificado", com o motivo. */
  enquadramento927: Enquadramento927;
}

/** Campos que o Garimpo diz que faltam: a ementa cortada já tem o avisoDeEmenta. */
export type CampoAusente = "orgao" | "data" | "link";

/**
 * O que o site não mandou, na ordem fixa orgao, data, link (a página de consulta vale como link); vazio = nada falta.
 * O acórdão do Falcão nunca tem link por desenho (a fonte não oferece), então a falta dele não é lacuna a avisar.
 */
export function camposAusentes(
  a: Pick<Acordao, "orgao" | "dataJulgamento" | "link" | "linkConsulta" | "fonte">,
): CampoAusente[] {
  const faltam: CampoAusente[] = [];
  if (!a.orgao) faltam.push("orgao");
  if (!a.dataJulgamento) faltam.push("data");
  if (!a.link && !a.linkConsulta && a.fonte !== ROTULO_FALCAO) faltam.push("link");
  return faltam;
}

/** O acórdão com `faltam` só quando falta algo; completo volta o mesmo objeto, sem campo novo. */
function comFaltam(a: Acordao): Acordao {
  const faltam = camposAusentes(a);
  return faltam.length ? { ...a, faltam } : a;
}

export interface Qualificado {
  tipo: string;
  numero?: string;
  texto: string;
  orgao?: string;
  processoParadigma?: string;
  link?: string;
  /** Só na coleção `precedentes` do Falcão: a questão submetida, que não é tese. */
  questao?: string;
  /** Só na coleção `precedentes` do Falcão: a situação como a fonte informa, com a data, ou "não verificado". Nunca vigência. */
  situacaoNaFonte?: string;
  /** Inciso do art. 927 do CPC com a prova nos dados, ou "não classificado", com o motivo: o rótulo da lista não basta. */
  enquadramento927: Enquadramento927;
}

/** Coleções do Falcão que não são de acórdãos, pedidas pela opção `decisoes`. */
export type ColecaoDeDecisoes = "monocraticas" | "sentencas";

/** Decisão monocrática ou sentença do Falcão: só metadados, nunca o texto. Não é acórdão nem precedente do art. 927. */
export interface DecisaoDoFalcao {
  /** "tribunal:coleção:id", só para conferir; o Garimpo não tem rota para ler o texto dessas decisões. */
  id: string;
  tipo: "decisão monocrática" | "sentença";
  tribunal: string;
  numero: string;
  numeroCnj?: string;
  classe?: string;
  orgao?: string;
  redator?: string;
  dataJulgamento?: string;
  dataJuntada?: string;
  origem?: string;
  /** Sempre: o que a decisão não é. */
  natureza: string;
}

export interface ResultadoBusca {
  /** Só na busca guardada: veio da memória, como fotografia da busca feita no site na data e hora ditas aqui. */
  buscaGuardada?: string;
  tribunal: string;
  /** Só no Falcão: o rótulo da fonte. */
  fonte?: string;
  /** Só no Falcão: a ordem em que a fonte devolveu a lista (a pedida; sem pedido, "relevancia"). */
  ordenacao?: OrdenacaoNoFalcao;
  /** Só no Falcão, e só quando pedido: a busca olhou apenas as ementas. */
  somenteEmentas?: true;
  /** Cabeçalho de cobertura: se veio o número pedido (pode haver mais) ou menos (a base não tem mais). */
  cabecalhoDeCobertura?: string;
  acordaos: Acordao[];
  qualificados: Qualificado[];
  /** Vai junto da lista de precedentes qualificados: o rótulo da lista é do site, não do art. 927. */
  ressalvaQualificados: string;
  /** Só com a opção `decisoes` (Falcão): as decisões monocráticas ou sentenças, em vez de acórdãos. */
  decisoes?: DecisaoDoFalcao[];
  /** Só com a opção `decisoes`: o que essas decisões não são e o que a lista não traz. */
  ressalvaDecisoes?: string;
  avisos: string[];
}

/** Começo da ressalva que vai junto de toda lista de precedentes qualificados; o fim diz onde está o enquadramento. */
export const RESSALVA_ROTULO =
  '"Precedente qualificado" é o rótulo da lista do site: não comprova enquadramento, vigência nem aplicabilidade. ';

export interface FiltrosBusca {
  de?: string;
  ate?: string;
  relator?: string;
  orgao?: string;
  classe?: string;
}

export interface ParametrosBusca extends FiltrosBusca {
  tribunal: string;
  texto: string;
  limite?: number;
  /** Só nos TRTs (Falcão): pesquisar apenas nas ementas. */
  somenteEmentas?: boolean;
  /** Só nos TRTs (Falcão): a ordem da lista; sem pedido, a relevância da fonte. */
  ordenacao?: OrdenacaoNoFalcao;
  /** Só nos TRTs (Falcão): também a coleção `precedentes` do mesmo TRT (1 chamada a mais). */
  precedentes?: boolean;
  /** Só nos TRTs (Falcão): em vez de acórdãos, a 1ª página de decisões monocráticas ou de sentenças (só metadados). */
  decisoes?: ColecaoDeDecisoes;
}

/** Listas de precedentes qualificados que o site devolve, com o rótulo mostrado ao usuário. */
const LISTAS_QUALIFICADOS: Record<string, string> = {
  repetitivos: "tema repetitivo",
  sumulas: "súmula",
  sumulas_vinc: "súmula vinculante",
  rg: "repercussão geral",
  rg_results: "repercussão geral",
  puil: "PUIL",
  iacs: "IAC",
  irrs: "IRR",
  ojs: "OJ",
};

const LISTAS_ACORDAOS = ["results", "juris"];

const RESSALVA_DIRETA = `${RESSALVA_ROTULO}O enquadramento legal vem em enquadramento927, com a evidência ou o motivo.`;

export interface OpcoesBuscaDireta {
  /** Ignora a busca guardada e vai ao site, pelo freio e pelo disjuntor; se falhar, é erro (a guardada fica intacta). */
  renovar?: boolean;
  /** Falso na busca ampla, que guarda os acórdãos depois de juntar as cópias de todas as buscas. */
  guardarAcordaos?: boolean;
  /** Tabela de precedentes do STJ que reforça o enquadramento dos temas e IAC do STJ; sem ela, a regra sem a tabela. */
  tabela?: TabelaDePrecedentes;
  /** Tabela do STF que reforça a situação de repercussão geral, súmula e súmula vinculante do STF. */
  tabelaStf?: TabelaDoStf;
  /** Cliente do Falcão, para os TRTs (padrão: um novo, com os mesmos freios compartilhados). */
  falcao?: Cliente;
  /** Cliente do e-Proc (TRF2, TRF4 ou TNU; padrão: um novo da fonte do pedido, com os mesmos freios compartilhados). */
  eproc?: Cliente;
}

/** O pedido ao site: tudo o que afeta a resposta, na mesma ordem sempre (a chave da busca guardada sai daqui). */
function pedido(p: ParametrosBusca) {
  const tribunal = p.tribunal.toLowerCase();
  const info = infoTribunal(tribunal);
  if (!info) throw new Error(`Tribunal "${p.tribunal}" não é coberto pela busca direta. Use listar_tribunais.`);

  const corpo: Record<string, unknown> = {
    query: p.texto,
    limit: Math.min(Math.max(p.limite ?? 10, 1), 100),
    vector_mode: "auto",
    ...info.extrasBusca,
  };
  if (p.de) corpo.from = p.de;
  if (p.ate) corpo.to = p.ate;
  if (p.relator) corpo.relator = p.relator;
  if (p.orgao) corpo.orgao = p.orgao;
  if (p.classe) corpo.classe = p.classe;
  const filtrada = [p.de, p.ate, p.relator, p.orgao, p.classe].some(Boolean);
  /** O cabeçalho de cobertura, a partir dos registros que o site devolveu (antes de juntar cópias). */
  const nomes = nomesDoFiltro(p);
  const cobertura = (vieram: number) => linhaDeCobertura(vieram, corpo.limit as number, info.tetoResultados, filtrada, nomes);
  // sha256 do tribunal e do corpo: o texto da busca e os filtros nunca vão em claro para o disco.
  const chave = createHash("sha256").update(JSON.stringify([tribunal, corpo])).digest("hex");
  return { tribunal, corpo, chave, cobertura };
}

/** A busca guardada para estes parâmetros, se houver uma válida; nenhuma chamada ao site. */
export async function lerBuscaGuardada(
  memoria: Memoria,
  p: ParametrosBusca,
  { tabela, tabelaStf }: Pick<OpcoesBuscaDireta, "tabela" | "tabelaStf"> = {},
): Promise<{ resultado: ResultadoBusca; obtidoEm: number } | undefined> {
  if (ehDoFalcao(p.tribunal)) return lerBuscaGuardadaNoFalcao(memoria, p);
  if (ehDoTrf2(p.tribunal)) return lerBuscaGuardadaNoTrf2(memoria, p);
  if (ehDoTrf4(p.tribunal)) return lerBuscaGuardadaNoTrf4(memoria, p);
  if (ehDoTnu(p.tribunal)) return lerBuscaGuardadaNaTnu(memoria, p);
  const { tribunal, chave, cobertura } = pedido(p);
  const guardada = await memoria.obterBusca(chave);
  // Sem as teses do site (gravada antes delas), o enquadramento não pode ser refeito com as tabelas desta janela: vale como ausente.
  if (!guardada?.busca.tesesDoSite) return undefined;
  const { busca, obtidoEm } = guardada;
  const tesesDoSite = busca.tesesDoSite!;
  return {
    obtidoEm,
    resultado: {
      buscaGuardada:
        `${fotografiaDaBusca(obtidoEm)}, devolvida pela memória do Garimpo sem nova chamada ao site; ` +
        "para dado novo, repita com renovar",
      tribunal,
      cabecalhoDeCobertura: cobertura(busca.registrosDoSite),
      acordaos: busca.acordaos.map((a) => comLinkDoProcessoNoTjgo(a.registro)),
      // O enquadramento é refeito com as tabelas desta janela, como na busca nova.
      qualificados: busca.qualificados.map((q, i) => ({
        ...q,
        enquadramento927: enquadrar(tribunal, q.tipo, q.numero, tesesDoSite[i] ?? undefined, tabela, tabelaStf),
      })),
      ressalvaQualificados: RESSALVA_DIRETA,
      avisos: [...busca.avisos],
    },
  };
}

/**
 * Com `memoria`, repetir a busca dentro da validade devolve a busca guardada, sem chamada; a resposta utilizável
 * (inclusive vazia) vai para a memória; erro e recusa, nunca.
 */
export async function buscaDireta(
  cliente: Cliente,
  p: ParametrosBusca,
  memoria?: Memoria,
  opcoes: OpcoesBuscaDireta = {},
): Promise<ResultadoBusca> {
  // A marca vale na resposta, nunca na memória: a busca guardada também a ganha, sem regravar nada.
  const r = await buscaDiretaSemMarca(cliente, p, memoria, opcoes);
  return { ...r, acordaos: r.acordaos.map(comFaltam) };
}

/** A busca sem a marca `faltam`: é o que vai para a memória; a busca_ampla marca só na montagem do item. */
export async function buscaDiretaSemMarca(
  cliente: Cliente,
  p: ParametrosBusca,
  memoria?: Memoria,
  { renovar = false, guardarAcordaos = true, tabela, tabelaStf, falcao, eproc }: OpcoesBuscaDireta = {},
): Promise<ResultadoBusca> {
  if (ehDoFalcao(p.tribunal)) {
    if (p.decisoes) return buscaDecisoesNoFalcao(falcao ?? clienteDoFalcao(), p);
    return buscaNoFalcao(falcao ?? clienteDoFalcao(), p, memoria, { renovar, guardarAcordaos });
  }
  if (ehDoTrf2(p.tribunal)) {
    return buscaNoTrf2(eproc ?? clienteDoTrf2(), p, memoria, { renovar, guardarAcordaos });
  }
  if (ehDoTrf4(p.tribunal)) {
    return buscaNoTrf4(eproc ?? clienteDoTrf4(), p, memoria, { renovar, guardarAcordaos });
  }
  if (ehDoTnu(p.tribunal)) {
    return buscaNaTnu(eproc ?? clienteDaTnu(), p, memoria, { renovar, guardarAcordaos });
  }
  const { tribunal, corpo, chave, cobertura } = pedido(p);
  // Falha ao ler a memória vira busca normal no site, com aviso; sem rede permitida, o erro da rede, como sempre.
  let falhaAoLer: string | undefined;
  if (memoria && !renovar) {
    try {
      const guardada = await lerBuscaGuardada(memoria, p, { tabela, tabelaStf });
      if (guardada) {
        const { acordaos, avisos } = guardada.resultado;
        avisos.push(...avisoDoRecorrido(acordaos), ...avisoDeLinkDoTjgo(acordaos), ...avisosDaMemoria(memoria));
        return guardada.resultado;
      }
    } catch (e) {
      if (!(e instanceof FalhaNaMemoriaError)) throw e;
      falhaAoLer = e.message;
    }
  }

  const resposta = await cliente.requisitar(`${SITE}/api/tribunais/${tribunal}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, Referer: `${SITE}/` },
    body: JSON.stringify(corpo),
  });
  let json: unknown;
  try {
    json = await resposta.json();
  } catch {
    throw new FormatoInesperadoError(`O JurisprudênciaIA devolveu algo que não é JSON na busca do ${tribunal.toUpperCase()}.`);
  }
  const resultado = normalizar(tribunal, json, tabela, tabelaStf);
  // Conta os registros que o site devolveu, antes de juntar cópias: a junção não diz nada sobre haver mais na base.
  const registrosDoSite = resultado.acordaos.length;
  // Cópias do mesmo acórdão na base do site viram um acórdão só (mesmo tribunal, data e ementa,
  // sem números de processo que se contradigam).
  const { acordaos } = juntarEquivalentes(
    resultado.acordaos.map((registro, posicao) => ({ registro, formulacoes: new Set<number>(), melhorPosicao: posicao })),
  );
  acordaos.sort((a, b) => a.melhorPosicao - b.melhorPosicao);
  if (guardarAcordaos) memoria?.lembrar(acordaos);
  resultado.acordaos = acordaos.map((a) => a.registro);
  if (tribunal === "stf") {
    resultado.avisos.push(
      "O site costuma devolver poucos acórdãos do STF por busca (de 2 a 7 na medição de out/2026). " +
        "Para mais, use outras formulações (busca_ampla).",
    );
  }
  memoria?.guardarBusca(chave, {
    registrosDoSite,
    acordaos: acordaos.map(({ ids, registro }) => ({ ids, registro })),
    qualificados: resultado.qualificados,
    tesesDoSite: resultado.tesesDoSite,
    avisos: [...resultado.avisos],
  });
  return {
    tribunal,
    cabecalhoDeCobertura: cobertura(registrosDoSite),
    acordaos: resultado.acordaos,
    qualificados: resultado.qualificados,
    ressalvaQualificados: resultado.ressalvaQualificados,
    // Depois de guardar: o aviso do recorrido e o da memória valem só para esta resposta.
    avisos: [
      ...resultado.avisos,
      ...avisoDoRecorrido(resultado.acordaos),
      ...avisoDeLinkDoTjgo(resultado.acordaos),
      ...avisosDaMemoria(memoria, falhaAoLer),
    ],
  };
}

/** O que a citação diz do acórdão: o número e, se houver, a data de julgamento e o órgão. */
export interface DadosCitados {
  numero: string;
  /** AAAA-MM-DD. */
  data?: string;
  orgao?: string;
}

export interface Divergencia {
  campo: "numero" | "data" | "orgao";
  informado: string;
  noRegistro: string;
}

export interface ConferenciaDoAcordao {
  estado: "confirmado" | "dados em conflito" | "não verificado";
  /** O registro achado, nos dados que a conferência compara (sem a ementa). */
  acordao?: Pick<Acordao, "id" | "tribunal" | "numero" | "numeroCnj" | "orgao" | "dataJulgamento" | "relator" | "link" | "linkConsulta">;
  divergencias: Divergencia[];
  /** Dado citado que o registro não trouxe: não dá para confirmar nem para contradizer. */
  naoConferidos: ("data" | "orgao")[];
  /** Só quando há mais de um acórdão com o mesmo número (recurso e embargos): os outros, para a pessoa escolher. */
  outrosComOMesmoNumero?: Pick<Acordao, "id" | "orgao" | "dataJulgamento">[];
}

/** Só os dígitos: "REsp 1.000.002/GO" e "1000002" são o mesmo número. */
const soDigitos = (s: string) => s.replace(/\D/g, "");
/** Minúsculas, sem acento e sem pontuação: "1ª Câmara Cível" ≈ "1a camara civel". */
const semForma = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Compara o que foi citado com os acórdãos de uma busca pelo número. Não achar o número é "não verificado", nunca
 * "inexistente" (ADR-0001). Com `acordaoDoId` (o acórdão que o id aponta, já na memória), o número também é comparado.
 */
export function conferirDadosDoAcordao(
  citado: DadosCitados,
  acordaos: readonly Acordao[],
  acordaoDoId?: Acordao,
): ConferenciaDoAcordao {
  const digitos = soDigitos(citado.numero);
  const bate = (a: Acordao) => !a.semNumero && !!digitos && [a.numero, a.numeroCnj].some((n) => n !== undefined && soDigitos(n) === digitos);
  if (acordaoDoId?.semNumero) return { estado: "não verificado", divergencias: [], naoConferidos: [] };
  const candidatos = acordaoDoId ? [acordaoDoId] : acordaos.filter(bate);
  const avaliar = (a: Acordao) => {
    const divergencias: Divergencia[] = [];
    const naoConferidos: ("data" | "orgao")[] = [];
    if (acordaoDoId && !bate(a)) divergencias.push({ campo: "numero", informado: citado.numero, noRegistro: a.numeroCnj ?? a.numero });
    if (citado.data !== undefined) {
      if (!a.dataJulgamento) naoConferidos.push("data");
      else if (a.dataJulgamento.slice(0, 10) !== citado.data) divergencias.push({ campo: "data", informado: citado.data, noRegistro: a.dataJulgamento.slice(0, 10) });
    }
    if (citado.orgao !== undefined) {
      const registro = a.orgao ? semForma(a.orgao) : "";
      const informado = semForma(citado.orgao);
      if (!registro) naoConferidos.push("orgao");
      else if (registro !== informado) divergencias.push({ campo: "orgao", informado: citado.orgao, noRegistro: a.orgao! });
    }
    return { a, divergencias, naoConferidos };
  };
  const avaliados = candidatos.map(avaliar).sort((x, y) =>
    x.divergencias.length - y.divergencias.length || x.naoConferidos.length - y.naoConferidos.length,
  );
  const melhor = avaliados[0];
  if (!melhor) return { estado: "não verificado", divergencias: [], naoConferidos: [] };
  const { a, divergencias, naoConferidos } = melhor;
  const outros = avaliados.slice(1).map(({ a: o }) => ({ id: o.id, orgao: o.orgao, dataJulgamento: o.dataJulgamento }));
  return {
    estado: divergencias.length ? "dados em conflito" : "confirmado",
    acordao: limpar({ id: a.id, tribunal: a.tribunal, numero: a.numero, numeroCnj: a.numeroCnj, orgao: a.orgao, dataJulgamento: a.dataJulgamento, relator: a.relator, link: a.link, linkConsulta: a.linkConsulta }),
    divergencias,
    naoConferidos,
    ...(outros.length && { outrosComOMesmoNumero: outros.map(limpar) }),
  };
}

/** Calculado a cada resposta, nunca guardado: a busca guardada devolvida não o repete. */
function avisoDoRecorrido(acordaos: Acordao[]): string[] {
  const aviso = avisoDeRecorridoAusente(acordaos);
  return aviso ? [aviso] : [];
}

/** Avisos da memória que falhou: a leitura desta busca (código do erro) e a última gravação em disco. */
function avisosDaMemoria(memoria?: Memoria, falhaAoLer?: string): string[] {
  const avisos = falhaAoLer
    ? [`A memória do Garimpo falhou ao ler a busca guardada (${falhaAoLer}): a busca foi feita no site, como busca nova.`]
    : [];
  const gravacao = memoria?.avisoDeGravacao();
  return gravacao ? [...avisos, gravacao] : avisos;
}

/**
 * O site não informa o total da base: só dá para dizer se veio o número pedido ou menos. Conta registros (antes de
 * juntar cópias). Onde o site devolve menos que o pedido por busca (STF), vir menos não quer dizer que a base acabou.
 */
function linhaDeCobertura(vieram: number, pedidos: number, tetoDoSite: number, filtrada: boolean, nomes = ""): string {
  const base = linhaBase(vieram, pedidos, tetoDoSite, filtrada);
  const ressalva = ressalvaSePoucos(nomes, vieram, pedidos);
  return ressalva ? `${base} ${ressalva}` : base;
}

function linhaBase(vieram: number, pedidos: number, tetoDoSite: number, filtrada: boolean): string {
  if (vieram < pedidos && tetoDoSite < 100) {
    return `O site devolveu ${vieram} registros; neste tribunal ele devolve poucos por busca (até ${tetoDoSite}), ` +
      "então pode haver mais: use a busca ampla com outras formulações.";
  }
  if (vieram < pedidos) {
    const eFiltros = filtrada ? " e estes filtros" : "";
    return `O site devolveu ${vieram} registros, menos que os ${pedidos} pedidos: a base não tem mais para este texto${eFiltros}.`;
  }
  const comoVerMais = pedidos < 100 ? "aumente o limite (até 100) ou use a busca ampla" : "use a busca ampla";
  return `O site devolveu os ${pedidos} registros pedidos; pode haver mais: ${comoVerMais}.`;
}

type Bruto = Record<string, unknown>;

export function normalizar(
  tribunal: string,
  json: unknown,
  tabela?: TabelaDePrecedentes,
  tabelaStf?: TabelaDoStf,
): ResultadoBusca & { tesesDoSite: (string | null)[] } {
  if (!json || typeof json !== "object") {
    throw new FormatoInesperadoError("O JurisprudênciaIA devolveu uma resposta vazia ou em formato inesperado.");
  }
  const r = json as Bruto;
  const listas = ["reranked_results", ...LISTAS_ACORDAOS].filter((k) => Array.isArray(r[k]));
  if (listas.length === 0) {
    throw new FormatoInesperadoError(
      "A resposta do JurisprudênciaIA não trouxe nenhuma lista de acórdãos conhecida " +
        "(reranked_results, results ou juris). O formato do site pode ter mudado.",
    );
  }

  // A lista reranqueada mistura acórdãos e precedentes qualificados; dela vêm a ordem e a nota de relevância
  // dos acórdãos, completados pelo registro de results/juris.
  const porId = new Map<string, Bruto>();
  for (const k of LISTAS_ACORDAOS) {
    if (Array.isArray(r[k])) for (const x of r[k] as Bruto[]) porId.set(String(x.id), x);
  }
  const reranqueados = (Array.isArray(r.reranked_results) ? (r.reranked_results as Bruto[]) : []).filter(
    (x) => LISTAS_ACORDAOS.includes(String(x.original_bucket)) || (!x.original_bucket && x.__kind === "juris"),
  );
  const brutos: Bruto[] = [];
  const vistos = new Set<string>();
  for (const x of [...reranqueados, ...porId.values()]) {
    const id = String(x.id);
    if (vistos.has(id)) continue;
    vistos.add(id);
    brutos.push({ ...porId.get(id), ...x });
  }

  const qualificados: Qualificado[] = [];
  const tesesDoSite: (string | null)[] = [];
  for (const [lista, tipo] of Object.entries(LISTAS_QUALIFICADOS)) {
    if (!Array.isArray(r[lista])) continue;
    for (const q of r[lista] as Bruto[]) {
      qualificados.push(paraQualificado(tribunal, tipo, q, tabela, tabelaStf));
      tesesDoSite.push(texto(q.tese_firmada) ?? null);
    }
  }

  const avisos: string[] = [];
  const semEmenta = brutos.filter((x) => !texto(x.texto_ementa)).length;
  if (semEmenta) avisos.push(`${semEmenta} acórdão(s) vieram sem ementa no JurisprudênciaIA.`);

  // Os paradigmas dos temas da mesma resposta só geram nota no acórdão do mesmo processo: ele não herda o inciso.
  const paradigmas: ParadigmaDoSite[] = qualificados.map(({ tipo, numero, processoParadigma }) => ({
    tribunal,
    tipo,
    numero,
    processoParadigma,
  }));
  return {
    tribunal,
    acordaos: brutos.map((x) => paraAcordao(tribunal, x, paradigmas)),
    qualificados,
    tesesDoSite,
    ressalvaQualificados: RESSALVA_DIRETA,
    avisos,
  };
}

/** Endereço https num domínio da Justiça (.jus.br): o único que o Garimpo apresenta como link do tribunal. */
export function ehEnderecoDoTribunal(valor: string): boolean {
  try {
    const url = new URL(valor);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "jus.br" || host.endsWith(".jus.br"));
  } catch {
    return false;
  }
}

/** O link da base só se for endereço do tribunal; `data:`, `gs://` e afins não abrem como página. */
const doTribunal = (valor: string | undefined) => (valor && ehEnderecoDoTribunal(valor) ? valor : undefined);

/**
 * O aviso de um link que não sai: diz o tipo do endereço ou, em https, só o domínio. Nunca o endereço, que pode ter
 * centenas de KB (`data:`) ou não abrir em lugar nenhum (`gs://`).
 */
export function avisoDeLinkForaDaWeb(valor: string): string {
  let qual: string;
  try {
    const url = new URL(valor);
    qual = url.protocol === "https:" ? `endereço em ${url.hostname}` : `endereço do tipo ${url.protocol}`;
  } catch {
    qual = "endereço ilegível";
  }
  return `O JurisprudênciaIA mandou, no lugar do link, um endereço que não é página do tribunal (${qual}); o Garimpo não o mostra.`;
}

function paraAcordao(tribunal: string, x: Bruto, paradigmas: readonly ParadigmaDoSite[]): Acordao {
  const sigla = texto(x.sigla_classe);
  const numeroDeVerdade = texto(x.numero_processo) ?? texto(x.numero_processo_cnj);
  const numero = numeroDeVerdade ?? String(x.id);
  // No TJGO, o link_pdf do site não abre fora da sessão do portal; o processo abre pelo número CNJ.
  const linkDaBase =
    (tribunal === "tjgo" &&
      (linkDoProcessoNoTjgo(texto(x.numero_processo_cnj)) ?? linkDoProcessoNoTjgo(texto(x.numero_processo)))) ||
    texto(x.link_pdf);
  const consultaDaBase = texto(x.link_consulta) ?? texto(x.url_acordao) ?? texto(x.link_processo);
  const foraDaWeb = [linkDaBase, consultaDaBase].find((l) => l !== undefined && !ehEnderecoDoTribunal(l));
  const limpa = limparEmenta(tribunal, texto(x.texto_ementa) ?? "");
  // Só o começo já vem com aviso próprio; a heurística de ementa cortada olharia o corte do Garimpo, não o do site.
  const incompleta = !limpa.separacaoIncerta && ementaAparentementeIncompleta(limpa.ementa);
  const avisosDeEmenta = [limpa.aviso, incompleta ? AVISO_EMENTA_INCOMPLETA : undefined].filter(Boolean);
  // Ementa sem separação segura (só o começo) não serve para dizer que a classe não aparece nela.
  const duvida = duvidaDaClasse({
    classe: texto(x.classe_processual),
    ementa: limpa.separacaoIncerta ? undefined : limpa.ementa,
  });
  const acordao = limpar({
    id: `${tribunal}:${x.id}`,
    tribunal,
    numero: sigla && !numero.startsWith(sigla) ? `${sigla} ${numero}` : numero,
    semNumero: !numeroDeVerdade,
    numeroCnj: texto(x.numero_processo_cnj),
    classe: texto(x.classe_processual),
    avisoDeClasse: duvida && avisoDeClasse(duvida),
    relator: texto(x.relator),
    orgao: texto(x.orgao_julgador),
    dataJulgamento: data(x.data_julgamento),
    dataPublicacao: data(x.data_publicacao_extraida),
    ementa: limpa.ementa,
    avisoDeEmenta: avisosDeEmenta.length ? avisosDeEmenta.join(" ") : undefined,
    ementaIncerta: limpa.separacaoIncerta,
    link: doTribunal(linkDaBase),
    linkConsulta: doTribunal(consultaDaBase),
    avisoDeLink: foraDaWeb && avisoDeLinkForaDaWeb(foraDaWeb),
    idArquivoProjudi: tribunal === "tjgo" ? /[?&]Id_Arquivo=(\d+)/.exec(texto(x.link_pdf) ?? "")?.[1] : undefined,
    relevancia: numeroOuNada(x.rerank_score) ?? numeroOuNada(x.score),
  });
  const enquadramento927 = enquadrarAcordao(
    { ...acordao, siglaClasse: sigla, numeroTema: texto(x.numero_tema), duvidaDaClasse: duvida },
    { paradigmas },
  );
  return { ...acordao, enquadramento927 };
}

function paraQualificado(
  tribunal: string,
  tipo: string,
  q: Bruto,
  tabela?: TabelaDePrecedentes,
  tabelaStf?: TabelaDoStf,
): Qualificado {
  const sigla = texto(q.sigla_classe);
  const proc = texto(q.numero_processo_paradigma) ?? (texto(q.numero_processo) && `${sigla ?? ""} ${q.numero_processo}`.trim());
  const numero = texto(q.numero) ?? texto(q.numero_tema);
  return limpar({
    tipo,
    numero,
    texto: texto(q.tese_firmada) ?? texto(q.enunciado) ?? texto(q.descricao_tese) ?? "",
    orgao: texto(q.orgao_julgador),
    processoParadigma: proc || undefined,
    link: texto(q.link) ?? texto(q.url_tema) ?? texto(q.link_pdf) ?? texto(q.link_acordao),
    // Tese só a firmada: descrição da questão submetida não é tese.
    enquadramento927: enquadrar(tribunal, tipo, numero, texto(q.tese_firmada), tabela, tabelaStf),
  });
}

/** Enquadramento de um item das listas de qualificados, com o reforço das tabelas carregadas (busca nova ou guardada). */
function enquadrar(
  tribunal: string,
  tipo: string,
  numero: string | undefined,
  tese: string | undefined,
  tabela?: TabelaDePrecedentes,
  tabelaStf?: TabelaDoStf,
): Enquadramento927 {
  return enquadrarQualificado(
    { tribunal, tipo, numero, tese },
    reforcoDaTabela(tabela, tribunal, tipo, numero) ?? reforcoDoStf(tabelaStf, tribunal, tipo, numero),
  );
}

const AVISO_EMENTA_INCOMPLETA =
  "Ementa aparentemente incompleta: termina no meio da frase, como veio do JurisprudênciaIA (heurística do Garimpo; " +
  "o texto não foi alterado). Confira no inteiro teor.";

/** Rodapé que o site acrescenta à ementa (TJPA), depois de uma linha em branco: "(TJPA – classe – Nº … – …)". */
const RODAPE_DO_SITE = /\n\s*\n\s*\([^\n]*\)\s*$/;
/** Numeral de item solto depois do fim de uma frase ("… pela Reclamante. IV."): o item seguinte foi cortado. */
const ITEM_SOLTO = /[.;:!?]\s+(?:[IVXLC]+|\d{1,3})[.)]$/;
const FIM_DE_FRASE = /[.!?…"”»)\]]$/;
/** Ementa inteira que fecha na assinatura, sem ponto final, numa linha própria ("…\n\nDesembargador Relator"). */
const FECHO_DE_ASSINATURA = /\n[^\n]{0,60}\b(?:relatora?|desembargadora?|juiz|juíza|ministr[oa])\s*$/i;

/**
 * Heurística: a ementa termina no meio da frase (o site corta algumas), olhando o texto antes do rodapé do site.
 * Fecho de assinatura é fim normal. Só avisa; nunca completa nem conserta o texto.
 */
export function ementaAparentementeIncompleta(ementa: string): boolean {
  const corpo = ementa.replace(RODAPE_DO_SITE, "").trim();
  if (!corpo) return false;
  if (ITEM_SOLTO.test(corpo)) return true;
  return !FIM_DE_FRASE.test(corpo) && !FECHO_DE_ASSINATURA.test(corpo);
}

function texto(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function numeroOuNada(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** "2012-12-04T00:00:00.000Z" → "2012-12-04". */
function data(v: unknown): string | undefined {
  const s = texto(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

function limpar<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}
