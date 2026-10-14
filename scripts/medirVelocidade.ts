/**
 * Medição de velocidade do Garimpo, versão × versão, sem rede:
 *
 *   npx vite-node scripts/medirVelocidade.ts --antes <pasta da versão anterior> [--depois .] [--n 20]
 *
 * `--antes` e `--depois` são pastas do Garimpo com `npm ci` feito (um worktree da versão antiga, este repositório). O
 * script compila as duas (`tsc`) e roda a mesma bateria no servidor compilado de cada uma, como o Claude chama: processo
 * próprio, MCP pelo stdio, pasta de dados temporária nova a cada rodada. O fetch do servidor é trocado por respostas
 * gravadas devolvidas na hora (scripts/velocidadeFetchFalso.mjs): o tempo medido é só o do Garimpo (CPU, disco, vagas,
 * freios, memória), nunca o da internet.
 *
 * Bateria, por rodada: início do servidor até o tools/list; busca simples no JurisprudênciaIA (fria e repetida, a
 * repetida vem da memória); busca ampla em 5 tribunais × 3 formulações (fria e repetida); busca no Falcão (TRT); leitura
 * da parte 1 de um PDF já baixado. Cada rodada com 1 janela e com 2 janelas (processos) na mesma pasta de dados; a 2ª
 * janela roda a mesma bateria com outra tese, ao mesmo tempo, e o tempo anotado é sempre o da 1ª (o mesmo trabalho da
 * rodada com 1 janela). As versões se alternam a cada rodada, para a carga da máquina pesar igual nas duas.
 *
 * Saída: tabela em markdown no console; os tempos crus em banco-de-provas-resultados/velocidade/ (fora do git).
 * Para medir fonte nova da busca ampla, acrescente em TRIBUNAIS_DA_AMPLA e a resposta gravada no fetch falso.
 */

import { spawnSync } from "node:child_process";
import { cpus } from "node:os";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Recorte } from "../tests/apoioBancoDeProvas.js";
import { pdfSintetico } from "../tests/pdfSintetico.js";

const { values: opcoes } = parseArgs({
  allowPositionals: true,
  options: {
    antes: { type: "string" },
    depois: { type: "string", default: "." },
    n: { type: "string", default: "20" },
  },
});
if (!opcoes.antes) throw new Error("Informe --antes <pasta do Garimpo da versão anterior, com npm ci feito>.");
const N = Number(opcoes.n);
const VERSOES = { antes: resolve(opcoes.antes), depois: resolve(opcoes.depois!) };
type Versao = keyof typeof VERSOES;

/** Tese do banco de provas de cada janela (a 2ª só faz carga). */
const TESES = [1, 10];
const TRIBUNAIS_DA_AMPLA: string[] | undefined = undefined; // undefined = os do recorte (stf, stj, tjsp, tjmg, tjrs)
const TRIBUNAL_DA_SIMPLES = "stj";
const TRT = "trt3";
const TEXTOS_DO_FALCAO = ["intervalo intrajornada", "horas extras habituais"];

const PASSOS = ["inicio", "simplesFria", "simplesRepetida", "amplaFria", "amplaRepetida", "falcao", "lerPdf"] as const;
type Passo = (typeof PASSOS)[number];
const ROTULOS: Record<Passo, string> = {
  inicio: "(e) início do servidor até o tools/list",
  simplesFria: "(a) busca simples JurisprudênciaIA, fria",
  simplesRepetida: "(a) busca simples JurisprudênciaIA, repetida (memória)",
  amplaFria: "(b) busca ampla 5 tribunais × 3 formulações, fria",
  amplaRepetida: "(b) busca ampla, repetida (memória)",
  falcao: "(c) busca no Falcão (TRT)",
  lerPdf: "(d) leitura de inteiro teor já baixado (PDF, parte 1)",
};

interface Medida {
  ms: number;
  chamadas: number;
  erro?: string;
}
type Rodada = Partial<Record<Passo, Medida>>;

const raiz = resolve(".");
const preload = pathToFileURL(join(raiz, "scripts", "velocidadeFetchFalso.mjs")).href;

function compilar(pasta: string): void {
  const r = spawnSync(process.execPath, [join(pasta, "node_modules", "typescript", "bin", "tsc")], { cwd: pasta, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`tsc falhou em ${pasta}`);
}

/** Respostas gravadas: cada busca do recorte vira os registros do site; o Falcão, a 1ª página da fixture. */
async function montarGravadas(destino: string): Promise<Recorte[]> {
  const site: Record<string, unknown[]> = {};
  const recortes: Recorte[] = [];
  for (const tese of TESES) {
    const nome = `tese-${String(tese).padStart(2, "0")}.json`;
    const r = JSON.parse(await readFile(join(raiz, "tests", "fixtures", "banco-de-provas", nome), "utf8")) as Recorte;
    recortes.push(r);
    for (const b of r.buscas) {
      site[`${b.t}|${r.formulacoes[b.f]}`] = b.ids.map((k) => {
        const [, data, numero, orgao, link, e] = r.acordaos[k];
        return {
          id: `t${tese}a${k}`,
          texto_ementa: e && e.split(" ").map((x, i) => (i ? r.vocabulario[+x] : x)).join(" "),
          numero_processo: numero === null ? undefined : String(numero),
          orgao_julgador: orgao ? "Órgão" : undefined,
          data_julgamento: data ?? undefined,
          link_pdf: link ? "https://exemplo.invalid/" : undefined,
        };
      });
    }
  }
  const falcao = JSON.parse(await readFile(join(raiz, "tests", "fixtures", "falcao-pv13.json"), "utf8")).casos["sem-parametro"].documentos;
  await writeFile(destino, JSON.stringify({ site, falcao }));
  return recortes;
}

/** PDF sintético de 20 páginas de texto genérico, do tamanho de um acórdão médio. */
function pdfDeAcordao(): Uint8Array {
  const linha = (p: number, l: number) =>
    `Pagina ${p}, linha ${l}: o recurso discute a aplicacao da norma ao caso, com os fundamentos do voto e da ementa.`;
  return pdfSintetico(Array.from({ length: 20 }, (_, p) => Array.from({ length: 55 }, (_, l) => linha(p + 1, l + 1))));
}

/** Fração da CPU ocupada (todas as threads) num intervalo curto: a carga da máquina, para anotar. */
async function cargaDaCpu(): Promise<number> {
  const soma = () => cpus().reduce((a, c) => ({ ocioso: a.ocioso + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { ocioso: 0, total: 0 });
  const a = soma();
  await new Promise((r) => setTimeout(r, 2000));
  const b = soma();
  return 1 - (b.ocioso - a.ocioso) / (b.total - a.total);
}

async function contarChamadas(arquivo: string): Promise<{ total: number; semResposta: string[] }> {
  const linhas = (await readFile(arquivo, "utf8").catch(() => "")).split("\n").filter(Boolean);
  return { total: linhas.length, semResposta: linhas.filter((l) => l.startsWith("?")) };
}

interface Janela {
  mcp: Client;
  chamadas: string;
  stderr: string[];
  ferramentas: number;
}

async function abrirJanela(versao: Versao, dados: string, k: number, gravadas: string): Promise<{ janela: Janela; ms: number }> {
  const chamadas = join(dados, `chamadas-${k}.log`);
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", preload, join(VERSOES[versao], "dist", "index.js")],
    cwd: VERSOES[versao],
    env: {
      ...(process.env as Record<string, string>),
      GARIMPO_DADOS: dados,
      GARIMPO_PASTA: join(dados, "pdf"),
      VEL_GRAVADAS: gravadas,
      VEL_CHAMADAS: chamadas,
    },
    stderr: "pipe",
  });
  const stderr: string[] = [];
  transporte.stderr?.on("data", (d) => stderr.push(String(d)));
  const mcp = new Client({ name: "medir-velocidade", version: "0" });
  const t0 = performance.now();
  await mcp.connect(transporte);
  const { tools } = await mcp.listTools();
  return { janela: { mcp, chamadas, stderr, ferramentas: tools.length }, ms: performance.now() - t0 };
}

async function passo(j: Janela, nome: string, args: Record<string, unknown>): Promise<Medida> {
  const antes = (await contarChamadas(j.chamadas)).total;
  const t0 = performance.now();
  const r = (await j.mcp.callTool({ name: nome, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const ms = performance.now() - t0;
  const chamadas = (await contarChamadas(j.chamadas)).total - antes;
  return { ms, chamadas, ...(r.isError && { erro: r.content[0]?.text.slice(0, 300) }) };
}

async function bateria(j: Janela, r: Recorte, k: number, pdf: string): Promise<Rodada> {
  const simples = { tribunal: TRIBUNAL_DA_SIMPLES, texto: r.formulacoes[0], limite: 10 };
  const ampla = { formulacoes: r.formulacoes, tribunais: TRIBUNAIS_DA_AMPLA ?? r.tribunais };
  return {
    simplesFria: await passo(j, "busca_direta", simples),
    simplesRepetida: await passo(j, "busca_direta", simples),
    amplaFria: await passo(j, "busca_ampla", ampla),
    amplaRepetida: await passo(j, "busca_ampla", ampla),
    falcao: await passo(j, "busca_direta", { tribunal: TRT, texto: TEXTOS_DO_FALCAO[k], limite: 10 }),
    lerPdf: await passo(j, "ler_inteiro_teor", { caminho: pdf, parte: 1 }),
  };
}

/** Uma rodada: pasta de dados nova, `janelas` processos ao mesmo tempo; devolve as medidas da 1ª janela. */
async function rodada(versao: Versao, janelas: number, recortes: Recorte[], gravadas: string, pdfModelo: string): Promise<{ medidas: Rodada; semResposta: string[]; stderr: string; ferramentas: number }> {
  const dados = await mkdtemp(join(tmpdir(), "garimpo-vel-"));
  const abertas: Janela[] = [];
  try {
    await mkdir(join(dados, "pdf"));
    const pdf = join(dados, "pdf", "acordao.pdf");
    await copyFile(pdfModelo, pdf);
    const inicio = await Promise.all(Array.from({ length: janelas }, (_, k) => abrirJanela(versao, dados, k, gravadas)));
    abertas.push(...inicio.map((i) => i.janela));
    const baterias = await Promise.all(abertas.map((j, k) => bateria(j, recortes[k], k, pdf)));
    const semResposta = (await Promise.all(abertas.map((j) => contarChamadas(j.chamadas)))).flatMap((c) => c.semResposta);
    return { medidas: { inicio: { ms: inicio[0].ms, chamadas: 0 }, ...baterias[0] }, semResposta, stderr: abertas.flatMap((j) => j.stderr).join(""), ferramentas: abertas[0].ferramentas };
  } finally {
    await Promise.all(abertas.map((j) => j.mcp.close().catch(() => {})));
    await rm(dados, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
}

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Teste de Mann-Whitney (aproximação normal, com correção de empates): z da diferença entre as duas amostras. */
function zMannWhitney(a: number[], b: number[]): number {
  const todos = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const postos = new Array<number>(todos.length);
  let empates = 0;
  for (let i = 0; i < todos.length; ) {
    let j = i;
    while (j + 1 < todos.length && todos[j + 1].v === todos[i].v) j++;
    for (let k = i; k <= j; k++) postos[k] = (i + j) / 2 + 1;
    const t = j - i + 1;
    empates += t ** 3 - t;
    i = j + 1;
  }
  const n1 = a.length;
  const n2 = b.length;
  const r1 = todos.reduce((s, x, i) => s + (x.g === 0 ? postos[i] : 0), 0);
  const u = r1 - (n1 * (n1 + 1)) / 2;
  const n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - empates / (n * (n - 1))));
  return sigma ? (u - (n1 * n2) / 2) / sigma : 0;
}

/**
 * Veredito contra o ruído: "piorou"/"melhorou" só com diferença estatística (Mann-Whitney, |z| ≥ 2,58, p < 0,01) E
 * relevante (≥ 5 % e ≥ 2 ms na mediana); fora disso, "igual".
 */
function veredito(antes: number[], depois: number[]): { dMs: number; dPct: number; z: number; texto: string } {
  const ma = mediana(antes);
  const md = mediana(depois);
  const dMs = md - ma;
  const dPct = ma ? (dMs / ma) * 100 : 0;
  const z = zMannWhitney(depois, antes);
  const real = Math.abs(z) >= 2.58 && Math.abs(dPct) >= 5 && Math.abs(dMs) >= 2;
  return { dMs, dPct, z, texto: real ? (dMs > 0 ? "piorou" : "melhorou") : "igual" };
}

const fmt = (x: number) => x.toFixed(0);
const sinal = (x: number, casas = 0) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(casas)}`;

async function principal(): Promise<void> {
  for (const pasta of Object.values(VERSOES)) compilar(pasta);
  const trabalho = await mkdtemp(join(tmpdir(), "garimpo-vel-gravadas-"));
  try {
    const gravadas = join(trabalho, "gravadas.json");
    const recortes = await montarGravadas(gravadas);
    const pdfModelo = join(trabalho, "acordao.pdf");
    await writeFile(pdfModelo, pdfDeAcordao());

    const cargaAntes = await cargaDaCpu();
    const inicio = new Date();
    const crus: Record<string, Record<Passo, Medida[]>> = {};
    const naoGravadas = new Set<string>();
    const ferramentas: Record<Versao, Set<number>> = { antes: new Set(), depois: new Set() };
    for (let i = 0; i < N; i++) {
      for (const janelas of [1, 2]) {
        // Alterna quem vai primeiro: a carga da máquina pesa igual nas duas versões.
        const ordem: Versao[] = (i + janelas) % 2 ? ["antes", "depois"] : ["depois", "antes"];
        for (const versao of ordem) {
          const { medidas, semResposta, stderr, ferramentas: nf } = await rodada(versao, janelas, recortes, gravadas, pdfModelo);
          ferramentas[versao].add(nf);
          semResposta.forEach((s) => naoGravadas.add(`${versao}: ${s}`));
          const chave = `${versao}|${janelas}`;
          crus[chave] ??= Object.fromEntries(PASSOS.map((p) => [p, []])) as unknown as Record<Passo, Medida[]>;
          for (const p of PASSOS) {
            const m = medidas[p];
            if (m) crus[chave][p].push(m);
            if (m?.erro) console.error(`[${chave}] ${p}: erro: ${m.erro}`);
          }
          if (i === 0 && stderr.trim()) console.error(`[${chave}] stderr: ${stderr.trim().slice(0, 500)}`);
        }
      }
      process.stderr.write(`rodada ${i + 1}/${N}\n`);
    }
    const cargaDepois = await cargaDaCpu();

    const linhas: string[] = [
      `Medição de ${inicio.toISOString()} · N = ${N} por versão e por nº de janelas · ${cpus().length} threads · ` +
        `CPU ocupada antes ${fmt(cargaAntes * 100)} %, depois ${fmt(cargaDepois * 100)} % · Node ${process.version}`,
      "",
      "| Operação | Janelas | Antes: mediana / pior (ms) | Depois: mediana / pior (ms) | Diferença na mediana | Chamadas (antes → depois) | Resultado |",
      "|---|---|---|---|---|---|---|",
    ];
    for (const p of PASSOS) {
      for (const janelas of [1, 2]) {
        const a = crus[`antes|${janelas}`][p];
        const d = crus[`depois|${janelas}`][p];
        const ok = (ms: Medida[]) => ms.filter((m) => !m.erro).map((m) => m.ms);
        const [ma, md] = [ok(a), ok(d)];
        const erros = a.length - ma.length + (d.length - md.length);
        const chamadas = (ms: Medida[]) => [...new Set(ms.map((m) => m.chamadas))].join("/");
        if (!ma.length || !md.length) {
          linhas.push(`| ${ROTULOS[p]} | ${janelas} | ${ma.length ? `${fmt(mediana(ma))} / ${fmt(Math.max(...ma))}` : "não existe / erro"} | ${md.length ? `${fmt(mediana(md))} / ${fmt(Math.max(...md))}` : "não existe / erro"} | — | ${chamadas(a)} → ${chamadas(d)} | — |`);
          continue;
        }
        const v = veredito(ma, md);
        linhas.push(
          `| ${ROTULOS[p]} | ${janelas} | ${fmt(mediana(ma))} / ${fmt(Math.max(...ma))} | ${fmt(mediana(md))} / ${fmt(Math.max(...md))} | ` +
            `${sinal(v.dMs)} ms (${sinal(v.dPct, 1)} %; z ${v.z.toFixed(1)}) | ${chamadas(a)} → ${chamadas(d)} | ${v.texto}${erros ? ` (${erros} com erro)` : ""} |`,
        );
      }
    }
    linhas.push("", `Ferramentas no tools/list: antes ${[...ferramentas.antes].join("/")}, depois ${[...ferramentas.depois].join("/")}.`);
    if (naoGravadas.size) linhas.push("", `Chamadas sem resposta gravada (404 do fetch falso): ${[...naoGravadas].join("; ")}`);
    console.log(linhas.join("\n"));

    const saida = join(raiz, "banco-de-provas-resultados", "velocidade");
    await mkdir(saida, { recursive: true });
    const arquivo = join(saida, `${inicio.toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(arquivo, JSON.stringify({ inicio, N, versoes: VERSOES, cargaAntes, cargaDepois, ferramentas: { antes: [...ferramentas.antes], depois: [...ferramentas.depois] }, crus }, null, 1));
    console.log(`\nTempos crus: ${arquivo}`);
  } finally {
    await rm(trabalho, { recursive: true, force: true });
  }
}

await principal();
