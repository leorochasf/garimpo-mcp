/**
 * texto_de_lei: o texto LITERAL de um dispositivo de lei (artigo, parágrafo, inciso, alínea) como a página oficial de
 * normas.leg.br o mostra, com URL, data de obtenção e as marcas de alteração/revogação que a fonte traz. Nunca afirma
 * vigência, não reconstitui alteração e não liga artigo a precedente (D-12, ADR-0026). Fonte, termos e limites:
 * docs/fontes.md.
 */

import { createHash } from "node:crypto";
import { Cliente, FormatoInesperadoError, type OpcoesCliente } from "./cliente.js";
import { type Memoria } from "./memoria.js";

const HOST = "normas.leg.br";
const LICENCA = "https://creativecommons.org/licenses/by/4.0/";
const CREDITOS = "Fonte: normas.leg.br (Congresso Nacional e Senado Federal), licença CC BY 4.0.";

/** Uma chamada a cada 1 s no máximo: a resposta de uma norma inteira passa de 4 MB. */
export function clienteDaLegislacao(extra: Partial<OpcoesCliente> = {}): Cliente {
  return new Cliente({ nome: "O normas.leg.br", intervaloMinimoPorHost: { [HOST]: 1_000 }, ...extra });
}

interface Diploma {
  sigla: string;
  /** O identificador LexML da norma, como o normas.leg.br o endereça. */
  urn: string;
  /** Formas aceitas para o diploma, já normalizadas por `normalizar`. */
  apelidos: string[];
}

/** Lista curta: só entra diploma cuja resposta foi vista ao vivo (docs/fontes.md). */
const DIPLOMAS: Diploma[] = [
  {
    sigla: "CPC",
    urn: "urn:lex:br:federal:lei:2015-03-16;13105",
    apelidos: ["cpc", "cpc/2015", "cpc 2015", "codigo de processo civil", "lei 13105/2015", "lei 13105", "lei 13.105/2015"],
  },
  {
    sigla: "CC",
    urn: "urn:lex:br:federal:lei:2002-01-10;10406",
    apelidos: ["cc", "cc/2002", "cc 2002", "codigo civil", "lei 10406/2002", "lei 10406", "lei 10.406/2002"],
  },
  {
    sigla: "CF",
    urn: "urn:lex:br:federal:constituicao:1988-10-05;1988",
    apelidos: ["cf", "cf/88", "cf/1988", "cf 1988", "crfb", "crfb/88", "crfb/1988", "constituicao federal", "constituicao federal de 1988", "constituicao da republica federativa do brasil"],
  },
];

const normalizar = (t: string) =>
  t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim().replace(/\./g, "");

export const diplomasSuportados = () => DIPLOMAS.map((d) => d.sigla).join(", ");

function acharDiploma(texto: string): Diploma {
  const chave = normalizar(texto);
  const achados = DIPLOMAS.filter((d) => d.apelidos.some((a) => normalizar(a) === chave));
  if (achados.length === 1) return achados[0];
  throw new Error(
    `O Garimpo não reconheceu o diploma "${texto}". Diplomas que sabe buscar: ` +
      `${diplomasSuportados()}. Informe a sigla (ex.: CPC).`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// O dispositivo pedido ("art. 85, § 2º, inciso I, alínea a") → a chave com que a fonte identifica o dispositivo.

const ROMANOS: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function deRomano(texto: string): number {
  let total = 0;
  const v = [...texto.toLowerCase()].map((c) => ROMANOS[c]);
  for (let i = 0; i < v.length; i++) total += v[i] < (v[i + 1] ?? 0) ? -v[i] : v[i];
  if (aRomano(total).toLowerCase() !== texto.toLowerCase()) throw new Error(ERRO_DISPOSITIVO);
  return total;
}

/** "10-A" → "10-1"; a fonte numera as letras (A = 1). */
const comLetra = (numero: string, letra: string | undefined) =>
  letra ? `${numero}-${letra.toLowerCase().charCodeAt(0) - 96}` : numero;

export interface Pedido {
  /** Como a fonte identifica o dispositivo, sem o sufixo de quem o acrescentou (ex.: "art85_par2_inc1"). */
  chave: string;
}

const ERRO_DISPOSITIVO =
  'Não entendi o dispositivo. Escreva o artigo e, se quiser, o que há dentro dele, por exemplo: "art. 85", ' +
  '"art. 85, caput", "art. 85, § 2º", "art. 85, § 2º, inciso I", "art. 85, § 2º, inciso I, alínea a", ' +
  '"art. 9º, parágrafo único" ou "art. 699-A". Um dispositivo por pedido.';

/** O que pode vir depois do que já foi lido: artigo → caput ou §; caput ou § → inciso; inciso → alínea. */
type Etapa = "artigo" | "caput" | "inciso" | "alinea";

export function lerDispositivo(texto: string): Pedido {
  let resto = texto.trim().replace(/[º°ª]/g, "");
  const artigo = /^art(?:igo)?s?\.?\s*(\d+(?:\.\d{3})*)\s*(?:-\s*([A-Za-z])\b)?/i.exec(resto);
  if (!artigo) throw new Error(ERRO_DISPOSITIVO);
  let chave = `art${comLetra(artigo[1].replace(/\./g, ""), artigo[2])}`;
  resto = resto.slice(artigo[0].length);

  let etapa: Etapa = "artigo";
  for (;;) {
    resto = resto.replace(/^[\s,;]+/, "");
    if (!resto) return { chave };
    let m: RegExpExecArray | null;
    if (etapa === "artigo" && (m = /^caput\b/i.exec(resto))) {
      chave += "_cpt";
      etapa = "caput";
    } else if (etapa === "artigo" && (m = /^(?:§|par\.?|par[aá]grafo)\s*[uú]nico\b/i.exec(resto))) {
      chave += "_par1u";
      etapa = "caput";
    } else if (etapa === "artigo" && (m = /^(?:§|par\.?|par[aá]grafo)\s*(\d+)\s*(?:-\s*([A-Za-z])\b)?/i.exec(resto))) {
      chave += `_par${comLetra(m[1], m[2])}`;
      etapa = "caput";
    } else if ((etapa === "artigo" || etapa === "caput") && (m = /^(?:inciso|inc\.?)\s+([ivxlcdm]+)\b/i.exec(resto) ?? /^([IVXLCDM]+)\b/.exec(resto))) {
      // Inciso logo depois do artigo é inciso do caput.
      chave += `${etapa === "artigo" ? "_cpt" : ""}_inc${deRomano(m[1])}`;
      etapa = "inciso";
    } else if (etapa === "inciso" && (m = /^(?:al[ií]nea|al\.?)\s+([a-z])\b/i.exec(resto) ?? /^([a-z])\b(?!\.)/.exec(resto))) {
      chave += `_ali${m[1].toLowerCase().charCodeAt(0) - 96}`;
      etapa = "alinea";
    } else {
      throw new Error(ERRO_DISPOSITIVO);
    }
    resto = resto.slice(m[0].length);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A resposta da fonte (JSON-LD de normas.leg.br) → só o que a ferramenta mostra.

type Bruto = Record<string, unknown>;
const objeto = (v: unknown): Bruto | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : undefined);
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** Uma redação do dispositivo, como a fonte a lista. */
export interface Versao {
  data?: string;
  tipoNaFonte?: string;
  texto?: string;
  alteradoPor?: string;
  notaDaFonte?: string;
  periodoNaFonte?: string;
  forcaMarcadaPelaFonte?: string;
}

export interface Parte {
  /** O dispositivo, no jeito de citar (art. 85, § 2º, inciso I), montado a partir do identificador da fonte. */
  dispositivo: string;
  /** O rótulo que a página oficial mostra ("§ 2º", "I –"), quando ela traz. */
  rotuloNaFonte?: string;
  /** A redação mais recente que a fonte lista, quando ela tem texto. */
  texto?: string;
  /** Redações e suas marcas, mesmo quando há só uma (da mais antiga para a mais recente). */
  versoesNaFonte?: Versao[];
  /** Marca que a fonte põe no dispositivo todo (ex.: NotInForce), sem que o Garimpo conclua nada. */
  marcaDaFonteNoDispositivo?: string;
  observacao?: string;
}

export interface ConsultaEncontrada {
  resultado: "encontrado";
  diploma: { sigla: string; nome: string };
  dispositivo: string;
  urlOficial: string;
  urlDaConsulta: string;
  partes: Parte[];
  versaoDaFonte: { modificadaEm?: string; publicadaEm?: string };
  licenca: string;
  creditos: string;
}

export interface ConsultaSemTexto {
  resultado: "não verificado";
  diploma: { sigla: string; nome: string };
  dispositivo: string;
  motivo: string;
  urlOficial?: string;
  urlDaConsulta: string;
}

export interface ConsultaAmbigua {
  resultado: "identificação necessária";
  diploma: { sigla: string; nome: string };
  dispositivo: string;
  motivo: string;
  candidatos: { dispositivo: string; urlOficial: string }[];
  urlDaConsulta: string;
}

export type Consulta = ConsultaEncontrada | ConsultaSemTexto | ConsultaAmbigua;

export function ehConsulta(d: unknown): d is Consulta {
  const c = objeto(d);
  return !!c && ["encontrado", "não verificado", "identificação necessária"].includes(c.resultado as string) &&
    typeof c.dispositivo === "string" && typeof c.urlDaConsulta === "string" && !!objeto(c.diploma);
}

export type RespostaTextoDeLei = Consulta & { dataDeObtencao: string; obtido: string; aviso: string };

const baseDoId = (n: Bruto): string | undefined => {
  const id = texto(n.legislationIdentifier);
  return id?.includes("!") ? id.split("!")[1].split(",")[0] : undefined;
};

/** Nós da árvore cujo dispositivo (sem o sufixo de quem o acrescentou) é a chave pedida. */
function nosComChave(raiz: unknown, chave: string): Bruto[] {
  const achados: Bruto[] = [];
  const andar = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(andar);
    const o = objeto(n);
    if (!o) return;
    if (baseDoId(o) === chave && !texto(o.legislationIdentifier)!.includes("@")) achados.push(o);
    andar(o.hasPart);
  };
  andar(raiz);
  return achados;
}

const versoesDoNo = (n: Bruto): Bruto[] =>
  lista(n.workExample)
    .map(objeto)
    .filter((v): v is Bruto => !!v)
    .sort((a, b) => (texto(a.legislationDate) ?? "").localeCompare(texto(b.legislationDate) ?? ""));

/** "6-1" → "6º-A", "1045" → "1.045": o jeito de citar. O ordinal vai só até o 9 (art. 9º, § 10), como a lei escreve. */
const ordinal = (n: string) => {
  const [numero, letra] = n.split("-");
  const grafado = Number(numero) <= 9 ? `${numero}º` : numero.replace(/\B(?=(\d{3})+$)/g, ".");
  return `${grafado}${letra ? `-${String.fromCharCode(64 + Number(letra))}` : ""}`;
};

/** "art85_par2_inc1" → "art. 85, § 2º, inciso I". */
export function citar(chaveCompleta: string): string {
  const [artigo, ...resto] = chaveCompleta.split(",")[0].split("_");
  const partes = [`art. ${ordinal(artigo.slice(3))}`];
  for (const p of resto) {
    let m: RegExpExecArray | null;
    if (p === "cpt") partes.push("caput");
    else if (p === "par1u") partes.push("parágrafo único");
    else if ((m = /^par(.+)$/.exec(p))) partes.push(`§ ${ordinal(m[1])}`);
    else if ((m = /^inc(\d+)$/.exec(p))) partes.push(`inciso ${aRomano(Number(m[1]))}`);
    else if ((m = /^ali(\d+)$/.exec(p))) partes.push(`alínea ${String.fromCharCode(96 + Number(m[1]))}`);
    else partes.push(p);
  }
  return partes.join(", ");
}

function aRomano(n: number): string {
  const tabela: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let r = "";
  for (const [valor, letras] of tabela) while (n >= valor) { r += letras; n -= valor; }
  return r;
}

function versaoDe(v: Bruto): Versao {
  const consolida = objeto(v.legislationConsolidates);
  const tipo = texto(v.legislationType);
  return {
    ...(texto(v.legislationDate) && { data: texto(v.legislationDate) }),
    ...(tipo && { tipoNaFonte: tipo }),
    ...(texto(v.text) && { texto: texto(v.text) }),
    ...(texto(consolida?.name) && { alteradoPor: texto(consolida?.name) }),
    ...(texto(v.publisherNote) && { notaDaFonte: texto(v.publisherNote) }),
    ...(texto(v.temporalCoverage) && { periodoNaFonte: texto(v.temporalCoverage) }),
    ...(texto(v.legislationLegalForce) && { forcaMarcadaPelaFonte: texto(v.legislationLegalForce) }),
  };
}

/** O nó e seus descendentes, em ordem de leitura, só os que têm redação com texto (ou várias redações listadas). */
function partesDe(raiz: Bruto): Parte[] {
  const partes: Parte[] = [];
  const andar = (n: Bruto) => {
    const versoes = versoesDoNo(n).map(versaoDe);
    const ultima = versoes[versoes.length - 1];
    const algumTexto = versoes.some((v) => v.texto);
    if (algumTexto) {
      const nome = versoesDoNo(n).map((v) => texto(v.name)).filter(Boolean).pop();
      const marca = texto(n.legislationLegalForce);
      partes.push({
        dispositivo: citar(baseDoId(n)!),
        ...(nome && { rotuloNaFonte: nome }),
        ...(ultima?.texto && { texto: ultima.texto }),
        versoesNaFonte: versoes,
        ...(marca && { marcaDaFonteNoDispositivo: marca }),
        ...(algumTexto && !ultima?.texto && {
          observacao: "A redação mais recente que a fonte lista não traz texto; veja versoesNaFonte.",
        }),
      });
    }
    for (const filho of lista(n.hasPart)) {
      const f = objeto(filho);
      if (f && baseDoId(f)) andar(f);
    }
  };
  andar(raiz);
  return partes;
}

const urlDaFonte = (diploma: Diploma) => `https://${HOST}/api/public/normas?urn=${diploma.urn}&&tipo_documento=maior-detalhe`;

function consultarNaResposta(diploma: Diploma, nomeDaNorma: string, pedido: Pedido, corpo: Bruto): Consulta {
  const base = { diploma: { sigla: diploma.sigla, nome: nomeDaNorma }, dispositivo: citar(pedido.chave), urlDaConsulta: urlDaFonte(diploma) };
  const nos = nosComChave(corpo.hasPart, pedido.chave);
  if (nos.length === 0) {
    return { resultado: "não verificado", ...base, motivo: "A fonte não traz este dispositivo; confira o número no texto oficial." };
  }
  if (nos.length > 1) {
    return {
      resultado: "identificação necessária",
      ...base,
      motivo: "Mais de um dispositivo da fonte tem esta identificação; informe qual deles.",
      candidatos: nos.map((n) => ({ dispositivo: citar(texto(n.legislationIdentifier)!.split("!")[1]), urlOficial: texto(n["@id"]) ?? "" })),
    };
  }
  const no = nos[0];
  const partes = partesDe(no);
  const urlOficial = texto(no["@id"]);
  if (!partes.some((p) => p.texto || p.versoesNaFonte?.some((v) => v.texto))) {
    return { resultado: "não verificado", ...base, ...(urlOficial && { urlOficial }), motivo: "A fonte não traz texto para este dispositivo." };
  }
  return {
    resultado: "encontrado",
    ...base,
    urlOficial: urlOficial ?? "",
    partes,
    versaoDaFonte: {
      ...(texto(corpo.dateModified) && { modificadaEm: texto(corpo.dateModified) }),
      ...(texto(corpo.sdDatePublished) && { publicadaEm: texto(corpo.sdDatePublished) }),
    },
    licenca: texto(corpo.license) ?? LICENCA,
    creditos: CREDITOS,
  };
}

const dia = (instante: number) => {
  const d = new Date(instante);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

export interface FontesLegislacao {
  cliente: Cliente;
  memoria?: Memoria;
  agora?: () => number;
}

export async function textoDeLei(
  { diploma: pedidoDoDiploma, dispositivo }: { diploma: string; dispositivo: string },
  { cliente, memoria, agora = Date.now }: FontesLegislacao,
): Promise<RespostaTextoDeLei> {
  const diploma = acharDiploma(pedidoDoDiploma);
  const pedido = lerDispositivo(dispositivo);
  const chave = createHash("sha256").update(JSON.stringify(["legislacao", diploma.urn, pedido.chave])).digest("hex");

  const guardada = await memoria?.obterConsulta(chave, "legislacao", ehConsulta);
  if (guardada) {
    return completar(guardada.dado as Consulta, guardada.obtidoEm, `consulta guardada: fotografia da consulta feita no normas.leg.br em ${dia(guardada.obtidoEm)}, devolvida pela memória do Garimpo sem nova chamada`);
  }
  const resposta = await cliente.requisitar(urlDaFonte(diploma), { headers: { Accept: "application/json" } });
  let corpo: Bruto | undefined;
  try {
    corpo = objeto(JSON.parse(await resposta.text()));
  } catch {
    corpo = undefined;
  }
  if (!corpo) throw new FormatoInesperadoError("O normas.leg.br devolveu uma resposta que não é o texto da norma. Tente mais tarde ou confira no site oficial.");
  const nomeDaNorma = texto(corpo.headline) ?? texto(corpo.name) ?? diploma.sigla;
  const consulta = consultarNaResposta(diploma, nomeDaNorma, pedido, corpo);
  const obtidoEm = agora();
  memoria?.guardarConsulta(chave, "legislacao", consulta);
  return completar(consulta, obtidoEm, `consultado no normas.leg.br em ${dia(obtidoEm)}`);
}

function completar(c: Consulta, obtidoEm: number, obtido: string): RespostaTextoDeLei {
  const dataDeObtencao = dia(obtidoEm);
  return {
    ...c,
    dataDeObtencao,
    obtido,
    aviso:
      c.resultado === "encontrado"
        ? `texto conforme a página oficial em ${dataDeObtencao}; o Garimpo não afirma vigência`
        : `nenhum texto verificado em ${dataDeObtencao}; o Garimpo não afirma vigência nem existência do dispositivo`,
  };
}
