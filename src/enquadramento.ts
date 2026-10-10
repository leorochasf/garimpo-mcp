/**
 * Enquadramento no art. 927 do CPC (ADR-0007): o inciso em que um acórdão ou um precedente qualificado se encaixa
 * por regra fixa, com a base legal literal e a evidência tirada dos dados do site; ou "não classificado", com o motivo.
 * Só há classificação positiva com prova nos dados. Nunca "fora do rol", nunca "efeito vinculante".
 * Módulo puro: sem rede nem disco.
 */


/** Data em que o texto do art. 927 foi conferido no Planalto, já com o inciso III-A (Lei nº 15.484/2026). */
export const ART_927_CONFERIDO_EM = "2026-10-08";

/**
 * Incisos do art. 927 do CPC, copiados do texto do Planalto conferido em 2026-10-08. Mudar esta tabela é mudar a lei
 * que o Garimpo cita: só com a fonte conferida de novo (há teste que a trava).
 */
export const INCISOS_ART_927 = [
  { inciso: "I", texto: "as decisões do Supremo Tribunal Federal em controle concentrado de constitucionalidade;" },
  { inciso: "II", texto: "os enunciados de súmula vinculante;" },
  {
    inciso: "III",
    texto:
      "os acórdãos em incidente de assunção de competência ou de resolução de demandas repetitivas e em julgamento " +
      "de recursos extraordinário e especial repetitivos;",
  },
  {
    inciso: "III-A",
    texto:
      "os acórdãos proferidos em julgamento de recurso especial submetido ao regime da relevância da questão de " +
      "direito federal infraconstitucional;",
  },
  {
    inciso: "IV",
    texto:
      "os enunciados das súmulas do Supremo Tribunal Federal em matéria constitucional e do Superior Tribunal de " +
      "Justiça em matéria infraconstitucional;",
  },
  { inciso: "V", texto: "a orientação do plenário ou do órgão especial aos quais estiverem vinculados." },
] as const;

export type Inciso = (typeof INCISOS_ART_927)[number]["inciso"];

export interface Enquadramento927 {
  /** O inciso do art. 927, ou "não classificado". */
  inciso: Inciso | "não classificado";
  /** Texto literal do inciso (só quando classificado). */
  baseLegal?: string;
  /** O dado do site que prova o inciso (só quando classificado). */
  evidencia?: string;
  /** O que o site não informa sobre a situação do precedente; distinto da data da conferência da lei. */
  avisoSituacao?: string;
  /** Por que não foi classificado (só quando não classificado). */
  motivo?: string;
  /** Notas informativas, que nunca mudam o inciso. */
  notas: string[];
  textoLegalConferidoEm: string;
}

/** O que a regra lê de um acórdão normalizado. */
export interface AcordaoParaEnquadrar {
  tribunal: string;
  numero: string;
  semNumero: boolean;
  numeroCnj?: string;
  /** Sigla da classe como o site informa (sigla_classe), ex.: "ADI". */
  siglaClasse?: string;
  classe?: string;
  orgao?: string;
  /** Número do tema a que o site liga o acórdão do STF (numero_tema). Só gera nota. */
  numeroTema?: string;
}

/** O que a regra lê de um item das listas de precedentes qualificados do site. */
export interface QualificadoParaEnquadrar {
  tribunal: string;
  /** Rótulo da lista do site: "tema repetitivo", "súmula vinculante", "IAC"... */
  tipo: string;
  numero?: string;
  /** Tese firmada informada pelo site (tese_firmada). Descrição da questão submetida não é tese. */
  tese?: string;
}

/**
 * O que a tabela de precedentes diz do mesmo precedente (ADR-0007, emenda "Reforço pela tabela de precedentes"): a
 * linha casada por tipo e número, ou nenhuma ("não consta"), e a data da tabela. Tabela do STJ: tema repetitivo e
 * IAC; tabela do STF: repercussão geral, súmula e súmula vinculante (só situação e notas, nunca muda o inciso).
 */
export interface ReforcoDaTabela {
  /** De qual tabela (padrão: a do STJ). */
  tribunal?: "stj" | "stf";
  /** Data da tabela (coleta ou obtenção), AAAA-MM-DD. */
  data: string;
  linha?: { situacao?: string; teseFirmada?: string };
  /** O item veio da própria tabela (consultar_precedente), não de uma lista do site. */
  consulta?: boolean;
}

export function enquadrarQualificado(q: QualificadoParaEnquadrar, reforco?: ReforcoDaTabela): Enquadramento927 {
  const doReforco = reforcoAplicavel(q, reforco);
  const temTese = Boolean(q.tese?.trim()) || Boolean(doReforco?.linha?.teseFirmada);
  const completo = comReforcoDoStf(
    regraDoQualificado({ ...q, temTese, temTeseDoSite: Boolean(q.tese?.trim()) }, doReforco),
    q.tipo,
    doReforco,
  ).completo;
  return doReforco ? { ...completo, notas: notasDoReforco(q, doReforco) } : completo;
}

/**
 * Forma curta do enquadramento de um precedente qualificado (rótulo, motivo abreviado ou aviso de situação), para a
 * busca ampla caber no teto de 25 mil caracteres. Sai da mesma regra, refeita a partir do enquadramento completo: além
 * do tribunal, do tipo e do número, a regra só lê se há tese, e só o tema e o IAC do STJ dependem disso (inciso III).
 */
export function formaCurta(
  q: Omit<QualificadoParaEnquadrar, "tese">,
  e: Enquadramento927,
  reforco?: ReforcoDaTabela,
): string {
  const doReforco = reforcoAplicavel(q, reforco);
  return comReforcoDoStf(regraDoQualificado({ ...q, temTese: e.inciso === "III" }, doReforco), q.tipo, doReforco).curto;
}

/** Tipos que cada tabela cobre; fora deles (ou de outro tribunal), a regra é a de sempre. */
const TIPOS_DA_TABELA = { stj: ["tema repetitivo", "IAC"], stf: ["repercussão geral", "súmula", "súmula vinculante"] };

function reforcoAplicavel(q: Pick<QualificadoParaEnquadrar, "tribunal" | "tipo">, reforco?: ReforcoDaTabela) {
  const tribunal = reforco?.tribunal ?? "stj";
  return reforco && q.tribunal === tribunal && TIPOS_DA_TABELA[tribunal].includes(q.tipo) ? reforco : undefined;
}

const daTabela = (r: ReforcoDaTabela) => `tabela de precedentes do ${(r.tribunal ?? "stj").toUpperCase()} de ${r.data}`;

/**
 * Tabela do STF: o inciso e o motivo ficam os da regra de sempre; a situação da tabela entra no aviso de situação
 * e na forma curta (ou "não consta", só na forma curta).
 */
function comReforcoDoStf(
  r: { completo: Enquadramento927; curto: string },
  tipo: string,
  reforco?: ReforcoDaTabela,
): { completo: Enquadramento927; curto: string } {
  if (reforco?.tribunal !== "stf") return r;
  if (!reforco.linha) return { ...r, curto: `${r.curto}; não consta na tabela do STF de ${reforco.data}` };
  const situacao = situacaoDaTabela(reforco, tipo);
  return { completo: { ...r.completo, avisoSituacao: situacao.completa }, curto: `${r.curto}; ${situacao.curta}` };
}

/** Situação na fonte literal, com a data da tabela; nunca traduzida para vigência. */
function situacaoDaTabela(r: ReforcoDaTabela, tipo: string): { completa: string; curta: string } {
  const situacao = r.linha?.situacao;
  // Súmulas do STF: a "situação" é a marca entre parênteses no rótulo da lista do STF.
  if (tipo === "súmula" || tipo === "súmula vinculante") {
    return situacao
      ? {
          completa: `marcada como "${situacao}" na lista do STF (${daTabela(r)}); é o rótulo da lista, não a vigência: conferir antes de citar`,
          curta: `marca na lista do STF em ${r.data}: ${situacao}`,
        }
      : {
          completa:
            `sem marca de situação na lista do STF (${daTabela(r)}); a falta de marca não prova que a súmula está em ` +
            "vigor: conferir antes de citar",
          curta: `sem marca na lista do STF em ${r.data}`,
        };
  }
  if (!situacao) {
    return {
      completa: `situação não informada pela fonte (${daTabela(r)}): conferir antes de citar`,
      curta: `situação não informada pela fonte (${r.data})`,
    };
  }
  return {
    completa: `situação na fonte: "${situacao}" (${daTabela(r)}); é a situação processual, não a vigência: conferir antes de citar`,
    curta: `situação na fonte em ${r.data}: ${situacao}`,
  };
}

/** Notas do reforço: nunca mudam o inciso. */
function notasDoReforco(q: QualificadoParaEnquadrar, r: ReforcoDaTabela): string[] {
  if (!r.linha) return [`não consta na ${daTabela(r)}`];
  const notas: string[] = [];
  const situacao = r.linha.situacao;
  const marcaDaSumula = r.tribunal === "stf" && (q.tipo === "súmula" || q.tipo === "súmula vinculante");
  if (situacao && (marcaDaSumula || situacao === "Cancelado" || situacao === "Revisado")) {
    notas.push(
      `a fonte ${marcaDaSumula ? "marca" : "indica"} "${situacao}" (${daTabela(r)}); o inciso descreve o tipo do ` +
        "precedente, não a vigência",
    );
  }
  const doSite = textoComparavel(q.tese);
  const daFonte = r.linha.teseFirmada;
  if (doSite && daFonte && doSite !== textoComparavel(daFonte)) {
    notas.push(
      `a tese informada pelo site difere da tese firmada na ${daTabela(r)}, que é o texto da fonte oficial naquela ` +
        `data (o Garimpo não afirma qual vale hoje): "${daFonte}"`,
    );
  }
  return notas;
}

/** Comparação literal da tese: só CRLF → LF e espaço das pontas, como na tabela. */
function textoComparavel(s: string | undefined): string {
  return (s ?? "").replace(/\r\n/g, "\n").trim();
}

type QualificadoDaRegra = Omit<QualificadoParaEnquadrar, "tese"> & { temTese: boolean; temTeseDoSite?: boolean };

function regraDoQualificado(
  q: QualificadoDaRegra,
  reforco?: ReforcoDaTabela,
): { completo: Enquadramento927; curto: string } {
  // O tipo é o rótulo fixo que o próprio Garimpo dá a cada lista do site: casamento exato.
  const tipo = q.tipo;
  const numero = q.numero ? ` nº ${q.numero}` : "";
  if (tipo === "súmula vinculante") {
    if (q.tribunal !== "stf") {
      return curta(
        naoClassificado(`dados contraditórios: súmula vinculante na lista de tribunal que não o STF (${q.tribunal})`),
        "dados contraditórios (súmula vinculante fora do STF)",
      );
    }
    return curta(
      classificado(
        "II",
        `lista de súmulas vinculantes do site (STF), súmula vinculante${numero}`,
        "situação da súmula vinculante (revisão, cancelamento) não informada pelo site: conferir antes de citar",
      ),
      "situação não informada pelo site: conferir antes de citar",
    );
  }
  if (tipo === "tema repetitivo" || tipo === "IAC") {
    const rotulo = tipo;
    if (q.tribunal !== "stj") {
      return curta(
        naoClassificado(`${rotulo} de tribunal que não o STJ: a regra fixa só prevê ${rotulo} do STJ`),
        `${rotulo} fora do STJ, sem regra fixa`,
      );
    }
    if (reforco?.linha) {
      const situacao = situacaoDaTabela(reforco, tipo);
      const onde = reforco.consulta ? `a ${daTabela(reforco)}` : `o site nem na ${daTabela(reforco)}`;
      if (!q.temTese) {
        const semTese = naoClassificado(`${rotulo} do STJ sem tese firmada informada pel${onde}`);
        return curta({ ...semTese, avisoSituacao: situacao.completa }, `${rotulo} sem tese no site nem na tabela`);
      }
      const evidencia = reforco.consulta
        ? `${daTabela(reforco)}, ${rotulo}${numero}, com tese firmada`
        : q.temTeseDoSite
          ? `lista de ${rotulo} do site (STJ), ${rotulo}${numero}, com tese informada`
          : `lista de ${rotulo} do site (STJ), ${rotulo}${numero}; tese firmada na ${daTabela(reforco)}`;
      return curta(classificado("III", evidencia, situacao.completa), situacao.curta);
    }
    if (reforco && !q.temTese) {
      return curta(
        naoClassificado(`${rotulo} do STJ sem tese informada pelo site`),
        `${rotulo} sem tese; não consta na tabela de ${reforco.data}`,
      );
    }
    if (reforco) {
      return curta(
        classificado(
          "III",
          `lista de ${rotulo} do site (STJ), ${rotulo}${numero}, com tese informada`,
          `situação do ${rotulo} não verificada: não consta na ${daTabela(reforco)}; conferir antes de citar`,
        ),
        `não consta na tabela de ${reforco.data}: conferir antes de citar`,
      );
    }
    if (!q.temTese) {
      return curta(naoClassificado(`${rotulo} do STJ sem tese informada pelo site`), `${rotulo} sem tese informada pelo site`);
    }
    return curta(
      classificado(
        "III",
        `lista de ${rotulo} do site (STJ), ${rotulo}${numero}, com tese informada`,
        `situação do ${rotulo} (julgamento concluído, revisão, superação) não verificada: conferir antes de citar`,
      ),
      "situação não verificada: conferir antes de citar",
    );
  }
  if (tipo === "repercussão geral") {
    return curta(naoClassificado(MOTIVO_REPERCUSSAO_GERAL), "repercussão geral: enquadramento não verificado");
  }
  if (tipo === "súmula" && q.tribunal === "stf") {
    return curta(
      naoClassificado("súmula do STF fora da lista de súmulas vinculantes: o inciso IV exige matéria constitucional, que os dados não informam"),
      "matéria constitucional da súmula do STF não informada",
    );
  }
  if (tipo === "súmula" && q.tribunal === "stj") {
    return curta(
      naoClassificado("súmula do STJ: o inciso IV exige matéria infraconstitucional, que os dados não informam"),
      "matéria infraconstitucional da súmula do STJ não informada",
    );
  }
  const semFundamento: Record<string, string> = { súmula: `súmula do ${q.tribunal.toUpperCase()}`, PUIL: "PUIL", IRR: "IRR", OJ: "OJ" };
  if (semFundamento[tipo]) {
    return curta(
      naoClassificado(
        `${semFundamento[tipo]}: fundamento no art. 927 não verificado nas fontes consultadas (pendência de fonte)`,
      ),
      `fundamento no art. 927 não verificado (${semFundamento[tipo]})`,
    );
  }
  return curta(naoClassificado(`tipo "${q.tipo}" não previsto no texto consultado`), "tipo não previsto no texto consultado");
}

function curta(completo: Enquadramento927, abreviado: string): { completo: Enquadramento927; curto: string } {
  const rotulo = completo.inciso === "não classificado" ? "não classificado:" : `art. 927, ${completo.inciso};`;
  return { completo, curto: `${rotulo} ${abreviado}` };
}

const MOTIVO_REPERCUSSAO_GERAL =
  "enquadramento no art. 927 não verificado: a repercussão geral não é expressamente mencionada nesse artigo e o " +
  "CPC distingue os regimes no art. 1.035, § 7º";

/** Classes por sigla exata e nome por extenso, usadas pelas regras e para achar dados contraditórios. */
const CLASSES: Record<string, string> = {
  ADI: "ação direta de inconstitucionalidade",
  ADC: "ação declaratória de constitucionalidade",
  IRDR: "incidente de resolução de demandas repetitivas",
  IAC: "incidente de assunção de competência",
};

/** Órgãos cujo nome só gera nota: não prova "orientação" (art. 927, V) nem a quem ela vincula. */
const ORGAOS_DE_CUPULA = ["tribunal pleno", "orgao especial", "corte especial"];

/** Item de uma lista de precedentes qualificados da mesma resposta, para achar o mesmo processo do paradigma. */
export interface ParadigmaDoSite {
  tribunal: string;
  tipo: string;
  numero?: string;
  processoParadigma?: string;
}

export function enquadrarAcordao(
  a: AcordaoParaEnquadrar,
  contexto: { paradigmas?: readonly ParadigmaDoSite[] } = {},
): Enquadramento927 {
  return { ...regraDoAcordao(a), notas: notasDoAcordao(a, contexto.paradigmas ?? []) };
}

function regraDoAcordao(a: AcordaoParaEnquadrar): Enquadramento927 {
  const sigla = a.siglaClasse;
  if (sigla && a.classe && CLASSES[sigla] && comparavel(a.classe) !== comparavel(CLASSES[sigla])) {
    return naoClassificado(`dados contraditórios: sigla da classe "${sigla}" e classe "${a.classe}"`);
  }
  if (sigla === "ADI" || sigla === "ADC") {
    if (a.tribunal !== "stf") {
      return naoClassificado(
        `${sigla} de tribunal que não o STF: o inciso I fala em decisões do Supremo Tribunal Federal`,
      );
    }
    return classificado(
      "I",
      `STF; sigla da classe informada pelo site: ${sigla}`,
      "os dados não informam se este acórdão é a decisão definitiva de mérito nem a situação dela: conferir antes de citar",
    );
  }
  if (sigla === "ADPF" || sigla === "ADO") {
    return naoClassificado(`${sigla}: enquadramento no art. 927 não verificado nas fontes consultadas (pendência de fonte)`);
  }
  if (sigla && /^(ADI|ADC|ADPF|ADO)\b/.test(sigla)) {
    return naoClassificado(`sigla composta (${sigla}): a regra do inciso I só vale para a sigla exatamente ADI ou ADC`);
  }
  if (!sigla && !a.classe) return naoClassificado("classe não informada pelo site");
  if (!sigla && a.tribunal === "stf" && ["ADI", "ADC"].includes(siglaPelaClasse(a.classe) ?? "")) {
    return naoClassificado("sigla da classe não informada pelo site: a regra do inciso I exige a sigla exatamente ADI ou ADC");
  }
  const incidente = incidenteDaClasse(a);
  if (incidente) {
    return naoClassificado(`classe ${incidente} informada pelo site: não confirmado que este acórdão é o julgamento que fixou a tese`);
  }
  const classe = [sigla, a.classe].filter(Boolean).join(" / ");
  const recursoEspecial = comparavel(sigla ?? "") === "resp" || comparavel(a.classe ?? "") === "recurso especial";
  return naoClassificado(
    `a classe informada (${classe}) não basta para nenhuma regra fixa: os dados não informam se o julgamento foi de ` +
      "caso repetitivo, de incidente ou orientação do plenário ou do órgão especial" +
      (recursoEspecial ? ", nem se o recurso especial foi julgado no regime da relevância (inciso III-A)" : ""),
  );
}

function notasDoAcordao(a: AcordaoParaEnquadrar, paradigmas: readonly ParadigmaDoSite[]): string[] {
  const notas: string[] = [];
  const incidente = incidenteDaClasse(a);
  if (incidente) notas.push(`classe ${incidente} informada pelo site; não confirmado o julgamento que fixou a tese`);

  if (!a.semNumero && identificadorCompleto(a.numero)) {
    for (const p of paradigmas) {
      if (p.tribunal !== a.tribunal || !p.processoParadigma) continue;
      if (espacosSimples(p.processoParadigma) !== espacosSimples(a.numero)) continue;
      notas.push(
        `mesmo processo do paradigma ${daOuDo(p.tipo)} ${p.tipo}${p.numero ? ` nº ${p.numero}` : ""} informado pelo site; ` +
          "o acórdão não herda o enquadramento nem a tese",
      );
    }
  }
  if (a.tribunal === "stf" && a.numeroTema) {
    notas.push(`o site liga este acórdão ao tema nº ${a.numeroTema} do STF; o acórdão não herda o enquadramento nem a tese do tema`);
  }
  if (a.orgao && ORGAOS_DE_CUPULA.includes(comparavel(a.orgao))) {
    const corteEspecial = comparavel(a.orgao) === "corte especial"
      ? "; equivalência da Corte Especial ao órgão especial não verificada"
      : "";
    notas.push(
      `órgão informado: ${a.orgao}; o nome do órgão não comprova "orientação" do plenário ou do órgão especial ` +
        `(art. 927, V) nem a quem ela vincula${corteEspecial}`,
    );
  }
  return notas;
}

/** Rótulos femininos das listas de precedentes qualificados ("da súmula", "da OJ"); os demais são masculinos ("do tema"). */
const TIPOS_FEMININOS = ["súmula", "súmula vinculante", "repercussão geral", "OJ"];

function daOuDo(tipo: string): string {
  return TIPOS_FEMININOS.includes(tipo) ? "da" : "do";
}

function incidenteDaClasse(a: AcordaoParaEnquadrar): string | undefined {
  return ["IRDR", "IAC"].find((k) => a.siglaClasse === k || siglaPelaClasse(a.classe) === k);
}

function siglaPelaClasse(classe: string | undefined): string | undefined {
  return classe ? Object.keys(CLASSES).find((k) => comparavel(CLASSES[k]) === comparavel(classe)) : undefined;
}

/** Sigla da classe seguida do número ("REsp 1.000.009/SP") ou número CNJ: o número sozinho é ambíguo. */
function identificadorCompleto(numero: string): boolean {
  return /^[A-Za-z][\w-]*\s+\S*\d/.test(numero.trim()) || /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(numero.trim());
}

function espacosSimples(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Minúsculas, sem acento e com espaços simples: só para comparar nomes de classe e de órgão vindos do site. */
export function comparavel(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function naoClassificado(motivo: string): Enquadramento927 {
  return { inciso: "não classificado", motivo, notas: [], textoLegalConferidoEm: ART_927_CONFERIDO_EM };
}

function classificado(inciso: Inciso, evidencia: string, avisoSituacao: string): Enquadramento927 {
  const texto = INCISOS_ART_927.find((i) => i.inciso === inciso)!.texto;
  return {
    inciso,
    baseLegal: `CPC, art. 927, ${inciso}: "${texto}"`,
    evidencia,
    avisoSituacao,
    notas: [],
    textoLegalConferidoEm: ART_927_CONFERIDO_EM,
  };
}
