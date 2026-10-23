/**
 * TCU sintético da bateria de velocidade (scripts/medirVelocidade.ts): arquivos anuais no formato real do TCU
 * (33 colunas, separador `|`, campos entre aspas, HTML dentro do campo), gerados em tempo de execução numa pasta
 * temporária, nunca no repositório. Tudo fictício e determinístico (mesma composição = mesmo sha256).
 *
 * Proporcional, não real: as frações (relação × comum, INVALIDADO, sigilosos, avisos de sigilo) e o tamanho médio por
 * registro vêm do arquivo de 2025 medido ao vivo (ADR-0025, "Validação ao vivo": 18.588 registros, 12.304 de relação,
 * 99 INVALIDADO, 11 sigilosos, 9 com aviso de sigilo, 413.563.594 bytes); o número de registros por ano é reduzido
 * (padrão 1/40). A forma das distribuições (lognormal), o vocabulário (palavras comuns de direito administrativo com
 * cauda de pseudopalavras, frequência de Zipf), a fração com entidade HTML e os colegiados são suposições, registradas
 * no resumo: o tempo medido vale para esta composição.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COLUNAS_TCU, type RegistroTcu } from "../tests/apoioTcu.js";

export interface Distribuicao {
  medianaBytes: number;
  sigma: number;
}

export interface ComposicaoTcu {
  semente: number;
  anos: number[];
  registrosPorAno: number;
  /** Fração dos registros que são acórdão de relação (só o texto do acórdão, sem sumário, relatório nem voto). */
  fracaoRelacao: number;
  fracaoInvalidado: number;
  /** Situação SIGILOSO (fora da pesquisa). */
  fracaoSigiloso: number;
  /** Oficializados com sumário e relatório trocados pelo aviso de sigilo do TCU. */
  fracaoAvisoDeSigilo: number;
  /** Registros com entidade HTML (`&nbsp;`), que fazem a pesquisa pular a triagem barata. Suposição. */
  fracaoComEntidadeHtml: number;
  colegiados: Record<string, number>;
  relatores: number;
  /** Tamanho do texto por registro (bytes, antes das aspas do CSV). */
  tamanho: { comum: Distribuicao; relacao: Distribuicao; tetoBytes: number };
  vocabulario: { pseudopalavras: number; expoenteZipf: number };
  /** Termos plantados (fora do vocabulário) e a fração dos registros oficializados que os trazem. */
  plantadas: Record<string, number>;
}

/** 2025 ao vivo (ADR-0025): base das frações e do tamanho médio. */
const REAL_2025 = { registros: 18_588, relacao: 12_304, invalidado: 99, sigiloso: 11, avisoDeSigilo: 9, bytes: 413_563_594 };

export const COMPOSICAO_TCU: ComposicaoTcu = {
  semente: 20261023,
  anos: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  registrosPorAno: Math.round(REAL_2025.registros / 40),
  fracaoRelacao: REAL_2025.relacao / REAL_2025.registros,
  fracaoInvalidado: REAL_2025.invalidado / REAL_2025.registros,
  fracaoSigiloso: REAL_2025.sigiloso / REAL_2025.registros,
  fracaoAvisoDeSigilo: REAL_2025.avisoDeSigilo / REAL_2025.registros,
  fracaoComEntidadeHtml: 0.5,
  colegiados: { "Plenário": 0.3, "Primeira Câmara": 0.35, "Segunda Câmara": 0.35 },
  relatores: 9,
  // Média do real: 22,2 KB por registro. Relação curta (mediana 2,5 KB); a mediana da comum foi calibrada para a média
  // gerada ficar perto da real (20 a 24 KB por registro, conforme o ano).
  tamanho: { comum: { medianaBytes: 34_000, sigma: 0.9 }, relacao: { medianaBytes: 2_500, sigma: 0.5 }, tetoBytes: 2_000_000 },
  vocabulario: { pseudopalavras: 8_000, expoenteZipf: 1 },
  plantadas: { dragagem: 0.005, "sobrepreço": 0.08, "pregão eletrônico": 0.04 },
};

/** As consultas da bateria: o que cada uma exercita está no nome. */
export const CONSULTAS_TCU = [
  { nome: "seletiva", consulta: "dragagem" },
  { nome: "comum", consulta: "licitação contrato" },
  { nome: "vazia", consulta: "ornitorrinco" },
  { nome: "semAcento", consulta: "licitacao sobrepreco" },
  { nome: "aspas", consulta: '"pregão eletrônico"' },
  { nome: "filtros", consulta: "sobrepreço", filtros: { tipo: "ACÓRDÃO", colegiado: "Plenário" } },
] as const satisfies readonly { nome: string; consulta: string; filtros?: Record<string, string> }[];

/** Palavras comuns, da mais à menos frequente (posição no Zipf); nenhuma é termo plantado nem a consulta vazia. */
const COMUNS = (
  "de a o que e do da em para com não uma os no se na por mais as dos licitação contrato tribunal como ao das " +
  "processo unidade auditoria contas recurso responsável órgão foi ser à pela pelo sobre empresa valor serviço " +
  "termos ministério pregão análise obras fiscalização acórdão eletrônico relatório voto débito multa prazo " +
  "secretaria federal pagamento execução convênio recursos gestão contratação controle irregularidade defesa " +
  "citação audiência razões justificativa preço mercado edital proposta fornecimento medição aditivo projeto " +
  "básico engenharia orçamento planilha custo unitário tomada especial ressarcimento dano erário instrução " +
  "técnica representação denúncia cautelar suspensão determinação recomendação ciência arquivamento " +
  "monitoramento cumprimento embargos declaração reconsideração revisão julgamento regular irregular quitação " +
  "solidariedade inabilitação inidoneidade sanção dosimetria culpabilidade boa-fé prescrição pretensão punitiva"
).split(" ");

const SILABAS = [..."bcdfglmnprstv"].flatMap((c) => [..."aeiou"].map((v) => c + v));
const AVISO_DE_SIGILO = "Documento classificado como sigiloso (aviso fictício da bateria de velocidade).";

/** PRNG pequeno e determinístico (mulberry32). */
function aleatorio(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embaralhar<T>(xs: T[], rng: () => number): T[] {
  const r = [...xs];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Lognormal pela mediana (Box-Muller), com teto. */
function tamanho(d: Distribuicao, teto: number, rng: () => number): number {
  const normal = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return Math.min(teto, Math.round(d.medianaBytes * Math.exp(d.sigma * normal)));
}

interface Vocabulario {
  palavras: string[];
  acumulado: Float64Array;
}

function vocabulario(c: ComposicaoTcu): Vocabulario {
  const rng = aleatorio(c.semente);
  const palavras = new Set(COMUNS);
  while (palavras.size < COMUNS.length + c.vocabulario.pseudopalavras) {
    palavras.add(Array.from({ length: 2 + Math.floor(rng() * 3) }, () => SILABAS[Math.floor(rng() * SILABAS.length)]).join(""));
  }
  const lista = [...palavras];
  const acumulado = new Float64Array(lista.length);
  let soma = 0;
  lista.forEach((_, i) => (acumulado[i] = soma += 1 / (i + 1) ** c.vocabulario.expoenteZipf));
  return { palavras: lista, acumulado };
}

function sortearPalavra(v: Vocabulario, rng: () => number): number {
  const alvo = rng() * v.acumulado[v.acumulado.length - 1];
  let [lo, hi] = [0, v.acumulado.length - 1];
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (v.acumulado[meio] < alvo) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

/** Parágrafos em HTML até o tamanho pedido; os termos plantados entram, inteiros, num parágrafo sorteado. */
function textoHtml(
  bytes: number,
  v: Vocabulario,
  rng: () => number,
  usadas: Set<number>,
  plantar: string[] = [],
  entidade = false,
): string {
  const paragrafos: string[] = [];
  let total = 0;
  while (total < bytes || !paragrafos.length) {
    const palavras: string[] = [];
    for (let n = 40 + Math.floor(rng() * 80); n > 0; n--) {
      const i = sortearPalavra(v, rng);
      usadas.add(i);
      palavras.push(v.palavras[i]);
    }
    const p = `<p class="tCU_-_Rel/Voto_-_Corpo">${palavras.join(" ")}.</p>`;
    paragrafos.push(p);
    total += p.length + 1;
  }
  for (const termo of plantar) {
    const i = Math.floor(rng() * paragrafos.length);
    paragrafos[i] = paragrafos[i].replace(/>([^ ]+ )/, `>$1${termo} `);
  }
  return paragrafos.join(entidade ? "\n<p>&nbsp;</p>\n" : "\n");
}

const percentil = (ordenados: number[], p: number) => ordenados[Math.min(ordenados.length - 1, Math.floor(p * ordenados.length))];
const campo = (v = "") => `"${v.replaceAll('"', '""')}"`;

export interface ResumoDoAno {
  ano: number;
  registros: number;
  porTipo: Record<string, number>;
  porSituacao: Record<string, number>;
  avisosDeSigilo: number;
  comEntidadeHtml: number;
  plantadas: Record<string, number>;
  bytes: { total: number; porRegistro: { p10: number; mediana: number; p90: number; maximo: number } };
  vocabulario: { palavrasDistintas: number };
  sha256: string;
}

/** Um ano inteiro do TCU sintético, em memória, com o resumo da composição medido no que foi gerado. */
export function gerarAnoTcu(ano: number, c: ComposicaoTcu): { csv: string; resumo: ResumoDoAno } {
  const v = vocabulario(c);
  const rng = aleatorio(c.semente ^ (ano * 2654435761));
  const n = c.registrosPorAno;
  const contar = (fracao: number) => Math.max(1, Math.round(fracao * n));
  const indices = Array.from({ length: n }, (_, i) => i);

  const relacao = new Set(embaralhar(indices, rng).slice(0, Math.round(c.fracaoRelacao * n)));
  const porSituacao = embaralhar(indices, rng);
  const invalidados = new Set(porSituacao.slice(0, contar(c.fracaoInvalidado)));
  const sigilosos = new Set(porSituacao.slice(invalidados.size, invalidados.size + contar(c.fracaoSigiloso)));
  const oficializados = indices.filter((i) => !invalidados.has(i) && !sigilosos.has(i));
  const avisos = new Set(embaralhar(oficializados.filter((i) => !relacao.has(i)), rng).slice(0, contar(c.fracaoAvisoDeSigilo)));
  const comTexto = oficializados.filter((i) => !avisos.has(i));
  const plantadasEm = Object.fromEntries(
    Object.entries(c.plantadas).map(([termo, f]) => [termo, new Set(embaralhar(comTexto, rng).slice(0, contar(f)))]),
  );
  const entidades = new Set(embaralhar(indices, rng).slice(0, Math.round(c.fracaoComEntidadeHtml * n)));
  const colegiados = Object.entries(c.colegiados);

  const usadas = new Set<number>();
  const tamanhos: number[] = [];
  const linhas = [COLUNAS_TCU.map((x) => campo(x)).join("|")];
  const porTipo: Record<string, number> = {};
  const situacoes: Record<string, number> = {};
  for (const i of indices) {
    const ehRelacao = relacao.has(i);
    const tipo = ehRelacao ? "ACÓRDÃO DE RELAÇÃO" : "ACÓRDÃO";
    const situacao = invalidados.has(i) ? "INVALIDADO" : sigilosos.has(i) ? "SIGILOSO" : "OFICIALIZADO";
    porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;
    situacoes[situacao] = (situacoes[situacao] ?? 0) + 1;
    let x = rng();
    const colegiado = colegiados.find(([, f]) => (x -= f) < 0)?.[0] ?? colegiados[0][0];
    const plantar = Object.keys(plantadasEm).filter((t) => plantadasEm[t].has(i));
    const entidade = entidades.has(i);
    const alvo = tamanho(ehRelacao ? c.tamanho.relacao : c.tamanho.comum, c.tamanho.tetoBytes, rng);
    const texto = (fracao: number, termos: string[] = []) => textoHtml(Math.round(alvo * fracao), v, rng, usadas, termos, entidade);
    const dia = 1 + Math.floor(rng() * 365);
    const data = new Date(Date.UTC(ano, 0, dia));
    const numero = String(i + 1);
    const r: RegistroTcu = {
      KEY: `ACORDAO-COMPLETO-SINTETICO-${ano}-${numero}`,
      TIPO: tipo,
      TITULO: `${tipo} ${numero}/${ano} ATA ${1 + Math.floor(dia / 7)}/${ano} - ${colegiado.toUpperCase()}`,
      NUMACORDAO: numero,
      ANOACORDAO: String(ano),
      NUMATA: `${1 + Math.floor(dia / 7)}/${ano}`,
      COLEGIADO: colegiado,
      DATASESSAO: data.toLocaleDateString("pt-BR", { timeZone: "UTC" }),
      RELATOR: `MINISTRO FICTICIO ${String.fromCharCode(65 + Math.floor(rng() * c.relatores))}`,
      SITUACAO: situacao,
      PROC: `TC SINTETICO ${numero}/${ano}`,
      TIPOPROCESSO: ehRelacao ? "ACOMPANHAMENTO" : "REPRESENTAÇÃO",
      INTERESSADOS: "INTERESSADO FICTICIO",
      ADVOGADO: "ADVOGADO FICTICIO",
      ASSUNTO: textoHtml(60, v, rng, usadas).replace(/<[^>]+>/g, ""),
      ...(ehRelacao
        ? { ACORDAO: texto(1, plantar) }
        : {
            SUMARIO: avisos.has(i) ? AVISO_DE_SIGILO : texto(0.03),
            ACORDAO: texto(0.1),
            RELATORIO: avisos.has(i) ? AVISO_DE_SIGILO : texto(0.6, plantar),
            VOTO: texto(0.27),
          }),
    };
    const linha = COLUNAS_TCU.map((col) => campo(r[col])).join("|");
    tamanhos.push(Buffer.byteLength(linha) + 1);
    linhas.push(linha);
  }
  const csv = linhas.join("\n") + "\n";
  const ordenados = [...tamanhos].sort((a, b) => a - b);
  return {
    csv,
    resumo: {
      ano,
      registros: n,
      porTipo,
      porSituacao: situacoes,
      avisosDeSigilo: avisos.size,
      comEntidadeHtml: entidades.size,
      plantadas: Object.fromEntries(Object.entries(plantadasEm).map(([t, s]) => [t, s.size])),
      bytes: {
        total: Buffer.byteLength(csv),
        porRegistro: {
          p10: percentil(ordenados, 0.1),
          mediana: percentil(ordenados, 0.5),
          p90: percentil(ordenados, 0.9),
          maximo: ordenados[ordenados.length - 1],
        },
      },
      vocabulario: { palavrasDistintas: usadas.size },
      sha256: createHash("sha256").update(csv).digest("hex"),
    },
  };
}

/** Grava os anos na pasta de dados do TCU, como o baixador deixa (CSV e recibo), e devolve a composição de cada um. */
export async function gravarTcuSintetico(
  dados: string,
  c: ComposicaoTcu = COMPOSICAO_TCU,
): Promise<{ composicao: ComposicaoTcu; anos: ResumoDoAno[] }> {
  const pasta = join(dados, "tcu");
  await mkdir(pasta, { recursive: true });
  const anos: ResumoDoAno[] = [];
  for (const ano of c.anos) {
    const { csv, resumo } = gerarAnoTcu(ano, c);
    await writeFile(join(pasta, `acordao-completo-${ano}.csv`), csv, "utf8");
    const recibo = {
      ano,
      url: `https://exemplo.invalid/tcu-sintetico/acordao-completo-${ano}.csv`,
      bytes: resumo.bytes.total,
      sha256: resumo.sha256,
      lastModified: "Thu, 01 Oct 2026 00:00:00 GMT",
      baixadoEm: "2026-10-23T00:00:00.000Z",
    };
    await writeFile(join(pasta, `acordao-completo-${ano}.recibo.json`), JSON.stringify(recibo), "utf8");
    anos.push(resumo);
  }
  return { composicao: c, anos };
}
