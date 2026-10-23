/**
 * texto_de_lei: o texto LITERAL de um dispositivo de lei (artigo, parágrafo, inciso, alínea) como a página oficial de
 * normas.leg.br o mostra, com URL, data de obtenção e as marcas de alteração/revogação que a fonte traz. Nunca afirma
 * vigência, não reconstitui alteração e não liga artigo a precedente (D-12, ADR-0026). Fonte, termos e limites:
 * docs/fontes.md. Diploma cuja resposta não traz a árvore de dispositivos (CP, CPP, CLT, CDC) é lido do HTML da
 * compilação que a própria resposta marca como "Current", com a marca de valor legal que ela dá.
 */

import { createHash } from "node:crypto";
import { Cliente, decodificar, FormatoInesperadoError, type OpcoesCliente } from "./cliente.js";
import { htmlParaTexto } from "./html.js";
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
  /**
   * Só nos diplomas lidos do HTML da compilação: o parágrafo exato, único no arquivo, depois do qual começa o texto
   * do diploma.
   */
  inicioNaCompilacao?: string;
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
  {
    sigla: "CP",
    urn: "urn:lex:br:federal:decreto.lei:1940-12-07;2848",
    apelidos: ["cp", "codigo penal", "decreto-lei 2848/1940", "decreto-lei 2848"],
    inicioNaCompilacao: "DECRETO-LEI Nº 2.848, DE 7 DE DEZEMBRO DE 1940",
  },
  {
    sigla: "CPP",
    urn: "urn:lex:br:federal:decreto.lei:1941-10-03;3689",
    apelidos: ["cpp", "codigo de processo penal", "decreto-lei 3689/1941", "decreto-lei 3689"],
    inicioNaCompilacao: "DECRETO-LEI Nº 3.689, DE 3 DE OUTUBRO DE 1941",
  },
  {
    // Só pela sigla e pelo nome: o Decreto-Lei 5.452/1943 tem arts. 1º e 2º próprios, antes da Consolidação que aprova.
    sigla: "CLT",
    urn: "urn:lex:br:federal:decreto.lei:1943-05-01;5452",
    apelidos: ["clt", "consolidacao das leis do trabalho"],
    inicioNaCompilacao: "CONSOLIDAÇÃO DAS LEIS DO TRABALHO",
  },
  {
    sigla: "CDC",
    urn: "urn:lex:br:federal:lei:1990-09-11;8078",
    apelidos: ["cdc", "codigo de defesa do consumidor", "codigo de protecao e defesa do consumidor", "lei 8078/1990", "lei 8078"],
    inicioNaCompilacao: "LEI Nº 8.078, DE 11 DE SETEMBRO DE 1990",
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

/** "10" e "-A" → "10-1", "359" e "-M-A" → "359-13-1"; a fonte numera as letras (A = 1) e escreve o número sem ponto. */
const comLetras = (numero: string, sufixos = "") =>
  numero.replace(/\./g, "") + [...sufixos.matchAll(/[A-Za-z]/g)].map((m) => `-${m[0].toLowerCase().charCodeAt(0) - 96}`).join("");

export interface Pedido {
  /** Como a fonte identifica o dispositivo, sem o sufixo de quem o acrescentou (ex.: "art85_par2_inc1"). */
  chave: string;
}

const ERRO_DISPOSITIVO =
  'Não entendi o dispositivo. Escreva o artigo e, se quiser, o que há dentro dele, por exemplo: "art. 85", ' +
  '"art. 85, caput", "art. 85, § 2º", "art. 85, § 2º, inciso I", "art. 85, § 2º, inciso I, alínea a", ' +
  '"art. 9º, parágrafo único" ou "art. 699-A". Um dispositivo por pedido.';

/**
 * O que pode vir depois do que já foi lido: artigo → caput, §, inciso ou alínea (as duas últimas, do caput); caput ou
 * § → inciso ou alínea (alínea direto no caput ou no §, como na CLT); inciso → alínea.
 */
type Etapa = "artigo" | "caput" | "inciso" | "alinea";

export function lerDispositivo(texto: string): Pedido {
  let resto = texto.trim().replace(/[º°ª]/g, "");
  const artigo = /^art(?:igo)?s?\.?\s*(\d+(?:\.\d{3})*)((?:\s*-\s*[A-Za-z]\b)*)/i.exec(resto);
  if (!artigo) throw new Error(ERRO_DISPOSITIVO);
  let chave = `art${comLetras(artigo[1], artigo[2])}`;
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
    } else if (etapa === "artigo" && (m = /^(?:§|par\.?|par[aá]grafo)\s*(\d+)((?:\s*-\s*[A-Za-z]\b)*)/i.exec(resto))) {
      chave += `_par${comLetras(m[1], m[2])}`;
      etapa = "caput";
    } else if ((etapa === "artigo" || etapa === "caput") && (m = /^(?:inciso|inc\.?)\s+([ivxlcdm]+)\b/i.exec(resto) ?? /^([IVXLCDM]+)\b/.exec(resto))) {
      // Inciso logo depois do artigo é inciso do caput.
      chave += `${etapa === "artigo" ? "_cpt" : ""}_inc${deRomano(m[1])}`;
      etapa = "inciso";
    } else if (etapa !== "alinea" && (m = /^(?:al[ií]nea|al\.?)\s+([a-z])\b/i.exec(resto) ?? /^([a-z])\b(?!\.)/.exec(resto))) {
      // Alínea logo depois do artigo é alínea do caput.
      chave += `${etapa === "artigo" ? "_cpt" : ""}_ali${m[1].toLowerCase().charCodeAt(0) - 96}`;
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

/** O arquivo da compilação de onde o texto saiu, com a versão e o valor legal como a fonte os marca. */
export interface ArquivoDaFonte {
  url: string;
  versaoNaFonte: string;
  tipoNaFonte?: string;
  valorLegalMarcadoPelaFonte?: string;
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
  /** Só nos diplomas lidos da compilação: a URL oficial é a da norma, e o texto vem deste arquivo. */
  arquivoDaFonte?: ArquivoDaFonte;
}

export interface ConsultaSemTexto {
  resultado: "não verificado";
  diploma: { sigla: string; nome: string };
  dispositivo: string;
  motivo: string;
  urlOficial?: string;
  urlDaConsulta: string;
  arquivoDaFonte?: ArquivoDaFonte;
}

export interface ConsultaAmbigua {
  resultado: "identificação necessária";
  diploma: { sigla: string; nome: string };
  dispositivo: string;
  motivo: string;
  /** Na compilação, a URL é a da norma: o rótulo e o primeiro parágrafo de cada um, literais, os distinguem. */
  candidatos: { dispositivo: string; urlOficial: string; rotuloNaFonte?: string; textoNaFonte?: string }[];
  urlDaConsulta: string;
  arquivoDaFonte?: ArquivoDaFonte;
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
function nosComChave(raiz: unknown, chave: string, urn: string): Bruto[] {
  const achados: Bruto[] = [];
  const andar = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(andar);
    const o = objeto(n);
    if (!o) return;
    if (baseDoId(o) === chave && texto(o.legislationIdentifier)?.startsWith(`${urn}!`)) achados.push(o);
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

/**
 * "6-1" → "6º-A", "359-13-1" → "359-M-A", "1045" → "1.045": o jeito de citar. O ordinal vai só até o 9 (art. 9º, § 10),
 * como a lei escreve.
 */
const ordinal = (n: string) => {
  const [numero, ...letras] = n.split("-");
  const grafado = Number(numero) <= 9 ? `${numero}º` : numero.replace(/\B(?=(\d{3})+$)/g, ".");
  return grafado + letras.map((l) => `-${String.fromCharCode(64 + Number(l))}`).join("");
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

/** A URL devolvida deve identificar o mesmo dispositivo no host oficial. */
function urlOficialDoNo(n: Bruto): string {
  const endereco = texto(n["@id"]);
  try {
    const url = new URL(endereco ?? "");
    if (url.origin === `https://${HOST}` && !url.username && !url.password &&
        url.pathname === "/" && url.searchParams.get("urn") === texto(n.legislationIdentifier)) return endereco!;
  } catch { /* Ausência ou URL inválida: sem fonte verificável. */ }
  throw new FormatoInesperadoError("O normas.leg.br não trouxe a URL oficial correspondente ao dispositivo. Confira no site oficial.");
}

const urlDaFonte = (diploma: Diploma) => `https://${HOST}/api/public/normas?urn=${diploma.urn}&&tipo_documento=maior-detalhe`;

function consultarNaResposta(diploma: Diploma, nomeDaNorma: string, pedido: Pedido, corpo: Bruto): Consulta {
  const base = { diploma: { sigla: diploma.sigla, nome: nomeDaNorma }, dispositivo: citar(pedido.chave), urlDaConsulta: urlDaFonte(diploma) };
  const nos = nosComChave(corpo.hasPart, pedido.chave, diploma.urn);
  const urls = nos.map(urlOficialDoNo);
  if (nos.length === 0) {
    return { resultado: "não verificado", ...base, motivo: "A fonte não traz este dispositivo; confira o número no texto oficial." };
  }
  if (nos.length > 1) {
    return {
      resultado: "identificação necessária",
      ...base,
      motivo: "Mais de um dispositivo da fonte tem esta identificação; informe qual deles.",
      candidatos: nos.map((n, i) => ({ dispositivo: citar(texto(n.legislationIdentifier)!.split("!")[1]), urlOficial: urls[i] })),
    };
  }
  const no = nos[0];
  const partes = partesDe(no);
  const urlOficial = urls[0];
  if (!partes.some((p) => p.texto || p.versoesNaFonte?.some((v) => v.texto))) {
    return { resultado: "não verificado", ...base, ...(urlOficial && { urlOficial }), motivo: "A fonte não traz texto para este dispositivo." };
  }
  return {
    resultado: "encontrado",
    ...base,
    urlOficial,
    partes,
    versaoDaFonte: {
      ...(texto(corpo.dateModified) && { modificadaEm: texto(corpo.dateModified) }),
      ...(texto(corpo.sdDatePublished) && { publicadaEm: texto(corpo.sdDatePublished) }),
    },
    licenca: texto(corpo.license) ?? LICENCA,
    creditos: CREDITOS,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Diploma sem a árvore de dispositivos na resposta: o texto vem do HTML da compilação que ela marca como "Current".

/** O arquivo de texto de uma norma no normas.leg.br, como a resposta o aponta (prova de 2026-10-23). */
const CAMINHO_DO_ARQUIVO = /^\/api\/binario\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/texto$/;

/**
 * A única versão "Current" que a resposta lista, em HTML, num endereço https do normas.leg.br no formato conferido;
 * o arquivo é baixado pela forma pública do mesmo endereço. Outra coisa é formato inesperado: o Garimpo não escolhe.
 */
function arquivoDaCompilacao(corpo: Bruto): ArquivoDaFonte {
  const atuais = lista(corpo.encoding).map(objeto).filter((e): e is Bruto => e?.version === "Current");
  if (atuais.length !== 1) {
    throw new FormatoInesperadoError(
      `O normas.leg.br listou ${atuais.length} versões "Current" do texto da norma, e o Garimpo só lê quando há uma. Confira no site oficial.`,
    );
  }
  const [atual] = atuais;
  let uuid: string | undefined;
  try {
    const url = new URL(texto(atual.contentUrl) ?? "");
    if (url.protocol === "https:" && url.host === HOST && !url.username && !url.password && !url.search && !url.hash) {
      uuid = CAMINHO_DO_ARQUIVO.exec(url.pathname)?.[1];
    }
  } catch { /* Ausência ou URL inválida: sem arquivo verificável. */ }
  if (!uuid || !texto(atual.encodingFormat)?.endsWith("/text/html")) {
    throw new FormatoInesperadoError("O normas.leg.br não trouxe o arquivo do texto da norma no formato conferido. Confira no site oficial.");
  }
  const tipo = texto(atual.additionalType);
  const valor = texto(atual.legislationLegalValue);
  return {
    url: `https://${HOST}/api/public/binario/${uuid}/texto`,
    versaoNaFonte: "Current",
    ...(tipo && { tipoNaFonte: tipo }),
    ...(valor && { valorLegalMarcadoPelaFonte: valor }),
  };
}

async function htmlDaCompilacao(cliente: Cliente, url: string): Promise<string> {
  const resposta = await cliente.requisitar(url, { headers: { Accept: "text/html" }, redirect: "manual" });
  const tipo = resposta.headers.get("content-type") ?? "";
  if ((resposta.status >= 300 && resposta.status < 400) || !/text\/html/i.test(tipo)) {
    await resposta.body?.cancel();
    throw new FormatoInesperadoError(
      "O normas.leg.br não entregou o texto da norma em HTML no endereço pedido (redirecionou ou mudou o formato). Confira no site oficial.",
    );
  }
  return decodificar(new Uint8Array(await resposta.arrayBuffer()), tipo);
}

/** Etiquetas que separam parágrafos da compilação; o <br> fica dentro do parágrafo, como quebra de linha. */
const SEPARA_PARAGRAFO = /^(?:p|h[1-6]|div|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|body)$/i;

/** Cada <p>, <h1>–<h6> e célula da compilação vira um parágrafo de texto (htmlParaTexto), na ordem do arquivo. */
function paragrafosDaCompilacao(html: string): string[] {
  const corpo = html.slice(Math.max(0, html.search(/<body[\s>]/i))).replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const paragrafos: string[] = [];
  let inicio = 0;
  const fechar = (fim: number) => {
    const t = htmlParaTexto(corpo.slice(inicio, fim)).replace(/^[\s\u00ad\u200b]+|[\s\u00ad\u200b]+$/g, "");
    if (t) paragrafos.push(t);
  };
  for (const m of corpo.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    if (!SEPARA_PARAGRAFO.test(m[1])) continue;
    fechar(m.index);
    inicio = m.index + m[0].length;
  }
  fechar(corpo.length);
  return paragrafos;
}

/** "faixa": vários artigos num parágrafo só ("Arts. 22 a 24. (Revogados ...)"). */
type TipoDeDispositivo = "artigo" | "faixa" | "caput" | "paragrafo" | "inciso" | "alinea";

interface Rotulo {
  tipo: Exclude<TipoDeDispositivo, "caput">;
  /** O rótulo como a fonte o escreve ("Art. 359-M-A.", "Arts. 22 a 24.", "§ 2º", "Parágrafo único.", "I -", "a)"). */
  rotulo: string;
  /**
   * O pedaço da chave da fonte ("art359-13-1", "par2", "par1u", "inc1", "ali1"); vazio na faixa; ausente quando o número
   * é ilegível na fonte ("Art. l97.", "§ lº"): o rótulo ainda separa os dispositivos, mas o pedido pelo número não o acha.
   */
  segmento?: string;
  /** Só na faixa legível: o primeiro e o último artigo dela. */
  faixa?: [number, number];
  /** O texto do parágrafo depois do rótulo. */
  resto: string;
}

const romanoLegivel = (texto: string) => {
  try {
    return deRomano(texto);
  } catch {
    return undefined;
  }
};

/** O rótulo com que o parágrafo começa, se for de artigo, parágrafo, inciso ou alínea. */
function rotuloDe(paragrafo: string): Rotulo | undefined {
  let m: RegExpExecArray | null;
  const achado = (tipo: Rotulo["tipo"], segmento: string | undefined): Rotulo => ({
    tipo,
    rotulo: m![0].trim(),
    ...(segmento !== undefined && { segmento }),
    resto: paragrafo.slice(m![0].length).trimStart(),
  });
  // Em cada rótulo, a segunda alternativa (\S+) é o número ilegível na fonte.
  if ((m = /^Arts\.\s*(?:(\d+)[º°]?\s+a\s+(\d+)[º°]?\.?(?=\s|$)|\S+)/.exec(paragrafo))) {
    return { ...achado("faixa", ""), ...(m[1] && { faixa: [Number(m[1]), Number(m[2])] as [number, number] }) };
  }
  if ((m = /^Art\.\s*(?:(\d+(?:\.\d{3})*)[º°]?((?:-[A-Z])*)\.?(?=\s|$)|\S+)/.exec(paragrafo))) {
    return achado("artigo", m[1] && `art${comLetras(m[1], m[2])}`);
  }
  if ((m = /^§\s*(?:(\d+)[º°]?((?:-[A-Z])*)\.?(?=\s|$)|\S+)/.exec(paragrafo))) {
    return achado("paragrafo", m[1] && `par${comLetras(m[1], m[2])}`);
  }
  if ((m = /^Par[áa]grafo\s+[úu]nico\.?(?=\s|$)/.exec(paragrafo))) return achado("paragrafo", "par1u");
  if ((m = /^([IVXLCDM]+)\s*[-–—]/.exec(paragrafo))) {
    const numero = romanoLegivel(m[1]);
    return achado("inciso", numero === undefined ? undefined : `inc${numero}`);
  }
  if ((m = /^([a-z])\)/.exec(paragrafo))) return achado("alinea", `ali${m[1].charCodeAt(0) - 96}`);
  return undefined;
}

/** Um dispositivo achado na compilação: o pedaço da chave, o rótulo e a ocorrência (dois iguais são dois nós). */
interface No {
  tipo: TipoDeDispositivo;
  /** Ausente: número ilegível na fonte. */
  segmento?: string;
  rotulo: string;
  id: number;
  faixa?: [number, number];
}

/** Uma linha do texto e os dispositivos donos dela, do artigo ao mais fundo. */
interface Linha {
  caminho: No[];
  /** Só na linha que abre o dispositivo. */
  rotulo?: string;
  texto: string;
}

/** PARTE, LIVRO, TÍTULO, CAPÍTULO, Seção ou Subseção com o número (ou ÚNICO, GERAL, ESPECIAL): o parágrafo inteiro. */
const CABECALHO =
  /^(?:PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|Se[çc][ãa]o|SUBSE[ÇC][ÃA]O|Subse[çc][ãa]o)\s+(?:[IVXLCDM]+(?:-[A-Z])?|[ÚU]NIC[OA]|[ÚU]nic[oa]|GERAL|Geral|ESPECIAL|Especial)$/;
/** O fecho do diploma ("Brasília, 11 de setembro de 1990; 169º da Independência e 102º da República."). */
const FECHO = /^(?:Rio de Janeiro|Brasília),\s.*\d{4}\s*[;,].*Independência/;
/** A pena do tipo ("Pena - reclusão, ..."): é do caput ou do §, não do inciso nem da alínea. */
const PENA = /^Pena\s*[-–—:]/;
const SO_PARENTESES = /^\(.*\)$/s;

/** O texto sem os parênteses do fim ("Feminicídio (Nome jurídico acrescido ...)" → "Feminicídio"). */
function semParentesesNoFim(texto: string): string {
  let t = texto.trim();
  for (;;) {
    const m = /\s*\([^()]*(?:\([^()]*\)[^()]*)*\)$/.exec(t);
    if (!m || m.index === 0) return t;
    t = t.slice(0, m.index).trimEnd();
  }
}

/** Linha que, pela forma, pode ser rubrica (nome jurídico) ou nome: maiúscula no começo, sem pontuação no fim, curta. */
function pareceTitulo(paragrafo: string): boolean {
  const nucleo = semParentesesNoFim(paragrafo);
  return /^\p{Lu}/u.test(nucleo) && !/[.;:,?!]$/.test(nucleo) && nucleo.length <= 200;
}

const contar = (texto: string, aspa: string) => texto.split(aspa).length - 1;

/** As aspas que um parágrafo abre no começo e não fecha: texto de outra norma citado nos parágrafos seguintes. */
function aspasQueAbre(paragrafo: string): '"' | "“" | undefined {
  if (paragrafo.startsWith('"') && contar(paragrafo, '"') % 2 === 1) return '"';
  if (paragrafo.startsWith("“") && contar(paragrafo, "“") > contar(paragrafo, "”")) return "“";
  return undefined;
}

const fechaAspas = (paragrafo: string, aspas: '"' | "“") =>
  aspas === '"' ? contar(paragrafo, '"') % 2 === 1 : contar(paragrafo, "”") > contar(paragrafo, "“");

/**
 * Título solto: linha sem rótulo que parece título e vem logo antes (pulando notas só entre parênteses) de um rótulo,
 * de um cabeçalho, do fecho ou de outro título solto. É a rubrica da fonte, não texto do dispositivo.
 */
function titulosSoltos(paragrafos: string[], rotulos: (Rotulo | undefined)[]): boolean[] {
  const titulo = paragrafos.map(() => false);
  for (let i = paragrafos.length - 1; i >= 0; i--) {
    const p = paragrafos[i];
    if (rotulos[i] || CABECALHO.test(p) || PENA.test(p) || !pareceTitulo(p)) continue;
    let j = i + 1;
    while (j < paragrafos.length && SO_PARENTESES.test(paragrafos[j])) j++;
    titulo[i] = j === paragrafos.length || !!rotulos[j] || CABECALHO.test(paragrafos[j]) || titulo[j];
  }
  return titulo;
}

/**
 * As linhas do texto do diploma, do parágrafo de início ao fecho, cada uma com o dispositivo dono. O que vem depois do
 * fecho (as assinaturas) fica de fora; cabeçalho estrutural encerra o artigo, e o nome dele fica fora de artigo; título
 * solto e a nota entre parênteses logo depois dele ficam fora do texto.
 */
function linhasDaCompilacao(html: string, inicio: string): Linha[] {
  const todos = paragrafosDaCompilacao(html);
  const de = todos.indexOf(inicio) + 1;
  const ate = todos.findIndex((p, i) => de > 0 && i >= de && FECHO.test(p));
  if (de === 0 || todos.indexOf(inicio, de) >= 0 || ate < 0) {
    throw new FormatoInesperadoError(
      "O texto da norma no normas.leg.br não tem o começo ou o fecho no formato conferido; o Garimpo não recorta dispositivo dele. Confira no site oficial.",
    );
  }
  const paragrafos = todos.slice(de, ate);
  const rotulos = paragrafos.map(rotuloDe);
  const titulo = titulosSoltos(paragrafos, rotulos);
  const linhas: Linha[] = [];
  /** Do artigo ao dispositivo corrente; vazio fora de artigo. */
  let caminho: No[] = [];
  let notaDeTitulo = false;
  /** Aspas abertas de texto de outra norma: o que vier é texto do dispositivo corrente até elas fecharem. */
  let citacao: '"' | "“" | undefined;
  let id = 0;
  const no = (tipo: TipoDeDispositivo, segmento: string | undefined, rotulo: string): No => ({
    tipo,
    ...(segmento !== undefined && { segmento }),
    rotulo,
    id: id++,
  });
  for (const [i, p] of paragrafos.entries()) {
    const r = rotulos[i];
    // As aspas não passam de um artigo novo nem de um cabeçalho, mesmo sem fechar.
    if (citacao && !CABECALHO.test(p) && r?.tipo !== "artigo" && r?.tipo !== "faixa") {
      linhas.push({ caminho, texto: p });
      if (fechaAspas(p, citacao)) citacao = undefined;
      continue;
    }
    citacao = undefined;
    if (CABECALHO.test(p)) {
      caminho = [];
      continue;
    }
    if (titulo[i] || (notaDeTitulo && SO_PARENTESES.test(p))) {
      notaDeTitulo = true;
      continue;
    }
    notaDeTitulo = false;
    if (r?.tipo === "artigo") caminho = [no("artigo", r.segmento, r.rotulo), no("caput", "cpt", r.rotulo)];
    if (r?.tipo === "faixa") caminho = [{ ...no("faixa", "", r.rotulo), faixa: r.faixa }];
    if (!caminho.length) continue;
    // Na faixa não há dispositivo dentro: o que vier até o próximo artigo é texto dela.
    if (!r || (caminho[0].tipo === "faixa" && r.tipo !== "faixa")) {
      linhas.push({ caminho: PENA.test(p) ? caminho.slice(0, 2) : caminho, texto: p });
      citacao = aspasQueAbre(p);
      continue;
    }
    if (r.tipo === "paragrafo") caminho = [caminho[0], no("paragrafo", r.segmento, r.rotulo)];
    else if (r.tipo === "inciso") caminho = [caminho[0], caminho[1], no("inciso", r.segmento, r.rotulo)];
    // Alínea de inciso, ou direto no caput ou no § (como na CLT).
    else if (r.tipo === "alinea") caminho = [...caminho.slice(0, caminho[2]?.tipo === "inciso" ? 3 : 2), no("alinea", r.segmento, r.rotulo)];
    linhas.push({ caminho, rotulo: r.rotulo, texto: r.resto });
  }
  return linhas;
}

/** O dispositivo da linha, no jeito de citar; o de número ilegível na fonte vai com o rótulo como ela o escreve. */
function citarCaminho(caminho: No[]): string {
  const ilegivel = caminho.findIndex((n) => n.segmento === undefined);
  const legivel = (ate: number) => citar(caminho.slice(0, ate).map((n) => n.segmento).join("_"));
  return ilegivel < 0 ? legivel(caminho.length) : `${legivel(ilegivel)}, ${caminho[ilegivel].rotulo} (número ilegível na fonte)`;
}

/** Linhas seguidas do mesmo dispositivo formam uma parte, na ordem do texto. */
function partesDaCompilacao(linhas: Linha[]): Parte[] {
  const partes: Parte[] = [];
  let dono: number | undefined;
  for (const l of linhas) {
    const ultimo = l.caminho[l.caminho.length - 1];
    const parte = partes[partes.length - 1];
    if (parte && ultimo.id === dono && !l.rotulo) {
      parte.texto = parte.texto ? `${parte.texto}\n${l.texto}` : l.texto;
      continue;
    }
    partes.push({
      dispositivo: citarCaminho(l.caminho),
      ...(l.rotulo && { rotuloNaFonte: l.rotulo }),
      ...(l.texto && { texto: l.texto }),
    });
    dono = ultimo.id;
  }
  return partes;
}

async function consultarNaCompilacao(
  cliente: Cliente,
  diploma: Diploma,
  nomeDaNorma: string,
  pedido: Pedido,
  corpo: Bruto,
): Promise<Consulta> {
  if (texto(corpo.legislationIdentifier) !== diploma.urn) {
    throw new FormatoInesperadoError("O normas.leg.br devolveu uma norma diferente do diploma pedido ou sem identificação. Confira no site oficial.");
  }
  const arquivo = arquivoDaCompilacao(corpo);
  const urlOficial = urlOficialDoNo(corpo);
  const linhas = linhasDaCompilacao(await htmlDaCompilacao(cliente, arquivo.url), diploma.inicioNaCompilacao!);
  const base = { diploma: { sigla: diploma.sigla, nome: nomeDaNorma }, dispositivo: citar(pedido.chave), urlDaConsulta: urlDaFonte(diploma) };
  const segmentos = pedido.chave.split("_");
  // Artigo inteiro, sem letra, que a fonte pode trazer dentro de uma faixa ("Arts. 498 a 502.").
  const numero = Number(/^art(\d+)$/.exec(pedido.chave)?.[1]);
  const naFaixa = ({ faixa }: No) => !!faixa && !!numero && faixa[0] <= numero && numero <= faixa[1];
  /** As linhas com os k + 1 primeiros pedaços do pedido (no nível do artigo, também a faixa que o contém). */
  const ate = (k: number) => (l: Linha) =>
    (k === 0 && naFaixa(l.caminho[0])) || segmentos.slice(0, k + 1).every((s, j) => l.caminho[j]?.segmento === s);
  // Mais de uma ocorrência em algum nível do pedido (dois arts. 2º, dois §§ 1º no artigo): o Garimpo não escolhe.
  for (let k = 0; k < segmentos.length; k++) {
    const primeiras = new Map<number, Linha>();
    for (const l of linhas.filter(ate(k))) if (!primeiras.has(l.caminho[k].id)) primeiras.set(l.caminho[k].id, l);
    if (primeiras.size > 1) {
      return {
        resultado: "identificação necessária",
        ...base,
        motivo: "Mais de um dispositivo da fonte tem esta identificação; informe qual deles.",
        candidatos: [...primeiras.values()].map((l) => ({
          dispositivo: citar(segmentos.slice(0, k + 1).join("_")),
          urlOficial,
          rotuloNaFonte: l.caminho[k].rotulo,
          ...(l.texto && { textoNaFonte: l.texto }),
        })),
        arquivoDaFonte: arquivo,
      };
    }
  }
  const doPedido = linhas.filter(ate(segmentos.length - 1));
  if (!doPedido.some((l) => l.texto)) {
    return {
      resultado: "não verificado",
      ...base,
      urlOficial,
      motivo: doPedido.length ? "A fonte não traz texto para este dispositivo." : "A fonte não traz este dispositivo; confira o número no texto oficial.",
      arquivoDaFonte: arquivo,
    };
  }
  const faixa = doPedido[0].caminho[0].faixa;
  return {
    resultado: "encontrado",
    ...base,
    urlOficial,
    partes: faixa
      ? [
          {
            dispositivo: base.dispositivo,
            rotuloNaFonte: doPedido[0].rotulo,
            texto: doPedido.map((l) => l.texto).filter(Boolean).join("\n"),
            observacao: `A fonte traz os arts. ${ordinal(String(faixa[0]))} a ${ordinal(String(faixa[1]))} num só parágrafo; o texto é o dele.`,
          },
        ]
      : partesDaCompilacao(doPedido),
    versaoDaFonte: {
      ...(texto(corpo.dateModified) && { modificadaEm: texto(corpo.dateModified) }),
      ...(texto(corpo.sdDatePublished) && { publicadaEm: texto(corpo.sdDatePublished) }),
    },
    licenca: texto(corpo.license) ?? LICENCA,
    creditos: CREDITOS,
    arquivoDaFonte: arquivo,
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
  const chave = createHash("sha256").update(JSON.stringify(["legislacao-v2", diploma.urn, pedido.chave])).digest("hex");

  const guardada = await memoria?.obterConsulta(chave, "legislacao", ehConsulta);
  if (guardada) {
    return completar(guardada.dado as Consulta, guardada.obtidoEm, `consulta guardada: fotografia da consulta feita no normas.leg.br em ${dia(guardada.obtidoEm)}, devolvida pela memória do Garimpo sem nova chamada`);
  }
  const resposta = await cliente.requisitar(urlDaFonte(diploma), { headers: { Accept: "application/json" }, redirect: "manual" });
  if (resposta.status >= 300 && resposta.status < 400) {
    await resposta.body?.cancel();
    throw new FormatoInesperadoError("O normas.leg.br redirecionou a consulta; o destino não foi verificado. Confira no site oficial.");
  }
  let corpo: Bruto | undefined;
  try {
    corpo = objeto(JSON.parse(await resposta.text()));
  } catch {
    corpo = undefined;
  }
  if (!corpo) throw new FormatoInesperadoError("O normas.leg.br devolveu uma resposta que não é o texto da norma. Tente mais tarde ou confira no site oficial.");
  if (corpo.hasPart && texto(corpo.legislationIdentifier) !== diploma.urn) {
    throw new FormatoInesperadoError("O normas.leg.br devolveu uma norma diferente do diploma pedido ou sem identificação. Confira no site oficial.");
  }
  const nomeDaNorma = texto(corpo.headline) ?? texto(corpo.name) ?? diploma.sigla;
  const consulta = diploma.inicioNaCompilacao
    ? await consultarNaCompilacao(cliente, diploma, nomeDaNorma, pedido, corpo)
    : consultarNaResposta(diploma, nomeDaNorma, pedido, corpo);
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
