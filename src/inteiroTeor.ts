/**
 * Inteiro teor oficial: o PDF do acórdão baixado do portal do próprio tribunal.
 * Baixa só o que sai por HTTP comum (STJ, TJMG, TSE). Para os demais devolve link + explicação:
 * nunca navegador automatizado, captcha ou contorno de proteção.
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link as ligar, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { type Acordao, SITE } from "./busca.js";
import { Cliente, RecusaError, VERSAO } from "./cliente.js";
import { RedeParadaError } from "./coordenacao.js";
import {
  avisoJaNaPasta,
  camposDoRecibo,
  contarPaginas,
  FORMATO_RECIBO,
  LIMITE_BYTES_PDF,
  NAO_INFORMADO,
  ORIGEM_DOWNLOAD,
} from "./leitura.js";
import type { Guardado, Memoria } from "./memoria.js";
import { infoTribunal } from "./tribunais.js";

export interface PedidoInteiroTeor {
  /** Id composto devolvido pela busca ("stj:12345"). */
  id?: string;
  /** Alternativa ao id: tribunal + link_pdf que veio na busca. */
  tribunal?: string;
  link?: string;
  /** Pasta onde salvar o PDF. */
  pasta?: string;
}

export interface InteiroTeorBaixado {
  baixado: true;
  arquivo: string;
  recibo: string;
  sha256: string;
  bytes: number;
  fonte: string;
  /** Só quando o PDF já estava na pasta de destino e nada foi baixado: de quando é o download, e que não houve chamada. */
  jaEstavaNaPasta?: string;
}

export type ResultadoInteiroTeor = InteiroTeorBaixado | { baixado: false; link?: string; explicacao: string };

export type ClientePorTribunal = (sigla: string) => Cliente;

/**
 * Pausa entre downloads seguidos no TSE, que responde "Excesso de requisições" a chamadas em sequência
 * (medido em 2026-10-07: recusou com 3 s e 8 s de intervalo; aceitou com 10 s).
 */
export const PAUSA_TSE_MS = 10_000;

const clientes = new Map<string, Cliente>();

export const clientePadrao: ClientePorTribunal = (sigla) => {
  let c = clientes.get(sigla);
  if (!c) {
    c = new Cliente({
      nome: `O ${sigla.toUpperCase()}`,
      intervaloMinimoPorHost: { "sjur-servicos.tse.jus.br": PAUSA_TSE_MS },
      esperaPadraoMs: sigla === "tse" ? PAUSA_TSE_MS : undefined,
    });
    clientes.set(sigla, c);
  }
  return c;
};

/** Fim comum dos caminhos sem download automático: a leitura local do PDF que o usuário baixou não contorna nada. */
const LEITURA_PELO_USUARIO =
  "passe o caminho do arquivo ao ler_inteiro_teor " +
  "(com o id que veio na busca, ou tribunal + número, se quiser o cabeçalho preenchido como vínculo declarado). " +
  "Ele sai como inteiro teor " +
  "trazido pelo usuário, de origem declarada e não conferida.";

/** O caminho para ler um acórdão sem download automático, a partir do link. */
const PONTE = `Para ler pelo Garimpo: abra o link no navegador, baixe o PDF e ${LEITURA_PELO_USUARIO}`;

/**
 * O caminho quando não há link nenhum: o número do processo e o portal de jurisprudência do tribunal. Sem endereço
 * do portal: o projeto não tem fonte para ele, e link inventado é pior que nenhum.
 */
function caminhoSemLink(nomeTribunal: string, acordao: Acordao | undefined): string {
  const numero = acordao?.numeroCnj
    ? `o número CNJ ${acordao.numeroCnj}`
    : acordao && !acordao.semNumero
      ? `o número ${acordao.numero}`
      : "o acórdão";
  return (
    `Pesquise ${numero} no portal de jurisprudência do ${nomeTribunal}, baixe lá o PDF e, para ler pelo Garimpo, ` +
    LEITURA_PELO_USUARIO
  );
}

export function pastaPadrao(): string {
  return process.env.GARIMPO_PASTA ?? join(homedir(), "Garimpo", "inteiro-teor");
}

/**
 * Acórdão da memória sem link nenhum na busca: pede o link oficial à rota de link do site, uma vez, pelo Cliente do
 * site (freios de sempre), e o guarda no acórdão sem estender as 24 h. Nada no TST (a rota responde 400). Recusa do
 * site ou rede parada sobe como erro; outra falha, resposta sem link ou link fora de https num domínio .jus.br = sem
 * link: o que sai como link oficial é só o do portal do tribunal.
 */
async function comLinkDaRota(
  guardado: Guardado | undefined,
  site: Cliente | undefined,
  memoria: Memoria | undefined,
): Promise<Acordao | undefined> {
  const acordao = guardado?.acordao;
  if (!guardado || !acordao || !site || !memoria) return acordao;
  if (acordao.link || acordao.linkConsulta || acordao.linkDaRota || acordao.tribunal === "tst") return acordao;
  const id = acordao.id.slice(acordao.id.indexOf(":") + 1);
  let link: string | undefined;
  try {
    const consulta = new URLSearchParams({ tribunal: acordao.tribunal, id });
    const r = await site.requisitar(`${SITE}/api/jurisprudencia-link?${consulta}`, {
      headers: { Origin: SITE, Referer: `${SITE}/` },
    });
    const valor = ((await r.json()) as { link?: unknown } | null)?.link;
    if (typeof valor === "string" && ehDoTribunal(new URL(valor.trim()))) link = valor.trim();
  } catch (e) {
    if (e instanceof RecusaError || e instanceof RedeParadaError) throw e;
  }
  if (!link) return acordao;
  const comLink = { ...acordao, linkDaRota: link };
  memoria.lembrar([{ ids: [acordao.id], registro: comLink }], guardado.obtidoEm);
  return comLink;
}

/** Endereço https num domínio da Justiça (.jus.br): o único que o Garimpo apresenta como link oficial vindo da rota. */
function ehDoTribunal(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && (host === "jus.br" || host.endsWith(".jus.br"));
}

export async function obterInteiroTeor(
  pedido: PedidoInteiroTeor,
  clienteDe: ClientePorTribunal = clientePadrao,
  memoria?: Memoria,
  site?: Cliente,
): Promise<ResultadoInteiroTeor> {
  const guardado = pedido.id ? await memoria?.obter(pedido.id) : undefined;
  let acordao = guardado?.acordao;
  const tribunal = (acordao?.tribunal ?? pedido.tribunal ?? pedido.id?.split(":")[0] ?? "").toLowerCase();
  const link = pedido.link ?? acordao?.link;
  const pasta = resolve(pedido.pasta ?? pastaPadrao());
  // Antes de qualquer chamada, e sem depender da memória: o PDF que o Garimpo já baixou nesta pasta, pelo recibo.
  const jaBaixado = await procurarNaPasta(pasta, tribunal, [pedido.id, acordao?.id], link);
  if (jaBaixado) return jaBaixado;
  if (pedido.id && !acordao && !pedido.link) {
    throw new Error(
      `O acórdão ${pedido.id} não está na memória do Garimpo, que guarda os acórdãos por 24 h desde a busca. ` +
        "Refaça a busca que o trouxe ou informe tribunal e link.",
    );
  }
  const info = infoTribunal(tribunal);
  if (!info) throw new Error("Informe o id do acórdão (como veio na busca) ou o tribunal e o link.");
  // Sem link nem link de consulta na busca: o link pedido à rota de link do site, quando ela tem.
  if (!pedido.link) acordao = await comLinkDaRota(guardado, site, memoria);
  const linkDaRota = link || acordao?.linkConsulta ? undefined : acordao?.linkDaRota;
  const origemDaRota = " Link pedido à rota de link do JurisprudênciaIA: não veio na busca.";

  if (info.inteiroTeor === "link") {
    // Sem link do PDF (comum no STF), o link oficial de consulta serve para o usuário abrir no navegador.
    const linkOficial = link ?? acordao?.linkConsulta ?? linkDaRota;
    const motivo = info.motivoLink ?? "";
    if (!linkOficial) {
      const explicacao = `${motivo} O JurisprudênciaIA não trouxe link para este acórdão. ${caminhoSemLink(info.nome, acordao)}`;
      return { baixado: false, explicacao: explicacao.trim() };
    }
    let explicacao = motivo;
    if (linkDaRota) explicacao += origemDaRota;
    if (tribunal === "tjgo" && acordao?.numeroCnj) explicacao += ` Número CNJ para pesquisar: ${acordao.numeroCnj}.`;
    explicacao += ` ${PONTE}`;
    return { baixado: false, link: linkOficial, explicacao: explicacao.trim() };
  }
  const linkPdf = link ?? linkDaRota;
  if (!linkPdf) {
    return {
      baixado: false,
      explicacao:
        "O JurisprudênciaIA não trouxe link do inteiro teor para este acórdão; não há de onde baixar. " +
        caminhoSemLink(info.nome, acordao),
    };
  }

  const cliente = clienteDe(tribunal);
  let baixado: Baixado;
  if (tribunal === "stj") baixado = await baixarStj(cliente, linkPdf);
  else if (tribunal === "tjmg") baixado = await baixarDireto(cliente, linkPdf, "www5.tjmg.jus.br", "TJMG");
  else if (tribunal === "tse") baixado = await baixarDireto(cliente, linkPdf, "sjur-servicos.tse.jus.br", "TSE");
  else throw new Error(`Download automático não implementado para ${tribunal.toUpperCase()}.`);

  await mkdir(pasta, { recursive: true });
  // O número do processo não é único (dois acórdãos podem ter o mesmo): o id do documento entra no nome.
  const idDocumento =
    (acordao?.id ?? pedido.id)?.split(":")[1] ?? createHash("sha1").update(linkPdf).digest("hex").slice(0, 10);
  const nome = [tribunal, acordao?.numero, idDocumento].filter(Boolean).join("-").replace(/[^\w.-]+/g, "_");
  const sha256 = createHash("sha256").update(baixado.pdf).digest("hex");
  const recibo = (arquivo: string) =>
    textoDoRecibo({
      "Link oficial final": baixado.urlFinal,
      "Link que veio na busca": link,
      ...(linkDaRota ? { "Link pedido à rota de link do site": linkDaRota } : {}),
      "Data e hora": dataHoraComFuso(new Date()),
      Sha256: sha256,
      "Tamanho em bytes": String(baixado.pdf.length),
      Tribunal: tribunal.toUpperCase(),
      "Número": acordao?.numero,
      "Data do julgamento": acordao?.dataJulgamento,
      Id: acordao?.id ?? pedido.id,
      "Nome do arquivo": basename(arquivo),
    });
  const salvo = await salvarComRecibo(pasta, nome, baixado.pdf, recibo);
  return { baixado: true, ...salvo, sha256, bytes: baixado.pdf.length, fonte: linkPdf };
}

const SUFIXO_RECIBO = ".recibo.txt";

/**
 * O PDF do acórdão que o Garimpo já baixou na pasta de destino (ADR-0011), só nela. Casa o recibo de download pelo
 * Garimpo do mesmo tribunal e de um dos ids; sem nenhum, o do mesmo link da busca, se todos os recibos desse link
 * disserem o mesmo acórdão e nenhum disser outro que não o pedido. Número do processo sozinho nunca casa. Serve só o
 * PDF válido, legível e com o sha256 do recibo; com várias versões, a de download mais recente pelo recibo. Nada aqui
 * grava, apaga ou chama a rede.
 */
async function procurarNaPasta(
  pasta: string,
  tribunal: string,
  ids: (string | undefined)[],
  link: string | undefined,
): Promise<InteiroTeorBaixado | undefined> {
  let nomes: string[];
  try {
    nomes = await readdir(pasta);
  } catch {
    return undefined; // Pasta que ainda não existe ou não se lê: nada já baixado.
  }
  const recibos = [];
  for (const nome of nomes.filter((n) => n.endsWith(SUFIXO_RECIBO))) {
    const recibo = join(pasta, nome);
    let campos: Map<string, string>;
    try {
      campos = camposDoRecibo(await readFile(recibo, "utf8"));
    } catch {
      continue;
    }
    if (campos.get("Formato") !== FORMATO_RECIBO || campos.get("Origem") !== ORIGEM_DOWNLOAD) continue;
    if (campos.get("Tribunal") !== tribunal.toUpperCase()) continue;
    recibos.push({ recibo, arquivo: `${recibo.slice(0, -SUFIXO_RECIBO.length)}.pdf`, campos });
  }
  const pedidos = ids.filter(Boolean);
  let candidatos = recibos.filter((r) => pedidos.includes(r.campos.get("Id")));
  if (!candidatos.length && link) {
    // Pedido com id: só o recibo do link que não diz acórdão nenhum (o que diz outro id é outro acórdão).
    const peloLink = recibos.filter(
      (r) =>
        r.campos.get("Link que veio na busca") === link && (!pedidos.length || r.campos.get("Id") === NAO_INFORMADO),
    );
    if (new Set(peloLink.map((r) => r.campos.get("Id"))).size === 1) candidatos = peloLink;
  }
  const validos = [];
  for (const c of candidatos) {
    const bytes = await bytesConferidos(c.arquivo, c.campos.get("Sha256"));
    if (bytes !== undefined) validos.push({ ...c, bytes, em: Date.parse(c.campos.get("Data e hora") ?? "") });
  }
  if (!validos.length) return undefined;
  // Data ilegível no recibo nunca passa à frente de uma legível.
  const escolhido = validos.reduce((a, b) => ((b.em || -Infinity) > (a.em || -Infinity) ? b : a));
  return {
    baixado: true,
    arquivo: escolhido.arquivo,
    recibo: escolhido.recibo,
    sha256: escolhido.campos.get("Sha256")!,
    bytes: escolhido.bytes,
    fonte: escolhido.campos.get("Link que veio na busca") ?? NAO_INFORMADO,
    jaEstavaNaPasta: avisoJaNaPasta(escolhido.campos.get("Data e hora") ?? NAO_INFORMADO, validos.length - 1),
  };
}

/** Tamanho do PDF que existe, é PDF de até 50 MB, tem o sha256 do recibo e o extrator abre; senão, undefined. */
async function bytesConferidos(arquivo: string, sha256: string | undefined): Promise<number | undefined> {
  try {
    const info = await lstat(arquivo);
    if (!info.isFile() || info.size > LIMITE_BYTES_PDF) return undefined;
    const bytes = await readFile(arquivo);
    if (!ehPdf(bytes) || createHash("sha256").update(bytes).digest("hex") !== sha256) return undefined;
    await contarPaginas(arquivo);
    return bytes.length;
  } catch {
    return undefined;
  }
}

/** O PDF baixado e o endereço de onde ele veio de fato, depois dos redirecionamentos. */
interface Baixado {
  pdf: Uint8Array;
  urlFinal: string;
}

/**
 * Lê o corpo até o fim, cortando acima de 50 MB (contados nos bytes recebidos, com ou sem Content-Length); conexão
 * que cai no meio vira erro claro. Nada é gravado aqui.
 */
async function lerCorpo(r: Response, sigla: string): Promise<Uint8Array> {
  const excesso = new Error(`A resposta do ${sigla} passa de 50 MB; o download foi interrompido e nada foi salvo.`);
  if (Number(r.headers.get("content-length")) > LIMITE_BYTES_PDF) {
    await r.body?.cancel();
    throw excesso;
  }
  if (!r.body) return new Uint8Array();
  const leitor = r.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let lido: ReadableStreamReadResult<Uint8Array>;
    try {
      lido = await leitor.read();
    } catch (e) {
      throw new Error(
        `O download do ${sigla} foi interrompido no meio (${(e as Error).message}); nada foi salvo. Tente de novo.`,
      );
    }
    if (lido.done) return Buffer.concat(pedacos);
    total += lido.value.length;
    if (total > LIMITE_BYTES_PDF) {
      await leitor.cancel();
      throw excesso;
    }
    pedacos.push(lido.value);
  }
}


/** Recibo de origem: linhas "Campo: valor", estáveis, para gente ler e para o Garimpo conferir depois. */
function textoDoRecibo(campos: Record<string, string | undefined>): string {
  const linhas = {
    Formato: FORMATO_RECIBO,
    Origem: ORIGEM_DOWNLOAD,
    ...campos,
    "Versão do Garimpo": VERSAO,
    Natureza:
      "declaração do Garimpo de onde, quando e com que sha256 este PDF foi obtido; não tem valor de certidão do " +
      "tribunal nem de autenticação independente.",
  };
  return Object.entries(linhas)
    .map(([campo, valor]) => `${campo}: ${valor?.replace(/\s+/g, " ").trim() || NAO_INFORMADO}`)
    .join("\n")
    .concat("\n");
}

/** Data e hora local com o fuso explícito (ex.: 2026-10-08T14:03:22.123-03:00). */
function dataHoraComFuso(d: Date): string {
  const fuso = -d.getTimezoneOffset();
  const dois = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + fuso * 60_000).toISOString().slice(0, -1);
  return `${local}${fuso < 0 ? "-" : "+"}${dois(fuso / 60)}:${dois(fuso % 60)}`;
}

/** Existe algo com este nome (lstat: um atalho quebrado também conta, para nunca ser sobrescrito). */
const existe = (caminho: string) =>
  lstat(caminho).then(
    () => true,
    () => false,
  );

/**
 * Dá ao temporário o nome final sem nunca substituir o que houver: um link, que falha se o nome existir. Pasta sem
 * suporte a link (pendrive em exFAT, algumas pastas de rede): cópia que também falha se o nome existir.
 */
async function nomearSemSobrescrever(temporario: string, arquivo: string): Promise<void> {
  try {
    await ligar(temporario, arquivo);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw e;
    await copyFile(temporario, arquivo, constants.COPYFILE_EXCL);
  }
}

/**
 * Grava o PDF e o recibo sem nunca sobrescrever. O PDF vai primeiro para um temporário na mesma pasta e só ganha
 * o nome final completo (um link que falha se o nome já existir, em vez de um rename que substituiria); o
 * temporário é apagado em qualquer caso. Mesmos bytes de um PDF já salvo: reaproveita, preservando o recibo que
 * houver (ou gravando um, se o PDF for de antes do recibo). Bytes diferentes, ou recibo sem PDF: "-2", "-3"…
 */
async function salvarComRecibo(
  pasta: string,
  nome: string,
  pdf: Uint8Array,
  recibo: (arquivo: string) => string,
): Promise<{ arquivo: string; recibo: string }> {
  const temporario = join(pasta, `.${nome}.${randomUUID()}.parcial`);
  try {
    await writeFile(temporario, pdf, { flag: "wx" });
    for (let n = 1; ; n++) {
      const base = join(pasta, n === 1 ? nome : `${nome}-${n}`);
      const salvo = { arquivo: `${base}.pdf`, recibo: `${base}.recibo.txt` };
      if (await existe(salvo.arquivo)) {
        if (!Buffer.from(pdf).equals(await readFile(salvo.arquivo))) continue;
      } else {
        if (await existe(salvo.recibo)) continue;
        try {
          await nomearSemSobrescrever(temporario, salvo.arquivo);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          n--; // Outra chamada gravou este nome agora: confere de novo o mesmo número.
          continue;
        }
      }
      await gravarSeNaoExiste(salvo.recibo, recibo(salvo.arquivo));
      return salvo;
    }
  } finally {
    // No Windows o antivírus pode segurar o arquivo recém-gravado: novas tentativas, e uma falha aqui não derruba
    // um download já salvo.
    await rm(temporario, { force: true, maxRetries: 3 }).catch(() => {});
  }
}

async function gravarSeNaoExiste(caminho: string, texto: string): Promise<void> {
  try {
    await writeFile(caminho, texto, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

/**
 * TJMG e TSE: o link do site já aponta para o PDF oficial. Só https no host oficial; redirects seguidos
 * um a um, cada destino validado antes de sair, com teto de saltos.
 */
async function baixarDireto(cliente: Cliente, link: string, host: string, sigla: string): Promise<Baixado> {
  const oficial = (endereco: string, contexto: string) => {
    const url = new URL(endereco);
    if (url.protocol !== "https:" || url.host !== host) {
      throw new Error(`${contexto} fora do portal oficial esperado (só https em ${host}): ${endereco}`);
    }
    return url;
  };
  let url = oficial(link, `Link do ${sigla}`);
  for (let saltos = 0; ; saltos++) {
    const r = await cliente.requisitar(url.href, { redirect: "manual" });
    if (r.status < 300 || r.status >= 400) {
      return { pdf: exigirPdf(desembrulhar(await lerCorpo(r, sigla)), sigla, link), urlFinal: url.href };
    }
    await r.body?.cancel();
    const destino = r.headers.get("location");
    if (!destino || saltos >= MAX_REDIRECTS) {
      throw new Error(`O ${sigla} redirecionou sem destino ou vezes demais (${url.href}); nada foi salvo.`);
    }
    url = oficial(new URL(destino, url).href, `O ${sigla} redirecionou`);
  }
}

/** O TSE entrega o PDF dentro de um envelope multipart ("--fronteira", cabeçalhos, PDF, "--fronteira--"). */
function desembrulhar(b: Uint8Array): Uint8Array {
  const buf = Buffer.from(b);
  if (buf.subarray(0, 2).toString("latin1") !== "--") return b;
  const fimLinha = buf.indexOf("\r\n");
  const inicio = buf.indexOf("\r\n\r\n");
  if (fimLinha < 0 || inicio < 0) return b;
  const fronteira = buf.subarray(0, fimLinha).toString("latin1");
  const fim = buf.lastIndexOf(`\r\n${fronteira}`);
  return new Uint8Array(buf.subarray(inicio + 4, fim > inicio ? fim : buf.length));
}

/**
 * STJ pela Revista Eletrônica, numa mesma sessão de cookies:
 * 1. página do inteiro teor (lista documentos em AbreDocumento('...'); o 1º é o inteiro teor);
 * 2. página "mediado" desse documento (traz o PDF num iframe);
 * 3. o PDF do iframe. Sem o cookie da sessão o passo 3 devolve um HTML curto.
 */
async function baixarStj(cliente: Cliente, link: string): Promise<Baixado> {
  const origem = urlDoStj(link, "Link do STJ");
  const registro = origem.searchParams.get("num_registro");
  const data = origem.searchParams.get("dt_publicacao");
  if (!registro || !data) {
    throw new Error(`Link do STJ sem número de registro e data de publicação: ${link}`);
  }
  const sessao = new Sessao(cliente);

  const passo1 = `https://processo.stj.jus.br/processo/revista/inteiroteor/?num_registro=${registro}&dt_publicacao=${data}`;
  const pagina = await sessao.texto(passo1);
  const documento = pagina.match(/AbreDocumento\('([^']+)'\)/)?.[1];
  if (!documento) {
    throw new Error(
      "A Revista Eletrônica do STJ não listou o inteiro teor deste acórdão (pode ainda não estar disponível). " +
        `Confira no navegador: ${passo1}`,
    );
  }

  const passo2 = urlDoStj(new URL(documento.replace(/&amp;/g, "&"), passo1).href, "O STJ apontou o documento").href;
  const corpo2 = await lerCorpo(await sessao.get(passo2, passo1), "STJ");
  if (ehPdf(corpo2)) return { pdf: corpo2, urlFinal: sessao.urlFinal };
  const iframe = latin1(corpo2).match(/<iframe[^>]*\ssrc=['"]([^'"]+)['"]/i)?.[1];
  const passo3 = urlDoStj(
    iframe ? new URL(iframe.replace(/&amp;/g, "&"), passo2).href : passo2.replace("/mediado/", "/"),
    "O STJ apontou o PDF",
  ).href;

  const corpo3 = await lerCorpo(await sessao.get(passo3, passo2), "STJ");
  return { pdf: exigirPdf(corpo3, "STJ", passo1), urlFinal: sessao.urlFinal };
}

/** Só o portal do STJ: HTTPS e host stj.jus.br ou subdomínio dele (nunca "falso-stj.jus.br"). */
function urlDoStj(endereco: string, contexto: string): URL {
  const url = new URL(endereco);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== "stj.jus.br" && !host.endsWith(".stj.jus.br"))) {
    throw new Error(`${contexto} fora do portal oficial do STJ (só https em stj.jus.br): ${endereco}`);
  }
  return url;
}

const MAX_REDIRECTS = 5;

/** Cookies de uma sessão de download no STJ (só vivem durante ela e só vão para o STJ). */
class Sessao {
  private cookies = new Map<string, string>();
  /** Endereço que respondeu à última chamada, depois dos redirecionamentos. */
  urlFinal = "";
  constructor(private readonly cliente: Cliente) {}

  /** GET no STJ seguindo redirects um a um: o destino de cada salto é validado antes de levar os cookies. */
  async get(endereco: string, referer?: string): Promise<Response> {
    let url = urlDoStj(endereco, "Endereço");
    for (let saltos = 0; ; saltos++) {
      const headers: Record<string, string> = {};
      if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      if (referer) headers.Referer = referer;
      const r = await this.cliente.requisitar(url.href, { headers, redirect: "manual" });
      for (const c of setCookies(r.headers)) {
        const par = c.split(";")[0];
        const i = par.indexOf("=");
        if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
      }
      if (r.status < 300 || r.status >= 400) {
        this.urlFinal = url.href;
        return r;
      }
      await r.body?.cancel();
      const destino = r.headers.get("location");
      if (!destino || saltos >= MAX_REDIRECTS) {
        throw new Error(`O STJ redirecionou sem destino ou vezes demais (${url.href}); nada foi salvo.`);
      }
      url = urlDoStj(new URL(destino, url).href, "O STJ redirecionou");
    }
  }

  async texto(url: string, referer?: string): Promise<string> {
    return latin1(await lerCorpo(await this.get(url, referer), "STJ"));
  }
}

function setCookies(h: Headers): string[] {
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const junto = h.get("set-cookie");
  return junto ? junto.split(/,(?=\s*[^;,=\s]+=)/) : [];
}

function ehPdf(b: Uint8Array): boolean {
  return b.length > 4 && latin1(b.subarray(0, 4)) === "%PDF";
}

function exigirPdf(b: Uint8Array, sigla: string, link: string): Uint8Array {
  if (ehPdf(b)) return b;
  throw new Error(
    `O ${sigla} devolveu uma página (${b.length} bytes) no lugar do PDF; nada foi salvo. ` +
      `Abra no navegador: ${link}`,
  );
}

function latin1(b: Uint8Array): string {
  return Buffer.from(b).toString("latin1");
}
