/**
 * julgamentos_do_processo: dado um número CNJ, lado a lado, os julgamentos registrados do processo no DataJud, os
 * acórdãos que uma busca pelo número no JurisprudênciaIA devolve e as comunicações do processo no DJEN. Cada fonte vem no seu bloco, rotulada e com o seu
 * estado; falha de uma fonte aparece como estado, nunca como lista vazia (ADR-0001). Nunca conclui que um acórdão
 * falta: mostra os dois lados e aponta o que conferir no portal do tribunal.
 */

import { createHash } from "node:crypto";
import { buscaDireta } from "./busca.js";
import { AdiadaError, type Cliente, RecusaError, umaProvaPorFerramenta } from "./cliente.js";
import {
  type ChaveDoDataJud,
  type ConsultaDataJud,
  consultarDataJud,
  ehConsultaDataJud,
  lerNumeroCnj,
  type Movimento,
  rotaDoNumero,
  rotaPedida,
  TERMO_DE_USO_DATAJUD,
} from "./datajud.js";
import { type ConsultaDjen, ehConsultaDjen, type FonteDjen } from "./djen.js";
import { comparavel } from "./enquadramento.js";
import { dataEHora, type FonteDaConsulta, type Memoria } from "./memoria.js";
import { ehEmbargosDeDeclaracao } from "./recorrido.js";
import type { TabelaDePrecedentes } from "./tabelaDePrecedentes.js";
import { SIGLAS } from "./tribunais.js";

export interface PedidoJulgamentos {
  numero: string;
  /** Sigla do tribunal: troca a rota que o número daria (ex.: o processo que subiu ao STJ). */
  tribunal?: string;
  /** Falso: nenhuma chamada ao DJEN (padrão: verdadeiro). */
  incluirDjen?: boolean;
}

export interface FontesJulgamentos {
  /** O cliente do JurisprudênciaIA (o mesmo das buscas). */
  site: Cliente;
  datajud: Cliente;
  djen: FonteDjen;
  tabela?: TabelaDePrecedentes;
  chave: ChaveDoDataJud;
  memoria?: Memoria;
  agora?: () => number;
}

/** "pausa": a fonte pediu para esperar (não é recusa); a mensagem diz até quando. */
export type EstadoDaFonte = "ok" | "vazia" | "erro" | "recusa" | "pausa" | "não consultada";

export interface BlocoDataJud extends Partial<ConsultaDataJud> {
  fonte: "DataJud (API Pública do CNJ)";
  estado: EstadoDaFonte;
  /** Quando e como veio: consulta feita agora ou guardada na memória. */
  obtido?: string;
  sobreAsDatas?: string;
  notas?: string[];
  /** Erro ou recusa: o motivo. */
  mensagem?: string;
}

/** Acórdão do site com o mesmo número, com o id para pedir a ementa. */
export interface AcordaoDoNumero {
  id: string;
  numero: string;
  classe?: string;
  dataJulgamento?: string;
  tipo: "embargos de declaração" | "outros";
}

export interface BlocoDoSite {
  fonte: "JurisprudênciaIA (busca pelo número)";
  estado: EstadoDaFonte;
  /** Só na busca guardada: de quando é. */
  buscaGuardada?: string;
  acordaos?: AcordaoDoNumero[];
  /** Só quando todos os registros que o site devolveu são deste número: pode haver mais. */
  listaCortada?: string;
  mensagem?: string;
}

export interface BlocoDjen extends Partial<ConsultaDjen> {
  fonte: "DJEN (comunicações processuais do CNJ)";
  estado: EstadoDaFonte;
  obtido?: string;
  /** Sempre que há resposta: o que a lista é e o que não é. */
  sobreALista?: string;
  /** Só quando o DJEN tem mais de 100: a lista mostrada foi cortada. */
  listaCortada?: string;
  mensagem?: string;
}

/** Totais das duas fontes, a comparação (só embargos de declaração × embargos de declaração) e o que conferir. */
export interface LadoALado {
  datajud: string;
  jurisprudenciaia: string;
  comparacao: string;
  conferir?: string;
}

export interface RespostaJulgamentos {
  numero: string;
  tribunal: string;
  datajud: BlocoDataJud;
  jurisprudenciaia: BlocoDoSite;
  ladoALado: LadoALado;
  djen: BlocoDjen;
  termoDeUso: string;
}

/** Registros pedidos ao site: se todos forem do número, a lista pode ter sido cortada. */
const LIMITE_NO_SITE = 20;

const SOBRE_AS_DATAS =
  "lancadoEm é a data do lançamento no DataJud, não é a data da sessão; atualizadoNoDataJud é a última atualização " +
  "do registro no DataJud.";

/** Recusa a entrada errada, com a explicação, sem nenhuma chamada. */
export function rotaDoPedido(p: PedidoJulgamentos): { numero: string; digitos: string; rota: string } {
  const numero = lerNumeroCnj(p.numero);
  if ("erro" in numero) throw new Error(numero.erro);
  const rota = p.tribunal?.trim() ? rotaPedida(p.tribunal) : rotaDoNumero(numero);
  if ("erro" in rota) throw new Error(rota.erro);
  return { numero: numero.formatado, digitos: numero.digitos, rota: rota.rota };
}

export async function julgamentosDoProcesso(p: PedidoJulgamentos, fontes: FontesJulgamentos): Promise<RespostaJulgamentos> {
  const { numero, digitos, rota } = rotaDoPedido(p);
  // Se um serviço estiver aguardando a chamada de prova, a ferramenta inteira faz no máximo uma.
  const [datajud, jurisprudenciaia, djen] = await umaProvaPorFerramenta(() =>
    Promise.all([
      blocoDataJud(fontes, rota, digitos),
      blocoDoSite(fontes, rota, numero, digitos),
      blocoDjen(fontes, digitos, p.incluirDjen ?? true),
    ]),
  );
  return {
    numero,
    tribunal: rota.toUpperCase(),
    datajud,
    jurisprudenciaia,
    ladoALado: ladoALado(datajud, jurisprudenciaia, rota.toUpperCase()),
    djen,
    termoDeUso:
      `Dados do DataJud sob o termo de uso da API Pública do CNJ, v1.2 (${TERMO_DE_USO_DATAJUD}): fins legais e não ` +
      "comerciais; o CNJ não garante a precisão, integridade ou atualidade dos dados.",
  };
}

/** O estado de uma fonte que falhou: adiada (pausa, só o DJEN), recusa ou erro. */
const estadoDoErro = (e: unknown): EstadoDaFonte =>
  e instanceof AdiadaError ? "pausa" : e instanceof RecusaError ? "recusa" : "erro";

/**
 * A consulta a uma fonte pela memória (válida e no formato desta versão) ou, sem ela, na fonte, guardando a resposta
 * reduzida. A chave é o sha256 do pedido: o número do processo nunca vai em claro para o nome do arquivo.
 */
async function consultaComMemoria<T>(
  { memoria, agora = Date.now }: FontesJulgamentos,
  fonte: FonteDaConsulta,
  nome: string,
  pedido: unknown[],
  valida: (dado: unknown) => dado is T,
  consultar: () => Promise<T>,
): Promise<{ consulta: T; obtido: string }> {
  const chave = createHash("sha256").update(JSON.stringify([fonte, ...pedido])).digest("hex");
  const guardada = await memoria?.obterConsulta(chave, fonte, valida);
  if (guardada) {
    return {
      consulta: guardada.dado as T,
      obtido:
        `consulta guardada: fotografia da consulta feita no ${nome} em ${dataEHora(guardada.obtidoEm)}, devolvida ` +
        "pela memória do Garimpo sem nova chamada",
    };
  }
  const consulta = await consultar();
  memoria?.guardarConsulta(chave, fonte, consulta);
  return { consulta, obtido: `consultado no ${nome} em ${dataEHora(agora())}` };
}

async function blocoDataJud(fontes: FontesJulgamentos, rota: string, digitos: string): Promise<BlocoDataJud> {
  const fonte = "DataJud (API Pública do CNJ)" as const;
  let consulta: ConsultaDataJud;
  let obtido: string;
  try {
    ({ consulta, obtido } = await consultaComMemoria(fontes, "datajud", "DataJud", [rota, digitos], ehConsultaDataJud, () =>
      consultarDataJud(fontes.datajud, rota, digitos, fontes.chave),
    ));
  } catch (e) {
    return { fonte, estado: estadoDoErro(e), mensagem: (e as Error).message };
  }
  const notas: string[] = [];
  if (consulta.total === 0) {
    notas.push(
      `O DataJud não devolveu este processo nesta rota (${rota.toUpperCase()}); isso não prova que ele não exista.`,
    );
  } else if (consulta.registros.length === 0) {
    notas.push("A resposta trouxe apenas registro de 1º grau; não há registro de 2º grau ou superior nesta resposta.");
  }
  return {
    fonte,
    estado: consulta.total === 0 ? "vazia" : "ok",
    obtido,
    sobreAsDatas: SOBRE_AS_DATAS,
    ...consulta,
    ...(notas.length && { notas }),
  };
}

async function blocoDjen(fontes: FontesJulgamentos, digitos: string, incluir: boolean): Promise<BlocoDjen> {
  const fonte = "DJEN (comunicações processuais do CNJ)" as const;
  if (!incluir) return { fonte, estado: "não consultada", mensagem: "Desligado neste pedido (incluir_djen: false)." };
  let consulta: ConsultaDjen;
  let obtido: string;
  try {
    ({ consulta, obtido } = await consultaComMemoria(fontes, "djen", "DJEN", [digitos], ehConsultaDjen, () =>
      fontes.djen.consultar(digitos),
    ));
  } catch (e) {
    return { fonte, estado: estadoDoErro(e), mensagem: (e as Error).message };
  }
  return {
    fonte,
    estado: consulta.comunicacoes.length ? "ok" : "vazia",
    obtido,
    sobreALista: "Comunicações do processo no DJEN, não um inventário de acórdãos.",
    ...(consulta.total > consulta.comunicacoes.length && {
      listaCortada: `lista cortada: o DJEN tem ${consulta.total} comunicações, mostradas ${consulta.comunicacoes.length}`,
    }),
    ...consulta,
  };
}

async function blocoDoSite(
  { site, memoria, tabela }: FontesJulgamentos,
  rota: string,
  numero: string,
  digitos: string,
): Promise<BlocoDoSite> {
  const fonte = "JurisprudênciaIA (busca pelo número)" as const;
  if (!SIGLAS.includes(rota)) {
    return { fonte, estado: "não consultada", mensagem: `O JurisprudênciaIA não cobre o ${rota.toUpperCase()}.` };
  }
  let r;
  try {
    r = await buscaDireta(site, { tribunal: rota, texto: numero, limite: LIMITE_NO_SITE }, memoria, { tabela });
  } catch (e) {
    return { fonte, estado: estadoDoErro(e), mensagem: (e as Error).message };
  }
  // A busca é por texto: só os registros do mesmo número contam.
  const doNumero = r.acordaos.filter((a) => a.numeroCnj?.replace(/\D/g, "") === digitos);
  const acordaos = doNumero.map(
    (a): AcordaoDoNumero => ({
      id: a.id,
      numero: a.numero,
      ...(a.classe && { classe: a.classe }),
      ...(a.dataJulgamento && { dataJulgamento: a.dataJulgamento }),
      tipo: ehEmbargosDeDeclaracao(a) ? "embargos de declaração" : "outros",
    }),
  );
  return {
    fonte,
    estado: acordaos.length ? "ok" : "vazia",
    ...(r.buscaGuardada && { buscaGuardada: r.buscaGuardada }),
    acordaos,
    ...(r.acordaos.length >= LIMITE_NO_SITE &&
      doNumero.length === r.acordaos.length && {
        listaCortada: `os ${LIMITE_NO_SITE} registros que o site devolveu são todos deste número: pode haver mais`,
      }),
  };
}

/** Movimento de embargos de declaração só se o nome TPU disser; os demais, tipo não verificado. */
const ehDeEmbargos = (m: Movimento) => comparavel(m.nome).includes("embargos de declaracao");
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const descrever = (m: Movimento) =>
  `${m.nome}, lançado no DataJud em ${/^\d{4}-\d{2}-\d{2}/.test(m.lancadoEm) ? m.lancadoEm.slice(0, 10) : m.lancadoEm}`;
const utilizavel = (estado: EstadoDaFonte) => estado === "ok" || estado === "vazia";

/**
 * Os totais lado a lado e, só com as duas respostas utilizáveis, sem corte e com registro de 2º grau ou superior, a
 * comparação de embargos de declaração × embargos de declaração. Nunca por data; nunca diz que um acórdão falta.
 */
function ladoALado(dj: BlocoDataJud, site: BlocoDoSite, tribunal: string): LadoALado {
  const movimentos = (dj.registros ?? []).flatMap((r) => r.resultadosDeJulgamento);
  const deEmbargos = movimentos.filter(ehDeEmbargos);
  const naoVerificados = movimentos.filter((m) => !ehDeEmbargos(m));
  const datajud = utilizavel(dj.estado)
    ? `${plural(movimentos.length, "movimento", "movimentos")} de resultado de julgamento (${deEmbargos.length} de ` +
      `embargos de declaração; ${naoVerificados.length} de tipo não verificado` +
      (naoVerificados.length ? `: ${naoVerificados.map(descrever).join("; ")}` : "") +
      ")"
    : `sem resposta utilizável (${dj.estado})`;
  const acordaos = site.acordaos ?? [];
  const edNoSite = acordaos.filter((a) => a.tipo === "embargos de declaração");
  const jurisprudenciaia = utilizavel(site.estado)
    ? `busca pelo número: ${plural(acordaos.length, "acórdão", "acórdãos")} deste número` +
      (acordaos.length ? ` (${acordaos.map((a) => `${a.tipo}, id ${a.id}`).join("; ")})` : "")
    : `sem resposta utilizável (${site.estado})`;
  const motivo = semComparacao(dj, site);
  if (motivo) return { datajud, jurisprudenciaia, comparacao: `sem comparação: ${motivo}` };
  const conferir: string[] = [];
  if (naoVerificados.length) {
    conferir.push(
      `${naoVerificados.length === 1 ? "o movimento" : "os movimentos"} de tipo não verificado ` +
        `(${naoVerificados.map(descrever).join("; ")})`,
    );
  }
  if (deEmbargos.length !== edNoSite.length) conferir.push("a diferença no número de embargos de declaração");
  return {
    datajud,
    jurisprudenciaia,
    comparacao:
      `embargos de declaração: ${deEmbargos.length} no DataJud e ${edNoSite.length} no JurisprudênciaIA` +
      (deEmbargos.length === edNoSite.length ? " (mesmo número)" : ""),
    ...(conferir.length && { conferir: `Confira no portal do ${tribunal} ${conferir.join(" e ")}.` }),
  };
}

function semComparacao(dj: BlocoDataJud, site: BlocoDoSite): string | undefined {
  if (!utilizavel(dj.estado)) return `o DataJud não deu resposta utilizável (${dj.estado})`;
  if (!dj.registros?.length) return "o DataJud não trouxe registro de 2º grau ou superior";
  if (!utilizavel(site.estado)) return `o JurisprudênciaIA não deu resposta utilizável (${site.estado})`;
  if (site.listaCortada) return "a lista do JurisprudênciaIA pode ter sido cortada";
  return undefined;
}
