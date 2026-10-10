/**
 * Busca direta num TRT pelo Falcão (CSJT), o repositório oficial de jurisprudência da Justiça do Trabalho
 * (ADR-0018; formato da rota em docs/banco-de-provas/b12-prova-ao-vivo.md). Só a coleção de acórdãos. Tudo pelo
 * Cliente único (UA de navegador, 1 s entre chamadas e freio preventivo valem lá). O texto integral vem na própria
 * busca: vai convertido para a memória (24 h), nunca para a lista, o cabeçalho ou a busca guardada.
 */

import { createHash, randomInt } from "node:crypto";
import { Cliente, FormatoInesperadoError, HOST_FALCAO, PausaPreventivaError, RecusaError } from "./cliente.js";
import type { Acordao, ParametrosBusca, ResultadoBusca } from "./busca.js";
import { enquadrarAcordao } from "./enquadramento.js";
import { juntarEquivalentes } from "./equivalencia.js";
import { htmlComIndicioDeCorte, htmlParaTexto } from "./html.js";
import { fotografiaDaBusca, type Memoria, type TextoIntegral } from "./memoria.js";
import { RedeParadaError } from "./coordenacao.js";
import { ehDoFalcao, ROTULO_FALCAO } from "./tribunais.js";

export const PESQUISA_FALCAO = `https://${HOST_FALCAO}/jurisprudencia-nacional-backend/api/no-auth/pesquisa`;
/** Documentos por página do Falcão. */
const POR_PAGINA = 10;
/** Teto da busca direta num TRT: 3 páginas. */
export const LIMITE_MAXIMO_TRT = 30;
/** O Falcão para de contar aqui: "10.000 ou mais". */
const TETO_DA_CONTAGEM = 10_000;

/** Um sessionId por processo, no formato do site: "_" + 7 letras/dígitos. */
const SESSAO = `_${Array.from({ length: 7 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[randomInt(36)]).join("")}`;

/** O cliente do Falcão: o nome que aparece nas mensagens; o resto (UA, 1 s, freio) é do Cliente, pelo host. */
export function clienteDoFalcao(): Cliente {
  return new Cliente({ nome: "O Falcão" });
}

export const RESSALVA_FALCAO =
  "Precedentes qualificados dos TRTs (súmulas, IRDR/IAC regionais) não são pesquisados no Falcão pelo Garimpo: a " +
  "lista vem vazia por isso, não por falta de precedente.";

const AVISO_DATAS =
  'Datas do Falcão: "julgado em" é a data de julgamento e "juntado em" a de juntada do acórdão aos autos, que não é ' +
  "data de publicação; a data de publicação não é informada pela fonte. Os filtros de data (de, ate) valem para a data " +
  "de juntada, não para a de julgamento.";

/** Filtro do Garimpo → parâmetro do Falcão (formato e significado verificados na prova ao vivo do B12). */
const PARAMETROS_DOS_FILTROS = {
  de: "dataInicio",
  ate: "dataFim",
  relator: "nomeRelator",
  orgao: "orgaoJulgador",
  classe: "classeProcesso",
} as const;

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Sigla de classe processual: uma palavra curta (ROT, AP, RORSum, AIRR). Nome por extenso não é sigla. */
const SIGLA_DE_CLASSE = /^[A-Za-z][A-Za-z0-9]{0,9}$/;

/** Data AAAA-MM-DD que existe no calendário (recusa 2024-02-31 e 2024-99-99). */
function dataExiste(v: string): boolean {
  const [a, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Antes de gastar chamada: filtro com formato que a fonte não aceita é erro que ensina, nunca ignorado em silêncio;
 * limite acima do teto também.
 */
export function conferirPedidoAoFalcao(p: ParametrosBusca, { limite = true } = {}): void {
  const tribunal = p.tribunal.toUpperCase();
  for (const f of ["de", "ate"] as const) {
    const v = p[f]?.trim();
    if (v && !DATA_ISO.test(v)) {
      throw new Error(
        `O filtro ${f} no ${tribunal} (Falcão) pede a data no formato AAAA-MM-DD (por exemplo, 2024-03-31); recebeu "${v}". ` +
          "Atenção: no Falcão a data filtrada é a data de juntada do acórdão, não a de julgamento.",
      );
    }
  }
  const [de, ate] = [p.de?.trim(), p.ate?.trim()];
  for (const [f, v] of [["de", de], ["ate", ate]] as const) {
    if (v && !dataExiste(v)) {
      throw new Error(
        `O filtro ${f} no ${tribunal} (Falcão) recebeu "${v}", data que não existe no calendário; use uma data real no ` +
          "formato AAAA-MM-DD (por exemplo, 2024-03-31).",
      );
    }
  }
  if (de && ate && de > ate) {
    throw new Error(
      `O intervalo no ${tribunal} (Falcão) está invertido: "de" (${de}) é depois de "ate" (${ate}). Troque as datas ou ` +
        "corrija uma delas.",
    );
  }
  const classe = p.classe?.trim();
  if (classe && !SIGLA_DE_CLASSE.test(classe)) {
    throw new Error(
      `O filtro classe no ${tribunal} (Falcão) só vale com a sigla da classe, não com o nome por extenso (por exemplo, ` +
        `ROT ou AP); recebeu "${classe}". O Garimpo não verificou o nome por extenso na fonte.`,
    );
  }
  if (limite && p.limite !== undefined && p.limite > LIMITE_MAXIMO_TRT) {
    throw new Error(
      `O limite no ${tribunal} vai até ${LIMITE_MAXIMO_TRT} (3 páginas do Falcão); pediu ${p.limite}. Para mais ` +
        "acórdãos, use a busca_ampla com outras formulações.",
    );
  }
}

/** O valor do filtro como vai à fonte (sem espaços nas pontas); vazio = filtro não pedido. */
function valorDoFiltro(p: ParametrosBusca, f: keyof typeof PARAMETROS_DOS_FILTROS): string | undefined {
  return p[f]?.trim() || undefined;
}

/** Chave da busca guardada: sha256 da fonte, do tribunal, do texto, do limite e dos filtros pedidos (nada em claro no disco). */
export function chaveNoFalcao(p: ParametrosBusca): string {
  const limite = Math.min(Math.max(p.limite ?? POR_PAGINA, 1), LIMITE_MAXIMO_TRT);
  // Os filtros entram na chave só quando pedidos: a chave de uma busca sem filtro continua a de antes.
  const filtros = (Object.keys(PARAMETROS_DOS_FILTROS) as (keyof typeof PARAMETROS_DOS_FILTROS)[])
    .filter((f) => valorDoFiltro(p, f))
    .map((f) => [f, valorDoFiltro(p, f)]);
  const chave = ["falcao", p.tribunal.toLowerCase(), p.texto, limite, ...(filtros.length ? [filtros] : [])];
  return createHash("sha256").update(JSON.stringify(chave)).digest("hex");
}

/** Cabeçalho de cobertura: o total que o Falcão informa, separado de quantos vieram e quantos foram mostrados. */
export function coberturaNoFalcao(total: number | undefined, recebidos: number, mostrados: number, limite: number): string {
  const informado =
    total === undefined
      ? "O Falcão não informou o total"
      : total >= TETO_DA_CONTAGEM
        ? "O Falcão informou 10.000 ou mais acórdãos (a contagem dele para aí)"
        : `O Falcão informou ${total} acórdãos`;
  const mais =
    total !== undefined && total <= recebidos
      ? "não há mais para este texto"
      : limite < LIMITE_MAXIMO_TRT
        ? `pode haver mais: aumente o limite (até ${LIMITE_MAXIMO_TRT}) ou use a busca ampla com outras formulações`
        : "pode haver mais: use a busca ampla com outras formulações";
  return `${informado}; o Garimpo recebeu ${recebidos} e mostra ${mostrados}; ${mais}.`;
}

export interface OpcoesFalcao {
  renovar?: boolean;
  /** Falso na busca ampla, que guarda os acórdãos depois de juntar as cópias de todas as buscas. */
  guardarAcordaos?: boolean;
}

/** A busca guardada no Falcão para estes parâmetros, sem chamada. */
export async function lerBuscaGuardadaNoFalcao(
  memoria: Memoria,
  p: ParametrosBusca,
): Promise<{ resultado: ResultadoBusca; obtidoEm: number } | undefined> {
  const guardada = await memoria.obterBusca(chaveNoFalcao(p));
  if (!guardada) return undefined;
  const { busca, obtidoEm } = guardada;
  const limite = Math.min(p.limite ?? POR_PAGINA, LIMITE_MAXIMO_TRT);
  return {
    obtidoEm,
    resultado: {
      buscaGuardada:
        `${fotografiaDaBusca(obtidoEm).replace("no site", "no Falcão")}, devolvida pela memória do Garimpo sem nova ` +
        "chamada ao Falcão; para dado novo, repita com renovar",
      tribunal: p.tribunal.toLowerCase(),
      fonte: ROTULO_FALCAO,
      cabecalhoDeCobertura: coberturaNoFalcao(busca.totalNaFonte, busca.registrosDoSite, busca.acordaos.length, limite),
      acordaos: busca.acordaos.map((a) => a.registro),
      qualificados: [],
      ressalvaQualificados: RESSALVA_FALCAO,
      avisos: [...busca.avisos],
    },
  };
}

/** Busca direta num TRT: até 3 páginas de 10, em série, pelo Cliente do Falcão. */
export async function buscaNoFalcao(
  cliente: Cliente,
  p: ParametrosBusca,
  memoria?: Memoria,
  { renovar = false, guardarAcordaos = true }: OpcoesFalcao = {},
): Promise<ResultadoBusca> {
  conferirPedidoAoFalcao(p);
  const tribunal = p.tribunal.toLowerCase();
  const limite = Math.min(Math.max(p.limite ?? POR_PAGINA, 1), LIMITE_MAXIMO_TRT);
  if (memoria && !renovar) {
    const guardada = await lerBuscaGuardadaNoFalcao(memoria, p).catch(() => undefined);
    if (guardada) return guardada.resultado;
  }

  const brutos: unknown[] = [];
  const avisos: string[] = [];
  let total: number | undefined;
  let completa = true;
  for (let pagina = 0; pagina * POR_PAGINA < limite; pagina++) {
    let json: unknown;
    try {
      json = await pedirPagina(cliente, tribunal, p, pagina);
    } catch (e) {
      // Pausa ou recusa depois da 1ª página: fica o que já veio, com o motivo; a busca não é guardada.
      const parar = e instanceof PausaPreventivaError || e instanceof RecusaError || e instanceof RedeParadaError;
      if (pagina === 0 || !parar) throw e;
      avisos.push(`A busca parou na página ${pagina + 1} do Falcão: ${(e as Error).message}`);
      completa = false;
      break;
    }
    const { documentos, quantidadeTotal } = json as { documentos: unknown[]; quantidadeTotal?: unknown };
    if (typeof quantidadeTotal === "number" && Number.isFinite(quantidadeTotal)) total = quantidadeTotal;
    brutos.push(...documentos);
    if (documentos.length < POR_PAGINA) break;
  }
  const recebidos = brutos.slice(0, limite);
  const { acordaos, textos, descartados, divergencias, integraisIguaisAEmenta } = normalizarDoFalcao(tribunal, recebidos);
  if (descartados) {
    avisos.push(
      `${descartados} registro(s) do Falcão descartado(s): sem id do acórdão ou de tribunal diferente do pedido ` +
        "(o Garimpo não completa dado por suposição).",
    );
  }
  if (divergencias) {
    avisos.push(`${divergencias} acórdão(s) com divergência no Falcão entre possuiEmenta e a ementa recebida (ver avisoDeEmenta).`);
  }
  if (integraisIguaisAEmenta) {
    avisos.push(
      `${integraisIguaisAEmenta} acórdão(s) com "texto integral" igual à ementa no Falcão: ficam sem texto integral ` +
        "(a ementa repetida não é o acórdão) e a citação não pode ser conferida nele.",
    );
  }
  avisos.push(AVISO_DATAS);
  const { acordaos: juntos } = juntarEquivalentes(
    acordaos.map((registro, posicao) => ({ registro, formulacoes: new Set<number>(), melhorPosicao: posicao })),
  );
  juntos.sort((a, b) => a.melhorPosicao - b.melhorPosicao);
  memoria?.lembrarTextos(textos);
  if (guardarAcordaos) memoria?.lembrar(juntos);
  if (completa) {
    memoria?.guardarBusca(chaveNoFalcao(p), {
      registrosDoSite: recebidos.length,
      acordaos: juntos.map(({ ids, registro }) => ({ ids, registro })),
      qualificados: [],
      avisos: [...avisos],
      ...(total !== undefined && { totalNaFonte: total }),
    });
  }
  const gravacao = memoria?.avisoDeGravacao();
  return {
    tribunal,
    fonte: ROTULO_FALCAO,
    cabecalhoDeCobertura: coberturaNoFalcao(total, recebidos.length, juntos.length, limite),
    acordaos: juntos.map((a) => a.registro),
    qualificados: [],
    ressalvaQualificados: RESSALVA_FALCAO,
    avisos: gravacao ? [...avisos, gravacao] : avisos,
  };
}

async function pedirPagina(cliente: Cliente, tribunal: string, p: ParametrosBusca, pagina: number): Promise<unknown> {
  const consulta = new URLSearchParams({
    texto: p.texto,
    colecao: "acordaos",
    sessionId: SESSAO,
    page: String(pagina),
    size: String(POR_PAGINA),
    tribunais: tribunal.toUpperCase(),
  });
  for (const [filtro, parametro] of Object.entries(PARAMETROS_DOS_FILTROS)) {
    const valor = valorDoFiltro(p, filtro as keyof typeof PARAMETROS_DOS_FILTROS);
    if (valor) consulta.set(parametro, valor);
  }
  const resposta = await cliente.requisitar(`${PESQUISA_FALCAO}?${consulta}`);
  let json: unknown;
  try {
    json = await resposta.json();
  } catch {
    throw new FormatoInesperadoError(`O Falcão devolveu algo que não é JSON na busca do ${tribunal.toUpperCase()}.`);
  }
  if (!json || typeof json !== "object" || !Array.isArray((json as { documentos?: unknown }).documentos)) {
    throw new FormatoInesperadoError(
      "A resposta do Falcão não trouxe a lista de documentos (documentos). O formato da fonte pode ter mudado.",
    );
  }
  return json;
}

type Bruto = Record<string, unknown>;

/** Normaliza os documentos do Falcão: acórdão (sem o texto integral) e, à parte, o texto integral convertido. */
export function normalizarDoFalcao(tribunal: string, documentos: unknown[]) {
  const acordaos: Acordao[] = [];
  const textos: TextoIntegral[] = [];
  let descartados = 0;
  let divergencias = 0;
  let integraisIguaisAEmenta = 0;
  for (const d of documentos as Bruto[]) {
    const doTribunal = texto(d?.tribunal)?.toLowerCase().replace(/\s+/g, "");
    const idDoc = texto(d?.idDocumentoAcordao);
    if (!doTribunal || !ehDoFalcao(doTribunal) || doTribunal !== tribunal || !idDoc || !/^[\w-]+$/.test(idDoc)) {
      descartados++;
      continue;
    }
    const id = `${tribunal}:${idDoc}`;
    const ementa = htmlParaTexto(texto(d.ementa) ?? "");
    const possui = texto(d.possuiEmenta);
    let avisoDeEmenta: string | undefined;
    if (!ementa) {
      avisoDeEmenta =
        possui === "S"
          ? 'sem ementa no Falcão (divergência: a fonte marca possuiEmenta "S", mas a ementa veio vazia)'
          : "sem ementa no Falcão";
      if (possui === "S") divergencias++;
    } else if (possui === "N") {
      avisoDeEmenta = 'Divergência no Falcão: possuiEmenta "N", mas veio ementa; a ementa recebida foi mantida.';
      divergencias++;
    }
    const numeroProcesso = texto(d.numeroProcesso);
    const sigla = texto(d.siglaClasseProcesso);
    const acordao = limpar({
      id,
      tribunal,
      numero: numeroProcesso ? (sigla ? `${sigla} ${numeroProcesso}` : numeroProcesso) : idDoc,
      semNumero: !numeroProcesso,
      numeroCnj: numeroProcesso,
      classe: texto(d.classeProcesso),
      relator: texto(d.relator),
      orgao: texto(d.turma),
      dataJulgamento: dataDoFalcao(d.dataJulgamento),
      dataJuntada: dataDoFalcao(d.dataJuntada),
      ementa,
      avisoDeEmenta,
      fonte: ROTULO_FALCAO,
    });
    acordaos.push({ ...acordao, enquadramento927: enquadrarAcordao({ ...acordao, siglaClasse: sigla }) });
    const html = texto(d.textoAcordao) ?? "";
    const integral = htmlParaTexto(html);
    if (ementa && ehSoAEmenta(integral, ementa)) {
      // A ementa repetida não é o acórdão: guarda sem texto, para nada ser lido nem conferido como se fosse o inteiro.
      integraisIguaisAEmenta++;
      textos.push({ id, texto: "", indicioDeCorte: false });
    } else {
      textos.push({ id, texto: integral, indicioDeCorte: htmlComIndicioDeCorte(html) });
    }
  }
  return { acordaos, textos, descartados, divergencias, integraisIguaisAEmenta };
}

/** Minúsculas e espaços juntados; acentos ficam como vêm. */
function paraComparar(v: string): string {
  return v.replace(/\s+/g, " ").trim().toLowerCase();
}

/** O "texto integral" é só a ementa repetida (igual, ou com o rótulo "Ementa:" na frente). */
function ehSoAEmenta(integral: string, ementa: string): boolean {
  const a = paraComparar(integral);
  const e = paraComparar(ementa);
  return a === e || a.replace(/^ementa\s*:\s*/, "") === e;
}

/** "05/03/2024" → "2024-03-05"; data inválida ou fora do formato = não informada. */
function dataDoFalcao(v: unknown): string | undefined {
  const m = texto(v)?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return undefined;
  const [, dia, mes, ano] = m;
  const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  const valida = d.getUTCFullYear() === Number(ano) && d.getUTCMonth() === Number(mes) - 1 && d.getUTCDate() === Number(dia);
  return valida ? `${ano}-${mes}-${dia}` : undefined;
}

function texto(v: unknown): string | undefined {
  if (v === null || v === undefined || typeof v === "object") return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function limpar<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}
