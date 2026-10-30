/**
 * Panorama da amostra: contagens por tribunal, ano de julgamento, órgão e relator sobre acórdãos que uma busca já trouxe.
 * Só conta o que recebe; não chama fonte nenhuma e não estima o que falta.
 */

import type { Acordao } from "./busca.js";
import { ROTULO_TNU, ROTULO_TRF2, ROTULO_TRF4 } from "./tribunais.js";

/** Órgãos mostrados por tribunal: o resto soma em "outros", para a resposta ficar longe do teto de 25 mil caracteres. */
export const ORGAOS_POR_TRIBUNAL = 20;

export const SEM_DATA = "sem data";
export const SEM_ORGAO = "sem órgão informado";

/** Relatores mostrados por tribunal (e, à parte, relatores para o acórdão): o resto soma em `outros`. */
export const RELATORES_POR_TRIBUNAL = 20;
/** Nome de órgão ou de relator acima disso não é mostrado, só contado em `outros`: um texto desses não é nome. */
export const TAMANHO_MAXIMO_DE_NOME = 200;
/**
 * Teto, em caracteres do JSON, do panorama quando ele é chamado sozinho. Na resposta da ferramenta o teto do panorama é o
 * que sobra do TETO_DA_RESPOSTA depois dos campos que ele não controla (ver `respostaDoPanorama`). O que não cabe no teto
 * sai da lista e soma em `outros`: a contagem nunca se perde.
 */
export const TETO_DO_PANORAMA = 18_000;
/** Teto, em caracteres do JSON, da resposta inteira da ferramenta (a margem até os 25 mil do cliente cobre o envelope). */
export const TETO_DA_RESPOSTA = 24_500;
/** Do teto da resposta, o que a lista de ids fora da memória pode gastar: o resto dos ids vai por posição. */
export const ORCAMENTO_DOS_IDS_FORA_DA_MEMORIA = 4_000;

/** O aviso fixo de toda resposta do panorama: amostra da busca, não estatística. */
export const AVISO_DE_AMOSTRA =
  "Contagem só dos acórdãos informados, tirados de uma busca do Garimpo: é uma amostra da busca, não a estatística " +
  "do tribunal nem o total de julgados sobre o tema.";

/** Contagem de nomes: do mais frequente ao menos; o que passou dos maiores (ou não coube) soma em `outros`. */
export interface ContagemDeNomes {
  valores: Record<string, number>;
  outros: number;
}

export interface RelatoriaDoTribunal {
  /** Relator como a fonte o deu (grafias diferentes ficam separadas). */
  relatores: ContagemDeNomes;
  /** Só do e-Proc, no formato exato «<relator> (relator para o acórdão: <nome>)», com o texto original. */
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
 * qualquer outro texto não é separado.
 */
const RELATOR_PARA_O_ACORDAO = /^[^()\s](?:[^()]*[^()\s])? \(relator para o acórdão: [^()\s](?:[^()]*[^()\s])?\)$/;

/** Rótulo de fonte que só o adaptador do e-Proc grava, por tribunal (eproc.ts: `fonte: f.rotulo`). */
const ROTULO_DO_EPROC: Readonly<Record<string, string>> = { trf2: ROTULO_TRF2, trf4: ROTULO_TRF4, tnu: ROTULO_TNU };

/**
 * Só o registro que o e-Proc montou (tribunal e rótulo de fonte do próprio e-Proc) pode ter o relator para o acórdão
 * separado. Na JurisprudênciaIA e no Falcão o relator vem como a fonte o dá; se ela misturar os dois papéis num texto,
 * isso é não verificado e o panorama não tenta separar.
 */
const ehDoEproc = (a: Acordao) => Object.hasOwn(ROTULO_DO_EPROC, a.tribunal) && a.fonte === ROTULO_DO_EPROC[a.tribunal];

type Linha = [nome: string, n: number];
const porFrequencia = ([a, x]: Linha, [b, y]: Linha) => y - x || a.localeCompare(b);

/** Quanto a linha ocupa no JSON: o nome com os escapes, o número, os dois pontos e a vírgula. */
const custoNoJson = ([nome, n]: Linha) => JSON.stringify(nome).length + String(n).length + 2;

/**
 * Reparte um orçamento de caracteres entre várias listas de contagem, uma linha de cada lista por rodada (nenhuma lista
 * toma o orçamento das outras). Cada lista mostra no máximo `limite` linhas, sempre as mais frequentes em ordem: ao
 * esgotar o limite ou o orçamento ela para, e o resto soma em `outros`. Nome acima de TAMANHO_MAXIMO_DE_NOME não é
 * mostrado, mas não encerra a lista.
 */
function repartir(listas: readonly Linha[][], limite: number, orcamento: number): ContagemDeNomes[] {
  const ordenadas = listas.map((l) => [...l].sort(porFrequencia));
  const mostradas: Linha[][] = listas.map(() => []);
  const proxima = listas.map(() => 0);
  const outros = listas.map(() => 0);
  const aberta = listas.map(() => true);
  for (let rodada = 0; rodada < limite; rodada++) {
    ordenadas.forEach((linhas, i) => {
      while (aberta[i] && proxima[i] < linhas.length && linhas[proxima[i]][0].length > TAMANHO_MAXIMO_DE_NOME) {
        outros[i] += linhas[proxima[i]++][1];
      }
      if (!aberta[i] || proxima[i] >= linhas.length) return;
      const custo = custoNoJson(linhas[proxima[i]]);
      if (custo > orcamento) {
        aberta[i] = false;
        return;
      }
      orcamento -= custo;
      mostradas[i].push(linhas[proxima[i]++]);
    });
  }
  return ordenadas.map((linhas, i) => ({
    valores: Object.fromEntries(mostradas[i]),
    outros: outros[i] + linhas.slice(proxima[i]).reduce((soma, [, n]) => soma + n, 0),
  }));
}

const gasto = (listas: readonly ContagemDeNomes[]) =>
  listas.reduce((soma, l) => soma + Object.entries(l.valores).reduce((s, linha) => s + custoNoJson(linha), 0), 0);

/**
 * Conta a amostra. O JSON do resultado nunca passa de `teto` caracteres, desde que a casca (totais, anos e chaves) caiba:
 * as listas de nomes só mostram o que cabe e o resto soma em `outros`.
 */
export function panorama(acordaos: readonly Acordao[], teto = TETO_DO_PANORAMA): Panorama {
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
    else contar(ehDoEproc(a) && RELATOR_PARA_O_ACORDAO.test(a.relator) ? r.paraOAcordao : r.nomes, a.relator);
  }

  const tribunais = Object.keys(porTribunal);
  // A casca (totais, anos, chaves e "outros" de seis dígitos) é medida de verdade; o que sobra do teto vai para os nomes.
  const casca = JSON.stringify({
    total: contados.size,
    porTribunal,
    porAno,
    porOrgao: Object.fromEntries(tribunais.map((t) => [t, { outros: 999_999 }])),
    porRelator: Object.fromEntries(
      tribunais.map((t) => [
        t,
        {
          relatores: { valores: {}, outros: 999_999 },
          paraOAcordao: { valores: {}, outros: 999_999 },
          naoInformado: relatores[t].naoInformado,
        },
      ]),
    ),
  }).length;
  const sobra = Math.max(0, teto - casca);

  // A estimativa da casca é folgada, mas a medida final é a verdade: se o resultado passar do teto, tira o excesso do
  // espaço dos nomes e monta de novo (termina: o espaço só diminui).
  let folga = 0;
  for (;;) {
    const montado = montar(Math.max(0, sobra - folga));
    const excesso = JSON.stringify(montado).length - teto;
    if (excesso <= 0 || folga >= sobra) return montado;
    folga += excesso;
  }

  function montar(sobra: number): Panorama {
    // Órgãos ficam com até metade do que sobra; os relatores levam o resto, inclusive o que os órgãos não gastaram.
    const doOrgao = repartir(
      tribunais.map((t) => Object.entries(orgaos[t])),
      ORGAOS_POR_TRIBUNAL,
      Math.floor(sobra / 2),
    );
    const porOrgao: Panorama["porOrgao"] = {};
    tribunais.forEach((t, i) => {
      const { valores, outros } = doOrgao[i];
      porOrgao[t] = { ...valores };
      // Um órgão que se chama «outros» não pode sumir sob o resto: as duas contagens se somam na mesma chave.
      if (outros) porOrgao[t].outros = (porOrgao[t].outros ?? 0) + outros;
    });

    const doRelator = repartir(
      tribunais.flatMap((t) => [Object.entries(relatores[t].nomes), Object.entries(relatores[t].paraOAcordao)]),
      RELATORES_POR_TRIBUNAL,
      sobra - gasto(doOrgao),
    );
    const porRelator: Panorama["porRelator"] = {};
    tribunais.forEach((t, i) => {
      porRelator[t] = {
        relatores: doRelator[2 * i],
        paraOAcordao: doRelator[2 * i + 1],
        naoInformado: relatores[t].naoInformado,
      };
    });
    return { total: contados.size, porTribunal, porAno, porOrgao, porRelator };
  }
}

const AVISO_DE_FORA_DA_MEMORIA =
  "Os ids em foraDaMemoria não entraram na conta: refaça a busca que os trouxe e peça o panorama de novo.";
const AVISO_DE_IDS_SEM_ESPACO =
  " Os que não couberam na lista vêm em foraDaMemoriaSemEspaco, pela posição (a partir de 1) na lista de ids enviada, sem os repetidos.";

/** Id guardado fora da memória e a posição dele na lista de ids enviada (sem os repetidos, a partir de 1). */
export interface IdAusente {
  id: string;
  posicao: number;
}

/**
 * A resposta inteira da ferramenta: o panorama, os ids fora da memória, os avisos e o aviso de natureza jurídica. O
 * JSON dela nunca passa de TETO_DA_RESPOSTA: os campos que o panorama não controla são medidos (os ids ausentes têm
 * orçamento próprio; o que não cabe nele vai por posição) e o panorama recebe só o espaço que sobra.
 */
export function respostaDoPanorama(acordaos: readonly Acordao[], ausentes: readonly IdAusente[], avisoNaturezaJuridica: string) {
  const foraDaMemoria: string[] = [];
  const semEspaco: number[] = [];
  let gastoComIds = 0;
  for (const { id, posicao } of ausentes) {
    const custo = JSON.stringify(id).length + 1;
    if (gastoComIds + custo <= ORCAMENTO_DOS_IDS_FORA_DA_MEMORIA) {
      foraDaMemoria.push(id);
      gastoComIds += custo;
    } else semEspaco.push(posicao);
  }
  const resto = {
    foraDaMemoria,
    ...(semEspaco.length && { foraDaMemoriaSemEspaco: semEspaco }),
    avisoDeAmostra: AVISO_DE_AMOSTRA,
    ...(ausentes.length && { aviso: AVISO_DE_FORA_DA_MEMORIA + (semEspaco.length ? AVISO_DE_IDS_SEM_ESPACO : "") }),
    avisoNaturezaJuridica,
  };
  // Juntar dois objetos num só gasta um par de chaves a menos: {A} + {B} = {A,B}.
  const teto = TETO_DA_RESPOSTA - JSON.stringify(resto).length + 1;
  return { ...panorama(acordaos, teto), ...resto };
}
