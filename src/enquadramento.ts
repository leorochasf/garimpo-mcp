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

export function enquadrarQualificado(q: QualificadoParaEnquadrar): Enquadramento927 {
  // O tipo é o rótulo fixo que o próprio Garimpo dá a cada lista do site: casamento exato.
  const tipo = q.tipo;
  const numero = q.numero ? ` nº ${q.numero}` : "";
  if (tipo === "súmula vinculante") {
    if (q.tribunal !== "stf") {
      return naoClassificado(`dados contraditórios: súmula vinculante na lista de tribunal que não o STF (${q.tribunal})`);
    }
    return classificado(
      "II",
      `lista de súmulas vinculantes do site (STF), súmula vinculante${numero}`,
      "situação da súmula vinculante (revisão, cancelamento) não informada pelo site: conferir antes de citar",
    );
  }
  if (tipo === "tema repetitivo" || tipo === "IAC") {
    const rotulo = tipo;
    if (q.tribunal !== "stj") {
      return naoClassificado(`${rotulo} de tribunal que não o STJ: a regra fixa só prevê ${rotulo} do STJ`);
    }
    if (!q.tese?.trim()) return naoClassificado(`${rotulo} do STJ sem tese informada pelo site`);
    return classificado(
      "III",
      `lista de ${rotulo} do site (STJ), ${rotulo}${numero}, com tese informada`,
      `situação do ${rotulo} (julgamento concluído, revisão, superação) não verificada: conferir antes de citar`,
    );
  }
  if (tipo === "repercussão geral") return naoClassificado(MOTIVO_REPERCUSSAO_GERAL);
  if (tipo === "súmula" && q.tribunal === "stf") {
    return naoClassificado("súmula do STF fora da lista de súmulas vinculantes: o inciso IV exige matéria constitucional, que os dados não informam");
  }
  if (tipo === "súmula" && q.tribunal === "stj") {
    return naoClassificado("súmula do STJ: o inciso IV exige matéria infraconstitucional, que os dados não informam");
  }
  const semFundamento: Record<string, string> = { súmula: `súmula do ${q.tribunal.toUpperCase()}`, PUIL: "PUIL", IRR: "IRR", OJ: "OJ" };
  if (semFundamento[tipo]) {
    return naoClassificado(
      `${semFundamento[tipo]}: fundamento no art. 927 não verificado nas fontes consultadas (pendência de fonte)`,
    );
  }
  return naoClassificado(`tipo "${q.tipo}" não previsto no texto consultado`);
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
        `mesmo processo do paradigma do ${p.tipo}${p.numero ? ` nº ${p.numero}` : ""} informado pelo site; ` +
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
function comparavel(s: string): string {
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
