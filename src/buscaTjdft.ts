/**
 * TJDFT: busca na pesquisa oficial do tribunal, a API pública `POST /api/v1/pesquisa` de jurisdf.tjdft.jus.br — o braço
 * oficial da medição «pesquisa oficial × base» (ticket 12, piloto). **Não está ligada à busca do usuário**: substituir
 * ou complementar a base no TJDFT depende da decisão do dono com os números.
 * Estrutura conferida nas respostas reais de 2026-10-29 (uma busca com resultados e uma vazia). O acórdão sai com o link
 * no formato que o `textoDoTjdft` já lê, então inteiro teor, leitura e conferência funcionam pelo id sem mudança.
 */

import { type Cliente, FormatoInesperadoError } from "./cliente.js";
import type { Acordao } from "./busca.js";
import { enquadrarAcordao } from "./enquadramento.js";
import { ROTULO_PORTAL_TJDFT } from "./leitura.js";
import type { Memoria } from "./memoria.js";
import { HOST_TJDFT } from "./tjdft.js";

const ENDPOINT = `https://${HOST_TJDFT}/api/v1/pesquisa`;
/** Resultados por busca no braço de medição (protocolo do ticket 12: os 20 primeiros por relevância). */
export const LIMITE_MAXIMO_TJDFT = 20;
/**
 * Prefixo do id: o `identificador` do tribunal e o id do JurisprudênciaIA são números; sem ele, «tjdft:<n>» da base e da
 * pesquisa oficial colidiriam na memória.
 */
const PREFIXO_DO_ID = "of";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Os acórdãos da página, o total que o tribunal informou e quantos registros não eram acórdãos (decisões monocráticas). */
export interface BuscaOficialDoTjdft {
  acordaos: Acordao[];
  total: number;
  foraDosAcordaos: number;
}

function formatoInesperado(): never {
  throw new FormatoInesperadoError(
    "A pesquisa oficial do TJDFT respondeu num formato que o Garimpo não reconhece; nada foi guardado.",
  );
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** A data no fuso de Brasília: a API manda a meia-noite local em UTC («2026-10-14T03:00:00.000Z»). */
function dataDeBrasilia(v: unknown): string | undefined {
  const instante = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(instante) ? undefined : new Date(instante - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Lê a resposta da API. Formato que não bate é erro, nunca lista vazia (ADR-0001); a busca vazia real é lista vazia. */
export function lerResultadosDoTjdft(dado: unknown): BuscaOficialDoTjdft {
  const resposta = dado as { hits?: { value?: unknown }; registros?: unknown } | null;
  const total = resposta?.hits?.value;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) return formatoInesperado();
  if (!Array.isArray(resposta?.registros)) return formatoInesperado();
  const acordaos: Acordao[] = [];
  let foraDosAcordaos = 0;
  for (const r of resposta.registros as Record<string, unknown>[]) {
    if (r?.base !== "acordaos") {
      foraDosAcordaos++;
      continue;
    }
    const identificador = String(r.identificador ?? "");
    const ementa = texto(r.ementa);
    if (!/^\d+$/.test(identificador) || typeof r.uuid !== "string" || !UUID.test(r.uuid) || !ementa) return formatoInesperado();
    const processo = texto(r.processo);
    const numeroCnj = processo && processo.replace(/\D/g, "").length === 20 ? processo : undefined;
    const acordao = {
      id: `tjdft:${PREFIXO_DO_ID}${identificador}`,
      tribunal: "tjdft",
      numero: numeroCnj ?? identificador,
      semNumero: !numeroCnj,
      ...(numeroCnj && { numeroCnj }),
      ...(texto(r.nomeRelator) && { relator: texto(r.nomeRelator) }),
      ...(texto(r.descricaoOrgaoJulgador) && { orgao: texto(r.descricaoOrgaoJulgador) }),
      ...(dataDeBrasilia(r.dataJulgamento) && { dataJulgamento: dataDeBrasilia(r.dataJulgamento) }),
      ...(dataDeBrasilia(r.dataPublicacao) && { dataPublicacao: dataDeBrasilia(r.dataPublicacao) }),
      ementa,
      link: `https://${HOST_TJDFT}/acordaos/${identificador}/inteiro-teor/${r.uuid.toLowerCase()}`,
      fonte: ROTULO_PORTAL_TJDFT,
    };
    acordaos.push({ ...acordao, enquadramento927: enquadrarAcordao(acordao) });
  }
  return { acordaos, total, foraDosAcordaos };
}

/**
 * Uma chamada à pesquisa oficial, pelo Cliente do tribunal (serviço `tjdft` dos freios: a mesma cota de 60 por minuto
 * do inteiro teor). Só a base de acórdãos, sem o inteiro teor (o texto continua pelo `obter_inteiro_teor`). Com memória,
 * os acórdãos ficam guardados pelo id próprio, para o inteiro teor, a leitura e a conferência.
 */
export async function buscaNoTjdft(
  cliente: Cliente,
  p: { texto: string; limite?: number },
  memoria?: Memoria,
): Promise<BuscaOficialDoTjdft> {
  const tamanho = Math.min(Math.max(p.limite ?? LIMITE_MAXIMO_TJDFT, 1), LIMITE_MAXIMO_TJDFT);
  const r = await cliente.requisitar(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: p.texto.trim(), pagina: 0, tamanho, termosAcessorios: [{ campo: "base", valor: "acordaos" }] }),
  });
  const lida = lerResultadosDoTjdft(await r.json().catch(() => null));
  const acordaos = lida.acordaos.slice(0, tamanho);
  memoria?.lembrar(acordaos.map((registro) => ({ ids: [registro.id], registro })));
  return { ...lida, acordaos };
}
