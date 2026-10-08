import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Porta 2 do B3: duas ou mais janelas do Garimpo (processos Node reais) na MESMA pasta de dados, chamando um
 * servidor falso em 127.0.0.1. Sem internet: o servidor fica na própria máquina (regra 5).
 */

const VITE_NODE = join(process.cwd(), "node_modules", "vite-node", "vite-node.mjs");
const JANELA = join(process.cwd(), "tests", "janela.ts");

/** Servidor falso que conta as chamadas abertas ao mesmo tempo; as das rotas "/segurar" ficam sem resposta. */
function servidorFalso(demoraMs: number) {
  const estado = { abertas: 0, pico: 0, chegadas: [] as number[], presas: [] as ServerResponse[] };
  const servidor: Server = createServer((req, res) => {
    estado.abertas++;
    estado.pico = Math.max(estado.pico, estado.abertas);
    estado.chegadas.push(Date.now());
    res.on("close", () => estado.abertas--);
    if (req.url?.startsWith("/segurar")) estado.presas.push(res);
    else setTimeout(() => res.end(JSON.stringify({ ok: true })), demoraMs);
  });
  return { servidor, estado };
}

let pasta: string;
let processos: ChildProcess[];
let fechar: (() => Promise<void>) | undefined;

beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-janelas-"));
  processos = [];
});

const vivo = (p: ChildProcess) => p.exitCode === null && p.signalCode === null;

afterEach(async () => {
  const vivos = processos.filter(vivo);
  const saidas = vivos.map((p) => new Promise((r) => p.once("exit", r)));
  for (const p of vivos) p.kill();
  await Promise.all(saidas);
  await fechar?.();
  fechar = undefined;
  await rm(pasta, { recursive: true, force: true });
});

async function subir(demoraMs = 0) {
  const { servidor, estado } = servidorFalso(demoraMs);
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  fechar = () =>
    new Promise<void>((r) => {
      for (const res of estado.presas) res.destroy();
      servidor.closeAllConnections();
      servidor.close(() => r());
    });
  return { base: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, estado };
}

interface Janela {
  processo: ChildProcess;
  pronta: Promise<void>;
  vai: () => void;
  resultado: Promise<{ ok: boolean; corpo?: string; erro?: string }[]>;
}

/** Abre uma janela do Garimpo (processo real) na pasta de dados comum. */
function abrirJanela(config: { url: string; chamadas: number; intervaloMs?: number }): Janela {
  const processo = spawn(process.execPath, [VITE_NODE, JANELA], {
    env: { ...process.env, GARIMPO_DADOS: pasta, JANELA_TESTE: JSON.stringify(config) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  processos.push(processo);
  let saida = "";
  let erros = "";
  processo.stderr!.on("data", (d) => (erros += d));
  let avisarPronta!: () => void;
  const pronta = new Promise<void>((r) => (avisarPronta = r));
  const resultado = new Promise<Janela["resultado"] extends Promise<infer T> ? T : never>((resolver, rejeitar) => {
    processo.stdout!.on("data", (d) => {
      saida += d;
      if (saida.includes("pronto\n")) avisarPronta();
      const linhas = saida.split("\n").filter((l) => l.startsWith("["));
      if (linhas.length) resolver(JSON.parse(linhas[0]));
    });
    processo.once("exit", (c) => rejeitar(new Error(`janela saiu (código ${c}) sem resultado: ${erros}`)));
  });
  resultado.catch(() => {});
  return { processo, pronta, vai: () => processo.stdin!.write("vai\n"), resultado };
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("vagas compartilhadas entre janelas (processos reais)", () => {
  it("3 janelas com 3 chamadas cada, disputando ao mesmo tempo: o servidor nunca vê mais de 2 abertas", async () => {
    const { base, estado } = await subir(400);
    const janelas = [1, 2, 3].map(() => abrirJanela({ url: `${base}/x`, chamadas: 3 }));
    await Promise.all(janelas.map((j) => j.pronta));
    janelas.forEach((j) => j.vai());

    const resultados = (await Promise.all(janelas.map((j) => j.resultado))).flat();
    expect(resultados.filter((r) => r.ok)).toHaveLength(9);
    expect(estado.chegadas).toHaveLength(9);
    expect(estado.pico).toBe(2);
  }, 60_000);

  it("pausa por host entre janelas: duas janelas nunca saem ao mesmo host com menos que a pausa", async () => {
    const pausa = 1_500;
    const { base, estado } = await subir();
    const janelas = [1, 2].map(() => abrirJanela({ url: `${base}/tse`, chamadas: 2, intervaloMs: pausa }));
    await Promise.all(janelas.map((j) => j.pronta));
    janelas.forEach((j) => j.vai());

    const resultados = (await Promise.all(janelas.map((j) => j.resultado))).flat();
    expect(resultados.every((r) => r.ok)).toBe(true);
    const chegadas = [...estado.chegadas].sort((a, b) => a - b);
    expect(chegadas).toHaveLength(4);
    // Folga larga para a diferença entre a saída no cliente e a chegada aqui (máquina carregada); sem a pausa comum,
    // as janelas sairiam juntas (intervalo perto de zero).
    for (let i = 1; i < chegadas.length; i++) expect(chegadas[i] - chegadas[i - 1]).toBeGreaterThan(pausa - 500);
  }, 60_000);

  it("vaga de janela viva nunca é tomada; a de janela fechada de repente é retomada", async () => {
    const { base, estado } = await subir();
    const presa = abrirJanela({ url: `${base}/segurar`, chamadas: 2 });
    await presa.pronta;
    presa.vai();
    while (estado.abertas < 2) await dormir(20);

    const outra = abrirJanela({ url: `${base}/x`, chamadas: 1 });
    await outra.pronta;
    outra.vai();
    await dormir(1_500);
    expect(estado.chegadas).toHaveLength(2); // a janela viva segura as 2 vagas: a outra espera

    presa.processo.kill(); // fecha de repente: os arquivos de vaga ficam com um PID que não existe mais
    await new Promise((r) => presa.processo.once("exit", r));
    const [r] = await outra.resultado;
    expect(r.ok).toBe(true);
    expect(estado.chegadas).toHaveLength(3);
    expect(estado.pico).toBe(2);
  }, 60_000);
});
