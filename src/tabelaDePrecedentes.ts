/**
 * Tabela de precedentes (ADR-0015): fotografia datada dos temas repetitivos e IAC do conjunto "Precedentes
 * qualificados" do Portal de Dados Abertos do STJ, gerada por scripts/gerarTabela.ts e empacotada em dados/.
 * A consulta é pura: sem rede nem disco (a tabela é lida uma vez, no primeiro uso).
 */

import { readFileSync } from "node:fs";
import { enquadrarQualificado, type ReforcoDaTabela } from "./enquadramento.js";

/** Rótulos que o Garimpo dá às listas do site; os mesmos aqui, para Tema N e IAC N nunca se trocarem. */
export type TipoNaTabela = "tema repetitivo" | "IAC";

export const TIPOS_NA_TABELA: readonly TipoNaTabela[] = ["tema repetitivo", "IAC"];

export const ATRIBUICAO = "Fonte: STJ — Portal de Dados Abertos, conjunto Precedentes qualificados";

/** Uma linha da tabela: campos copiados da fonte; campo que a fonte não preenche fica de fora. */
export interface LinhaDaTabela {
  tipo: TipoNaTabela;
  numero: number;
  situacao?: string;
  teseFirmada?: string;
  questaoSubmetida?: string;
  orgaoJulgador?: string;
  dataPrimeiraAfetacao?: string;
  dataJulgamento?: string;
  dataPublicacaoAcordao?: string;
  /** Processos paradigma, só quando a fonte os identifica com segurança (leadingCase, sem desafetados). */
  processosParadigma?: string[];
  sumulaOriginada?: string;
  referenciaSumular?: string;
  /** Temas de repercussão geral do STF ligados (a fonte repete a linha do tema uma vez por número). */
  numerosRepercussaoGeralSTF?: string[];
}

export interface TabelaDePrecedentes {
  fonte: { conjunto: string; portal: string; pagina: string };
  atribuicao: string;
  /** Licença como a página do conjunto a declara, e quando foi conferida. */
  licenca: { declarada: string; conferidaEm: string };
  /** Texto literal "Última Atualização …" da página do conjunto, ou "não informada". */
  atualizacaoDaFonte: { texto: string; pagina: string };
  arquivos: { url: string; coletadoEm: string; sha256: string }[];
  /** Quando a tabela foi gerada (distinta da coleta e da atualização da fonte). */
  geradaEm: string;
  versaoDoGerador: string;
  transformacaoDosTextos: string;
  linhas: LinhaDaTabela[];
}

let empacotada: TabelaDePrecedentes | undefined;

/** A tabela que vai no pacote (dados/, ao lado de src/ e de dist/). */
export function tabelaEmpacotada(): TabelaDePrecedentes {
  return (empacotada ??= JSON.parse(
    readFileSync(new URL("../dados/tabela-precedentes-stj.json", import.meta.url), "utf8"),
  ) as TabelaDePrecedentes);
}

/** Instante (ISO) da coleta do temas.csv, de onde saem as linhas; sem ele, o da geração da tabela. */
function coletaDosTemas(t: TabelaDePrecedentes): string {
  return t.arquivos.find((a) => a.url.endsWith("/temas.csv"))?.coletadoEm ?? t.geradaEm;
}

/** Data da tabela: o dia (UTC) da coleta do temas.csv. */
export function dataDaTabela(t: TabelaDePrecedentes): string {
  return coletaDosTemas(t).slice(0, 10);
}

export const DIAS_PARA_AVISO = 90;

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "Última Atualização outubro 8, 2026, 17:25 (UTC)" → instante; qualquer outra forma é ambígua (undefined). */
function instanteDaAtualizacao(texto: string): number | undefined {
  const m = texto.match(/^Última Atualização (\p{L}+) (\d{1,2}), (\d{4}), (\d{2}):(\d{2}) \(UTC\)$/u);
  const mes = m ? MESES.indexOf(m[1]) : -1;
  if (!m || mes < 0) return undefined;
  return Date.UTC(Number(m[3]), mes, Number(m[2]), Number(m[4]), Number(m[5]));
}

/**
 * O que acompanha toda resposta que usa a tabela: atribuição, licença, datas e, se for o caso, o aviso de idade.
 * A forma curta (busca ampla, teto de 25 mil caracteres) deixa de fora a página, a data da geração e a idade.
 */
export function sobreATabela(t: TabelaDePrecedentes, agora: number, { curta = false } = {}) {
  const atualizada = instanteDaAtualizacao(t.atualizacaoDaFonte.texto);
  const coleta = Date.parse(coletaDosTemas(t));
  const base = atualizada ?? coleta;
  const dias = Math.max(0, Math.floor((agora - base) / 86_400_000));
  const contada = atualizada !== undefined
    ? `contada da data de atualização informada pela fonte (${new Date(atualizada).toISOString().slice(0, 10)})`
    : `contada da data da coleta (${dataDaTabela(t)}), porque a data de atualização da fonte não foi identificada`;
  return {
    atribuicao: t.atribuicao,
    licencaDosDados: `${t.licenca.declarada} (distinta da licença MIT do código do Garimpo)`,
    dataDaColeta: dataDaTabela(t),
    atualizacaoInformadaPelaFonte: t.atualizacaoDaFonte.texto,
    ...(curta
      ? {}
      : { paginaDaFonte: t.fonte.pagina, tabelaGeradaEm: t.geradaEm, idadeDaTabela: `${dias} dias, ${contada}` }),
    ...(dias > DIAS_PARA_AVISO
      ? {
          avisoDeIdade:
            `A tabela de precedentes tem mais de ${DIAS_PARA_AVISO} dias (${dias} dias, ${contada}): a situação e a ` +
            "tese podem ter mudado no STJ. Confira no portal do STJ antes de citar.",
        }
      : {}),
  };
}

/** A linha do tipo e número pedidos, ou undefined ("não consta na tabela"). Casamento exato do tipo. */
export function acharNaTabela(t: TabelaDePrecedentes, tipo: TipoNaTabela, numero: number): LinhaDaTabela | undefined {
  return t.linhas.find((l) => l.tipo === tipo && l.numero === numero);
}

/** Resposta do consultar_precedente: a linha com rótulos claros, ou "não consta", sempre com a origem e as datas. */
export function consultarPrecedente(t: TabelaDePrecedentes, tipo: TipoNaTabela, numero: number, agora: number) {
  const data = dataDaTabela(t);
  const sobre = sobreATabela(t, agora);
  const linha = acharNaTabela(t, tipo, numero);
  if (!linha) {
    return {
      tribunal: "stj",
      tipo,
      numero,
      consta: false,
      resultado:
        `não consta na tabela de precedentes do STJ de ${data}: o ${tipo} pode ser posterior a essa fotografia ou o ` +
        "número estar errado. Estar fora desta fotografia não quer dizer estar fora do STJ: confira no portal do STJ.",
      tabela: sobre,
    };
  }
  return {
    tribunal: "stj",
    tipo,
    numero,
    consta: true,
    situacaoNaFonte: linha.situacao ?? "situação não informada pela fonte",
    situacaoEm: `situação no STJ em ${data} (coleta da tabela), como a fonte a escreve: é situação processual, não vigência`,
    ...(linha.teseFirmada ? { teseFirmada: linha.teseFirmada } : { teseFirmada: "sem tese firmada na tabela" }),
    ...(linha.questaoSubmetida
      ? { questaoSubmetida: linha.questaoSubmetida, notaQuestaoSubmetida: "questão submetida a julgamento: é a pergunta afetada, não a tese" }
      : {}),
    ...(linha.orgaoJulgador ? { orgaoJulgador: linha.orgaoJulgador } : {}),
    ...(linha.dataPrimeiraAfetacao ? { dataPrimeiraAfetacao: linha.dataPrimeiraAfetacao } : {}),
    ...(linha.dataJulgamento ? { dataJulgamento: linha.dataJulgamento } : {}),
    ...(linha.dataPublicacaoAcordao ? { dataPublicacaoAcordao: linha.dataPublicacaoAcordao } : {}),
    processoParadigma: linha.processosParadigma ?? "processo paradigma não informado pela tabela",
    ...(linha.sumulaOriginada ? { sumulaOriginada: linha.sumulaOriginada } : {}),
    ...(linha.referenciaSumular ? { referenciaSumular: linha.referenciaSumular } : {}),
    ...(linha.numerosRepercussaoGeralSTF ? { temasDeRepercussaoGeralDoSTF: linha.numerosRepercussaoGeralSTF } : {}),
    ...(linha.sumulaOriginada || linha.referenciaSumular ? { notaSumulas: "só os números das súmulas, como a fonte traz; sem o enunciado" } : {}),
    enquadramento927: enquadrarQualificado(
      { tribunal: "stj", tipo, numero: String(numero) },
      { data, linha, consulta: true },
    ),
    tabela: sobre,
  };
}

/**
 * O reforço da tabela para um item das listas de qualificados do site (ADR-0007, emenda): só tema repetitivo e IAC do
 * STJ com número inteiro; casamento por tipo e valor numérico. Sem tabela ou fora disso, nenhum reforço.
 */
export function reforcoDaTabela(
  t: TabelaDePrecedentes | undefined,
  tribunal: string,
  tipo: string,
  numero: string | undefined,
): ReforcoDaTabela | undefined {
  const doTipo = TIPOS_NA_TABELA.find((x) => x === tipo);
  if (!t || tribunal !== "stj" || !doTipo || !numero || !/^\d+$/.test(numero.trim())) return undefined;
  return { data: dataDaTabela(t), linha: acharNaTabela(t, doTipo, Number(numero)) };
}
