/**
 * Tabela interna de tribunais cobertos pela busca direta do JurisprudênciaIA,
 * com o que cada um oferece (precedentes qualificados, teto de resultados,
 * inteiro teor oficial). Fonte: docs/api-jurisprudenciaia.md.
 */

export type InteiroTeorModo = "baixa" | "link";

export interface InfoTribunal {
  /** Sigla usada na rota da busca direta (minúscula). */
  sigla: string;
  nome: string;
  /** Listas de precedentes qualificados que o site devolve em separado. */
  qualificados: string[];
  /**
   * Máximo de acórdãos observado por busca. Só informa (aviso e listar_tribunais); não limita a busca.
   * STF = 7: o site costuma devolver poucos acórdãos do STF por busca (de 2 a 7 na medição de out/2026).
   * Demais = 100.
   */
  tetoResultados: number;
  /** "baixa" = o Garimpo baixa o PDF oficial; "link" = devolve link + explicação. */
  inteiroTeor: InteiroTeorModo;
  /** Explicação curta de por que não baixa sozinho (quando inteiroTeor = "link"). */
  motivoLink?: string;
  /** Campos extras que o site envia no corpo da busca para este tribunal. */
  extrasBusca?: Record<string, unknown>;
}

const EXPLICA_STF =
  "O portal do STF protege o download com um desafio anti-robô (AWS WAF) que exige JavaScript. " +
  "O Garimpo não contorna proteções: abra o link no navegador para obter o PDF.";

const EXPLICA_TJGO =
  "O portal do TJGO (Projudi) exige resolver um reCAPTCHA na pesquisa e o download só vale dentro " +
  "dessa sessão. O Garimpo não contorna captchas: pesquise pelo número CNJ no portal e baixe lá.";

const EXPLICA_GENERICO =
  "O portal deste tribunal exige login, JavaScript ou outra etapa que não sai por HTTP comum. " +
  "Abra o link no navegador para obter o inteiro teor.";

function tj(sigla: string, nome: string): InfoTribunal {
  return {
    sigla,
    nome,
    qualificados: [],
    tetoResultados: 100,
    inteiroTeor: "link",
    motivoLink: EXPLICA_GENERICO,
  };
}

export const TRIBUNAIS: InfoTribunal[] = [
  {
    sigla: "stf",
    nome: "Supremo Tribunal Federal",
    qualificados: ["repercussão geral", "súmula vinculante", "súmula"],
    tetoResultados: 7,
    inteiroTeor: "link",
    motivoLink: EXPLICA_STF,
    extrasBusca: {
      include_rg: true,
      rg_only: false,
      rg_limit: 5,
      rg_score_threshold: 0.45,
      sumulas_limit: 5,
      sumulas_vinc_limit: 5,
      qualified_strict: true,
    },
  },
  {
    sigla: "stj",
    nome: "Superior Tribunal de Justiça",
    qualificados: ["tema repetitivo", "súmula", "IAC", "PUIL"],
    tetoResultados: 100,
    inteiroTeor: "baixa",
    extrasBusca: {
      sumulas_limit: 5,
      repetitivos_limit: 5,
      iacs_limit: 5,
      puil_limit: 5,
      qualified_strict: true,
    },
  },
  {
    sigla: "tst",
    nome: "Tribunal Superior do Trabalho",
    qualificados: ["súmula", "IRR", "OJ"],
    tetoResultados: 100,
    inteiroTeor: "link",
    motivoLink: EXPLICA_GENERICO,
    extrasBusca: {
      include_sumulas: true,
      sumulas_limit: 5,
      include_irrs: true,
      irrs_limit: 5,
      include_ojs: true,
      ojs_limit: 5,
      qualified_strict: true,
    },
  },
  {
    sigla: "tse",
    nome: "Tribunal Superior Eleitoral",
    qualificados: [],
    tetoResultados: 100,
    inteiroTeor: "baixa",
  },
  { ...tj("stm", "Superior Tribunal Militar") },
  { ...tj("tjac", "TJ do Acre") },
  { ...tj("tjal", "TJ de Alagoas") },
  { ...tj("tjam", "TJ do Amazonas") },
  { ...tj("tjap", "TJ do Amapá") },
  { ...tj("tjba", "TJ da Bahia") },
  { ...tj("tjce", "TJ do Ceará") },
  { ...tj("tjdft", "TJ do Distrito Federal e Territórios") },
  { ...tj("tjes", "TJ do Espírito Santo") },
  { ...tj("tjgo", "TJ de Goiás"), motivoLink: EXPLICA_TJGO },
  { ...tj("tjma", "TJ do Maranhão") },
  { ...tj("tjmg", "TJ de Minas Gerais"), inteiroTeor: "baixa", motivoLink: undefined },
  { ...tj("tjms", "TJ de Mato Grosso do Sul") },
  { ...tj("tjmt", "TJ de Mato Grosso") },
  { ...tj("tjpa", "TJ do Pará") },
  { ...tj("tjpb", "TJ da Paraíba") },
  { ...tj("tjpe", "TJ de Pernambuco") },
  { ...tj("tjpi", "TJ do Piauí") },
  { ...tj("tjpr", "TJ do Paraná") },
  { ...tj("tjrj", "TJ do Rio de Janeiro") },
  { ...tj("tjrn", "TJ do Rio Grande do Norte") },
  { ...tj("tjro", "TJ de Rondônia") },
  { ...tj("tjrr", "TJ de Roraima") },
  { ...tj("tjrs", "TJ do Rio Grande do Sul") },
  { ...tj("tjsc", "TJ de Santa Catarina") },
  { ...tj("tjse", "TJ de Sergipe") },
  { ...tj("tjsp", "TJ de São Paulo") },
];

export const SIGLAS = TRIBUNAIS.map((t) => t.sigla);

export function infoTribunal(sigla: string): InfoTribunal | undefined {
  return TRIBUNAIS.find((t) => t.sigla === sigla.toLowerCase());
}
