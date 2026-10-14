/**
 * TCU (ADR-0024): acórdãos pelos arquivos anuais de dados abertos, baixados pelo usuário e pesquisados no computador
 * dele. Fontes, termos e limites: docs/fontes.md. Nada do TCU vai no pacote; sem INTERESSADOS nem ADVOGADO (LGPD).
 */

import { createReadStream } from "node:fs";

export const HOST_TCU = "sites.tcu.gov.br";
const BASE_ARQUIVOS = `https://${HOST_TCU}/dados-abertos/jurisprudencia/arquivos`;
export const URL_LISTA_TCU = `${BASE_ARQUIVOS}/jurisprudencia-arquivos.csv`;
export const urlDoAnoTcu = (ano: number) => `${BASE_ARQUIVOS}/acordao-completo/acordao-completo-${ano}.csv`;

export interface AnoDoTcu {
  ano: number;
  url: string;
  /** Tamanho declarado na lista do TCU, em MB (undefined se a lista não o traz). */
  tamanhoMb?: number;
}

export interface ListaDoTcu {
  /** Data da última atualização, como a 1ª linha da lista a traz (dd/mm/aaaa). */
  baseEm?: string;
  anos: AnoDoTcu[];
}

const UNIDADE_EM_MB = { KB: 1 / 1024, MB: 1, GB: 1024 } as const;

/**
 * Lê a lista oficial de arquivos. O formato das linhas não foi visto por inteiro (só a 1ª linha e os tamanhos como
 * "394.40 MB"): acha, em cada linha, o ano do `acordao-completo-<ano>.csv` e o tamanho; o resto da linha não importa.
 */
export function analisarListaTcu(texto: string): ListaDoTcu {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const baseEm = linhas.find((l) => l.trim())?.match(/^\W*(\d{2}\/\d{2}\/\d{4})\W*$/)?.[1];
  const porAno = new Map<number, AnoDoTcu>();
  for (const linha of linhas) {
    const ano = linha.match(/acordao-completo-(\d{4})\.csv/)?.[1];
    if (!ano || porAno.has(Number(ano))) continue;
    const tamanho = linha.match(/(\d+(?:[.,]\d+)?)\s*(KB|MB|GB)\b/i);
    porAno.set(Number(ano), {
      ano: Number(ano),
      url: linha.match(/https:\/\/[^\s"|;,]*acordao-completo-\d{4}\.csv/)?.[0] ?? urlDoAnoTcu(Number(ano)),
      ...(tamanho
        ? { tamanhoMb: Math.round(Number(tamanho[1].replace(",", ".")) * UNIDADE_EM_MB[tamanho[2].toUpperCase() as "KB"] * 100) / 100 }
        : {}),
    });
  }
  return { ...(baseEm ? { baseEm } : {}), anos: [...porAno.values()].sort((a, b) => a.ano - b.ano) };
}

/** Colunas que o Garimpo nunca guarda: dado pessoal (LGPD). */
const COLUNAS_VEDADAS = new Set(["INTERESSADOS", "ADVOGADO"]);
const COLUNAS_OBRIGATORIAS = ["KEY", "TIPO", "TITULO", "SITUACAO", "ACORDAO"];

export type RegistroDoTcu = Record<string, string>;

/**
 * Lê o CSV do TCU (separador `|`, campos entre aspas com `""`, quebra de linha dentro do campo) em fluxo, um registro
 * por vez, sem as colunas vedadas. O corte entre blocos pode cair em qualquer ponto, até no meio de um par de aspas.
 */
export async function* lerRegistrosTcu(blocos: AsyncIterable<string>): AsyncGenerator<RegistroDoTcu> {
  let cabecalho: string[] | undefined;
  let campos: string[] = [];
  let campo = "";
  let entreAspas = false;
  /** O bloco anterior terminou numa aspa dentro do campo: fecha o campo ou é metade de `""`. */
  let aspaPendente = false;
  let primeiro = true;

  function fimDaLinha(): RegistroDoTcu | undefined {
    campos.push(campo);
    const linha = campos;
    campos = [];
    campo = "";
    if (linha.length === 1 && linha[0] === "") return undefined;
    if (!cabecalho) {
      cabecalho = linha;
      if (COLUNAS_OBRIGATORIAS.some((c) => !cabecalho!.includes(c))) {
        throw new Error("O arquivo do TCU não tem o cabeçalho esperado (KEY, TIPO, TITULO, SITUACAO, ACORDAO). O formato pode ter mudado.");
      }
      return undefined;
    }
    const registro: RegistroDoTcu = {};
    cabecalho.forEach((nome, i) => {
      if (!COLUNAS_VEDADAS.has(nome)) registro[nome] = linha[i] ?? "";
    });
    return registro;
  }

  for await (let s of blocos) {
    if (primeiro) {
      s = s.replace(/^﻿/, "");
      primeiro = false;
    }
    let i = 0;
    if (aspaPendente) {
      aspaPendente = false;
      if (s[0] === '"') {
        campo += '"';
        i = 1;
      } else entreAspas = false;
    }
    while (i < s.length) {
      if (entreAspas) {
        const j = s.indexOf('"', i);
        if (j < 0) {
          campo += s.slice(i);
          break;
        }
        campo += s.slice(i, j);
        if (j + 1 >= s.length) {
          aspaPendente = true;
          break;
        }
        if (s[j + 1] === '"') {
          campo += '"';
          i = j + 2;
        } else {
          entreAspas = false;
          i = j + 1;
        }
        continue;
      }
      const c = s[i++];
      if (c === '"') entreAspas = true;
      else if (c === "|") {
        campos.push(campo);
        campo = "";
      } else if (c === "\n") {
        const r = fimDaLinha();
        if (r) yield r;
      } else if (c !== "\r") campo += c;
    }
  }
  if (aspaPendente) entreAspas = false;
  if (campo !== "" || campos.length) {
    const r = fimDaLinha();
    if (r) yield r;
  }
}

/** Os blocos de texto de um arquivo, em UTF-8, sem carregá-lo inteiro. */
export function blocosDoArquivo(caminho: string): AsyncIterable<string> {
  return createReadStream(caminho, { encoding: "utf8", highWaterMark: 1 << 20 });
}
