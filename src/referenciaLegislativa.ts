/**
 * Leitor do campo `referenciasLegislativas` dos Espelhos de Acórdãos do STJ (ADR-0022): transforma o texto da
 * referência em pares (lei, ano, artigo, parágrafo, inciso). Puro: sem rede, sem estado e sem ler nada além do texto.
 *
 * O campo é uma lista de textos, um por ato normativo. Cada texto tem o formato:
 *
 *   LEG:FED LEI:013105 ANO:2015
 *   *****  CPC-15    CÓDIGO DE PROCESSO CIVIL DE 2015
 *           ART:00219 ART:00994 INC:00006 ART:01003 PAR:00005
 *   (observação livre, opcional)
 *
 * `ART` abre um dispositivo; `PAR`, `INC`, `LET` (alínea) e `ITEM` o detalham. Um detalhe de nível já preenchido (ou
 * mais fundo) abre um par novo com o que está acima dele. `SUM` e `NUM` trazem o número de súmula ou enunciado.
 */

export interface ReferenciaLegislativa {
  esfera: string;
  /** Tipo do ato na fonte: LEI, DEL, CFB, SUM… */
  tipo: string;
  /** Número do ato sem zeros à esquerda; null quando a fonte traz asteriscos (CF, súmulas). */
  numero: string | null;
  ano: number | null;
  /** Sigla da fonte (ex.: CPC-15), quando há. */
  sigla: string | null;
  artigo?: string;
  paragrafo?: string;
  inciso?: string;
  alinea?: string;
  item?: string;
  /** Número de súmula ou enunciado (tokens SUM e NUM). */
  enunciado?: string;
  /** Observação livre entre parênteses do texto da fonte, literal. */
  observacao?: string;
}

type Detalhe = "paragrafo" | "inciso" | "alinea" | "item";

const CABECALHO = /^LEG:(\S+)\s+(\S+?):(\S+)\s+ANO:(\S+)/;
const MARCA = /\b(ART|PAR|INC|LET|ITEM|SUM|NUM):(\S+)/g;
/** Do mais alto ao mais fundo; um detalhe preenchido bloqueia ele mesmo e os mais fundos. */
const DETALHES: Record<string, Detalhe> = { PAR: "paragrafo", INC: "inciso", LET: "alinea", ITEM: "item" };
const ORDEM: Detalhe[] = ["paragrafo", "inciso", "alinea", "item"];

function valor(bruto: string): string {
  const v = bruto.replace(/^0+(?=.)/, "");
  return /^[uú]nico$/i.test(v) ? "único" : v;
}

function lerUm(entrada: string): ReferenciaLegislativa[] {
  const texto = entrada.replace(/\r\n?/g, "\n").trim();
  const cabecalho = CABECALHO.exec(texto);
  if (!cabecalho) return [];
  const observacoes: string[] = [];
  // A sigla pode ter parênteses (SUM(STJ)): sai antes da observação, que também usa parênteses.
  let sigla: string | null = null;
  const corpo = texto
    .slice(texto.indexOf("\n") + 1)
    .replace(/^\*{5}[ \t]+(\S+)/m, (_, s: string) => {
      sigla = s;
      return " ";
    })
    .replace(/\(([^)]*)\)/g, (_, dentro: string) => {
      observacoes.push(dentro.replace(/\s+/g, " ").trim());
      return " ";
    });
  const ano = Number(cabecalho[4]);
  const lei = {
    esfera: cabecalho[1],
    tipo: cabecalho[2],
    numero: /^\*+$/.test(cabecalho[3]) ? null : valor(cabecalho[3]),
    ano: Number.isInteger(ano) ? ano : null,
    sigla,
  };

  const pares: ReferenciaLegislativa[] = [];
  let atual: ReferenciaLegislativa | undefined;
  for (const [, nome, bruto] of corpo.matchAll(MARCA)) {
    const v = valor(bruto);
    if (nome === "ART") {
      pares.push((atual = { ...lei, artigo: v }));
    } else if (nome === "SUM" || nome === "NUM") {
      pares.push({ ...lei, enunciado: v });
      atual = undefined;
    } else if (atual) {
      const detalhe = DETALHES[nome];
      const nivel = ORDEM.indexOf(detalhe);
      if (ORDEM.slice(nivel).some((d) => atual![d] !== undefined)) {
        const acima = { ...lei, artigo: atual.artigo } as ReferenciaLegislativa;
        for (const d of ORDEM.slice(0, nivel)) if (atual[d] !== undefined) acima[d] = atual[d];
        pares.push((atual = acima));
      }
      atual[detalhe] = v;
    }
  }
  if (pares.length === 0) pares.push({ ...lei });
  const observacao = observacoes.filter(Boolean).join(" ");
  if (observacao) for (const p of pares) p.observacao = observacao;
  return pares;
}

/** Os pares de um texto de referência, ou de todos os textos de uma lista, na ordem. Texto fora do formato não gera par. */
export function lerReferenciasLegislativas(
  entrada: string | readonly string[] | null | undefined,
): ReferenciaLegislativa[] {
  if (!entrada) return [];
  return (typeof entrada === "string" ? [entrada] : entrada).flatMap(lerUm);
}
