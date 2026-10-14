/**
 * Medição do custo de disco por chamada do cliente (ticket b17/16), sem rede: `vite-node scripts/medirDisco.ts`.
 * Roda 1 e 2 processos (janelas) fazendo chamadas em série ao Falcão e ao JurisprudênciaIA, com resposta falsa, numa
 * pasta de dados temporária. Por chamada, soma o tempo gasto na coordenação (ler/gravar estado, vagas, travas):
 * média e pior caso. Contar operações de arquivo é com tests/discoPorChamada.test.ts.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cliente } from "../src/cliente.js";
import { type Coordenacao, CoordenacaoEmArquivo } from "../src/coordenacao.js";

const CHAMADAS = 15;
const FONTES = {
  "JurisprudênciaIA": "https://jurisprudenciaia.com.br/api/x",
  "Falcão": "https://jurisprudencia.jt.jus.br/api/x",
};

/** Uma janela: faz as chamadas e imprime o tempo de coordenação de cada uma (ms), em JSON. */
async function janela(url: string): Promise<void> {
  const real = new CoordenacaoEmArquivo();
  let gasto = 0;
  const medir = async <T>(fazer: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    try {
      return await fazer();
    } finally {
      gasto += performance.now() - t0;
    }
  };
  const vagas: Coordenacao = {
    ocupar: async (c, s) => {
      const liberar = await medir(() => real.ocupar(c, s));
      return () => medir(liberar);
    },
    conferir: (p, a) => medir(() => real.conferir(p, a)),
    reservarSaida: (p, a) => medir(() => real.reservarSaida(p, a)),
    anotar: (...a) => medir(() => real.anotar(...a)),
    anotarFreio: (...a) => medir(() => real.anotarFreio(...a)),
  };
  const cliente = new Cliente({
    nome: "O servidor de teste",
    vagas,
    fetch: (async () =>
      new Response("{}", {
        headers: { "content-type": "application/json", "x-rate-limit-remaining": "900" },
      })) as typeof fetch,
  });
  const ms: number[] = [];
  for (let i = 0; i < CHAMADAS; i++) {
    gasto = 0;
    await (await cliente.requisitar(url)).json();
    await new Promise((r) => setTimeout(r, 30)); // a liberação da vaga termina em segundo plano
    ms.push(gasto);
  }
  process.stdout.write(`${JSON.stringify(ms)}\n`);
}

function rodarJanela(pasta: string, url: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, ["node_modules/vite-node/vite-node.mjs", "scripts/medirDisco.ts", "janela", url], {
      env: { ...process.env, GARIMPO_DADOS: pasta },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let saida = "";
    filho.stdout.on("data", (d) => (saida += d));
    filho.on("close", (codigo) => (codigo === 0 ? resolve(JSON.parse(saida.trim().split("\n").pop() ?? "[]")) : reject(new Error(`janela saiu com ${codigo}`))));
  });
}

async function principal(): Promise<void> {
  console.log("| Fonte | Processos | Média (ms) | Pior (ms) |\n|---|---|---|---|");
  for (const [fonte, url] of Object.entries(FONTES)) {
    for (const processos of [1, 2]) {
      const pasta = await mkdtemp(join(tmpdir(), "garimpo-disco-"));
      try {
        // A primeira chamada de cada janela cria o estado: fica de fora da média.
        const todas = (await Promise.all(Array.from({ length: processos }, () => rodarJanela(pasta, url)))).flatMap((m) => m.slice(1));
        const media = todas.reduce((a, b) => a + b, 0) / todas.length;
        console.log(`| ${fonte} | ${processos} | ${media.toFixed(0)} | ${Math.max(...todas).toFixed(0)} |`);
      } finally {
        await rm(pasta, { recursive: true, force: true });
      }
    }
  }
}

if (process.argv[2] === "janela") await janela(process.argv[3]);
else await principal();
