/**
 * DJEN (comunicações processuais do CNJ): as comunicações de um processo, pelo número — metadados e link, nunca o
 * texto, as partes ou os advogados. Fontes, limites e o que o Garimpo guarda: docs/fontes.md.
 */

import { Cliente, FormatoInesperadoError, type OpcoesCliente, textoExternoLimpo } from "./cliente.js";
import { htmlParaTexto } from "./html.js";

const HOST = "comunicaapi.pje.jus.br";
/** Uma página só, de 100 (o máximo da API). */
const POR_PAGINA = 100;
/** Com 2 ou menos chamadas restantes na janela do DJEN, a próxima espera a janela (1 min). */
const JANELA_MS = 60_000;

/**
 * 3 s entre chamadas ao host, para todas as janelas (limite de 20 por janela); espera de até 60 s dentro da chamada
 * em 429/503; pedido acima disso adia o DJEN, sem recusa.
 */
export function clienteDoDjen(extra: Partial<OpcoesCliente> = {}): Cliente {
  return new Cliente({
    nome: "O DJEN",
    intervaloMinimoPorHost: { [HOST]: 3_000 },
    esperaMaximaMs: 60_000,
    adiaAcimaDoTeto: true,
    ...extra,
  });
}

export interface Comunicacao {
  dataDisponibilizacao?: string;
  tipoComunicacao?: string;
  tipoDocumento?: string;
  orgao?: string;
  classe?: string;
  /** Só se https. */
  link?: string;
  /** Só em comunicação de tipo acórdão: o trecho saneado da ementa, ou "não verificado" (G-47). */
  ementa?: EmentaDjen;
}

export type EmentaDjen = { rotulo: typeof ROTULO_EMENTA; trecho: string } | "não verificado";

const ROTULO_EMENTA = "trecho do DJEN (texto da intimação, não o acórdão oficial)" as const;
const TAMANHO_TRECHO = 600;
const NUMERO_CNJ = /\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g;
/** Linha que nomeia parte ou advogado por rótulo fixo: cortada inteira. */
const LINHA_DE_PESSOA = /^\s*(apelante|apelado|agravante|agravado|embargante|embargado|recorrente|recorrido|impetrante|impetrado|autor|autora|r[ée]u|requerente|requerido|interessado|advogad[oa]s?|procurador(?:a)?|relator(?:a)?|revisor(?:a)?)\b[^\n]{0,20}:/i;

/** O que a ferramenta mostra do DJEN (e o que a memória guarda): sem texto, sem partes, sem advogados. */
export interface ConsultaDjen {
  /** Comunicações que o DJEN diz ter (count). */
  total: number;
  comunicacoes: Comunicacao[];
}

/** A consulta guardada tem o formato desta versão? (memória de outra versão ou estragada = ausente). */
export function ehConsultaDjen(d: unknown): d is ConsultaDjen {
  const c = d as ConsultaDjen;
  return typeof c === "object" && c !== null && Number.isInteger(c.total) && Array.isArray(c.comunicacoes);
}

type Bruto = Record<string, unknown>;
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Critério de dois sinais (G-47): o tipo de documento indica acórdão E o texto confirma — uma só ementa e nenhum número
 * de processo além do consultado (ementa transcrita ou ato coletivo trariam outro). Um sinal só ou dúvida: "não
 * verificado". Saneamento de melhor esforço: nome de pessoa em texto livre não é detectável.
 */
function ementaDoAto(tipoDocumento: string | undefined, html: string | undefined, digitos: string): EmentaDjen {
  if (!tipoDocumento || !/ac[óo]rd[ãa]o/i.test(tipoDocumento) || !html) return "não verificado";
  const texto = htmlParaTexto(html);
  const numeros = (texto.match(NUMERO_CNJ) ?? []).map((n) => n.replace(/\D/g, ""));
  const marcas = [...texto.matchAll(/\bEMENTA\b/g)];
  if (marcas.length !== 1 || !numeros.length || numeros.some((n) => n !== digitos)) return "não verificado";
  const depois = texto.slice(marcas[0].index + marcas[0][0].length).replace(/^\s*[:.\-–]*/, "");
  const fim = depois.search(/\b(AC[ÓO]RD[ÃA]O|VOTO|RELAT[ÓO]RIO|VISTOS)\b/);
  const trecho = textoExternoLimpo(
    (fim >= 0 ? depois.slice(0, fim) : depois)
      .split("\n")
      .filter((l) => !LINHA_DE_PESSOA.test(l))
      .join(" ")
      .replace(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, "[telefone retirado]")
      .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[número retirado]")
      .replace(/\b\d{2}\.?\d{3}-\d{3}\b/g, "[CEP retirado]")
      .replace(/OAB[\s/.-]*[A-Z]{0,2}[\s/.-]*\d[\d.]*/gi, "[OAB retirada]"),
    TAMANHO_TRECHO,
  );
  return trecho ? { rotulo: ROTULO_EMENTA, trecho } : "não verificado";
}

/** Reduz a resposta do DJEN aos metadados mostrados; o texto só sai como trecho saneado da ementa do acórdão. */
export function reduzirDjen(json: unknown, digitos = ""): ConsultaDjen {
  const r = json as { items?: unknown; count?: unknown };
  if (!r || !Array.isArray(r.items)) {
    throw new FormatoInesperadoError("O DJEN devolveu uma resposta sem a lista de comunicações (items): o formato pode ter mudado.");
  }
  const comunicacoes = (r.items as Bruto[]).slice(0, POR_PAGINA).map((i) => {
    const link = texto(i.link);
    const c: Comunicacao = {
      dataDisponibilizacao: texto(i.data_disponibilizacao),
      tipoComunicacao: texto(i.tipoComunicacao),
      tipoDocumento: texto(i.tipoDocumento),
      orgao: texto(i.nomeOrgao),
      classe: texto(i.nomeClasse),
      link: link && /^https:\/\//i.test(link) ? link : undefined,
      // Só quem tem ao menos um sinal (tipo de acórdão ou "EMENTA" no texto) ganha o campo; com um só, "não verificado".
      ementa:
        /ac[óo]rd[ãa]o/i.test(texto(i.tipoDocumento) ?? "") || /(?:^|[^A-Za-zÀ-ÿ])EMENTA(?![A-Za-zÀ-ÿ])/.test(texto(i.texto) ?? "")
          ? ementaDoAto(texto(i.tipoDocumento), texto(i.texto), digitos)
          : undefined,
    };
    for (const k of Object.keys(c) as (keyof Comunicacao)[]) if (c[k] === undefined) delete c[k];
    return c;
  });
  return { total: Number.isInteger(r.count) ? (r.count as number) : comunicacoes.length, comunicacoes };
}

/** A fonte DJEN de uma janela: guarda o "espere a janela" quando o DJEN avisa que restam 2 chamadas ou menos. */
export class FonteDjen {
  private naoAntesDe = 0;

  constructor(
    private readonly cliente: Cliente,
    private readonly relogio: { agora?: () => number; esperar?: (ms: number) => Promise<void> } = {},
  ) {}

  async consultar(digitos: string): Promise<ConsultaDjen> {
    const agora = this.relogio.agora ?? Date.now;
    const falta = this.naoAntesDe - agora();
    if (falta > 0) await (this.relogio.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(falta);
    const resposta = await this.cliente.requisitar(
      `https://${HOST}/api/v1/comunicacao?numeroProcesso=${digitos}&itensPorPagina=${POR_PAGINA}&pagina=1`,
    );
    const restante = Number(resposta.headers.get("x-ratelimit-remaining") ?? NaN);
    if (Number.isFinite(restante) && restante <= 2) this.naoAntesDe = agora() + JANELA_MS;
    let json: unknown;
    try {
      json = await resposta.json();
    } catch {
      throw new FormatoInesperadoError("O DJEN devolveu algo que não é JSON.");
    }
    return reduzirDjen(json, digitos);
  }
}
