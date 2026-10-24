/**
 * Confere as respostas de um jurado do banco de provas 1.2 (B0.2; docs/banco-de-provas/juri-1.2-instrucoes.md), sem rede
 * e sem dependência: cada lote tem o seu respostas/lote-NNN.csv, com todos os ids do lote, nenhum a mais, uma letra
 * (S, P, C ou N) e o motivo. Vai copiado para a pasta juri/ do pool como conferir.mjs; o jurado roda na pasta dele:
 *
 *   node ../conferir.mjs                    (jurado-a, jurado-b: lotes em ../lotes)
 *   node ../conferir.mjs --lotes lotes      (desempate: os lotes dele)
 *
 * scripts/juriDaLinhaDeBase.ts usa as mesmas funções para ler os votos na apuração.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LETRAS = new Set(["S", "P", "C", "N"]);
const ID = /^J-\d{4}$/;

/** Ids de um lote, na ordem: cada acórdão abre com a linha "## J-0001". */
export function idsDoLote(markdown) {
  return [...markdown.matchAll(/^## (J-\d{4})\s*$/gm)].map((m) => m[1]);
}

/** Lê um respostas/lote-NNN.csv: votos por id e os problemas achados (nunca repete o motivo do jurado). */
export function lerRespostas(texto) {
  const votos = new Map();
  const problemas = [];
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (linhas[0]?.trim().toLowerCase().replace(/\s/g, "") === "id;resposta;motivo") linhas.shift();
  for (const linha of linhas) {
    const [id, resposta, ...resto] = linha.split(";");
    const motivo = resto.join(";").trim();
    const letra = (resposta ?? "").trim().toUpperCase();
    const chave = (id ?? "").trim();
    if (!ID.test(chave)) problemas.push(`linha sem id válido (J-0000): "${linha.slice(0, 20)}…"`);
    else if (votos.has(chave)) problemas.push(`${chave}: respondido duas vezes`);
    else if (!LETRAS.has(letra)) problemas.push(`${chave}: resposta precisa ser S, P, C ou N`);
    else if (!motivo) problemas.push(`${chave}: falta o motivo`);
    else votos.set(chave, { id: chave, letra, motivo });
  }
  return { votos, problemas };
}

/** Confere uma pasta de respostas contra uma pasta de lotes; devolve os votos lidos e os problemas. */
export function conferirPasta(pastaDosLotes, pastaDasRespostas) {
  const problemas = [];
  const votos = new Map();
  const lotes = existsSync(pastaDosLotes) ? readdirSync(pastaDosLotes).filter((f) => /^lote-\d{3}\.md$/.test(f)).sort() : [];
  if (lotes.length === 0) problemas.push(`nenhum lote em ${pastaDosLotes}`);
  for (const lote of lotes) {
    const ids = idsDoLote(readFileSync(join(pastaDosLotes, lote), "utf8"));
    const arquivo = join(pastaDasRespostas, lote.replace(/\.md$/, ".csv"));
    if (!existsSync(arquivo)) {
      problemas.push(`${lote}: sem respostas (${ids.length} acórdãos)`);
      continue;
    }
    const lido = lerRespostas(readFileSync(arquivo, "utf8"));
    for (const p of lido.problemas) problemas.push(`${lote}: ${p}`);
    const esperados = new Set(ids);
    for (const id of ids) if (!lido.votos.has(id)) problemas.push(`${lote}: falta ${id}`);
    for (const [id, voto] of lido.votos) {
      if (!esperados.has(id)) problemas.push(`${lote}: ${id} não é deste lote`);
      else votos.set(id, voto);
    }
  }
  return { lotes: lotes.length, votos, problemas };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (nome, padrao) => {
    const i = process.argv.indexOf(nome);
    return i < 0 ? padrao : process.argv[i + 1];
  };
  const { lotes, votos, problemas } = conferirPasta(arg("--lotes", join("..", "lotes")), arg("--respostas", "respostas"));
  if (problemas.length) {
    console.log(`${problemas.length} problema(s) em ${lotes} lote(s):\n${problemas.slice(0, 60).join("\n")}`);
    process.exit(1);
  }
  console.log(`tudo respondido: ${votos.size} acórdãos em ${lotes} lote(s).`);
}
