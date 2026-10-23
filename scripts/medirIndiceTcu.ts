/**
 * Medição do índice local do TCU (B1.2), sem rede:
 *
 *   npx vite-node scripts/medirIndiceTcu.ts [--n 30]
 *
 * Mesma régua do TCU na bateria de velocidade (scripts/medirVelocidade.ts, B0.3): o TCU sintético da composição
 * registrada (scripts/tcuSintetico.ts) com 1, 5 e 10 anos; servidor compilado deste repositório, chamado por MCP no
 * stdio como o Claude chama, um processo novo por bloco; a 1ª pesquisa do processo ("fria", consulta comum) e as
 * consultas seletiva, comum, vazia, sem acento, entre aspas e com filtros no mesmo processo ("quente"). Cada rodada
 * mede os dois braços, alternando quem vai primeiro: **varredura** (pasta sem índice, como na 1.1.1) e **índice**
 * (a mesma pasta com o índice de cada ano). As respostas dos dois braços são comparadas campo a campo (sem o tempo e
 * sem o relato `indiceLocal`): qualquer diferença para a medição com erro.
 *
 * Também mede a criação do índice para 1, 5 e 10 anos, num processo próprio: tempo, disco e RAM de pico (maxRSS).
 * Saída: tabela em markdown no console; os tempos crus em banco-de-provas-resultados/velocidade/ (fora do git).
 */

import { spawnSync } from "node:child_process";
import { link, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { COMPOSICAO_TCU, CONSULTAS_TCU, gravarTcuSintetico } from "./tcuSintetico.js";

const { values: opcoes } = parseArgs({ options: { n: { type: "string", default: "30" } } });
const N = Number(opcoes.n);
const BLOCOS = [1, 5, 10];
const BRACOS = ["varredura", "indice"] as const;
type Braco = (typeof BRACOS)[number];
const raiz = resolve(".");
const preload = pathToFileURL(join(raiz, "scripts", "velocidadeFetchFalso.mjs")).href;

const ordenar = (xs: number[]) => [...xs].sort((a, b) => a - b);
const mediana = (xs: number[]) => {
  const s = ordenar(xs);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const p95 = (xs: number[]) => ordenar(xs)[Math.max(0, Math.ceil(0.95 * xs.length) - 1)];
const mb = (b: number) => (b / 1024 / 1024).toFixed(1);

/** A resposta sem o que pode mudar entre os braços: o tempo e o relato do caminho. */
function semTempo(texto: string): string {
  const { tempoSegundos, indiceLocal, ...resto } = JSON.parse(texto);
  void tempoSegundos;
  void indiceLocal;
  return JSON.stringify(resto);
}

/** Cria o índice dos anos num processo próprio (servidor compilado), para medir tempo e RAM de pico. */
function construir(dados: string, anos: number[]): { segundos: number; maxRssMb: number; vazioRssMb: number; bytes: number } {
  const url = pathToFileURL(join(raiz, "dist", "tcuLocal.js")).href;
  const codigo =
    `const vazio = process.resourceUsage().maxRSS; const m = await import(${JSON.stringify(url)}); const t0 = performance.now(); let bytes = 0;` +
    `for (const ano of ${JSON.stringify(anos)}) bytes += (await m.criarIndiceTcu(${JSON.stringify(dados)}, ano)).bytesDoIndice;` +
    "console.log(JSON.stringify({ segundos: (performance.now() - t0) / 1000, maxRssMb: process.resourceUsage().maxRSS / 1024, vazioRssMb: vazio / 1024, bytes }));";
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", codigo], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`criação do índice falhou: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

async function abrir(dados: string, gravadas: string): Promise<Client> {
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", preload, join(raiz, "dist", "index.js")],
    cwd: raiz,
    env: { ...(process.env as Record<string, string>), GARIMPO_DADOS: dados, VEL_GRAVADAS: gravadas, VEL_CHAMADAS: join(dados, "chamadas.log") },
    stderr: "pipe",
  });
  const mcp = new Client({ name: "medir-indice-tcu", version: "0" });
  await mcp.connect(transporte);
  return mcp;
}

async function pesquisar(mcp: Client, args: Record<string, unknown>): Promise<{ ms: number; texto: string }> {
  const t0 = performance.now();
  const r = (await mcp.callTool({ name: "pesquisar_acordaos_tcu", arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const ms = performance.now() - t0;
  if (r.isError) throw new Error(`pesquisa com erro: ${r.content[0]?.text}`);
  return { ms, texto: r.content[0].text };
}

const PASSOS = BLOCOS.flatMap((n) => [`tcu${n}Frio`, ...CONSULTAS_TCU.map((c) => `tcu${n}_${c.nome}`)]);
const ROTULO = (p: string) => {
  const [, n, resto] = p.match(/^tcu(\d+)(?:_(\w+)|Frio)$/)!;
  return resto ? `TCU ${n} ano(s), ${resto}` : `TCU ${n} ano(s), 1ª pesquisa do processo (comum)`;
};

async function main(): Promise<void> {
  const tsc = spawnSync(process.execPath, [join(raiz, "node_modules", "typescript", "bin", "tsc")], { cwd: raiz, stdio: "inherit" });
  if (tsc.status !== 0) throw new Error("tsc falhou");
  const modelo = await mkdtemp(join(tmpdir(), "garimpo-indice-modelo-"));
  try {
    const { anos: resumo } = await gravarTcuSintetico(join(modelo, "base"), COMPOSICAO_TCU);
    const anos = COMPOSICAO_TCU.anos;
    const gravadas = join(modelo, "gravadas.json");
    await writeFile(gravadas, JSON.stringify({ site: {}, falcao: [], normas: {}, projudi: {} }));

    // Criação: cada bloco numa cópia (ligações) da base, num processo próprio.
    const construcao: Record<number, ReturnType<typeof construir> & { csvBytes: number }> = {};
    for (const n of BLOCOS) {
      const dados = join(modelo, `construir-${n}`);
      await mkdir(join(dados, "tcu"), { recursive: true });
      for (const nome of await readdir(join(modelo, "base", "tcu"))) await link(join(modelo, "base", "tcu", nome), join(dados, "tcu", nome));
      const alvo = anos.slice(-n);
      construcao[n] = { ...construir(dados, alvo), csvBytes: resumo.filter((a) => alvo.includes(a.ano)).reduce((s, a) => s + a.bytes.total, 0) };
    }
    // O índice dos 10 anos fica na base; o braço "índice" liga também esses arquivos.
    construir(join(modelo, "base"), anos);

    const tempos: Record<Braco, Record<string, number[]>> = { varredura: {}, indice: {} };
    const inicio = new Date();
    for (let k = 0; k < N; k++) {
      const ordem = k % 2 ? [...BRACOS].reverse() : [...BRACOS];
      for (const n of BLOCOS) {
        const alvo = anos.slice(-n);
        const respostas: Partial<Record<Braco, string[]>> = {};
        for (const braco of ordem) {
          const dados = await mkdtemp(join(tmpdir(), "garimpo-indice-rodada-"));
          await mkdir(join(dados, "tcu"));
          for (const nome of await readdir(join(modelo, "base", "tcu"))) {
            if (braco === "varredura" && nome.endsWith(".indice")) continue;
            await link(join(modelo, "base", "tcu", nome), join(dados, "tcu", nome));
          }
          const mcp = await abrir(dados, gravadas);
          const lista: string[] = [];
          const anotar = (passo: string, r: { ms: number; texto: string }) => {
            (tempos[braco][passo] ??= []).push(r.ms);
            lista.push(semTempo(r.texto));
          };
          try {
            const comum = CONSULTAS_TCU.find((c) => c.nome === "comum")!;
            anotar(`tcu${n}Frio`, await pesquisar(mcp, { consulta: comum.consulta, anos: alvo }));
            for (const c of CONSULTAS_TCU) {
              anotar(`tcu${n}_${c.nome}`, await pesquisar(mcp, { consulta: c.consulta, anos: alvo, ...("filtros" in c ? c.filtros : {}) }));
            }
          } finally {
            await mcp.close().catch(() => {});
            await rm(dados, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
          }
          respostas[braco] = lista;
        }
        const [a, b] = [respostas.varredura!, respostas.indice!];
        a.forEach((x, i) => {
          if (x !== b[i]) throw new Error(`Resposta diferente entre varredura e índice (bloco ${n}, passo ${i}, rodada ${k + 1}).`);
        });
      }
      process.stderr.write(`rodada ${k + 1}/${N}\n`);
    }

    const linhas = [
      `Medição de ${inicio.toISOString()} a ${new Date().toISOString()} · N = ${N} por braço · respostas idênticas nas ${N} rodadas`,
      `Máquina: ${cpus()[0]?.model}, ${cpus().length} threads, ${(totalmem() / 2 ** 30).toFixed(1)} GB · ${platform()} ${release()} · Node ${process.version}`,
      "",
      "| Operação | Varredura mediana (ms) | Varredura p95 | Índice mediana (ms) | Índice p95 | Ganho na mediana |",
      "|---|---|---|---|---|---|",
      ...PASSOS.map((p) => {
        const [v, i] = [tempos.varredura[p], tempos.indice[p]];
        return `| ${ROTULO(p)} | ${mediana(v).toFixed(0)} | ${p95(v).toFixed(0)} | ${mediana(i).toFixed(1)} | ${p95(i).toFixed(1)} | ${(mediana(v) / mediana(i)).toFixed(1)}× |`;
      }),
      "",
      "| Criação do índice | Tempo (s) | Arquivos do TCU (MB) | Índice (MB) | Índice / arquivos | RAM de pico (MB) | RAM do processo vazio (MB) |",
      "|---|---|---|---|---|---|---|",
      ...BLOCOS.map((n) => {
        const c = construcao[n];
        return `| ${n} ano(s) | ${c.segundos.toFixed(1)} | ${mb(c.csvBytes)} | ${mb(c.bytes)} | ${((100 * c.bytes) / c.csvBytes).toFixed(1)} % | ${c.maxRssMb.toFixed(0)} | ${c.vazioRssMb.toFixed(0)} |`;
      }),
    ];
    console.log(linhas.join("\n"));
    const pasta = join(raiz, "banco-de-provas-resultados", "velocidade");
    await mkdir(pasta, { recursive: true });
    const arquivo = join(pasta, `indice-tcu-${inicio.toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(arquivo, JSON.stringify({ n: N, tempos, construcao, composicao: COMPOSICAO_TCU, anos: resumo }, null, 1));
    console.log(`\nTempos crus (fora do git): ${arquivo} (${mb((await stat(arquivo)).size)} MB)`);
  } finally {
    await rm(modelo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
}

await main();
