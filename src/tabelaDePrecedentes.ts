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
  /**
   * Quando o gerador terminou uma geração que passou pela trava contra a tabela anterior (nada sumiu, ou o mantenedor
   * revisou). Opcional: tabelas antigas não o trazem e são lidas como "não informado".
   */
  conferidaEm?: string;
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
      : {
          paginaDaFonte: t.fonte.pagina,
          tabelaGeradaEm: t.geradaEm,
          tabelaConferidaEm: t.conferidaEm ?? "não informado",
          idadeDaTabela: `${dias} dias, ${contada}`,
        }),
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

// ——— Trava do gerador (G-56): comparação do candidato com a tabela anterior, por identificador ———

/**
 * Limiares de partida da trava de mudança grande: a ideia vem de outro projeto (MIT), sem teste de quanto muda numa
 * revisão legítima (revisão em massa de súmulas, por exemplo). Ajuste aqui; a trava só recusa com as duas condições.
 */
export const LIMIAR_MUDANCA_PROPORCAO = 0.25;
export const LIMIAR_MUDANCA_MINIMO = 20;

export interface Limiares {
  proporcao: number;
  minimo: number;
}

/** O que mudou do anterior para o candidato; cada item é "tipo número". */
export interface Diferencas {
  anteriores: number;
  removidas: string[];
  adicionadas: string[];
  alteradas: string[];
}

const idDaLinha = (l: { tipo: string; numero: number }) => `${l.tipo} ${l.numero}`;

/** Compara por identificador (tipo e número); "alterada" é qualquer campo diferente na mesma linha. */
export function compararLinhas<L extends { tipo: string; numero: number }>(anterior: L[], candidato: L[]): Diferencas {
  const antes = new Map(anterior.map((l) => [idDaLinha(l), JSON.stringify(l)]));
  const depois = new Map(candidato.map((l) => [idDaLinha(l), JSON.stringify(l)]));
  return {
    anteriores: antes.size,
    removidas: [...antes.keys()].filter((id) => !depois.has(id)),
    adicionadas: [...depois.keys()].filter((id) => !antes.has(id)),
    alteradas: [...depois].filter(([id, json]) => antes.has(id) && antes.get(id) !== json).map(([id]) => id),
  };
}

/** Por que a trava recusa gravar, ou undefined se pode gravar. Linha sumida sempre recusa; mudança grande, também. */
export function motivoDaTrava(d: Diferencas, limiares: Limiares = { proporcao: LIMIAR_MUDANCA_PROPORCAO, minimo: LIMIAR_MUDANCA_MINIMO }): string | undefined {
  if (d.removidas.length) {
    return `${d.removidas.length} precedente(s) da tabela anterior sumiram do candidato (coleta possivelmente truncada).`;
  }
  const mudadas = d.alteradas.length;
  if (d.anteriores && mudadas >= limiares.minimo && mudadas / d.anteriores >= limiares.proporcao) {
    return (
      `${mudadas} de ${d.anteriores} precedentes mudaram (${Math.round((mudadas / d.anteriores) * 100)}%; trava em ` +
      `${Math.round(limiares.proporcao * 100)}% e ${limiares.minimo} itens, limiares de partida).`
    );
  }
  return undefined;
}

/** Relatório de diferenças para a saída do gerador (até 20 identificadores por grupo). */
export function relatorioDeDiferencas(d: Diferencas): string {
  const grupo = (nome: string, ids: string[]) =>
    `${nome}: ${ids.length}${ids.length ? ` (${ids.slice(0, 20).join(", ")}${ids.length > 20 ? ", …" : ""})` : ""}`;
  return [
    `Comparação com a tabela anterior (${d.anteriores} linhas):`,
    grupo("removidas", d.removidas),
    grupo("alteradas", d.alteradas),
    grupo("adicionadas", d.adicionadas),
  ].join("\n");
}

/** Linhas da tabela já gravada em `destino`; undefined se não há (primeira geração). Arquivo ilegível: erro. */
export function lerLinhasAnteriores(destino: string): { tipo: string; numero: number }[] | undefined {
  let texto: string;
  try {
    texto = readFileSync(destino, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  const linhas = (JSON.parse(texto) as { linhas?: unknown }).linhas;
  if (!Array.isArray(linhas)) throw new Error(`${destino} não tem a lista de linhas.`);
  return linhas;
}

export interface OpcoesDaTrava {
  /** O mantenedor revisou o relatório: grava mesmo com linha sumida ou mudança grande. */
  revisado?: boolean;
  limiares?: Limiares;
  /** Recebe o relatório de diferenças (também quando a trava recusa), para a saída do gerador. */
  aoComparar?: (relatorio: string) => void;
}

/**
 * Trava dos geradores: compara o candidato com a tabela já gravada em `destino` e lança `parada(mensagem)` se a trava
 * recusar (sem `revisado`) ou se a tabela anterior estiver ilegível. Sem tabela anterior, não há o que comparar.
 */
export function conferirComAAnterior(
  destino: string,
  candidato: { linhas: { tipo: string; numero: number }[] },
  opcoes: OpcoesDaTrava,
  parada: (mensagem: string) => Error,
): void {
  let anterior: { tipo: string; numero: number }[] | undefined;
  try {
    anterior = lerLinhasAnteriores(destino);
  } catch (e) {
    throw parada(`A tabela anterior em ${destino} está ilegível (${(e as Error).message}); não dá para comparar.`);
  }
  if (!anterior) return;
  const diferencas = compararLinhas(anterior, candidato.linhas);
  const relatorio = relatorioDeDiferencas(diferencas);
  opcoes.aoComparar?.(relatorio);
  const motivo = motivoDaTrava(diferencas, opcoes.limiares);
  if (motivo && !opcoes.revisado) {
    throw parada(`${motivo} Revise o relatório e rode de novo com --revisado.\n${relatorio}`);
  }
}
