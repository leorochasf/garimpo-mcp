/**
 * Júri da linha de base do banco de provas 1.2 (B0.2; docs/banco-de-provas/protocolo-1.2.md, seção 5), sem rede. Tudo
 * na pasta externa da linha de base (<base>, fora do projeto e de nuvem), nunca no projeto:
 *
 *   npx vite-node scripts/juriDaLinhaDeBase.ts -- --montar --base <pasta externa>
 *   npx vite-node scripts/juriDaLinhaDeBase.ts -- --desempate --base <pasta externa>
 *   npx vite-node scripts/juriDaLinhaDeBase.ts -- --apurar --base <pasta externa>
 *
 * --montar lê <base>/rodada (scripts/rodarLinhaDeBase.ts) e grava o pool cego de E1: juri/ (instruções, lotes,
 * conferir.mjs e as pastas dos dois jurados), reservado/ (o pool estruturado, o mapa de cada linha, os controles
 * negativos e a semente) e conferencia-do-dono/ (20 linhas reais sorteadas com a semente ANTES de o júri rodar, D10 a).
 * --desempate, com os dois jurados principais completos, grava em juri/desempate/ só as linhas em que divergiram.
 * --apurar grava veredito/ (veredito por linha, sem texto de caso, e a apuração por pedido e por tese, com E2) e os
 * casos de dúvida para o dono (D10 b, até 20). Nenhum passo grava por cima de pasta que já existe.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conferirPasta } from "./conferirVotos.mjs";
import {
  type AcordaoDaRodada,
  apurar,
  casosParaODono,
  chaveDoAcordao,
  contarVereditos,
  type ItemDaTese,
  lerSecoes,
  type LinhaDoPool,
  type LinhaReservada,
  lotesDoPool,
  montarPool,
  type Pedido,
  paraDesempate,
  sortearConferencia,
  tesesDeE2,
  type Voto,
} from "./linhaDeBase.js";
import { gravacaoForaDoLugarNoDisco } from "./seguroDaRodada.js";

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i < 0 ? undefined : process.argv[i + 1];
};
const parar = (motivo: string): never => {
  console.error(`NÃO FAZ: ${motivo}`);
  process.exit(1);
};
const ler = (...partes: string[]) => JSON.parse(readFileSync(join(...partes), "utf8"));
const gravar = (caminho: string, valor: unknown) => writeFileSync(caminho, JSON.stringify(valor, null, 1));

const raizDoProjeto = fileURLToPath(new URL("..", import.meta.url));
const baseArg = arg("--base");
if (!baseArg || baseArg.startsWith("-")) parar("informe a pasta externa da linha de base: --base <pasta> (com rodada/ dentro).");
const base = resolve(baseArg!);
const fora = gravacaoForaDoLugarNoDisco(base, raizDoProjeto);
if (fora) parar(fora);
const pasta = (...partes: string[]) => join(base, ...partes);

/** Um acórdão para o júri ler, no formato do lote (Markdown, a ementa citada linha a linha). */
function blocoDoAcordao(l: LinhaDoPool): string {
  const ementa = l.ementa.trim() ? l.ementa.trim().split(/\r?\n/).map((x) => `> ${x}`).join("\n") : "> (sem ementa)";
  return [`## ${l.id}`, "", `- Tribunal: ${l.tribunal}`, `- Número: ${l.numero || "(sem número)"}`, `- Data do julgamento: ${l.data || "(sem data)"}`, `- Órgão: ${l.orgao || "(sem órgão)"}`, "", "Ementa:", "", ementa, ""].join("\n");
}

function gravarLotes(destino: string, linhas: readonly LinhaDoPool[], enunciados: ReadonlyMap<number, string>): number {
  mkdirSync(destino, { recursive: true });
  const lotes = lotesDoPool(linhas);
  lotes.forEach((lote, i) => {
    const nome = `lote-${String(i + 1).padStart(3, "0")}`;
    const tese = lote[0].tese;
    const cabecalho = [
      `# Lote ${String(i + 1).padStart(3, "0")} — tese ${tese}`,
      "",
      `**Tese a fundamentar:** ${enunciados.get(tese)}`,
      "",
      `Responda em \`respostas/${nome}.csv\` (cabeçalho \`id;resposta;motivo\`; uma linha por acórdão; S, P, C ou N).`,
      "",
      "---",
      "",
    ].join("\n");
    writeFileSync(join(destino, `${nome}.md`), cabecalho + lote.map(blocoDoAcordao).join("\n"));
  });
  return lotes.length;
}

const enunciadosDasTeses = () =>
  new Map(lerSecoes(readFileSync(join(raizDoProjeto, "docs", "banco-de-provas", "teses-propostas.md"), "utf8")).map((s) => [s.numero, s.tese]));

const votosDe = (lotes: string, respostas: string, quem: string): Map<string, Voto> => {
  const r = conferirPasta(lotes, respostas);
  if (r.problemas.length) parar(`respostas de ${quem} incompletas (${r.problemas.length} problema(s)); a primeira: ${r.problemas[0]}`);
  return r.votos as Map<string, Voto>;
};

if (process.argv.includes("--montar")) {
  if (existsSync(pasta("juri"))) parar(`${pasta("juri")} já existe: o pool é montado uma vez só.`);
  const plano = ler(base, "rodada", "plano.json") as { semente: number; pedidos: Pedido[] };
  const resultados = ler(base, "rodada", "resultados.json") as { id: string; estrato: string; tese: number; erro?: string; acordaos?: { id: string; numero: string; tribunal: string; data?: string; orgao?: string }[] }[];
  const ementas = ler(base, "rodada", "ementas.json") as Record<string, AcordaoDaRodada & { erro?: string }>;
  const maior = (x?: string, y?: string) => ((y ?? "").length > (x ?? "").length ? y : x);
  const porTese = new Map<number, Map<string, ItemDaTese>>();
  for (const r of resultados.filter((x) => x.estrato === "E1" && !x.erro)) {
    if (!porTese.has(r.tese)) porTese.set(r.tese, new Map());
    const daTese = porTese.get(r.tese)!;
    for (const item of r.acordaos ?? []) {
      const e = ementas[item.id];
      const a: AcordaoDaRodada = e && !e.erro ? e : { id: item.id, tribunal: item.tribunal, numero: item.numero, dataJulgamento: item.data, orgao: item.orgao, ementa: "" };
      const chave = chaveDoAcordao(a);
      const ja = daTese.get(chave);
      if (!ja) daTese.set(chave, { chave, acordao: { ...a }, pedidos: [r.id] });
      else {
        if (!ja.pedidos.includes(r.id)) ja.pedidos.push(r.id);
        // Mesmo acórdão por dois caminhos: o campo mais completo, sem dizer de onde veio.
        for (const c of ["numero", "orgao", "ementa", "dataJulgamento", "classe"] as const) ja.acordao[c] = maior(ja.acordao[c], a[c]) as string;
      }
    }
  }
  const teses = new Map([...porTese].sort(([a], [b]) => a - b).map(([n, m]) => [n, [...m.values()]]));
  const pool = montarPool(teses, { semente: plano.semente });
  const enunciados = enunciadosDasTeses();
  const lotes = gravarLotes(pasta("juri", "lotes"), pool.linhas, enunciados);
  cpSync(join(raizDoProjeto, "docs", "banco-de-provas", "juri-1.2-instrucoes.md"), pasta("juri", "INSTRUCOES.md"));
  cpSync(join(raizDoProjeto, "scripts", "conferirVotos.mjs"), pasta("juri", "conferir.mjs"));
  for (const j of ["jurado-a", "jurado-b"]) mkdirSync(pasta("juri", j, "respostas"), { recursive: true });

  mkdirSync(pasta("reservado"), { recursive: true });
  gravar(pasta("reservado", "pool.json"), pool.linhas);
  gravar(pasta("reservado", "mapa.json"), pool.reservado);
  writeFileSync(pasta("reservado", "semente.txt"), `${plano.semente} (mulberry32; embaralha o pool, sorteia os controles e, com semente + 1, a conferência do dono — scripts/linhaDeBase.ts)\n`);
  const controles = pool.reservado.filter((l) => l.controleDaTese !== undefined);
  const resumo = {
    linhas: pool.linhas.length,
    reais: pool.linhas.length - controles.length,
    controles: controles.length,
    lotes,
    semEmenta: pool.linhas.filter((l) => !l.ementa.trim()).length,
    porTese: Object.fromEntries([...teses].map(([n, v]) => [n, v.length])),
    semente: plano.semente,
  };
  gravar(pasta("reservado", "resumo.json"), resumo);

  const sorteados = new Set(sortearConferencia(pool.reservado, { semente: plano.semente }));
  mkdirSync(pasta("conferencia-do-dono"), { recursive: true });
  const linhasDoDono = pool.linhas.filter((l) => sorteados.has(l.id));
  writeFileSync(
    pasta("conferencia-do-dono", "sorteados.md"),
    [
      "# Conferência do dono — parte (a): 20 linhas sorteadas antes do júri",
      "",
      `Sorteadas com a semente ${plano.semente} (+1) entre as linhas reais do pool, antes de qualquer voto. Se quiser conferir, responda em \`sorteados.csv\` com o mesmo critério do júri (S, P, C ou N e o motivo). Sem a sua resposta, o relatório diz "concordância do júri", nunca "conferido pelo dono".`,
      "",
      ...linhasDoDono.map((l) => `**Tese ${l.tese}:** ${enunciados.get(l.tese)}\n\n${blocoDoAcordao(l)}`),
    ].join("\n"),
  );
  writeFileSync(pasta("conferencia-do-dono", "sorteados.csv"), ["id;resposta;motivo", ...linhasDoDono.map((l) => `${l.id};;`)].join("\n") + "\n");
  console.log(JSON.stringify(resumo, null, 1));
} else if (process.argv.includes("--desempate")) {
  if (existsSync(pasta("juri", "desempate"))) parar(`${pasta("juri", "desempate")} já existe.`);
  const a = votosDe(pasta("juri", "lotes"), pasta("juri", "jurado-a", "respostas"), "jurado-a");
  const b = votosDe(pasta("juri", "lotes"), pasta("juri", "jurado-b", "respostas"), "jurado-b");
  const divergentes = new Set(paraDesempate(a, b));
  if (divergentes.size === 0) {
    console.log("Os dois jurados concordaram em tudo: sem desempate. Siga para --apurar.");
    process.exit(0);
  }
  const pool = ler(base, "reservado", "pool.json") as LinhaDoPool[];
  const lotes = gravarLotes(pasta("juri", "desempate", "lotes"), pool.filter((l) => divergentes.has(l.id)), enunciadosDasTeses());
  mkdirSync(pasta("juri", "desempate", "respostas"), { recursive: true });
  console.log(`${divergentes.size} linhas para o desempate, em ${lotes} lote(s): ${pasta("juri", "desempate", "lotes")}`);
} else if (process.argv.includes("--apurar")) {
  if (existsSync(pasta("veredito"))) parar(`${pasta("veredito")} já existe.`);
  const reservado = ler(base, "reservado", "mapa.json") as LinhaReservada[];
  const a = votosDe(pasta("juri", "lotes"), pasta("juri", "jurado-a", "respostas"), "jurado-a");
  const b = votosDe(pasta("juri", "lotes"), pasta("juri", "jurado-b", "respostas"), "jurado-b");
  const divergentes = paraDesempate(a, b);
  const c = divergentes.length ? votosDe(pasta("juri", "desempate", "lotes"), pasta("juri", "desempate", "respostas"), "desempate") : new Map<string, Voto>();
  const ids = reservado.map((l) => l.id);
  const vereditos = apurar(ids, a, b, c);
  const apuracao = contarVereditos(reservado, vereditos);
  const plano = ler(base, "rodada", "plano.json") as { pedidos: Pedido[] };
  const resultados = ler(base, "rodada", "resultados.json") as { id: string; mostrados?: number }[];
  const entregues = new Map(resultados.map((r) => [r.id, r.mostrados ?? 0]));
  const iguais = ids.filter((id) => a.get(id)!.letra === b.get(id)!.letra).length;
  const serve = (l: string) => l === "S" || l === "P";
  const iguaisServe = ids.filter((id) => serve(a.get(id)!.letra) === serve(b.get(id)!.letra)).length;
  const duvidas = casosParaODono(apuracao, reservado, vereditos);

  mkdirSync(pasta("veredito"), { recursive: true });
  writeFileSync(
    pasta("veredito", "veredito.csv"),
    ["id;tese;controle;jurado_a;jurado_b;desempate;veredito", ...reservado.map((l) => [l.id, l.tese, l.controleDaTese !== undefined ? "sim" : "não", a.get(l.id)!.letra, b.get(l.id)!.letra, c.get(l.id)?.letra ?? "", vereditos.get(l.id)].join(";"))].join("\n") + "\n",
  );
  const apuracaoGravada = {
    linhas: ids.length,
    controles: apuracao.controles,
    semMaioria: [...vereditos.values()].filter((v) => v === "sem maioria").length,
    concordancia: { exataAB: iguais / ids.length, serveOuNaoAB: iguaisServe / ids.length, desempates: divergentes.length },
    porPedido: Object.fromEntries(plano.pedidos.filter((p) => p.estrato === "E1").map((p) => [p.id, { entregues: entregues.get(p.id) ?? 0, ...apuracao.porPedido.get(p.id) }])),
    porTese: Object.fromEntries(apuracao.porTese),
    e2: tesesDeE2(plano.pedidos, entregues, apuracao),
    duvidasParaODono: { total: duvidas.total, excedeuOTeto: duvidas.excedeu },
  };
  gravar(pasta("veredito", "apuracao.json"), apuracaoGravada);
  const pool = new Map((ler(base, "reservado", "pool.json") as LinhaDoPool[]).map((l) => [l.id, l]));
  const enunciados = enunciadosDasTeses();
  writeFileSync(
    pasta("conferencia-do-dono", "duvidas.md"),
    [
      "# Conferência do dono — parte (b): casos de dúvida do júri (até 20)",
      "",
      duvidas.excedeu ? `**Há ${duvidas.total} casos; aqui estão os 20 primeiros. O piloto avisa antes de seguir (D10).**` : `${duvidas.total} caso(s).`,
      "",
      ...duvidas.casos.map(({ id, motivo }) => `**${motivo}.** Tese ${pool.get(id)!.tese}: ${enunciados.get(pool.get(id)!.tese)}\n\n${blocoDoAcordao(pool.get(id)!)}`),
    ].join("\n"),
  );
  console.log(JSON.stringify({ ...apuracaoGravada, porPedido: undefined, porTese: undefined }, null, 1));
} else {
  parar("use --montar, --desempate ou --apurar, com --base <pasta externa>.");
}
