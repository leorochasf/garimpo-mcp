/**
 * Linha de base de qualidade do banco de provas 1.2 (B0.2 do plano 1.2; docs/banco-de-provas/protocolo-1.2.md, seções 3
 * a 5), sem rede e sem disco: os pedidos dos estratos que rodam por script (E1 e E5), o teto de chamadas, a chave dos
 * repetidos, o pool cego do júri com os controles negativos, o sorteio da conferência do dono e a apuração dos votos.
 * Quem faz rede é scripts/rodarLinhaDeBase.ts; quem grava e lê o júri na pasta externa, scripts/juriDaLinhaDeBase.ts.
 *
 * Os pedidos saem só de arquivos congelados pela amostra (teses-propostas.md e amostra-1.2.json), pela regra fixa daqui:
 * o mesmo código monta os pedidos do braço 1.1.1 e do braço 1.2, então os dois braços recebem os mesmos pedidos.
 */

import { lerTeses, sorteio } from "./montarRodadaDeProvas.js";

export type Versao = "tecnica" | "leiga";
export type EstadoDaMemoria = "fria" | "quente" | "renovar";

export interface Pedido {
  /** Id legível ("e1-t01-tecnica", "e5-5trts-quente"): fica na pasta externa; o derivado leva só o hash dele. */
  id: string;
  estrato: "E1" | "E5";
  /** Pedidos do mesmo grupo dividem a memória: um servidor e uma pasta de memória novos por grupo. */
  grupo: string;
  /** Número da tese do banco (1 a 21) ou id da tese nova de E5 ("T01"). */
  tese: number | string;
  versao?: Versao;
  formulacoes: string[];
  tribunais: string[];
  /** Só em E5: o estado da memória pedido; "renovar" vai com renovar: true. */
  memoria?: EstadoDaMemoria;
}

/** Superiores na ordem do 2º duelo; "TJs" no documento vira estes três, até o teto de 5 tribunais da busca_ampla. */
const SUPERIORES = ["stf", "stj", "tst", "tse"] as const;
const TJS_DA_RODADA = ["tjsp", "tjmg", "tjrs"] as const;
/** TRTs e TRFs ficam fora de E1 (como no 2º duelo): TRT tem estrato próprio (E5), com o teto de páginas do Falcão. */
const MAXIMO_DE_TRIBUNAIS = 5;

/** Tribunais do pedido de E1, pela coluna "Tribunais" do documento ("STF, STJ, TJs" → stf, stj, tjsp, tjmg, tjrs). */
export function tribunaisDaRodada(doDocumento: string): string[] {
  const citados = new Set(doDocumento.toLowerCase().match(/\b(stf|stj|tst|tse)\b/g) ?? []);
  const lista: string[] = SUPERIORES.filter((t) => citados.has(t));
  if (/\btjs\b/i.test(doDocumento)) for (const tj of TJS_DA_RODADA) if (lista.length < MAXIMO_DE_TRIBUNAIS) lista.push(tj);
  if (lista.length === 0) throw new Error(`tribunais da rodada: nenhum tribunal reconhecido em "${doDocumento}"`);
  return lista;
}

export interface SecaoDaTese {
  numero: number;
  /** O enunciado ("- **Tese:**"), em uma linha: é o que o júri lê como a tese a fundamentar. */
  tese: string;
  tribunais: string;
  formulacoes: string[];
}

/** As seções "## N. Título" de teses-propostas.md: enunciado, tribunais e as três formulações alternativas. */
export function lerSecoes(markdown: string): SecaoDaTese[] {
  const secoes: SecaoDaTese[] = [];
  for (const bloco of markdown.split(/^## (?=\d+\. )/m).slice(1)) {
    const numero = Number(bloco.match(/^(\d+)\./)![1]);
    const campos = new Map<string, string[]>();
    let atual: string[] | undefined;
    for (const linha of bloco.split(/\r?\n/).slice(1)) {
      const campo = linha.match(/^- \*\*([^*]+):\*\*\s*(.*)$/);
      if (campo) campos.set(campo[1], (atual = [campo[2]]));
      else if (atual && /^\s+\S/.test(linha)) atual.push(linha.trim());
      else atual = undefined;
    }
    const juntar = (nome: string) => (campos.get(nome) ?? []).join(" ").replace(/\s+/g, " ").trim();
    const formulacoes = (campos.get("Formulações alternativas") ?? [])
      .map((l) => l.match(/^\d+\.\s+`([^`]+)`$/)?.[1])
      .filter((f): f is string => Boolean(f));
    const s = { numero, tese: juntar("Tese"), tribunais: juntar("Tribunais"), formulacoes };
    if (!s.tese || !s.tribunais || s.formulacoes.length !== 3)
      throw new Error(`teses-propostas.md: a seção ${numero} precisa de tese, tribunais e 3 formulações alternativas`);
    secoes.push(s);
  }
  if (secoes.length === 0) throw new Error("teses-propostas.md: nenhuma seção de tese lida");
  return secoes;
}

/**
 * E1: por tese, dois pedidos, cada um uma busca_ampla. Técnica = as 3 formulações alternativas do documento; leiga = a
 * versão leiga e o "só palavras" (o que o leigo escreveria). Os mesmos tribunais nos dois (tribunaisDaRodada).
 */
export function pedidosE1(markdown: string, teses: readonly number[]): Pedido[] {
  const versoes = new Map(lerTeses(markdown).map((t) => [t.numero, t]));
  const secoes = new Map(lerSecoes(markdown).map((s) => [s.numero, s]));
  return teses.flatMap((n): Pedido[] => {
    const s = secoes.get(n);
    const v = versoes.get(n);
    if (!s || !v) throw new Error(`teses-propostas.md: falta a tese ${n} (seção ou versão leiga)`);
    const tribunais = tribunaisDaRodada(s.tribunais);
    const id = (versao: Versao) => `e1-t${String(n).padStart(2, "0")}-${versao}`;
    return [
      { id: id("tecnica"), estrato: "E1", grupo: "e1", tese: n, versao: "tecnica", formulacoes: s.formulacoes, tribunais },
      { id: id("leiga"), estrato: "E1", grupo: "e1", tese: n, versao: "leiga", formulacoes: [v.leiga, v.palavras], tribunais },
    ];
  });
}

/** O estrato E5 como a amostra o congela (amostra-1.2.json, estratos.E5). */
export interface AmostraE5 {
  teses: number[];
  tesesNovas: { id: string; tecnica: string; contraria: string }[];
  cincoTrts: { tese: number; tribunais: string[]; formulacoes: number; rodadas: string[] };
}

/** Tribunais das teses de E5: o TST (pelo site) e dois TRTs (pelo Falcão); 2 TRTs × 2 formulações cabem nas 5 páginas. */
export const TRIBUNAIS_DAS_TESES_E5 = ["tst", "trt2", "trt15"] as const;

const MEMORIA_DA_AMOSTRA: Record<string, EstadoDaMemoria> = { "memória fria": "fria", "memória quente": "quente", renovar: "renovar" };

/**
 * E5 (TRT, P04): a tese 15 vai com a 1ª formulação do documento e, como contrária, a 3ª (ilicitude e vínculo com o
 * tomador); as teses novas, com a técnica e a contrária da amostra. Caso de 5 TRTs × 2 formulações: fria, quente e
 * renovar, nessa ordem, no mesmo grupo. Cada tese: fria e depois quente, num grupo próprio (memória vazia no início).
 */
export function pedidosE5(markdown: string, e5: AmostraE5): Pedido[] {
  const secoes = new Map(lerSecoes(markdown).map((s) => [s.numero, s]));
  const doBanco = (n: number) => {
    const s = secoes.get(n);
    if (!s) throw new Error(`teses-propostas.md: falta a seção da tese ${n}`);
    return [s.formulacoes[0], s.formulacoes[2]];
  };
  const caso = e5.cincoTrts;
  if (caso.formulacoes !== 2) throw new Error("amostra E5: o caso de 5 TRTs tem de ter 2 formulações");
  const rodadas = caso.rodadas.map((r) => {
    const m = MEMORIA_DA_AMOSTRA[r];
    if (!m) throw new Error(`amostra E5: rodada desconhecida "${r}"`);
    return m;
  });
  const pedidos: Pedido[] = rodadas.map((memoria) => ({
    id: `e5-5trts-${memoria}`,
    estrato: "E5",
    grupo: "e5-5trts",
    tese: caso.tese,
    formulacoes: doBanco(caso.tese),
    tribunais: [...caso.tribunais],
    memoria,
  }));
  const teses: { tese: number | string; formulacoes: string[] }[] = [
    ...e5.teses.map((n) => ({ tese: n, formulacoes: doBanco(n) })),
    ...e5.tesesNovas.map((t) => ({ tese: t.id, formulacoes: [t.tecnica, t.contraria] })),
  ];
  for (const t of teses) {
    const nome = typeof t.tese === "number" ? `t${String(t.tese).padStart(2, "0")}` : t.tese;
    for (const memoria of ["fria", "quente"] as const)
      pedidos.push({ id: `e5-${nome}-${memoria}`, estrato: "E5", grupo: `e5-${nome}`, tese: t.tese, formulacoes: t.formulacoes, tribunais: [...TRIBUNAIS_DAS_TESES_E5], memoria });
  }
  return pedidos;
}

/** Páginas do Falcão por chamada da busca_ampla (src/ampla.ts, PAGINAS_DO_FALCAO_POR_CHAMADA, igual na 1.1.1). */
const PAGINAS_DO_FALCAO = 5;
/** Folga para a nova tentativa de 429/503: a recusa de novo pausa o serviço e a rodada para, então sobra pouco. */
export const MARGEM_DO_TETO = 10;

const ehTrt = (t: string) => /^trt\d+$/.test(t);

/** O máximo de chamadas ao site e ao Falcão de um pedido, contando que nada venha da memória. */
export function chamadasNoMaximo(p: Pedido): number {
  const trts = p.tribunais.filter(ehTrt).length;
  const doSite = p.tribunais.length - trts;
  return p.formulacoes.length * doSite + Math.min(PAGINAS_DO_FALCAO, p.formulacoes.length * trts);
}

/** Teto da rodada: a soma dos máximos de cada pedido, mais a margem. Passou disso, o gravador não deixa sair nada. */
export function tetoDaRodada(pedidos: readonly Pedido[]): number {
  return pedidos.reduce((s, p) => s + chamadasNoMaximo(p), 0) + MARGEM_DO_TETO;
}

// ——— Júri ———

/** O acórdão como a rodada guardou (obter_ementa da busca): só o que o júri lê e o que a chave usa. */
export interface AcordaoDaRodada {
  id: string;
  tribunal: string;
  numero: string;
  numeroCnj?: string;
  classe?: string;
  dataJulgamento?: string;
  orgao?: string;
  ementa?: string;
}

const CNJ = /(?<!\d)(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})(?!\d)/;
const normalizarEmenta = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^\s*ementa\s*:?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Letras e algarismos, sem acento, pontuação nem a UF do fim: "AgInt no REsp 1.234.567/SP" → "agintnoresp1234567". */
const numeroNormalizado = (s: string) =>
  s.replace(/\/\s*[A-Za-z]{2}\s*$/, "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Identidade canônica do acórdão, a mesma no júri e no derivado (B02-R01/R02): tribunal + número + classe + data. Com
 * CNJ, os 20 dígitos e, à parte, o resto do número (a sigla do recurso, "EDcl no REsp …"); sem CNJ, o número inteiro
 * com a sigla (REsp e AREsp de mesmo número são dois acórdãos). A classe por extenso entra também, e a data separa
 * julgamentos do mesmo processo. Só pontuação, acento e UF não distinguem; na dúvida, não funde. Sem número: tribunal +
 * começo da ementa normalizada; sem ementa também, o id.
 */
export function chaveDoAcordao(a: AcordaoDaRodada): string {
  const data = (a.dataJulgamento ?? "").slice(0, 10);
  const classe = numeroNormalizado(a.classe ?? "").replace(/\d/g, "");
  const numero = a.numero ?? "";
  const cnj = [a.numeroCnj, numero].filter(Boolean).join(" ").match(CNJ);
  if (cnj) return `${a.tribunal}|cnj:${cnj.slice(1).join("")}|${numeroNormalizado(numero.replace(new RegExp(CNJ, "g"), " "))}|${classe}|${data}`;
  if (numeroNormalizado(numero)) return `${a.tribunal}|n:${numeroNormalizado(numero)}|${classe}|${data}`;
  const ementa = normalizarEmenta(a.ementa ?? "").slice(0, 200);
  return ementa ? `${a.tribunal}|em:${ementa}` : `${a.tribunal}|id:${a.id}`;
}

/** Número como o júri lê: com a classe na frente quando o número não a traz. */
export const numeroExibido = (a: AcordaoDaRodada) =>
  a.classe && a.numero && !a.numero.toLowerCase().includes(a.classe.toLowerCase()) ? `${a.classe} ${a.numero}` : a.numero ?? "";

/** Um acórdão real da lista unificada de uma tese: a chave, os dados do acórdão e os pedidos que o trouxeram. */
export interface ItemDaTese {
  chave: string;
  acordao: AcordaoDaRodada;
  /** Referências `<braço>/<pedido>` (refDoPedido). */
  pedidos: string[];
}

/** Um acórdão entregue, como resultados.json guarda (scripts/rodarLinhaDeBase.ts). */
export interface ItemEntregue {
  id?: string;
  numero: string;
  tribunal: string;
  data?: string;
  orgao?: string;
}

/** Um pedido como resultados.json guarda: só o que o júri usa. */
export interface ResultadoDaRodada {
  id: string;
  estrato: string;
  tese: number | string;
  erro?: string;
  mostrados?: number;
  acordaos?: ItemEntregue[];
}

/** ementas.json: o obter_ementa de cada acórdão entregue em E1, pelo id (ou o erro dele). */
export type Ementas = Record<string, AcordaoDaRodada & { erro?: string }>;

/** A rodada de um braço (a pasta que rodarLinhaDeBase.ts gravou), com o rótulo do braço: o commit dele. */
export interface RodadaDoJuri {
  braco: string;
  resultados: readonly ResultadoDaRodada[];
  ementas: Ementas;
}

/** O pedido de um braço, como o reservado/ e a apuração o chamam: os braços rodam os mesmos pedidos. */
export const refDoPedido = (braco: string, pedido: string) => `${braco}/${pedido}`;

/** O acórdão de um item entregue: o obter_ementa dele, ou, se falhou, o que a lista trouxe (sem ementa). */
export function acordaoDoItem(item: ItemEntregue, ementas: Ementas): AcordaoDaRodada {
  const e = item.id === undefined ? undefined : ementas[item.id];
  if (e && !e.erro) return e;
  return { id: item.id ?? "", tribunal: item.tribunal, numero: item.numero, dataJulgamento: item.data, orgao: item.orgao, ementa: "" };
}

/**
 * A lista unificada de cada tese de E1, sem repetidos pela chave canônica, juntando os pedidos de todos os braços
 * (cobertura relativa mede contra essa união julgada, protocolo 1.2, seção 1). Pedido com erro fica fora. O mesmo
 * acórdão por dois caminhos fica com o campo mais completo de cada um, sem dizer de onde veio.
 */
export function listaUnificada(rodadas: readonly RodadaDoJuri[]): Map<number, ItemDaTese[]> {
  const maior = (x?: string, y?: string) => ((y ?? "").length > (x ?? "").length ? y : x);
  const porTese = new Map<number, Map<string, ItemDaTese>>();
  for (const { braco, resultados, ementas } of rodadas)
    for (const r of resultados.filter((x) => x.estrato === "E1" && !x.erro)) {
      const tese = r.tese as number;
      if (!porTese.has(tese)) porTese.set(tese, new Map());
      const daTese = porTese.get(tese)!;
      for (const item of r.acordaos ?? []) {
        const a = acordaoDoItem(item, ementas);
        const chave = chaveDoAcordao(a);
        const ref = refDoPedido(braco, r.id);
        const ja = daTese.get(chave);
        if (!ja) daTese.set(chave, { chave, acordao: { ...a }, pedidos: [ref] });
        else {
          if (!ja.pedidos.includes(ref)) ja.pedidos.push(ref);
          for (const c of ["numero", "orgao", "ementa", "dataJulgamento", "classe"] as const) ja.acordao[c] = maior(ja.acordao[c], a[c]) as string;
        }
      }
    }
  return new Map([...porTese].sort(([a], [b]) => a - b).map(([n, m]) => [n, [...m.values()]]));
}

/** Linha do pool cego: nada diz de qual pedido ou braço veio, nem se é controle. */
export interface LinhaDoPool {
  id: string;
  tese: number;
  tribunal: string;
  numero: string;
  data: string;
  orgao: string;
  ementa: string;
}

/** O que só a pasta reservado/ sabe de cada linha. */
export interface LinhaReservada {
  id: string;
  tese: number;
  chave: string;
  pedidos: string[];
  /** Só nos controles negativos: a tese de onde o acórdão veio (apresentado sob a tese errada; esperado N). */
  controleDaTese?: number;
}

export interface Pool {
  linhas: LinhaDoPool[];
  reservado: LinhaReservada[];
}

function embaralharCom<T>(lista: readonly T[], r: () => number): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Pares de teses próximas demais para servir de controle negativo uma da outra: o acórdão de uma pode servir de verdade
 * à outra, e o controle deixaria de medir o júri (2º duelo: 10 × 11).
 */
export const TESES_VIZINHAS: readonly [number, number][] = [
  [1, 2], [1, 3], [2, 3], [4, 5], [5, 6], [7, 8], [7, 9], [10, 11], [10, 12], [11, 12], [12, 13], [12, 14], [13, 14],
];

/**
 * Pool cego (protocolo 1.2, seção 5; mesmo método do 2º duelo): por tese, a lista unificada sem repetidos mais cerca de
 * 10% de controles negativos — acórdão real de outra tese, com ementa, apresentado sob a tese errada, cada um uma vez,
 * nunca sob tese vizinha nem sob uma tese que já tem o mesmo acórdão —, embaralhada com a semente. Ids J-0001… na ordem.
 */
export function montarPool(
  porTese: ReadonlyMap<number, readonly ItemDaTese[]>,
  { semente, vizinhas = TESES_VIZINHAS }: { semente: number; vizinhas?: readonly [number, number][] },
): Pool {
  const r = sorteio(semente);
  const teses = [...porTese.keys()];
  const reais = teses.reduce((s, n) => s + porTese.get(n)!.length, 0);
  const quantos = Math.round(reais / 9);
  const vizinha = (a: number, b: number) => vizinhas.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const controles: { alvo: number; origem: number; item: ItemDaTese }[] = [];
  for (const { n, item } of embaralharCom(teses.flatMap((n) => porTese.get(n)!.map((item) => ({ n, item }))), r)) {
    if (controles.length >= quantos) break;
    if (!item.acordao.ementa?.trim()) continue;
    const alvos = teses.filter((m) => m !== n && !vizinha(m, n) && !porTese.get(m)!.some((y) => y.chave === item.chave));
    if (alvos.length === 0) continue;
    controles.push({ alvo: alvos[Math.floor(r() * alvos.length)], origem: n, item });
  }
  const linhas: LinhaDoPool[] = [];
  const reservado: LinhaReservada[] = [];
  for (const n of teses) {
    const daTese = [
      ...porTese.get(n)!.map((item) => ({ item, origem: undefined as number | undefined })),
      ...controles.filter((c) => c.alvo === n).map((c) => ({ item: c.item, origem: c.origem as number | undefined })),
    ];
    for (const { item, origem } of embaralharCom(daTese, r)) {
      const id = `J-${String(linhas.length + 1).padStart(4, "0")}`;
      const a = item.acordao;
      linhas.push({
        id,
        tese: n,
        tribunal: a.tribunal.toUpperCase(),
        numero: numeroExibido(a),
        data: (a.dataJulgamento ?? "").slice(0, 10),
        orgao: a.orgao ?? "",
        ementa: a.ementa ?? "",
      });
      reservado.push({ id, tese: n, chave: item.chave, pedidos: origem === undefined ? item.pedidos : [], ...(origem !== undefined && { controleDaTese: origem }) });
    }
  }
  return { linhas, reservado };
}

/**
 * Conferência do dono, parte (a) de D10: linhas reais (nunca controles) sorteadas com a semente ANTES de o júri rodar,
 * independentes do que o júri decidir. Fluxo de sorteio próprio, separado do que embaralha o pool.
 */
export function sortearConferencia(reservado: readonly LinhaReservada[], { semente, quantas = 20 }: { semente: number; quantas?: number }): string[] {
  const reais = reservado.filter((l) => l.controleDaTese === undefined).map((l) => l.id);
  return embaralharCom(reais, sorteio(semente + 1)).slice(0, quantas).sort();
}

/** Lotes de leitura do júri: nunca misturam teses (o enunciado vai uma vez por lote), até `tamanho` linhas cada. */
export function lotesDoPool(linhas: readonly LinhaDoPool[], tamanho = 25): LinhaDoPool[][] {
  const lotes: LinhaDoPool[][] = [];
  for (const l of linhas) {
    const ultimo = lotes.at(-1);
    if (ultimo && ultimo.length < tamanho && ultimo[0].tese === l.tese) ultimo.push(l);
    else lotes.push([l]);
  }
  return lotes;
}

// ——— Apuração ———

export type Letra = "S" | "P" | "C" | "N";
export const LETRAS: readonly Letra[] = ["S", "P", "C", "N"];
export type Veredito = Letra | "sem maioria";

export interface Voto {
  id: string;
  letra: Letra;
  motivo: string;
}

/** Ids em que os dois jurados principais deram letras diferentes: vão ao desempate. */
export function paraDesempate(a: ReadonlyMap<string, Voto>, b: ReadonlyMap<string, Voto>): string[] {
  return [...a.keys()].filter((id) => b.has(id) && a.get(id)!.letra !== b.get(id)!.letra).sort();
}

/**
 * Veredito por linha: os dois concordam → a letra; senão, a maioria dos três com o desempate; três letras diferentes
 * (ou desempate faltando) → "sem maioria", contado depois nos dois limites (pessimista N, otimista S).
 */
export function apurar(
  ids: readonly string[],
  a: ReadonlyMap<string, Voto>,
  b: ReadonlyMap<string, Voto>,
  c: ReadonlyMap<string, Voto> = new Map(),
): Map<string, Veredito> {
  const saida = new Map<string, Veredito>();
  for (const id of ids) {
    const [va, vb, vc] = [a.get(id)?.letra, b.get(id)?.letra, c.get(id)?.letra];
    if (!va || !vb) throw new Error(`apuração: a linha ${id} não tem os votos dos dois jurados principais`);
    saida.set(id, va === vb ? va : vc && (vc === va || vc === vb) ? vc : "sem maioria");
  }
  return saida;
}

export interface Contagem {
  S: number;
  P: number;
  C: number;
  N: number;
  semMaioria: number;
}

const zerada = (): Contagem => ({ S: 0, P: 0, C: 0, N: 0, semMaioria: 0 });
const somar = (c: Contagem, v: Veredito) => {
  if (v === "sem maioria") c.semMaioria++;
  else c[v]++;
};

export interface Apuracao {
  /** Controles negativos: quantos, e quantos o júri julgou N (tem de ser todos para a medida valer). */
  controles: { total: number; julgadosN: number; falhos: string[] };
  /** Por pedido, só as linhas reais que o pedido trouxe. */
  porPedido: Map<string, Contagem>;
  /** Por tese, a lista unificada (sem controles). */
  porTese: Map<number, Contagem>;
}

export function contarVereditos(reservado: readonly LinhaReservada[], vereditos: ReadonlyMap<string, Veredito>): Apuracao {
  const porPedido = new Map<string, Contagem>();
  const porTese = new Map<number, Contagem>();
  const falhos: string[] = [];
  let controles = 0;
  for (const l of reservado) {
    const v = vereditos.get(l.id);
    if (v === undefined) throw new Error(`apuração: a linha ${l.id} não tem veredito`);
    if (l.controleDaTese !== undefined) {
      controles++;
      if (v !== "N") falhos.push(l.id);
      continue;
    }
    if (!porTese.has(l.tese)) porTese.set(l.tese, zerada());
    somar(porTese.get(l.tese)!, v);
    for (const p of l.pedidos) {
      if (!porPedido.has(p)) porPedido.set(p, zerada());
      somar(porPedido.get(p)!, v);
    }
  }
  return { controles: { total: controles, julgadosN: controles - falhos.length, falhos }, porPedido, porTese };
}

/**
 * O veredito de cada acórdão que o pedido entregou, na ordem da lista (posição 1 primeiro): a chave do item, na tese do
 * pedido, leva à linha real do pool. Item sem linha é erro: o pool foi montado de outra rodada.
 */
export function vereditosNaOrdem(
  tese: number,
  chaves: readonly string[],
  reservado: readonly LinhaReservada[],
  vereditos: ReadonlyMap<string, Veredito>,
): Veredito[] {
  const linhas = new Map(reservado.filter((l) => l.tese === tese && l.controleDaTese === undefined).map((l) => [l.chave, l.id]));
  return chaves.map((chave, i) => {
    const v = vereditos.get(linhas.get(chave) ?? "");
    if (v === undefined) throw new Error(`apuração: o ${i + 1}º acórdão entregue sob a tese ${tese} não está no pool julgado`);
    return v;
  });
}

export const contar = (vs: Iterable<Veredito>): Contagem => {
  const c = zerada();
  for (const v of vs) somar(c, v);
  return c;
};

/** Os dois limites do "sem maioria" (protocolo 1.2, seção 5); null quando o denominador é zero. */
export interface Limites {
  pessimista: number | null;
  otimista: number | null;
}

const razao = (num: number, den: number) => (den > 0 ? num / den : null);
const julgadas = (c: Contagem) => c.S + c.P + c.C + c.N + c.semMaioria;

/** Precisão sobre as posições: "sem maioria" não serve no limite pessimista e serve como S no otimista. */
const precisaoDe = (c: Contagem, serve: (c: Contagem) => number): Limites => ({
  pessimista: razao(serve(c), julgadas(c)),
  otimista: razao(serve(c) + c.semMaioria, julgadas(c)),
});

export interface MedidaDoPedido {
  entregues: number;
  /** Veredito de cada entregue, na ordem da lista. */
  vereditos: Veredito[];
  /** Por posição: todas e as 10 primeiras. */
  todos: Contagem;
  dezPrimeiros: Contagem;
  /** Por acórdão distinto (a chave): o numerador da cobertura. */
  distintos: Contagem;
  /** A lista unificada julgada da tese (todos os braços do pool): o denominador da cobertura. */
  uniaoDaTese: Contagem;
  precisao: { ampla: Limites; estrita: Limites; amplaNosDez: Limites; estritaNosDez: Limites };
  cobertura: Limites;
}

/**
 * As medidas do pedido (protocolo 1.2, seções 1 e 5), com as contas fixadas aqui:
 * - precisão ampla = (S+P) ÷ entregues; estrita = S ÷ entregues; as mesmas nas 10 primeiras posições. C (relevante do
 *   lado contrário) nunca entra no numerador: fica no denominador e é contado à parte, em `todos.C`.
 * - cobertura relativa = (S+P) distintos do pedido ÷ (S+P) da união julgada da tese. Os limites são os extremos de
 *   decidir cada "sem maioria": pessimista, o que o pedido trouxe não serve e o que ele deixou de fora serve; otimista,
 *   o contrário.
 */
export function medirPedido(vereditos: readonly Veredito[], distintos: Contagem, uniaoDaTese: Contagem): MedidaDoPedido {
  const todos = contar(vereditos);
  const dezPrimeiros = contar(vereditos.slice(0, 10));
  const amplo = (c: Contagem) => c.S + c.P;
  const fora = uniaoDaTese.semMaioria - distintos.semMaioria;
  return {
    entregues: vereditos.length,
    vereditos: [...vereditos],
    todos,
    dezPrimeiros,
    distintos,
    uniaoDaTese,
    precisao: {
      ampla: precisaoDe(todos, amplo),
      estrita: precisaoDe(todos, (c) => c.S),
      amplaNosDez: precisaoDe(dezPrimeiros, amplo),
      estritaNosDez: precisaoDe(dezPrimeiros, (c) => c.S),
    },
    cobertura: {
      pessimista: razao(amplo(distintos), amplo(uniaoDaTese) + fora),
      otimista: razao(amplo(distintos) + distintos.semMaioria, amplo(uniaoDaTese) + distintos.semMaioria),
    },
  };
}

/**
 * E2 (U16), pela regra congelada na amostra: tese de E1 cujo pedido técnico (a 1ª rodada do jurista) entregou ≥ 30
 * acórdãos e, entre os julgados, ≥ 80% S+P e nenhum C. "Sem maioria" conta contra no limite pessimista (não é S+P) e não
 * vira C. Do braço pedido (a linha de base: o da 1.1.1); `entregues` pelo id do pedido.
 */
export function tesesDeE2(braco: string, pedidos: readonly Pedido[], entregues: ReadonlyMap<string, number>, apuracao: Apuracao): number[] {
  return pedidos
    .filter((p) => p.estrato === "E1" && p.versao === "tecnica")
    .filter((p) => {
      const c = apuracao.porPedido.get(refDoPedido(braco, p.id));
      const julgados = c ? c.S + c.P + c.C + c.N + c.semMaioria : 0;
      return (entregues.get(p.id) ?? 0) >= 30 && julgados > 0 && (c!.S + c!.P) / julgados >= 0.8 && c!.C === 0;
    })
    .map((p) => p.tese as number);
}

/**
 * Conferência do dono, parte (b) de D10, para E1: até 20 casos de dúvida do júri, nesta ordem — controle negativo que
 * não saiu N, linha sem maioria, veredito C (decide E2). Os casos críticos de E3–E6 (identidade, literalidade, origem,
 * atribuição, armadilha, "diferente" sem prova) entram quando esses estratos rodarem. Passou de 20, `excedeu` avisa.
 */
export function casosParaODono(apuracao: Apuracao, reservado: readonly LinhaReservada[], vereditos: ReadonlyMap<string, Veredito>, teto = 20) {
  const reais = reservado.filter((l) => l.controleDaTese === undefined);
  const casos = [
    ...apuracao.controles.falhos.map((id) => ({ id, motivo: "controle negativo que o júri não julgou N" })),
    ...reais.filter((l) => vereditos.get(l.id) === "sem maioria").map((l) => ({ id: l.id, motivo: "sem maioria no júri" })),
    ...reais.filter((l) => vereditos.get(l.id) === "C").map((l) => ({ id: l.id, motivo: "veredito C (contra): decide a lista de E2" })),
  ];
  return { casos: casos.slice(0, teto), excedeu: casos.length > teto, total: casos.length };
}
