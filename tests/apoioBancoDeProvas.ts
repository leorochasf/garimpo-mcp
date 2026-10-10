import { readdirSync, readFileSync } from "node:fs";
import { buscaAmpla } from "../src/ampla.js";
import { Cliente, Vagas } from "../src/cliente.js";
import { respostaJson } from "./apoio.js";

/**
 * Leitor do recorte do banco de provas (tests/fixtures/banco-de-provas/) e régua sobre ele. Ver o cabeçalho de
 * tests/bancoDeProvas.test.ts.
 *
 * Duas medidas, que não se misturam:
 * - "preMarcacao": relevante = marca "r" da pré-marcação por IA OU do dono. Serve só de TRAVA DE REGRESSÃO DA ORDEM
 *   (a ordem de hoje piorou?); NÃO é medida de qualidade, porque a IA não é o gabarito.
 * - "dono": relevante = marca "r" confirmada pelo dono (campo `doDono`). É a medida de qualidade; sem a cobertura,
 *   que precisaria da lista de relevantes do dono, e que o recorte só tem pela pré-marcação.
 */
export type Gabarito = "preMarcacao" | "dono";


type Marca = "r" | "i" | "d" | null;

/** [tribunal, data, número sintético, tem órgão, tem link, ementa reduzida, marca, chave do gabarito, marca do dono] */
type Linha = [string, string | null, number | null, 0 | 1, 0 | 1, string, Marca, number, 0 | 1];

export interface Recorte {
  tese: number;
  nome: string;
  grupo: "rodada-1" | "controle";
  tribunais: string[];
  formulacoes: string[];
  /** Só nas teses com lista unificada: relevantes dela por tribunal (denominador da cobertura). */
  relevantesNaLista?: Record<string, number>;
  vocabulario: string[];
  buscas: { t: string; f: number; ids: number[] }[];
  acordaos: Linha[];
}

/** Um acórdão da lista mostrada, com a marca do gabarito. */
export interface Mostrado {
  /** Índice do acórdão no recorte. */
  indice: number;
  tribunal: string;
  marca: Marca;
  chave: number;
  doDono: boolean;
}

const PASTA = new URL("./fixtures/banco-de-provas/", import.meta.url);

export function carregarRecorte(tese: number): Recorte {
  return JSON.parse(readFileSync(new URL(`tese-${String(tese).padStart(2, "0")}.json`, PASTA), "utf8")) as Recorte;
}

export function carregarRegua(): Regua {
  return JSON.parse(readFileSync(new URL("regua.json", PASTA), "utf8")) as Regua;
}

/** Embaralhamento fixo (mesma semente, mesma ordem), para a prova de regressão ser repetível. */
function embaralhado<T>(lista: readonly T[], semente: number): T[] {
  const copia = [...lista];
  let x = semente || 1;
  for (let i = copia.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

export interface OpcoesDaRodada {
  /**
   * Prova de regressão: o site falso devolve cada busca em ordem embaralhada e a ementa sem as palavras da tese (só o
   * marcador de cópias), como uma ordem que ignorasse a tese.
   */
  embaralhar?: boolean;
}

/** Roda a busca ampla de verdade sobre o recorte, com um site falso que só responde o que foi gravado. */
export async function rodarTese(r: Recorte, { embaralhar = false }: OpcoesDaRodada = {}): Promise<Mostrado[]> {
  const porBusca = new Map(
    r.buscas.map((b, i) => [`${b.t}|${r.formulacoes[b.f]}`, embaralhar ? embaralhado(b.ids, r.tese * 100 + i) : b.ids]),
  );
  const ementa = (e: string) =>
    embaralhar ? e.split(" ")[0] : e && e.split(" ").map((x, i) => (i ? r.vocabulario[+x] : x)).join(" ");
  const cliente = new Cliente({
    nome: "O site",
    vagas: new Vagas(2),
    esperar: async () => {},
    fetch: (async (url: string, init: RequestInit) => {
      const tribunal = String(url).match(/tribunais\/(\w+)\/search/)![1];
      const ids = porBusca.get(`${tribunal}|${JSON.parse(String(init.body)).query}`);
      if (!ids) throw new Error(`busca fora do recorte: ${tribunal}`);
      return respostaJson({
        juris: ids.map((k) => {
          const [, data, numero, orgao, link, e] = r.acordaos[k];
          return {
            id: `a${k}`,
            texto_ementa: ementa(e),
            numero_processo: numero === null ? undefined : String(numero),
            orgao_julgador: orgao ? "Órgão" : undefined,
            data_julgamento: data ?? undefined,
            link_pdf: link ? "https://exemplo.invalid/" : undefined,
          };
        }),
      });
    }) as typeof fetch,
  });
  const resultado = await buscaAmpla(cliente, { formulacoes: r.formulacoes, tribunais: r.tribunais });
  return resultado.acordaos.map((a) => {
    const indice = Number(a.id.split(":a")[1]);
    const [tribunal, , , , , , marca, chave, dono] = r.acordaos[indice];
    return { indice, tribunal, marca, chave, doDono: dono === 1 };
  });
}

/** Todas as teses do recorte: a medição, e por tese os índices dos mostrados, na ordem. */
export async function rodarBanco(opcoes: OpcoesDaRodada = {}): Promise<{ medicao: Medicao; posicoes: Record<number, number[]>; itens: { recorte: Recorte; lista: Mostrado[] }[] }> {
  const teses = readdirSync(PASTA)
    .map((f) => f.match(/^tese-(\d+)\.json$/)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  const itens = [];
  for (const t of teses) {
    const recorte = carregarRecorte(t);
    itens.push({ recorte, lista: await rodarTese(recorte, opcoes) });
  }
  return {
    itens,
    medicao: medir(itens),
    posicoes: Object.fromEntries(itens.map((i) => [i.recorte.tese, i.lista.map((x) => x.indice)])),
  };
}

export interface Conta {
  mostrados: number;
  relevantes: number;
  /** Relevantes ÷ mostrados; sem marca e dúvida contam como não relevantes. */
  precisao: number;
  /** Só onde há lista unificada. */
  relevantesNaLista?: number;
  /** Relevantes distintos (pela chave do gabarito) entre os mostrados, nas teses com lista unificada. */
  achados?: number;
  cobertura?: number;
}

export interface Medicao {
  global: Conta;
  porTribunal: Record<string, Conta>;
  porTese: Record<number, Conta>;
}

const ehRelevante = (x: Mostrado, gabarito: Gabarito) => x.marca === "r" && (gabarito === "preMarcacao" || x.doDono);

/** Quantos relevantes o dono confirmou entre os mostrados (base da medida de qualidade). */
export function contarConfirmadosDoDono(itens: { lista: Mostrado[] }[]): { relevantesConfirmados: number; mostrados: number } {
  let relevantesConfirmados = 0;
  let mostrados = 0;
  for (const { lista } of itens) {
    mostrados += lista.length;
    relevantesConfirmados += lista.filter((x) => ehRelevante(x, "dono")).length;
  }
  return { relevantesConfirmados, mostrados };
}

function contar(itens: { recorte: Recorte; lista: Mostrado[] }[], tribunal?: string, gabarito: Gabarito = "preMarcacao"): Conta {
  let mostrados = 0;
  let relevantes = 0;
  let naLista = 0;
  let achados = 0;
  let comLista = false;
  for (const { recorte, lista } of itens) {
    const doTribunal = lista.filter((x) => !tribunal || x.tribunal === tribunal);
    mostrados += doTribunal.length;
    relevantes += doTribunal.filter((x) => ehRelevante(x, gabarito)).length;
    if (gabarito === "dono" || !recorte.relevantesNaLista) continue;
    const denominador = tribunal
      ? (recorte.relevantesNaLista[tribunal] ?? 0)
      : Object.values(recorte.relevantesNaLista).reduce((a, b) => a + b, 0);
    if (!denominador) continue;
    comLista = true;
    naLista += denominador;
    achados += new Set(doTribunal.filter((x) => ehRelevante(x, gabarito)).map((x) => x.chave)).size;
  }
  return {
    mostrados,
    relevantes,
    precisao: mostrados ? relevantes / mostrados : 0,
    ...(comLista && { relevantesNaLista: naLista, achados, cobertura: achados / naLista }),
  };
}

export interface Limiar {
  precisao: number;
  cobertura?: number;
}

export interface Regua {
  /** Os obrigatórios têm de estar entre os `topo` primeiros. */
  topo: number;
  limiares: { global: Limiar; porTribunal: Record<string, Limiar>; porTese: Record<number, Limiar> };
  /**
   * Por tese: índices, no recorte, dos acórdãos obrigatórios. PROVISÓRIOS, aguardando confirmação do dono: foram
   * tirados mecanicamente dos primeiros resultados de uma medição, não escolhidos por ele.
   */
  obrigatorios: Record<number, number[]>;
  /** Qualidade contra o gabarito do dono: só mede com confirmações suficientes; sem elas, registra a lacuna. */
  qualidadeDoDono?: { minimoDeRelevantesConfirmados: number; limiarDePrecisao?: number };
}

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;

/**
 * As falhas da medição contra a régua, uma frase por falha (lista vazia = passou). `posicoes`: por tese, os índices
 * dos acórdãos mostrados, na ordem.
 */
export function conferirRegua(
  medicao: { global: Partial<Conta>; porTribunal: Record<string, Partial<Conta>>; porTese: Record<number, Partial<Conta>> },
  posicoes: Record<number, number[]>,
  regua: Regua,
): string[] {
  const falhas: string[] = [];
  const conferir = (rotulo: string, conta: Partial<Conta> | undefined, limiar: Limiar) => {
    const precisao = conta?.precisao ?? 0;
    if (precisao < limiar.precisao) falhas.push(`${rotulo}: precisão ${pct(precisao)} abaixo do limiar ${pct(limiar.precisao)}`);
    if (limiar.cobertura === undefined) return;
    const cobertura = conta?.cobertura ?? 0;
    if (cobertura < limiar.cobertura) falhas.push(`${rotulo}: cobertura ${pct(cobertura)} abaixo do limiar ${pct(limiar.cobertura)}`);
  };
  conferir("global", medicao.global, regua.limiares.global);
  for (const [t, limiar] of Object.entries(regua.limiares.porTribunal)) conferir(t.toUpperCase(), medicao.porTribunal[t], limiar);
  for (const [t, limiar] of Object.entries(regua.limiares.porTese)) conferir(`tese ${t}`, medicao.porTese[+t], limiar);
  for (const [t, obrigatorios] of Object.entries(regua.obrigatorios)) {
    const lista = posicoes[+t] ?? [];
    for (const o of obrigatorios) {
      const p = lista.indexOf(o);
      if (p < 0) falhas.push(`tese ${t}: obrigatório ${o} fora da lista`);
      else if (p >= regua.topo) falhas.push(`tese ${t}: obrigatório ${o} na posição ${p + 1}, fora do topo ${regua.topo}`);
    }
  }
  return falhas;
}

export function medir(itens: { recorte: Recorte; lista: Mostrado[] }[], gabarito: Gabarito = "preMarcacao"): Medicao {
  const tribunais = [...new Set(itens.flatMap((i) => i.lista.map((x) => x.tribunal)))].sort();
  return {
    global: contar(itens, undefined, gabarito),
    porTribunal: Object.fromEntries(tribunais.map((t) => [t, contar(itens, t, gabarito)])),
    porTese: Object.fromEntries(itens.map((i) => [i.recorte.tese, contar([i], undefined, gabarito)])),
  };
}
