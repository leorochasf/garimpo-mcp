/**
 * Molde «página com íntegra»: o portal do tribunal entrega a íntegra do acórdão numa página HTML pública, um GET por
 * documento (o caminho do TJPR, ADR-0030, feito peça comum). Cada tribunal declara só os seus dados — host, caminho do
 * link, onde estão o processo, o segredo de justiça e a íntegra, e o rótulo — e se registra; as guardas ficam aqui,
 * ligadas por padrão. Não é PDF e não tem recibo: é o texto que o portal entrega, guardado na memória pelo id.
 */

import { type Cliente, decodificarDoHost } from "./cliente.js";
import { htmlComConteudoOculto, htmlComIndicioDeCorte, htmlParaTexto } from "./html.js";
import type { TextoIntegral } from "./memoria.js";
import { PORTAL_TJBA } from "./tjba.js";

/** O que um tribunal declara para usar o molde. */
export interface PortalComIntegra {
  /** Sigla do Garimpo (minúscula), a mesma da tabela de tribunais. */
  sigla: string;
  /** Host exato do portal; só https. */
  host: string;
  /** Caminho do link de um documento no portal; outro caminho não é chamado. */
  caminho: RegExp;
  /** A fonte, como sai no cabeçalho da leitura. */
  rotulo: string;
  /** O número do processo que a página mostra. */
  processo(html: string): string | undefined;
  /**
   * O que a página diz em «Segredo de Justiça» («Não», «Sim»…); sem o campo, undefined. Portal cuja página não tem
   * o campo declara a guarda desligada, com a justificativa.
   */
  segredo?(html: string): string | undefined;
  /** O HTML da íntegra do documento do link; undefined = a página não é a do acórdão. */
  integra(html: string, url: URL): string | undefined;
  /** Guardas desligadas, cada uma com a justificativa (prova do portal); sem justificativa, o registro recusa. */
  desligadas?: Partial<Record<GuardaDesligavel, string>>;
}

/**
 * As guardas que um portal pode desligar, justificando. As demais não se desligam: link do portal, sem número CNJ =
 * recusa (decisão do coordenador, Q3), página do mesmo processo, íntegra presente e texto útil mínimo.
 */
export type GuardaDesligavel = "segredoDeJustica" | "numeroNaIntegra";

/** Texto útil mínimo: uma página de aviso do portal não chega perto disso; relatório, voto e dispositivo passam com folga. */
const MINIMO_TEXTO = 200;
/** Limite de leitura da página (bytes): as páginas medidas têm dezenas de KB. */
const LIMITE_BYTES = 5_000_000;

/** Números de processo comparados só pelos algarismos: com ou sem máscara, é o mesmo processo. */
const algarismos = (numero: string) => numero.replace(/\D/g, "");

/** Número CNJ utilizável: os 20 algarismos, com ou sem máscara. Texto no lugar do número ou número incompleto não é. */
const ehNumeroCnj = (numero: string | undefined): numero is string =>
  numero !== undefined && algarismos(numero).length === 20;

const portais = new Map<string, PortalComIntegra>();

/** O link, se for https no host e no caminho declarados do portal; senão, undefined (nada é chamado). */
function documentoDoPortal(portal: PortalComIntegra, link: string): URL | undefined {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.host === portal.host && portal.caminho.test(url.pathname) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Registra o portal de um tribunal no molde; guarda desligada sem justificativa é erro de declaração. */
export function registrarPortal(portal: PortalComIntegra): void {
  const desligadas = { ...portal.desligadas };
  for (const [guarda, porque] of Object.entries(desligadas)) {
    if (!porque?.trim()) throw new Error(`${portal.sigla}: a guarda ${guarda} foi desligada sem justificativa.`);
  }
  if (!portal.segredo && !desligadas.segredoDeJustica) {
    throw new Error(`${portal.sigla}: sem o campo de segredo de justiça, a guarda segredoDeJustica exige justificativa.`);
  }
  portais.set(portal.sigla.toLowerCase(), portal);
}

/** O portal registrado do tribunal, se houver. */
export function portalComIntegra(sigla: string): PortalComIntegra | undefined {
  return portais.get(sigla.toLowerCase());
}

/** O texto, ou por que o Garimpo não o trouxe (nada é guardado). */
export type TextoDaPagina = Omit<TextoIntegral, "id"> | { motivo: string };

/** Uma chamada à página do link; só o que passa por todas as guardas vira texto. */
export async function textoDaPaginaComIntegra(
  portal: PortalComIntegra,
  cliente: Cliente,
  link: string,
  acordao: { numeroCnj?: string },
): Promise<TextoDaPagina> {
  // Sem o número da busca não há como conferir que a página é do mesmo processo: recusa, sem chamar o portal.
  const numeroCnj = acordao.numeroCnj;
  if (!ehNumeroCnj(numeroCnj)) {
    return { motivo: "a busca não trouxe o número CNJ do acórdão, e sem ele o Garimpo não confere se a página é do mesmo processo" };
  }
  const url = documentoDoPortal(portal, link);
  if (!url) return { motivo: "o link não aponta para um documento do portal do tribunal" };
  const r = await cliente.requisitar(url.href, { headers: { accept: "text/html" }, redirect: "manual" });
  // A prova de cada portal é da página direta, um GET. Outra rota não é seguida, mesmo no mesmo host.
  if (r.status >= 300 && r.status < 400) {
    await r.body?.cancel();
    return { motivo: "o portal mandou para outro endereço, que o Garimpo não segue" };
  }
  const tipo = r.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!/text\/html/i.test(tipo) || bytes.length > LIMITE_BYTES) {
    return { motivo: "o portal não respondeu com uma página HTML de tamanho normal" };
  }
  const html = decodificarDoHost(bytes, tipo, portal.host);
  const integra = portal.integra(html, url);
  if (!integra) return { motivo: "a página não traz a íntegra do documento do link (aviso ou erro do portal)" };
  const processo = portal.processo(html)?.trim();
  if (!ehNumeroCnj(processo)) return { motivo: "a página não mostra o número do processo" };
  if (algarismos(processo) !== algarismos(numeroCnj)) return { motivo: "a página é de outro processo que o da busca" };
  // Com a guarda ligada, só passa a página que diz expressamente que não há segredo; campo ausente ou valor estranho
  // não é prova de documento público. Só a exceção justificada na declaração dispensa o campo.
  if (!portal.desligadas?.segredoDeJustica) {
    const segredo = portal.segredo?.(html)?.trim() ?? "";
    if (/^sim$/i.test(segredo)) return { motivo: "o acórdão está em segredo de justiça" };
    if (!/^n[ãa]o$/i.test(segredo)) {
      return {
        motivo:
          "a página não informa se o acórdão está em segredo de justiça, e o Garimpo só guarda o texto quando ela diz que não está",
      };
    }
  }
  const texto = htmlParaTexto(integra);
  if (texto.length < MINIMO_TEXTO) return { motivo: "a íntegra veio curta demais para ser o acórdão" };
  // O portal pode pôr na página certa a íntegra de outro acórdão (o TJPR o fez, ADR-0030): a certa traz o próprio número.
  if (!portal.desligadas?.numeroNaIntegra && !texto.includes(processo) && !texto.includes(numeroCnj)) {
    return {
      motivo: "a íntegra não traz o número do próprio processo (o portal pode ter mostrado a íntegra de outro acórdão)",
    };
  }
  return {
    texto,
    indicioDeCorte: htmlComIndicioDeCorte(html),
    ...(htmlComConteudoOculto(integra) && { conteudoOculto: true }),
  };
}

/** A natureza do texto do portal registrado, como sai na leitura e na conferência. */
export function naturezaDoPortal(portal: PortalComIntegra): string {
  return `texto do portal do tribunal (${portal.sigla.toUpperCase()}), convertido de HTML pelo Garimpo: não é PDF e não tem recibo de origem`;
}

// Os tribunais no molde, cada um com a sua ADR.
registrarPortal(PORTAL_TJBA);
