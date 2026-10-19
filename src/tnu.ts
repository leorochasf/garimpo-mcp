/** TNU no e-Proc do CJF (ADR-0027): o adaptador comum está em eproc.ts; aqui só a fonte da TNU. */

import type { Cliente } from "./cliente.js";
import type { ParametrosBusca, ResultadoBusca } from "./busca.js";
import {
  buscaNoEproc,
  clienteDoEproc,
  lerBuscaGuardadaNoEproc,
  lerResultadosDoEproc,
  ressalvaDe,
  textoDoEproc,
  TNU,
  type OpcoesEproc,
} from "./eproc.js";
import type { Memoria, TextoIntegral } from "./memoria.js";

export const RESSALVA_TNU = ressalvaDe(TNU);
export const clienteDaTnu = (): Cliente => clienteDoEproc(TNU);
export const lerResultadosDaTnu = (html: string) => lerResultadosDoEproc(TNU, html);
export const lerBuscaGuardadaNaTnu = (memoria: Memoria, p: ParametrosBusca) => lerBuscaGuardadaNoEproc(TNU, memoria, p);
export const buscaNaTnu = (cliente: Cliente, p: ParametrosBusca, memoria?: Memoria, opcoes?: OpcoesEproc): Promise<ResultadoBusca> =>
  buscaNoEproc(TNU, cliente, p, memoria, opcoes);
export const textoDaTnu = (
  cliente: Cliente,
  link: string,
  acordao: { id?: string; numeroCnj?: string },
): Promise<Omit<TextoIntegral, "id"> | undefined> => textoDoEproc(TNU, cliente, link, acordao);
