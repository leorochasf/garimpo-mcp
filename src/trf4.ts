/**
 * TRF4: busca oficial do módulo de jurisprudência do e-Proc e o inteiro teor em HTML assinado (D-07 / G-31, ADR-0024).
 * Tudo pelo Cliente único (UA honesto, freios da regra 3). A busca é 1 GET do formulário (sessão) e 1 POST, uma página
 * de 10; o inteiro teor é 1 GET do formulário e 1 GET do documento. O link de acompanhamento processual
 * (www.trf4.jus.br/trf4/processos/, vedado no robots.txt) só é mostrado: nunca chamado. O formato HTML foi lido de uma
 * prova, não de HTML gravado: o que não bate vira erro de formato, nunca lista vazia.
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
/** Resultados da única página que o Garimpo lê (o e-Proc mostra 10; o tamanho da página não foi verificado). */
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

/** Total declarado no campo oculto; ausente = undefined (nunca "zero"). */
function totalDaPagina(html: string): number | undefined {
  const tag = /<input\b[^>]*\bhdnTotalResultado\b[^>]*>/i.exec(html)?.[0];
  const v = tag && /\bvalue\s*=\s*["']?(\d+)/i.exec(tag)?.[1];
  return v === undefined || v === "" ? undefined : Number(v);
}

const MARCA_DE_LINK = /⟦LINK:([^⟧]*)⟧/g;

/** O texto da página com cada `data-link` escrito no ponto onde estava, para o link ficar junto do resultado dele. */
function textoComLinks(html: string): string {
  const comMarcas = html.replace(
    /<([a-z][a-z0-9]*)\b([^>]*?)\sdata-link\s*=\s*(["'])(.*?)\3([^>]*)>/gis,
    (_, tag: string, antes: string, _aspa: string, valor: string, depois: string) =>
      `<${tag}${antes}${depois}> ⟦LINK:${htmlParaTexto(valor)}⟧ `,
  );
  return htmlParaTexto(comMarcas);
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

/** Os resultados da página: acórdão (sem texto integral) por cabeçalho; sem o link do inteiro teor, descartado e contado. */
export function lerResultadosDoTrf4(html: string): { acordaos: Acordao[]; blocos: number; descartados: number; repetidos: number } {
  const texto = textoComLinks(html);
  const cabecalhos = [...texto.matchAll(CABECALHO)];
  const acordaos: Acordao[] = [];
  const vistos = new Set<string>();
  let descartados = 0;
  let repetidos = 0;
  cabecalhos.forEach((m, i) => {
    const [, cnj, sigla, classe, orgao, julgamento, publicacao] = m;
    const bloco = texto.slice(m.index + m[0].length, cabecalhos[i + 1]?.index ?? texto.length);
    const links = [...bloco.matchAll(MARCA_DE_LINK)].map((l) => l[1].trim());
    const doc = links.map(enderecoDoInteiroTeor).find((u) => u);
    if (!doc) {
      descartados++;
      return;
    }
    const idDoc = doc.searchParams.get("id_jurisprudencia")!;
    if (vistos.has(idDoc)) {
      repetidos++;
      return;
    }
    vistos.add(idDoc);
    const fim = bloco.search(/\bDECISÃO\b|⟦LINK:/);
    const ementa = (fim < 0 ? bloco : bloco.slice(0, fim)).replace(/^\s*EMENTA\s*:?\s*/i, "").trim();
    const acordao = limpar({
      id: `trf4:${idDoc}`,
      tribunal: "trf4",
      numero: `${sigla} ${cnj}`,
      semNumero: false,
      numeroCnj: cnj,
      classe: classe.trim(),
      orgao: orgao.trim(),
      dataJulgamento: dataDoEproc(julgamento),
      dataPublicacao: dataDoEproc(publicacao),
      ementa,
      avisoDeEmenta: ementa ? undefined : "sem ementa no e-Proc do TRF4",
      link: doc.href,
      linkConsulta: links.find(ehLinkDeConsulta),
      fonte: ROTULO_TRF4,
    });
    acordaos.push({ ...acordao, enquadramento927: enquadrarAcordao({ ...acordao, siglaClasse: sigla }) });
  });
  return { acordaos, blocos: cabecalhos.length, descartados, repetidos };
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
  const total = totalDaPagina(html);
  const { acordaos: lidos, blocos, descartados, repetidos } = lerResultadosDoTrf4(html);
  if (total === undefined && blocos === 0) {
    throw new FormatoInesperadoError(
      "A página do e-Proc do TRF4 não trouxe o total (hdnTotalResultado) nem resultados legíveis: não deu para saber se há " +
        "acórdãos. O formato da fonte pode ter mudado.",
    );
  }
  if (total !== undefined && total > 0 && blocos === 0) {
    throw new FormatoInesperadoError(
      `O e-Proc do TRF4 informou ${total} documentos, mas o Garimpo não leu nenhum resultado da página. O formato da fonte ` +
        "pode ter mudado; a lista não é dada como vazia.",
    );
  }
  const acordaos = lidos.slice(0, limite);
  const avisos: string[] = [];
  if (descartados) {
    avisos.push(
      `${descartados} registro(s) do e-Proc descartado(s): sem link do inteiro teor que o Garimpo possa usar (o Garimpo ` +
        "não completa dado por suposição).",
    );
  }
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
  acordao: { numeroCnj?: string },
): Promise<Omit<TextoIntegral, "id"> | undefined> {
  const url = lerLinkDoInteiroTeor(link);
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
