/**
 * Tabela interna de tribunais cobertos pelo Garimpo, com a fonte de cada um e o que ela oferece (precedentes
 * qualificados, teto de resultados, inteiro teor oficial). Fontes: docs/api-jurisprudenciaia.md (JurisprudênciaIA) e
 * docs/fonte-falcao.md (Falcão, os 24 TRTs).
 */

/**
 * "baixa" = o Garimpo baixa o PDF oficial; "link" = devolve link + explicação; "texto" = texto integral na busca;
 * "portal" = o obter_inteiro_teor traz o texto do portal do tribunal (HTML convertido) para a memória (ADR-0021).
 */
export type InteiroTeorModo = "baixa" | "link" | "texto" | "portal";

/** De onde vem a busca do tribunal. */
export type Fonte = "JurisprudênciaIA" | "Falcão (CSJT)";

/** O que a tabela diz dos TRTs: precedentes qualificados e inteiro teor. */
export const QUALIFICADOS_TRT = "qualificados não pesquisados no B12";
export const INTEIRO_TEOR_TRT = "texto integral do repositório oficial (sem PDF)";
/** O que a tabela diz do TJTO (ADR-0021). */
export const INTEIRO_TEOR_PORTAL = "texto do portal do tribunal, trazido pelo obter_inteiro_teor (sem PDF)";

/** Rótulo de cada acórdão de TRT (ADR-0018). */
export const ROTULO_FALCAO =
  "Falcão — repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024)";

export interface InfoTribunal {
  /** Sigla usada na rota da busca direta (minúscula). */
  sigla: string;
  nome: string;
  fonte: Fonte;
  /** Listas de precedentes qualificados que o site devolve em separado. */
  qualificados: string[];
  /**
   * Máximo de acórdãos observado por busca. Só informa (aviso e listar_tribunais); não limita a busca.
   * STF = 7: o site costuma devolver poucos acórdãos do STF por busca (de 2 a 7 na medição de out/2026).
   * Demais = 100. TRTs = 30: o teto da busca direta no Falcão (3 páginas de 10), que limita a busca.
   */
  tetoResultados: number;
  inteiroTeor: InteiroTeorModo;
  /** Explicação curta de por que não baixa sozinho (quando inteiroTeor = "link"); o caminho, com ou sem link, vem à parte. */
  motivoLink?: string;
  /** Campos extras que o site envia no corpo da busca para este tribunal. */
  extrasBusca?: Record<string, unknown>;
}

const EXPLICA_STF =
  "O portal do STF protege o download com um desafio anti-robô (AWS WAF) que exige JavaScript. " +
  "O Garimpo não contorna proteções.";

const EXPLICA_STJ =
  "O robots.txt de processo.stj.jus.br (host do inteiro teor), lido em 2026-10-13, veda o acesso automatizado ao host " +
  "inteiro (User-agent: * com Disallow: /). O Garimpo respeita e não baixa o inteiro teor do STJ; abra o link no navegador.";

/** Pesquisa pública de jurisprudência do TJGO (prova B11, docs/banco-de-provas/b11-prova-ao-vivo.md). */
const PESQUISA_TJGO = "https://projudi.tjgo.jus.br/ConsultaJurisprudencia";

const EXPLICA_TJGO =
  "O link do Projudi do TJGO não abre o acórdão fora da sessão de pesquisa do portal: o download só vale dentro " +
  "dela, e o Garimpo não contorna a verificação anti-robô (Cloudflare). Há um caminho público, sem login: abra " +
  `${PESQUISA_TJGO}, cole o número CNJ do processo no campo «Número do Processo», passe pela verificação ` +
  "anti-robô no navegador e clique em Buscar. Fora da sessão, o link da busca costuma mostrar «Sem Permissão " +
  "para o Usuário (nº 78)» em vez do acórdão.";

/** Link de acórdão do Projudi do TJGO: não abre o acórdão fora de uma sessão do portal. */
const LINK_PROJUDI_TJGO = /projudi\.tjgo\.jus\.br\/ConsultaJurisprudencia/i;

/**
 * Aviso fixo, uma vez por resposta (nunca por acórdão), quando algum link é do Projudi do TJGO. Com um só resultado
 * do TJGO que tenha número CNJ, o número já vem escrito; com vários, manda usar o número de cada resultado.
 */
export function avisoDeLinkDoTjgo(
  acordaos: ReadonlyArray<{ link?: string; linkConsulta?: string; numeroCnj?: string }>,
): string[] {
  const doProjudi = acordaos.filter((a) => LINK_PROJUDI_TJGO.test(a.link ?? a.linkConsulta ?? ""));
  if (doProjudi.length === 0) return [];
  const numeros = doProjudi.flatMap((a) => (a.numeroCnj ? [a.numeroCnj] : []));
  const qual =
    doProjudi.length === 1 && numeros.length === 1
      ? `o número do processo deste resultado: ${numeros[0]}`
      : "o número do processo de cada resultado do TJGO";
  return [
    "Link do Projudi do TJGO: aberto fora da sessão de pesquisa do portal, não abre o acórdão e pode mostrar " +
      "«Sem Permissão para o Usuário (nº 78)». Caminho público, sem login: abra " +
      `${PESQUISA_TJGO}, cole no campo «Número do Processo» ${qual}, passe pela verificação anti-robô (Cloudflare) ` +
      "no navegador, clique em Buscar e abra o resultado (procure pelo número; o Garimpo não garante que " +
      "a busca por número encontre o acórdão).",
  ];
}

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

function tj(sigla: string, nome: string): InfoTribunal {
  return {
    sigla,
    nome,
    fonte: "JurisprudênciaIA",
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
    fonte: "JurisprudênciaIA",
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
    fonte: "JurisprudênciaIA",
    qualificados: ["tema repetitivo", "súmula", "IAC", "PUIL"],
    tetoResultados: 100,
    inteiroTeor: "link",
    motivoLink: EXPLICA_STJ,
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
    fonte: "JurisprudênciaIA",
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
    fonte: "JurisprudênciaIA",
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
  { ...tj("tjto", "TJ do Tocantins"), inteiroTeor: "portal", motivoLink: undefined },
  ...Array.from({ length: 24 }, (_, i): InfoTribunal => ({
    sigla: `trt${i + 1}`,
    nome: `TRT da ${i + 1}ª Região`,
    fonte: "Falcão (CSJT)",
    qualificados: [],
    tetoResultados: 30,
    inteiroTeor: "texto",
  })),
];

/** Os TRTs (pelo Falcão), na ordem: trt1 … trt24. */
export const TRTS = Array.from({ length: 24 }, (_, i) => `trt${i + 1}`);

/** O tribunal vem do Falcão (um dos 24 TRTs). */
export function ehDoFalcao(sigla: string): boolean {
  return TRTS.includes(sigla.toLowerCase());
}

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
    const qualificados =
      t.fonte === "Falcão (CSJT)" ? QUALIFICADOS_TRT : t.qualificados.length ? t.qualificados.join(", ") : "nenhum";
    const inteiroTeor =
      t.inteiroTeor === "baixa"
        ? "baixado pelo Garimpo"
        : t.inteiroTeor === "texto"
          ? INTEIRO_TEOR_TRT
          : t.inteiroTeor === "portal"
            ? INTEIRO_TEOR_PORTAL
            : `só link: ${t.motivoLink}`;
    return `| ${t.sigla.toUpperCase()} | ${t.nome} | ${t.fonte} | ${qualificados} | ${t.tetoResultados} | ${inteiroTeor} |`;
  });
  return [
    "# Tribunais cobertos pelo Garimpo",
    "",
    "Cobertura e limites registrados no Garimpo, os mesmos da ferramenta listar_tribunais. A página não diz se o " +
      "portal do tribunal está funcionando agora: o registro pode ter mudado desde a última conferência.",
    "",
    "- **Fonte:** de onde vem a busca: a busca direta do JurisprudênciaIA (base não oficial) ou o Falcão (CSJT), " +
      "repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024), para os 24 TRTs (só acórdãos).",
    "- **Qualificados:** listas de precedentes qualificados que o site devolve em separado na busca.",
    "- **Teto por busca:** máximo de acórdãos observado por busca; só informa, não limita a busca. Nos TRTs, é o teto " +
      "da busca direta (3 páginas de 10 do Falcão), que limita a busca.",
    "- **Inteiro teor:** se o Garimpo baixa o PDF oficial ou só devolve o link, e por quê; nos TRTs, o texto integral " +
      "do repositório oficial, que vem na própria busca, convertido de HTML (não é PDF, sem recibo de origem).",
    "",
    "Nos TRTs (Falcão): a busca_ampla usa no máximo 5 páginas do Falcão por chamada (1 página = 1 formulação × TRT); " +
      "o que não couber sai no cabeçalho de cobertura como não executado, nunca como busca vazia. O Garimpo tem um " +
      "freio preventivo: para de chamar o Falcão, em todas as janelas, antes do limite de pedidos que bloqueia o IP por " +
      "horas, e diz a partir de que hora tentar de novo. O texto integral só pode ser lido e conferido (ler_inteiro_teor, " +
      "conferir_citacao) enquanto estiver na memória do Garimpo, 24 h desde a busca: o Falcão não tem busca por id.",
    "",
    "| Sigla | Tribunal | Fonte | Qualificados | Teto por busca | Inteiro teor |",
    "| --- | --- | --- | --- | --- | --- |",
    ...linhas,
    "",
  ].join("\n");
}
