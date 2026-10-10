/**
 * Precedentes qualificados ao vivo (ADR-0020): o consultar_precedente busca o precedente no portal do tribunal, na
 * hora da pergunta, pelo cliente único (serviços próprios no disjuntor: stj-precedentes e stf-precedentes), e guarda o
 * resultado na memória por 24 h. Qualquer falha (recusa, pausa, rede, página que o Garimpo não reconhece) sobe como
 * erro: quem chama usa a tabela empacotada como plano B. Rotas e formato: docs/banco-de-provas/precedentes-ao-vivo-prova.md.
 */

import { createHash } from "node:crypto";
import { Cliente, FormatoInesperadoError, type OpcoesCliente } from "./cliente.js";
import { enquadrarQualificado } from "./enquadramento.js";
import { htmlParaTexto } from "./html.js";
import { dataEHora, type Memoria } from "./memoria.js";
import type { LinhaDaTabela, TipoNaTabela } from "./tabelaDePrecedentes.js";
import { type LinhaDoStf, PAGINAS_DO_STF, type TipoNoStf } from "./tabelaDoStf.js";

/** Prazo de cada chamada: passado dele, a tabela responde (o usuário está esperando a resposta). */
const PRAZO_MS = 30_000;

export function clienteDosPrecedentes(tribunal: "stj" | "stf", extra: Partial<OpcoesCliente> = {}): Cliente {
  return new Cliente({ nome: `O portal do ${tribunal.toUpperCase()}`, prazoMs: PRAZO_MS, ...extra });
}

/** A página de um tema repetitivo (T) ou IAC (I) no portal do STJ. */
export function paginaDoStj(tipo: TipoNaTabela, numero: number): string {
  return (
    "https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?novaConsulta=true" +
    `&tipo_pesquisa=${tipo === "IAC" ? "I" : "T"}&cod_tema_inicial=${numero}&cod_tema_final=${numero}`
  );
}

const PORTAL_STF = "https://portal.stf.jus.br";

/** A ficha de um tema de repercussão geral no portal do STF: traz a situação e o endereço da página com a tese. */
export const fichaDoTemaStf = (numero: number) => `${PORTAL_STF}/jurisprudenciaRepercussao/tema.asp?num=${numero}`;

/** O precedente lido no portal, com o instante da consulta e o endereço da página. */
export interface DoPortal<L> {
  linha: L;
  endereco: string;
  /** Instante (ms) da consulta ao portal; o da consulta original, se veio da memória. */
  consultadoEm: number;
  daMemoria: boolean;
  /** STJ: "Última atualização" que a página informa. */
  ultimaAtualizacao?: string;
  /** Súmulas: instante (ms) em que a lista, de onde vem a marca de situação, foi lida no portal. */
  listaObtidaEm?: number;
}

/**
 * Texto da resposta, no conjunto de caracteres que ela declara (o STJ responde em ISO-8859-1). Redirecionamento não é
 * seguido: o salto sairia do disjuntor do destino, levaria o UA de navegador para fora do portal e seria uma chamada a
 * mais; vira erro e, portanto, plano B.
 */
async function textoDe(cliente: Cliente, url: string): Promise<string> {
  const resposta = await cliente.requisitar(url, { redirect: "error" });
  const charset = /charset="?([\w-]+)/i.exec(resposta.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
  return new TextDecoder(charset).decode(await resposta.arrayBuffer());
}

const naoReconhecida = (onde: string, falta: string) =>
  new FormatoInesperadoError(`${onde} veio sem ${falta}: a página pode ter mudado ou o número não existir lá.`);

const opcional = <K extends string>(chave: K, valor: string | undefined) =>
  (valor ? { [chave]: valor } : {}) as Partial<Record<K, string>>;

/** O conteúdo do <div> que começa em `inicio` (o índice do "<div"), contando os divs aninhados. */
function conteudoDoDiv(html: string, inicio: number): string | undefined {
  const abre = html.indexOf(">", inicio);
  if (abre < 0) return undefined;
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = abre + 1;
  let nivel = 1;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    nivel += m[1] ? -1 : 1;
    if (nivel === 0) return html.slice(abre + 1, m.index);
  }
  return undefined;
}

/** O texto do campo do STJ cujo rótulo (div titulo_campo…) é `rotulo`: o div dados_campo… que vem logo depois. */
function campoDoStj(html: string, rotulo: string): string | undefined {
  const r = new RegExp(`<div class="[^"]*titulo_campo[^"]*">\\s*${rotulo}\\s*</div>\\s*(<div class="[^"]*dados_campo)`, "i");
  const m = r.exec(html);
  if (!m) return undefined;
  const conteudo = conteudoDoDiv(html, m.index + m[0].length - m[1].length);
  return (conteudo && htmlParaTexto(conteudo)) || undefined;
}

/**
 * Lê a página de precedentes do STJ. Confere que o 1º documento é o tipo e o número pedidos (com código de tipo
 * errado, o portal devolve outro tipo sem erro) e que traz a situação; o resto entra se estiver lá.
 */
export function lerPaginaDoStj(html: string, tipo: TipoNaTabela, numero: number) {
  const onde = `A página do ${tipo} ${numero} no portal do STJ`;
  const doc1 = html.indexOf("Documento 1");
  const doc2 = html.indexOf("Documento 2");
  const doc = doc1 < 0 ? "" : html.slice(doc1, doc2 < 0 ? undefined : doc2);
  const letra = tipo === "IAC" ? "I" : "T";
  if (!new RegExp(`copiarLinkTema\\(\\s*'${letra}',\\s*'${numero}'`).test(doc)) throw naoReconhecida(onde, `o ${tipo} ${numero}`);
  const situacao = campoDoStj(doc, "Situação");
  if (!situacao) throw naoReconhecida(onde, "a situação");
  const paradigma = /title="Paradigma Principal"[\s\S]*?<b>([^<]+)<\/b>/.exec(doc)?.[1].trim();
  const linha: LinhaDaTabela = {
    tipo,
    numero,
    situacao,
    ...opcional("teseFirmada", campoDoStj(doc, "Tese Firmada")),
    ...opcional("questaoSubmetida", campoDoStj(doc, "Questão submetida a julgamento")),
    ...opcional("orgaoJulgador", campoDoStj(doc, "Órgão julgador")),
    ...(paradigma ? { processosParadigma: [paradigma] } : {}),
  };
  const ultimaAtualizacao = /Última atualização:\s*(\d{2}\/\d{2}\/\d{4})/.exec(doc)?.[1];
  return { linha, ultimaAtualizacao };
}

/** O texto do <p> que vem logo depois do rótulo (div tema-campo) da ficha do tema. */
function campoDaFicha(html: string, rotulo: string): string | undefined {
  const m = new RegExp(`<div class="tema-campo">\\s*${rotulo}:\\s*</div>\\s*<p>([\\s\\S]*?)</p>`, "i").exec(html);
  return (m && htmlParaTexto(m[1])) || undefined;
}

/**
 * Lê a ficha do tema (tema.asp). Confere o número e só aceita o endereço da página da tese na forma conhecida
 * (verAndamentoProcesso.asp com incidente, processo, classe e o mesmo tema): nunca segue outro endereço.
 */
export function lerFichaDoTemaStf(html: string, numero: number) {
  const onde = `A ficha do tema ${numero} no portal do STF`;
  const m = /<div class="tema-numero">[\s\S]*?<a\b[^>]*href="([^"]*)"[^>]*>\s*(\d+)\s*<\/a>/.exec(html);
  if (!m || Number(m[2]) !== numero) throw naoReconhecida(onde, `o tema ${numero}`);
  const href = m[1].replace(/&amp;/g, "&");
  const forma = new RegExp(
    `^verAndamentoProcesso\\.asp\\?incidente=\\d+&numeroProcesso=\\d+&classeProcesso=[A-Za-z]+&numeroTema=${numero}$`,
  );
  if (!forma.test(href)) throw naoReconhecida(onde, "o endereço da página do tema na forma conhecida");
  const situacao = campoDaFicha(html, "Situação");
  if (!situacao) throw naoReconhecida(onde, "a situação");
  const titulo = /<div class="tema-titulo-link">[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/.exec(html)?.[1];
  const paradigma = campoDaFicha(html, "Leading Case");
  const linha: LinhaDoStf = {
    tipo: "repercussão geral",
    numero,
    situacao,
    ...opcional("titulo", titulo && htmlParaTexto(titulo)),
    ...opcional("haRepercussao", campoDaFicha(html, "Repercussão geral")),
    ...opcional("relator", campoDaFicha(html, "Ministro")),
    ...(paradigma ? { processosParadigma: [paradigma] } : {}),
  };
  return { paginaDaTese: `${PORTAL_STF}/jurisprudenciaRepercussao/${href}`, linha };
}

/** Lê a página do tema (verAndamentoProcesso.asp): confere o número; a tese entra se a página a trouxer. */
export function lerPaginaDaTeseStf(html: string, numero: number) {
  const cabecalho = /<p class="tema__RG">\s*<strong>\s*Tema (\d+) -/.exec(html);
  if (!cabecalho || Number(cabecalho[1]) !== numero) {
    throw naoReconhecida(`A página do tema ${numero} no portal do STF`, `o tema ${numero}`);
  }
  const dd = (rotulo: string) => {
    const m = new RegExp(`<dt>\\s*${rotulo}:\\s*</dt>\\s*<dd>([\\s\\S]*?)</dd>`, "i").exec(html);
    return (m && htmlParaTexto(m[1])) || undefined;
  };
  return { teseFirmada: dd("Tese"), relator: dd("Relator\\(a\\)") };
}

type TipoDeSumula = "súmula" | "súmula vinculante";
const BASE_DA_LISTA: Record<TipoDeSumula, string> = { súmula: "30", "súmula vinculante": "26" };
const ROTULO_DE_SUMULA = /^Súmula( Vinculante)? (\d+)(?: \(([^()]+)\))?$/;
/** O portal põe espaço de largura zero no meio da marca ("cance&#8203;lada"). */
const rotuloLimpo = (html: string) =>
  htmlParaTexto(html).replace(/[\u200b-\u200d\u2060\ufeff]/g, "").replace(/\s+/g, " ").trim();

/** Item da lista de súmulas: o número, o código interno da página e a marca de situação, se houver. */
export type ItemDaLista = [numero: number, codigo: string, marca?: string];

/** Lê a lista de súmulas ou de súmulas vinculantes: só itens com o código da página na forma conhecida. */
export function lerListaDeSumulas(html: string, tipo: TipoDeSumula): ItemDaLista[] {
  const itens: ItemDaLista[] = [];
  const forma = new RegExp(`^sumariosumulas\\.asp\\?base=${BASE_DA_LISTA[tipo]}&sumula=(\\d+)$`);
  for (const m of html.matchAll(/<div class="sumula-item">\s*<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const rotulo = rotuloLimpo(m[2]).match(ROTULO_DE_SUMULA);
    const codigo = forma.exec(m[1].replace(/&amp;/g, "&"))?.[1];
    if (!rotulo || !codigo || Boolean(rotulo[1]) !== (tipo === "súmula vinculante")) continue;
    itens.push(rotulo[3] ? [Number(rotulo[2]), codigo, rotulo[3]] : [Number(rotulo[2]), codigo]);
  }
  if (!itens.length) {
    throw naoReconhecida(`A lista de ${tipo === "súmula" ? "súmulas" : "súmulas vinculantes"} do portal do STF`, "itens na forma conhecida");
  }
  return itens;
}

/** Lê a página da súmula: confere tipo e número no título e devolve o enunciado (o 1º bloco de texto). */
export function lerPaginaDaSumula(html: string, tipo: TipoDeSumula, numero: number): string {
  const m = /<div class="titulo">([\s\S]*?)<\/div>\s*(<div class="parCOM">)/.exec(html);
  const rotulo = m && rotuloLimpo(m[1]).match(ROTULO_DE_SUMULA);
  // O bloco inteiro, com os divs aninhados: o 1º </div> pode ser de um filho e cortaria o enunciado.
  const conteudo = m ? conteudoDoDiv(html, m.index + m[0].length - m[2].length) : undefined;
  const enunciado = conteudo && htmlParaTexto(conteudo);
  if (!rotulo || Boolean(rotulo[1]) !== (tipo === "súmula vinculante") || Number(rotulo[2]) !== numero || !enunciado) {
    throw naoReconhecida(`A página da ${tipo} ${numero} no portal do STF`, `o enunciado da ${tipo} ${numero}`);
  }
  return enunciado;
}

/** Chave da memória: sha256 do pedido. */
const chave = (...partes: (string | number)[]) =>
  createHash("sha256").update(`precedente-ao-vivo|${partes.join("|")}`).digest("hex");

interface Guardado<L> {
  linha: L;
  endereco: string;
  ultimaAtualizacao?: string;
  listaObtidaEm?: number;
}

/** A mesma validade da memória do Garimpo (24 h). */
const VALIDADE_MS = 24 * 3_600_000;

const ehGuardado = (d: unknown): d is Guardado<unknown> =>
  typeof d === "object" && d !== null && typeof (d as Guardado<unknown>).endereco === "string" &&
  typeof (d as Guardado<unknown>).linha === "object" && (d as Guardado<unknown>).linha !== null;

const ehLista = (d: unknown): d is ItemDaLista[] =>
  Array.isArray(d) && d.every((i) => Array.isArray(i) && Number.isInteger(i[0]) && typeof i[1] === "string");

export class PrecedentesAoVivo {
  private readonly agora: () => number;

  constructor(
    private readonly stj: Cliente,
    private readonly stf: Cliente,
    private readonly memoria: Memoria,
    agora?: () => number,
  ) {
    this.agora = agora ?? Date.now;
  }

  /** O tema repetitivo ou IAC no portal do STJ (1 chamada), ou da memória de 24 h. */
  async doStj(tipo: TipoNaTabela, numero: number): Promise<DoPortal<LinhaDaTabela>> {
    return this.lembrado(chave("stj", tipo, numero), async () => {
      const endereco = paginaDoStj(tipo, numero);
      const { linha, ultimaAtualizacao } = lerPaginaDoStj(await textoDe(this.stj, endereco), tipo, numero);
      return { linha, endereco, ...(ultimaAtualizacao ? { ultimaAtualizacao } : {}) };
    });
  }

  /**
   * O precedente do STF no portal, ou da memória de 24 h. Repercussão geral: ficha e página da tese (2 chamadas).
   * Súmula e súmula vinculante: lista do tipo (guardada 24 h à parte) e página da súmula (2 chamadas; 1 com a lista).
   */
  async doStf(tipo: TipoNoStf, numero: number): Promise<DoPortal<LinhaDoStf>> {
    return this.lembrado(chave("stf", tipo, numero), async () => {
      if (tipo === "repercussão geral") {
        const ficha = lerFichaDoTemaStf(await textoDe(this.stf, fichaDoTemaStf(numero)), numero);
        const { teseFirmada, relator } = lerPaginaDaTeseStf(await textoDe(this.stf, ficha.paginaDaTese), numero);
        const linha: LinhaDoStf = {
          ...ficha.linha,
          ...opcional("teseFirmada", teseFirmada),
          ...opcional("relator", relator ?? ficha.linha.relator),
        };
        return { linha, endereco: ficha.paginaDaTese };
      }
      const lista = PAGINAS_DO_STF[tipo];
      const { dado: itens, obtidoEm: listaObtidaEm } = await this.guardadoOu(chave("stf-lista", tipo), ehLista, async () =>
        lerListaDeSumulas(await textoDe(this.stf, lista), tipo),
      );
      const item = itens.find(([n]) => n === numero);
      if (!item) {
        throw new FormatoInesperadoError(
          `A lista do portal do STF não traz a ${tipo} ${numero}: pode ser número errado ou a lista ter mudado.`,
        );
      }
      const endereco = `${lista}&sumula=${item[1]}`;
      const enunciado = lerPaginaDaSumula(await textoDe(this.stf, endereco), tipo, numero);
      return { linha: { tipo, numero, ...opcional("situacao", item[2]), enunciado, link: endereco }, endereco, listaObtidaEm };
    });
  }

  /** O dado guardado na memória (24 h) no formato esperado, ou o buscado agora, que é guardado. */
  private async guardadoOu<T>(k: string, valida: (d: unknown) => d is T, buscar: () => Promise<T>) {
    const guardada = await this.memoria.obterConsulta(k, "precedentes", valida).catch(() => undefined);
    if (guardada) return { dado: guardada.dado as T, obtidoEm: guardada.obtidoEm, daMemoria: true };
    const dado = await buscar();
    this.memoria.guardarConsulta(k, "precedentes", dado);
    return { dado, obtidoEm: this.agora(), daMemoria: false };
  }

  /**
   * A resposta da memória (24 h) ou buscada agora. A resposta composta vence junto com o componente mais antigo: nas
   * súmulas, a lista de onde veio a marca, que pode ter sido lida antes da página.
   */
  private async lembrado<L>(k: string, buscar: () => Promise<Guardado<L>>): Promise<DoPortal<L>> {
    const guardada = await this.memoria.obterConsulta(k, "precedentes", ehGuardado).catch(() => undefined);
    const dado = guardada?.dado as Guardado<L> | undefined;
    const listaVencida = dado?.listaObtidaEm !== undefined && this.agora() - dado.listaObtidaEm >= VALIDADE_MS;
    if (guardada && dado && !listaVencida) return { ...dado, consultadoEm: guardada.obtidoEm, daMemoria: true };
    const novo = await buscar();
    this.memoria.guardarConsulta(k, "precedentes", novo);
    return { ...novo, consultadoEm: this.agora(), daMemoria: false };
  }
}

/** "consultado no portal do STJ em 09/10/2026 14:03 (hora local, UTC-03:00)", com a nota da memória, se for o caso. */
function origem(tribunal: "stj" | "stf", d: DoPortal<unknown>): string {
  const base = `consultado no portal do ${tribunal.toUpperCase()} em ${dataEHora(d.consultadoEm)}`;
  return d.daMemoria ? `${base}; da memória do Garimpo (consulta feita nas últimas 24 h)` : base;
}

/** Resposta do consultar_precedente com o tema ou IAC lido no portal do STJ. */
export function respostaDoStj(d: DoPortal<LinhaDaTabela>) {
  const { linha } = d;
  const quando = dataEHora(d.consultadoEm);
  return {
    tribunal: "stj",
    tipo: linha.tipo,
    numero: linha.numero,
    consta: true,
    origem: origem("stj", d),
    situacaoNaFonte: linha.situacao,
    situacaoEm: `situação no portal do STJ em ${quando}, como a fonte a escreve: é situação processual, não vigência`,
    teseFirmada: linha.teseFirmada ?? "sem tese firmada na página do portal",
    ...(linha.questaoSubmetida
      ? { questaoSubmetida: linha.questaoSubmetida, notaQuestaoSubmetida: "questão submetida a julgamento: é a pergunta afetada, não a tese" }
      : {}),
    ...(linha.orgaoJulgador ? { orgaoJulgador: linha.orgaoJulgador } : {}),
    processoParadigma: linha.processosParadigma ?? "processo paradigma não identificado na página do portal",
    ...(d.ultimaAtualizacao ? { ultimaAtualizacaoNoPortal: d.ultimaAtualizacao } : {}),
    endereco: d.endereco,
    enquadramento927: enquadrarQualificado(
      { tribunal: "stj", tipo: linha.tipo, numero: String(linha.numero) },
      { data: quando, linha, consulta: true, portal: `portal do STJ em ${quando}` },
    ),
  };
}

/** Resposta do consultar_precedente com a repercussão geral, súmula ou súmula vinculante lida no portal do STF. */
export function respostaDoStf(d: DoPortal<LinhaDoStf>) {
  const { linha } = d;
  const quando = dataEHora(d.consultadoEm);
  const sumula = linha.tipo !== "repercussão geral";
  // Nas súmulas, a marca é da lista, com a hora em que a lista foi lida (pode ser anterior à da página).
  const daLista = dataEHora(d.listaObtidaEm ?? d.consultadoEm);
  const situacao = sumula
    ? {
        situacaoNaFonte: linha.situacao ? `marcada como "${linha.situacao}" na lista do STF` : "sem marca de situação na lista do STF",
        situacaoEm:
          `lista do portal do STF em ${daLista}: a marca é o rótulo entre parênteses da lista, não vigência; a falta de ` +
          "marca não prova que a súmula está em vigor",
      }
    : {
        situacaoNaFonte: linha.situacao,
        situacaoEm: `situação no portal do STF em ${quando}, como a fonte a escreve: é situação processual, não vigência`,
      };
  return {
    tribunal: "stf",
    tipo: linha.tipo,
    numero: linha.numero,
    consta: true,
    origem: origem("stf", d),
    ...situacao,
    ...(sumula
      ? { enunciado: linha.enunciado }
      : { teseFirmada: linha.teseFirmada ?? "sem tese na página do tema no portal" }),
    ...(linha.titulo ? { titulo: linha.titulo, notaTitulo: "título do tema: descreve a questão, não é a tese" } : {}),
    ...(linha.haRepercussao ? { haRepercussao: linha.haRepercussao } : {}),
    ...(linha.relator ? { relator: linha.relator } : {}),
    ...(sumula ? {} : { processoParadigma: linha.processosParadigma ?? "processo paradigma não identificado na página do portal" }),
    endereco: d.endereco,
    enquadramento927: enquadrarQualificado(
      { tribunal: "stf", tipo: linha.tipo, numero: String(linha.numero), tese: linha.teseFirmada },
      sumula
        ? { tribunal: "stf", data: daLista, linha, consulta: true, portal: `lista do portal do STF em ${daLista}` }
        : { tribunal: "stf", data: quando, linha, consulta: true, portal: `portal do STF em ${quando}` },
    ),
  };
}
