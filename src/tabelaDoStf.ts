/**
 * Tabela de precedentes do STF (ADR-0015, decisão do dono de 2026-10-09): fotografia datada dos temas de repercussão
 * geral (exportação "Exportar Dados" da tela "Todos os temas", feita pelo mantenedor no navegador) e das súmulas e
 * súmulas vinculantes (telas do portal do STF salvas pelo mantenedor), gerada por scripts/gerarTabelaStf.ts e
 * empacotada em dados/. Sem licença do STF: o fundamento declarado é a Lei 9.610/98, art. 8º, IV.
 * A consulta é pura: sem rede nem disco (a tabela é lida uma vez, no primeiro uso).
 */

import { readFileSync } from "node:fs";
import { enquadrarQualificado, type ReforcoDaTabela } from "./enquadramento.js";

/** Rótulos que o Garimpo dá às listas do site para o STF; os mesmos aqui. */
export type TipoNoStf = "repercussão geral" | "súmula" | "súmula vinculante";

export const TIPOS_NO_STF: readonly TipoNoStf[] = ["repercussão geral", "súmula", "súmula vinculante"];

export const ATRIBUICAO_STF =
  "Fonte: STF — portal do STF (exportação \"Todos os temas\" de repercussão geral e telas de súmulas e súmulas " +
  "vinculantes), obtidos pelo mantenedor do Garimpo no navegador";

/** Texto literal conferido no planalto.gov.br em 2026-10-09. */
export const FUNDAMENTO_STF =
  'Lei 9.610/98, art. 8º, IV: "os textos de tratados ou convenções, leis, decretos, regulamentos, decisões judiciais ' +
  'e demais atos oficiais" não são objeto de proteção como direitos autorais. O STF não publica termo de uso nem ' +
  "licença para estes dados (não encontrado em 2026-10-09).";

export const PAGINAS_DO_STF: Record<TipoNoStf, string> = {
  "repercussão geral": "https://portal.stf.jus.br/jurisprudenciaRepercussao/todostemas.asp",
  súmula: "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=30",
  "súmula vinculante": "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26",
};

/** Uma linha da tabela do STF: campos copiados da fonte; campo que a fonte não preenche fica de fora. */
export interface LinhaDoStf {
  tipo: TipoNoStf;
  numero: number;
  /** RG: "Situação do Tema"; súmula: a marca entre parênteses no rótulo da lista ("cancelada"…), se houver. */
  situacao?: string;
  /** RG: "Tese". */
  teseFirmada?: string;
  /** Súmula: o enunciado da página da súmula, quando o mantenedor a salvou. */
  enunciado?: string;
  /** RG: "Leading Case". */
  processosParadigma?: string[];
  relator?: string;
  titulo?: string;
  haRepercussao?: string;
  dataJulgamento?: string;
  dataTese?: string;
  /** Súmula: a página dela no portal do STF. */
  link?: string;
}

export type ParteDoStf = TipoNoStf | "página de súmula";

export interface TabelaDoStf {
  fonte: { tribunal: "STF"; paginas: Record<TipoNoStf, string> };
  atribuicao: string;
  fundamento: string;
  /** Cada arquivo que o mantenedor salvou: a parte, o nome, quando foi obtido (data do arquivo) e o sha256. */
  arquivos: { parte: ParteDoStf; nome: string; obtidoEm: string; sha256: string }[];
  /** Partes sem arquivo nesta versão: delas a tabela não tem nenhuma linha. */
  partesAusentes: TipoNoStf[];
  geradaEm: string;
  versaoDoGerador: string;
  transformacaoDosTextos: string;
  linhas: LinhaDoStf[];
}

let empacotada: TabelaDoStf | undefined;

/** A tabela do STF que vai no pacote (dados/, ao lado de src/ e de dist/). */
export function tabelaDoStfEmpacotada(): TabelaDoStf {
  return (empacotada ??= JSON.parse(
    readFileSync(new URL("../dados/tabela-precedentes-stf.json", import.meta.url), "utf8"),
  ) as TabelaDoStf);
}

/** Instante (ISO) em que o mantenedor obteve o arquivo da lista do tipo; undefined se a parte faltou. */
function obtencao(t: TabelaDoStf, tipo: TipoNoStf): string | undefined {
  return t.arquivos.find((a) => a.parte === tipo)?.obtidoEm;
}

/** Data da tabela para o tipo: o dia (UTC) em que o mantenedor obteve o arquivo da lista daquele tipo. */
export function dataDaTabelaStf(t: TabelaDoStf, tipo: TipoNoStf): string {
  return (obtencao(t, tipo) ?? t.geradaEm).slice(0, 10);
}

export const DIAS_PARA_AVISO_STF = 90;

/** O que acompanha toda resposta que usa a tabela do STF: atribuição, fundamento, datas e o aviso de idade. */
export function sobreATabelaDoStf(t: TabelaDoStf, tipo: TipoNoStf, agora: number, { curta = false } = {}) {
  const data = dataDaTabelaStf(t, tipo);
  const dias = Math.max(0, Math.floor((agora - Date.parse(obtencao(t, tipo) ?? t.geradaEm)) / 86_400_000));
  return {
    atribuicao: t.atribuicao,
    fundamento: t.fundamento,
    dataDaObtencao: data,
    ...(curta ? {} : { paginaDaFonte: t.fonte.paginas[tipo], tabelaGeradaEm: t.geradaEm, idadeDaTabela: `${dias} dias` }),
    ...(dias > DIAS_PARA_AVISO_STF
      ? {
          avisoDeIdade:
            `A tabela do STF tem mais de ${DIAS_PARA_AVISO_STF} dias (${dias} dias, contados de ${data}): a situação e ` +
            "o texto podem ter mudado no STF. Confira no portal do STF antes de citar.",
        }
      : {}),
  };
}

/** A linha do tipo e número pedidos, ou undefined. Casamento exato do tipo. */
export function acharNoStf(t: TabelaDoStf, tipo: TipoNoStf, numero: number): LinhaDoStf | undefined {
  return t.linhas.find((l) => l.tipo === tipo && l.numero === numero);
}

const ehSumula = (tipo: TipoNoStf) => tipo !== "repercussão geral";

/** Resposta do consultar_precedente para o STF: a linha com rótulos claros, ou "não consta", com origem e datas. */
export function consultarPrecedenteStf(t: TabelaDoStf, tipo: TipoNoStf, numero: number, agora: number) {
  const data = dataDaTabelaStf(t, tipo);
  const sobre = sobreATabelaDoStf(t, tipo, agora);
  const linha = acharNoStf(t, tipo, numero);
  if (!linha) {
    const resultado = t.partesAusentes.includes(tipo)
      ? `a tabela do STF desta versão do Garimpo não tem ${tipo === "repercussão geral" ? "os temas de repercussão geral" : `as listas de ${tipo}`}: ` +
        "o mantenedor ainda não obteve o arquivo do STF. Isso não diz nada sobre o precedente: confira no portal do STF."
      : `não consta na tabela do STF de ${data}: pode ser posterior a essa fotografia ou o número estar errado. Estar ` +
        "fora desta fotografia não quer dizer estar fora do STF: confira no portal do STF.";
    return { tribunal: "stf", tipo, numero, consta: false, resultado, tabela: sobre };
  }
  const situacao = ehSumula(tipo)
    ? {
        situacaoNaFonte: linha.situacao
          ? `marcada como "${linha.situacao}" na lista do STF`
          : "sem marca de situação na lista do STF",
        situacaoEm:
          `lista do STF em ${data}: a marca é o rótulo entre parênteses da lista, não vigência; a falta de marca não ` +
          "prova que a súmula está em vigor (não verificado se a marca cobre todas as súmulas superadas ou canceladas)",
      }
    : {
        situacaoNaFonte: linha.situacao ?? "situação não informada pela fonte",
        situacaoEm: `situação no STF em ${data} (obtenção da tabela), como a fonte a escreve: é situação processual, não vigência`,
      };
  return {
    tribunal: "stf",
    tipo,
    numero,
    consta: true,
    ...situacao,
    ...(ehSumula(tipo)
      ? { enunciado: linha.enunciado ?? "enunciado não incluído na tabela: abra a página da súmula no link" }
      : { teseFirmada: linha.teseFirmada ?? "sem tese na tabela" }),
    ...(linha.titulo ? { titulo: linha.titulo, notaTitulo: "título do tema: descreve a questão, não é a tese" } : {}),
    ...(linha.haRepercussao ? { haRepercussao: linha.haRepercussao } : {}),
    ...(linha.relator ? { relator: linha.relator } : {}),
    ...(linha.dataJulgamento ? { dataJulgamento: linha.dataJulgamento } : {}),
    ...(linha.dataTese ? { dataTese: linha.dataTese } : {}),
    ...(tipo === "repercussão geral"
      ? { processoParadigma: linha.processosParadigma ?? "processo paradigma não informado pela tabela" }
      : {}),
    ...(linha.link ? { link: linha.link } : {}),
    enquadramento927: enquadrarQualificado(
      { tribunal: "stf", tipo, numero: String(numero), tese: linha.teseFirmada },
      { tribunal: "stf", data, linha, consulta: true },
    ),
    tabela: sobre,
  };
}

/**
 * O reforço da tabela do STF para um item das listas de qualificados do site: só repercussão geral, súmula e súmula
 * vinculante do STF com número inteiro, e só se a tabela tem a parte daquele tipo (tabela vazia não gera ruído).
 */
export function reforcoDoStf(
  t: TabelaDoStf | undefined,
  tribunal: string,
  tipo: string,
  numero: string | undefined,
): ReforcoDaTabela | undefined {
  const doTipo = TIPOS_NO_STF.find((x) => x === tipo);
  if (!t || tribunal !== "stf" || !doTipo || t.partesAusentes.includes(doTipo)) return undefined;
  if (!numero || !/^\d+$/.test(numero.trim())) return undefined;
  return { tribunal: "stf", data: dataDaTabelaStf(t, doTipo), linha: acharNoStf(t, doTipo, Number(numero)) };
}
