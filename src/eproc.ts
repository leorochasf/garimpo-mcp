/**
 * Módulo de jurisprudência do e-Proc, o mesmo software no TRF4 (ADR-0024), na TNU (ADR-0027) e no TRF2 (ADR-0028): busca oficial e inteiro
 * teor em HTML. Cada fonte é uma `FonteEproc`; o que muda entre elas (host, rota, campos do card, marca do documento) fica
 * na configuração, nunca em ramos soltos.
 * Tudo pelo Cliente único (UA honesto, freios da regra 3). A busca é 1 GET do formulário (sessão) e 1 POST, uma página
 * de 10; o inteiro teor é 1 GET do formulário e 1 GET do documento. O link de acompanhamento processual
 * (www.trf4.jus.br/trf4/processos/, vedado no robots.txt) só é mostrado: nunca chamado. A estrutura da lista foi conferida
 * em 2026-10-14 (TRF4) e 2026-10-19 (TNU) e reproduzida em recorte saneado: o que não bate vira erro de formato, nunca
 * lista vazia.
 */

import { createHash } from "node:crypto";
import { Cliente, decodificar, FormatoInesperadoError } from "./cliente.js";
import type { Acordao, ParametrosBusca, ResultadoBusca } from "./busca.js";
import { enquadrarAcordao } from "./enquadramento.js";
import { htmlComConteudoOculto, htmlComIndicioDeCorte, htmlParaTexto } from "./html.js";
import { fotografiaDaBusca, type Memoria, type TextoIntegral } from "./memoria.js";
import { ROTULO_TNU, ROTULO_TRF2, ROTULO_TRF4 } from "./tribunais.js";

/** O que muda de um e-Proc para outro; o resto do adaptador é comum. */
export interface FonteEproc {
  sigla: "trf2" | "trf4" | "tnu";
  /** Como o órgão aparece no número do processo («<cnj>/TRF4»). */
  nomeNoCnj: string;
  /** «O e-Proc do TRF4»: nome usado nas mensagens e no Cliente. */
  nome: string;
  host: string;
  /** Rota do controlador no host. */
  rota: string;
  rotulo: string;
  prefixoCookie: string;
  /** O card traz «ÓRGÃO JULGADOR» (TRF4 sim; a TNU não). */
  comOrgao: boolean;
  /** O card traz o link de acompanhamento processual, que só é mostrado (TRF4); a TNU não tem. */
  linkDeConsulta?: RegExp;
  /** Marca do documento do inteiro teor: sem ela a página não é o acórdão. */
  marcaDoDocumento: RegExp;
}

export const TRF4: FonteEproc = {
  sigla: "trf4",
  nomeNoCnj: "TRF4",
  nome: "O e-Proc do TRF4",
  host: "eproc-jur.trf4.jus.br",
  rota: "/eproc2trf4/externo_controlador.php",
  rotulo: ROTULO_TRF4,
  prefixoCookie: "TRF4_Eproc_",
  comOrgao: true,
  linkDeConsulta: /^https?:\/\/www\.trf4\.jus\.br\//i,
  marcaDoDocumento: /Documento eletrônico assinado por/i,
};

export const TRF2: FonteEproc = {
  sigla: "trf2",
  nomeNoCnj: "TRF2",
  nome: "O e-Proc do TRF2",
  host: "eproc.trf2.jus.br",
  rota: "/eproc/externo_controlador.php",
  rotulo: ROTULO_TRF2,
  prefixoCookie: "TRF2_Eproc_",
  comOrgao: true,
  // A consulta processual pública do próprio e-Proc: só mostrada, nunca chamada (como no TRF4).
  linkDeConsulta: /^https:\/\/eproc\.trf2\.jus\.br\/eproc\/externo_controlador\.php\?acao=processo_seleciona_publica&/i,
  marcaDoDocumento: /Documento eletrônico assinado por/i,
};

export const TNU: FonteEproc = {
  sigla: "tnu",
  nomeNoCnj: "TNU",
  nome: "O e-Proc da TNU",
  host: "eproctnu-jur.cjf.jus.br",
  rota: "/eproc/externo_controlador.php",
  rotulo: ROTULO_TNU,
  // É o valor que o próprio formulário da TNU traz (conferido em 2026-10-19).
  prefixoCookie: "TRF4_Eproc_",
  comOrgao: false,
  marcaDoDocumento: /Turma Nacional de Uniformização[\s\S]*Conferência de autenticidade emitida em/i,
};

const formularioDe = (f: FonteEproc) => `https://${f.host}${f.rota}?acao=jurisprudencia@jurisprudencia/pesquisar`;
const listarDe = (f: FonteEproc) => `https://${f.host}${f.rota}?acao=jurisprudencia@jurisprudencia/listar_resultados`;
const ACAO_INTEIRO_TEOR = "jurisprudencia@jurisprudencia/download_inteiro_teor";
/** Resultados da única página que o Garimpo lê (10 na prova de 2026-10-14; não promete estabilidade desse tamanho). */
export const LIMITE_MAXIMO_EPROC = 10;
/** Documento do e-Proc: o texto útil mínimo (uma página de aviso não chega perto) e o limite de leitura (bytes). */
const MINIMO_TEXTO = 500;
const LIMITE_BYTES = 5_000_000;

export function clienteDoEproc(f: FonteEproc): Cliente {
  return new Cliente({ nome: f.nome });
}

export const ressalvaDe = (f: FonteEproc) =>
  `Precedentes qualificados ${f.sigla === "tnu" ? "da" : "do"} ${f.nomeNoCnj} não são pesquisados no e-Proc pelo Garimpo: a ` +
  "lista vem vazia por isso, não por falta de precedente.";

const avisoDeOrdem = (f: FonteEproc) =>
  `Ordem da lista: a do ${f.nome.replace(/^O /, "")} (o Garimpo não reordena nem a atribui a relevância). A página lida ` +
  "traz no máximo 10 acórdãos; para outros, refine o texto da busca.";

/** Antes de gastar chamada: filtro ou opção que o e-Proc não recebe pelo Garimpo é erro que ensina, nunca ignorado. */
export function conferirPedidoAoEproc(f: FonteEproc, p: ParametrosBusca): void {
  const filtros = (["de", "ate", "relator", "orgao", "classe"] as const).filter((campo) => p[campo]?.trim());
  if (filtros.length) {
    throw new Error(
      `O filtro ${filtros.join(" e ")} ainda não vale ${f.sigla === "tnu" ? "na" : "no"} ${f.nomeNoCnj}: o Garimpo não verificou como o e-Proc os recebe e não os ` +
        "ignora em silêncio. Repita sem eles e use a data e o órgão que vêm em cada acórdão para filtrar a lista.",
    );
  }
  if (p.somenteEmentas || p.precedentes || (p.ordenacao && p.ordenacao !== "relevancia")) {
    throw new Error(
      `somenteEmentas, ordenacao e precedentes não valem ${f.sigla === "tnu" ? "na" : "no"} ${f.nomeNoCnj}: a busca do Garimpo ` +
        "no e-Proc é só nas ementas, na ordem do e-Proc, e sem lista de precedentes. Repita sem essas opções.",
    );
  }
}

/** O termo no ISO-8859-1 que o e-Proc usa (percent-encoded; espaço = "+"); caractere fora dele é erro que ensina. */
function codificarLatin1(f: FonteEproc, texto: string): string {
  let saida = "";
  for (const c of texto) {
    const codigo = c.codePointAt(0)!;
    if (codigo > 0xff) {
      throw new Error(
        `${f.nome} usa ISO-8859-1 e o texto da busca tem um caractere que ele não representa ("${c}"). Reescreva sem ele.`,
      );
    }
    if (/[A-Za-z0-9\-_.~]/.test(c)) saida += c;
    else if (c === " ") saida += "+";
    else saida += `%${codigo.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return saida;
}

function corpoDaBusca(f: FonteEproc, texto: string): string {
  const campos: [string, string][] = [
    ["txtPesquisa", codificarLatin1(f, texto)],
    ["rdoCampo", "E"],
    [encodeURIComponent("selOrigem[]"), "1"],
    [encodeURIComponent("selTipoDocumento[]"), "1"],
    ["chkAgruparResultados", "on"],
    ["hdnInfraPrefixoCookie", f.prefixoCookie],
  ];
  return campos.map(([k, v]) => `${k}=${v}`).join("&");
}

const redirecionou = (r: Response) => r.status >= 300 && r.status < 400;

/** 1 GET do formulário: o cookie de sessão que a prova usou nas duas chamadas seguintes (se a fonte dispensa, não verificado). */
async function abrirSessao(f: FonteEproc, cliente: Cliente): Promise<string | undefined> {
  const r = await cliente.requisitar(formularioDe(f), { headers: { accept: "text/html" }, redirect: "manual" });
  if (redirecionou(r)) {
    await r.body?.cancel();
    throw new FormatoInesperadoError(`${f.nome} redirecionou o formulário de pesquisa; o Garimpo não segue o redirecionamento.`);
  }
  await r.arrayBuffer();
  const cookie = r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  return cookie || undefined;
}

async function lerHtml(f: FonteEproc, r: Response): Promise<string> {
  const tipo = r.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!/html/i.test(tipo) || bytes.length > LIMITE_BYTES) {
    throw new FormatoInesperadoError(`${f.nome} devolveu algo que não é a página HTML esperada (${tipo || "sem tipo"}).`);
  }
  return decodificar(bytes, tipo, "iso-8859-1");
}

function formatoInesperado(): never {
  throw new FormatoInesperadoError("Formato inesperado da lista do e-Proc: a página não corresponde à estrutura presumida; nada foi guardado. Confira a fonte.");
}

function atributo(tag: string, nome: string): string | undefined {
  return new RegExp(`(?:^|\\s)${nome}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag)?.[2];
}

/** Só aceita um total inteiro completo no campo exato; total ausente ou ambíguo nunca vira zero. */
function totalDaPagina(html: string): number {
  const campos = [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0])
    .filter((tag) => atributo(tag, "name") === "hdnTotalResultado" || atributo(tag, "id") === "hdnTotalResultado");
  if (campos.length !== 1) return formatoInesperado();
  const v = atributo(campos[0], "value");
  if (!v || !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v))) return formatoInesperado();
  return Number(v);
}

/** Recorte conservador das divs presumidas: conta o aninhamento, nunca atravessa outro registro. */
function divsDaClasse(html: string, classe: string): string[] {
  const partes: string[] = [];
  let inicio: number | undefined;
  let profundidade = 0;
  for (const m of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const fecha = /^<\//.test(m[0]);
    const alvo = !fecha && atributo(m[0], "class")?.split(/\s+/).includes(classe);
    if (alvo) {
      if (inicio !== undefined) return formatoInesperado();
      inicio = m.index;
      profundidade = 0;
    }
    if (inicio === undefined) continue;
    profundidade += fecha ? -1 : 1;
    if (profundidade === 0) {
      partes.push(html.slice(inicio, m.index + m[0].length));
      inicio = undefined;
    }
  }
  if (inicio !== undefined) return formatoInesperado();
  return partes;
}

/** Campo do card real: resLabel seguido de resValue; rótulo/valor ausente ou duplicado aborta a lista. */
function campoDoRegistro(html: string, rotulos: string[]): string;
function campoDoRegistro(html: string, rotulos: string[], opcional: true): string | undefined;
function campoDoRegistro(html: string, rotulos: string[], opcional = false): string | undefined {
  // Os rótulos ficam dentro de divs aninhadas: localiza as aberturas, sem englobar seus pais.
  const labels = [...html.matchAll(/<div\b[^>]*>/gi)]
    .filter((m) => atributo(m[0], "class")?.split(/\s+/).includes("resLabel"));
  const encontrados = labels.filter((m) => {
    const fim = html.indexOf("</div>", m.index + m[0].length);
    return rotulos.includes(htmlParaTexto(html.slice(m.index + m[0].length, fim)).trim());
  });
  if (opcional && encontrados.length === 0) return undefined;
  if (encontrados.length !== 1) return formatoInesperado();
  const etiqueta = encontrados[0];
  const fim = html.indexOf("</div>", etiqueta.index + etiqueta[0].length);
  const seguinte = labels.find((m) => m.index > etiqueta.index)?.index ?? html.length;
  const trecho = html.slice(fim + 6, seguinte);
  const abertura = /^\s*(<div\b[^>]*>)/i.exec(trecho)?.[1];
  if (!abertura || !atributo(abertura, "class")?.split(/\s+/).includes("resValue")) return formatoInesperado();
  const valores = divsDaClasse(trecho, "resValue");
  if (valores.length !== 1) return formatoInesperado();
  return htmlParaTexto(valores[0]).replace(/\s+/g, " ").trim();
}

/**
 * «PROCESSO <cnj>/<órgão> <sigla> - <classe> [UF <uf>] [ÓRGÃO JULGADOR <órgão>] DATA DO JULGAMENTO <d> DATA DA PUBLICAÇÃO <d>»;
 * o ÓRGÃO JULGADOR só vale nas fontes que o trazem (`comOrgao`).
 */
function cabecalhoDe(f: FonteEproc): RegExp {
  const orgao = f.comOrgao ? String.raw`ÓRGÃO JULGADOR\s+([\s\S]+?)\s+` : "";
  return new RegExp(
    String.raw`PROCESSO\s+(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\s*\/\s*${f.nomeNoCnj}\s+(\S+)\s+-\s+([\s\S]+?)\s+(?:UF\s+[A-Z]{2}\s+)?${orgao}` +
      String.raw`DATA DO JULGAMENTO\s+(\d{2}\/\d{2}\/\d{4})\s+DATA DA PUBLICAÇÃO\s+(\d{2}\/\d{2}\/\d{4})`,
    "g",
  );
}

/** "13/10/2026" → "2026-10-13"; data que não existe = não informada. */
function dataDoEproc(v: string): string | undefined {
  const [, d, m, a] = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v) ?? [];
  if (!a) return undefined;
  const t = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  return t.getUTCFullYear() === Number(a) && t.getUTCMonth() === Number(m) - 1 && t.getUTCDate() === Number(d)
    ? `${a}-${m}-${d}`
    : undefined;
}

/** O link do documento: só https no host do e-Proc, na rota do controlador, com a ação do inteiro teor e um id. */
function enderecoDoInteiroTeor(f: FonteEproc, link: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(link, formularioDe(f));
  } catch {
    return undefined;
  }
  const id = url.searchParams.get("id_jurisprudencia");
  if (
    url.protocol !== "https:" ||
    url.host !== f.host ||
    url.username !== "" || url.password !== "" || url.hash !== "" ||
    url.searchParams.getAll("acao").length !== 1 ||
    url.searchParams.getAll("id_jurisprudencia").length !== 1 ||
    url.pathname !== f.rota ||
    url.searchParams.get("acao") !== ACAO_INTEIRO_TEOR ||
    !id ||
    !/^[\w-]{1,64}$/.test(id)
  ) {
    return undefined;
  }
  return url;
}

/** O link de acompanhamento processual (só no TRF4), como veio (http e tudo); só é mostrado, nunca chamado. */
const ehLinkDeConsulta = (f: FonteEproc, link: string) => f.linkDeConsulta?.test(link) ?? false;

function limpar<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** Cada registro fica isolado pelo card resultadoItem; links precedem os campos no HTML real. */
export function lerResultadosDoEproc(
  f: FonteEproc,
  html: string,
): { acordaos: Acordao[]; total: number; blocos: number; repetidos: number } {
  html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
  const total = totalDaPagina(html);
  const registros = divsDaClasse(html, "resultadoItem");
  if (registros.length !== Math.min(total, LIMITE_MAXIMO_EPROC)) return formatoInesperado();
  for (const campo of ["resLabel", "resValueTipoJurisprudencia"]) {
    if (divsDaClasse(html, campo).length !== registros.reduce((n, r) => n + divsDaClasse(r, campo).length, 0)) return formatoInesperado();
  }
  const acordaos: Acordao[] = [];
  const vistos = new Map<string, string>();
  let repetidos = 0;
  for (const registro of registros) {
    const tipo = divsDaClasse(registro, "resValueTipoJurisprudencia");
    if (tipo.length !== 1 || htmlParaTexto(tipo[0]).trim() !== "Acórdão") return formatoInesperado();
    const cabecalho = "PROCESSO " + campoDoRegistro(registro, ["PROCESSO"]) +
      " UF " + campoDoRegistro(registro, ["UF"]) +
      (f.comOrgao ? " ÓRGÃO JULGADOR " + campoDoRegistro(registro, ["ÓRGÃO JULGADOR"]) : "") +
      " DATA DO JULGAMENTO " + campoDoRegistro(registro, ["DATA DO JULGAMENTO"]) +
      " DATA DA PUBLICAÇÃO " + campoDoRegistro(registro, ["DATA DA PUBLICAÇÃO"]);
    const encontrados = [...cabecalho.matchAll(cabecalhoDe(f))];
    if (encontrados.length !== 1) return formatoInesperado();
    const m = encontrados[0];
    if (m.index !== 0 || cabecalho.slice(m[0].length).trim()) return formatoInesperado();
    const [, cnj, sigla, classe, ...resto] = m;
    const [orgao, julgamento, publicacao] = (f.comOrgao ? resto : [undefined, ...resto]) as [string | undefined, string, string];
    // Campos intermediários não podem conter outro cabeçalho nem links deslocados.
    if (/PROCESSO|ÓRGÃO JULGADOR|DATA DO|DATA DA|⟦LINK:/.test(classe + (orgao ?? ""))) return formatoInesperado();
    const links = [...registro.matchAll(/<a\b[^>]*>/gi)]
      .map((m) => atributo(m[0], "data-link")).filter((l): l is string => l !== undefined).map(htmlParaTexto);
    const docs = links.map((l) => enderecoDoInteiroTeor(f, l)).filter((u): u is URL => Boolean(u));
    const consultas = links.filter((l) => ehLinkDeConsulta(f, l));
    const esperados = f.linkDeConsulta ? 1 : 0;
    if (links.length !== 1 + esperados || docs.length !== 1 || consultas.length !== esperados) return formatoInesperado();
    const doc = docs[0];
    const idDoc = doc.searchParams.get("id_jurisprudencia")!;
    const tagDoCard = /^<div\b[^>]*>/i.exec(registro)?.[0];
    if (!tagDoCard || atributo(tagDoCard, "id") !== `resultado${idDoc}`) return formatoInesperado();
    const ementa = campoDoRegistro(registro, ["EMENTA"]);
    const relator = campoDoRegistro(registro, ["RELATOR", "RELATORA"]);
    const relatorParaAcordao = campoDoRegistro(registro, ["RELATOR PARA ACÓRDÃO", "RELATORA PARA ACÓRDÃO"], true);
    const acordao = limpar({
      id: `${f.sigla}:${idDoc}`,
      tribunal: f.sigla,
      numero: `${sigla} ${cnj}`,
      semNumero: false,
      numeroCnj: cnj,
      classe: classe.trim(),
      orgao: orgao?.trim(),
      relator: relatorParaAcordao ? `${relator} (relator para o acórdão: ${relatorParaAcordao})` : relator,
      dataJulgamento: dataDoEproc(julgamento),
      dataPublicacao: dataDoEproc(publicacao),
      ementa,
      avisoDeEmenta: ementa ? undefined : `sem ementa no ${f.nome.replace(/^O /, "")}`,
      link: doc.href,
      linkConsulta: consultas[0],
      fonte: f.rotulo,
    });
    const identidade = JSON.stringify(acordao);
    if (vistos.has(idDoc)) {
      if (vistos.get(idDoc) !== identidade) return formatoInesperado();
      repetidos++;
      continue;
    }
    vistos.set(idDoc, identidade);
    acordaos.push({ ...acordao, enquadramento927: enquadrarAcordao({ ...acordao, siglaClasse: sigla }) });
  }
  return { acordaos, total, blocos: registros.length, repetidos };
}

/** Chave da busca guardada: sha256 da fonte, do texto e do limite (o texto nunca vai em claro para o disco). */
export function chaveNoEproc(f: FonteEproc, p: ParametrosBusca): string {
  const limite = Math.min(Math.max(p.limite ?? LIMITE_MAXIMO_EPROC, 1), LIMITE_MAXIMO_EPROC);
  return createHash("sha256").update(JSON.stringify([f.sigla, p.texto.trim(), limite])).digest("hex");
}

/** Cabeçalho de cobertura: o total que o e-Proc informa, separado de quantos vieram e quantos foram mostrados. */
export function coberturaNoEproc(f: FonteEproc, total: number | undefined, recebidos: number, mostrados: number): string {
  const informado = total === undefined ? `${f.nome} não informou o total` : `${f.nome} informou ${total} documentos`;
  const mais =
    total !== undefined && total <= recebidos
      ? "não há mais para este texto"
      : `pode haver mais: o Garimpo lê só a primeira página (até ${LIMITE_MAXIMO_EPROC} por busca); refine o texto da busca`;
  return `${informado}; o Garimpo recebeu ${recebidos} e mostra ${mostrados}; ${mais}.`;
}

export interface OpcoesEproc {
  renovar?: boolean;
  /** Falso na busca ampla, que guarda os acórdãos depois de juntar as cópias de todas as buscas. */
  guardarAcordaos?: boolean;
}

/** A busca guardada neste e-Proc para estes parâmetros, sem chamada. */
export async function lerBuscaGuardadaNoEproc(
  f: FonteEproc,
  memoria: Memoria,
  p: ParametrosBusca,
): Promise<{ resultado: ResultadoBusca; obtidoEm: number } | undefined> {
  const guardada = await memoria.obterBusca(chaveNoEproc(f, p));
  if (!guardada) return undefined;
  const { busca, obtidoEm } = guardada;
  return {
    obtidoEm,
    resultado: {
      buscaGuardada:
        `${fotografiaDaBusca(obtidoEm).replace("no site", "no " + f.nome.replace(/^O /, ""))}, devolvida pela memória do ` +
        "Garimpo sem nova chamada ao e-Proc; para dado novo, repita com renovar",
      tribunal: f.sigla,
      fonte: f.rotulo,
      cabecalhoDeCobertura: coberturaNoEproc(f, busca.totalNaFonte, busca.registrosDoSite, busca.acordaos.length),
      acordaos: busca.acordaos.map((a) => a.registro),
      qualificados: [],
      ressalvaQualificados: ressalvaDe(f),
      avisos: [...busca.avisos],
    },
  };
}

/** Busca direta num e-Proc: formulário (sessão) e POST, uma página de até 10, pelo Cliente. */
export async function buscaNoEproc(
  f: FonteEproc,
  cliente: Cliente,
  p: ParametrosBusca,
  memoria?: Memoria,
  { renovar = false, guardarAcordaos = true }: OpcoesEproc = {},
): Promise<ResultadoBusca> {
  conferirPedidoAoEproc(f, p);
  const texto = p.texto.trim();
  const corpo = corpoDaBusca(f, texto);
  const limite = Math.min(Math.max(p.limite ?? LIMITE_MAXIMO_EPROC, 1), LIMITE_MAXIMO_EPROC);
  if (memoria && !renovar) {
    const guardada = await lerBuscaGuardadaNoEproc(f, memoria, p).catch(() => undefined);
    if (guardada) return guardada.resultado;
  }

  const cookie = await abrirSessao(f, cliente);
  const r = await cliente.requisitar(listarDe(f), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      origin: `https://${f.host}`,
      referer: formularioDe(f),
      ...(cookie && { cookie }),
    },
    body: corpo,
  });
  if (redirecionou(r)) {
    await r.body?.cancel();
    throw new FormatoInesperadoError(`${f.nome} redirecionou a busca; o Garimpo não segue o redirecionamento.`);
  }
  const html = await lerHtml(f, r);
  const { acordaos: lidos, total, repetidos } = lerResultadosDoEproc(f, html);
  const acordaos = lidos.slice(0, limite);
  const avisos: string[] = [];
  if (repetidos) avisos.push(`${repetidos} acórdão(s) repetido(s) na página do e-Proc ficaram só uma vez.`);
  if (p.limite !== undefined && p.limite > LIMITE_MAXIMO_EPROC) {
    avisos.push(
      `O limite pedido (${p.limite}) vale ${LIMITE_MAXIMO_EPROC} ${f.sigla === "tnu" ? "na" : "no"} ${f.nomeNoCnj}: o Garimpo lê uma ` +
        `página do e-Proc por busca (${LIMITE_MAXIMO_EPROC} por busca).`,
    );
  }
  avisos.push(avisoDeOrdem(f));
  if (guardarAcordaos) memoria?.lembrar(acordaos.map((registro) => ({ ids: [registro.id], registro })));
  memoria?.guardarBusca(chaveNoEproc(f, p), {
    registrosDoSite: lidos.length,
    acordaos: acordaos.map((registro) => ({ ids: [registro.id], registro })),
    qualificados: [],
    avisos: [...avisos],
    ...(total !== undefined && { totalNaFonte: total }),
  });
  const gravacao = memoria?.avisoDeGravacao();
  return {
    tribunal: f.sigla,
    fonte: f.rotulo,
    cabecalhoDeCobertura: coberturaNoEproc(f, total, lidos.length, acordaos.length),
    acordaos,
    qualificados: [],
    ressalvaQualificados: ressalvaDe(f),
    avisos: gravacao ? [...avisos, gravacao] : avisos,
  };
}

/** Só o link que a busca devolveu serve: https no host do e-Proc, rota do controlador, ação do inteiro teor; outro = erro. */
function lerLinkDoInteiroTeor(f: FonteEproc, link: string): URL {
  const url = enderecoDoInteiroTeor(f, link);
  if (!url) {
    throw new Error(
      `Link ${f.sigla === "tnu" ? "da" : "do"} ${f.nomeNoCnj} fora do formato esperado (só https em ${f.host}${f.rota} com a ação ` +
        `download_inteiro_teor; o link de acompanhamento processual nunca é chamado): ${link}`,
    );
  }
  return url;
}

/**
 * O acórdão em HTML, convertido em texto do portal do tribunal: 1 GET do formulário (sessão) e 1 do documento.
 * Só vale com a marca do documento da fonte (assinatura eletrônica no TRF4; cabeçalho e conferência de autenticidade na
 * TNU), texto útil mínimo e, quando a busca trouxe o número CNJ, o mesmo processo no texto; senão, undefined (nada é
 * guardado). Redirecionamento não é seguido.
 */
export async function textoDoEproc(
  f: FonteEproc,
  cliente: Cliente,
  link: string,
  acordao: { id?: string; numeroCnj?: string },
): Promise<Omit<TextoIntegral, "id"> | undefined> {
  const url = lerLinkDoInteiroTeor(f, link);
  if (acordao.id && acordao.id !== `${f.sigla}:${url.searchParams.get("id_jurisprudencia")}`) {
    throw new Error(
      `Link ${f.sigla === "tnu" ? "da" : "do"} ${f.nomeNoCnj} fora do formato esperado para este id: o documento do link difere do acórdão pedido.`,
    );
  }
  let cookie: string | undefined;
  try {
    cookie = await abrirSessao(f, cliente);
  } catch (e) {
    if (e instanceof FormatoInesperadoError) return undefined;
    throw e;
  }
  const r = await cliente.requisitar(url.href, {
    headers: { accept: "text/html", referer: formularioDe(f), ...(cookie && { cookie }) },
    redirect: "manual",
  });
  if (redirecionou(r)) {
    await r.body?.cancel();
    return undefined;
  }
  const tipo = r.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!/html/i.test(tipo) || bytes.length > LIMITE_BYTES) return undefined;
  const html = decodificar(bytes, tipo, "iso-8859-1");
  const texto = htmlParaTexto(html);
  if (texto.length < MINIMO_TEXTO || !f.marcaDoDocumento.test(texto)) return undefined;
  if (acordao.numeroCnj && !texto.includes(acordao.numeroCnj)) return undefined;
  return {
    texto,
    indicioDeCorte: htmlComIndicioDeCorte(html),
    ...(htmlComConteudoOculto(html) && { conteudoOculto: true }),
  };
}
