/**
 * Medição de velocidade do Garimpo, sem rede, em dois modos:
 *
 *   npx vite-node scripts/medirVelocidade.ts [--depois .] [--n 30]                       (linha de base de uma versão)
 *   npx vite-node scripts/medirVelocidade.ts --antes <pasta da versão anterior> [--depois .] [--n 30]   (versão × versão)
 *
 * `--antes` e `--depois` são pastas do Garimpo com `npm ci` feito (um worktree da versão antiga, este repositório). O
 * script compila cada uma (`tsc`) e roda a mesma bateria no servidor compilado, como o Claude chama: processo próprio,
 * MCP pelo stdio, pasta de dados temporária nova a cada rodada. O fetch do servidor é trocado por respostas gravadas
 * devolvidas na hora (scripts/velocidadeFetchFalso.mjs), que contam cada requisição e os bytes no transporte: o tempo
 * medido é só o do Garimpo (CPU, disco, vagas, freios, memória). NÃO mede o tempo do agente (geração do LLM) nem a
 * latência das fontes; o custo em requisições é o que o servidor faria, não o de uma pesquisa real até a matriz.
 *
 * Bateria, por rodada e por janela (fase 1, numa janela só): início do servidor até o tools/list; busca simples no
 * JurisprudênciaIA (fria e repetida, a repetida vem da memória); busca ampla em 5 tribunais × 3 formulações (fria e
 * repetida); a união da 2ª rodada (as 3 formulações e mais 2 copiadas de ementas devolvidas, numa chamada só) com a
 * memória quente e com `renovar`; busca no Falcão (TRT); leitura da parte 1 de um PDF já baixado; texto_de_lei (frio e
 * repetido); inteiro teor do TJGO pelo Projudi com os dois arquivos assinados (.p7s), depois da busca que o acha.
 * Fase 2, cada uma num processo novo na mesma pasta de dados: a união com a memória fria (GARIMPO_SEM_MEMORIA=1) e com
 * falha de leitura (as buscas guardadas trocadas por pastas, que o disco não lê); e o TCU sintético
 * (scripts/tcuSintetico.ts, composição registrada) com 1, 5 e 10 anos: a 1ª pesquisa de cada processo ("fria") e as
 * consultas seletiva, comum, vazia (sem resultado), sem acento, entre aspas e com filtros, no mesmo processo ("quente").
 *
 * Cada rodada com 1 janela e com 2 janelas (processos) na mesma pasta de dados; a 2ª janela roda a mesma bateria com
 * outra tese, ao mesmo tempo, e o tempo anotado é sempre o da 1ª (o mesmo trabalho da rodada com 1 janela). No modo
 * versão × versão, as versões se alternam a cada rodada, para a carga da máquina pesar igual nas duas.
 *
 * Saída: tabela em markdown no console; os tempos crus em banco-de-provas-resultados/velocidade/ (fora do git).
 * Para medir fonte nova da busca ampla, acrescente em TRIBUNAIS_DA_AMPLA e a resposta gravada no fetch falso.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, link, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { cpus, freemem, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Recorte } from "../tests/apoioBancoDeProvas.js";
import { pdfSintetico } from "../tests/pdfSintetico.js";
import { COMPOSICAO_TCU, CONSULTAS_TCU, gravarTcuSintetico } from "./tcuSintetico.js";
// @ts-expect-error módulo .mjs, sem tipos
import { lerChamadas } from "./velocidadeFetchFalso.mjs";

const { values: opcoes } = parseArgs({
  allowPositionals: true,
  options: {
    antes: { type: "string" },
    depois: { type: "string", default: "." },
    n: { type: "string", default: "30" },
  },
});
const N = Number(opcoes.n);
type Versao = "antes" | "depois";
const VERSOES: Partial<Record<Versao, string>> = {
  ...(opcoes.antes && { antes: resolve(opcoes.antes) }),
  depois: resolve(opcoes.depois!),
};
const VERSUS = Boolean(opcoes.antes);
const versoes = Object.keys(VERSOES) as Versao[];

/** Tese do banco de provas de cada janela (a 2ª só faz carga). */
const TESES = [1, 10];
const TRIBUNAIS_DA_AMPLA: string[] | undefined = undefined; // undefined = os do recorte (stf, stj, tjsp, tjmg, tjrs)
const TRIBUNAL_DA_SIMPLES = "stj";
const TRT = "trt3";
const TEXTOS_DO_FALCAO = ["intervalo intrajornada", "horas extras habituais"];
const LEI = { diploma: "CPC", dispositivo: "art. 85, § 2º" };
const URN_DO_CPC = "urn:lex:br:federal:lei:2015-03-16;13105";
/** Os anos do TCU sintético que cada bloco pesquisa (os mais recentes). */
const BLOCOS_TCU = [1, 5, 10];

/**
 * TJGO pelo Projudi, fictício (o mesmo julgado das fixtures .p7s de tests/tjgo.test.ts): a busca devolve a ementa com o
 * «julgado em» e o link da consulta de jurisprudência; o Projudi responde a página, a lista e os dois envelopes.
 */
const TJGO = {
  cnj: "0000001-11.2024.8.09.0001",
  dataHora: "25/09/2024 13:20:33",
  idMov: "109900000000000000000000001",
  /** Texto da busca de cada janela: cada uma acha a sua cópia do julgado (ids diferentes). */
  textos: ["negativação indevida dano moral presumido", "inscrição indevida em cadastro de inadimplentes"],
  ementa:
    "EMENTA: DIREITO DO CONSUMIDOR. APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO DE NEGATIVAÇÃO. I. CASO EM EXAME 1. Apelação " +
    "cível fictícia interposta contra sentença de exemplo que julgou parcialmente procedentes os pedidos. II. QUESTÃO " +
    "EM DISCUSSÃO 2. Saber se a situação exemplar fictícia gera dano moral presumido. III. RAZÕES DE DECIDIR 3. A " +
    "situação inventada para o teste configura dano moral presumido. IV. DISPOSITIVO 4. Recurso conhecido e " +
    "parcialmente provido.",
};

const PASSOS_TCU = BLOCOS_TCU.flatMap((n) => [`tcu${n}Frio`, ...CONSULTAS_TCU.map((c) => `tcu${n}_${c.nome}`)]);
const PASSOS = [
  "inicio", "simplesFria", "simplesRepetida", "amplaFria", "amplaRepetida", "uniaoQuente", "uniaoRenovar", "falcao",
  "lerPdf", "leiFria", "leiRepetida", "buscaTjgo", "projudiP7s", "uniaoSemMemoria", "uniaoFalhaLeitura", ...PASSOS_TCU,
];
const ROTULOS: Record<string, string> = {
  inicio: "(e) início do servidor até o tools/list",
  simplesFria: "(a) busca simples JurisprudênciaIA, fria",
  simplesRepetida: "(a) busca simples JurisprudênciaIA, repetida (memória)",
  amplaFria: "(b) busca ampla 5 tribunais × 3 formulações, fria",
  amplaRepetida: "(b) busca ampla, repetida (memória)",
  uniaoQuente: "(f) união da 2ª rodada (3 + 2 formulações), memória quente",
  uniaoRenovar: "(f) união da 2ª rodada, com renovar",
  falcao: "(c) busca no Falcão (TRT)",
  lerPdf: "(d) leitura de inteiro teor já baixado (PDF, parte 1)",
  leiFria: "(g) texto_de_lei (CPC art. 85, § 2º), frio",
  leiRepetida: "(g) texto_de_lei, repetido (memória)",
  buscaTjgo: "(h) busca simples no TJGO (acha o julgado)",
  projudiP7s: "(h) inteiro teor do TJGO pelo Projudi (.p7s)",
  uniaoSemMemoria: "(f) união da 2ª rodada, memória fria (GARIMPO_SEM_MEMORIA=1)",
  uniaoFalhaLeitura: "(f) união da 2ª rodada, falha de leitura da memória",
  ...Object.fromEntries(
    BLOCOS_TCU.flatMap((n) => [
      [`tcu${n}Frio`, `(i) TCU ${n} ano(s), 1ª pesquisa do processo (comum)`],
      ...CONSULTAS_TCU.map((c) => [`tcu${n}_${c.nome}`, `(i) TCU ${n} ano(s), ${c.nome}`]),
    ]),
  ),
};

interface Medida {
  ms: number;
  chamadas: number;
  enviados: number;
  recebidos: number;
  erro?: string;
}
type Rodada = Partial<Record<string, Medida>>;

const raiz = resolve(".");
const preload = pathToFileURL(join(raiz, "scripts", "velocidadeFetchFalso.mjs")).href;

function compilar(pasta: string): void {
  const r = spawnSync(process.execPath, [join(pasta, "node_modules", "typescript", "bin", "tsc")], { cwd: pasta, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`tsc falhou em ${pasta}`);
}

const ementaDoRecorte = (r: Recorte, k: number): string => {
  const e = r.acordaos[k][5];
  return e ? e.split(" ").map((x, i) => (i ? r.vocabulario[+x] : x)).join(" ") : "";
};

/** As 2 formulações da 2ª rodada: palavras copiadas da ementa do 1º acórdão do STJ nas formulações 1 e 2. */
function formulacoesDaSegunda(r: Recorte): string[] {
  return [0, 1].map((f) => {
    const b = r.buscas.find((x) => x.t === "stj" && x.f === f) ?? r.buscas[f];
    const palavras = ementaDoRecorte(r, b.ids[0]).toLowerCase().match(/[\p{L}\d]{4,}/gu) ?? [];
    return palavras.slice(0, 6).join(" ") || `${r.formulacoes[f]} segunda rodada`;
  });
}
const uniao = (r: Recorte) => [...r.formulacoes, ...formulacoesDaSegunda(r)];

/**
 * Respostas gravadas: cada busca do recorte vira os registros do site; as formulações da 2ª rodada, os da 1ª formulação
 * em ordem inversa; o Falcão, a 1ª página da fixture; o normas.leg.br, o recorte do CPC; o TJGO, o julgado fictício.
 */
async function montarGravadas(destino: string): Promise<Recorte[]> {
  const site: Record<string, unknown[]> = {};
  const recortes: Recorte[] = [];
  const registro = (r: Recorte, tese: number, k: number) => {
    const [, data, numero, orgao, link] = r.acordaos[k];
    return {
      id: `t${tese}a${k}`,
      texto_ementa: ementaDoRecorte(r, k) || undefined,
      numero_processo: numero === null ? undefined : String(numero),
      orgao_julgador: orgao ? "Órgão" : undefined,
      data_julgamento: data ?? undefined,
      link_pdf: link ? "https://exemplo.invalid/" : undefined,
    };
  };
  for (const [j, tese] of TESES.entries()) {
    const nome = `tese-${String(tese).padStart(2, "0")}.json`;
    const r = JSON.parse(await readFile(join(raiz, "tests", "fixtures", "banco-de-provas", nome), "utf8")) as Recorte;
    recortes.push(r);
    for (const b of r.buscas) site[`${b.t}|${r.formulacoes[b.f]}`] = b.ids.map((k) => registro(r, tese, k));
    for (const extra of formulacoesDaSegunda(r)) {
      for (const b of r.buscas.filter((x) => x.f === 0)) site[`${b.t}|${extra}`] = [...b.ids].reverse().map((k) => registro(r, tese, k));
    }
    site[`tjgo|${TJGO.textos[j]}`] = [
      {
        id: `vel-tjgo-${j}`,
        texto_ementa: `${TJGO.ementa} (Tribunal de Justiça do Estado de Goiás, ${TJGO.cnj}, 9ª Câmara Cível, julgado em ${TJGO.dataHora})`,
        numero_processo: TJGO.cnj,
        numero_processo_cnj: TJGO.cnj,
        classe_processual: "Apelação Cível",
        orgao_julgador: "9ª Câmara Cível",
        data_julgamento: "2024-09-25T00:00:00.000Z",
        link_pdf: "https://projudi.tjgo.jus.br/ConsultaJurisprudencia?PaginaAtual=12&Id_Arquivo=900000100",
      },
    ];
  }
  const fixture = (nome: string) => readFile(join(raiz, "tests", "fixtures", nome));
  const falcao = JSON.parse(String(await fixture("falcao-pv13.json"))).casos["sem-parametro"].documentos;
  const normas = { [URN_DO_CPC]: JSON.parse(String(await fixture("legislacao/cpc-recorte.json"))) };
  const projudi = {
    cnj: TJGO.cnj,
    dataHora: TJGO.dataHora,
    idMov: TJGO.idMov,
    ementaP7s: (await fixture("tjgo-ementa.html.p7s")).toString("base64"),
    relatorioP7s: (await fixture("tjgo-relatorio-voto.html.p7s")).toString("base64"),
  };
  await writeFile(destino, JSON.stringify({ site, falcao, normas, projudi }));
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

interface Contas {
  total: number;
  semResposta: string[];
  enviados: number;
  recebidos: number;
}
const contarChamadas = async (arquivo: string): Promise<Contas> => lerChamadas(await readFile(arquivo, "utf8").catch(() => ""));

interface Janela {
  mcp: Client;
  chamadas: string;
  stderr: string[];
  ferramentas: number;
}

async function abrirJanela(
  versao: Versao,
  dados: string,
  nome: string,
  gravadas: string,
  ambiente: Record<string, string> = {},
): Promise<{ janela: Janela; ms: number }> {
  const chamadas = join(dados, `chamadas-${nome}.log`);
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", preload, join(VERSOES[versao]!, "dist", "index.js")],
    cwd: VERSOES[versao],
    env: {
      ...(process.env as Record<string, string>),
      GARIMPO_DADOS: dados,
      GARIMPO_PASTA: join(dados, "pdf"),
      VEL_GRAVADAS: gravadas,
      VEL_CHAMADAS: chamadas,
      ...ambiente,
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
  const antes = await contarChamadas(j.chamadas);
  const t0 = performance.now();
  const r = (await j.mcp.callTool({ name: nome, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const ms = performance.now() - t0;
  const depois = await contarChamadas(j.chamadas);
  return {
    ms,
    chamadas: depois.total - antes.total,
    enviados: depois.enviados - antes.enviados,
    recebidos: depois.recebidos - antes.recebidos,
    ...(r.isError && { erro: r.content[0]?.text.slice(0, 300) }),
  };
}

/** Fase 1: a bateria numa janela já aberta. */
async function bateria(j: Janela, r: Recorte, k: number, pdf: string): Promise<Rodada> {
  const simples = { tribunal: TRIBUNAL_DA_SIMPLES, texto: r.formulacoes[0], limite: 10 };
  const tribunais = TRIBUNAIS_DA_AMPLA ?? r.tribunais;
  const ampla = { formulacoes: r.formulacoes, tribunais };
  const segunda = { formulacoes: uniao(r), tribunais };
  return {
    simplesFria: await passo(j, "busca_direta", simples),
    simplesRepetida: await passo(j, "busca_direta", simples),
    amplaFria: await passo(j, "busca_ampla", ampla),
    amplaRepetida: await passo(j, "busca_ampla", ampla),
    uniaoQuente: await passo(j, "busca_ampla", segunda),
    uniaoRenovar: await passo(j, "busca_ampla", { ...segunda, renovar: true }),
    falcao: await passo(j, "busca_direta", { tribunal: TRT, texto: TEXTOS_DO_FALCAO[k], limite: 10 }),
    lerPdf: await passo(j, "ler_inteiro_teor", { caminho: pdf, parte: 1 }),
    leiFria: await passo(j, "texto_de_lei", LEI),
    leiRepetida: await passo(j, "texto_de_lei", LEI),
    buscaTjgo: await passo(j, "busca_direta", { tribunal: "tjgo", texto: TJGO.textos[k], limite: 10 }),
    projudiP7s: await passo(j, "obter_inteiro_teor", { id: `tjgo:vel-tjgo-${k}` }),
  };
}

/** Fase 2: processos novos na mesma pasta de dados (memória fria, falha de leitura, TCU frio e quente). */
async function bateriaDosProcessosNovos(
  abrir: (nome: string, ambiente?: Record<string, string>) => Promise<{ janela: Janela; ms: number }>,
  r: Recorte,
  k: number,
  anosTcu: number[],
): Promise<{ medidas: Rodada; janelas: Janela[] }> {
  const segunda = { formulacoes: uniao(r), tribunais: TRIBUNAIS_DA_AMPLA ?? r.tribunais };
  const medidas: Rodada = {};
  const janelas: Janela[] = [];
  const emProcessoNovo = async (nome: string, ambiente: Record<string, string>, f: (j: Janela) => Promise<void>) => {
    const { janela } = await abrir(nome, ambiente);
    janelas.push(janela);
    try {
      await f(janela);
    } finally {
      await janela.mcp.close().catch(() => {});
    }
  };
  await emProcessoNovo(`semmemoria-${k}`, { GARIMPO_SEM_MEMORIA: "1" }, async (j) => {
    medidas.uniaoSemMemoria = await passo(j, "busca_ampla", segunda);
  });
  await emProcessoNovo(`falha-${k}`, {}, async (j) => {
    medidas.uniaoFalhaLeitura = await passo(j, "busca_ampla", segunda);
  });
  for (const n of BLOCOS_TCU) {
    const anos = anosTcu.slice(-n);
    await emProcessoNovo(`tcu${n}-${k}`, {}, async (j) => {
      const comum = CONSULTAS_TCU.find((c) => c.nome === "comum")!;
      medidas[`tcu${n}Frio`] = await passo(j, "pesquisar_acordaos_tcu", { consulta: comum.consulta, anos });
      for (const c of CONSULTAS_TCU) {
        medidas[`tcu${n}_${c.nome}`] = await passo(j, "pesquisar_acordaos_tcu", {
          consulta: c.consulta,
          anos,
          ...("filtros" in c ? c.filtros : {}),
        });
      }
    });
  }
  return { medidas, janelas };
}

/** Arquivos (não pastas) sob uma pasta, recursivamente. */
async function arquivosSob(pasta: string): Promise<string[]> {
  const itens = await readdir(pasta, { withFileTypes: true }).catch(() => []);
  const dentro = await Promise.all(
    itens.map((i) => (i.isDirectory() ? arquivosSob(join(pasta, i.name)) : Promise.resolve([join(pasta, i.name)]))),
  );
  return dentro.flat();
}

/** Espera a gravação da memória em disco (que corre por trás das respostas) parar: 3 leituras iguais, até 15 s. */
async function esperarMemoriaAssentar(dados: string): Promise<void> {
  let anterior = "";
  let iguais = 0;
  for (const fim = Date.now() + 15_000; Date.now() < fim && iguais < 3; ) {
    await new Promise((r) => setTimeout(r, 150));
    const lista = await arquivosSob(join(dados, "memoria"));
    const assinatura = (await Promise.all(lista.map(async (a) => `${a}:${(await stat(a).catch(() => undefined))?.size}`))).sort().join("|");
    iguais = assinatura === anterior ? iguais + 1 : 0;
    anterior = assinatura;
  }
}

/** Troca cada busca guardada por uma pasta de mesmo nome: a leitura falha (não é "ausente"), como um disco com defeito. */
async function estragarBuscasGuardadas(dados: string): Promise<number> {
  const memoria = join(dados, "memoria");
  const pastas = (await readdir(memoria).catch(() => [] as string[])).filter((n) => n.startsWith("buscas-"));
  let estragadas = 0;
  for (const p of pastas) {
    for (const nome of await readdir(join(memoria, p))) {
      if (!nome.endsWith(".json")) continue;
      await rm(join(memoria, p, nome), { force: true });
      await mkdir(join(memoria, p, nome));
      estragadas++;
    }
  }
  return estragadas;
}

interface Contexto {
  recortes: Recorte[];
  gravadas: string;
  pdfModelo: string;
  tcuModelo: string;
  anosTcu: number[];
}

/** Uma rodada: pasta de dados nova, `janelas` processos ao mesmo tempo; devolve as medidas da 1ª janela. */
async function rodada(
  versao: Versao,
  janelas: number,
  ctx: Contexto,
): Promise<{ medidas: Rodada; semResposta: string[]; stderr: string; ferramentas: number; estragadas: number }> {
  const dados = await mkdtemp(join(tmpdir(), "garimpo-vel-"));
  const abertas: Janela[] = [];
  try {
    await mkdir(join(dados, "pdf"));
    const pdf = join(dados, "pdf", "acordao.pdf");
    await copyFile(ctx.pdfModelo, pdf);
    await mkdir(join(dados, "tcu"));
    for (const nome of await readdir(ctx.tcuModelo)) {
      await link(join(ctx.tcuModelo, nome), join(dados, "tcu", nome)).catch(() => copyFile(join(ctx.tcuModelo, nome), join(dados, "tcu", nome)));
    }
    const abrir = (nome: string, ambiente: Record<string, string> = {}) => abrirJanela(versao, dados, nome, ctx.gravadas, ambiente);

    const inicio = await Promise.all(Array.from({ length: janelas }, (_, k) => abrir(`principal-${k}`)));
    abertas.push(...inicio.map((i) => i.janela));
    const baterias = await Promise.all(abertas.map((j, k) => bateria(j, ctx.recortes[k], k, pdf)));
    await esperarMemoriaAssentar(dados);
    await Promise.all(abertas.map((j) => j.mcp.close().catch(() => {})));

    const estragadas = await estragarBuscasGuardadas(dados);
    const novos = await Promise.all(
      Array.from({ length: janelas }, (_, k) => bateriaDosProcessosNovos(abrir, ctx.recortes[k], k, ctx.anosTcu)),
    );
    abertas.push(...novos.flatMap((n) => n.janelas));

    const semResposta = (await Promise.all(abertas.map((j) => contarChamadas(j.chamadas)))).flatMap((c) => c.semResposta);
    return {
      medidas: { inicio: { ms: inicio[0].ms, chamadas: 0, enviados: 0, recebidos: 0 }, ...baterias[0], ...novos[0].medidas },
      semResposta,
      stderr: abertas.flatMap((j) => j.stderr).join(""),
      ferramentas: inicio[0].janela.ferramentas,
      estragadas,
    };
  } finally {
    await Promise.all(abertas.map((j) => j.mcp.close().catch(() => {})));
    await rm(dados, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
}

const ordenar = (xs: number[]) => [...xs].sort((a, b) => a - b);
const mediana = (xs: number[]) => {
  const s = ordenar(xs);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** p95 pelo posto mais próximo (com N = 30, o 29º menor). */
const p95 = (xs: number[]) => ordenar(xs)[Math.max(0, Math.ceil(0.95 * xs.length) - 1)];

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
const kb = (x: number) => (x < 1024 ? `${fmt(x)} B` : `${(x / 1024).toFixed(1).replace(".", ",")} KB`);
const sinal = (x: number, casas = 0) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(casas)}`;
/** Valores que se repetem nas rodadas (chamadas, bytes): os distintos, do menor ao maior. */
const distintos = (xs: number[], f: (x: number) => string = fmt) => [...new Set(ordenar(xs))].map(f).join("/");
/** Passos que contam no custo por tese: tudo o que vai às fontes (o início, o PDF local e o TCU local não vão). */
const DA_TESE = PASSOS.filter((p) => !["inicio", "lerPdf"].includes(p) && !p.startsWith("tcu"));

function git(pasta: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: pasta, encoding: "utf8" }).trim();
  } catch {
    return "(sem git)";
  }
}

async function principal(): Promise<void> {
  for (const pasta of Object.values(VERSOES)) compilar(pasta!);
  const trabalho = await mkdtemp(join(tmpdir(), "garimpo-vel-gravadas-"));
  try {
    const gravadas = join(trabalho, "gravadas.json");
    const recortes = await montarGravadas(gravadas);
    const pdfModelo = join(trabalho, "acordao.pdf");
    await writeFile(pdfModelo, pdfDeAcordao());
    const tcu = await gravarTcuSintetico(join(trabalho, "tcu-modelo"));
    const ctx: Contexto = { recortes, gravadas, pdfModelo, tcuModelo: join(trabalho, "tcu-modelo", "tcu"), anosTcu: COMPOSICAO_TCU.anos };

    const ambiente = {
      cpu: cpus()[0]?.model.trim(),
      threads: cpus().length,
      memoriaTotalGb: +(totalmem() / 2 ** 30).toFixed(1),
      memoriaLivreGbAntes: +(freemem() / 2 ** 30).toFixed(1),
      sistema: `${platform()} ${release()}`,
      node: process.version,
      commits: Object.fromEntries(Object.entries(VERSOES).map(([v, p]) => [v, git(p!, "rev-parse", "--short", "HEAD")])),
      srcAlterado: Object.fromEntries(Object.entries(VERSOES).map(([v, p]) => [v, git(p!, "status", "--porcelain", "--", "src") !== ""])),
    };
    const cargaAntes = await cargaDaCpu();
    const inicio = new Date();
    const crus: Record<string, Record<string, Medida[]>> = {};
    const naoGravadas = new Set<string>();
    const ferramentas: Record<Versao, Set<number>> = { antes: new Set(), depois: new Set() };
    const estragadas = new Set<number>();
    for (let i = 0; i < N; i++) {
      for (const janelas of [1, 2]) {
        // Alterna quem vai primeiro: a carga da máquina pesa igual nas duas versões.
        const ordem: Versao[] = (i + janelas) % 2 ? versoes : [...versoes].reverse();
        for (const versao of ordem) {
          const r = await rodada(versao, janelas, ctx);
          ferramentas[versao].add(r.ferramentas);
          estragadas.add(r.estragadas);
          r.semResposta.forEach((s) => naoGravadas.add(`${versao}: ${s}`));
          const chave = `${versao}|${janelas}`;
          crus[chave] ??= Object.fromEntries(PASSOS.map((p) => [p, []]));
          for (const p of PASSOS) {
            const m = r.medidas[p];
            if (m) crus[chave][p].push(m);
            if (m?.erro) console.error(`[${chave}] ${p}: erro: ${m.erro}`);
          }
          if (i === 0 && r.stderr.trim()) console.error(`[${chave}] stderr: ${r.stderr.trim().slice(0, 500)}`);
        }
      }
      process.stderr.write(`rodada ${i + 1}/${N}\n`);
    }
    const cargaDepois = await cargaDaCpu();
    const fim = new Date();

    const ok = (ms: Medida[]) => ms.filter((m) => !m.erro).map((m) => m.ms);
    const linhas: string[] = [
      `Medição de ${inicio.toISOString()} a ${fim.toISOString()} · N = ${N} por ${VERSUS ? "versão e por " : ""}nº de janelas`,
      `Máquina: ${ambiente.cpu}, ${ambiente.threads} threads, ${ambiente.memoriaTotalGb} GB (livres ${ambiente.memoriaLivreGbAntes} GB no início) · ` +
        `${ambiente.sistema} · Node ${ambiente.node} · CPU ocupada antes ${fmt(cargaAntes * 100)} %, depois ${fmt(cargaDepois * 100)} %`,
      `Commits: ${Object.entries(ambiente.commits).map(([v, c]) => `${v} ${c}${ambiente.srcAlterado[v] ? " (src/ alterado, não commitado)" : ""}`).join(" · ")}`,
      "",
    ];
    if (VERSUS) {
      linhas.push(
        "| Operação | Janelas | Antes: mediana / p95 (ms) | Depois: mediana / p95 (ms) | Diferença na mediana | Chamadas (antes → depois) | Bytes recebidos (antes → depois) | Resultado |",
        "|---|---|---|---|---|---|---|---|",
      );
      for (const p of PASSOS) {
        for (const janelas of [1, 2]) {
          const a = crus[`antes|${janelas}`][p];
          const d = crus[`depois|${janelas}`][p];
          const [ma, md] = [ok(a), ok(d)];
          const erros = a.length - ma.length + (d.length - md.length);
          const contas = `${distintos(a.map((m) => m.chamadas))} → ${distintos(d.map((m) => m.chamadas))}`;
          const bytes = `${kb(mediana(a.map((m) => m.recebidos)))} → ${kb(mediana(d.map((m) => m.recebidos)))}`;
          const tempo = (xs: number[]) => (xs.length ? `${fmt(mediana(xs))} / ${fmt(p95(xs))}` : "não existe / erro");
          if (!ma.length || !md.length) {
            linhas.push(`| ${ROTULOS[p]} | ${janelas} | ${tempo(ma)} | ${tempo(md)} | — | ${contas} | ${bytes} | — |`);
            continue;
          }
          const v = veredito(ma, md);
          linhas.push(
            `| ${ROTULOS[p]} | ${janelas} | ${tempo(ma)} | ${tempo(md)} | ${sinal(v.dMs)} ms (${sinal(v.dPct, 1)} %; z ${v.z.toFixed(1)}) | ` +
              `${contas} | ${bytes} | ${v.texto}${erros ? ` (${erros} com erro)` : ""} |`,
          );
        }
      }
    } else {
      linhas.push(
        "| Operação | Janelas | Mediana (ms) | p95 (ms) | Pior (ms) | Chamadas | Bytes enviados | Bytes recebidos | Erros |",
        "|---|---|---|---|---|---|---|---|---|",
      );
      for (const p of PASSOS) {
        for (const janelas of [1, 2]) {
          const ms = crus[`depois|${janelas}`][p];
          const t = ok(ms);
          const tempo = t.length ? `${fmt(mediana(t))} | ${fmt(p95(t))} | ${fmt(Math.max(...t))}` : "erro | erro | erro";
          linhas.push(
            `| ${ROTULOS[p]} | ${janelas} | ${tempo} | ${distintos(ms.map((m) => m.chamadas))} | ` +
              `${distintos(ms.map((m) => m.enviados), kb)} | ${distintos(ms.map((m) => m.recebidos), kb)} | ${ms.length - t.length} |`,
          );
        }
      }
    }

    // Custo interno por tese: a bateria da 1ª janela, somando o que vai às fontes (o que o servidor faria).
    linhas.push("", "Custo interno por tese (1ª janela, uma bateria inteira; requisições e bytes contados no transporte do fetch falso):", "");
    for (const versao of versoes) {
      for (const janelas of [1, 2]) {
        const porRodada = crus[`${versao}|${janelas}`];
        const soma = (campo: keyof Medida) =>
          Array.from({ length: N }, (_, i) => DA_TESE.reduce((s, p) => s + Number(porRodada[p][i]?.[campo] ?? 0), 0));
        linhas.push(
          `- ${VERSUS ? `${versao}, ` : ""}${janelas} janela(s): ${distintos(soma("chamadas"))} requisições; ` +
            `${distintos(soma("enviados"), kb)} enviados; ${distintos(soma("recebidos"), kb)} recebidos.`,
        );
      }
    }
    linhas.push(
      "",
      `Ferramentas no tools/list: ${versoes.map((v) => `${v} ${[...ferramentas[v]].join("/")}`).join(", ")}. ` +
        `Buscas guardadas estragadas para a falha de leitura, por rodada: ${[...estragadas].join("/")}.`,
    );
    if (naoGravadas.size) linhas.push("", `Chamadas sem resposta gravada (404 do fetch falso): ${[...naoGravadas].join("; ")}`);
    linhas.push("", "TCU sintético (composição registrada; gerado nesta medição, fora do git):", "");
    linhas.push("| Ano | Registros | Relação | INVALIDADO | Sigiloso | Aviso de sigilo | Com entidade HTML | MB | Bytes/registro p10 / mediana / p90 / máx. | Palavras distintas | Plantadas | sha256 |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const a of tcu.anos) {
      const b = a.bytes.porRegistro;
      linhas.push(
        `| ${a.ano} | ${a.registros} | ${a.porTipo["ACÓRDÃO DE RELAÇÃO"] ?? 0} | ${a.porSituacao.INVALIDADO ?? 0} | ${a.porSituacao.SIGILOSO ?? 0} | ` +
          `${a.avisosDeSigilo} | ${a.comEntidadeHtml} | ${(a.bytes.total / 2 ** 20).toFixed(1)} | ${b.p10} / ${b.mediana} / ${b.p90} / ${b.maximo} | ` +
          `${a.vocabulario.palavrasDistintas} | ${Object.entries(a.plantadas).map(([t, n]) => `${t} ${n}`).join("; ")} | ${a.sha256.slice(0, 12)} |`,
      );
    }
    console.log(linhas.join("\n"));

    const saida = join(raiz, "banco-de-provas-resultados", "velocidade");
    await mkdir(saida, { recursive: true });
    const arquivo = join(saida, `${inicio.toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(
      arquivo,
      JSON.stringify(
        { inicio, fim, N, versoes: VERSOES, ambiente, cargaAntes, cargaDepois, ferramentas: Object.fromEntries(versoes.map((v) => [v, [...ferramentas[v]]])), tcu, crus },
        null,
        1,
      ),
    );
    console.log(`\nTempos crus: ${arquivo}`);
  } finally {
    await rm(trabalho, { recursive: true, force: true });
  }
}

await principal();
