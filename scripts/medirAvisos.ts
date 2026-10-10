/**
 * Medição cega e dupla dos avisos de conferência (G-75): `montar` prepara a amostra para os dois rotuladores e `medir`
 * consolida os rótulos, roda os sinais sobre os PDFs da amostra e imprime, por sinal, só contagens e hashes. Local, sem
 * rede. A pasta da amostra fica FORA do repositório (regra 2: trecho de PDF real não entra no git) e nada que ela
 * contém — citação, órgão, texto — é impresso. Protocolo: docs/banco-de-provas/medicao-cega-dos-avisos.md.
 *
 *   npx vite-node scripts/rodarMedirAvisos.ts montar <pasta>
 *   npx vite-node scripts/rodarMedirAvisos.ts medir <pasta>
 */

import { createHash, randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  avisoDeOrgaoDoFecho,
  conferirNoInteiroTeor,
  lerCitacao,
  SINAIS_DE_QUEM_DISSE,
  type ResultadoDaFonte,
  type SinaisDeQuemDisse,
} from "../src/conferencia.js";
import { lerParaConferir, type InteiroTeorParaConferir } from "../src/leitura.js";

/** Os sinais de passagem do ticket 08 (um interruptor cada) e o do órgão do fecho (ticket 09). */
export const SINAIS_DE_PASSAGEM = Object.keys(SINAIS_DE_QUEM_DISSE) as (keyof SinaisDeQuemDisse)[];
export const SINAIS = [...SINAIS_DE_PASSAGEM, "orgaoDoFecho"] as const;
export type Sinal = (typeof SINAIS)[number];

export const CONJUNTOS = ["ajuste", "validacao"] as const;
export type Conjunto = (typeof CONJUNTOS)[number];

const MANIFESTO = "amostra.json";
const ROTULOS_A = "rotulos-a.json";
const ROTULOS_B = "rotulos-b.json";
const DESEMPATE = "desempate.json";

const RAIZ_DO_REPOSITORIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Um item da amostra: um PDF; a citação testa os sinais de passagem, tribunal + órgão do registro testam o do fecho. */
export interface Item {
  id: string;
  pdf: string;
  conjunto?: Conjunto;
  citacao?: string;
  tribunal?: string;
  orgaoDoRegistro?: string;
}

/** Erro de uso do protocolo: a mensagem ensina o que fazer e nunca repete texto da amostra. */
export class ErroDeProtocolo extends Error {}

type Rotulos = Record<string, Partial<Record<Sinal, boolean | null>>>;

/** Os sinais que valem para o item, pelo que o manifesto traz dele. */
export function sinaisDoItem(item: Item): Sinal[] {
  return [
    ...(item.citacao ? SINAIS_DE_PASSAGEM : []),
    ...(item.tribunal && item.orgaoDoRegistro ? (["orgaoDoFecho"] as const) : []),
  ];
}

const hash = (conteudo: Buffer | string) => createHash("sha256").update(conteudo).digest("hex").slice(0, 12);

/** Ordem pseudoaleatória fixa pela semente: ordena pelo hash de semente + finalidade + id. */
function embaralhar(itens: Item[], semente: string, finalidade: string): Item[] {
  const chave = (item: Item) => createHash("sha256").update(`${semente}|${finalidade}|${item.id}`).digest("hex");
  return [...itens].sort((x, y) => (chave(x) < chave(y) ? -1 : 1));
}

async function lerJson(pasta: string, nome: string, ajuda: string): Promise<unknown> {
  let bruto: string;
  try {
    bruto = await readFile(path.join(pasta, nome), "utf8");
  } catch {
    throw new ErroDeProtocolo(`Falta o arquivo ${nome} na pasta da amostra. ${ajuda}`);
  }
  try {
    return JSON.parse(bruto);
  } catch {
    throw new ErroDeProtocolo(`O arquivo ${nome} não é um JSON válido; confira vírgulas e aspas.`);
  }
}

function garantirPastaDeFora(pasta: string): string {
  const absoluta = path.resolve(pasta);
  const relativo = path.relative(RAIZ_DO_REPOSITORIO, absoluta);
  if (!relativo.startsWith("..") && !path.isAbsolute(relativo)) {
    throw new ErroDeProtocolo(
      "A pasta da amostra está dentro do repositório. Trecho de PDF real não pode entrar no git (regra 2): use uma " +
        "pasta fora dele, por exemplo na sua pasta de documentos.",
    );
  }
  return absoluta;
}

async function lerManifesto(pasta: string): Promise<{ itens: Item[]; semente?: string }> {
  const bruto = (await lerJson(
    pasta,
    MANIFESTO,
    `Crie-o com {"itens":[{"id":"a01","pdf":"a01.pdf","citacao":"…","tribunal":"…","orgaoDoRegistro":"…"}]}.`,
  )) as { itens?: Item[]; semente?: string };
  const itens = bruto.itens;
  if (!Array.isArray(itens) || !itens.length) {
    throw new ErroDeProtocolo(`${MANIFESTO} precisa de uma lista "itens" com pelo menos um PDF.`);
  }
  const vistos = new Set<string>();
  for (const item of itens) {
    if (typeof item.id !== "string" || !/^[A-Za-z0-9-]+$/.test(item.id)) {
      throw new ErroDeProtocolo(`Todo item precisa de "id" só com letras, números e hífen (sem trecho do texto).`);
    }
    if (!/[A-Za-z]/.test(item.id)) {
      throw new ErroDeProtocolo(`O id "${item.id}" precisa de pelo menos uma letra (ex.: "a01"): id só de dígitos perde a ordem embaralhada do formulário.`);
    }
    if (vistos.has(item.id)) throw new ErroDeProtocolo(`O id "${item.id}" aparece duas vezes em ${MANIFESTO}.`);
    vistos.add(item.id);
    if (item.conjunto !== undefined && !(CONJUNTOS as readonly unknown[]).includes(item.conjunto)) {
      throw new ErroDeProtocolo(`O item "${item.id}" tem "conjunto" inválido: use "ajuste" ou "validacao" (ou tire o campo para o "montar" sortear).`);
    }
    if (typeof item.pdf !== "string" || !item.pdf) throw new ErroDeProtocolo(`O item "${item.id}" não diz o seu "pdf".`);
    if (!sinaisDoItem(item).length) {
      throw new ErroDeProtocolo(`O item "${item.id}" não tem "citacao" nem "tribunal" com "orgaoDoRegistro": não há o que medir.`);
    }
  }
  return { itens, semente: typeof bruto.semente === "string" && bruto.semente ? bruto.semente : undefined };
}

/**
 * Prepara a amostra: sorteia, com uma semente gravada em amostra.json, quem é do conjunto de ajuste e quem é da
 * validação (metades equilibradas; a regra se ajusta num e se confere no outro), e grava os dois formulários de rótulo
 * em branco, com os itens em ordem embaralhada pela mesma semente (a ordem do manifesto poderia vazar o gabarito). Não
 * sobrescreve rótulo já preenchido. Devolve só a contagem.
 */
export async function montar(pastaPedida: string): Promise<string> {
  const pasta = garantirPastaDeFora(pastaPedida);
  const { itens, semente: gravada } = await lerManifesto(pasta);
  const semente = gravada ?? randomBytes(8).toString("hex");
  for (const item of itens) await lerPdf(pasta, item);
  const semConjunto = embaralhar(itens.filter((i) => !i.conjunto), semente, "conjunto");
  semConjunto.forEach((item, i) => (item.conjunto = i < Math.ceil(semConjunto.length / 2) ? "ajuste" : "validacao"));
  const contagem = { ajuste: 0, validacao: 0 };
  for (const item of itens) contagem[item.conjunto!]++;
  await writeFile(path.join(pasta, MANIFESTO), JSON.stringify({ semente, itens }, null, 2) + "\n");
  const formulario: Rotulos = Object.fromEntries(
    embaralhar(itens, semente, "ordem").map((item) => [item.id, Object.fromEntries(sinaisDoItem(item).map((s) => [s, null]))]),
  );
  const criados: string[] = [];
  for (const nome of [ROTULOS_A, ROTULOS_B]) {
    const existe = await access(path.join(pasta, nome)).then(() => true, () => false);
    if (existe) continue;
    await writeFile(path.join(pasta, nome), JSON.stringify({ rotulos: formulario }, null, 2) + "\n");
    criados.push(nome);
  }
  return (
    `Amostra: ${itens.length} PDFs (ajuste ${contagem.ajuste}, validação ${contagem.validacao}). ` +
    (criados.length
      ? `Formulários em branco criados: ${criados.join(", ")}. Entregue um a cada rotulador, sem o outro.`
      : "Formulários de rótulo já existiam; nada sobrescrito.")
  );
}

async function lerPdf(pasta: string, item: Item): Promise<Buffer> {
  try {
    return await readFile(path.join(pasta, item.pdf));
  } catch {
    throw new ErroDeProtocolo(`O PDF do item "${item.id}" não está na pasta da amostra.`);
  }
}

async function lerRotulos(pasta: string, nome: string, itens: Item[], quem: string): Promise<Rotulos> {
  const bruto = (await lerJson(
    pasta,
    nome,
    `Dois rotuladores independentes preenchem um formulário cada (rode "montar" para gerá-los em branco); ` +
      `sem ${quem}, a concordância não pode ser medida.`,
  )) as { rotulos?: Rotulos };
  const rotulos = bruto.rotulos ?? {};
  const faltando: string[] = [];
  for (const item of itens) {
    for (const sinal of sinaisDoItem(item)) {
      if (typeof rotulos[item.id]?.[sinal] !== "boolean") faltando.push(`${item.id}/${sinal}`);
    }
  }
  if (faltando.length) {
    throw new ErroDeProtocolo(
      `${nome} está incompleto: ${faltando.length} rótulos sem sim/não (true/false), por exemplo ${faltando.slice(0, 5).join(", ")}. ` +
        `Os dois rotuladores precisam rotular todos os sinais de todos os itens.`,
    );
  }
  return rotulos;
}

/** Uma só leitura da citação: o aviso de cada sinal é o que muda quando só ele é ligado. */
function marcas(resultado: ResultadoDaFonte): string {
  if (!("ocorrencias" in resultado)) return "";
  return JSON.stringify(
    resultado.ocorrencias.map((o) => ("pedacos" in o ? o.pedacos.map((p) => p.sinalDeOutroAutor) : o.sinalDeOutroAutor)),
  );
}

/** O que o programa diz de um item para cada sinal dele: avisou ou não. Nunca sai daqui como texto. */
async function avisos(
  leitura: InteiroTeorParaConferir,
  item: Item,
): Promise<{ avisos: Partial<Record<Sinal, boolean>>; achada: boolean }> {
  const resultado: Partial<Record<Sinal, boolean>> = {};
  let achada = true;
  if (item.citacao) {
    const citacao = lerCitacao(item.citacao, { reticenciasComoCorte: false });
    const desligados = { ...SINAIS_DE_QUEM_DISSE };
    const base = conferirNoInteiroTeor(leitura, citacao, desligados);
    achada = "ocorrencias" in base && base.ocorrencias.length > 0;
    for (const sinal of SINAIS_DE_PASSAGEM) {
      resultado[sinal] =
        achada && marcas(conferirNoInteiroTeor(leitura, citacao, { ...desligados, [sinal]: true })) !== marcas(base);
    }
  }
  if (item.tribunal && item.orgaoDoRegistro) {
    resultado.orgaoDoFecho =
      avisoDeOrgaoDoFecho(leitura, { tribunal: item.tribunal, orgao: item.orgaoDoRegistro }, true) !== undefined;
  }
  return { avisos: resultado, achada };
}

/** Concordância entre os dois rotuladores num sinal: itens, iguais e kappa de Cohen (null se não definido). */
export interface Concordancia {
  itens: number;
  iguais: number;
  kappa: number | null;
}

export interface NumerosDoSinal {
  sinal: Sinal;
  conjunto: Conjunto;
  /** Itens com consenso (rótulos iguais ou desempatados). */
  avaliados: number;
  semConsenso: number;
  /** Avisou e é verdade. */
  acertos: number;
  /** Avisou à toa (a verdade é "não"). */
  falsosAvisos: number;
  /** Não avisou e era verdade. */
  perdidos: number;
  /** Não avisou e não era: frase limpa. */
  limpos: number;
  concordancia: Concordancia;
  /** "id:hash" (hash de 12 hex do PDF) de cada falso aviso e de cada caso perdido: para o dono achar o caso sem o programa citá-lo. */
  casosDosFalsosAvisos: string[];
  casosDosPerdidos: string[];
}

export interface Medicao {
  hashDaAmostra: string;
  itens: number;
  /** Itens cuja citação o programa não achou no PDF: ficam fora dos sinais de passagem. */
  citacoesNaoAchadas: number;
  numeros: NumerosDoSinal[];
  /** Ressalvas do protocolo que não impedem a medição, mas que o leitor do relatório precisa ver. */
  avisosDoProtocolo: string[];
}

export function kappa(a: boolean[], b: boolean[]): number | null {
  const n = a.length;
  if (!n) return null;
  const sim = (x: boolean[]) => x.filter(Boolean).length / n;
  const iguais = a.filter((x, i) => x === b[i]).length / n;
  const esperado = sim(a) * sim(b) + (1 - sim(a)) * (1 - sim(b));
  return esperado === 1 ? null : (iguais - esperado) / (1 - esperado);
}

/** Consolida os rótulos dos dois rotuladores, roda os sinais nos PDFs e devolve os três números por sinal e conjunto. */
export async function medir(pastaPedida: string): Promise<Medicao> {
  const pasta = garantirPastaDeFora(pastaPedida);
  const { itens } = await lerManifesto(pasta);
  const semConjunto = itens.filter((i) => !i.conjunto).map((i) => i.id);
  if (semConjunto.length) {
    throw new ErroDeProtocolo(`Rode "montar" antes: ${semConjunto.length} itens ainda sem conjunto (ajuste ou validação).`);
  }
  const a = await lerRotulos(pasta, ROTULOS_A, itens, "o formulário do rotulador A");
  const b = await lerRotulos(pasta, ROTULOS_B, itens, "o formulário do rotulador B (rotulador duplo)");
  const [textoA, textoB] = await Promise.all(
    [ROTULOS_A, ROTULOS_B].map((nome) => readFile(path.join(pasta, nome), "utf8")),
  );
  const avisosDoProtocolo: string[] = [];
  if (JSON.stringify(JSON.parse(textoA)) === JSON.stringify(JSON.parse(textoB))) {
    avisosDoProtocolo.push(
      `${ROTULOS_A} e ${ROTULOS_B} são idênticos. Pode ser o melhor caso (dois rotuladores independentes que ` +
        `concordaram em tudo) ou um formulário copiado do outro; o kappa só vale no primeiro. Confirme com os rotuladores.`,
    );
  }
  const temDesempate = await access(path.join(pasta, DESEMPATE)).then(() => true, () => false);
  const desempate = temDesempate ? (((await lerJson(pasta, DESEMPATE, "")) as { rotulos?: Rotulos }).rotulos ?? {}) : {};

  const pdfs = new Map<string, Buffer>();
  const dados = new Map<string, { avisos: Partial<Record<Sinal, boolean>>; achada: boolean }>();
  for (const item of itens) {
    const bytes = await lerPdf(pasta, item);
    pdfs.set(item.id, bytes);
    dados.set(item.id, await avisos(await lerParaConferir(path.join(pasta, item.pdf)), item));
  }

  const numeros: NumerosDoSinal[] = [];
  for (const conjunto of CONJUNTOS) {
    for (const sinal of SINAIS) {
      const doSinal = itens.filter((i) => i.conjunto === conjunto && sinaisDoItem(i).includes(sinal));
      // Sinal de passagem só se mede onde a citação foi achada: sem passagem não há o que o aviso dizer.
      const medidos = doSinal.filter((i) => sinal === "orgaoDoFecho" || dados.get(i.id)!.achada);
      if (!medidos.length) continue;
      const n: NumerosDoSinal = {
        sinal,
        conjunto,
        avaliados: 0,
        semConsenso: 0,
        acertos: 0,
        falsosAvisos: 0,
        perdidos: 0,
        limpos: 0,
        concordancia: { itens: medidos.length, iguais: 0, kappa: null },
        casosDosFalsosAvisos: [],
        casosDosPerdidos: [],
      };
      const rA: boolean[] = [];
      const rB: boolean[] = [];
      for (const item of medidos) {
        const ra = a[item.id][sinal] as boolean;
        const rb = b[item.id][sinal] as boolean;
        rA.push(ra);
        rB.push(rb);
        if (ra === rb) n.concordancia.iguais++;
        const verdade = ra === rb ? ra : desempate[item.id]?.[sinal];
        if (typeof verdade !== "boolean") {
          n.semConsenso++;
          continue;
        }
        n.avaliados++;
        const avisou = dados.get(item.id)!.avisos[sinal] === true;
        const caso = `${item.id}:${hash(pdfs.get(item.id)!)}`;
        if (avisou && verdade) n.acertos++;
        else if (avisou) (n.falsosAvisos++, n.casosDosFalsosAvisos.push(caso));
        else if (verdade) (n.perdidos++, n.casosDosPerdidos.push(caso));
        else n.limpos++;
      }
      n.concordancia.kappa = kappa(rA, rB);
      numeros.push(n);
    }
  }
  const citacoesNaoAchadas = itens.filter((i) => i.citacao && !dados.get(i.id)!.achada).length;
  const hashDaAmostra = hash(itens.map((i) => hash(pdfs.get(i.id)!)).sort().join(""));
  return { hashDaAmostra, itens: itens.length, citacoesNaoAchadas, numeros, avisosDoProtocolo };
}

function razao(parte: number, todo: number): string {
  return todo ? `${parte}/${todo} (${Math.round((100 * parte) / todo)}%)` : "sem base (0 casos)";
}

/** O relatório: só contagens e hashes. Todos os sinais saem, os bons e os ruins (a taxa ruim também se publica). */
export function relatorio(m: Medicao): string {
  const linhas = [
    `Amostra ${m.hashDaAmostra}: ${m.itens} PDFs; citação não achada em ${m.citacoesNaoAchadas} (fora dos sinais de passagem).`,
    "Limiar para ligar cada aviso: decisão do dono (ticket 10, DQ-23); este relatório não liga nada.",
    ...m.avisosDoProtocolo.map((a) => `Atenção: ${a}`),
  ];
  for (const n of m.numeros) {
    const c = n.concordancia;
    linhas.push(
      "",
      `[${n.sinal}] conjunto ${n.conjunto} — ${n.avaliados} com consenso, ${n.semConsenso} sem consenso`,
      `  acerto quando avisa:     ${razao(n.acertos, n.acertos + n.falsosAvisos)}`,
      `  alcance:                 ${razao(n.acertos, n.acertos + n.perdidos)}`,
      `  falso aviso em frase limpa: ${razao(n.falsosAvisos, n.falsosAvisos + n.limpos)}`,
      `  concordância dos rotuladores: ${razao(c.iguais, c.itens)}, kappa ${c.kappa === null ? "indefinido" : c.kappa.toFixed(2)}`,
      `  falsos avisos (id:hash do PDF): ${n.casosDosFalsosAvisos.join(" ") || "nenhum"}`,
      `  perdidos (id:hash do PDF):      ${n.casosDosPerdidos.join(" ") || "nenhum"}`,
    );
  }
  return linhas.join("\n");
}

export async function principal(args: string[]): Promise<number> {
  const [comando, pasta] = args;
  if ((comando !== "montar" && comando !== "medir") || !pasta) {
    console.error("Uso: rodarMedirAvisos.ts montar <pasta-fora-do-repositório> | medir <pasta-fora-do-repositório>");
    return 2;
  }
  try {
    console.log(comando === "montar" ? await montar(pasta) : relatorio(await medir(pasta)));
    return 0;
  } catch (erro) {
    if (!(erro instanceof ErroDeProtocolo)) throw erro;
    console.error(erro.message);
    return 1;
  }
}
