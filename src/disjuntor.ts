/**
 * Disjuntor por serviço (ADR-0009): as regras, sem disco nem rede. A coordenação guarda o estado de cada serviço
 * (em arquivo, comum a todas as janelas; ou em memória, nos testes do cliente) e aplica estas duas funções sob a
 * trava: `decidirSaida` antes de cada saída e `aplicarResultado` depois de cada recusa ou de cada resposta à
 * nova tentativa ou à chamada de prova.
 *
 * - Primeiro 429/503: todos esperam até T; só a chamada recusada faz a única nova tentativa. Se o dono dela
 *   morrer, a tentativa não passa a ninguém: vencido T, as chamadas seguem normalmente.
 * - Recusa final: o serviço fica pausado (1 min, dobrando a cada abertura até 60 min; o pedido do serviço
 *   prevalece se for maior). Recusas da mesma pausa contam como uma abertura.
 * - Vencida a pausa, uma só chamada de prova; só ela fecha o disjuntor e zera a dobra. Resposta de chamada que
 *   saiu antes de uma abertura (ou de um fechamento) nunca altera o estado atual.
 * - Adiamento (só o DJEN): o serviço pediu para esperar mais que o teto, e o Garimpo respeita sem tratar como recusa:
 *   as chamadas falham na hora até o instante pedido, sem abrir nem dobrar o disjuntor; vencido, a primeira chamada
 *   é a única nova tentativa (recusada, abre o disjuntor).
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

/** Quem faz a nova tentativa ou a chamada de prova: o processo e a chamada. */
export interface Chamada {
  pid: number;
  maquina: string;
  id: string;
}

export interface Pausa {
  ate: number;
  /** A mensagem da recusa final, repetida a quem for barrado pela pausa. */
  aviso: string;
}

export interface Disjuntor {
  /** Muda a cada abertura e a cada fechamento pela prova. */
  geracao: number;
  /** Aberturas desde a última prova aceita: a dobra da pausa. */
  aberturas: number;
  /** Primeiro 429/503: todos esperam até `ate`; só `dono` faz a nova tentativa. */
  espera?: { ate: number; dono: Chamada };
  /** Aberto: chamadas falham na hora até `ate`; depois, aguarda a chamada de prova. */
  pausa?: Pausa;
  /** Chamada de prova em andamento. */
  prova?: Chamada;
  /** Depois de uma prova com erro sem recusa, a próxima prova só sai a partir deste instante. */
  proximaProvaEm?: number;
  /** Adiado pelo serviço (não é recusa): chamadas falham na hora até `ate`; depois, a primeira é a nova tentativa. */
  adiada?: Pausa;
}

type Papel = "normal" | "tentativa" | "prova";

/** Com que papel e em que geração do disjuntor a chamada saiu. */
export interface Saida {
  papel: Papel;
  geracao: number;
}

export type Ordem =
  | { tipo: "sai"; saida: Saida }
  /** Esperar sem vaga e perguntar de novo: pela decisão do disjuntor ou pela pausa do host. */
  | { tipo: "espera"; ms: number; motivo: "disjuntor" | "host" }
  | { tipo: "pausado"; ate: number; aviso: string }
  /** O serviço pediu para esperar até `ate` (não é recusa). */
  | { tipo: "adiado"; ate: number }
  /** A pausa venceu, mas esta ferramenta já fez a sua chamada de prova. */
  | { tipo: "sem-prova" };

export type Resultado =
  | { tipo: "aceita" }
  /** Erro sem recusa ou tempo esgotado: nunca conta como recusa. */
  | { tipo: "erro" }
  /** Primeiro 429/503, com a espera já calculada. */
  | { tipo: "pede-espera"; ms: number }
  /** A chamada que levou o 429/503 desistiu antes da nova tentativa (cancelada, sem vaga, rede parada). */
  | { tipo: "desistiu" }
  /** A nova tentativa recusada, 403, desafio anti-robô, pedido acima do teto ou a prova recusada. */
  | { tipo: "recusa-final"; pausaPedidaMs: number; aviso: string }
  /** Pedido de espera acima do teto, num serviço que adia em vez de recusar (DJEN): adiamento até `ate`. */
  | { tipo: "adia"; ate: number; aviso: string };

const PAUSA_INICIAL_MS = 60_000;
/** Teto da parte que dobra; o pedido do serviço (Retry-After) pode passar dele. */
const PAUSA_MAXIMA_DOBRADA_MS = 60 * 60_000;
/** Intervalo com que quem espera uma decisão (nova tentativa ou prova de outro) confere o estado. */
const CONFERENCIA_MS = 250;

/**
 * O serviço de uma URL, por regra central (nunca por rota nem por janela): o JurisprudênciaIA, o DataJud, o DJEN, cada
 * tribunal pelo domínio `<sigla>.jus.br`; qualquer outro endereço é o próprio host (com a porta).
 */
export function servicoDe(url: string): string {
  const { host, hostname: nome } = new URL(url);
  if (/(^|\.)jurisprudenciaia\.com\.br$/i.test(nome)) return "jurisprudenciaia";
  // A API e a wiki do DataJud são um serviço só, com nome próprio (o domínio daria "cnj").
  if (/^(api-publica\.datajud|datajud-wiki)\.cnj\.jus\.br$/i.test(nome)) return "datajud";
  // O DJEN tem limite próprio por IP: nome próprio (o domínio daria "pje").
  if (/^comunicaapi\.pje\.jus\.br$/i.test(nome)) return "djen";
  const tribunal = nome.toLowerCase().match(/(?:^|\.)([a-z0-9-]+)\.jus\.br$/);
  return tribunal ? tribunal[1] : host.toLowerCase();
}

/**
 * Espera mínima antes da nova tentativa: o TSE recusa chamadas com menos de 10 s de intervalo; o DJEN orienta
 * "aguardar 1 minuto" depois de um 429.
 */
export function esperaMinimaDe(servico: string): number {
  if (servico === "tse") return 10_000;
  return servico === "djen" ? 60_000 : 0;
}

/** Espera depois de uma prova com erro sem recusa, antes de permitir outra prova. */
const esperaEntreProvas = (servico: string) => Math.max(5_000, esperaMinimaDe(servico));

export function novaChamada(): Chamada {
  return { pid: process.pid, maquina: hostname(), id: randomUUID() };
}

/**
 * O que a chamada faz agora. `novo` é o estado a gravar se ela sair (a prova fica registrada; a espera de dono
 * comprovadamente morto, apagada). `morto` só é verdadeiro com prova de que o processo não existe.
 */
export function decidirSaida(
  d: Disjuntor | undefined,
  chamada: Chamada,
  agora: number,
  provaPermitida: boolean,
  morto: (c: Chamada) => boolean,
): { ordem: Ordem; novo?: Disjuntor } {
  const geracao = d?.geracao ?? 0;
  if (!d) return { ordem: { tipo: "sai", saida: { papel: "normal", geracao } } };
  if (d.pausa) {
    if (agora < d.pausa.ate) return { ordem: { tipo: "pausado", ate: d.pausa.ate, aviso: d.pausa.aviso } };
    if (d.prova && d.prova.id !== chamada.id && !morto(d.prova)) return esperar(CONFERENCIA_MS);
    if (!provaPermitida) return { ordem: { tipo: "sem-prova" } };
    if (d.proximaProvaEm !== undefined && agora < d.proximaProvaEm) return esperar(d.proximaProvaEm - agora);
    const novo: Disjuntor = { ...d, prova: chamada };
    delete novo.proximaProvaEm;
    return { ordem: { tipo: "sai", saida: { papel: "prova", geracao } }, novo };
  }
  if (d.adiada) {
    if (agora < d.adiada.ate) return { ordem: { tipo: "adiado", ate: d.adiada.ate } };
    // Vencido o adiamento, esta chamada é a única nova tentativa: as outras esperam a decisão dela.
    const novo: Disjuntor = { ...d, espera: { ate: agora, dono: chamada } };
    delete novo.adiada;
    return { ordem: { tipo: "sai", saida: { papel: "tentativa", geracao } }, novo };
  }
  if (d.espera) {
    if (d.espera.dono.id === chamada.id) return { ordem: { tipo: "sai", saida: { papel: "tentativa", geracao } } };
    if (agora < d.espera.ate) return esperar(d.espera.ate - agora);
    if (!morto(d.espera.dono)) return esperar(CONFERENCIA_MS);
    const novo: Disjuntor = { ...d };
    delete novo.espera;
    return { ordem: { tipo: "sai", saida: { papel: "normal", geracao } }, novo };
  }
  return { ordem: { tipo: "sai", saida: { papel: "normal", geracao } } };
}

const esperar = (ms: number): { ordem: Ordem } => ({ ordem: { tipo: "espera", ms, motivo: "disjuntor" } });

/**
 * Aplica o resultado de uma chamada ao estado (o mesmo objeto, se nada muda). Resposta de outra geração (saiu
 * antes de uma abertura ou de um fechamento) não muda nada.
 */
export function aplicarResultado(
  d: Disjuntor | undefined,
  chamada: Chamada,
  saida: Saida,
  r: Resultado,
  agora: number,
  servico: string,
): Disjuntor | undefined {
  const base: Disjuntor = d ?? { geracao: 0, aberturas: 0 };
  const minhaProva = saida.papel === "prova" && base.prova?.id === chamada.id && saida.geracao === base.geracao;
  const minhaTentativa = saida.papel === "tentativa" && base.espera?.dono.id === chamada.id;
  switch (r.tipo) {
    case "aceita":
      if (minhaProva) return { geracao: base.geracao + 1, aberturas: 0 };
      if (minhaTentativa) return semEspera(base);
      return d;
    case "erro":
      if (minhaProva) {
        const novo: Disjuntor = { ...base, proximaProvaEm: agora + esperaEntreProvas(servico) };
        delete novo.prova;
        return novo;
      }
      if (minhaTentativa) return semEspera(base);
      return d;
    case "pede-espera":
      // Já há espera de outra chamada (ou pausa): esta só espera a decisão; a nova tentativa é da outra.
      if (saida.geracao !== base.geracao || base.pausa || base.espera) return d;
      return { ...base, espera: { ate: agora + r.ms, dono: chamada } };
    case "adia": {
      if (saida.geracao !== base.geracao || base.pausa) return d;
      const novo: Disjuntor = { ...base, adiada: { ate: r.ate, aviso: r.aviso } };
      delete novo.espera;
      return novo;
    }
    case "desistiu":
      // A nova tentativa não vai sair: as outras chamadas não esperam por ela.
      return base.espera?.dono.id === chamada.id ? semEspera(base) : d;
    case "recusa-final": {
      const abre = saida.geracao === base.geracao && (saida.papel === "prova" ? minhaProva : !base.pausa);
      if (!abre) return d;
      const aberturas = base.aberturas + 1;
      const dobrada = Math.min(PAUSA_MAXIMA_DOBRADA_MS, PAUSA_INICIAL_MS * 2 ** (aberturas - 1));
      const ate = agora + Math.max(dobrada, r.pausaPedidaMs);
      return { geracao: base.geracao + 1, aberturas, pausa: { ate, aviso: r.aviso } };
    }
  }
}

function semEspera(d: Disjuntor): Disjuntor {
  const novo = { ...d };
  delete novo.espera;
  return novo;
}

/** Confere o formato de um disjuntor lido do estado compartilhado. */
export function disjuntorValido(d: unknown): d is Disjuntor {
  const x = d as Disjuntor;
  const numero = (v: unknown) => Number.isFinite(v);
  const chamada = (c: unknown) =>
    typeof c === "object" && c !== null && Number.isInteger((c as Chamada).pid) && typeof (c as Chamada).id === "string";
  return (
    typeof x === "object" &&
    x !== null &&
    Number.isInteger(x.geracao) &&
    Number.isInteger(x.aberturas) &&
    (x.espera === undefined || (numero(x.espera.ate) && chamada(x.espera.dono))) &&
    (x.pausa === undefined || (numero(x.pausa.ate) && typeof x.pausa.aviso === "string")) &&
    (x.adiada === undefined || (numero(x.adiada.ate) && typeof x.adiada.aviso === "string")) &&
    (x.prova === undefined || chamada(x.prova)) &&
    (x.proximaProvaEm === undefined || numero(x.proximaProvaEm))
  );
}
