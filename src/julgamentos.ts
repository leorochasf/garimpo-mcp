/**
 * julgamentos_do_processo: dado um número CNJ, os julgamentos registrados do processo no DataJud. Cada fonte vem no
 * seu bloco, rotulada e com o seu estado; falha de uma fonte aparece como estado, nunca como lista vazia (ADR-0001).
 * Nunca conclui que um acórdão falta.
 */

import { createHash } from "node:crypto";
import { type Cliente, RecusaError } from "./cliente.js";
import {
  type ChaveDoDataJud,
  type ConsultaDataJud,
  consultarDataJud,
  lerNumeroCnj,
  rotaDoNumero,
  rotaPedida,
  TERMO_DE_USO_DATAJUD,
} from "./datajud.js";
import { dataEHora, type Memoria } from "./memoria.js";

export interface PedidoJulgamentos {
  numero: string;
  /** Sigla do tribunal: troca a rota que o número daria (ex.: o processo que subiu ao STJ). */
  tribunal?: string;
}

export interface FontesJulgamentos {
  datajud: Cliente;
  chave: ChaveDoDataJud;
  memoria?: Memoria;
  agora?: () => number;
}

export type EstadoDaFonte = "ok" | "vazia" | "erro" | "recusa";

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

export interface RespostaJulgamentos {
  numero: string;
  tribunal: string;
  datajud: BlocoDataJud;
  termoDeUso: string;
}

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
  return {
    numero,
    tribunal: rota.toUpperCase(),
    datajud: await blocoDataJud(fontes, rota, digitos),
    termoDeUso:
      `Dados do DataJud sob o termo de uso da API Pública do CNJ, v1.2 (${TERMO_DE_USO_DATAJUD}): fins legais e não ` +
      "comerciais; o CNJ não garante a precisão, integridade ou atualidade dos dados.",
  };
}

async function blocoDataJud({ datajud, chave, memoria, agora = Date.now }: FontesJulgamentos, rota: string, digitos: string): Promise<BlocoDataJud> {
  const fonte = "DataJud (API Pública do CNJ)" as const;
  // sha256 da rota e do número: o número do processo nunca vai em claro para o nome do arquivo.
  const chaveDaMemoria = createHash("sha256").update(JSON.stringify(["datajud", rota, digitos])).digest("hex");
  const guardada = await memoria?.obterConsulta(chaveDaMemoria);
  let consulta: ConsultaDataJud;
  let obtido: string;
  if (guardada) {
    consulta = guardada.dado as ConsultaDataJud;
    obtido =
      `consulta guardada: fotografia da consulta feita no DataJud em ${dataEHora(guardada.obtidoEm)}, devolvida pela ` +
      "memória do Garimpo sem nova chamada";
  } else {
    try {
      consulta = await consultarDataJud(datajud, rota, digitos, chave);
    } catch (e) {
      return { fonte, estado: e instanceof RecusaError ? "recusa" : "erro", mensagem: (e as Error).message };
    }
    memoria?.guardarConsulta(chaveDaMemoria, "datajud", consulta);
    obtido = `consultado no DataJud em ${dataEHora(agora())}`;
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
