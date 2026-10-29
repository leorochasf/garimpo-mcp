/**
 * Tabela interna de tribunais cobertos pelo Garimpo, com a fonte de cada um e o que ela oferece (precedentes
 * qualificados, teto de resultados, inteiro teor oficial). Fontes: docs/api-jurisprudenciaia.md (JurisprudênciaIA) e
 * docs/fonte-falcao.md (Falcão, os 24 TRTs).
 */

/**
 * "baixa" = o Garimpo baixa o PDF oficial; "link" = devolve link + explicação; "texto" = texto integral na busca;
 * "portal" = o obter_inteiro_teor traz o texto do portal do tribunal para a memória (ADR-0021): HTML convertido, o
 * registro da API no TJDFT e, no TJGO, também o PDF embutido no arquivo assinado.
 */
export type InteiroTeorModo = "baixa" | "link" | "texto" | "portal";

/** De onde vem a busca do tribunal. */
export type Fonte = "JurisprudênciaIA" | "Falcão (CSJT)" | "e-Proc do TRF2" | "e-Proc do TRF4" | "e-Proc da TNU";

/** O que a tabela diz dos TRTs: precedentes qualificados e inteiro teor. */
export const QUALIFICADOS_TRT =
  "coleção precedentes do Falcão, só na busca_direta com precedentes:true (até 10 itens; cobertura por TRT não verificada)";
export const INTEIRO_TEOR_TRT = "texto integral do repositório oficial (sem PDF)";
/** O que a tabela diz dos tribunais de texto do portal (ADR-0021). */
export const INTEIRO_TEOR_PORTAL = "texto do portal do tribunal, trazido pelo obter_inteiro_teor (sem PDF)";

/** Rótulo de cada acórdão de TRT (ADR-0018). */
export const ROTULO_FALCAO =
  "Falcão — repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024)";

/** Rótulo de cada acórdão do TRF2 (ADR-0028). */
export const ROTULO_TRF2 = "e-Proc do TRF2 — módulo de jurisprudência do tribunal (eproc.trf2.jus.br)";

/** Rótulo de cada acórdão do TRF4 (ADR-0024). */
export const ROTULO_TRF4 = "e-Proc do TRF4 — módulo de jurisprudência do tribunal (eproc-jur.trf4.jus.br)";

/** Rótulo de cada acórdão da TNU (ADR-0027). */
export const ROTULO_TNU =
  "e-Proc da TNU — módulo de jurisprudência da Turma Nacional de Uniformização (eproctnu-jur.cjf.jus.br)";

/**
 * Por que o tribunal é só link: vedação escrita (robots.txt ou termo de uso), desafio técnico (proteção anti-robô na
 * prova), rota quebrada (o endereço não entregou o acórdão) ou não testado (sem prova da rota de inteiro teor).
 */
export type ClasseDoMotivo = "vedação escrita" | "desafio técnico" | "rota quebrada" | "não testado";

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
  /** Classe do motivo do só link (fotografia B0.1 de 2026-10-23, feita sem rede). */
  classeDoMotivo?: ClasseDoMotivo;
  /** Data (AAAA-MM-DD) da prova registrada que sustenta o motivo; sem prova própria, ausente. Não é data de reconferência. */
  dataDaProva?: string;
  /** Campos extras que o site envia no corpo da busca para este tribunal. */
  extrasBusca?: Record<string, unknown>;
}

const EXPLICA_STF =
  "Em 14/10/2026, ao ler o robots.txt de redir.stf.jus.br (host do download do acórdão), o Garimpo recebeu HTTP 202 " +
  "da proteção anti-robô (WAF) do portal. O Garimpo não contorna proteções; abra o link no navegador.";

/** Provas próprias de 14/10/2026 (TICKETS b17-onda-1/04, 05, 08 e b18-investigacoes/trfs-eproc-cjf): só o observado. */
const EXPLICA_TJRJ =
  "O termo de uso do portal do TJRJ veda robôs e coleta automática de dados «sem permissão expressa por escrito» do " +
  "tribunal (lido em 29/10/2026). O Garimpo respeita e não baixa o PDF; abra o link no navegador.";

const EXPLICA_TJSE =
  "O robots.txt do TJSE (www.tjse.jus.br), lido em 29/10/2026, traz «Disallow: /» e libera só «/portal»; a pesquisa " +
  "de jurisprudência fica fora do liberado. O Garimpo respeita e não baixa o acórdão; abra o link no navegador.";

/** Provas de 29/10/2026 (TICKETS/time-elyra/matriz-tjs.md): só o observado, com o host e a data. */
const EXPLICA_TJPE =
  "O robots.txt do TJPE (www.tjpe.jus.br), lido em 29/10/2026, traz «User-agent: *» e «Disallow: /», que veda o site " +
  "inteiro, inclusive o caminho do inteiro teor. O Garimpo respeita e não baixa o acórdão; abra o link no navegador.";

const EXPLICA_TJRS =
  "O robots.txt do TJRS (www.tjrs.jus.br), lido em 29/10/2026, traz «Disallow: /busca»; o endereço de dados que a " +
  "página de busca do tribunal usa (/buscas/jurisprudencia/) começa por /busca. O Garimpo respeita e não baixa o " +
  "acórdão; abra o link no navegador.";

const EXPLICA_TJRO =
  "Em 29/10/2026, o endereço do acórdão no portal de jurisprudência do TJRO (juris.tjro.jus.br) devolveu HTTP 200 com " +
  "um script de verificação anti-robô no lugar do acórdão. O Garimpo não contorna proteções; abra o link no navegador.";

const EXPLICA_TJAP =
  "Em 29/10/2026, o robots.txt de tucujuris.tjap.jus.br (host do PDF do acórdão) devolveu HTTP 403 com a página de " +
  "desafio do Cloudflare («Just a moment…»). O Garimpo não contorna proteções; abra o link no navegador.";

const EXPLICA_TJPB =
  "Em 29/10/2026, os dois portais oficiais de jurisprudência do TJPB estavam barrados: o robots.txt de " +
  "juris.tjpb.jus.br traz «Disallow: /», e o de pje-jurisprudencia.tjpb.jus.br devolveu HTTP 403 com a página de " +
  "desafio do Cloudflare («Just a moment…»). O Garimpo respeita e não contorna; abra o link no navegador.";

/** TJAL, TJAM e TJAC usam o eSAJ: o endereço do acórdão pede o código da figura (captcha) antes do texto. */
function explicaCaptchaEsaj(tj: string, host: string): string {
  return (
    `Em 29/10/2026, o endereço do acórdão no eSAJ do ${tj} (${host}) devolveu uma página que pede o código da figura ` +
    "(captcha) antes de mostrar o acórdão. O Garimpo não resolve captcha; abra o link no navegador."
  );
}

const EXPLICA_TJPA =
  "Em 29/10/2026, o endereço do documento no portal de jurisprudência do TJPA (jurisprudencia.tjpa.jus.br) abriu só a " +
  "tela de pesquisa, sem o acórdão, e a pesquisa do portal não isola um acórdão pelo número do processo. O Garimpo " +
  "não obtém o texto automaticamente; abra o link no navegador.";

const EXPLICA_TJMT =
  "Em 29/10/2026, o serviço da pesquisa de jurisprudência do TJMT (hellsgate.tjmt.jus.br) respondeu HTTP 401 pedindo " +
  "chave de API; a chave que a página do portal usa não é credencial do Garimpo. O Garimpo não obtém o texto " +
  "automaticamente; abra o link no navegador.";

const EXPLICA_TJSC =
  "Em 29/10/2026, ao ler o robots.txt do portal eproc do TJSC (eproc1g.tjsc.jus.br), o Garimpo recebeu uma página " +
  "de bloqueio («Nossos sistemas classificaram esse acesso como não autorizado»). O Garimpo parou ali e não baixa o " +
  "acórdão; abra o link no navegador.";

const EXPLICA_STJ =
  "O robots.txt de processo.stj.jus.br (host do inteiro teor), lido em 2026-10-13, veda o acesso automatizado ao host " +
  "inteiro (User-agent: * com Disallow: /). O Garimpo respeita e não baixa o inteiro teor do STJ; abra o link no navegador.";

/** Pesquisa pública de jurisprudência do TJGO (prova B11, docs/banco-de-provas/b11-prova-ao-vivo.md). */
const PESQUISA_TJGO = "https://projudi.tjgo.jus.br/ConsultaJurisprudencia";

/** Consulta pública de processo do Projudi do TJGO: o número CNJ no fim abre o processo, sem login (vista em 2026-10-22). */
const PROCESSO_TJGO = "https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=2&ProcessoNumero=";

/** Link de acórdão do Projudi do TJGO: não abre o acórdão fora de uma sessão do portal. */
const LINK_PROJUDI_TJGO = /projudi\.tjgo\.jus\.br\/ConsultaJurisprudencia/i;
const LINK_PROCESSO_TJGO = /projudi\.tjgo\.jus\.br\/BuscaProcesso/i;

/** Link da página pública do processo no Projudi, com o número CNJ pontuado; sem número CNJ do TJGO, nada. */
export function linkDoProcessoNoTjgo(numero: string | undefined): string | undefined {
  const d = numero?.replace(/\D/g, "") ?? "";
  if (d.length !== 20 || d.slice(13, 16) !== "809") return undefined;
  return `${PROCESSO_TJGO}${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d[13]}.${d.slice(14, 16)}.${d.slice(16)}`;
}

/**
 * Acórdão do TJGO guardado na memória antes do link do processo: troca o link da pesquisa pelo do processo e guarda o
 * Id_Arquivo dele, que amarra o arquivo «Ementa» do julgamento (ADR-0029).
 */
export function comLinkDoProcessoNoTjgo<
  T extends { tribunal: string; numero?: string; numeroCnj?: string; link?: string; idArquivoProjudi?: string },
>(a: T): T {
  if (a.tribunal !== "tjgo" || !LINK_PROJUDI_TJGO.test(a.link ?? "")) return a;
  const link = linkDoProcessoNoTjgo(a.numeroCnj) ?? linkDoProcessoNoTjgo(a.numero);
  const idArquivoProjudi = /[?&]Id_Arquivo=(\d+)/.exec(a.link ?? "")?.[1];
  return link ? { ...a, link, ...(idArquivoProjudi && { idArquivoProjudi }) } : a;
}

/**
 * Aviso fixo, uma vez por resposta (nunca por acórdão), quando algum link é do Projudi do TJGO. Com um só resultado
 * do TJGO que tenha número CNJ, o número já vem escrito; com vários, manda usar o número de cada resultado.
 */
export function avisoDeLinkDoTjgo(
  acordaos: ReadonlyArray<{ link?: string; linkConsulta?: string; numeroCnj?: string }>,
): string[] {
  const linkDe = (a: { link?: string; linkConsulta?: string }) => a.link ?? a.linkConsulta ?? "";
  const doProjudi = acordaos.filter((a) => LINK_PROJUDI_TJGO.test(linkDe(a)) || LINK_PROCESSO_TJGO.test(linkDe(a)));
  if (doProjudi.length === 0) return [];
  const numeros = doProjudi.flatMap((a) => (a.numeroCnj ? [a.numeroCnj] : []));
  const qual =
    doProjudi.length === 1 && numeros.length === 1
      ? `o número do processo deste resultado: ${numeros[0]}`
      : "o número do processo de cada resultado do TJGO";
  const pesquisa =
    `abra ${PESQUISA_TJGO}, cole no campo «Número do Processo» ${qual}, passe pela verificação anti-robô (Cloudflare) ` +
    "no navegador, clique em Buscar e abra o resultado (procure pelo número; o Garimpo não garante que " +
    "a busca por número encontre o acórdão).";
  const partes: string[] = [];
  if (doProjudi.some((a) => LINK_PROCESSO_TJGO.test(linkDe(a)))) {
    partes.push(
      "o link da consulta de processo (BuscaProcesso) abre a página pública do processo (dados e movimentações), sem " +
        "login, não o arquivo do acórdão; o obter_inteiro_teor traz o texto do acórdão por ela quando acha o julgamento " +
        "exato (mesma data e hora), senão diz o motivo",
    );
  }
  if (doProjudi.some((a) => LINK_PROJUDI_TJGO.test(linkDe(a)))) {
    partes.push(
      "o link da pesquisa de jurisprudência (ConsultaJurisprudencia), aberto fora da sessão de pesquisa do portal, " +
        "não abre o acórdão e pode mostrar «Sem Permissão para o Usuário (nº 78)»",
    );
  }
  return [`Link do Projudi do TJGO: ${partes.join("; ")}. Caminho público para o acórdão, sem login: ${pesquisa}`];
}

export const HOST_TJPR = "portal.tjpr.jus.br";
/** Como o portal do TJPR aponta o documento: /jurisprudencia/j/<n>, com ou sem o nome depois (/Acórdão, /Acórdão-<processo>). */
const CAMINHO_DO_DOCUMENTO_TJPR = /^\/jurisprudencia\/j\/(\d+)(?:\/[^/]*)?$/;

/** O número do documento no link do portal do TJPR (só https no host do portal); outro endereço = undefined (ADR-0030). */
export function documentoDoTjpr(link: string | undefined): string | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.host !== HOST_TJPR) return undefined;
    return CAMINHO_DO_DOCUMENTO_TJPR.exec(url.pathname)?.[1];
  } catch {
    return undefined;
  }
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

function tj(sigla: string, nome: string): InfoTribunal {
  return {
    sigla,
    nome,
    fonte: "JurisprudênciaIA",
    qualificados: [],
    tetoResultados: 100,
    inteiroTeor: "link",
    motivoLink: EXPLICA_GENERICO,
    classeDoMotivo: "não testado",
  };
}

/** Tribunal da tabela base de TJ que tem inteiro teor (baixa ou portal): sem motivo de só link. */
const SEM_MOTIVO = { motivoLink: undefined, classeDoMotivo: undefined };

export const TRIBUNAIS: InfoTribunal[] = [
  {
    sigla: "stf",
    nome: "Supremo Tribunal Federal",
    fonte: "JurisprudênciaIA",
    qualificados: ["repercussão geral", "súmula vinculante", "súmula"],
    tetoResultados: 7,
    inteiroTeor: "link",
    motivoLink: EXPLICA_STF,
    classeDoMotivo: "desafio técnico",
    dataDaProva: "2026-10-14",
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
    classeDoMotivo: "vedação escrita",
    dataDaProva: "2026-10-13",
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
    classeDoMotivo: "não testado",
    dataDaProva: "2026-10-09",
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
  { ...tj("tjac", "TJ do Acre"), motivoLink: explicaCaptchaEsaj("TJAC", "esaj.tjac.jus.br"), classeDoMotivo: "desafio técnico", dataDaProva: "2026-10-29" },
  { ...tj("tjal", "TJ de Alagoas"), motivoLink: explicaCaptchaEsaj("TJAL", "www2.tjal.jus.br"), classeDoMotivo: "desafio técnico", dataDaProva: "2026-10-29" },
  { ...tj("tjam", "TJ do Amazonas"), motivoLink: explicaCaptchaEsaj("TJAM", "consultasaj.tjam.jus.br"), classeDoMotivo: "desafio técnico", dataDaProva: "2026-10-29" },
  { ...tj("tjap", "TJ do Amapá"), motivoLink: EXPLICA_TJAP, classeDoMotivo: "desafio técnico", dataDaProva: "2026-10-29" },
  { ...tj("tjba", "TJ da Bahia") },
  { ...tj("tjce", "TJ do Ceará") },
  { ...tj("tjdft", "TJ do Distrito Federal e Territórios"), inteiroTeor: "portal", ...SEM_MOTIVO },
  { ...tj("tjes", "TJ do Espírito Santo") },
  { ...tj("tjgo", "TJ de Goiás"), inteiroTeor: "portal", ...SEM_MOTIVO },
  { ...tj("tjma", "TJ do Maranhão") },
  { ...tj("tjmg", "TJ de Minas Gerais"), inteiroTeor: "baixa", ...SEM_MOTIVO },
  { ...tj("tjms", "TJ de Mato Grosso do Sul"), inteiroTeor: "baixa", ...SEM_MOTIVO },
  { ...tj("tjmt", "TJ de Mato Grosso"), motivoLink: EXPLICA_TJMT, classeDoMotivo: "desafio técnico", dataDaProva: "2026-10-29" },
  { ...tj("tjpa", "TJ do Pará"), motivoLink: EXPLICA_TJPA, classeDoMotivo: "rota quebrada", dataDaProva: "2026-10-29" },
  { ...tj("tjpb", "TJ da Paraíba"), motivoLink: EXPLICA_TJPB, classeDoMotivo: "vedação escrita", dataDaProva: "2026-10-29" },
  { ...tj("tjpe", "TJ de Pernambuco"), motivoLink: EXPLICA_TJPE, classeDoMotivo: "vedação escrita", dataDaProva: "2026-10-29" },
  { ...tj("tjpi", "TJ do Piauí"), inteiroTeor: "portal", ...SEM_MOTIVO },
  { ...tj("tjpr", "TJ do Paraná"), inteiroTeor: "portal", ...SEM_MOTIVO },
  { ...tj("tjrj", "TJ do Rio de Janeiro"), motivoLink: EXPLICA_TJRJ, classeDoMotivo: "vedação escrita", dataDaProva: "2026-10-29" },
  { ...tj("tjrn", "TJ do Rio Grande do Norte"), motivoLink: EXPLICA_TJRN, classeDoMotivo: "não testado", dataDaProva: "2026-10-09" },
  { ...tj("tjro", "TJ de Rondônia"), motivoLink: EXPLICA_TJRO, classeDoMotivo: "desafio técnico", dataDaProva: "2026-10-29" },
  { ...tj("tjrr", "TJ de Roraima"), inteiroTeor: "baixa", ...SEM_MOTIVO },
  { ...tj("tjrs", "TJ do Rio Grande do Sul"), motivoLink: EXPLICA_TJRS, classeDoMotivo: "vedação escrita", dataDaProva: "2026-10-29" },
  { ...tj("tjsc", "TJ de Santa Catarina"), motivoLink: EXPLICA_TJSC, classeDoMotivo: "desafio técnico", dataDaProva: "2026-10-29" },
  { ...tj("tjse", "TJ de Sergipe"), motivoLink: EXPLICA_TJSE, classeDoMotivo: "vedação escrita", dataDaProva: "2026-10-29" },
  { ...tj("tjsp", "TJ de São Paulo"), inteiroTeor: "baixa", ...SEM_MOTIVO },
  { ...tj("tjto", "TJ do Tocantins"), inteiroTeor: "portal", ...SEM_MOTIVO },
  {
    sigla: "trf2",
    nome: "Tribunal Regional Federal da 2ª Região",
    fonte: "e-Proc do TRF2",
    qualificados: [],
    tetoResultados: 10,
    inteiroTeor: "portal",
  },
  {
    sigla: "trf4",
    nome: "Tribunal Regional Federal da 4ª Região",
    fonte: "e-Proc do TRF4",
    qualificados: [],
    tetoResultados: 10,
    inteiroTeor: "portal",
  },
  {
    sigla: "tnu",
    nome: "Turma Nacional de Uniformização dos Juizados Especiais Federais",
    fonte: "e-Proc da TNU",
    qualificados: [],
    tetoResultados: 10,
    inteiroTeor: "portal",
  },
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

/** O tribunal vem do e-Proc do TRF2 (ADR-0028). */
export function ehDoTrf2(sigla: string): boolean {
  return sigla.toLowerCase() === "trf2";
}

/** O tribunal vem do e-Proc do TRF4 (ADR-0024). */
export function ehDoTrf4(sigla: string): boolean {
  return sigla.toLowerCase() === "trf4";
}

/** O tribunal vem do e-Proc da TNU (ADR-0027). */
export function ehDoTnu(sigla: string): boolean {
  return sigla.toLowerCase() === "tnu";
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
            : `só link (${t.classeDoMotivo}; ${t.dataDaProva ? `registro de ${t.dataDaProva}, sem nova conferência` : "sem prova própria"}): ${t.motivoLink}`;
    return `| ${t.sigla.toUpperCase()} | ${t.nome} | ${t.fonte} | ${qualificados} | ${t.tetoResultados} | ${inteiroTeor} |`;
  });
  return [
    "# Tribunais cobertos pelo Garimpo",
    "",
    "Cobertura e limites registrados no Garimpo, os mesmos da ferramenta listar_tribunais. A página não diz se o " +
      "portal do tribunal está funcionando agora: o registro pode ter mudado desde a última conferência.",
    "",
    "- **Fonte:** de onde vem a busca: a busca direta do JurisprudênciaIA (base não oficial) ou o Falcão (CSJT), " +
      "repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024), para os 24 TRTs (só acórdãos); " +
      "o e-Proc do TRF2 ou do TRF4 (módulo de jurisprudência do próprio tribunal; só acórdãos, até 10 por busca); ou o e-Proc da " +
      "TNU (mesmo módulo, no CJF; só acórdãos, até 10 por busca).",
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
