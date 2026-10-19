/** TRF2 no e-Proc (ADR-0028): o adaptador comum está em eproc.ts; aqui só a fonte do TRF2. */

import type { Cliente } from "./cliente.js";
import type { ParametrosBusca, ResultadoBusca } from "./busca.js";
import {
  buscaNoEproc,
  clienteDoEproc,
  lerBuscaGuardadaNoEproc,
  lerResultadosDoEproc,
  ressalvaDe,
  textoDoEproc,
  TRF2,
  type OpcoesEproc,
} from "./eproc.js";
import type { Memoria, TextoIntegral } from "./memoria.js";

export const RESSALVA_TRF2 = ressalvaDe(TRF2);
export const clienteDoTrf2 = (): Cliente => clienteDoEproc(TRF2);
export const lerResultadosDoTrf2 = (html: string) => lerResultadosDoEproc(TRF2, html);
export const lerBuscaGuardadaNoTrf2 = (memoria: Memoria, p: ParametrosBusca) => lerBuscaGuardadaNoEproc(TRF2, memoria, p);
export const buscaNoTrf2 = (cliente: Cliente, p: ParametrosBusca, memoria?: Memoria, opcoes?: OpcoesEproc): Promise<ResultadoBusca> =>
  buscaNoEproc(TRF2, cliente, p, memoria, opcoes);
export const textoDoTrf2 = (
  cliente: Cliente,
  link: string,
  acordao: { id?: string; numeroCnj?: string },
): Promise<Omit<TextoIntegral, "id"> | undefined> => textoDoEproc(TRF2, cliente, link, acordao);
