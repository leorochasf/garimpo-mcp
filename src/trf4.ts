/**
 * TRF4: busca oficial do módulo de jurisprudência do e-Proc e o inteiro teor em HTML assinado (D-07 / G-31, ADR-0024).
 * Tudo pelo Cliente único (UA honesto, freios da regra 3). A busca é 1 GET do formulário (sessão) e 1 POST, uma página
 * de 10; o inteiro teor é 1 GET do formulário e 1 GET do documento. O link de acompanhamento processual
 * (www.trf4.jus.br/trf4/processos/, vedado no robots.txt) só é mostrado: nunca chamado. A estrutura da lista foi conferida
 * em 2026-10-14 e reproduzida em recorte saneado: o que não bate vira erro de formato, nunca lista vazia.
 */

import { createHash } from "node:crypto";
import { Cliente, decodificar, FormatoInesperadoError } from "./cliente.js";
import type { Acordao, ParametrosBusca, ResultadoBusca } from "./busca.js";
import { enquadrarAcordao } from "./enquadramento.js";
import { htmlComConteudoOculto, htmlComIndicioDeCorte, htmlParaTexto } from "./html.js";
import { fotografiaDaBusca, type Memoria, type TextoIntegral } from "./memoria.js";
import { ROTULO_TRF4 } from "./tribunais.js";

export const HOST_TRF4 = "eproc-jur.trf4.jus.br";
const ROTA = `/eproc2trf4/externo_controlador.php`;
export const FORMULARIO_TRF4 = `https://${HOST_TRF4}${ROTA}?acao=jurisprudencia@jurisprudencia/pesquisar`;
const LISTAR_RESULTADOS = `https://${HOST_TRF4}${ROTA}?acao=jurisprudencia@jurisprudencia/listar_resultados`;
const ACAO_INTEIRO_TEOR = "jurisprudencia@jurisprudencia/download_inteiro_teor";
/** Resultados da única página que o Garimpo lê (10 na prova de 2026-10-14; não promete estabilidade desse tamanho). */
export const LIMITE_MAXIMO_TRF4 = 10;
/** Documento do e-Proc: o texto útil mínimo (uma página de aviso não chega perto) e o limite de leitura (bytes). */
const MINIMO_TEXTO = 500;
const LIMITE_BYTES = 5_000_000;

export function clienteDoTrf4(): Cliente {
  return new Cliente({ nome: "O e-Proc do TRF4" });
}

export const RESSALVA_TRF4 =
  "Precedentes qualificados do TRF4 não são pesquisados no e-Proc pelo Garimpo: a lista vem vazia por isso, não por " +
  "falta de precedente.";

const AVISO_ORDEM =
  "Ordem da lista: a do e-Proc do TRF4 (o Garimpo não reordena nem a atribui a relevância). A página lida traz no máximo " +
  "10 acórdãos; para outros, refine o texto da busca.";

/** Antes de gastar chamada: filtro ou opção que o e-Proc não recebe pelo Garimpo é erro que ensina, nunca ignorado. */
export function conferirPedidoAoTrf4(p: ParametrosBusca): void {
  const filtros = (["de", "ate", "relator", "orgao", "classe"] as const).filter((f) => p[f]?.trim());
  if (filtros.length) {
    throw new Error(
      `O filtro ${filtros.join(" e ")} ainda não vale no TRF4: o Garimpo não verificou como o e-Proc os recebe e não os ` +
        "ignora em silêncio. Repita sem eles e use a data e o órgão que vêm em cada acórdão para filtrar a lista.",
    );
  }
  if (p.somenteEmentas || p.precedentes || (p.ordenacao && p.ordenacao !== "relevancia")) {
    throw new Error(
      "somenteEmentas, ordenacao e precedentes não valem no TRF4: a busca do Garimpo no e-Proc é só nas ementas, na " +
        "ordem do e-Proc, e sem lista de precedentes. Repita sem essas opções.",
    );
  }
}

/** O termo no ISO-8859-1 que o e-Proc usa (percent-encoded; espaço = "+"); caractere fora dele é erro que ensina. */
function codificarLatin1(texto: string): string {
  let saida = "";
  for (const c of texto) {
    const codigo = c.codePointAt(0)!;
    if (codigo > 0xff) {
      throw new Error(
        `O e-Proc do TRF4 usa ISO-8859-1 e o texto da busca tem um caractere que ele não representa ("${c}"). Reescreva sem ele.`,
      );
    }
    if (/[A-Za-z0-9\-_.~]/.test(c)) saida += c;
    else if (c === " ") saida += "+";
    else saida += `%${codigo.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return saida;
}

function corpoDaBusca(texto: string): string {
  const campos: [string, string][] = [
    ["txtPesquisa", codificarLatin1(texto)],
    ["rdoCampo", "E"],
    [encodeURIComponent("selOrigem[]"), "1"],
    [encodeURIComponent("selTipoDocumento[]"), "1"],
    ["chkAgruparResultados", "on"],
    ["hdnInfraPrefixoCookie", "TRF4_Eproc_"],
  ];
  return campos.map(([k, v]) => `${k}=${v}`).join("&");
}

const redirecionou = (r: Response) => r.status >= 300 && r.status < 400;

/** 1 GET do formulário: o cookie de sessão que a prova usou nas duas chamadas seguintes (se a fonte dispensa, não verificado). */
async function abrirSessao(cliente: Cliente): Promise<string | undefined> {
  const r = await cliente.requisitar(FORMULARIO_TRF4, { headers: { accept: "text/html" }, redirect: "manual" });
  if (redirecionou(r)) {
    await r.body?.cancel();
    throw new FormatoInesperadoError("O e-Proc do TRF4 redirecionou o formulário de pesquisa; o Garimpo não segue o redirecionamento.");
  }
  await r.arrayBuffer();
  const cookie = r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  return cookie || undefined;
}

async function lerHtml(r: Response): Promise<string> {
  const tipo = r.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!/html/i.test(tipo) || bytes.length > LIMITE_BYTES) {
    throw new FormatoInesperadoError(`O e-Proc do TRF4 devolveu algo que não é a página HTML esperada (${tipo || "sem tipo"}).`);
  }
  return decodificar(bytes, tipo, "iso-8859-1");
}

function formatoInesperado(): never {
  throw new FormatoInesperadoError("Formato inesperado da lista do e-Proc do TRF4: a página não corresponde à estrutura presumida; nada foi guardado. Confira a fonte.");
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
function campoDoRegistro(html: string, rotulos: string[]): string {
  // Os rótulos ficam dentro de divs aninhadas: localiza as aberturas, sem englobar seus pais.
  const labels = [...html.matchAll(/<div\b[^>]*>/gi)]
    .filter((m) => atributo(m[0], "class")?.split(/\s+/).includes("resLabel"));
  const encontrados = labels.filter((m) => {
    const fim = html.indexOf("</div>", m.index + m[0].length);
    return rotulos.includes(htmlParaTexto(html.slice(m.index + m[0].length, fim)).trim());
  });
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

/** «PROCESSO <cnj>/TRF4 <sigla> - <classe> [UF <uf>] ÓRGÃO JULGADOR <órgão> DATA DO JULGAMENTO <d> DATA DA PUBLICAÇÃO <d>». */
const CABECALHO =
  /PROCESSO\s+(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\s*\/\s*TRF4\s+(\S+)\s+-\s+([\s\S]+?)\s+(?:UF\s+[A-Z]{2}\s+)?ÓRGÃO JULGADOR\s+([\s\S]+?)\s+DATA DO JULGAMENTO\s+(\d{2}\/\d{2}\/\d{4})\s+DATA DA PUBLICAÇÃO\s+(\d{2}\/\d{2}\/\d{4})/g;

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
function enderecoDoInteiroTeor(link: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(link, FORMULARIO_TRF4);
  } catch {
    return undefined;
  }
  const id = url.searchParams.get("id_jurisprudencia");
  if (
    url.protocol !== "https:" ||
    url.host !== HOST_TRF4 ||
    url.username !== "" || url.password !== "" || url.hash !== "" ||
    url.searchParams.getAll("acao").length !== 1 ||
    url.searchParams.getAll("id_jurisprudencia").length !== 1 ||
    url.pathname !== ROTA ||
    url.searchParams.get("acao") !== ACAO_INTEIRO_TEOR ||
    !id ||
    !/^[\w-]{1,64}$/.test(id)
  ) {
    return undefined;
  }
  return url;
}

/** O link de acompanhamento processual, como veio (http e tudo); só é mostrado, nunca chamado. */
const ehLinkDeConsulta = (link: string) => /^https?:\/\/www\.trf4\.jus\.br\//i.test(link);

function limpar<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** Cada registro fica isolado pelo card resultadoItem; links precedem os campos no HTML real. */
export function lerResultadosDoTrf4(html: string): { acordaos: Acordao[]; total: number; blocos: number; repetidos: number } {
  html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
  const total = totalDaPagina(html);
  const registros = divsDaClasse(html, "resultadoItem");
  if (registros.length !== Math.min(total, LIMITE_MAXIMO_TRF4)) return formatoInesperado();
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
      " ÓRGÃO JULGADOR " + campoDoRegistro(registro, ["ÓRGÃO JULGADOR"]) +
      " DATA DO JULGAMENTO " + campoDoRegistro(registro, ["DATA DO JULGAMENTO"]) +
      " DATA DA PUBLICAÇÃO " + campoDoRegistro(registro, ["DATA DA PUBLICAÇÃO"]);
    const encontrados = [...cabecalho.matchAll(CABECALHO)];
    if (encontrados.length !== 1) return formatoInesperado();
    const m = encontrados[0];
    if (m.index !== 0 || cabecalho.slice(m[0].length).trim()) return formatoInesperado();
    const [, cnj, sigla, classe, orgao, julgamento, publicacao] = m;
    // Campos intermediários não podem conter outro cabeçalho nem links deslocados.
    if (/PROCESSO|ÓRGÃO JULGADOR|DATA DO|DATA DA|⟦LINK:/.test(classe + orgao)) return formatoInesperado();
    const links = [...registro.matchAll(/<a\b[^>]*>/gi)]
      .map((m) => atributo(m[0], "data-link")).filter((l): l is string => l !== undefined).map(htmlParaTexto);
    const docs = links.map(enderecoDoInteiroTeor).filter((u): u is URL => Boolean(u));
    const consultas = links.filter(ehLinkDeConsulta);
    if (links.length !== 2 || docs.length !== 1 || consultas.length !== 1) return formatoInesperado();
    const doc = docs[0];
    const idDoc = doc.searchParams.get("id_jurisprudencia")!;
    const tagDoCard = /^<div\b[^>]*>/i.exec(registro)?.[0];
    if (!tagDoCard || atributo(tagDoCard, "id") !== `resultado${idDoc}`) return formatoInesperado();
    const ementa = campoDoRegistro(registro, ["EMENTA"]);
    const acordao = limpar({
      id: `trf4:${idDoc}`,
      tribunal: "trf4",
      numero: `${sigla} ${cnj}`,
      semNumero: false,
      numeroCnj: cnj,
      classe: classe.trim(),
      orgao: orgao.trim(),
      relator: campoDoRegistro(registro, ["RELATOR", "RELATORA"]),
      dataJulgamento: dataDoEproc(julgamento),
      dataPublicacao: dataDoEproc(publicacao),
      ementa,
      avisoDeEmenta: ementa ? undefined : "sem ementa no e-Proc do TRF4",
      link: doc.href,
      linkConsulta: consultas[0],
      fonte: ROTULO_TRF4,
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
export function chaveNoTrf4(p: ParametrosBusca): string {
  const limite = Math.min(Math.max(p.limite ?? LIMITE_MAXIMO_TRF4, 1), LIMITE_MAXIMO_TRF4);
  return createHash("sha256").update(JSON.stringify(["trf4", p.texto.trim(), limite])).digest("hex");
}

/** Cabeçalho de cobertura: o total que o e-Proc informa, separado de quantos vieram e quantos foram mostrados. */
export function coberturaNoTrf4(total: number | undefined, recebidos: number, mostrados: number): string {
  const informado = total === undefined ? "O e-Proc do TRF4 não informou o total" : `O e-Proc do TRF4 informou ${total} documentos`;
  const mais =
    total !== undefined && total <= recebidos
      ? "não há mais para este texto"
      : `pode haver mais: o Garimpo lê só a primeira página (até ${LIMITE_MAXIMO_TRF4} por busca); refine o texto da busca`;
  return `${informado}; o Garimpo recebeu ${recebidos} e mostra ${mostrados}; ${mais}.`;
}

export interface OpcoesTrf4 {
  renovar?: boolean;
  /** Falso na busca ampla, que guarda os acórdãos depois de juntar as cópias de todas as buscas. */
  guardarAcordaos?: boolean;
}

/** A busca guardada no TRF4 para estes parâmetros, sem chamada. */
export async function lerBuscaGuardadaNoTrf4(
  memoria: Memoria,
  p: ParametrosBusca,
): Promise<{ resultado: ResultadoBusca; obtidoEm: number } | undefined> {
  const guardada = await memoria.obterBusca(chaveNoTrf4(p));
  if (!guardada) return undefined;
  const { busca, obtidoEm } = guardada;
  return {
    obtidoEm,
    resultado: {
      buscaGuardada:
        `${fotografiaDaBusca(obtidoEm).replace("no site", "no e-Proc do TRF4")}, devolvida pela memória do Garimpo sem ` +
        "nova chamada ao e-Proc; para dado novo, repita com renovar",
      tribunal: "trf4",
      fonte: ROTULO_TRF4,
      cabecalhoDeCobertura: coberturaNoTrf4(busca.totalNaFonte, busca.registrosDoSite, busca.acordaos.length),
      acordaos: busca.acordaos.map((a) => a.registro),
      qualificados: [],
      ressalvaQualificados: RESSALVA_TRF4,
      avisos: [...busca.avisos],
    },
  };
}

/** Busca direta no TRF4: formulário (sessão) e POST, uma página de até 10, pelo Cliente. */
export async function buscaNoTrf4(
  cliente: Cliente,
  p: ParametrosBusca,
  memoria?: Memoria,
  { renovar = false, guardarAcordaos = true }: OpcoesTrf4 = {},
): Promise<ResultadoBusca> {
  conferirPedidoAoTrf4(p);
  const texto = p.texto.trim();
  const corpo = corpoDaBusca(texto);
  const limite = Math.min(Math.max(p.limite ?? LIMITE_MAXIMO_TRF4, 1), LIMITE_MAXIMO_TRF4);
  if (memoria && !renovar) {
    const guardada = await lerBuscaGuardadaNoTrf4(memoria, p).catch(() => undefined);
    if (guardada) return guardada.resultado;
  }

  const cookie = await abrirSessao(cliente);
  const r = await cliente.requisitar(LISTAR_RESULTADOS, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      origin: `https://${HOST_TRF4}`,
      referer: FORMULARIO_TRF4,
      ...(cookie && { cookie }),
    },
    body: corpo,
  });
  if (redirecionou(r)) {
    await r.body?.cancel();
    throw new FormatoInesperadoError("O e-Proc do TRF4 redirecionou a busca; o Garimpo não segue o redirecionamento.");
  }
  const html = await lerHtml(r);
  const { acordaos: lidos, total, repetidos } = lerResultadosDoTrf4(html);
  const acordaos = lidos.slice(0, limite);
  const avisos: string[] = [];
  if (repetidos) avisos.push(`${repetidos} acórdão(s) repetido(s) na página do e-Proc ficaram só uma vez.`);
  if (p.limite !== undefined && p.limite > LIMITE_MAXIMO_TRF4) {
    avisos.push(`O limite pedido (${p.limite}) vale ${LIMITE_MAXIMO_TRF4} no TRF4: o Garimpo lê uma página do e-Proc por busca (${LIMITE_MAXIMO_TRF4} por busca).`);
  }
  avisos.push(AVISO_ORDEM);
  if (guardarAcordaos) memoria?.lembrar(acordaos.map((registro) => ({ ids: [registro.id], registro })));
  memoria?.guardarBusca(chaveNoTrf4(p), {
    registrosDoSite: lidos.length,
    acordaos: acordaos.map((registro) => ({ ids: [registro.id], registro })),
    qualificados: [],
    avisos: [...avisos],
    ...(total !== undefined && { totalNaFonte: total }),
  });
  const gravacao = memoria?.avisoDeGravacao();
  return {
    tribunal: "trf4",
    fonte: ROTULO_TRF4,
    cabecalhoDeCobertura: coberturaNoTrf4(total, lidos.length, acordaos.length),
    acordaos,
    qualificados: [],
    ressalvaQualificados: RESSALVA_TRF4,
    avisos: gravacao ? [...avisos, gravacao] : avisos,
  };
}

/** Só o link que a busca devolveu serve: https no host do e-Proc, rota do controlador, ação do inteiro teor; outro = erro. */
function lerLinkDoInteiroTeor(link: string): URL {
  const url = enderecoDoInteiroTeor(link);
  if (!url) {
    throw new Error(
      `Link do TRF4 fora do formato esperado (só https em ${HOST_TRF4}${ROTA} com a ação download_inteiro_teor; o link de ` +
        `acompanhamento processual nunca é chamado): ${link}`,
    );
  }
  return url;
}

/**
 * O acórdão em HTML assinado, convertido em texto do portal do tribunal: 1 GET do formulário (sessão) e 1 do documento.
 * Só vale com a assinatura eletrônica do documento, texto útil mínimo e, quando a busca trouxe o número CNJ, o mesmo
 * processo no texto; senão, undefined (nada é guardado). Redirecionamento não é seguido.
 */
export async function textoDoTrf4(
  cliente: Cliente,
  link: string,
  acordao: { id?: string; numeroCnj?: string },
): Promise<Omit<TextoIntegral, "id"> | undefined> {
  const url = lerLinkDoInteiroTeor(link);
  if (acordao.id && acordao.id !== `trf4:${url.searchParams.get("id_jurisprudencia")}`) {
    throw new Error("Link do TRF4 fora do formato esperado para este id: o documento do link difere do acórdão pedido.");
  }
  let cookie: string | undefined;
  try {
    cookie = await abrirSessao(cliente);
  } catch (e) {
    if (e instanceof FormatoInesperadoError) return undefined;
    throw e;
  }
  const r = await cliente.requisitar(url.href, {
    headers: { accept: "text/html", referer: FORMULARIO_TRF4, ...(cookie && { cookie }) },
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
  if (texto.length < MINIMO_TEXTO || !/Documento eletrônico assinado por/i.test(texto)) return undefined;
  if (acordao.numeroCnj && !texto.includes(acordao.numeroCnj)) return undefined;
  return {
    texto,
    indicioDeCorte: htmlComIndicioDeCorte(html),
    ...(htmlComConteudoOculto(html) && { conteudoOculto: true }),
  };
}
