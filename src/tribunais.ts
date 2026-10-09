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
  /** Explicação curta de por que não baixa sozinho (quando inteiroTeor = "link"); o caminho, com ou sem link, vem à parte. */
  motivoLink?: string;
  /** Campos extras que o site envia no corpo da busca para este tribunal. */
  extrasBusca?: Record<string, unknown>;
}

const EXPLICA_STF =
  "O portal do STF protege o download com um desafio anti-robô (AWS WAF) que exige JavaScript. " +
  "O Garimpo não contorna proteções.";

const EXPLICA_TJGO =
  "O portal do TJGO (Projudi) exige resolver um reCAPTCHA na pesquisa e o download só vale dentro " +
  "dessa sessão. O Garimpo não contorna captchas: pesquise pelo número CNJ no portal e baixe lá.";

const EXPLICA_GENERICO =
  "O Garimpo ainda não testou o download automático do portal deste tribunal; abra o link no navegador.";

/**
 * Resultado da prova ao vivo do B11 (docs/banco-de-provas/b11-prova-ao-vivo.md): só o que foi observado, com a data.
 * Uma amostra prova aquele caminho naquela data, não o tribunal inteiro.
 */
const INCONCLUSIVO_B11 = "Testado em 2026-10-09 sem conclusão; o download automático não está disponível.";

const EXPLICA_TJRN =
  `${INCONCLUSIVO_B11} A busca do site no TJRN não respondeu (HTTP 504), e a rota de íntegra do ` +
  "JurisprudênciaIA não chegou a ser testada; o uso contínuo dessa rota ainda depende de confirmar o combinado " +
  "com a JAI.";

const EXPLICA_TST =
  `${INCONCLUSIVO_B11} O link do PDF veio como endereço encurtado da Justiça do Trabalho, fora do portal do TST.`;

const EXPLICA_TJDFT =
  `${INCONCLUSIVO_B11} O portal devolveu uma página de aplicação no lugar do PDF, sem link para o PDF.`;

const EXPLICA_TJTO = "Testado em 2026-10-09: o portal respondeu HTTP 403 (acesso negado).";

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
    motivoLink: EXPLICA_TST,
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
  { ...tj("tjdft", "TJ do Distrito Federal e Territórios"), motivoLink: EXPLICA_TJDFT },
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
  { ...tj("tjrn", "TJ do Rio Grande do Norte"), motivoLink: EXPLICA_TJRN },
  { ...tj("tjro", "TJ de Rondônia") },
  { ...tj("tjrr", "TJ de Roraima") },
  { ...tj("tjrs", "TJ do Rio Grande do Sul") },
  { ...tj("tjsc", "TJ de Santa Catarina") },
  { ...tj("tjse", "TJ de Sergipe") },
  { ...tj("tjsp", "TJ de São Paulo"), inteiroTeor: "baixa", motivoLink: undefined },
  { ...tj("tjto", "TJ do Tocantins"), motivoLink: EXPLICA_TJTO },
];

export const SIGLAS = TRIBUNAIS.map((t) => t.sigla);

export function infoTribunal(sigla: string): InfoTribunal | undefined {
  return TRIBUNAIS.find((t) => t.sigla === sigla.toLowerCase());
}

/**
 * Página "Tribunais cobertos pelo Garimpo" (recurso garimpo://tribunais), em Markdown, gerada desta tabela, sem rede:
 * descreve a cobertura e os limites registrados, nunca o estado atual do portal do tribunal.
 */
export function paginaDeTribunais(): string {
  const linhas = TRIBUNAIS.map((t) => {
    const qualificados = t.qualificados.length ? t.qualificados.join(", ") : "nenhum";
    const inteiroTeor = t.inteiroTeor === "baixa" ? "baixado pelo Garimpo" : `só link: ${t.motivoLink}`;
    return `| ${t.sigla.toUpperCase()} | ${t.nome} | ${qualificados} | ${t.tetoResultados} | ${inteiroTeor} |`;
  });
  return [
    "# Tribunais cobertos pelo Garimpo",
    "",
    "Cobertura e limites registrados no Garimpo, os mesmos da ferramenta listar_tribunais. A página não diz se o " +
      "portal do tribunal está funcionando agora: o registro pode ter mudado desde a última conferência.",
    "",
    "- **Qualificados:** listas de precedentes qualificados que o site devolve em separado na busca.",
    "- **Teto por busca:** máximo de acórdãos observado por busca; só informa, não limita a busca.",
    "- **Inteiro teor:** se o Garimpo baixa o PDF oficial ou só devolve o link, e por quê.",
    "",
    "| Sigla | Tribunal | Qualificados | Teto por busca | Inteiro teor |",
    "| --- | --- | --- | --- | --- |",
    ...linhas,
    "",
  ].join("\n");
}
