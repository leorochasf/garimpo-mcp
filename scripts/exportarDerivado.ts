/**
 * Exporta o derivado de uma rodada do banco de provas (B0.2 do plano 1.2, N03/F06), sem rede.
 *
 *   npx vite-node scripts/exportarDerivado.ts -- --de <pasta externa da rodada> --para <arquivo .json>
 *   npx vite-node scripts/exportarDerivado.ts -- --verificar <arquivo .json>
 *
 * `--de` é a pasta que rodarRodadaDeProvas.ts gravou (fora do projeto): lê estado.json, resultados.json e, de
 * gravacao/, só consulta, tempo e status de cada chamada. A chave dos hashes fica em `<de>/chave-do-derivado.txt`,
 * criada na primeira exportação; use a mesma pasta-chave nas rodadas que forem comparadas. O derivado passa pelo esquema
 * fechado antes de gravar e é relido e conferido depois. `--verificar` confere um derivado já gravado (em
 * `banco-de-provas-resultados/`, que o teste de dados reais não varre).
 */

import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportarDerivado, validarDerivado, type RodadaCrua } from "./derivadoDaRodada.js";
import { gravacaoForaDoLugarNoDisco } from "./seguroDaRodada.js";

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i < 0 ? undefined : process.argv[i + 1];
};
const ler = (caminho: string) => JSON.parse(readFileSync(caminho, "utf8"));
const parar = (motivo: string): never => {
  console.error(`NÃO EXPORTA: ${motivo}`);
  process.exit(1);
};

function conferirArquivo(arquivo: string): void {
  const problemas = validarDerivado(ler(arquivo));
  if (problemas.length) parar(`${arquivo} está fora do esquema:\n${problemas.join("\n")}`);
  console.log(`${arquivo}: dentro do esquema fechado.`);
}

const verificar = arg("--verificar");
if (verificar) {
  conferirArquivo(resolve(verificar));
  process.exit(0);
}

const de = arg("--de");
const para = arg("--para");
if (!de || !para || de.startsWith("-") || para.startsWith("-")) parar("use --de <pasta externa> --para <arquivo .json>, ou --verificar <arquivo>.");
if (!para!.endsWith(".json")) parar("--para precisa terminar em .json.");
const pastaCrua = resolve(de!);
const recusa = gravacaoForaDoLugarNoDisco(pastaCrua, fileURLToPath(new URL("..", import.meta.url)));
if (recusa) parar(`--de: ${recusa}`);

const chaveArquivo = join(pastaCrua, "chave-do-derivado.txt");
if (!existsSync(chaveArquivo)) {
  writeFileSync(chaveArquivo, randomBytes(32).toString("hex"));
  console.log(`Chave nova criada em ${chaveArquivo} (fica só na pasta externa).`);
}
const chave = readFileSync(chaveArquivo, "utf8").trim();

const estado = ler(join(pastaCrua, "estado.json")) as Record<string, unknown>;
const pastaGravacao = join(pastaCrua, "gravacao");
const registros = existsSync(pastaGravacao)
  ? readdirSync(pastaGravacao)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const r = ler(join(pastaGravacao, f));
        return { consulta: String(r.consulta), ms: r.ms, status: r.status };
      })
  : [];
const crua: RodadaCrua = { estado, resultados: ler(join(pastaCrua, "resultados.json")), registros };

const versaoDoGarimpo = arg("--versao") ?? estado.versaoDoGarimpo;
const commit = arg("--commit") ?? estado.commit;
if (typeof versaoDoGarimpo !== "string" || typeof commit !== "string")
  parar("estado.json não diz a versão e o commit do Garimpo da rodada: informe --versao e --commit.");

const destino = resolve(para!);
writeFileSync(destino, JSON.stringify(exportarDerivado(crua, chave, { versaoDoGarimpo: versaoDoGarimpo as string, commit: commit as string }), null, 1));
conferirArquivo(destino);
