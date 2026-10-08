import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

/**
 * Servidor falso que conta as chamadas abertas ao mesmo tempo. As das rotas "/segurar" ficam sem resposta até o
 * teste responder; as de "/recusar" recebem 403 (recusa final).
 */
function servidorFalso(demoraMs: number) {
  const estado = { abertas: 0, pico: 0, chegadas: [] as number[], presas: [] as { url: string; res: ServerResponse }[] };
  const servidor: Server = createServer((req, res) => {
    estado.abertas++;
    estado.pico = Math.max(estado.pico, estado.abertas);
    estado.chegadas.push(Date.now());
    res.on("close", () => estado.abertas--);
    if (req.url?.startsWith("/segurar")) estado.presas.push({ url: req.url, res });
    else if (req.url?.startsWith("/recusar")) res.writeHead(403).end();
    else setTimeout(() => res.end(JSON.stringify({ ok: true })), demoraMs);
  });
  return { servidor, estado };
}

let pasta: string;
let processos: ChildProcess[];
let fechar: (() => Promise<void>)[] = [];

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
  await Promise.all(fechar.map((f) => f()));
  fechar = [];
  await rm(pasta, { recursive: true, force: true });
});

async function subir(demoraMs = 0) {
  const { servidor, estado } = servidorFalso(demoraMs);
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  fechar.push(
    () =>
      new Promise<void>((r) => {
        for (const { res } of estado.presas) res.destroy();
        servidor.closeAllConnections();
        servidor.close(() => r());
      }),
  );
  return { base: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, estado };
}

interface Janela {
  processo: ChildProcess;
  pronta: Promise<void>;
  vai: () => void;
  resultado: Promise<{ ok: boolean; corpo?: string; erro?: string }[]>;
}

/** Abre uma janela do Garimpo (processo real) na pasta de dados comum. */
function abrirJanela(config: { url: string; chamadas: number; intervaloMs?: number; relogio?: string }): Janela {
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
    expect(estado.pico).toBe(2);

    // Fecha de repente: os arquivos de vaga ficam com um PID que não existe mais. O pico não é conferido daqui em
    // diante: o servidor falso pode ainda contar as conexões da janela morta quando a outra retoma a vaga dela.
    presa.processo.kill();
    await new Promise((r) => presa.processo.once("exit", r));
    const [r] = await outra.resultado;
    expect(r.ok).toBe(true);
    expect(estado.chegadas).toHaveLength(3);
  }, 60_000);
});

describe("disjuntor compartilhado entre janelas (processos reais)", () => {
  /** Abre uma janela, manda fazer as chamadas e devolve o resultado. */
  async function rodar(config: Parameters<typeof abrirJanela>[0]) {
    const j = abrirJanela(config);
    await j.pronta;
    j.vai();
    return j.resultado;
  }

  it("recusa vista numa janela pausa o serviço na outra, sem nenhuma chamada; outro serviço segue", async () => {
    const site = await subir();
    const outro = await subir();
    const [recusada] = await rodar({ url: `${site.base}/recusar`, chamadas: 1 });
    expect(recusada.erro).toMatch(/pausadas em todas as janelas do Garimpo/);

    const [[pausada], [livre]] = await Promise.all([
      rodar({ url: `${site.base}/x`, chamadas: 1 }),
      rodar({ url: `${outro.base}/x`, chamadas: 1 }),
    ]);
    expect(pausada.ok).toBe(false);
    expect(pausada.erro).toMatch(/^Esta chamada não foi feita: as chamadas ao servidor de teste estão pausadas/);
    expect(livre.ok).toBe(true);
    expect(site.estado.chegadas).toHaveLength(1);
    expect(outro.estado.chegadas).toHaveLength(1);
  }, 60_000);

  it("relógio comum: uma só chamada de prova entre janelas; dono morto, outra prova; prova recusada reabre dobrando", async () => {
    const relogio = join(pasta, "relogio.txt");
    const INICIO = 1_800_000_000_000;
    const ajustar = (instante: number) => writeFile(relogio, String(instante));
    await ajustar(INICIO);
    const { base, estado } = await subir();
    const janela = (rota: string) => abrirJanela({ url: `${base}/${rota}`, chamadas: 1, relogio });

    expect((await rodar({ url: `${base}/recusar`, chamadas: 1, relogio }))[0].erro).toMatch(/pausadas/); // 1 min
    await ajustar(INICIO + 60_000);
    const provas = [janela("segurar"), janela("segurar")];
    await Promise.all(provas.map((j) => j.pronta));
    provas.forEach((j) => j.vai());
    while (estado.presas.length < 1) await dormir(20);
    await dormir(1_500);
    expect(estado.presas).toHaveLength(1); // a outra janela espera a decisão da prova, sem chamar

    const pid = Number(estado.presas[0].url.match(/\/(\d+)-0$/)![1]);
    const dona = provas.find((j) => j.processo.pid === pid)!;
    const outra = provas.find((j) => j !== dona)!;
    dona.processo.kill(); // a janela da prova fecha de repente
    await new Promise((r) => dona.processo.once("exit", r));
    while (estado.presas.length < 2) await dormir(20); // a outra janela faz a nova prova
    estado.presas[1].res.writeHead(429).end();
    expect((await outra.resultado)[0].erro).toMatch(/recusou a chamada de prova/);

    await ajustar(INICIO + 60_000 + 2 * 60_000 - 1); // prova recusada: a pausa dobrou para 2 min
    expect((await rodar({ url: `${base}/x`, chamadas: 1, relogio }))[0].erro).toMatch(/não foi feita/);
    await ajustar(INICIO + 60_000 + 2 * 60_000);
    expect((await rodar({ url: `${base}/x`, chamadas: 1, relogio }))[0].ok).toBe(true);
    expect(estado.chegadas).toHaveLength(4); // a recusa, as duas provas e a chamada depois da pausa
  }, 60_000);
});
