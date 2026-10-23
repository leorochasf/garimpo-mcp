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

export interface ConsultaDerivada {
  id: string;
  hashDoId: string;
  fase: string;
  versao?: string;
  tribunal: string;
  chamadas: number;
  mostrados: number;
  posicao?: number;
  ms: number;
  erro: boolean;
  acordaos: string[];
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
}

/** Fases das rodadas existentes e estratos do protocolo 1.2 (docs/banco-de-provas/protocolo-1.2.md). */
const FASES = new Set(["paradigma", "tese", "verificacao", "armadilha", "distinguishing", "unilateral", "trt", "injecao"]);
const VERSOES = new Set(["tecnica", "leiga", "palavras", "contraria"]);
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

export function exportarDerivado(crua: RodadaCrua, chave: string, meta: { versaoDoGarimpo: string; commit: string }): Derivado {
  if (!HEX64.test(chave)) throw new Error("derivado: a chave precisa de 64 dígitos hexadecimais (32 bytes)");
  const hash = (texto: string) => createHmac("sha256", Buffer.from(chave, "hex")).update(texto).digest("hex");
  const msPorConsulta = new Map<string, number>();
  for (const r of crua.registros) msPorConsulta.set(r.consulta, (msPorConsulta.get(r.consulta) ?? 0) + inteiro(r.ms));

  const consultas = crua.resultados.map((r, i): ConsultaDerivada => {
    const c: ConsultaDerivada = {
      id: `c${String(i + 1).padStart(3, "0")}`,
      hashDoId: hash(`id:${String(r.id)}`),
      fase: enumeracao("fase", r.fase, FASES),
      tribunal: enumeracao("tribunal", r.tribunal, TRIBUNAIS),
      chamadas: inteiro(r.chamadas),
      mostrados: inteiro(r.mostrados),
      ms: msPorConsulta.get(String(r.id)) ?? 0,
      erro: r.erro !== undefined,
      acordaos: (Array.isArray(r.numeros) ? r.numeros : []).map((n: unknown) => hash(`acordao:${normalizarNumero(String(n))}`)),
    };
    if (r.versao !== undefined) c.versao = enumeracao("versao", r.versao, VERSOES);
    if (typeof r.posicao === "number") c.posicao = inteiro(r.posicao);
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
const CONSULTA: Record<string, Regra> = {
  id: texto(ID_OPACO, "id opaco cNNN"),
  hashDoId: texto(HEX64, "hash"),
  fase: lista(FASES),
  versao: lista(VERSOES, false),
  tribunal: lista(TRIBUNAIS),
  chamadas: numero(),
  mostrados: numero(),
  posicao: numero(false),
  ms: numero(),
  erro: booleano,
  acordaos: {
    obrigatorio: true,
    valida: (v) => Array.isArray(v) && v.every((h) => typeof h === "string" && HEX64.test(h)),
    descricao: "lista de hashes",
  },
};

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function conferir(caminho: string, valor: unknown, regras: Record<string, Regra>, problemas: string[]): void {
  if (!objeto(valor)) {
    problemas.push(`${caminho || "raiz"}: precisa ser um objeto`);
    return;
  }
  // Object.hasOwn, não `in`: `in` aceitaria constructor, toString e __proto__, herdados de Object.prototype.
  for (const campo of Object.keys(valor))
    if (!Object.hasOwn(regras, campo) && !(caminho === "" && (campo === "rodada" || campo === "consultas")))
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
  else d.consultas.forEach((c, i) => conferir(`consultas[${i}]`, c, CONSULTA, problemas));
  return problemas;
}
