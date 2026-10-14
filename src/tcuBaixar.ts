/**
 * TCU (ADR-0024), parte de rede: lista dos anos e download dos arquivos anuais para o computador do usuário.
 * Toda chamada passa pelo cliente único (freios da regra 3); um arquivo por vez; retomável; nada é baixado sem
 * confirmação explícita; o que já está no disco só é trocado depois que o novo chegou inteiro.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { Readable } from "node:stream";
import { Cliente, ErroHttp, FormatoInesperadoError, type OpcoesCliente } from "./cliente.js";
import { analisarListaTcu, HOST_TCU, type ListaDoTcu, URL_LISTA_TCU, urlDoAnoTcu } from "./tcu.js";
import { anosBaixadosTcu, caminhoDoAnoTcu, caminhoDoReciboTcu, lerReciboTcu, pastaDoTcu, type ReciboTcu } from "./tcuLocal.js";

/** Um arquivo de 400 MB leva tempo: 30 min por chamada (o parcial fica guardado se estourar). 1 s entre chamadas ao TCU. */
export function clienteDoTcu(extra: Partial<OpcoesCliente> = {}): Cliente {
  return new Cliente({ nome: "O TCU", intervaloMinimoPorHost: { [HOST_TCU]: 1_000 }, prazoMs: 30 * 60_000, ...extra });
}

/** Uma só chamada: a lista oficial de arquivos (data da base e tamanhos). */
export async function listarAnosDoTcu(cliente: Cliente): Promise<ListaDoTcu> {
  const resposta = await cliente.requisitar(URL_LISTA_TCU, { redirect: "manual" });
  if (resposta.status >= 300) {
    await resposta.body?.cancel();
    throw new FormatoInesperadoError(`O TCU redirecionou a lista de arquivos (HTTP ${resposta.status}); o Garimpo não segue o desvio sozinho.`);
  }
  const lista = analisarListaTcu(await resposta.text());
  if (!lista.anos.length) throw new FormatoInesperadoError("A lista de arquivos do TCU não trouxe nenhum ano de acórdãos; o formato pode ter mudado.");
  return lista;
}

export interface AvisoDeBaixaTcu {
  precisaConfirmar: boolean;
  anos: { ano: number; tamanhoMb?: number; jaBaixado: boolean }[];
  /** Soma dos que ainda faltam baixar (os que têm tamanho na lista). */
  totalMb: number;
  pasta: string;
  mensagem: string;
}

const mb = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB`;

/** O aviso que vem antes de qualquer download: o que precisa baixar, quanto pesa e onde fica. Sem rede. */
export async function avisoDeBaixaTcu(dados: string, lista: ListaDoTcu, anosPedidos: number[]): Promise<AvisoDeBaixaTcu> {
  const locais = await anosBaixadosTcu(dados);
  const anos = [...new Set(anosPedidos)].sort((a, b) => a - b).map((ano) => {
    const l = lista.anos.find((x) => x.ano === ano);
    if (!l) throw new Error(`O TCU não lista o ano ${ano} nos arquivos de acórdãos.`);
    return { ano, tamanhoMb: l.tamanhoMb, jaBaixado: locais.includes(ano) };
  });
  const faltam = anos.filter((a) => !a.jaBaixado);
  const totalMb = Math.round(faltam.reduce((s, a) => s + (a.tamanhoMb ?? 0), 0) * 100) / 100;
  const pasta = pastaDoTcu(dados);
  const mensagem = faltam.length
    ? "Para pesquisar o TCU, o Garimpo precisa baixar os arquivos anuais de acórdãos para este computador: " +
      `${faltam.map((a) => `${a.ano} (${a.tamanhoMb ? mb(a.tamanhoMb) : "tamanho não informado"})`).join(", ")}; ` +
      `total de cerca de ${mb(totalMb)}, guardados em ${pasta}. Cada arquivo vem direto do TCU, um por vez, e pode levar ` +
      "vários minutos. Nada foi baixado: para baixar, chame de novo com confirmar: true."
    : `Os anos pedidos já estão baixados em ${pasta}. Para conferir se o TCU atualizou algum, use renovar: true com confirmar: true.`;
  return { precisaConfirmar: faltam.length > 0, anos, totalMb, pasta, mensagem };
}

export type SituacaoDaBaixa = "baixado" | "retomado" | "atualizado" | "sem-mudanca" | "ja-baixado";

export interface PedidoDeBaixaTcu {
  dados: string;
  cliente: Cliente;
  ano: number;
  /** Ano já baixado: pergunta ao TCU se mudou e só então baixa de novo. */
  renovar?: boolean;
  /** Data da lista do TCU (dd/mm/aaaa), guardada no recibo. */
  listaEm?: string;
  agora?: () => number;
}

export interface ResultadoDaBaixaTcu {
  ano: number;
  situacao: SituacaoDaBaixa;
  bytes?: number;
  sha256?: string;
}

const TRAVA_VELHA_MS = 30 * 60_000;
const CABECALHO_ESPERADO = /^﻿?"KEY"\|"TIPO"\|"TITULO"/;

async function pegarTrava(trava: string, ano: number): Promise<void> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      await writeFile(trava, String(process.pid), { flag: "wx" });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const idade = Date.now() - (await stat(trava).catch(() => ({ mtimeMs: 0 }))).mtimeMs;
      if (tentativa > 0 || idade < TRAVA_VELHA_MS) {
        throw new Error(`Outra janela do Garimpo está baixando o ano ${ano} do TCU agora. Espere ela terminar e tente de novo.`);
      }
      await rm(trava, { force: true });
    }
  }
}

async function tamanhoOuZero(caminho: string): Promise<number> {
  return (await stat(caminho).catch(() => undefined))?.size ?? 0;
}

/** Grava o corpo no arquivo; na queda, o que já chegou é descarregado no disco antes de devolver o erro (para retomar). */
async function gravarCorpo(corpo: ReadableStream<Uint8Array> | null, caminho: string, flags: "a" | "w"): Promise<Error | undefined> {
  const arquivo = createWriteStream(caminho, { flags });
  let falha: Error | undefined;
  try {
    for await (const bloco of Readable.fromWeb(corpo as never) as AsyncIterable<Buffer>) {
      if (!arquivo.write(bloco)) await once(arquivo, "drain");
    }
  } catch (e) {
    falha = e as Error;
  }
  arquivo.end();
  await once(arquivo, "close");
  return falha;
}

async function hashDe(caminho: string): Promise<string> {
  const h = createHash("sha256");
  for await (const bloco of createReadStream(caminho)) h.update(bloco);
  return h.digest("hex");
}

async function cabecalhoConfere(caminho: string): Promise<boolean> {
  const f = await open(caminho, "r");
  try {
    const { bytesRead, buffer } = await f.read(Buffer.alloc(256), 0, 256, 0);
    return CABECALHO_ESPERADO.test(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await f.close();
  }
}

/** Baixa (ou retoma, ou renova) o arquivo de um ano. Erro = o parcial fica; a cópia antiga nunca é tocada. */
export async function baixarAnoTcu(p: PedidoDeBaixaTcu): Promise<ResultadoDaBaixaTcu> {
  const { dados, cliente, ano } = p;
  const url = urlDoAnoTcu(ano);
  const destino = caminhoDoAnoTcu(dados, ano);
  const parcial = `${destino}.parcial`;
  const meta = `${parcial}.json`;
  const existente = existsSync(destino);
  if (existente && !p.renovar) return { ano, situacao: "ja-baixado" };

  await mkdir(pastaDoTcu(dados), { recursive: true });
  const trava = `${destino}.trava`;
  await pegarTrava(trava, ano);
  try {
    const tamanhoParcial = await tamanhoOuZero(parcial);
    const guardado = tamanhoParcial > 0 ? await readFile(meta, "utf8").then((t) => JSON.parse(t) as { etag?: string; lastModified?: string }, () => undefined) : undefined;
    const validador = guardado?.etag ?? guardado?.lastModified;
    const retomando = Boolean(validador);
    const cabecalhos: Record<string, string> = {};
    if (retomando) {
      cabecalhos.Range = `bytes=${tamanhoParcial}-`;
      cabecalhos["If-Range"] = validador!;
    } else if (existente) {
      const recibo = await lerReciboTcu(dados, ano);
      if (recibo?.etag) cabecalhos["If-None-Match"] = recibo.etag;
      if (recibo?.lastModified) cabecalhos["If-Modified-Since"] = recibo.lastModified;
    }

    let resposta: Response;
    try {
      resposta = await cliente.requisitar(url, { headers: cabecalhos, redirect: "manual" });
    } catch (e) {
      if (e instanceof ErroHttp && e.status === 416) {
        await rm(parcial, { force: true });
        await rm(meta, { force: true });
        throw new Error(`O TCU recusou retomar o download de ${ano} (HTTP 416). O parcial foi descartado: chame de novo para baixar do início.`);
      }
      throw e;
    }
    if (resposta.status === 304) {
      await resposta.body?.cancel();
      return { ano, situacao: "sem-mudanca" };
    }
    if (resposta.status >= 300) {
      await resposta.body?.cancel();
      throw new Error(`O TCU redirecionou o arquivo de ${ano} (HTTP ${resposta.status}); o Garimpo não segue o desvio sozinho.`);
    }

    const emContinuacao = resposta.status === 206 && retomando;
    let esperado: number | undefined;
    if (emContinuacao) {
      const faixa = resposta.headers.get("content-range")?.match(/^bytes (\d+)-\d+\/(\d+|\*)$/);
      if (!faixa || Number(faixa[1]) !== tamanhoParcial) {
        await resposta.body?.cancel();
        throw new Error(`O TCU respondeu à retomada de ${ano} com uma faixa inesperada. O parcial ficou guardado.`);
      }
      esperado = faixa[2] === "*" ? undefined : Number(faixa[2]);
    } else {
      const declarado = Number(resposta.headers.get("content-length"));
      esperado = declarado > 0 ? declarado : undefined;
    }
    await writeFile(meta, JSON.stringify({ etag: resposta.headers.get("etag") ?? undefined, lastModified: resposta.headers.get("last-modified") ?? undefined }));
    const falha = await gravarCorpo(resposta.body, parcial, emContinuacao ? "a" : "w");
    if (falha) {
      throw new Error(`O download de ${ano} foi interrompido (${falha.message}). O que já chegou ficou guardado: chame de novo para retomar.`);
    }
    const bytes = await tamanhoOuZero(parcial);
    if (esperado !== undefined && bytes !== esperado) {
      throw new Error(`O arquivo de ${ano} chegou incompleto (${bytes} de ${esperado} bytes). O que chegou ficou guardado: chame de novo para retomar.`);
    }
    if (!(await cabecalhoConfere(parcial))) {
      await rm(parcial, { force: true });
      await rm(meta, { force: true });
      throw new FormatoInesperadoError(`O arquivo de ${ano} não tem o cabeçalho esperado do TCU (KEY, TIPO, TITULO…); o formato pode ter mudado. Nada foi guardado.`);
    }
    const sha256 = await hashDe(parcial);
    const recibo: ReciboTcu = {
      ano, url, bytes, sha256,
      ...(resposta.headers.get("etag") ? { etag: resposta.headers.get("etag")! } : {}),
      ...(resposta.headers.get("last-modified") ? { lastModified: resposta.headers.get("last-modified")! } : {}),
      baixadoEm: new Date((p.agora ?? Date.now)()).toISOString(),
      ...(p.listaEm ? { listaEm: p.listaEm } : {}),
    };
    await rename(parcial, destino);
    const reciboNovo = `${caminhoDoReciboTcu(dados, ano)}.novo`;
    await writeFile(reciboNovo, JSON.stringify(recibo, null, 2));
    await rename(reciboNovo, caminhoDoReciboTcu(dados, ano));
    await rm(meta, { force: true });
    return { ano, situacao: existente ? "atualizado" : emContinuacao ? "retomado" : "baixado", bytes, sha256 };
  } finally {
    await rm(trava, { force: true });
  }
}
