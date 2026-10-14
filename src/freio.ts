/**
 * Freio preventivo (ADR-0018): as regras, sem disco nem rede. No Falcão, o 429 já é o IP bloqueado por horas; por isso
 * o Garimpo para ANTES, pelo restante que o próprio Falcão informa em cada resposta (`x-rate-limit-remaining`). A
 * coordenação guarda o freio de cada serviço no estado compartilhado (todas as janelas) e aplica estas duas funções
 * sob a trava: `decidirFreio` antes de cada saída e `anotarRestante` depois de cada resposta (ou da falta dela).
 *
 * - Cada chamada reserva uma unidade do restante conhecido antes de sair: duas janelas não gastam a mesma folga. O
 *   número que chega numa resposta ainda desconta as reservas das chamadas em voo.
 * - Restante na reserva (10) ou abaixo = pausa preventiva de 15 min em todas as janelas. Não é recusa: não abre o
 *   disjuntor nem dobra.
 * - Vencida a pausa, o próximo pedido do usuário libera UMA chamada entre todas as janelas: restante acima da reserva
 *   retoma; na reserva, ausente ou inválido = mais 15 min. Nenhuma sondagem automática: sem pedido, nada sai.
 * - Números iniciais (spec do B12); a prova do ticket 01 viu um balde de ~40 que recarga em segundos, sem janela
 *   comprovada: a pausa é folgada de propósito.
 *
 * Fonte que não informa o restante tem outro freio, o orçamento por janela (G-05, DQ-25): um limite próprio de
 * chamadas por janela de tempo, somadas em todas as janelas do Garimpo. No limite, a chamada não sai até o fim da
 * janela (pausa preventiva, sem abrir o disjuntor). Recusa da fonte alarga a janela um degrau da escada; 20
 * chamadas aceitas afrouxam um degrau. Números por fonte: configuração do cliente, iniciais e sem prova.
 */

import type { Chamada } from "./disjuntor.js";

export const RESERVA_DO_FREIO = 10;
export const PAUSA_PREVENTIVA_MS = 15 * 60_000;
/** Cabeçalho do restante que o Falcão informa em cada resposta da API. */
export const CABECALHO_DO_RESTANTE = "x-rate-limit-remaining";
/** Intervalo com que quem espera a chamada de liberação de outra janela confere o estado. */
const CONFERENCIA_MS = 250;

export interface Freio {
  /** Último restante conhecido, menos as chamadas que saíram depois dele. */
  restante?: number;
  /** Chamadas que reservaram uma unidade e ainda não tiveram resposta (de processo que morreu, ficam até a liberação). */
  emVoo?: number;
  /** Pausa preventiva até este instante; vencida, continua até a chamada de liberação decidir. */
  pausaAte?: number;
  /** A única chamada liberada depois de a pausa vencer. */
  liberacao?: Chamada;
}

/** O que o freio diz a uma chamada que quer sair. */
export type OrdemDoFreio =
  | { tipo: "sai" }
  /** `por`: o limite próprio que parou a chamada; ausente = o restante informado pela fonte. */
  | { tipo: "freio"; ate: number; por?: "janela" }
  | { tipo: "espera"; ms: number };

/** O que a resposta disse do restante: o número lido, `undefined` (ausente ou inválido) ou nenhuma resposta. */
export type RestanteLido = number | undefined | "sem-resposta";

/** Serviços com freio preventivo: só o Falcão (serviço "jt" do disjuntor). */
export function temFreio(servico: string): boolean {
  return servico === "jt";
}

/** O restante de uma resposta: inteiro de 0 para cima; qualquer outra coisa = undefined. */
export function lerRestante(headers: Headers): number | undefined {
  const valor = headers.get(CABECALHO_DO_RESTANTE)?.trim();
  return valor && /^\d+$/.test(valor) ? Number(valor) : undefined;
}

/**
 * Antes de sair. `novo` é o estado a gravar (reserva feita, liberação registrada ou pausa que começa agora); igual ao
 * recebido quando nada muda. `morto` só é verdadeiro com prova de que o processo não existe.
 */
export function decidirFreio(
  f: Freio | undefined,
  chamada: Chamada,
  agora: number,
  morto: (c: Chamada) => boolean,
): { ordem: OrdemDoFreio; novo: Freio | undefined } {
  if (f?.pausaAte !== undefined) {
    if (agora < f.pausaAte) return { ordem: { tipo: "freio", ate: f.pausaAte }, novo: f };
    if (f.liberacao && f.liberacao.id !== chamada.id && !morto(f.liberacao)) {
      return { ordem: { tipo: "espera", ms: CONFERENCIA_MS }, novo: f };
    }
    return { ordem: { tipo: "sai" }, novo: { ...f, liberacao: chamada, emVoo: (f.emVoo ?? 0) + 1 } };
  }
  if (f?.restante === undefined) return { ordem: { tipo: "sai" }, novo: { ...f, emVoo: (f?.emVoo ?? 0) + 1 } };
  // A folga conhecida acabou, reservada por chamadas que já saíram: a pausa começa agora, sem gastar mais nada.
  if (f.restante <= RESERVA_DO_FREIO) {
    const ate = agora + PAUSA_PREVENTIVA_MS;
    return { ordem: { tipo: "freio", ate }, novo: { ...f, restante: f.restante, pausaAte: ate } };
  }
  return { ordem: { tipo: "sai" }, novo: { ...f, restante: f.restante - 1, emVoo: (f.emVoo ?? 0) + 1 } };
}

/** Depois da resposta (ou da falta dela): o novo estado do freio; o mesmo objeto se nada muda. */
export function anotarRestante(
  f: Freio | undefined,
  chamada: Chamada,
  lido: RestanteLido,
  agora: number,
): Freio | undefined {
  const minhaLiberacao = f?.liberacao?.id === chamada.id;
  // Esta chamada saiu da conta das em voo; o número lido ainda desconta as reservas das outras.
  const emVoo = Math.max(0, (f?.emVoo ?? 0) - 1);
  const base: Freio = { ...f, emVoo };
  if (!emVoo) delete base.emVoo;
  const descontado = lido === undefined || lido === "sem-resposta" ? undefined : Math.max(0, lido - emVoo);
  if (lido === "sem-resposta") {
    // Sem resposta, a liberação não decidiu nada: o próximo pedido do usuário pode ser a nova liberação.
    if (minhaLiberacao) delete base.liberacao;
    return base;
  }
  if (minhaLiberacao) {
    // Durante a pausa só a liberação sai: a conta das em voo recomeça (a de processo que morreu não fica para sempre).
    const novo: Freio = { ...base, ...(lido !== undefined && { restante: lido }) };
    delete novo.liberacao;
    delete novo.emVoo;
    if (lido !== undefined && lido > RESERVA_DO_FREIO) delete novo.pausaAte;
    else novo.pausaAte = agora + PAUSA_PREVENTIVA_MS;
    return novo;
  }
  if (descontado === undefined) return base;
  // Resposta atrasada de chamada que saiu antes da pausa: só atualiza o número, nunca encerra a pausa.
  if (base.pausaAte !== undefined) return { ...base, restante: descontado };
  if (descontado <= RESERVA_DO_FREIO) return { ...base, restante: descontado, pausaAte: agora + PAUSA_PREVENTIVA_MS };
  return { ...base, restante: descontado };
}

/** Confere o formato de um freio lido do estado compartilhado. */
export function freioValido(f: unknown): f is Freio {
  const x = f as Freio;
  const inteiro = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0);
  return (
    typeof x === "object" &&
    x !== null &&
    inteiro(x.restante) &&
    inteiro(x.emVoo) &&
    (x.pausaAte === undefined || Number.isFinite(x.pausaAte)) &&
    (x.liberacao === undefined ||
      (typeof x.liberacao === "object" &&
        x.liberacao !== null &&
        Number.isInteger(x.liberacao.pid) &&
        typeof x.liberacao.id === "string"))
  );
}

/** Limite próprio de uma fonte: `chamadas` por janela, com a escada de larguras (a janela alarga a cada recusa). */
export interface ConfigOrcamento {
  chamadas: number;
  largurasMs: readonly number[];
}

/** Chamadas aceitas seguidas que afrouxam a janela um degrau. */
export const ACERTOS_PARA_AFROUXAR = 20;

/** O orçamento de um serviço no estado compartilhado: a janela em curso e o degrau da escada. */
export interface Orcamento {
  /** Fim da janela em curso (ms no relógio comum). */
  fim: number;
  /** Chamadas já autorizadas nesta janela. */
  usadas: number;
  /** O limite da janela (para o diagnóstico). */
  limite: number;
  /** Degrau da escada de larguras; vale a partir da próxima janela. */
  degrau: number;
  /** Chamadas aceitas desde a última recusa ou desde o último afrouxamento. */
  acertos: number;
}

/**
 * Antes de sair: a chamada cabe na janela? `novo` é o estado a gravar se ela sair (janela nova quando a anterior
 * acabou ou quando o relógio voltou além de uma janela inteira); igual ao recebido quando ela não sai.
 */
export function decidirOrcamento(
  o: Orcamento | undefined,
  config: ConfigOrcamento,
  agora: number,
): { ordem: OrdemDoFreio; novo: Orcamento } {
  const degrau = Math.min(o?.degrau ?? 0, config.largurasMs.length - 1);
  const largura = config.largurasMs[degrau];
  if (!o || agora >= o.fim || o.fim - agora > Math.max(...config.largurasMs)) {
    return {
      ordem: { tipo: "sai" },
      novo: { fim: agora + largura, usadas: 1, limite: config.chamadas, degrau, acertos: o?.acertos ?? 0 },
    };
  }
  if (o.usadas >= config.chamadas) return { ordem: { tipo: "freio", ate: o.fim, por: "janela" }, novo: o };
  return { ordem: { tipo: "sai" }, novo: { ...o, usadas: o.usadas + 1, limite: config.chamadas, degrau } };
}

/** Depois de uma chamada: recusa da fonte = janela um degrau mais larga; `ACERTOS_PARA_AFROUXAR` aceitas = um degrau menos. */
export function anotarOrcamento(o: Orcamento | undefined, resultado: "aceita" | "recusa"): Orcamento | undefined {
  if (!o) return undefined;
  if (resultado === "recusa") return { ...o, degrau: o.degrau + 1, acertos: 0 };
  if (o.acertos + 1 < ACERTOS_PARA_AFROUXAR) return { ...o, acertos: o.acertos + 1 };
  return { ...o, degrau: Math.max(0, o.degrau - 1), acertos: 0 };
}

/** Confere o formato de um orçamento lido do estado compartilhado. */
export function orcamentoValido(o: unknown): o is Orcamento {
  const x = o as Orcamento;
  const inteiro = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  return typeof x === "object" && x !== null && Number.isFinite(x.fim) && inteiro(x.usadas) && inteiro(x.limite) && inteiro(x.degrau) && inteiro(x.acertos);
}
