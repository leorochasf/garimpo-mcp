/**
 * Busca direta: uma consulta à base do JurisprudênciaIA, num tribunal.
 * Normaliza a resposta (acórdãos e precedentes qualificados em listas separadas).
 */

import { createHash } from "node:crypto";
import { Cliente, FormatoInesperadoError } from "./cliente.js";
import { type Enquadramento927, enquadrarAcordao, enquadrarQualificado, type ParadigmaDoSite } from "./enquadramento.js";
import { juntarEquivalentes } from "./equivalencia.js";
import { FalhaNaMemoriaError, fotografiaDaBusca, type Memoria } from "./memoria.js";
import { infoTribunal } from "./tribunais.js";

export const SITE = "https://www.jurisprudenciaia.com.br";

export interface Acordao {
  /** Id composto "tribunal:id", usado para pedir a ementa inteira ou o inteiro teor. */
  id: string;
  tribunal: string;
  numero: string;
  /** O site não trouxe número de processo: o `numero` é só o id do site. */
  semNumero: boolean;
  numeroCnj?: string;
  classe?: string;
  relator?: string;
  orgao?: string;
  dataJulgamento?: string;
  dataPublicacao?: string;
  ementa: string;
  /** Link do PDF do inteiro teor (link_pdf). */
  link?: string;
  /** Página oficial de consulta do processo/acórdão (link_consulta, url_acordao ou, no TJPA, link_processo), quando há. */
  linkConsulta?: string;
  /** Link oficial que o Garimpo pediu à rota de link do site, porque a busca não trouxe nenhum (obter_inteiro_teor). */
  linkDaRota?: string;
  relevancia?: number;
  /** Inciso do art. 927 do CPC em que o acórdão se encaixa, com a prova nos dados; ou "não classificado", com o motivo. */
  enquadramento927: Enquadramento927;
}

export interface Qualificado {
  tipo: string;
  numero?: string;
  texto: string;
  orgao?: string;
  processoParadigma?: string;
  link?: string;
  /** Inciso do art. 927 do CPC com a prova nos dados, ou "não classificado", com o motivo: o rótulo da lista não basta. */
  enquadramento927: Enquadramento927;
}

export interface ResultadoBusca {
  /** Só na busca guardada: veio da memória, como fotografia da busca feita no site na data e hora ditas aqui. */
  buscaGuardada?: string;
  tribunal: string;
  /** Cabeçalho de cobertura: se veio o número pedido (pode haver mais) ou menos (a base não tem mais). */
  cabecalhoDeCobertura?: string;
  acordaos: Acordao[];
  qualificados: Qualificado[];
  /** Vai junto da lista de precedentes qualificados: o rótulo da lista é do site, não do art. 927. */
  ressalvaQualificados: string;
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
  const cobertura = (vieram: number) => linhaDeCobertura(vieram, corpo.limit as number, info.tetoResultados, filtrada);
  // sha256 do tribunal e do corpo: o texto da busca e os filtros nunca vão em claro para o disco.
  const chave = createHash("sha256").update(JSON.stringify([tribunal, corpo])).digest("hex");
  return { tribunal, corpo, chave, cobertura };
}

/** A busca guardada para estes parâmetros, se houver uma válida; nenhuma chamada ao site. */
export async function lerBuscaGuardada(
  memoria: Memoria,
  p: ParametrosBusca,
): Promise<{ resultado: ResultadoBusca; obtidoEm: number } | undefined> {
  const { tribunal, chave, cobertura } = pedido(p);
  const guardada = await memoria.obterBusca(chave);
  if (!guardada) return undefined;
  const { busca, obtidoEm } = guardada;
  return {
    obtidoEm,
    resultado: {
      buscaGuardada:
        `${fotografiaDaBusca(obtidoEm)}, devolvida pela memória do Garimpo sem nova chamada ao site; ` +
        "para dado novo, repita com renovar",
      tribunal,
      cabecalhoDeCobertura: cobertura(busca.registrosDoSite),
      acordaos: busca.acordaos.map((a) => a.registro),
      qualificados: busca.qualificados,
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
  { renovar = false, guardarAcordaos = true }: OpcoesBuscaDireta = {},
): Promise<ResultadoBusca> {
  const { tribunal, corpo, chave, cobertura } = pedido(p);
  // Falha ao ler a memória vira busca normal no site, com aviso; sem rede permitida, o erro da rede, como sempre.
  let falhaAoLer: string | undefined;
  if (memoria && !renovar) {
    try {
      const guardada = await lerBuscaGuardada(memoria, p);
      if (guardada) {
        guardada.resultado.avisos.push(...avisosDaMemoria(memoria));
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
  const resultado = normalizar(tribunal, json);
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
    avisos: [...resultado.avisos],
  });
  return {
    tribunal,
    cabecalhoDeCobertura: cobertura(registrosDoSite),
    acordaos: resultado.acordaos,
    qualificados: resultado.qualificados,
    ressalvaQualificados: resultado.ressalvaQualificados,
    // Depois de guardar: o aviso da memória vale só para esta resposta.
    avisos: [...resultado.avisos, ...avisosDaMemoria(memoria, falhaAoLer)],
  };
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
function linhaDeCobertura(vieram: number, pedidos: number, tetoDoSite: number, filtrada: boolean): string {
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

export function normalizar(tribunal: string, json: unknown): ResultadoBusca {
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
  for (const [lista, tipo] of Object.entries(LISTAS_QUALIFICADOS)) {
    if (!Array.isArray(r[lista])) continue;
    for (const q of r[lista] as Bruto[]) qualificados.push(paraQualificado(tribunal, tipo, q));
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
    ressalvaQualificados: RESSALVA_DIRETA,
    avisos,
  };
}

function paraAcordao(tribunal: string, x: Bruto, paradigmas: readonly ParadigmaDoSite[]): Acordao {
  const sigla = texto(x.sigla_classe);
  const numeroDeVerdade = texto(x.numero_processo) ?? texto(x.numero_processo_cnj);
  const numero = numeroDeVerdade ?? String(x.id);
  const acordao = limpar({
    id: `${tribunal}:${x.id}`,
    tribunal,
    numero: sigla && !numero.startsWith(sigla) ? `${sigla} ${numero}` : numero,
    semNumero: !numeroDeVerdade,
    numeroCnj: texto(x.numero_processo_cnj),
    classe: texto(x.classe_processual),
    relator: texto(x.relator),
    orgao: texto(x.orgao_julgador),
    dataJulgamento: data(x.data_julgamento),
    dataPublicacao: data(x.data_publicacao_extraida),
    ementa: texto(x.texto_ementa) ?? "",
    link: texto(x.link_pdf),
    linkConsulta: texto(x.link_consulta) ?? texto(x.url_acordao) ?? texto(x.link_processo),
    relevancia: numeroOuNada(x.rerank_score) ?? numeroOuNada(x.score),
  });
  const enquadramento927 = enquadrarAcordao(
    { ...acordao, siglaClasse: sigla, numeroTema: texto(x.numero_tema) },
    { paradigmas },
  );
  return { ...acordao, enquadramento927 };
}

function paraQualificado(tribunal: string, tipo: string, q: Bruto): Qualificado {
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
    enquadramento927: enquadrarQualificado({ tribunal, tipo, numero, tese: texto(q.tese_firmada) }),
  });
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
