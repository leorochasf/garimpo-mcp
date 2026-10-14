/**
 * TCU (ADR-0025), parte local: arquivos já baixados, recibo, pesquisa e leitura sob pedido. Sem rede.
 * Nunca guarda nem devolve INTERESSADOS e ADVOGADO (o leitor de CSV já os descarta).
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { filtroLocal } from "./filtroLocal.js";
import { htmlParaTexto } from "./html.js";
import { blocosDoArquivo, lerRegistrosTcu } from "./tcu.js";

/** O que fica ao lado do CSV de cada ano: de onde veio, quando e com que hash. */
export interface ReciboTcu {
  ano: number;
  url: string;
  bytes: number;
  sha256: string;
  etag?: string;
  /** `Last-Modified` do TCU: a data da base, do lado do TCU. */
  lastModified?: string;
  /** ISO, de quando o usuário baixou. */
  baixadoEm: string;
  /** Data da lista do TCU na hora do download (dd/mm/aaaa). */
  listaEm?: string;
}

export const pastaDoTcu = (dados: string) => join(dados, "tcu");
export const caminhoDoAnoTcu = (dados: string, ano: number) => join(pastaDoTcu(dados), `acordao-completo-${ano}.csv`);
export const caminhoDoReciboTcu = (dados: string, ano: number) => join(pastaDoTcu(dados), `acordao-completo-${ano}.recibo.json`);

export async function lerReciboTcu(dados: string, ano: number): Promise<ReciboTcu | undefined> {
  try {
    const r = JSON.parse(await readFile(caminhoDoReciboTcu(dados, ano), "utf8")) as ReciboTcu;
    return r && r.ano === ano && typeof r.baixadoEm === "string" ? r : undefined;
  } catch {
    return undefined;
  }
}

/** Anos com arquivo completo na pasta (os `.parcial` não contam). */
export async function anosBaixadosTcu(dados: string): Promise<number[]> {
  try {
    return (await readdir(pastaDoTcu(dados)))
      .flatMap((n) => n.match(/^acordao-completo-(\d{4})\.csv$/)?.[1] ?? [])
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export interface BaseDoAno {
  ano: number;
  /** Data da base no TCU (`Last-Modified`), ou "não informada" se o arquivo veio sem recibo. */
  atualizadoNoTcuEm: string;
  baixadoEm: string;
}

async function baseDoAno(dados: string, ano: number): Promise<BaseDoAno> {
  const r = await lerReciboTcu(dados, ano);
  return { ano, atualizadoNoTcuEm: r?.lastModified ?? "não informada", baixadoEm: r?.baixadoEm ?? "não informada" };
}

export const ATRIBUICAO_TCU =
  "Fonte: Tribunal de Contas da União, dados abertos do TCU (arquivos anuais de acórdãos), baixados pelo usuário; cite " +
  'como "TCU, Acórdão N/AAAA – Colegiado, relator X; dados abertos do TCU, base de <data>". Sumário do TCU não é ementa. ' +
  "Confira no portal do TCU antes de citar.";

// ---------------------------------------------------------------------------------------------------------------
// Pesquisa local
// ---------------------------------------------------------------------------------------------------------------

const ATE_TRECHO = 100;
const TAMANHO_SUMARIO = 600;
const LIMITE_PADRAO = 10;
const LIMITE_MAXIMO = 50;
const CAMPOS_DE_TEXTO = ["TITULO", "ASSUNTO", "SUMARIO", "ACORDAO", "DECISAO", "RELATORIO", "VOTO"] as const;
const SITUACAO_SEM_TEXTO = /invalidad|sigilos/;
const ENTIDADE_ACENTUADA = /&(?:[a-zA-Z]+(?:acute|grave|circ|tilde|cedil|uml|ordm|ordf);|#\d+;|#x[0-9a-fA-F]+;)/;
const SEM_ACENTO =(t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Aviso que o TCU grava no lugar de sumário, relatório ou voto classificados como sigilosos (art. 108, § 1º, Lei 8.443/1992). */
const AVISO_DE_SIGILO = /^Documento classificado como sigiloso/i;
const TAMANHO_MAXIMO_DO_AVISO = 600;
export type ParteSigilosa = "sumario" | "relatorio" | "voto";

/** Texto limpo do campo; o aviso de sigilo do TCU não é conteúdo e vira vazio (a parte é dada como sigilosa). */
function textoDoCampo(r: Record<string, string>, coluna: string): { texto: string; sigiloso: boolean } {
  const texto = htmlParaTexto(r[coluna] ?? "");
  const sigiloso = texto.length < TAMANHO_MAXIMO_DO_AVISO && AVISO_DE_SIGILO.test(texto);
  return { texto: sigiloso ? "" : texto, sigiloso };
}

export const linkOficialTcu = (chave: string) => `https://pesquisa.apps.tcu.gov.br/redireciona/acordao-completo/${chave}`;

export interface FiltrosTcu {
  consulta: string;
  anos?: number[];
  tipo?: string;
  colegiado?: string;
  relator?: string;
  limite?: number;
}

export interface AcordaoTcu {
  chave: string;
  numero: string;
  ano: string;
  titulo: string;
  colegiado: string;
  dataSessao: string;
  relator: string;
  tipo: string;
  situacao: string;
  /** Resumo do TCU (campo SUMARIO): sumário, nunca ementa. */
  sumario: string;
  trechos: string[];
  /** Só o acórdão comum traz relatório e voto; o de relação traz só o texto. Falso também se o TCU os classificou como sigilosos. */
  temRelatorioEVoto: boolean;
  /** Partes que o TCU substituiu pelo aviso de documento sigiloso (o acórdão continua listado com o texto ACORDAO). */
  partesSigilosas?: ParteSigilosa[];
  linkOficial: string;
}

export interface ResultadoTcu {
  total: number;
  resultados: AcordaoTcu[];
  anosUsados: BaseDoAno[];
  anosSemArquivo: number[];
  /** Registros INVALIDADO ou sigilosos ignorados nos anos pesquisados. */
  excluidosPorSituacao: number;
  /** Quantos arquivos anuais foram varridos e em quanto tempo: cada pesquisa lê os anos inteiros. */
  anosPercorridos: number;
  tempoSegundos: number;
  /** O texto oficial cita nomes de pessoas no corpo; o Garimpo não os retira. */
  avisoNomes: string;
  atribuicao: string;
  aviso?: string;
}

/** Palavras soltas e frases entre aspas. */
function termosDe(consulta: string): string[] {
  return [...consulta.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
}

/** dd/mm/aaaa (ou ISO) → número ordenável; sem data = 0. */
function ordemDaData(d: string): number {
  const br = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return Number(br[3] + br[2] + br[1]);
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? Number(iso[1] + iso[2] + iso[3]) : 0;
}

/** Até dois trechos em volta da primeira ocorrência dos dois primeiros termos. */
function trechosDe(texto: string, termos: string[]): string[] {
  const plano = texto.replace(/\s+/g, " ");
  const baixo = SEM_ACENTO(plano);
  const trechos: string[] = [];
  for (const termo of termos.slice(0, 2)) {
    const i = baixo.indexOf(SEM_ACENTO(termo));
    if (i < 0) continue;
    const de = Math.max(0, i - ATE_TRECHO);
    const ate = Math.min(plano.length, i + termo.length + ATE_TRECHO);
    const trecho = `${de > 0 ? "…" : ""}${plano.slice(de, ate).trim()}${ate < plano.length ? "…" : ""}`;
    if (!trechos.includes(trecho)) trechos.push(trecho);
  }
  return trechos;
}

const recorte = (t: string, max: number) => (t.length > max ? `${t.slice(0, max).trimEnd()}…` : t);

/** Pesquisa nos anos já baixados, em fluxo (um registro na memória por vez), sem rede. */
export async function pesquisarTcu(dados: string, f: FiltrosTcu): Promise<ResultadoTcu> {
  const locais = await anosBaixadosTcu(dados);
  const pedidos = f.anos?.length ? [...new Set(f.anos)] : locais;
  const anos = pedidos.filter((a) => locais.includes(a)).sort((a, b) => a - b);
  const vazio: ResultadoTcu = {
    total: 0, resultados: [], anosUsados: [], anosSemArquivo: pedidos.filter((a) => !locais.includes(a)),
    excluidosPorSituacao: 0, anosPercorridos: 0, tempoSegundos: 0, avisoNomes: AVISO_NOMES, atribuicao: ATRIBUICAO_TCU,
  };
  if (!anos.length) {
    return { ...vazio, aviso: "Nenhum ano do TCU baixado neste computador. Use baixar_anos_tcu para ver os anos e escolher quais baixar." };
  }
  const inicio = Date.now();
  const termos = termosDe(f.consulta);
  if (!termos.length) return { ...vazio, anosUsados: await Promise.all(anos.map((a) => baseDoAno(dados, a))), aviso: "Consulta vazia." };
  const passa = filtroLocal({ deveConter: termos.map((t) => [t]) })!;
  const palavras = termos.flatMap((t) => t.split(/\s+/)).map(SEM_ACENTO).filter(Boolean);
  const limite = Math.min(Math.max(f.limite ?? LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  const tipo = f.tipo && SEM_ACENTO(f.tipo.trim());
  const colegiado = f.colegiado && SEM_ACENTO(f.colegiado.trim());
  const relator = f.relator && SEM_ACENTO(f.relator.trim());

  let total = 0;
  let excluidos = 0;
  const melhores: { ordem: [number, number]; acordao: AcordaoTcu }[] = [];

  for (const ano of anos) {
    for await (const r of lerRegistrosTcu(blocosDoArquivo(caminhoDoAnoTcu(dados, ano)))) {
      if (SITUACAO_SEM_TEXTO.test(SEM_ACENTO(r.SITUACAO ?? ""))) {
        excluidos++;
        continue;
      }
      if (tipo && SEM_ACENTO(r.TIPO ?? "") !== tipo) continue;
      if (colegiado && !SEM_ACENTO(r.COLEGIADO ?? "").includes(colegiado)) continue;
      if (relator && !SEM_ACENTO(r.RELATOR ?? "").includes(relator)) continue;
      // Triagem barata no texto bruto: palavra ausente descarta o registro sem limpar o HTML. Acento escrito como
      // entidade (&ccedil;) engana a triagem: nesses registros vale só a conferência completa.
      const bruto = CAMPOS_DE_TEXTO.map((c) => r[c] ?? "").join("\n");
      if (!ENTIDADE_ACENTUADA.test(bruto)) {
        const baixo = SEM_ACENTO(bruto);
        if (!palavras.every((p) => baixo.includes(p))) continue;
      }
      const sigilosas: ParteSigilosa[] = [];
      const texto = CAMPOS_DE_TEXTO.map((c) => {
        const { texto: t, sigiloso } = textoDoCampo(r, c);
        if (sigiloso) sigilosas.push(c.toLowerCase() as ParteSigilosa);
        return t;
      })
        .filter(Boolean)
        .join("\n");
      if (!passa(texto)) continue;
      total++;
      const ordem: [number, number] = [ordemDaData(r.DATASESSAO ?? ""), Number(r.NUMACORDAO) || 0];
      const pior = melhores[melhores.length - 1];
      if (melhores.length >= limite && (ordem[0] < pior.ordem[0] || (ordem[0] === pior.ordem[0] && ordem[1] <= pior.ordem[1]))) continue;
      melhores.push({
        ordem,
        acordao: {
          chave: r.KEY, numero: r.NUMACORDAO, ano: r.ANOACORDAO, titulo: r.TITULO, colegiado: r.COLEGIADO,
          dataSessao: r.DATASESSAO, relator: r.RELATOR, tipo: r.TIPO, situacao: r.SITUACAO,
          sumario: recorte(textoDoCampo(r, "SUMARIO").texto, TAMANHO_SUMARIO),
          trechos: trechosDe(texto, termos),
          temRelatorioEVoto: Boolean(textoDoCampo(r, "RELATORIO").texto && textoDoCampo(r, "VOTO").texto),
          ...(sigilosas.length ? { partesSigilosas: sigilosas } : {}),
          linkOficial: linkOficialTcu(r.KEY),
        },
      });
      melhores.sort((a, b) => b.ordem[0] - a.ordem[0] || b.ordem[1] - a.ordem[1]);
      melhores.length = Math.min(melhores.length, limite);
    }
  }
  return {
    ...vazio,
    total,
    resultados: melhores.map((m) => m.acordao),
    anosUsados: await Promise.all(anos.map((a) => baseDoAno(dados, a))),
    excluidosPorSituacao: excluidos,
    anosPercorridos: anos.length,
    tempoSegundos: Math.round((Date.now() - inicio) / 100) / 10,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Leitura sob pedido
// ---------------------------------------------------------------------------------------------------------------

export type ParteTcu = "acordao" | "relatorio" | "voto" | "decisao" | "sumario";
const COLUNA_DA_PARTE: Record<ParteTcu, string> = {
  acordao: "ACORDAO", relatorio: "RELATORIO", voto: "VOTO", decisao: "DECISAO", sumario: "SUMARIO",
};
const TAMANHO_PAGINA = 30_000;
const AVISO_NOMES = "O texto oficial do TCU pode citar nomes de pessoas no corpo; o Garimpo não os retira.";

export interface PedidoDeLeituraTcu {
  ano: number;
  chave?: string;
  numero?: string;
  colegiado?: string;
  parte: ParteTcu;
  pagina?: number;
}

export interface LeituraTcu {
  encontrado: boolean;
  identificacao?: Pick<AcordaoTcu, "chave" | "numero" | "ano" | "titulo" | "colegiado" | "dataSessao" | "relator" | "tipo" | "linkOficial">;
  situacao?: string;
  parte: ParteTcu;
  pagina?: number;
  totalPaginas?: number;
  texto?: string;
  aviso?: string;
  base?: BaseDoAno;
  atribuicao: string;
}

/** Parágrafos juntados até o tamanho da página; parágrafo maior que a página é fatiado. */
function paginar(texto: string): string[] {
  const paginas: string[] = [];
  let atual = "";
  for (const par of texto.split("\n")) {
    for (let i = 0; i < Math.max(par.length, 1); i += TAMANHO_PAGINA) {
      const parte = par.slice(i, i + TAMANHO_PAGINA);
      if (atual && atual.length + parte.length + 1 > TAMANHO_PAGINA) {
        paginas.push(atual);
        atual = parte;
      } else atual = atual ? `${atual}\n${parte}` : parte;
    }
  }
  if (atual) paginas.push(atual);
  return paginas;
}

export async function lerAcordaoTcu(dados: string, p: PedidoDeLeituraTcu): Promise<LeituraTcu> {
  const base = { parte: p.parte, atribuicao: ATRIBUICAO_TCU };
  if (!(await anosBaixadosTcu(dados)).includes(p.ano)) {
    return { ...base, encontrado: false, aviso: `O ano ${p.ano} do TCU não está baixado neste computador. Use baixar_anos_tcu.` };
  }
  if (!p.chave && !(p.numero && p.colegiado)) {
    return { ...base, encontrado: false, aviso: "Informe a chave do acórdão ou o número e o colegiado." };
  }
  const colegiado = p.colegiado && SEM_ACENTO(p.colegiado.trim());
  for await (const r of lerRegistrosTcu(blocosDoArquivo(caminhoDoAnoTcu(dados, p.ano)))) {
    const ehEsse = p.chave ? r.KEY === p.chave : r.NUMACORDAO === p.numero && SEM_ACENTO(r.COLEGIADO ?? "") === colegiado;
    if (!ehEsse) continue;
    const identificacao = {
      chave: r.KEY, numero: r.NUMACORDAO, ano: r.ANOACORDAO, titulo: r.TITULO, colegiado: r.COLEGIADO,
      dataSessao: r.DATASESSAO, relator: r.RELATOR, tipo: r.TIPO, linkOficial: linkOficialTcu(r.KEY),
    };
    const comum = { ...base, encontrado: true, identificacao, situacao: r.SITUACAO, base: await baseDoAno(dados, p.ano) };
    if (SITUACAO_SEM_TEXTO.test(SEM_ACENTO(r.SITUACAO ?? ""))) {
      return { ...comum, aviso: `Acórdão com situação ${r.SITUACAO}: o Garimpo não mostra o texto. Confira no portal do TCU.` };
    }
    const { texto, sigiloso } = textoDoCampo(r, COLUNA_DA_PARTE[p.parte]);
    if (sigiloso) {
      return {
        ...comum,
        aviso:
          "Relatório, voto e sumário deste acórdão foram classificados como sigilosos pelo TCU: o arquivo traz só o aviso de " +
          'sigilo no lugar do texto. O texto do acórdão (parte "acordao") continua disponível.',
      };
    }
    if (!texto) {
      const relacao = /rela[cç][aã]o/i.test(r.TIPO ?? "") && p.parte !== "acordao";
      return {
        ...comum,
        aviso: relacao
          ? `Acórdão de relação não tem ${p.parte}: traz só o texto do acórdão (parte "acordao").`
          : `O arquivo do TCU não traz ${p.parte} para este acórdão.`,
      };
    }
    const paginas = paginar(texto);
    const pagina = Math.min(Math.max(p.pagina ?? 1, 1), paginas.length);
    return {
      ...comum,
      pagina,
      totalPaginas: paginas.length,
      texto: paginas[pagina - 1],
      ...(p.parte === "voto" || p.parte === "relatorio" || p.parte === "acordao" ? { aviso: AVISO_NOMES } : {}),
    };
  }
  return { ...base, encontrado: false, aviso: `Não achei esse acórdão no arquivo baixado de ${p.ano}.` };
}
