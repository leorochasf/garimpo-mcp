/**
 * Panorama da amostra: contagens por tribunal, ano de julgamento, órgão e relator sobre acórdãos que uma busca já trouxe.
 * Só conta o que recebe; não chama fonte nenhuma e não estima o que falta.
 */

import type { Acordao } from "./busca.js";

/** Órgãos mostrados por tribunal: o resto soma em "outros", para a resposta ficar longe do teto de 25 mil caracteres. */
export const ORGAOS_POR_TRIBUNAL = 20;

export const SEM_DATA = "sem data";
export const SEM_ORGAO = "sem órgão informado";

/** Relatores mostrados por tribunal (e, à parte, relatores para o acórdão): o resto soma em `outros`. */
export const RELATORES_POR_TRIBUNAL = 20;
/** Texto de relator acima disso não é mostrado, só contado em `outros`: a resposta fica abaixo do teto de 25 mil caracteres. */
export const TAMANHO_MAXIMO_DE_RELATOR = 200;
/**
 * Caracteres de nome de relator mostrados no total, divididos igualmente entre as listas (duas por tribunal): com os 20
 * maiores de 200 caracteres em 40 tribunais a resposta passaria do teto. O que não cabe soma em `outros`.
 */
export const ORCAMENTO_DE_RELATORES = 12_000;

/** O aviso fixo de toda resposta do panorama: amostra da busca, não estatística. */
export const AVISO_DE_AMOSTRA =
  "Contagem só dos acórdãos informados, tirados de uma busca do Garimpo: é uma amostra da busca, não a estatística " +
  "do tribunal nem o total de julgados sobre o tema.";

/** Contagem de nomes: do mais frequente ao menos; o que passou dos maiores (ou é longo demais para mostrar) soma em `outros`. */
export interface ContagemDeNomes {
  valores: Record<string, number>;
  outros: number;
}

export interface RelatoriaDoTribunal {
  /** Relator como a fonte o deu (grafias diferentes ficam separadas). */
  relatores: ContagemDeNomes;
  /** Registros no formato exato do e-Proc «<relator> (relator para o acórdão: <nome>)», com o texto original. */
  paraOAcordao: ContagemDeNomes;
  /** Relator ausente, vazio ou só de espaços. */
  naoInformado: number;
}

export interface Panorama {
  total: number;
  porTribunal: Record<string, number>;
  porAno: Record<string, number>;
  /** Por tribunal, do órgão mais frequente ao menos; "outros" soma o que passou dos maiores. */
  porOrgao: Record<string, Record<string, number>>;
  /** Por tribunal (o mesmo nome em tribunais diferentes não se soma). */
  porRelator: Record<string, RelatoriaDoTribunal>;
}

function contar(contagem: Record<string, number>, chave: string) {
  contagem[chave] = (contagem[chave] ?? 0) + 1;
}

/**
 * O único formato de «relator para o acórdão» que o Garimpo emite (eproc.ts, TRF2/TRF4/TNU): «<relator> (relator para o
 * acórdão: <nome>)». Leitura conservadora: nomes sem parênteses nem espaço nas pontas, um só marcador, texto inteiro;
 * qualquer outro texto não é separado. Nas demais fontes o relator vem como a fonte o dá, e se ela misturar os dois
 * papéis num texto isso é não verificado: o panorama não tenta separar.
 */
const RELATOR_PARA_O_ACORDAO = /^[^()\s](?:[^()]*[^()\s])? \(relator para o acórdão: [^()\s](?:[^()]*[^()\s])?\)$/;

function maiores(contagem: Record<string, number>, limite: number, orcamento: number): ContagemDeNomes {
  let outros = 0;
  let cabe = true;
  const mostrados: [string, number][] = [];
  for (const [nome, n] of Object.entries(contagem).sort(([a, x], [b, y]) => y - x || a.localeCompare(b))) {
    // Nome longo demais vai direto para `outros`; limite e orçamento esgotados encerram a lista (o resto é menos frequente).
    if (nome.length > TAMANHO_MAXIMO_DE_RELATOR) {
      outros += n;
      continue;
    }
    cabe &&= mostrados.length < limite && nome.length <= orcamento;
    if (cabe) {
      mostrados.push([nome, n]);
      orcamento -= nome.length;
    } else outros += n;
  }
  return { valores: Object.fromEntries(mostrados), outros };
}

export function panorama(acordaos: readonly Acordao[]): Panorama {
  const porTribunal: Record<string, number> = Object.create(null);
  const porAno: Record<string, number> = Object.create(null);
  const orgaos: Record<string, Record<string, number>> = Object.create(null);
  const relatores: Record<
    string,
    { nomes: Record<string, number>; paraOAcordao: Record<string, number>; naoInformado: number }
  > = Object.create(null);
  const contados = new Set<string>();
  for (const a of acordaos) {
    // A memória aceita os ids de todas as cópias, mas devolve o mesmo id do registro juntado.
    if (contados.has(a.id)) continue;
    contados.add(a.id);
    contar(porTribunal, a.tribunal);
    contar(porAno, a.dataJulgamento?.slice(0, 4) || SEM_DATA);
    contar((orgaos[a.tribunal] ??= Object.create(null)), a.orgao || SEM_ORGAO);
    const r = (relatores[a.tribunal] ??= {
      nomes: Object.create(null),
      paraOAcordao: Object.create(null),
      naoInformado: 0,
    });
    if (!a.relator?.trim()) r.naoInformado++;
    else contar(RELATOR_PARA_O_ACORDAO.test(a.relator) ? r.paraOAcordao : r.nomes, a.relator);
  }
  const porOrgao: Panorama["porOrgao"] = {};
  for (const [tribunal, contagem] of Object.entries(orgaos)) {
    const ordem = Object.entries(contagem).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
    const outros = ordem.slice(ORGAOS_POR_TRIBUNAL).reduce((soma, [, n]) => soma + n, 0);
    porOrgao[tribunal] = {
      ...Object.fromEntries(ordem.slice(0, ORGAOS_POR_TRIBUNAL)),
      ...(outros && { outros }),
    };
  }
  const porRelator: Panorama["porRelator"] = {};
  const orcamento = Math.floor(ORCAMENTO_DE_RELATORES / (2 * Object.keys(relatores).length));
  for (const [tribunal, r] of Object.entries(relatores)) {
    porRelator[tribunal] = {
      relatores: maiores(r.nomes, RELATORES_POR_TRIBUNAL, orcamento),
      paraOAcordao: maiores(r.paraOAcordao, RELATORES_POR_TRIBUNAL, orcamento),
      naoInformado: r.naoInformado,
    };
  }
  return { total: contados.size, porTribunal, porAno, porOrgao, porRelator };
}
