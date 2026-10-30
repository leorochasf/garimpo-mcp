/**
 * Criação do índice do TCU num ano sintético em escala real (B1.2), sem rede:
 *
 *   npx vite-node scripts/medirIndiceTcuAnoReal.ts
 *
 * A composição registrada da bateria (scripts/tcuSintetico.ts) sem a redução de 1/40: os 18.588 registros do arquivo
 * real de 2025 (ADR-0025), cerca de 400 MB. Mede, num processo próprio com o servidor compilado: tempo e RAM de pico
 * da criação, tamanho do índice; e uma varredura e uma pesquisa pelo índice (consulta comum), para comparar.
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { COMPOSICAO_TCU, gravarTcuSintetico } from "./tcuSintetico.js";

const raiz = resolve(".");
const tsc = spawnSync(process.execPath, [join(raiz, "node_modules", "typescript", "bin", "tsc")], { cwd: raiz, stdio: "inherit" });
if (tsc.status !== 0) throw new Error("tsc falhou");
const dados = await mkdtemp(join(tmpdir(), "garimpo-indice-ano-real-"));
try {
  const { anos } = await gravarTcuSintetico(dados, { ...COMPOSICAO_TCU, anos: [2025], registrosPorAno: 18_588 });
  const url = pathToFileURL(join(raiz, "dist", "tcuLocal.js")).href;
  const rodar = (codigo: string) => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)}); const d = ${JSON.stringify(dados)};` + codigo], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout.trim().split("\n").pop()!);
  };
  const criacao = rodar(
    "const t0 = performance.now(); const r = await m.criarIndiceTcu(d, 2025);" +
      "console.log(JSON.stringify({ ...r, segundosMedidos: (performance.now() - t0) / 1000, maxRssMb: process.resourceUsage().maxRSS / 1024 }));",
  );
  const pesquisa = (indice: boolean) =>
    rodar(
      `const t0 = performance.now(); const r = await m.pesquisarTcu(d, { consulta: "licitação contrato" }, { indice: ${indice} });` +
        "const t1 = performance.now(); await m.pesquisarTcu(d, { consulta: \"licitação contrato\" }, { indice: " + indice + " });" +
        "console.log(JSON.stringify({ fria: t1 - t0, quente: performance.now() - t1, total: r.total, indiceLocal: r.indiceLocal, maxRssMb: process.resourceUsage().maxRSS / 1024 }));",
    );
  const varredura = pesquisa(false);
  const indice = pesquisa(true);
  console.log(JSON.stringify({ arquivo: anos[0].bytes, registros: anos[0].registros, criacao, varredura, indice }, null, 1));
} finally {
  await rm(dados, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
