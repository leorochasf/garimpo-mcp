/**
 * Rodada de gravação do banco de provas (ticket 21 do B15): USA REDE, só o JurisprudênciaIA, só a busca direta
 * (POST /api/tribunais/<sigla>/search), pelo cliente único do Garimpo (≤ 2 simultâneas no total, em 429/503 espera e
 * UMA nova tentativa, recusa final = disjuntor aberto para todas as janelas). Sem paralelismo próprio: uma chamada por
 * vez, espaçada. Rode UMA vez, sozinho, com nenhum outro programa fazendo rede.
 *
 * Uso: npx vite-node scripts/rodarRodadaDeProvas.ts -- --saida <pasta> --ao-vivo
 * (sem os dois, recusa; pasta com plano.json ou gravacao/ também recusa — ver recusaDaRodada).
 *
 * Teto: 80 chamadas ao site na rodada inteira, contando a nova tentativa de 429/503 (decisão do piloto). Fora do teto
 * nada sai: a trava está no fetch embrulhado, não só na lista. Ordem: temas da amostra → teses (técnica e leiga) →
 * verificação dos paradigmas que não apareceram → "só palavras" com a sobra (parando duas chamadas antes do teto, de
 * margem para a nova tentativa). Recusa (ou serviço pausado): para ali e grava o que tiver.
 *
 * Grava, em <saida>: plano.json (declarado antes de rodar), gravacao/NNN-<id>.json (a resposta crua de cada chamada),
 * resultados.json (por consulta: a lista de números devolvida, a posição do paradigma) e estado.json (chamadas por
 * host, recusas, se terminou).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buscaDireta, SITE } from "../src/busca.js";
import { Cliente, RecusaError } from "../src/cliente.js";
import { coordenacaoPadrao } from "../src/coordenacao.js";
import { novaChamada, servicoDe } from "../src/disjuntor.js";
import type { LinhaDaTabela } from "../src/tabelaDePrecedentes.js";
import type { LinhaDoStf } from "../src/tabelaDoStf.js";
import {
  consultaDeVerificacao,
  type Consulta,
  lerTeses,
  montarRodada,
  posicaoDoParadigma,
  recusaDaRodada,
  TOPO,
} from "./montarRodadaDeProvas.js";

const ESPACO_ENTRE_CHAMADAS_MS = 10_000;
const MARGEM_DO_TETO = 2;
const PERMITIDA = /^https:\/\/www\.jurisprudenciaia\.com\.br\/api\/tribunais\/(stj|stf|tst|tse)\/search$/;

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i < 0 ? undefined : process.argv[i + 1];
};
const pasta = arg("--saida");
const saida = resolve(pasta ?? ".");
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const gravar = (caminho: string, valor: unknown) => writeFileSync(caminho, JSON.stringify(valor, null, 1));

const recusa = recusaDaRodada({ saida: pasta, aoVivo: process.argv.includes("--ao-vivo") }, (c) => existsSync(join(saida, c)));
if (recusa) {
  console.error(`NÃO RODA: ${recusa}`);
  process.exit(1);
}
mkdirSync(join(saida, "gravacao"), { recursive: true });

const stj = (JSON.parse(readFileSync("dados/tabela-precedentes-stj.json", "utf8")) as { linhas: LinhaDaTabela[] }).linhas;
const stf = (JSON.parse(readFileSync("dados/tabela-precedentes-stf.json", "utf8")) as { linhas: LinhaDoStf[] }).linhas;
const teses = lerTeses(readFileSync("docs/banco-de-provas/teses-propostas.md", "utf8"));
const rodada = montarRodada(stj, stf, teses);
gravar(join(saida, "plano.json"), {
  declaradoEm: new Date().toISOString(),
  teto: rodada.teto,
  semente: rodada.semente,
  principais: rodada.principais.length,
  reservaParaVerificacaoESoPalavras: rodada.reserva,
  consultas: rodada.principais.map((c) => ({ id: c.id, fase: c.fase, tribunal: c.tribunal, texto: c.texto, cortada: c.cortada })),
  somentePalavras: rodada.palavras.map((c) => ({ id: c.id, tribunal: c.tribunal, texto: c.texto })),
});

// Antes de qualquer chamada: o estado de proteção tem de ser legível e o serviço não pode estar pausado.
const ordem = await coordenacaoPadrao()
  .conferir({ host: new URL(SITE).host, intervaloMs: 0, servico: servicoDe(SITE), chamada: novaChamada(), provaPermitida: false }, Date.now)
  .catch((e: Error) => {
    console.error(`NÃO RODA: estado de proteção ilegível ou rede parada: ${e.message}`);
    process.exit(2);
  });
if (ordem.tipo !== "sai") {
  console.error(`NÃO RODA: o serviço está pausado ou em espera (${JSON.stringify(ordem)}).`);
  process.exit(2);
}

interface Registro {
  seq: number;
  consulta: string;
  tribunal: string;
  corpoEnviado: string;
  inicio: string;
  ms?: number;
  status?: number;
  resposta?: string;
  erroDeRede?: string;
}
let consultaAtual = "";
let seq = 0;
let chamadas = 0;
const hosts = new Map<string, number>();
const recusas: { consulta: string; status: number }[] = [];

async function gravador(url: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const u = String(url);
  const m = u.match(PERMITIDA);
  if (!m) throw new Error(`rodarRodadaDeProvas: chamada fora da busca do site bloqueada: ${u}`);
  if (chamadas >= rodada.teto) throw new Error(`rodarRodadaDeProvas: teto de ${rodada.teto} chamadas atingido; nada mais sai`);
  chamadas++;
  gravar(join(saida, "estado.json"), { ...estado, parcial: true, chamadasAoSite: chamadas });
  const host = new URL(u).host;
  hosts.set(host, (hosts.get(host) ?? 0) + 1);
  const r: Registro = { seq: ++seq, consulta: consultaAtual, tribunal: m[1], corpoEnviado: String(init.body), inicio: new Date().toISOString() };
  const t0 = performance.now();
  try {
    const resposta = await fetch(url, init);
    const texto = await resposta.text();
    r.ms = Math.round(performance.now() - t0);
    r.status = resposta.status;
    r.resposta = texto;
    if ([403, 429, 503].includes(resposta.status)) recusas.push({ consulta: consultaAtual, status: resposta.status });
    const cabecalhos = new Headers(resposta.headers);
    cabecalhos.delete("content-encoding");
    cabecalhos.delete("content-length");
    return new Response(texto, { status: resposta.status, statusText: resposta.statusText, headers: cabecalhos });
  } catch (e) {
    r.ms = Math.round(performance.now() - t0);
    r.erroDeRede = `${(e as Error).name}: ${(e as Error).message}`;
    throw e;
  } finally {
    gravar(join(saida, "gravacao", `${String(r.seq).padStart(3, "0")}-${consultaAtual}.json`), r);
  }
}

const site = new Cliente({ nome: "O JurisprudênciaIA", fetch: gravador as typeof fetch });
const resultados: Record<string, unknown>[] = [];
const estado: Record<string, unknown> = { teto: rodada.teto, iniciadoEm: new Date().toISOString() };
let parou: string | undefined;

async function rodar(c: Consulta): Promise<{ numeros: string[]; posicao?: number } | undefined> {
  // Verificação e "só palavras" ficam duas chamadas aquém do teto, de margem para a nova tentativa de 429/503.
  const folga = c.fase === "verificacao" || c.versao === "palavras" ? MARGEM_DO_TETO : 0;
  if (parou || chamadas >= rodada.teto - folga) return undefined;
  if (resultados.length) await dormir(ESPACO_ENTRE_CHAMADAS_MS);
  consultaAtual = c.id;
  const antes = chamadas;
  try {
    const r = await buscaDireta(site, { tribunal: c.tribunal, texto: c.texto, limite: c.limite }, undefined, { guardarAcordaos: false });
    const numeros = r.acordaos.map((a) => a.numero);
    const posicao = c.tema ? posicaoDoParadigma(numeros, c.tema.paradigma) : undefined;
    resultados.push({
      id: c.id, fase: c.fase, tribunal: c.tribunal, versao: c.versao, tese: c.tese, cortada: c.cortada,
      tema: c.tema && { tipo: c.tema.tipo, numero: c.tema.numero, paradigma: c.tema.paradigma.texto },
      chamadas: chamadas - antes, mostrados: numeros.length, posicao, numeros,
      acordaos: r.acordaos.map((a) => ({ numero: a.numero, tribunal: a.tribunal, data: a.dataJulgamento, relator: a.relator })),
    });
    console.log(`${c.id}: ${numeros.length} acórdãos${c.tema ? `, paradigma ${posicao ? `na posição ${posicao}` : "ausente"}` : ""} (${chamadas}/${rodada.teto} chamadas)`);
    return { numeros, posicao };
  } catch (e) {
    const recusa = e instanceof RecusaError || (e as Error).name === "RedeParadaError" || /pausad|Recusa/i.test((e as Error).message);
    resultados.push({ id: c.id, fase: c.fase, tribunal: c.tribunal, chamadas: chamadas - antes, erro: `${(e as Error).name}: ${(e as Error).message}` });
    console.log(`${c.id}: ERRO ${(e as Error).name}: ${(e as Error).message}`);
    if (recusa) parou = `${c.id}: ${(e as Error).name}: ${(e as Error).message}`;
    return undefined;
  } finally {
    gravar(join(saida, "resultados.json"), resultados);
  }
}

const ausentes: Consulta[] = [];
for (const c of rodada.principais) {
  const r = await rodar(c);
  if (c.fase === "paradigma" && r && (r.posicao === undefined)) ausentes.push(consultaDeVerificacao(c.tema!));
}
for (const v of ausentes) await rodar(v);
for (const p of rodada.palavras) await rodar(p);

Object.assign(estado, {
  terminadoEm: new Date().toISOString(),
  chamadasAoSite: chamadas,
  chamadasPorHost: Object.fromEntries(hosts),
  recusasDoSite: recusas,
  motivoDaParada: parou,
  consultasFeitas: resultados.length,
  completa: !parou && rodada.principais.length + ausentes.length <= resultados.length,
  foraDoTopo: `topo = ${TOPO} primeiros`,
});
gravar(join(saida, "estado.json"), estado);
console.log(`Fim: ${chamadas} chamadas ao site (${[...hosts].map(([h, n]) => `${h}: ${n}`).join(", ")}); recusas: ${recusas.length}; parou: ${parou ?? "não"}.`);
