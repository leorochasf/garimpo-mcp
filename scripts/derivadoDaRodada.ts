/**
 * Derivado da rodada do banco de provas (B0.2 do plano 1.2; N03 e F06 da revisão). A rodada crua — respostas do site,
 * números, relatores, ementas — fica só na pasta externa ao projeto. Para `banco-de-provas-resultados/` (dentro do
 * projeto, fora do git) vai só este derivado: ids opacos, hashes com chave, contagens e tempos.
 *
 * O derivado tem ESQUEMA FECHADO: `validarDerivado` recusa campo a mais em qualquer nível e todo texto que não seja
 * enumeração, hash, data ISO, versão ou id opaco. Não há campo de texto livre por onde um número ou uma ementa possa
 * vazar. `tests/dadosReais.test.ts` não cobre a pasta (ignorada pelo git), por isso a defesa é esta.
 *
 * Hash = HMAC-SHA-256 com a chave guardada fora do projeto: sem a chave, o hash de um número de processo não se
 * descobre testando números. A mesma chave em rodadas diferentes permite comparar listas (1.1.1 × 1.2).
 */

import { createHmac } from "node:crypto";
import { SIGLAS } from "../src/tribunais.js";

export const ESQUEMA = "garimpo-derivado-1";

/** O que a pasta externa tem: estado.json, resultados.json e os registros de gravacao/ (ver rodarRodadaDeProvas.ts). */
export interface RodadaCrua {
  estado: Record<string, unknown>;
  resultados: Record<string, any>[];
  /** O registro cru traz também corpo enviado e resposta; daqui só se lê consulta e tempo. */
  registros: { consulta: string; ms?: number; status?: number; [campo: string]: unknown }[];
}

/** Linha do cabeçalho de cobertura da busca_ampla, só os números: diz, por TRT, se a contrária rodou (E5). */
export interface CoberturaDerivada {
  tribunal: string;
  buscasFeitas: number;
  vazias: number;
  comErro: number;
  foraDoTeto: number;
  guardadas: number;
  feitasAgora: number;
}

/** Vereditos do júri (scripts/juriDaLinhaDeBase.ts) entre os acórdãos que a consulta trouxe; controles fora. */
export interface ContagemDerivada {
  S: number;
  P: number;
  C: number;
  N: number;
  semMaioria: number;
}

export interface ConsultaDerivada {
  id: string;
  hashDoId: string;
  fase: string;
  versao?: string;
  /** Um tribunal (busca direta) ou, na busca_ampla, a lista `tribunais`: um dos dois. */
  tribunal?: string;
  tribunais?: string[];
  memoria?: string;
  chamadas: number;
  mostrados: number;
  posicao?: number;
  ms: number;
  /** Tempo de parede da ferramenta inteira (a soma de `ms` é só o tempo das requisições). */
  msParede?: number;
  erro: boolean;
  acordaos: string[];
  cobertura?: CoberturaDerivada[];
  juri?: ContagemDerivada;
}

export interface Derivado {
  esquema: typeof ESQUEMA;
  versaoDoGarimpo: string;
  commit: string;
  /** Identificador da chave dos hashes (não a chave): só derivados com o mesmo valor se comparam. */
  chave: string;
  rodada: {
    iniciadoEm: string;
    terminadoEm?: string;
    chamadasAoSite: number;
    recusas: number;
    parou: boolean;
    completa: boolean;
    consultas: number;
  };
  consultas: ConsultaDerivada[];
  /** Só com a apuração do júri: linhas do pool, controles negativos e quantos o júri julgou N, linhas sem maioria. */
  juri?: { linhas: number; controles: number; controlesN: number; semMaioria: number };
}

/** A apuração do júri como scripts/juriDaLinhaDeBase.ts grava (veredito/apuracao.json), só o que o derivado lê. */
export interface ApuracaoDoJuri {
  linhas: number;
  controles: { total: number; julgadosN: number };
  semMaioria: number;
  porPedido: Record<string, Partial<ContagemDerivada>>;
}

/** Fases das rodadas existentes e estratos do protocolo 1.2 (docs/banco-de-provas/protocolo-1.2.md). */
const FASES = new Set(["paradigma", "tese", "verificacao", "armadilha", "distinguishing", "unilateral", "trt", "injecao"]);
const VERSOES = new Set(["tecnica", "leiga", "palavras", "contraria"]);
const MEMORIAS = new Set(["fria", "quente", "renovar"]);
const TRIBUNAIS = new Set([...SIGLAS, "tcu"]);

const HEX64 = /^[0-9a-f]{64}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const ID_OPACO = /^c\d{3,5}$/;
const VERSAO = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const inteiro = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

/** CNJ vira só os 20 dígitos; o resto, classe + número sem acento, pontuação nem UF ("REsp 1.234.567/SP" → "resp1234567"). */
function normalizarNumero(numero: string): string {
  const digitos = numero.replace(/\D/g, "");
  if (digitos.length === 20) return digitos;
  return numero
    .replace(/\/[A-Za-z]{2}\s*$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function enumeracao(nome: string, valor: unknown, aceitos: ReadonlySet<string>): string {
  if (typeof valor !== "string" || !aceitos.has(valor)) throw new Error(`derivado: ${nome} fora da lista aceita; nada foi exportado`);
  return valor;
}

export function exportarDerivado(
  crua: RodadaCrua,
  chave: string,
  meta: { versaoDoGarimpo: string; commit: string },
  apuracao?: ApuracaoDoJuri,
): Derivado {
  if (!HEX64.test(chave)) throw new Error("derivado: a chave precisa de 64 dígitos hexadecimais (32 bytes)");
  const hash = (texto: string) => createHmac("sha256", Buffer.from(chave, "hex")).update(texto).digest("hex");
  const msPorConsulta = new Map<string, number>();
  for (const r of crua.registros) msPorConsulta.set(r.consulta, (msPorConsulta.get(r.consulta) ?? 0) + inteiro(r.ms));

  const consultas = crua.resultados.map((r, i): ConsultaDerivada => {
    // O tribunal entra no hash: na busca_ampla a lista mistura tribunais, e o mesmo número em dois deles são dois acórdãos.
    const tribunalDoItem = (j: number) => String((Array.isArray(r.acordaos) && r.acordaos[j]?.tribunal) || r.tribunal || "").toLowerCase();
    const c: ConsultaDerivada = {
      id: `c${String(i + 1).padStart(3, "0")}`,
      hashDoId: hash(`id:${String(r.id)}`),
      fase: enumeracao("fase", r.fase, FASES),
      chamadas: inteiro(r.chamadas),
      mostrados: inteiro(r.mostrados),
      ms: msPorConsulta.get(String(r.id)) ?? 0,
      erro: r.erro !== undefined,
      acordaos: (Array.isArray(r.numeros) ? r.numeros : []).map((n: unknown, j: number) => hash(`acordao:${tribunalDoItem(j)}|${normalizarNumero(String(n))}`)),
    };
    if (Array.isArray(r.tribunais)) c.tribunais = r.tribunais.map((t: unknown) => enumeracao("tribunal", t, TRIBUNAIS));
    else c.tribunal = enumeracao("tribunal", r.tribunal, TRIBUNAIS);
    if (r.versao !== undefined) c.versao = enumeracao("versao", r.versao, VERSOES);
    if (r.memoria !== undefined) c.memoria = enumeracao("memoria", r.memoria, MEMORIAS);
    if (typeof r.posicao === "number") c.posicao = inteiro(r.posicao);
    if (typeof r.msParede === "number") c.msParede = inteiro(Math.round(r.msParede));
    if (Array.isArray(r.cobertura))
      c.cobertura = r.cobertura.map((t: Record<string, unknown>) => ({
        tribunal: enumeracao("tribunal", t.tribunal, TRIBUNAIS),
        buscasFeitas: inteiro(t.buscasFeitas),
        vazias: inteiro(t.vazias),
        comErro: inteiro(t.comErro),
        foraDoTeto: inteiro(t.foraDoTeto),
        guardadas: inteiro(t.guardadas),
        feitasAgora: inteiro(t.feitasAgora),
      }));
    const doJuri = apuracao?.porPedido[String(r.id)];
    if (doJuri) c.juri = { S: inteiro(doJuri.S), P: inteiro(doJuri.P), C: inteiro(doJuri.C), N: inteiro(doJuri.N), semMaioria: inteiro(doJuri.semMaioria) };
    return c;
  });

  const e = crua.estado;
  const rodada: Derivado["rodada"] = {
    iniciadoEm: String(e.iniciadoEm),
    chamadasAoSite: inteiro(e.chamadasAoSite),
    recusas: Array.isArray(e.recusasDoSite) ? e.recusasDoSite.length : 0,
    parou: Boolean(e.motivoDaParada),
    completa: e.completa === true,
    consultas: consultas.length,
  };
  if (e.terminadoEm !== undefined) rodada.terminadoEm = String(e.terminadoEm);
  const derivado: Derivado = { esquema: ESQUEMA, versaoDoGarimpo: meta.versaoDoGarimpo, commit: meta.commit, chave: hash("chave").slice(0, 16), rodada, consultas };
  if (apuracao)
    derivado.juri = {
      linhas: inteiro(apuracao.linhas),
      controles: inteiro(apuracao.controles.total),
      controlesN: inteiro(apuracao.controles.julgadosN),
      semMaioria: inteiro(apuracao.semMaioria),
    };
  const problemas = validarDerivado(derivado);
  if (problemas.length) throw new Error(`derivado: fora do esquema, nada foi exportado:\n${problemas.join("\n")}`);
  return derivado;
}

type Regra = { obrigatorio: boolean; valida: (v: unknown) => boolean; descricao: string };
const texto = (padrao: RegExp, descricao: string, obrigatorio = true): Regra => ({
  obrigatorio,
  valida: (v) => typeof v === "string" && padrao.test(v),
  descricao,
});
const lista = (aceitos: ReadonlySet<string>, obrigatorio = true): Regra => ({
  obrigatorio,
  valida: (v) => typeof v === "string" && aceitos.has(v),
  descricao: "valor da lista aceita",
});
const numero = (obrigatorio = true): Regra => ({
  obrigatorio,
  valida: (v) => typeof v === "number" && Number.isInteger(v) && v >= 0,
  descricao: "inteiro não negativo",
});
const booleano: Regra = { obrigatorio: true, valida: (v) => typeof v === "boolean", descricao: "verdadeiro ou falso" };
/** Objeto fechado dentro de outro: vale só se nada nele sai do esquema dele. */
const fechado = (regras: Record<string, Regra>, descricao: string): Regra => ({
  obrigatorio: false,
  valida: (v) => {
    const problemas: string[] = [];
    conferir("", v, regras, problemas);
    return problemas.length === 0;
  },
  descricao,
});

const RAIZ: Record<string, Regra> = {
  esquema: { obrigatorio: true, valida: (v) => v === ESQUEMA, descricao: ESQUEMA },
  versaoDoGarimpo: texto(VERSAO, "versão N.N.N"),
  commit: texto(COMMIT, "hash de commit"),
  chave: texto(HEX16, "identificador de chave (16 hexadecimais)"),
};
const RODADA: Record<string, Regra> = {
  iniciadoEm: texto(DATA_ISO, "data ISO"),
  terminadoEm: texto(DATA_ISO, "data ISO", false),
  chamadasAoSite: numero(),
  recusas: numero(),
  parou: booleano,
  completa: booleano,
  consultas: numero(),
};
const COBERTURA: Record<string, Regra> = {
  tribunal: lista(TRIBUNAIS),
  buscasFeitas: numero(),
  vazias: numero(),
  comErro: numero(),
  foraDoTeto: numero(),
  guardadas: numero(),
  feitasAgora: numero(),
};
const CONTAGEM: Record<string, Regra> = { S: numero(), P: numero(), C: numero(), N: numero(), semMaioria: numero() };
const JURI: Record<string, Regra> = { linhas: numero(), controles: numero(), controlesN: numero(), semMaioria: numero() };
const CONSULTA: Record<string, Regra> = {
  id: texto(ID_OPACO, "id opaco cNNN"),
  hashDoId: texto(HEX64, "hash"),
  fase: lista(FASES),
  versao: lista(VERSOES, false),
  tribunal: lista(TRIBUNAIS, false),
  tribunais: {
    obrigatorio: false,
    valida: (v) => Array.isArray(v) && v.length > 0 && v.every((t) => typeof t === "string" && TRIBUNAIS.has(t)),
    descricao: "lista de tribunais da lista aceita",
  },
  memoria: lista(MEMORIAS, false),
  chamadas: numero(),
  mostrados: numero(),
  posicao: numero(false),
  ms: numero(),
  msParede: numero(false),
  erro: booleano,
  acordaos: {
    obrigatorio: true,
    valida: (v) => Array.isArray(v) && v.every((h) => typeof h === "string" && HEX64.test(h)),
    descricao: "lista de hashes",
  },
  cobertura: {
    obrigatorio: false,
    valida: (v) => Array.isArray(v) && v.every((t) => fechado(COBERTURA, "").valida(t)),
    descricao: "lista de coberturas (tribunal e contagens)",
  },
  juri: fechado(CONTAGEM, "contagem do júri (S, P, C, N, semMaioria)"),
};

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Campos da raiz com conferência própria (objeto ou lista de objetos fechados). */
const DA_RAIZ = new Set(["rodada", "consultas", "juri"]);

function conferir(caminho: string, valor: unknown, regras: Record<string, Regra>, problemas: string[]): void {
  if (!objeto(valor)) {
    problemas.push(`${caminho || "raiz"}: precisa ser um objeto`);
    return;
  }
  // Object.hasOwn, não `in`: `in` aceitaria constructor, toString e __proto__, herdados de Object.prototype.
  for (const campo of Object.keys(valor))
    if (!Object.hasOwn(regras, campo) && !(caminho === "" && regras === RAIZ && DA_RAIZ.has(campo)))
      problemas.push(`${caminho ? `${caminho}.` : ""}${campo}: campo fora do esquema`);
  for (const [campo, regra] of Object.entries(regras)) {
    const nome = `${caminho ? `${caminho}.` : ""}${campo}`;
    if (!Object.hasOwn(valor, campo)) {
      if (regra.obrigatorio) problemas.push(`${nome}: obrigatório`);
    } else if (!regra.valida(valor[campo])) problemas.push(`${nome}: precisa ser ${regra.descricao}`);
  }
}

/** Lista de problemas (vazia = dentro do esquema). Nunca repete o valor achado, só o caminho do campo. */
export function validarDerivado(d: unknown): string[] {
  const problemas: string[] = [];
  conferir("", d, RAIZ, problemas);
  if (!objeto(d)) return problemas;
  if (!Object.hasOwn(d, "rodada")) problemas.push("rodada: obrigatório");
  else conferir("rodada", d.rodada, RODADA, problemas);
  if (!Array.isArray(d.consultas)) problemas.push("consultas: precisa ser uma lista");
  else
    d.consultas.forEach((c, i) => {
      conferir(`consultas[${i}]`, c, CONSULTA, problemas);
      if (objeto(c) && Object.hasOwn(c, "tribunal") === Object.hasOwn(c, "tribunais"))
        problemas.push(`consultas[${i}].tribunal: um, e só um, entre tribunal e tribunais`);
    });
  if (Object.hasOwn(d, "juri")) conferir("juri", d.juri, JURI, problemas);
  return problemas;
}

const mesmoArquivo = (a: string, b: string) => {
  const normal = (c: string) => c.replace(/\\/g, "/").replace(/^\/\/[?.]\//, "").toLowerCase();
  return normal(a) === normal(b);
};

/**
 * Motivo para não gravar em `--para`, ou undefined. Nunca grava por cima do arquivo da chave (perderia a chave, sem
 * volta) nem de arquivo que não seja um derivado deste esquema. Recebe caminhos físicos e o conteúdo atual do destino
 * (undefined se ainda não existe).
 */
export function destinoInvalido(para: string, chave: string, conteudoAtual: string | undefined): string | undefined {
  if (mesmoArquivo(para, chave)) return "--para é o arquivo da chave: gravar ali apagaria a chave.";
  if (conteudoAtual === undefined) return undefined;
  let atual: unknown;
  try {
    atual = JSON.parse(conteudoAtual);
  } catch {
    atual = undefined;
  }
  if (validarDerivado(atual).length) return "--para já existe e não é um derivado deste esquema: escolha outro arquivo.";
  return undefined;
}
