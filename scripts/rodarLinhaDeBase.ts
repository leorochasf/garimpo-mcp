/**
 * Linha de base de qualidade do banco de provas 1.2 (B0.2; docs/banco-de-provas/protocolo-1.2.md, seção 4): roda os
 * pedidos de E1 e E5 (scripts/linhaDeBase.ts) no servidor MCP de verdade de um braço já compilado — a 1.1.1 (cc956b4)
 * agora, a 1.2 em B4.1 —, com cliente MCP em memória. E1: uma busca_ampla por pedido e o obter_ementa de cada acórdão
 * entregue (memória, sem rede), para o pool do júri. E5: a busca_ampla com TRT, memória fria, quente e renovar.
 *
 *   npx vite-node scripts/rodarLinhaDeBase.ts -- --braco <pasta do braço, com dist/> --saida <pasta externa>/rodada --ao-vivo
 *   npx vite-node scripts/rodarLinhaDeBase.ts -- --braco <...> --saida <pasta externa>/rodada --ensaio
 *
 * --ao-vivo USA REDE (o JurisprudênciaIA e o Falcão), pelo cliente único do braço e com os freios da regra 3, que valem
 * com as outras janelas: a proteção é a pasta real do Garimpo; só a memória fica numa pasta temporária e vazia por grupo
 * de pedidos, apagada no fim do grupo. Rode UMA vez, sozinho na fila de rede. --ensaio não usa rede nem a pasta real: o
 * fetch responde as gravações fictícias de scripts/ensaioDaLinhaDeBase.ts, o DNS é proibido e a proteção também vai para
 * uma pasta temporária.
 *
 * Trava (as do banco de provas, seguroDaRodada.ts): a gravação crua (respostas, números, relatores, ementas) só vai para
 * pasta fora do projeto, de toda worktree do repositório (a principal e a do braço inclusive) e de nuvem, também seguindo
 * atalhos; pasta com plano.json ou gravacao/ recusa. Antes da 1ª chamada: os hashes da base da amostra conferem e nenhum serviço está pausado. Só saem a busca do
 * site e a do Falcão, até o teto (tetoDaRodada); recusa (403/429/503, pausa, rede parada) para a rodada no fim do pedido,
 * e o que tiver fica gravado.
 *
 * Grava em <saida>: plano.json (antes da 1ª chamada), gravacao/NNN-<pedido>.json (cada requisição crua),
 * resultados.json (por pedido: lista, cobertura por tribunal, chamadas e tempos), ementas.json (obter_ementa de E1) e
 * estado.json (chamadas por host, recusas, completa, versão e commit do braço). O derivado sai por
 * scripts/exportarDerivado.ts; o pool do júri, por scripts/juriDaLinhaDeBase.ts.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import dns from "node:dns";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gravadasDoEnsaio } from "./ensaioDaLinhaDeBase.js";
import { type AmostraE5, type Pedido, pedidosE1, pedidosE5, tetoDaRodada } from "./linhaDeBase.js";
import { criarGravador, foraDoRepositorioNoDisco, gravacaoForaDoLugarNoDisco, saidaInvalida } from "./seguroDaRodada.js";
import { criarFetchFalso } from "./velocidadeFetchFalso.mjs";

const ESPACO_ENTRE_PEDIDOS_MS = 5_000;
const PRAZO_DA_FERRAMENTA_MS = 15 * 60_000;
const PERMITIDA =
  /^https:\/\/(?:www\.jurisprudenciaia\.com\.br\/api\/tribunais\/([a-z0-9]+)\/search|jurisprudencia\.jt\.jus\.br\/jurisprudencia-nacional-backend\/api\/no-auth\/pesquisa(?:\?[^#]*)?)$/;
const MOTIVOS_DE_PARADA = ["recusa", "pausa", "rede-parada"];

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i < 0 ? undefined : process.argv[i + 1];
};
const gravar = (caminho: string, valor: unknown) => writeFileSync(caminho, JSON.stringify(valor, null, 1));
const parar = (motivo: string): never => {
  console.error(`NÃO RODA: ${motivo}`);
  process.exit(1);
};
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const raizDoProjeto = fileURLToPath(new URL("..", import.meta.url));
const ensaio = process.argv.includes("--ensaio");
const aoVivo = process.argv.includes("--ao-vivo");
const bracoArg = arg("--braco");
const pasta = arg("--saida");
if (ensaio === aoVivo) parar("escolha um modo: --ao-vivo (rede de verdade) ou --ensaio (sem rede).");
if (!bracoArg || bracoArg.startsWith("-")) parar("informe a pasta do braço compilado: --braco <pasta com dist/servidor.js>.");
const braco = resolve(bracoArg!);
if (!existsSync(join(braco, "dist", "servidor.js"))) parar(`o braço não está compilado: falta dist/servidor.js em ${braco} (rode npm run build lá).`);
const saida = resolve(pasta ?? ".");
const recusaDaSaida =
  saidaInvalida(pasta) ??
  foraDoRepositorioNoDisco(saida, raizDoProjeto) ??
  gravacaoForaDoLugarNoDisco(saida, braco) ??
  (existsSync(join(saida, "plano.json")) || existsSync(join(saida, "gravacao"))
    ? "a pasta já tem plano.json ou gravacao/ (rodada feita ou interrompida): a rodada é feita uma vez só; use outra pasta só se o piloto mandar."
    : undefined);
if (recusaDaSaida) parar(recusaDaSaida);

// A régua congelada: os arquivos de que a amostra depende têm de conferir com os hashes gravados nela.
const amostra = JSON.parse(readFileSync(join(raizDoProjeto, "docs", "banco-de-provas", "amostra-1.2.json"), "utf8"));
const sha = (arquivo: string) => createHash("sha256").update(readFileSync(join(raizDoProjeto, arquivo), "utf8").replace(/\r\n/g, "\n")).digest("hex");
for (const b of Object.values(amostra.base) as { arquivo: string; sha256: string }[])
  if (sha(b.arquivo) !== b.sha256) parar(`${b.arquivo} mudou desde a amostra congelada: a régua não vale (nova versão do protocolo).`);

const teses = readFileSync(join(raizDoProjeto, amostra.base.teses.arquivo), "utf8");
const estratos = (arg("--estratos") ?? "E1,E5").split(",");
const pedidos: Pedido[] = [
  ...(estratos.includes("E1") ? pedidosE1(teses, amostra.estratos.E1.teses) : []),
  ...(estratos.includes("E5") ? pedidosE5(teses, amostra.estratos.E5 as AmostraE5) : []),
];
if (pedidos.length === 0) parar("--estratos sem E1 nem E5.");
const teto = tetoDaRodada(pedidos);

const pacote = JSON.parse(readFileSync(join(braco, "package.json"), "utf8")) as { version: string };
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: braco, encoding: "utf8" }).trim();
const sujo = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: braco, encoding: "utf8" }).trim() !== "";
if (sujo && aoVivo) parar(`o braço tem mudança não commitada em ${braco}: a rodada tem de ser de um commit.`);

mkdirSync(join(saida, "gravacao"), { recursive: true });
gravar(join(saida, "plano.json"), {
  declaradoEm: new Date().toISOString(),
  modo: ensaio ? "ensaio a seco, sem rede" : "ao vivo",
  braco: { versao: pacote.version, commit },
  semente: amostra.semente,
  teto,
  base: amostra.base,
  pedidos,
});

// Fetch: o gravador (só as rotas permitidas, até o teto, cada requisição crua gravada) por cima do de verdade ou do falso.
// Troca o global ANTES de carregar o braço: todo cliente dele guarda o fetch global ao nascer.
let base: typeof fetch = globalThis.fetch;
if (ensaio) {
  const semRede = () => {
    throw new Error("Ensaio a seco: DNS proibido.");
  };
  dns.lookup = semRede as unknown as typeof dns.lookup;
  dns.promises.lookup = semRede as unknown as typeof dns.promises.lookup;
  // A proteção e a memória do ensaio ficam numa pasta temporária: o ensaio não toca o estado real do Garimpo.
  process.env.GARIMPO_DADOS = mkdtempSync(join(tmpdir(), "garimpo-ensaio-protecao-"));
  const fixture = JSON.parse(readFileSync(join(raizDoProjeto, "tests", "fixtures", "falcao-pv13.json"), "utf8"));
  base = criarFetchFalso(gravadasDoEnsaio(pedidos, fixture.casos["sem-parametro"].documentos), () => {}) as typeof fetch;
}

let pedidoAtual = "";
let chamadas = 0;
const hosts = new Map<string, number>();
const recusas: { consulta: string; status: number }[] = [];
const estado: Record<string, unknown> = {
  teto,
  modo: ensaio ? "ensaio" : "ao-vivo",
  iniciadoEm: new Date().toISOString(),
  versaoDoGarimpo: pacote.version,
  commit,
};
globalThis.fetch = criarGravador({
  fetch: base,
  permitida: PERMITIDA,
  teto,
  consultaAtual: () => pedidoAtual,
  gravarRegistro: (r) => gravar(join(saida, "gravacao", `${String(r.seq).padStart(4, "0")}-${r.consulta}.json`), r),
  aoContar: (n) => {
    chamadas = n;
    gravar(join(saida, "estado.json"), { ...estado, parcial: true, chamadasAoSite: chamadas });
  },
  aoRecusa: (consulta, status) => recusas.push({ consulta, status }),
  hosts,
}) as typeof fetch;

// O braço: o servidor e o SDK dele, carregados da pasta dele.
const doBraco = (...partes: string[]) => import(pathToFileURL(join(braco, ...partes)).href);
const { Cliente } = await doBraco("dist", "cliente.js");
const { criarServidor } = await doBraco("dist", "servidor.js");
const { coordenacaoPadrao, pastaDeDados } = await doBraco("dist", "coordenacao.js");
const { novaChamada, servicoDe } = await doBraco("dist", "disjuntor.js");
const { Client } = await doBraco("node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "index.js");
const { InMemoryTransport } = await doBraco("node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "inMemory.js");

/** Pausa ou rede parada em algum serviço da rodada, pelo estado de proteção (leitura só); ilegível também para. */
async function servicoParado(): Promise<string | undefined> {
  for (const url of ["https://www.jurisprudenciaia.com.br/api", "https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend"]) {
    try {
      const ordem = await coordenacaoPadrao().conferir(
        { host: new URL(url).host, intervaloMs: 0, servico: servicoDe(url), chamada: novaChamada(), provaPermitida: false },
        Date.now,
      );
      if (ordem.tipo !== "sai") return `${servicoDe(url)} pausado ou em espera (${JSON.stringify(ordem)})`;
    } catch (e) {
      return `estado de proteção ilegível ou rede parada: ${(e as Error).message}`;
    }
  }
  return undefined;
}

/** Retrato da memória real (arquivos, bytes, último mtime), antes e depois: prova que a rodada não a usou. */
function retratoDaMemoriaReal(): { arquivos: number; bytes: number; ultimaMudanca?: string } {
  const raiz = join(pastaDeDados(), "memoria");
  let arquivos = 0;
  let bytes = 0;
  let ultima = 0;
  const andar = (dir: string) => {
    for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const p = join(dir, e.name);
      if (e.isDirectory()) andar(p);
      else {
        const s = statSync(p);
        arquivos++;
        bytes += s.size;
        ultima = Math.max(ultima, s.mtimeMs);
      }
    }
  };
  andar(raiz);
  return { arquivos, bytes, ...(ultima > 0 && { ultimaMudanca: new Date(ultima).toISOString() }) };
}

const parado = await servicoParado();
if (parado) parar(parado);
if (aoVivo) estado.memoriaRealAntes = retratoDaMemoriaReal();

const texto = (r: { content?: { type: string; text?: string }[] }) => (r.content ?? []).map((c) => c.text ?? "").join("\n");
const resultados: Record<string, unknown>[] = [];
const ementas: Record<string, unknown> = {};
let parou: string | undefined;

async function rodarGrupo(grupo: string, doGrupo: Pedido[]): Promise<void> {
  const memoria = mkdtempSync(join(tmpdir(), `garimpo-linha-de-base-${grupo}-`));
  const site = new Cliente({ nome: "O JurisprudênciaIA" });
  const servidor = criarServidor(site, { dados: memoria, pasta: join(memoria, "pdf") });
  const [lc, ls] = InMemoryTransport.createLinkedPair();
  await servidor.connect(ls);
  const mcp = new Client({ name: "linha-de-base-1.2", version: "0" });
  await mcp.connect(lc);
  try {
    for (const p of doGrupo) {
      if (parou) break;
      if (resultados.length && !ensaio) await dormir(ESPACO_ENTRE_PEDIDOS_MS);
      const antes = await servicoParado();
      if (antes) {
        parou = `${p.id}: ${antes}`;
        break;
      }
      pedidoAtual = p.id;
      const chamadasAntes = chamadas;
      const recusasAntes = recusas.length;
      const t0 = performance.now();
      const argumentos = { formulacoes: p.formulacoes, tribunais: p.tribunais, ...(p.memoria === "renovar" && { renovar: true }) };
      const linha: Record<string, unknown> = {
        id: p.id,
        estrato: p.estrato,
        grupo: p.grupo,
        fase: p.estrato === "E1" ? "tese" : "trt",
        tese: p.tese,
        ...(p.versao && { versao: p.versao }),
        ...(p.memoria && { memoria: p.memoria }),
        tribunais: p.tribunais,
        iniciadoEm: new Date().toISOString(),
      };
      try {
        const r = await mcp.callTool({ name: "busca_ampla", arguments: argumentos }, undefined, { timeout: PRAZO_DA_FERRAMENTA_MS });
        linha.msParede = Math.round(performance.now() - t0);
        if (r.isError) {
          linha.erro = texto(r).slice(0, 2000);
        } else {
          const dado = JSON.parse((r.content as { text: string }[])[0].text);
          const itens = dado.acordaos as { id: string; numero: string; tribunal: string; data?: string; orgao?: string; formulacoes: number; mesmaEmenta?: { quantidade: number } }[];
          linha.mostrados = itens.length;
          linha.totalAcordaos = dado.totalAcordaos;
          linha.completa = dado.completa;
          linha.numeros = itens.map((a) => a.numero);
          linha.acordaos = itens.map((a) => ({ id: a.id, numero: a.numero, tribunal: a.tribunal, data: a.data, orgao: a.orgao, formulacoes: a.formulacoes, serie: a.mesmaEmenta?.quantidade }));
          linha.cobertura = dado.cabecalhoDeCobertura?.porTribunal ?? [];
          const motivos = (linha.cobertura as { motivos?: Record<string, number> }[]).flatMap((c) => Object.keys(c.motivos ?? {}));
          const paraTudo = motivos.find((m) => MOTIVOS_DE_PARADA.includes(m));
          if (paraTudo) parou = `${p.id}: busca com motivo "${paraTudo}" no cabeçalho de cobertura`;
          if (p.estrato === "E1") {
            for (const a of itens) {
              if (a.id in ementas) continue;
              const e = await mcp.callTool({ name: "obter_ementa", arguments: { id: a.id } });
              ementas[a.id] = e.isError ? { erro: texto(e).slice(0, 500) } : JSON.parse((e.content as { text: string }[])[0].text);
            }
          }
        }
      } catch (e) {
        linha.msParede = Math.round(performance.now() - t0);
        linha.erro = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 2000);
      }
      linha.chamadas = chamadas - chamadasAntes;
      if (recusas.length > recusasAntes) parou ??= `${p.id}: recusa HTTP ${recusas.slice(recusasAntes).map((x) => x.status).join(", ")}`;
      if (chamadas >= teto) parou ??= `${p.id}: teto de ${teto} chamadas atingido`;
      resultados.push(linha);
      gravar(join(saida, "resultados.json"), resultados);
      gravar(join(saida, "ementas.json"), ementas);
      console.log(`${p.id}: ${linha.erro ? "ERRO" : `${linha.mostrados} acórdãos`}, ${linha.chamadas} chamadas, ${linha.msParede} ms (${chamadas}/${teto})`);
    }
  } finally {
    await mcp.close();
    rmSync(memoria, { recursive: true, force: true });
  }
}

for (const grupo of [...new Set(pedidos.map((p) => p.grupo))]) {
  if (parou) break;
  await rodarGrupo(grupo, pedidos.filter((p) => p.grupo === grupo));
}

const feitos = new Set(resultados.filter((r) => !r.erro).map((r) => r.id));
Object.assign(estado, {
  terminadoEm: new Date().toISOString(),
  chamadasAoSite: chamadas,
  chamadasPorHost: Object.fromEntries(hosts),
  recusasDoSite: recusas,
  motivoDaParada: parou,
  consultasFeitas: resultados.length,
  completa: !parou && pedidos.every((p) => feitos.has(p.id)),
  ...(aoVivo && { memoriaRealDepois: retratoDaMemoriaReal() }),
});
delete estado.parcial;
gravar(join(saida, "estado.json"), estado);
if (ensaio) rmSync(process.env.GARIMPO_DADOS!, { recursive: true, force: true });
console.log(`Fim: ${chamadas} chamadas (${[...hosts].map(([h, n]) => `${h}: ${n}`).join(", ")}); recusas: ${recusas.length}; parou: ${parou ?? "não"}.`);
