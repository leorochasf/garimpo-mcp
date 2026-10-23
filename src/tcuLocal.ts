/**
 * TCU (ADR-0025), parte local: arquivos já baixados, recibo, pesquisa e leitura sob pedido. Sem rede.
 * Nunca guarda nem devolve INTERESSADOS e ADVOGADO (o leitor de CSV já os descarta).
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { filtroLocal } from "./filtroLocal.js";
import { htmlParaTexto } from "./html.js";
import { blocosDoArquivo, lerRegistrosTcu, type RegistroDoTcu } from "./tcu.js";
import {
  ConstrutorDoIndice, copiaPropria, estruturaDoTermo, IndiceInvalidoError, IndiceTcu, intersecao, lerBytes, linhasDoCsv, normalizar,
} from "./tcuIndice.js";

/** O que fica ao lado do CSV de cada ano: de onde veio, quando e com que hash. */
export interface ReciboTcu {
  ano: number;
  url: string;
  bytes: number;
  sha256: string;
  etag?: string;
  /** `Last-Modified` do TCU: a data da base, do lado do TCU. */
  lastModified?: string;
  /** ISO, de quando o usuário baixou. */
  baixadoEm: string;
  /** Data da lista do TCU na hora do download (dd/mm/aaaa). */
  listaEm?: string;
}

export const pastaDoTcu = (dados: string) => join(dados, "tcu");
export const caminhoDoAnoTcu = (dados: string, ano: number) => join(pastaDoTcu(dados), `acordao-completo-${ano}.csv`);
export const caminhoDoReciboTcu = (dados: string, ano: number) => join(pastaDoTcu(dados), `acordao-completo-${ano}.recibo.json`);

export async function lerReciboTcu(dados: string, ano: number): Promise<ReciboTcu | undefined> {
  try {
    const r = JSON.parse(await readFile(caminhoDoReciboTcu(dados, ano), "utf8")) as ReciboTcu;
    return r && r.ano === ano && typeof r.baixadoEm === "string" ? r : undefined;
  } catch {
    return undefined;
  }
}

/** Anos com arquivo completo na pasta (os `.parcial` não contam). */
export async function anosBaixadosTcu(dados: string): Promise<number[]> {
  try {
    return (await readdir(pastaDoTcu(dados)))
      .flatMap((n) => n.match(/^acordao-completo-(\d{4})\.csv$/)?.[1] ?? [])
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export interface BaseDoAno {
  ano: number;
  /** Data da base no TCU (`Last-Modified`), ou "não informada" se o arquivo veio sem recibo. */
  atualizadoNoTcuEm: string;
  baixadoEm: string;
}

async function baseDoAno(dados: string, ano: number): Promise<BaseDoAno> {
  const r = await lerReciboTcu(dados, ano);
  return { ano, atualizadoNoTcuEm: r?.lastModified ?? "não informada", baixadoEm: r?.baixadoEm ?? "não informada" };
}

export const ATRIBUICAO_TCU =
  "Fonte: Tribunal de Contas da União, dados abertos do TCU (arquivos anuais de acórdãos), baixados pelo usuário; cite " +
  'como "TCU, Acórdão N/AAAA – Colegiado, relator X; dados abertos do TCU, base de <data>". Sumário do TCU não é ementa. ' +
  "Confira no portal do TCU antes de citar.";

// ---------------------------------------------------------------------------------------------------------------
// Pesquisa local
// ---------------------------------------------------------------------------------------------------------------

const ATE_TRECHO = 100;
const TAMANHO_SUMARIO = 600;
const LIMITE_PADRAO = 10;
const LIMITE_MAXIMO = 50;
const CAMPOS_DE_TEXTO = ["TITULO", "ASSUNTO", "SUMARIO", "ACORDAO", "DECISAO", "RELATORIO", "VOTO"] as const;
const SITUACAO_SEM_TEXTO = /invalidad|sigilos/;
const ENTIDADE_HTML = /&(?:[a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/;
const SEM_ACENTO =(t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Aviso que o TCU grava no lugar de sumário, relatório ou voto classificados como sigilosos (art. 108, § 1º, Lei 8.443/1992). */
const AVISO_DE_SIGILO = /^Documento classificado como sigiloso/i;
const TAMANHO_MAXIMO_DO_AVISO = 600;
export type ParteSigilosa = "sumario" | "relatorio" | "voto";

/** Texto limpo do campo; o aviso de sigilo do TCU não é conteúdo e vira vazio (a parte é dada como sigilosa). */
function textoDoCampo(r: Record<string, string>, coluna: string): { texto: string; sigiloso: boolean } {
  const texto = htmlParaTexto(r[coluna] ?? "");
  const sigiloso = texto.length < TAMANHO_MAXIMO_DO_AVISO && AVISO_DE_SIGILO.test(texto);
  return { texto: sigiloso ? "" : texto, sigiloso };
}

export const linkOficialTcu = (chave: string) => `https://pesquisa.apps.tcu.gov.br/redireciona/acordao-completo/${chave}`;

export interface FiltrosTcu {
  consulta: string;
  anos?: number[];
  tipo?: string;
  colegiado?: string;
  relator?: string;
  limite?: number;
}

export interface AcordaoTcu {
  chave: string;
  numero: string;
  ano: string;
  titulo: string;
  colegiado: string;
  dataSessao: string;
  relator: string;
  tipo: string;
  situacao: string;
  /** Resumo do TCU (campo SUMARIO): sumário, nunca ementa. */
  sumario: string;
  trechos: string[];
  /** Só o acórdão comum traz relatório e voto; o de relação traz só o texto. Falso também se o TCU os classificou como sigilosos. */
  temRelatorioEVoto: boolean;
  /** Partes que o TCU substituiu pelo aviso de documento sigiloso (o acórdão continua listado com o texto ACORDAO). */
  partesSigilosas?: ParteSigilosa[];
  linkOficial: string;
}

export interface ResultadoTcu {
  total: number;
  resultados: AcordaoTcu[];
  anosUsados: BaseDoAno[];
  anosSemArquivo: number[];
  /** Registros INVALIDADO ou sigilosos ignorados nos anos pesquisados. */
  excluidosPorSituacao: number;
  /** Quantos anos foram pesquisados (pelo índice local ou lendo o arquivo inteiro) e em quanto tempo. */
  anosPercorridos: number;
  tempoSegundos: number;
  /** Por ano: pesquisado pelo índice local ou lendo o arquivo inteiro, e por quê. */
  indiceLocal?: IndiceLocalTcu;
  /** O texto oficial cita nomes de pessoas no corpo; o Garimpo não os retira. */
  avisoNomes: string;
  atribuicao: string;
  aviso?: string;
}

export interface IndiceLocalTcu {
  comIndice: number[];
  semIndice: { ano: number; motivo: string }[];
}

/** Palavras soltas e frases entre aspas. */
function termosDe(consulta: string): string[] {
  return [...consulta.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
}

/** dd/mm/aaaa (ou ISO) → número ordenável; sem data = 0. */
function ordemDaData(d: string): number {
  const br = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return Number(br[3] + br[2] + br[1]);
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? Number(iso[1] + iso[2] + iso[3]) : 0;
}

/** Até dois trechos em volta da primeira ocorrência dos dois primeiros termos. */
function trechosDe(texto: string, termos: string[]): string[] {
  const plano = texto.replace(/\s+/g, " ");
  const baixo = SEM_ACENTO(plano);
  const trechos: string[] = [];
  for (const termo of termos.slice(0, 2)) {
    const i = baixo.indexOf(SEM_ACENTO(termo));
    if (i < 0) continue;
    const de = Math.max(0, i - ATE_TRECHO);
    const ate = Math.min(plano.length, i + termo.length + ATE_TRECHO);
    const trecho = `${de > 0 ? "…" : ""}${plano.slice(de, ate).trim()}${ate < plano.length ? "…" : ""}`;
    if (!trechos.includes(trecho)) trechos.push(trecho);
  }
  return trechos;
}

const recorte = (t: string, max: number) => (t.length > max ? `${t.slice(0, max).trimEnd()}…` : t);

// O mesmo tratamento de cada registro serve à varredura e ao índice: é o que garante a mesma resposta pelos dois.

const excluidoPorSituacao = (r: RegistroDoTcu) => SITUACAO_SEM_TEXTO.test(SEM_ACENTO(r.SITUACAO ?? ""));
const brutoDe = (r: RegistroDoTcu) => CAMPOS_DE_TEXTO.map((c) => r[c] ?? "").join("\n");
const semEtiquetas = (bruto: string) => SEM_ACENTO(bruto.replace(/<[^>]*>/g, ""));

/**
 * Triagem barata: remove tags para não perder palavras divididas por marcação. Entidades HTML podem mudar as
 * palavras: nesses registros vale só a conferência completa.
 */
function passaTriagem(bruto: string, palavras: string[]): boolean {
  if (ENTIDADE_HTML.test(bruto)) return true;
  const baixo = semEtiquetas(bruto);
  return palavras.every((p) => baixo.includes(p));
}

/** O texto que a pesquisa compara (o aviso de sigilo não entra) e as partes que o TCU deu como sigilosas. */
function analisar(r: RegistroDoTcu): { texto: string; sigilosas: ParteSigilosa[] } {
  const sigilosas: ParteSigilosa[] = [];
  const texto = CAMPOS_DE_TEXTO.map((c) => {
    const { texto: t, sigiloso } = textoDoCampo(r, c);
    if (sigiloso) sigilosas.push(c.toLowerCase() as ParteSigilosa);
    return t;
  })
    .filter(Boolean)
    .join("\n");
  return { texto, sigilosas };
}

function montarAcordao(r: RegistroDoTcu, texto: string, sigilosas: ParteSigilosa[], termos: string[]): AcordaoTcu {
  return {
    chave: r.KEY, numero: r.NUMACORDAO, ano: r.ANOACORDAO, titulo: r.TITULO, colegiado: r.COLEGIADO,
    dataSessao: r.DATASESSAO, relator: r.RELATOR, tipo: r.TIPO, situacao: r.SITUACAO,
    sumario: recorte(textoDoCampo(r, "SUMARIO").texto, TAMANHO_SUMARIO),
    trechos: trechosDe(texto, termos),
    temRelatorioEVoto: Boolean(textoDoCampo(r, "RELATORIO").texto && textoDoCampo(r, "VOTO").texto),
    ...(sigilosas.length ? { partesSigilosas: sigilosas } : {}),
    linkOficial: linkOficialTcu(r.KEY),
  };
}

const ordemDe = (r: RegistroDoTcu): [number, number] => [ordemDaData(r.DATASESSAO ?? ""), Number(r.NUMACORDAO) || 0];

/** Um acórdão achado: já montado (varredura) ou a montar lendo o registro do arquivo (índice). */
type Achado = AcordaoTcu | (() => Promise<AcordaoTcu>);

/** Os `limite` mais recentes, na ordem em que chegam (no empate fica o que chegou antes). */
class Melhores {
  readonly itens: { ordem: [number, number]; achado: Achado }[] = [];
  constructor(private readonly limite: number) {}
  considerar(ordem: [number, number], achado: () => Achado): void {
    const pior = this.itens[this.itens.length - 1];
    if (this.itens.length >= this.limite && (ordem[0] < pior.ordem[0] || (ordem[0] === pior.ordem[0] && ordem[1] <= pior.ordem[1]))) return;
    this.itens.push({ ordem, achado: achado() });
    this.itens.sort((a, b) => b.ordem[0] - a.ordem[0] || b.ordem[1] - a.ordem[1]);
    this.itens.length = Math.min(this.itens.length, this.limite);
  }
}

interface Consulta {
  termos: string[];
  palavras: string[];
  passa: (texto: string) => boolean;
  tipo?: string;
  colegiado?: string;
  relator?: string;
}

const passaFiltros = (c: Consulta, tipo: string, colegiado: string, relator: string) =>
  !(c.tipo && SEM_ACENTO(tipo) !== c.tipo) &&
  !(c.colegiado && !SEM_ACENTO(colegiado).includes(c.colegiado)) &&
  !(c.relator && !SEM_ACENTO(relator).includes(c.relator));

/** Varredura de um ano: lê o arquivo inteiro, um registro na memória por vez. */
async function varrerAno(dados: string, ano: number, c: Consulta, melhores: Melhores): Promise<{ total: number; excluidos: number }> {
  let total = 0;
  let excluidos = 0;
  for await (const r of lerRegistrosTcu(blocosDoArquivo(caminhoDoAnoTcu(dados, ano)))) {
    if (excluidoPorSituacao(r)) {
      excluidos++;
      continue;
    }
    if (!passaFiltros(c, r.TIPO ?? "", r.COLEGIADO ?? "", r.RELATOR ?? "")) continue;
    if (!passaTriagem(brutoDe(r), c.palavras)) continue;
    const { texto, sigilosas } = analisar(r);
    if (!c.passa(texto)) continue;
    total++;
    melhores.considerar(ordemDe(r), () => montarAcordao(r, texto, sigilosas, c.termos));
  }
  return { total, excluidos };
}

// ---------------------------------------------------------------------------------------------------------------
// Índice local (ADR-0025, "Decisão de velocidade 1.2")
// ---------------------------------------------------------------------------------------------------------------

export const caminhoDoIndiceTcu = (dados: string, ano: number) => join(pastaDoTcu(dados), `acordao-completo-${ano}.indice`);

/** Um documento do índice: início e tamanho em bytes no CSV, chave, tipo, colegiado, relator, data e número (ordem), conferir. */
type DocumentoDoIndice = [
  inicio: number, tamanho: number, chave: string, tipo: string, colegiado: string, relator: string, data: number, numero: number,
  conferir: 0 | 1,
];

interface MetaDoIndice {
  ano: number;
  /** O arquivo do ano de que o índice nasceu: tamanho, data de modificação e sha256 (o mesmo do recibo). */
  csv: { bytes: number; mtimeMs: number; sha256: string };
  /** A 1ª linha do CSV (nomes das colunas), para ler um registro solto pelo mesmo leitor da varredura. */
  cabecalhoCsv: string;
  excluidos: number;
  /** "conferir" (último campo) marca o registro que a triagem barata poderia recusar: esse é sempre conferido no texto. */
  documentos: DocumentoDoIndice[];
}

export interface IndiceCriadoTcu {
  ano: number;
  documentos: number;
  palavras: number;
  bytesDoIndice: number;
  bytesDoArquivo: number;
  segundos: number;
}

/** Cada pedaço do texto comparado (entre espaços) está no texto bruto sem etiquetas: a triagem não recusaria o registro. */
function triagemNaoRecusa(normalizado: string, semTags: string): boolean {
  let de = 0;
  for (const pedaco of normalizado.split(" ")) {
    if (!pedaco) continue;
    const i = semTags.indexOf(pedaco, de);
    if (i >= 0) de = i + pedaco.length;
    else if (!semTags.includes(pedaco)) return false;
  }
  return true;
}

/** Um registro solto do CSV, pelo mesmo leitor da varredura. */
async function registroDaLinha(cabecalho: string, linha: string): Promise<RegistroDoTcu | undefined> {
  for await (const r of lerRegistrosTcu((async function* () { yield cabecalho; yield linha; })())) return r;
  return undefined;
}

/**
 * Cria (ou recria) o índice de um ano baixado. Só de arquivo com recibo, e só se o arquivo bate com o sha256 do
 * recibo: o índice fica amarrado a esse arquivo, e qualquer troca o invalida. Sem rede.
 */
export async function criarIndiceTcu(dados: string, ano: number): Promise<IndiceCriadoTcu> {
  const inicio = Date.now();
  const csv = caminhoDoAnoTcu(dados, ano);
  const recibo = await lerReciboTcu(dados, ano);
  if (!recibo?.sha256) throw new Error(`O ano ${ano} do TCU não tem recibo com sha256: o índice só nasce de arquivo baixado pelo Garimpo.`);
  const antes = await stat(csv);
  const hash = createHash("sha256");
  const construtor = new ConstrutorDoIndice();
  const documentos: DocumentoDoIndice[] = [];
  let cabecalho: string | undefined;
  let excluidos = 0;
  for await (const { inicio: em, bytes } of linhasDoCsv(csv, (b) => hash.update(b))) {
    const linha = bytes.toString("utf8");
    if (cabecalho === undefined) {
      cabecalho = linha.replace(/^﻿/, "");
      continue;
    }
    const r = await registroDaLinha(cabecalho, linha);
    if (!r) continue;
    if (excluidoPorSituacao(r)) {
      excluidos++;
      continue;
    }
    const bruto = brutoDe(r);
    const normalizado = normalizar(analisar(r).texto);
    const conferir = !ENTIDADE_HTML.test(bruto) && !triagemNaoRecusa(normalizado, semEtiquetas(bruto));
    construtor.adicionar(normalizado);
    const [data, numero] = ordemDe(r);
    const [chave, tipo, colegiado, relator] = [r.KEY, r.TIPO ?? "", r.COLEGIADO ?? "", r.RELATOR ?? ""].map(copiaPropria);
    documentos.push([em, bytes.length, chave, tipo, colegiado, relator, data, numero, conferir ? 1 : 0]);
  }
  // Cabeçalho sem nenhum registro também passa pelo leitor (que recusa cabeçalho inesperado).
  if (cabecalho !== undefined && !documentos.length) await registroDaLinha(cabecalho, "");
  const depois = await stat(csv);
  if (depois.size !== antes.size || depois.mtimeMs !== antes.mtimeMs) {
    throw new Error(`O arquivo de ${ano} do TCU mudou durante a criação do índice; nada foi gravado.`);
  }
  if (hash.digest("hex") !== recibo.sha256 || antes.size !== recibo.bytes) {
    throw new Error(`O arquivo de ${ano} do TCU não confere com o recibo (sha256 ou tamanho): o índice não foi criado. Baixe o ano de novo.`);
  }
  const meta: MetaDoIndice = {
    ano, csv: { bytes: antes.size, mtimeMs: antes.mtimeMs, sha256: recibo.sha256 }, cabecalhoCsv: cabecalho ?? "", excluidos, documentos,
  };
  const gravado = await construtor.gravar(caminhoDoIndiceTcu(dados, ano), meta);
  return {
    ano, documentos: gravado.documentos, palavras: gravado.palavras, bytesDoIndice: gravado.bytes, bytesDoArquivo: antes.size,
    segundos: Math.round((Date.now() - inicio) / 100) / 10,
  };
}

/** Índices já abertos neste processo, pelo tamanho e data do arquivo do índice. */
const abertos = new Map<string, { marca: string; indice: IndiceTcu<MetaDoIndice> }>();

/**
 * Arquivos do ano cujo conteúdo já foi conferido neste processo (sha256 igual ao do índice), com a marca do arquivo na
 * hora: tamanho, datas de modificação e de alteração (ctime, que o sistema atualiza a cada escrita e a cada troca de
 * data) e número do arquivo no disco. Marca diferente = o conteúdo é conferido de novo antes de o índice valer.
 */
const conferidos = new Map<string, string>();

async function sha256DoArquivo(caminho: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const bloco of createReadStream(caminho, { highWaterMark: 1 << 20 })) hash.update(bloco);
  return hash.digest("hex");
}

const marcaDoArquivo = (s: { size: number; mtimeMs: number; ctimeMs: number; ino: number } | undefined, sha256: string) =>
  s && `${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.ino}:${sha256}`;

const RECRIAR = "Para criar o índice, use baixar_anos_tcu com renovar: true e confirmar: true.";

/** O índice do ano, se existe e vale para o arquivo baixado agora; senão, o motivo (e a pesquisa varre o ano). */
export async function indiceDoAnoTcu(dados: string, ano: number): Promise<{ indice: IndiceTcu<MetaDoIndice> } | { motivo: string }> {
  const caminho = caminhoDoIndiceTcu(dados, ano);
  const [recibo, doIndice, doCsv] = await Promise.all([
    lerReciboTcu(dados, ano),
    stat(caminho).catch(() => undefined),
    stat(caminhoDoAnoTcu(dados, ano)).catch(() => undefined),
  ]);
  if (!doIndice) return { motivo: `Ano sem índice local: a pesquisa leu o arquivo inteiro. ${RECRIAR}` };
  if (!recibo?.sha256) return { motivo: "Ano sem recibo do download: o índice não é usado e a pesquisa leu o arquivo inteiro." };
  const marca = `${doIndice.size}:${doIndice.mtimeMs}`;
  let aberto = abertos.get(caminho);
  if (aberto?.marca !== marca) {
    abertos.delete(caminho);
    try {
      aberto = { marca, indice: await IndiceTcu.abrir<MetaDoIndice>(caminho) };
    } catch (e) {
      if (!(e instanceof IndiceInvalidoError)) throw e;
      return { motivo: `Índice local recusado (${e.message}): a pesquisa leu o arquivo inteiro. ${RECRIAR}` };
    }
    abertos.set(caminho, aberto);
  }
  const m = aberto.indice.meta;
  if (m?.ano !== ano || m.csv?.sha256 !== recibo.sha256 || m.csv.bytes !== doCsv?.size || m.csv.mtimeMs !== doCsv?.mtimeMs) {
    return { motivo: `O arquivo do ano mudou depois do índice: o índice não é usado e a pesquisa leu o arquivo inteiro. ${RECRIAR}` };
  }
  // Tamanho e data iguais não provam o mesmo conteúdo: o sha256 do arquivo é conferido na 1ª vez neste processo e
  // sempre que o arquivo for tocado (revisão G1).
  const csv = caminhoDoAnoTcu(dados, ano);
  const marcaCsv = marcaDoArquivo(doCsv, m.csv.sha256);
  if (conferidos.get(csv) !== marcaCsv) {
    conferidos.delete(csv);
    const sha256 = await sha256DoArquivo(csv).catch(() => undefined);
    const depois = await stat(csv).catch(() => undefined);
    if (sha256 !== m.csv.sha256 || marcaDoArquivo(depois, m.csv.sha256) !== marcaCsv) {
      return {
        motivo:
          "O conteúdo do arquivo do ano mudou depois do índice (sha256 diferente, mesmo com tamanho e data iguais): o índice " +
          `não é usado e a pesquisa leu o arquivo inteiro. ${RECRIAR}`,
      };
    }
    conferidos.set(csv, marcaCsv!);
  }
  return aberto;
}

/**
 * Lê do arquivo do ano os registros que o índice aponta, conferindo chave, tipo, colegiado, relator e situação: se o
 * arquivo mudar depois da conferência do sha256, a pesquisa inteira é refeita lendo os arquivos.
 */
async function lerDoIndice(dados: string, ano: number, m: MetaDoIndice, docs: DocumentoDoIndice[]): Promise<RegistroDoTcu[]> {
  const csv = await open(caminhoDoAnoTcu(dados, ano), "r");
  try {
    const lidos: RegistroDoTcu[] = [];
    for (const d of docs) {
      const [inicio, tamanho, chave, tipo, colegiado, relator] = d;
      const r = await registroDaLinha(m.cabecalhoCsv, (await lerBytes(csv, inicio, tamanho)).toString("utf8"));
      if (!r || r.KEY !== chave || (r.TIPO ?? "") !== tipo || (r.COLEGIADO ?? "") !== colegiado || (r.RELATOR ?? "") !== relator || excluidoPorSituacao(r)) {
        throw new IndiceInvalidoError("o registro no arquivo não é o que o índice aponta");
      }
      lidos.push(r);
    }
    return lidos;
  } finally {
    await csv.close();
  }
}

/** Pesquisa de um ano pelo índice. `undefined` = consulta que o índice não ajuda (termo sem letra nem número). */
async function pesquisarNoIndice(
  dados: string,
  ano: number,
  indice: IndiceTcu<MetaDoIndice>,
  c: Consulta,
  melhores: Melhores,
): Promise<{ total: number; excluidos: number } | undefined> {
  const termos = c.termos.map(normalizar);
  if (termos.some((t) => !estruturaDoTermo(t).palavras.length)) return undefined;
  const m = indice.meta;
  // Fora do caso comum (pontuação no termo, ou pedaços da triagem que não são os do termo), confere-se no texto.
  let conferirTodos = c.termos.some((t, i) => t.split(/\s+/).map(SEM_ACENTO).filter(Boolean).join(" ") !== termos[i]);
  let candidatos: Uint32Array | undefined;
  const leitor = await indice.leitor();
  try {
    for (const t of termos) {
      const { documentos, exato } = await leitor.termo(t);
      if (!exato) conferirTodos = true;
      candidatos = candidatos ? intersecao(candidatos, documentos) : documentos;
      if (!candidatos.length) break;
    }
  } finally {
    await leitor.fechar();
  }
  const filtrados = [...(candidatos ?? [])].map((i) => {
    const d = m.documentos[i];
    if (!d) throw new IndiceInvalidoError("documento fora do índice");
    return d;
  }).filter(([, , , tipo, colegiado, relator]) => passaFiltros(c, tipo, colegiado, relator));
  const conferir = filtrados.filter(([, , , , , , , , marcado]) => conferirTodos || marcado);
  const recusados = new Set<DocumentoDoIndice>();
  (await lerDoIndice(dados, ano, m, conferir)).forEach((r, k) => {
    if (!passaTriagem(brutoDe(r), c.palavras) || !c.passa(analisar(r).texto)) recusados.add(conferir[k]);
  });
  const achados = filtrados.filter((d) => !recusados.has(d));
  for (const d of achados) {
    const [, , , , , , data, numero] = d;
    melhores.considerar([data, numero], () => async () => {
      const [r] = await lerDoIndice(dados, ano, m, [d]);
      const { texto, sigilosas } = analisar(r);
      return montarAcordao(r, texto, sigilosas, c.termos);
    });
  }
  return { total: achados.length, excluidos: m.excluidos };
}

export interface OpcoesDaPesquisaTcu {
  /** false = varre os arquivos mesmo com índice (para comparar e medir). Padrão: usa o índice que valer. */
  indice?: boolean;
}

/** Pesquisa nos anos já baixados, sem rede: pelo índice local de cada ano, ou varrendo o arquivo do ano. */
export async function pesquisarTcu(dados: string, f: FiltrosTcu, opcoes: OpcoesDaPesquisaTcu = {}): Promise<ResultadoTcu> {
  const locais = await anosBaixadosTcu(dados);
  const pedidos = f.anos?.length ? [...new Set(f.anos)] : locais;
  const anos = pedidos.filter((a) => locais.includes(a)).sort((a, b) => a - b);
  const vazio: ResultadoTcu = {
    total: 0, resultados: [], anosUsados: [], anosSemArquivo: pedidos.filter((a) => !locais.includes(a)),
    excluidosPorSituacao: 0, anosPercorridos: 0, tempoSegundos: 0, avisoNomes: AVISO_NOMES, atribuicao: ATRIBUICAO_TCU,
  };
  if (!anos.length) {
    return { ...vazio, aviso: "Nenhum ano do TCU baixado neste computador. Use baixar_anos_tcu para ver os anos e escolher quais baixar." };
  }
  const inicio = Date.now();
  const termos = termosDe(f.consulta);
  if (!termos.length) return { ...vazio, anosUsados: await Promise.all(anos.map((a) => baseDoAno(dados, a))), aviso: "Consulta vazia." };
  const c: Consulta = {
    termos,
    palavras: termos.flatMap((t) => t.split(/\s+/)).map(SEM_ACENTO).filter(Boolean),
    passa: filtroLocal({ deveConter: termos.map((t) => [t]) })!,
    tipo: f.tipo && SEM_ACENTO(f.tipo.trim()),
    colegiado: f.colegiado && SEM_ACENTO(f.colegiado.trim()),
    relator: f.relator && SEM_ACENTO(f.relator.trim()),
  };
  const limite = Math.min(Math.max(f.limite ?? LIMITE_PADRAO, 1), LIMITE_MAXIMO);

  const tentar = async (usarIndice: boolean, recusa?: string) => {
    const melhores = new Melhores(limite);
    const indiceLocal: IndiceLocalTcu = { comIndice: [], semIndice: [] };
    let total = 0;
    let excluidos = 0;
    for (const ano of anos) {
      const achado = usarIndice ? await indiceDoAnoTcu(dados, ano) : { motivo: recusa ?? "Pesquisa pedida sem o índice: o arquivo do ano foi lido inteiro." };
      const doIndice = "indice" in achado ? await pesquisarNoIndice(dados, ano, achado.indice, c, melhores) : undefined;
      if (doIndice) indiceLocal.comIndice.push(ano);
      else {
        indiceLocal.semIndice.push({
          ano,
          motivo: "motivo" in achado ? achado.motivo : "Consulta com termo sem letra nem número: o índice não ajuda e o arquivo do ano foi lido inteiro.",
        });
      }
      const parcial = doIndice ?? (await varrerAno(dados, ano, c, melhores));
      total += parcial.total;
      excluidos += parcial.excluidos;
    }
    const resultados: AcordaoTcu[] = [];
    for (const { achado } of melhores.itens) resultados.push(typeof achado === "function" ? await achado() : achado);
    return { total, excluidos, resultados, indiceLocal };
  };
  let r: Awaited<ReturnType<typeof tentar>>;
  try {
    r = await tentar(opcoes.indice !== false);
  } catch (e) {
    // Índice que abriu bem mas não bate com o arquivo: a pesquisa inteira é refeita pela varredura.
    if (!(e instanceof IndiceInvalidoError)) throw e;
    r = await tentar(false, `Índice local não bate com o arquivo (${e.message}): a pesquisa leu o arquivo inteiro. ${RECRIAR}`);
  }
  return {
    ...vazio,
    total: r.total,
    resultados: r.resultados,
    anosUsados: await Promise.all(anos.map((a) => baseDoAno(dados, a))),
    excluidosPorSituacao: r.excluidos,
    anosPercorridos: anos.length,
    tempoSegundos: Math.round((Date.now() - inicio) / 100) / 10,
    indiceLocal: r.indiceLocal,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Leitura sob pedido
// ---------------------------------------------------------------------------------------------------------------

export type ParteTcu = "acordao" | "relatorio" | "voto" | "decisao" | "sumario";
const COLUNA_DA_PARTE: Record<ParteTcu, string> = {
  acordao: "ACORDAO", relatorio: "RELATORIO", voto: "VOTO", decisao: "DECISAO", sumario: "SUMARIO",
};
const TAMANHO_PAGINA = 30_000;
const AVISO_NOMES = "O texto oficial do TCU pode citar nomes de pessoas no corpo; o Garimpo não os retira.";

export interface PedidoDeLeituraTcu {
  ano: number;
  chave?: string;
  numero?: string;
  colegiado?: string;
  parte: ParteTcu;
  pagina?: number;
}

export interface LeituraTcu {
  encontrado: boolean;
  identificacao?: Pick<AcordaoTcu, "chave" | "numero" | "ano" | "titulo" | "colegiado" | "dataSessao" | "relator" | "tipo" | "linkOficial">;
  situacao?: string;
  parte: ParteTcu;
  pagina?: number;
  totalPaginas?: number;
  texto?: string;
  aviso?: string;
  base?: BaseDoAno;
  atribuicao: string;
}

/** Parágrafos juntados até o tamanho da página; parágrafo maior que a página é fatiado. */
function paginar(texto: string): string[] {
  const paginas: string[] = [];
  let atual = "";
  for (const par of texto.split("\n")) {
    for (let i = 0; i < Math.max(par.length, 1); i += TAMANHO_PAGINA) {
      const parte = par.slice(i, i + TAMANHO_PAGINA);
      if (atual && atual.length + parte.length + 1 > TAMANHO_PAGINA) {
        paginas.push(atual);
        atual = parte;
      } else atual = atual ? `${atual}\n${parte}` : parte;
    }
  }
  if (atual) paginas.push(atual);
  return paginas;
}

export async function lerAcordaoTcu(dados: string, p: PedidoDeLeituraTcu): Promise<LeituraTcu> {
  const base = { parte: p.parte, atribuicao: ATRIBUICAO_TCU, base: await baseDoAno(dados, p.ano) };
  if (!(await anosBaixadosTcu(dados)).includes(p.ano)) {
    return { ...base, encontrado: false, aviso: `O ano ${p.ano} do TCU não está baixado neste computador. Use baixar_anos_tcu.` };
  }
  if (!p.chave && !(p.numero && p.colegiado)) {
    return { ...base, encontrado: false, aviso: "Informe a chave do acórdão ou o número e o colegiado." };
  }
  const colegiado = p.colegiado && SEM_ACENTO(p.colegiado.trim());
  for await (const r of lerRegistrosTcu(blocosDoArquivo(caminhoDoAnoTcu(dados, p.ano)))) {
    const ehEsse = p.chave ? r.KEY === p.chave : r.NUMACORDAO === p.numero && SEM_ACENTO(r.COLEGIADO ?? "") === colegiado;
    if (!ehEsse) continue;
    const identificacao = {
      chave: r.KEY, numero: r.NUMACORDAO, ano: r.ANOACORDAO, titulo: r.TITULO, colegiado: r.COLEGIADO,
      dataSessao: r.DATASESSAO, relator: r.RELATOR, tipo: r.TIPO, linkOficial: linkOficialTcu(r.KEY),
    };
    const comum = { ...base, encontrado: true, identificacao, situacao: r.SITUACAO, base: await baseDoAno(dados, p.ano) };
    if (SITUACAO_SEM_TEXTO.test(SEM_ACENTO(r.SITUACAO ?? ""))) {
      return { ...comum, aviso: `Acórdão com situação ${r.SITUACAO}: o Garimpo não mostra o texto. Confira no portal do TCU.` };
    }
    const { texto, sigiloso } = textoDoCampo(r, COLUNA_DA_PARTE[p.parte]);
    if (sigiloso) {
      return {
        ...comum,
        aviso:
          `Os dados desta parte (${p.parte}) foram classificados como sigilosos pelo TCU: o arquivo traz só o aviso de ` +
          'sigilo no lugar do texto. O texto do acórdão (parte "acordao") continua disponível.',
      };
    }
    if (!texto) {
      const relacao = /rela[cç][aã]o/i.test(r.TIPO ?? "") && p.parte !== "acordao";
      return {
        ...comum,
        aviso: relacao
          ? `Acórdão de relação não tem ${p.parte}: traz só o texto do acórdão (parte "acordao").`
          : `O arquivo do TCU não traz ${p.parte} para este acórdão.`,
      };
    }
    const paginas = paginar(texto);
    const pagina = Math.min(Math.max(p.pagina ?? 1, 1), paginas.length);
    return {
      ...comum,
      pagina,
      totalPaginas: paginas.length,
      texto: paginas[pagina - 1],
      aviso: AVISO_NOMES,
    };
  }
  return { ...base, encontrado: false, aviso: `Não achei esse acórdão no arquivo baixado de ${p.ano}.` };
}
