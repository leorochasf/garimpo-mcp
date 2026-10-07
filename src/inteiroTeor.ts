/**
 * Inteiro teor oficial: o PDF do acórdão baixado do portal do próprio tribunal.
 * Baixa só o que sai por HTTP comum (STJ, TJMG, TSE). Para os demais devolve link + explicação:
 * nunca navegador automatizado, captcha ou contorno de proteção.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Cliente } from "./cliente.js";
import { acordaoNaMemoria } from "./busca.js";
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

export type ResultadoInteiroTeor =
  | { baixado: true; arquivo: string; bytes: number; fonte: string }
  | { baixado: false; link?: string; explicacao: string };

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

export function pastaPadrao(): string {
  return process.env.GARIMPO_PASTA ?? join(homedir(), "Garimpo", "inteiro-teor");
}

export async function obterInteiroTeor(
  pedido: PedidoInteiroTeor,
  clienteDe: ClientePorTribunal = clientePadrao,
): Promise<ResultadoInteiroTeor> {
  const acordao = pedido.id ? acordaoNaMemoria(pedido.id) : undefined;
  if (pedido.id && !acordao && !pedido.link) {
    throw new Error(
      `O acórdão ${pedido.id} não está na memória desta sessão. Refaça a busca ou informe tribunal e link.`,
    );
  }
  const tribunal = (acordao?.tribunal ?? pedido.tribunal ?? pedido.id?.split(":")[0] ?? "").toLowerCase();
  const link = pedido.link ?? acordao?.link;
  const info = infoTribunal(tribunal);
  if (!info) throw new Error("Informe o id do acórdão (como veio na busca) ou o tribunal e o link.");

  if (info.inteiroTeor === "link") {
    // Sem link do PDF (comum no STF), o link oficial de consulta serve para o usuário abrir no navegador.
    const linkOficial = link ?? acordao?.linkConsulta;
    let explicacao = info.motivoLink ?? "";
    if (tribunal === "tjgo" && acordao?.numeroCnj) explicacao += ` Número CNJ para pesquisar: ${acordao.numeroCnj}.`;
    if (!linkOficial) explicacao += " O JurisprudênciaIA não trouxe link para este acórdão.";
    return { baixado: false, link: linkOficial, explicacao };
  }
  if (!link) {
    return {
      baixado: false,
      explicacao: "O JurisprudênciaIA não trouxe link do inteiro teor para este acórdão; não há de onde baixar.",
    };
  }

  const cliente = clienteDe(tribunal);
  let pdf: Uint8Array;
  if (tribunal === "stj") pdf = await baixarStj(cliente, link);
  else if (tribunal === "tjmg") pdf = await baixarDireto(cliente, link, "www5.tjmg.jus.br", "TJMG");
  else if (tribunal === "tse") pdf = await baixarDireto(cliente, link, "sjur-servicos.tse.jus.br", "TSE");
  else throw new Error(`Download automático não implementado para ${tribunal.toUpperCase()}.`);

  const pasta = resolve(pedido.pasta ?? pastaPadrao());
  await mkdir(pasta, { recursive: true });
  // O número do processo não é único (dois acórdãos podem ter o mesmo): o id do documento entra no nome.
  const idDocumento =
    (acordao?.id ?? pedido.id)?.split(":")[1] ?? createHash("sha1").update(link).digest("hex").slice(0, 10);
  const nome = [tribunal, acordao?.numero, idDocumento].filter(Boolean).join("-").replace(/[^\w.-]+/g, "_");
  const arquivo = await salvarSemSobrescrever(pasta, nome, pdf);
  return { baixado: true, arquivo, bytes: pdf.length, fonte: link };
}

/** Grava sem nunca sobrescrever: mesmo conteúdo reaproveita o arquivo; conteúdo diferente ganha "-2", "-3"… */
async function salvarSemSobrescrever(pasta: string, nome: string, pdf: Uint8Array): Promise<string> {
  for (let n = 1; ; n++) {
    const arquivo = join(pasta, n === 1 ? `${nome}.pdf` : `${nome}-${n}.pdf`);
    try {
      await writeFile(arquivo, pdf, { flag: "wx" });
      return arquivo;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (Buffer.from(pdf).equals(await readFile(arquivo))) return arquivo;
    }
  }
}

/**
 * TJMG e TSE: o link do site já aponta para o PDF oficial. Só https no host oficial; redirects seguidos
 * um a um, cada destino validado antes de sair, com teto de saltos.
 */
async function baixarDireto(cliente: Cliente, link: string, host: string, sigla: string): Promise<Uint8Array> {
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
      return exigirPdf(desembrulhar(new Uint8Array(await r.arrayBuffer())), sigla, link);
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
async function baixarStj(cliente: Cliente, link: string): Promise<Uint8Array> {
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
  const r2 = await sessao.get(passo2, passo1);
  const corpo2 = new Uint8Array(await r2.arrayBuffer());
  if (ehPdf(corpo2)) return corpo2;
  const iframe = latin1(corpo2).match(/<iframe[^>]*\ssrc=['"]([^'"]+)['"]/i)?.[1];
  const passo3 = urlDoStj(
    iframe ? new URL(iframe.replace(/&amp;/g, "&"), passo2).href : passo2.replace("/mediado/", "/"),
    "O STJ apontou o PDF",
  ).href;

  const r3 = await sessao.get(passo3, passo2);
  return exigirPdf(new Uint8Array(await r3.arrayBuffer()), "STJ", passo1);
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
      if (r.status < 300 || r.status >= 400) return r;
      await r.body?.cancel();
      const destino = r.headers.get("location");
      if (!destino || saltos >= MAX_REDIRECTS) {
        throw new Error(`O STJ redirecionou sem destino ou vezes demais (${url.href}); nada foi salvo.`);
      }
      url = urlDoStj(new URL(destino, url).href, "O STJ redirecionou");
    }
  }

  async texto(url: string, referer?: string): Promise<string> {
    return latin1(new Uint8Array(await (await this.get(url, referer)).arrayBuffer()));
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
