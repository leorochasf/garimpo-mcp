/**
 * Entrada do `npm run gerar-espelhos`: gera e grava o índice de dispositivo legal dos Espelhos de Acórdãos do STJ em
 * dados/ (ver gerarEspelhos.ts). ≈ 540 arquivos, ≈ 1 GB e ≈ 1,5 h por causa dos 10 s entre chamadas; rode sozinho
 * (rede exclusiva) e com memória: NODE_OPTIONS=--max-old-space-size=6144.
 *
 * `--revisado`: o mantenedor aceita a queda grande de acórdãos em relação à fotografia anterior.
 * `--cache=<pasta>`: onde ficam os downloads (padrão: pasta temporária do sistema, fora do repositório). Rodar de novo
 * com o mesmo cache retoma de onde parou, sem baixar o que já está lá.
 */

import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CACHE_PADRAO,
  clienteDoGerador,
  DESTINO_PADRAO,
  fetchComRegistro,
  gerarEGravar,
  ParadaDoGerador,
} from "./gerarEspelhos.js";

const cache = process.argv.find((a) => a.startsWith("--cache="))?.slice("--cache=".length) ?? CACHE_PADRAO;
const hora = () => new Date().toISOString().slice(11, 19);

try {
  const indice = await gerarEGravar(clienteDoGerador({ fetch: fetchComRegistro(join(cache, "chamadas.log")) }), {
    cache,
    destino: DESTINO_PADRAO,
    revisado: process.argv.includes("--revisado"),
    registrar: (linha) => console.log(`${hora()} ${linha}`),
  });
  const json = readFileSync(DESTINO_PADRAO);
  console.log(`Índice gravado em ${DESTINO_PADRAO}: ${json.length} bytes, ${gzipSync(json).length} bytes compactado (gzip).`);
  console.log(JSON.stringify({ geradaEm: indice.geradaEm, contagens: indice.contagens, leis: indice.leis }, null, 1));
  for (const [orgao, c] of Object.entries(indice.conjuntos)) {
    console.log(`${orgao}: ${c.arquivos.length} arquivos; meses ausentes: ${c.mesesAusentes.join(", ") || "nenhum"}; ${c.atualizacaoDaFonte}`);
  }
} catch (e) {
  if (e instanceof ParadaDoGerador) {
    console.error(`${hora()} PAROU: ${e.message}`);
    process.exitCode = 2;
  } else throw e;
}
