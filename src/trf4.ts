/** TRF4 no e-Proc (ADR-0024): o adaptador comum está em eproc.ts; aqui só a fonte do TRF4. */

import type { Cliente } from "./cliente.js";
import type { ParametrosBusca, ResultadoBusca } from "./busca.js";
import {
  buscaNoEproc,
  clienteDoEproc,
  lerBuscaGuardadaNoEproc,
  lerResultadosDoEproc,
  ressalvaDe,
  textoDoEproc,
  TRF4,
  type OpcoesEproc,
} from "./eproc.js";
import type { Memoria, TextoIntegral } from "./memoria.js";

export const RESSALVA_TRF4 = ressalvaDe(TRF4);
export const clienteDoTrf4 = (): Cliente => clienteDoEproc(TRF4);
export const lerResultadosDoTrf4 = (html: string) => lerResultadosDoEproc(TRF4, html);
export const lerBuscaGuardadaNoTrf4 = (memoria: Memoria, p: ParametrosBusca) => lerBuscaGuardadaNoEproc(TRF4, memoria, p);
export const buscaNoTrf4 = (cliente: Cliente, p: ParametrosBusca, memoria?: Memoria, opcoes?: OpcoesEproc): Promise<ResultadoBusca> =>
  buscaNoEproc(TRF4, cliente, p, memoria, opcoes);
export const textoDoTrf4 = (
  cliente: Cliente,
  link: string,
  acordao: { id?: string; numeroCnj?: string },
): Promise<Omit<TextoIntegral, "id"> | undefined> => textoDoEproc(TRF4, cliente, link, acordao);
