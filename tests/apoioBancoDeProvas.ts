import { readFileSync } from "node:fs";
import { buscaAmpla } from "../src/ampla.js";
import { Cliente, Vagas } from "../src/cliente.js";
import { respostaJson } from "./apoio.js";

/**
 * Leitor do recorte do banco de provas (tests/fixtures/banco-de-provas/) e régua sobre ele. Ver o cabeçalho de
 * tests/bancoDeProvas.test.ts.
 */

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

/** Roda a busca ampla de verdade sobre o recorte, com um site falso que só responde o que foi gravado. */
export async function rodarTese(r: Recorte): Promise<Mostrado[]> {
  const porBusca = new Map(r.buscas.map((b) => [`${b.t}|${r.formulacoes[b.f]}`, b.ids]));
  const ementa = (e: string) => e && e.split(" ").map((x, i) => (i ? r.vocabulario[+x] : x)).join(" ");
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

function contar(itens: { recorte: Recorte; lista: Mostrado[] }[], tribunal?: string): Conta {
  let mostrados = 0;
  let relevantes = 0;
  let naLista = 0;
  let achados = 0;
  let comLista = false;
  for (const { recorte, lista } of itens) {
    const doTribunal = lista.filter((x) => !tribunal || x.tribunal === tribunal);
    mostrados += doTribunal.length;
    relevantes += doTribunal.filter((x) => x.marca === "r").length;
    if (!recorte.relevantesNaLista) continue;
    const denominador = tribunal
      ? (recorte.relevantesNaLista[tribunal] ?? 0)
      : Object.values(recorte.relevantesNaLista).reduce((a, b) => a + b, 0);
    if (!denominador) continue;
    comLista = true;
    naLista += denominador;
    achados += new Set(doTribunal.filter((x) => x.marca === "r").map((x) => x.chave)).size;
  }
  return {
    mostrados,
    relevantes,
    precisao: mostrados ? relevantes / mostrados : 0,
    ...(comLista && { relevantesNaLista: naLista, achados, cobertura: achados / naLista }),
  };
}

export function medir(itens: { recorte: Recorte; lista: Mostrado[] }[]): Medicao {
  const tribunais = [...new Set(itens.flatMap((i) => i.lista.map((x) => x.tribunal)))].sort();
  return {
    global: contar(itens),
    porTribunal: Object.fromEntries(tribunais.map((t) => [t, contar(itens, t)])),
    porTese: Object.fromEntries(itens.map((i) => [i.recorte.tese, contar([i])])),
  };
}
