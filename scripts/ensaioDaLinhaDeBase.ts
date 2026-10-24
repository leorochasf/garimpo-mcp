/**
 * Respostas gravadas do ensaio a seco da linha de base (B0.2), sem rede: para cada busca que os pedidos fariam no site,
 * acórdãos fictícios no formato do JurisprudênciaIA; para o Falcão, a página da fixture saneada do repositório. Tudo no
 * formato que scripts/velocidadeFetchFalso.mjs responde (`site`: "tribunal|texto" → registros; `falcao`: documentos).
 *
 * Número com o código de tribunal 99 (não existe na numeração do CNJ), órgão e ementa inventados: nada de caso real.
 * Cada tese tem 10 acórdãos por tribunal e cada formulação devolve 7 deles, em rodízio, para que a lista unificada
 * tenha repetidos entre formulações e entre os pedidos técnico e leigo, como numa rodada de verdade.
 */

import type { Pedido } from "./linhaDeBase.js";

const POR_TRIBUNAL = 10;
const POR_FORMULACAO = 7;

export interface RegistroDoSite {
  id: string;
  texto_ementa: string;
  numero_processo: string;
  orgao_julgador: string;
  data_julgamento: string;
}

export function gravadasDoEnsaio(pedidos: readonly Pedido[], documentosDoFalcao: unknown[]): { site: Record<string, RegistroDoSite[]>; falcao: unknown[] } {
  const site: Record<string, RegistroDoSite[]> = {};
  for (const p of pedidos) {
    const tese = typeof p.tese === "number" ? p.tese : 90 + Number(String(p.tese).replace(/\D/g, ""));
    p.formulacoes.forEach((f, i) => {
      for (const tribunal of p.tribunais.filter((t) => !/^trt\d+$/.test(t))) {
        site[`${tribunal}|${f}`] = Array.from({ length: POR_FORMULACAO }, (_, j) => {
          const k = (i * 3 + j) % POR_TRIBUNAL;
          return {
            id: `ensaio-${tribunal}-${tese}-${k}`,
            texto_ementa: `EMENTA: ${f.toUpperCase()}. ACÓRDÃO FICTÍCIO ${k} DA TESE ${tese}, ESCRITO PARA O ENSAIO A SECO, SEM DADO DE CASO REAL.`,
            numero_processo: `0000${String(tese).padStart(2, "0")}${k}-11.2020.8.99.0000`,
            orgao_julgador: `Órgão Fictício ${(k % 3) + 1}`,
            data_julgamento: `2024-0${(k % 9) + 1}-15T00:00:00.000Z`,
          };
        });
      }
    });
  }
  return { site, falcao: documentosDoFalcao };
}
