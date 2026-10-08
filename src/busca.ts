/**
 * Busca direta: uma consulta à base do JurisprudênciaIA, num tribunal.
 * Normaliza a resposta (acórdãos e precedentes qualificados em listas separadas).
 */

import { Cliente, FormatoInesperadoError } from "./cliente.js";
import { juntarEquivalentes } from "./equivalencia.js";
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
  /** Página oficial de consulta do processo/acórdão (STF: link_consulta ou url_acordao), quando há. */
  linkConsulta?: string;
  relevancia?: number;
}

export interface Qualificado {
  tipo: string;
  numero?: string;
  texto: string;
  orgao?: string;
  processoParadigma?: string;
  link?: string;
}

export interface ResultadoBusca {
  tribunal: string;
  /** Cabeçalho de cobertura: se veio o número pedido (pode haver mais) ou menos (a base não tem mais). */
  cabecalhoDeCobertura?: string;
  acordaos: Acordao[];
  qualificados: Qualificado[];
  avisos: string[];
}

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

/** Memória da sessão: acórdãos já devolvidos, por id composto. Não refaz busca no site. */
const memoria = new Map<string, Acordao>();

export function acordaoNaMemoria(id: string): Acordao | undefined {
  return memoria.get(id);
}

/** Guarda o acórdão sob o id de cada cópia, para que qualquer um deles leia a ementa e peça o inteiro teor. */
export function lembrar(ids: readonly string[], acordao: Acordao): void {
  for (const id of ids) memoria.set(id, acordao);
}

export async function buscaDireta(cliente: Cliente, p: ParametrosBusca): Promise<ResultadoBusca> {
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
  const filtrada = [p.de, p.ate, p.relator, p.orgao, p.classe].some(Boolean);
  const cabecalhoDeCobertura = linhaDeCobertura(resultado.acordaos.length, corpo.limit as number, info.tetoResultados, filtrada);
  // Cópias do mesmo acórdão na base do site viram um acórdão só (mesmo tribunal, data e ementa,
  // sem números de processo que se contradigam).
  const { acordaos } = juntarEquivalentes(
    resultado.acordaos.map((registro, posicao) => ({ registro, formulacoes: new Set<number>(), melhorPosicao: posicao })),
  );
  resultado.acordaos = acordaos.sort((a, b) => a.melhorPosicao - b.melhorPosicao).map((a) => {
    lembrar(a.ids, a.registro);
    return a.registro;
  });
  if (tribunal === "stf") {
    resultado.avisos.push(
      "O site costuma devolver poucos acórdãos do STF por busca (de 2 a 7 na medição de out/2026). " +
        "Para mais, use outras formulações (busca_ampla).",
    );
  }
  return { tribunal, cabecalhoDeCobertura, acordaos: resultado.acordaos, qualificados: resultado.qualificados, avisos: resultado.avisos };
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
    for (const q of r[lista] as Bruto[]) qualificados.push(paraQualificado(tipo, q));
  }

  const avisos: string[] = [];
  const semEmenta = brutos.filter((x) => !texto(x.texto_ementa)).length;
  if (semEmenta) avisos.push(`${semEmenta} acórdão(s) vieram sem ementa no JurisprudênciaIA.`);

  return { tribunal, acordaos: brutos.map((x) => paraAcordao(tribunal, x)), qualificados, avisos };
}

function paraAcordao(tribunal: string, x: Bruto): Acordao {
  const sigla = texto(x.sigla_classe);
  const numeroDeVerdade = texto(x.numero_processo) ?? texto(x.numero_processo_cnj);
  const numero = numeroDeVerdade ?? String(x.id);
  return limpar({
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
    linkConsulta: texto(x.link_consulta) ?? texto(x.url_acordao),
    relevancia: numeroOuNada(x.rerank_score) ?? numeroOuNada(x.score),
  });
}

function paraQualificado(tipo: string, q: Bruto): Qualificado {
  const sigla = texto(q.sigla_classe);
  const proc = texto(q.numero_processo_paradigma) ?? (texto(q.numero_processo) && `${sigla ?? ""} ${q.numero_processo}`.trim());
  return limpar({
    tipo,
    numero: texto(q.numero) ?? texto(q.numero_tema),
    texto: texto(q.tese_firmada) ?? texto(q.enunciado) ?? texto(q.descricao_tese) ?? "",
    orgao: texto(q.orgao_julgador),
    processoParadigma: proc || undefined,
    link: texto(q.link) ?? texto(q.url_tema) ?? texto(q.link_pdf) ?? texto(q.link_acordao),
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
