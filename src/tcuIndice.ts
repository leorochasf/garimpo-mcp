/**
 * Índice textual local do TCU (ADR-0025, "Decisão de velocidade 1.2"): para cada palavra do texto de um ano baixado,
 * em quais acórdãos e em que posição ela aparece. Um arquivo por ano, ao lado do CSV, sem dependência nativa e sem
 * texto novo (nenhum resumo, nenhuma IA): só as palavras do próprio texto, normalizadas como o filtro local as compara.
 * Este módulo cuida do formato e da consulta; o que entra no índice e quando ele vale decide `tcuLocal.ts`.
 *
 * Formato: `GTCUIDX1`, tamanho do cabeçalho (u32), cabeçalho JSON e o corpo (seções binárias). O cabeçalho guarda o
 * sha256 do resto do cabeçalho e do corpo, conferido na primeira abertura: índice estragado é recusado, nunca lido pela
 * metade.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";

const MAGICA = Buffer.from("GTCUIDX1");
export const VERSAO_DO_INDICE = 1;

/** Índice ausente, de outra versão, estragado ou que não bate com o arquivo do ano: a pesquisa volta à varredura. */
export class IndiceInvalidoError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// Palavras e posições
// ---------------------------------------------------------------------------------------------------------------

/** A mesma normalização do filtro local (`filtroLocal.ts`): minúsculas, sem acento, espaços reduzidos a um. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const PALAVRA = /[\p{L}\p{N}]+/gu;

/**
 * Cópia própria de um texto. Um pedaço recortado de outro texto pode manter o texto inteiro vivo na memória (no V8);
 * o que fica guardado durante a criação (palavras do vocabulário, campos dos documentos) não pode prender o acórdão.
 */
export const copiaPropria = (texto: string): string => Buffer.from(texto, "utf8").toString("utf8");

/**
 * Palavras (sequências máximas de letras e números, a mesma fronteira do filtro local) de um texto já normalizado, com
 * a posição de cada uma. Entre duas palavras separadas por exatamente um espaço a posição avança 1; por qualquer outra
 * coisa (pontuação, quebra de campo), avança 2. Assim "palavras vizinhas" no índice quer dizer "separadas por um espaço".
 */
export function palavrasDe(normalizado: string): { palavras: string[]; posicoes: number[]; vaos: string[] } {
  const palavras: string[] = [];
  const posicoes: number[] = [];
  const vaos: string[] = [];
  let fim = 0;
  let posicao = 0;
  for (const m of normalizado.matchAll(PALAVRA)) {
    const vao = normalizado.slice(fim, m.index);
    if (palavras.length) posicao += vao === " " ? 1 : 2;
    vaos.push(vao);
    palavras.push(m[0]);
    posicoes.push(posicao);
    fim = m.index + m[0].length;
  }
  vaos.push(normalizado.slice(fim));
  return { palavras, posicoes, vaos };
}

/**
 * Como procurar um termo (palavra ou frase, já normalizado): as palavras, a distância de posição de cada uma até a
 * primeira e se o índice decide sozinho. Decide sozinho quando o termo é só palavras separadas por um espaço; com
 * pontuação dentro, antes ou depois, o índice só aponta candidatos, conferidos no texto.
 */
export function estruturaDoTermo(termo: string): { palavras: string[]; distancias: number[]; exato: boolean } {
  const { palavras, posicoes, vaos } = palavrasDe(termo);
  const base = posicoes[0] ?? 0;
  return {
    palavras,
    distancias: posicoes.map((p) => p - base),
    exato: palavras.length > 0 && vaos[0] === "" && vaos[vaos.length - 1] === "" && vaos.slice(1, -1).every((v) => v === " "),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Linhas do CSV com a posição em bytes
// ---------------------------------------------------------------------------------------------------------------

/**
 * As linhas lógicas do CSV do TCU (fim de linha fora de aspas), com início e tamanho em bytes, sem carregar o arquivo.
 * Trocar o estado a cada aspa equivale ao leitor de `tcu.ts`, em que `""` dentro do campo entra e sai das aspas.
 */
export async function* linhasDoCsv(caminho: string, aoLer?: (bloco: Buffer) => void): AsyncGenerator<{ inicio: number; bytes: Buffer }> {
  let entreAspas = false;
  let inicio = 0;
  let pedacos: Buffer[] = [];
  for await (const bloco of createReadStream(caminho, { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>) {
    aoLer?.(bloco);
    let de = 0;
    let i = 0;
    while (i < bloco.length) {
      if (entreAspas) {
        const j = bloco.indexOf(0x22, i);
        if (j < 0) break;
        entreAspas = false;
        i = j + 1;
        continue;
      }
      const aspa = bloco.indexOf(0x22, i);
      const quebra = bloco.indexOf(0x0a, i);
      if (quebra >= 0 && (aspa < 0 || quebra < aspa)) {
        pedacos.push(bloco.subarray(de, quebra + 1));
        const bytes = Buffer.concat(pedacos);
        yield { inicio, bytes };
        inicio += bytes.length;
        pedacos = [];
        de = i = quebra + 1;
      } else if (aspa >= 0) {
        entreAspas = true;
        i = aspa + 1;
      } else break;
    }
    if (de < bloco.length) pedacos.push(bloco.subarray(de));
  }
  if (pedacos.length) yield { inicio, bytes: Buffer.concat(pedacos) };
}

/** Os bytes de um trecho do arquivo. */
export async function lerBytes(arquivo: Awaited<ReturnType<typeof open>>, inicio: number, tamanho: number): Promise<Buffer> {
  const buffer = Buffer.alloc(tamanho);
  const { bytesRead } = await arquivo.read(buffer, 0, tamanho, inicio);
  if (bytesRead !== tamanho) throw new IndiceInvalidoError("arquivo menor do que o índice registra");
  return buffer;
}

// ---------------------------------------------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------------------------------------------

/** Bytes que crescem sob demanda, com inteiros em LEB128 (7 bits por byte). */
class Bytes {
  dados = new Uint8Array(8);
  tamanho = 0;
  inteiro(n: number): void {
    if (this.tamanho + 5 > this.dados.length) {
      const maior = new Uint8Array(this.dados.length * 2);
      maior.set(this.dados.subarray(0, this.tamanho));
      this.dados = maior;
    }
    while (n >= 0x80) {
      this.dados[this.tamanho++] = (n & 0x7f) | 0x80;
      n >>>= 7;
    }
    this.dados[this.tamanho++] = n;
  }
}

interface Ocorrencias {
  /** Documentos em que a palavra aparece: diferença para o anterior. */
  documentos: Bytes;
  /** Por documento, as posições (diferença para a anterior, mais 1), terminadas por 0. */
  posicoes: Bytes;
  ultimo: number;
  anterior: number;
  frequencia: number;
}

/** Inteiros de 32 bits em little-endian, em qualquer máquina. */
function emBytes(lista: Uint32Array): Buffer {
  const b = Buffer.alloc(lista.length * 4);
  lista.forEach((n, i) => b.writeUInt32LE(n, i * 4));
  return b;
}

/** Acumula as palavras documento a documento (em ordem) e grava o índice de uma vez, por troca atômica. */
export class ConstrutorDoIndice {
  private readonly vocabulario = new Map<string, Ocorrencias>();
  private documentos = 0;

  /** Próximo documento (número = ordem de chegada): as palavras do seu texto normalizado. */
  adicionar(normalizado: string): number {
    const doc = this.documentos++;
    const palavra = new RegExp(PALAVRA.source, "gu");
    let fim = -1;
    let posicao = 0;
    // As mesmas posições de `palavrasDe`, sem guardar os vãos, direto no acumulador de cada palavra.
    for (let m = palavra.exec(normalizado); m; m = palavra.exec(normalizado)) {
      if (fim >= 0) posicao += m.index === fim + 1 && normalizado.charCodeAt(fim) === 32 ? 1 : 2;
      fim = palavra.lastIndex;
      let o = this.vocabulario.get(m[0]);
      if (!o) {
        o = { documentos: new Bytes(), posicoes: new Bytes(), ultimo: -1, anterior: 0, frequencia: 0 };
        this.vocabulario.set(copiaPropria(m[0]), o);
      }
      if (o.ultimo !== doc) {
        if (o.ultimo >= 0) o.posicoes.inteiro(0);
        o.documentos.inteiro(o.ultimo < 0 ? doc : doc - o.ultimo);
        o.ultimo = doc;
        o.anterior = 0;
        o.frequencia++;
      }
      o.posicoes.inteiro(posicao - o.anterior + 1);
      o.anterior = posicao;
    }
    return doc;
  }

  /** Grava em `destino` (arquivo novo ao lado, trocado no fim); `meta` vai no cabeçalho, como o chamador o deu. */
  async gravar(destino: string, meta: unknown): Promise<{ bytes: number; documentos: number; palavras: number }> {
    for (const o of this.vocabulario.values()) o.posicoes.inteiro(0);
    const entradas = [...this.vocabulario].map(([p, o]) => [Buffer.from(p, "utf8"), o] as const);
    entradas.sort((a, b) => Buffer.compare(a[0], b[0]));
    const n = entradas.length;
    const fins = new Uint32Array(n + 1);
    const frequencias = new Uint32Array(n);
    const inicioDocs = new Uint32Array(n + 1);
    const inicioPos = new Uint32Array(n + 1);
    let vocab = 0;
    let docs = 0;
    let pos = 0;
    entradas.forEach(([p, o], i) => {
      if (vocab + p.length + docs + o.documentos.tamanho + pos + o.posicoes.tamanho > 0xffffffff) {
        throw new Error("O índice do ano passaria de 4 GB; o formato não comporta.");
      }
      fins[i + 1] = vocab += p.length;
      frequencias[i] = o.frequencia;
      inicioDocs[i + 1] = docs += o.documentos.tamanho;
      inicioPos[i + 1] = pos += o.posicoes.tamanho;
    });
    // Cada seção é uma lista de pedaços já na memória: o hash e a gravação passam por eles sem juntá-los numa cópia.
    const partes: Uint8Array[][] = [
      entradas.map(([p]) => p),
      [emBytes(fins)],
      [emBytes(frequencias)],
      [emBytes(inicioDocs)],
      [emBytes(inicioPos)],
      entradas.map(([, o]) => o.documentos.dados.subarray(0, o.documentos.tamanho)),
      entradas.map(([, o]) => o.posicoes.dados.subarray(0, o.posicoes.tamanho)),
    ];
    const secoes: Record<string, [number, number]> = {};
    let deslocamento = 0;
    ["vocabulario", "fins", "frequencias", "inicioDocs", "inicioPos", "documentos", "posicoes"].forEach((nome, i) => {
      const n = partes[i].reduce((s, b) => s + b.length, 0);
      secoes[nome] = [deslocamento, n];
      deslocamento += n;
    });
    const conteudo = { versao: VERSAO_DO_INDICE, documentos: this.documentos, palavras: n, secoes, meta };
    const hash = createHash("sha256").update(JSON.stringify(conteudo));
    for (const secao of partes) for (const b of secao) hash.update(b);
    const cabecalho = Buffer.from(JSON.stringify({ ...conteudo, sha256: hash.digest("hex") }), "utf8");
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32LE(cabecalho.length);
    const novo = `${destino}.${process.pid}.${Date.now()}.novo`;
    try {
      const arquivo = await open(novo, "wx");
      try {
        let lote: Uint8Array[] = [MAGICA, tamanho, cabecalho];
        let noLote = 0;
        for (const secao of partes) {
          for (const b of secao) {
            lote.push(b);
            if ((noLote += b.length) >= 1 << 20) {
              await arquivo.writev(lote);
              [lote, noLote] = [[], 0];
            }
          }
        }
        if (lote.length) await arquivo.writev(lote);
      } finally {
        await arquivo.close();
      }
      await rename(novo, destino);
    } catch (e) {
      await rm(novo, { force: true });
      throw e;
    }
    return { bytes: MAGICA.length + 4 + cabecalho.length + deslocamento, documentos: this.documentos, palavras: n };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------------------------------------------

function lerInteiros(dados: Uint8Array, quantos: number, acumular: boolean): Uint32Array {
  const r = new Uint32Array(quantos);
  let i = 0;
  let valor = 0;
  for (let k = 0; k < quantos; k++) {
    let n = 0;
    let deslocamento = 0;
    for (;;) {
      if (i >= dados.length) throw new IndiceInvalidoError("lista de documentos cortada");
      const b = dados[i++];
      n += (b & 0x7f) * 2 ** deslocamento;
      if (b < 0x80) break;
      deslocamento += 7;
    }
    r[k] = valor = acumular ? valor + n : n;
  }
  return r;
}

/** Interseção de listas crescentes. */
export function intersecao(a: Uint32Array, b: Uint32Array): Uint32Array {
  const r = new Uint32Array(Math.min(a.length, b.length));
  let n = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] < b[j]) i++;
    else if (a[i] > b[j]) j++;
    else {
      r[n++] = a[i];
      i++;
      j++;
    }
  }
  return r.subarray(0, n);
}

function contem(lista: number[], valor: number): boolean {
  let [lo, hi] = [0, lista.length - 1];
  while (lo <= hi) {
    const meio = (lo + hi) >> 1;
    if (lista[meio] === valor) return true;
    if (lista[meio] < valor) lo = meio + 1;
    else hi = meio - 1;
  }
  return false;
}

interface Estrutura {
  cabecalho: number;
  vocabulario: Buffer;
  fins: Uint32Array;
  frequencias: Uint32Array;
  inicioDocs: Uint32Array;
  inicioPos: Uint32Array;
  documentos: [number, number];
  posicoes: [number, number];
}

const u32 = (b: Buffer) => {
  if (b.length % 4) throw new IndiceInvalidoError("seção com tamanho inválido");
  const r = new Uint32Array(b.length / 4);
  for (let i = 0; i < r.length; i++) r[i] = b.readUInt32LE(i * 4);
  return r;
};

/**
 * Um índice aberto: o vocabulário fica na memória; as listas de documentos e posições são lidas do disco a cada
 * consulta (o arquivo é aberto e fechado por consulta, para não prender o arquivo de outra janela que o troque).
 */
export class IndiceTcu<M = unknown> {
  private constructor(
    readonly caminho: string,
    readonly meta: M,
    readonly documentos: number,
    private readonly e: Estrutura,
  ) {}

  /** Abre e confere (mágica, versão, seções e sha256 do corpo). Qualquer falha: `IndiceInvalidoError`. */
  static async abrir<M>(caminho: string): Promise<IndiceTcu<M>> {
    let arquivo: Awaited<ReturnType<typeof open>>;
    try {
      arquivo = await open(caminho, "r");
    } catch (e) {
      throw new IndiceInvalidoError(`índice não encontrado (${(e as NodeJS.ErrnoException).code ?? "erro de leitura"})`);
    }
    try {
      const total = (await arquivo.stat()).size;
      const ler = async (de: number, n: number) => {
        if (!(de >= 0 && n >= 0 && de + n <= total)) throw new IndiceInvalidoError("seção fora do arquivo");
        return lerBytes(arquivo, de, n);
      };
      const inicial = await ler(0, 12);
      if (!inicial.subarray(0, 8).equals(MAGICA)) throw new IndiceInvalidoError("arquivo de índice desconhecido");
      const tamanho = inicial.readUInt32LE(8);
      let c: { versao: number; documentos: number; palavras: number; secoes: Record<string, [number, number]>; sha256: string; meta: M };
      try {
        c = JSON.parse((await ler(12, tamanho)).toString("utf8"));
      } catch (e) {
        if (e instanceof IndiceInvalidoError) throw e;
        throw new IndiceInvalidoError("cabeçalho ilegível");
      }
      if (c?.versao !== VERSAO_DO_INDICE) throw new IndiceInvalidoError("índice de outra versão do Garimpo");
      const inicio = 12 + tamanho;
      const { sha256, ...conteudo } = c;
      const hash = createHash("sha256").update(JSON.stringify(conteudo));
      for await (const b of arquivo.createReadStream({ start: inicio, autoClose: false, highWaterMark: 1 << 20 })) hash.update(b);
      if (hash.digest("hex") !== sha256) throw new IndiceInvalidoError("índice estragado: o sha256 não confere");
      const secao = (nome: string) => {
        const [de, n] = c.secoes?.[nome] ?? [-1, -1];
        if (!(Number.isSafeInteger(de) && Number.isSafeInteger(n) && de >= 0 && n >= 0 && inicio + de + n <= total)) {
          throw new IndiceInvalidoError("seção fora do arquivo");
        }
        return [de, n] as [number, number];
      };
      const fatia = (nome: string) => {
        const [de, n] = secao(nome);
        return ler(inicio + de, n);
      };
      const e: Estrutura = {
        cabecalho: inicio,
        vocabulario: await fatia("vocabulario"),
        fins: u32(await fatia("fins")),
        frequencias: u32(await fatia("frequencias")),
        inicioDocs: u32(await fatia("inicioDocs")),
        inicioPos: u32(await fatia("inicioPos")),
        documentos: secao("documentos"),
        posicoes: secao("posicoes"),
      };
      if (e.fins.length !== c.palavras + 1 || e.frequencias.length !== c.palavras || e.inicioDocs.length !== c.palavras + 1 || e.inicioPos.length !== c.palavras + 1) {
        throw new IndiceInvalidoError("seções que não batem entre si");
      }
      return new IndiceTcu(caminho, c.meta, c.documentos, e);
    } catch (e) {
      // Erro de leitura também é índice inválido. No Linux uma pasta no lugar do índice abre e tem tamanho: só a leitura
      // falha (EISDIR). No Windows a pasta tem tamanho 0 e já sai recusada como seção fora do arquivo.
      if (e instanceof IndiceInvalidoError) throw e;
      throw new IndiceInvalidoError(`índice sumiu ou ficou ilegível (${(e as NodeJS.ErrnoException).code ?? "erro de leitura"})`);
    } finally {
      await arquivo.close();
    }
  }

  private posicaoDa(palavra: string): number {
    const alvo = Buffer.from(palavra, "utf8");
    let [lo, hi] = [0, this.e.frequencias.length - 1];
    while (lo <= hi) {
      const meio = (lo + hi) >> 1;
      const cmp = this.e.vocabulario.compare(alvo, 0, alvo.length, this.e.fins[meio], this.e.fins[meio + 1]);
      if (cmp === 0) return meio;
      if (cmp < 0) lo = meio + 1;
      else hi = meio - 1;
    }
    return -1;
  }

  /** Abre o arquivo para uma consulta; `fechar` no fim. */
  async leitor(): Promise<LeitorDoIndice> {
    const arquivo = await open(this.caminho, "r").catch((erro: NodeJS.ErrnoException) => {
      throw new IndiceInvalidoError(`índice sumiu ou ficou ilegível (${erro.code ?? "erro de leitura"})`);
    });
    const e = this.e;
    const ler = async ([base, total]: [number, number], de: number, ate: number) => {
      if (!(de <= ate && ate <= total)) throw new IndiceInvalidoError("ponteiro fora da seção");
      return lerBytes(arquivo, e.cabecalho + base + de, ate - de);
    };
    const docsDa = async (i: number) => {
      const docs = lerInteiros(await ler(e.documentos, e.inicioDocs[i], e.inicioDocs[i + 1]), e.frequencias[i], true);
      if (docs.length && docs[docs.length - 1] >= this.documentos) throw new IndiceInvalidoError("documento fora do índice");
      return docs;
    };
    return {
      fechar: () => arquivo.close(),
      termo: async (termo: string) => {
        const t = estruturaDoTermo(termo);
        const indices = t.palavras.map((p) => this.posicaoDa(p));
        if (indices.some((i) => i < 0)) return { documentos: new Uint32Array(), exato: t.exato };
        const listas = await Promise.all(indices.map(docsDa));
        let docs = listas.reduce((a, b) => (a.length <= b.length ? intersecao(a, b) : intersecao(b, a)));
        if (t.palavras.length > 1 && docs.length) {
          // Posições só dos documentos que têm todas as palavras; fica quem tem a sequência na distância certa.
          const posicoes = await Promise.all(
            indices.map(async (i, k) => {
              const bruto = await ler(e.posicoes, e.inicioPos[i], e.inicioPos[i + 1]);
              const todos = listas[k];
              const doDoc = new Map<number, number[]>();
              let c = 0;
              const proximo = () => {
                let n = 0;
                let d = 0;
                for (;;) {
                  if (c >= bruto.length) throw new IndiceInvalidoError("lista de posições cortada");
                  const b = bruto[c++];
                  n += (b & 0x7f) * 2 ** d;
                  if (b < 0x80) return n;
                  d += 7;
                }
              };
              let j = 0;
              for (let x = 0; x < todos.length; x++) {
                const quer = j < docs.length && docs[j] === todos[x];
                const lista: number[] = [];
                let p = 0;
                for (let v = proximo(); v; v = proximo()) {
                  p += v - 1;
                  if (quer) lista.push(p);
                }
                if (quer) {
                  doDoc.set(todos[x], lista);
                  j++;
                }
              }
              return doDoc;
            }),
          );
          docs = docs.filter((d) =>
            posicoes[0].get(d)!.some((p) => t.distancias.every((dist, k) => contem(posicoes[k].get(d)!, p + dist))),
          );
        }
        return { documentos: docs, exato: t.exato };
      },
    };
  }
}

export interface LeitorDoIndice {
  /** Documentos (crescentes) em que o termo normalizado aparece; `exato` = sem conferir no texto. */
  termo(termo: string): Promise<{ documentos: Uint32Array; exato: boolean }>;
  fechar(): Promise<void>;
}
