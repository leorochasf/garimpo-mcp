/**
 * Inteiro teor oficial: o PDF do acórdão baixado do portal do próprio tribunal.
 * Baixa só o que sai por HTTP comum (TJMG, TJMS, TJSP, TSE). O STJ não: o robots.txt de processo.stj.jus.br veda o host
 * inteiro (D-18), e o Garimpo devolve o link para conferência manual. No TJTO, o portal entrega o acórdão em HTML: vira o
 * texto do portal do tribunal, guardado na memória (ADR-0021). Para os demais devolve link + explicação:
 * nunca navegador automatizado, captcha ou contorno de proteção.
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link as ligar, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { type Acordao, SITE } from "./busca.js";
import { Cliente, decodificarDoHost, ehDocumentoTjto, HOST_TJTO, RecusaError, VERSAO } from "./cliente.js";
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
import { htmlComConteudoOculto, htmlComIndicioDeCorte, htmlParaTexto } from "./html.js";
import type { Guardado, Memoria, TextoIntegral } from "./memoria.js";
import { textoDoTjdft } from "./tjdft.js";
import { textoDoTjgo } from "./tjgo.js";
import { textoDoTjpi } from "./tjpi.js";
import { textoDaTnu } from "./tnu.js";
import { textoDoTrf2 } from "./trf2.js";
import { textoDoTrf4 } from "./trf4.js";
import { ehDoFalcao, infoTribunal } from "./tribunais.js";

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
  // TRT: o Falcão entrega texto, não PDF; nada a baixar, nenhuma chamada.
  if (ehDoFalcao(tribunal)) {
    const comId = pedido.id ? `ler_inteiro_teor com o id ${pedido.id}` : "ler_inteiro_teor com o id que veio na busca";
    return {
      baixado: false,
      explicacao:
        "Nos TRTs, o Garimpo usa o Falcão, que entrega o texto integral do repositório oficial em texto (HTML " +
        `convertido), não PDF: não há o que baixar nem recibo de origem. Leia o texto com o ${comId} (fica na ` +
        "memória do Garimpo por 24 h desde a busca); confira citações com o conferir_citacao pelo mesmo id.",
    };
  }
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

  if (info.inteiroTeor === "portal") return textoDoPortal(info.nome, acordao, link ?? (tribunal === "tjpi" ? acordao?.linkConsulta : undefined) ?? linkDaRota, clienteDe(tribunal), memoria);

  if (info.inteiroTeor === "link") {
    // Sem link do PDF (comum no STF), o link oficial de consulta serve para o usuário abrir no navegador.
    const linkOficial = link ?? acordao?.linkConsulta ?? linkDaRota;
    const motivo = info.motivoLink ?? "";
    if (!linkOficial) {
      // Sem link, o "abra o link no navegador" do texto de tribunal não testado não tem o que abrir.
      const semLink = motivo.replace(/; abra o link no navegador\.$/, ".");
      const explicacao = `${semLink} O JurisprudênciaIA não trouxe link para este acórdão. ${caminhoSemLink(info.nome, acordao)}`;
      return { baixado: false, explicacao: explicacao.trim() };
    }
    let explicacao = motivo;
    if (linkDaRota) explicacao += origemDaRota;
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
  if (tribunal === "tjmg") baixado = await baixarDireto(cliente, linkPdf, "www5.tjmg.jus.br", "TJMG");
  else if (tribunal === "tjrr") baixado = await baixarDireto(cliente, enderecoDoPdfDoTjrr(linkPdf), HOST_TJRR, "TJRR");
  else if (tribunal === "tse") baixado = await baixarDireto(cliente, linkPdf, "sjur-servicos.tse.jus.br", "TSE");
  else if (tribunal === "tjsp" || tribunal === "tjms") {
    const sigla = tribunal.toUpperCase();
    const r = await baixarEsaj(cliente, linkPdf, sigla);
    if ("bytesDaPagina" in r) {
      return {
        baixado: false,
        link: linkPdf,
        explicacao: `O ${sigla} devolveu uma página (${r.bytesDaPagina} bytes) no lugar do PDF; nada foi salvo. ${PONTE}`,
      };
    }
    baixado = r;
  } else throw new Error(`Download automático não implementado para ${tribunal.toUpperCase()}.`);

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

/**
 * TJTO (ADR-0021): o portal entrega o acórdão (ementa, relatório, voto e extrato de ata) em HTML, não em PDF. O texto,
 * convertido pelo Garimpo, vai para a memória pelo id do acórdão, como o do Falcão; já guardado = nenhuma chamada.
 */
async function textoDoPortal(
  nomeTribunal: string,
  acordao: Acordao | undefined,
  link: string | undefined,
  cliente: Cliente,
  memoria: Memoria | undefined,
): Promise<ResultadoInteiroTeor> {
  if (!link) {
    return {
      baixado: false,
      explicacao: `O JurisprudênciaIA não trouxe link para este acórdão. ${caminhoSemLink(nomeTribunal, acordao)}`,
    };
  }
  if (!acordao || !memoria) {
    return {
      baixado: false,
      link,
      explicacao:
        "O texto do portal do tribunal fica na memória do Garimpo pelo id do acórdão: chame o obter_inteiro_teor com " +
        `o id que veio na busca. ${PONTE}`,
    };
  }
  const ler =
    `Leia com o ler_inteiro_teor com o id ${acordao.id} (fica na memória do Garimpo por 24 h) e confira citações ` +
    "com o conferir_citacao pelo mesmo id.";
  let textoGuardado: TextoIntegral | undefined = await memoria.obterTexto(acordao.id);
  if (!textoGuardado) {
    const doTjdft = acordao.tribunal === "tjdft";
    const doTjgo = acordao.tribunal === "tjgo" ? await textoDoTjgo(cliente, acordao) : undefined;
    if (doTjgo && "motivo" in doTjgo) {
      return {
        baixado: false,
        link,
        explicacao:
          `O Garimpo não trouxe o texto deste acórdão do Projudi do ${nomeTribunal}: ${doTjgo.motivo}. Texto não ` +
          "verificado, nada foi guardado. O link abre a página pública do processo; procure o acórdão nas " +
          "movimentações de julgamento.",
      };
    }
    const trazido =
      doTjgo ? doTjgo
      : doTjdft ? await textoDoTjdft(cliente, link, acordao)
      : acordao.tribunal === "tjpi" ? await textoDoTjpi(cliente, link, acordao)
      : acordao.tribunal === "trf2" ? await textoDoTrf2(cliente, link, acordao)
      : acordao.tribunal === "trf4" ? await textoDoTrf4(cliente, link, acordao)
      : acordao.tribunal === "tnu" ? await textoDaTnu(cliente, link, acordao)
      : await baixarTextoTjto(cliente, link);
    if (!trazido) {
      return {
        baixado: false,
        link,
        explicacao: acordao.tribunal === "tnu"
          ? "O e-Proc da TNU não entregou o documento deste acórdão (sem o cabeçalho e a conferência de autenticidade do " +
            "documento, processo divergente, texto curto demais ou redirecionamento): texto não verificado, nada foi " +
            "guardado. Abra o link no navegador para conferir o documento."
          : acordao.tribunal === "trf2" || acordao.tribunal === "trf4"
          ? `O e-Proc do ${acordao.tribunal.toUpperCase()} não entregou o documento assinado deste acórdão (sem a assinatura eletrônica, processo ` +
            "divergente, texto curto demais ou redirecionamento): texto não verificado, nada foi guardado. Abra o link " +
            "no navegador para conferir o documento."
          : acordao.tribunal === "tjpi"
          ? `O portal do ${nomeTribunal} não entregou uma página com texto verificável deste acórdão ` +
            "(formato ou processo divergente, seção Acórdão sem texto ou redirecionamento): texto não verificado, " +
            "nada foi guardado. Abra o link no navegador para conferir o documento."
          : doTjdft
          ? `A API do ${nomeTribunal} não devolveu o registro deste acórdão (identificador e uuid do link): texto não ` +
            "verificado, nada foi guardado. Abra o link no navegador para conferir o documento."
          : `O portal do ${nomeTribunal} respondeu, mas com uma página que não é a página do acórdão (aviso ou erro do ` +
            "portal, como documento não encontrado): o Garimpo não guardou texto nenhum. Abra o link no navegador para " +
            "conferir o documento.",
      };
    }
    textoGuardado = { id: acordao.id, ...trazido };
    memoria.lembrarTextos([textoGuardado]);
  }
  if (textoGuardado.motivoSemTexto || !textoGuardado.texto) {
    return {
      baixado: false,
      link,
      explicacao: `O ${nomeTribunal} não entregou o texto deste acórdão: ${textoGuardado.motivoSemTexto ?? "o texto veio vazio"}. Texto não verificado. Abra o link no navegador para conferir o documento.`,
    };
  }
  return {
    baixado: false,
    link,
    explicacao:
      acordao.tribunal === "tjdft"
        ? `A API do ${nomeTribunal} entrega o texto do acórdão, não o PDF: o Garimpo o guardou como texto do portal do ` +
          `tribunal, sem recibo de origem; não é o PDF do tribunal. ${ler}`
        : `O portal do ${nomeTribunal} entrega o acórdão em HTML, não em PDF: o Garimpo o converteu em texto (texto do ` +
          `portal do tribunal, sem recibo de origem; não é o PDF do tribunal). ${ler}`,
  };
}

/**
 * O documento do TJTO: viewFileDoc.php responde 302 para documento.php (Location escapado como HTML, "&amp;"); o
 * Garimpo pede documento.php só com o uuid, o endereço da prova de 2026-10-11. Só https no portal do TJTO. Só é o
 * acórdão a página com as marcas estruturais do documento do eproc e texto útil mínimo; outra = undefined (página de
 * desafio ou de bloqueio já foi recusada pelo cliente, com o disjuntor do TJTO aberto).
 */
async function baixarTextoTjto(cliente: Cliente, link: string): Promise<Omit<TextoIntegral, "id"> | undefined> {
  const oficial = (endereco: string, contexto: string) => {
    const url = new URL(endereco);
    if (url.protocol !== "https:" || url.host !== HOST_TJTO) {
      throw new Error(`${contexto} fora do portal oficial esperado (só https em ${HOST_TJTO}): ${endereco}`);
    }
    return url;
  };
  let url = oficial(link, "Link do TJTO");
  for (let saltos = 0; ; saltos++) {
    const r = await cliente.requisitar(url.href, { redirect: "manual" });
    if (r.status >= 300 && r.status < 400) {
      await r.body?.cancel();
      const destino = r.headers.get("location");
      if (!destino || saltos >= MAX_REDIRECTS) {
        throw new Error(`O TJTO redirecionou sem destino ou vezes demais (${url.href}).`);
      }
      url = oficial(new URL(destino.replace(/&amp;/g, "&"), url).href, "O TJTO redirecionou");
      const uuid = url.searchParams.get("uuid");
      if (uuid) url.search = new URLSearchParams({ uuid }).toString();
      continue;
    }
    const tipo = r.headers.get("content-type") ?? "";
    const bytes = await lerCorpo(r, "TJTO");
    if (!/text\/html/i.test(tipo)) {
      throw new Error(`O TJTO devolveu ${tipo || "conteúdo sem tipo"} no lugar da página do acórdão (${url.href}).`);
    }
    // Charset: cabeçalho, depois <meta> do HTML; sem nenhum, ISO-8859-1 (a mesma decodificação do detector do cliente).
    const html = decodificarDoHost(bytes, tipo, HOST_TJTO);
    if (!ehDocumentoTjto(html)) return undefined;
    return {
      texto: htmlParaTexto(html),
      indicioDeCorte: htmlComIndicioDeCorte(html),
      ...(htmlComConteudoOculto(html) && { conteudoOculto: true }),
    };
  }
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

const HOST_TJRR = "jurisprudencia.tjrr.jus.br";

/**
 * TJRR (I-16 / G-23): o link da busca (inteiroTeor.xhtml?id=N) é uma página com o PDF embutido numa sessão do portal;
 * o PDF está em /pdf?id=N, um GET sem sessão (prova de 2026-10-14). Só https no portal do TJRR, id numérico.
 */
function enderecoDoPdfDoTjrr(link: string): string {
  const url = new URL(link);
  const id = url.searchParams.get("id");
  if (url.protocol !== "https:" || url.host !== HOST_TJRR || url.pathname !== "/inteiroTeor.xhtml" || !id || !/^\d+$/.test(id)) {
    throw new Error(`Link do TJRR fora do formato esperado (só https em ${HOST_TJRR}/inteiroTeor.xhtml?id=<n>): ${link}`);
  }
  return `https://${HOST_TJRR}/pdf?id=${id}`;
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

const MAX_REDIRECTS = 5;

/**
 * TJSP e TJMS (e-SAJ), numa mesma sessão de cookies do portal, como observado na prova do B11 (2026-10-09):
 * 1. o link do PDF redireciona para a página de verificação de login (verificarLoginArquivo.jsp);
 * 2. essa página traz, no caminho de quem não está logado, o endereço seguinte como texto literal
 *    (window.location.href = '...casChecked=true'): lido do HTML, sem executar JavaScript;
 * 3. esse endereço devolve o PDF.
 * Página sem PDF em qualquer passo: devolve o tamanho dela, para virar link + motivo.
 */
async function baixarEsaj(cliente: Cliente, link: string, sigla: string): Promise<Baixado | { bytesDaPagina: number }> {
  const doPortal = (endereco: string, contexto: string) => urlDoEsaj(endereco, contexto, sigla);
  const sessao = new Sessao(cliente, sigla, doPortal);
  const corpo1 = await lerCorpo(await sessao.get(link), sigla);
  if (ehPdf(corpo1)) return { pdf: corpo1, urlFinal: sessao.urlFinal };
  const literal = latin1(corpo1).match(/window\.location\.href\s*=\s*'([^']*casChecked=true[^']*)'/)?.[1];
  if (!literal) return { bytesDaPagina: corpo1.length };
  const pagina = sessao.urlFinal;
  const passo3 = doPortal(new URL(literal.replace(/&amp;/g, "&"), pagina).href, `O ${sigla} apontou o PDF`).href;
  const corpo3 = await lerCorpo(await sessao.get(passo3, pagina), sigla);
  return ehPdf(corpo3) ? { pdf: corpo3, urlFinal: sessao.urlFinal } : { bytesDaPagina: corpo3.length };
}

/** Só o portal do tribunal do eSAJ: HTTPS e o domínio dele (tjsp.jus.br, tjms.jus.br) ou subdomínio. */
function urlDoEsaj(endereco: string, contexto: string, sigla: string): URL {
  const url = new URL(endereco);
  const host = url.hostname.toLowerCase();
  const dominio = `${sigla.toLowerCase()}.jus.br`;
  if (url.protocol !== "https:" || (host !== dominio && !host.endsWith(`.${dominio}`))) {
    throw new Error(`${contexto} fora do portal oficial do ${sigla} (só https em ${dominio}): ${endereco}`);
  }
  return url;
}

/** Cookies de uma sessão de download num portal (só vivem durante ela e só vão para esse portal). */
class Sessao {
  private cookies = new Map<string, string>();
  /** Endereço que respondeu à última chamada, depois dos redirecionamentos. */
  urlFinal = "";
  constructor(
    private readonly cliente: Cliente,
    private readonly sigla: string,
    private readonly doPortal: (endereco: string, contexto: string) => URL,
  ) {}

  /** GET no portal seguindo redirects um a um: o destino de cada salto é validado antes de levar os cookies. */
  async get(endereco: string, referer?: string): Promise<Response> {
    let url = this.doPortal(endereco, `Link do ${this.sigla}`);
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
        throw new Error(`O ${this.sigla} redirecionou sem destino ou vezes demais (${url.href}); nada foi salvo.`);
      }
      url = this.doPortal(new URL(destino, url).href, `O ${this.sigla} redirecionou`);
    }
  }

  async texto(url: string, referer?: string): Promise<string> {
    return latin1(await lerCorpo(await this.get(url, referer), this.sigla));
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
