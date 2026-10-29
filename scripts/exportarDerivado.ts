/**
 * Exporta o derivado de uma rodada do banco de provas (B0.2 do plano 1.2, N03/F06), sem rede.
 *
 *   npx vite-node scripts/exportarDerivado.ts -- --de <pasta externa da rodada> --chave <arquivo externo> --para <arquivo .json>
 *     [--apuracao <pasta externa>/veredito/apuracao.json --identidades <pasta externa>/reservado/identidades.json]
 *   npx vite-node scripts/exportarDerivado.ts -- --verificar <arquivo .json>
 *
 * `--de` é a pasta que rodarRodadaDeProvas.ts ou rodarLinhaDeBase.ts gravou: lê estado.json, resultados.json, ementas.json
 * (se houver: a identidade do acórdão, como no júri) e, de gravacao/, só consulta, tempo e status de cada chamada.
 * `--apuracao` (opcional) traz o júri de scripts/juriDaLinhaDeBase.ts: do braço desta rodada (o commit), as contagens e
 * o veredito de cada posição por pedido, e a união julgada de cada tese; com ela vai `--identidades`, a identidade de
 * cada acórdão resolvida entre as cópias da união dos braços (o hash usa essa, para bater com o júri e com o outro
 * braço). `--chave` é o arquivo da chave dos hashes, o MESMO para todas as rodadas que forem comparadas (1.1.1 × 1.2):
 * sem ele os hashes não batem. Todos ficam fora do
 * projeto, de toda worktree do repositório e de nuvem (foraDoRepositorioNoDisco). Criado na
 * primeira exportação, se não existir. O derivado leva o identificador da chave (campo `chave`, não a chave), para que
 * derivados de chaves diferentes não sejam comparados. Ele passa pelo esquema fechado antes de gravar e é relido e
 * conferido depois. `--verificar` confere um derivado já gravado (em `banco-de-provas-resultados/`, que o teste de dados
 * reais não varre).
 */

import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ApuracaoDoJuri, destinoInvalido, exportarDerivado, validarDerivado, type RodadaCrua } from "./derivadoDaRodada.js";
import { caminhoFisico, foraDoRepositorioNoDisco } from "./seguroDaRodada.js";

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
const chaveArg = arg("--chave");
if (!de || !para || !chaveArg || [de, para, chaveArg].some((v) => v.startsWith("-")))
  parar("use --de <pasta externa> --chave <arquivo externo> --para <arquivo .json>, ou --verificar <arquivo>.");
if (!para!.endsWith(".json")) parar("--para precisa terminar em .json.");
const raizDoProjeto = fileURLToPath(new URL("..", import.meta.url));
const pastaCrua = resolve(de!);
const recusa = foraDoRepositorioNoDisco(pastaCrua, raizDoProjeto);
if (recusa) parar(`--de: ${recusa}`);
const chaveArquivo = resolve(chaveArg!);
const recusaDaChave = foraDoRepositorioNoDisco(chaveArquivo, raizDoProjeto);
if (recusaDaChave) parar(`--chave: ${recusaDaChave}`);
const apuracaoArg = arg("--apuracao");
if (apuracaoArg !== undefined && (apuracaoArg.startsWith("-") || foraDoRepositorioNoDisco(resolve(apuracaoArg), raizDoProjeto)))
  parar("--apuracao precisa de um arquivo fora do projeto, de toda worktree do repositório e de nuvem (a apuração do júri fica na pasta externa).");
const apuracao = apuracaoArg === undefined ? undefined : (ler(resolve(apuracaoArg)) as ApuracaoDoJuri);
const identidadesArg = arg("--identidades");
if ((apuracaoArg === undefined) !== (identidadesArg === undefined))
  parar("--apuracao e --identidades vão juntos (o reservado/identidades.json do mesmo pool do júri).");
if (identidadesArg !== undefined && (identidadesArg.startsWith("-") || foraDoRepositorioNoDisco(resolve(identidadesArg), raizDoProjeto)))
  parar("--identidades precisa de um arquivo fora do projeto, de toda worktree do repositório e de nuvem (fica no reservado/ do júri).");
const identidades = identidadesArg === undefined ? undefined : (ler(resolve(identidadesArg)) as Record<string, string>);
const destino = resolve(para!);
const recusaDoDestino = destinoInvalido(
  caminhoFisico(destino),
  caminhoFisico(chaveArquivo),
  existsSync(destino) ? readFileSync(destino, "utf8") : undefined,
);
if (recusaDoDestino) parar(recusaDoDestino);

if (!existsSync(chaveArquivo)) {
  writeFileSync(chaveArquivo, randomBytes(32).toString("hex"));
  console.log(`Chave nova criada em ${chaveArquivo} (guarde-a fora do projeto e use a mesma nas rodadas comparadas).`);
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
const ementas = existsSync(join(pastaCrua, "ementas.json")) ? ler(join(pastaCrua, "ementas.json")) : undefined;
const crua: RodadaCrua = { estado, resultados: ler(join(pastaCrua, "resultados.json")), registros, ...(ementas && { ementas }), ...(identidades && { identidades }) };

const versaoDoGarimpo = arg("--versao") ?? estado.versaoDoGarimpo;
const commit = arg("--commit") ?? estado.commit;
if (typeof versaoDoGarimpo !== "string" || typeof commit !== "string")
  parar("estado.json não diz a versão e o commit do Garimpo da rodada: informe --versao e --commit.");

writeFileSync(destino, JSON.stringify(exportarDerivado(crua, chave, { versaoDoGarimpo: versaoDoGarimpo as string, commit: commit as string }, apuracao), null, 1));
conferirArquivo(destino);
