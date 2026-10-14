/**
 * DJEN (comunicações processuais do CNJ): as comunicações de um processo, pelo número — metadados e link, nunca o
 * texto bruto, as partes ou os advogados. Fontes, limites e o que o Garimpo guarda: docs/fontes.md.
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

const ROTULO_EMENTA = "trecho do DJEN (texto da intimação, não o acórdão oficial; saneamento de melhor esforço)" as const;
const TAMANHO_TRECHO = 600;
const NUMERO_CNJ = /\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g;
/** Linha que nomeia parte ou advogado por rótulo fixo: cortada inteira. */
const LINHA_DE_PESSOA = /\b(apelante|apelado|agravante|agravado|embargante|embargado|recorrente|recorrido|impetrante|impetrado|autor|autora|r[ée]u|requerente|requerido|interessado|advogad[oa]s?(?:\(as?\))?|procurador(?:a)?|relator(?:a)?|revisor(?:a)?)\b[^\n]{0,20}:/i;

/** Metadados e, quando verificável, trecho saneado; nunca o texto bruto, partes ou advogados. */
export interface ConsultaDjen {
  /** Comunicações que o DJEN diz ter (count). */
  total: number;
  comunicacoes: Comunicacao[];
}

/** A consulta guardada tem o formato desta versão? (memória de outra versão ou estragada = ausente). */
export function ehConsultaDjen(d: unknown): d is ConsultaDjen {
  const c = d as ConsultaDjen;
  return typeof c === "object" && c !== null && Number.isInteger(c.total) && Array.isArray(c.comunicacoes) &&
    c.comunicacoes.every((i) => i && typeof i === "object" &&
      Object.keys(i).every((k) => ["dataDisponibilizacao", "tipoComunicacao", "tipoDocumento", "orgao", "classe", "link", "ementa"].includes(k)) &&
      Object.entries(i).every(([k, v]) => k === "ementa"
        ? v === "não verificado" || (v && typeof v === "object" && v.rotulo === ROTULO_EMENTA &&
          typeof v.trecho === "string" && !!v.trecho && v.trecho.length <= TAMANHO_TRECHO &&
          Object.keys(v).length === 2 && !LINHA_DE_PESSOA.test(v.trecho) &&
          textoExternoLimpo(v.trecho, TAMANHO_TRECHO) === v.trecho)
        : typeof v === "string"));
}

type Bruto = Record<string, unknown>;
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Critério de dois sinais (G-47): o tipo de documento indica acórdão E o texto confirma — uma só ementa e nenhum número
 * de processo além do consultado (ementa transcrita ou ato coletivo trariam outro). Um sinal só ou dúvida: "não
 * verificado". Saneamento de melhor esforço: nome de pessoa em texto livre não é detectável.
 */
function ementaDoAto(tipoDocumento: string | undefined, html: string | undefined, digitos: string, bruto: Bruto): EmentaDjen {
  // Só o valor exato fictício aceito; nenhum sinônimo é inferido sem prova do formato.
  if (tipoDocumento !== "Acórdão" || !html || !/^\d{20}$/.test(digitos)) return "não verificado";
  const texto = htmlParaTexto(html);
  const numeros = (texto.match(NUMERO_CNJ) ?? []).map((n) => n.replace(/\D/g, ""));
  const marcas = [...texto.matchAll(/\bEMENTA\b/gi)];
  const cabecalho = [...texto.matchAll(/^EMENTA\s*[:.\-–]\s*/gim)];
  const finais = [...texto.matchAll(/^AC[ÓO]RD[ÃA]O\s*:/gim)];
  if (marcas.length !== 1 || cabecalho.length !== 1 || finais.length !== 1 || !numeros.length ||
      numeros.some((n) => n !== digitos) || !texto.slice(0, cabecalho[0].index).match(NUMERO_CNJ) || finais[0].index <= cabecalho[0].index ||
      /\b(?:transcri\w*|precedente|in verbis|ata|pauta|RELAT[ÓO]RIO|VOTO)\b/i.test(texto)) return "não verificado";
  if ((texto.match(/\b(?:ACORDAM|DECIDEM)\b/gi) ?? []).length > 1) return "não verificado";
  const depois = texto.slice(cabecalho[0].index + cabecalho[0][0].length, finais[0].index);
  const semPessoas = depois.split("\n").filter((l) => !LINHA_DE_PESSOA.test(l)).join(" ");
  // Nomes declarados pela própria comunicação: qualquer ocorrência no trecho impede sua saída.
  for (const campo of ["destinatarios", "destinatarioadvogados"] as const) {
    const pessoas = bruto[campo];
    if (pessoas === undefined) continue;
    if (!Array.isArray(pessoas)) return "não verificado";
    for (const pessoa of pessoas) {
      const registro = campo === "destinatarioadvogados" ? pessoa?.advogado : pessoa;
      if (!registro || typeof registro.nome !== "string" || !registro.nome.trim()) return "não verificado";
      if (semPessoas.toLocaleLowerCase("pt-BR").includes(registro.nome.trim().toLocaleLowerCase("pt-BR")))
        return "não verificado";
    }
  }
  // Nomes livres detectáveis ou aspas de transcrição: na dúvida não há trecho.
  if (/["“”«»]|\b[A-ZÀ-Ý][a-zà-ÿ]+\s+(?:(?:de|da|do|dos|das)\s+)?[A-ZÀ-Ý][a-zà-ÿ]+\b/.test(semPessoas))
    return "não verificado";
  const trecho = textoExternoLimpo(
    semPessoas
      .replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, "[número retirado]")
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
  const comunicacoes = r.items.slice(0, POR_PAGINA).map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ementa: "não verificado" as const };
    const i = item as Bruto;
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
        /ac[óo]rd[ãa]o/i.test(texto(i.tipoDocumento) ?? "") || /(?:^|[^A-Za-zÀ-ÿ])EMENTA(?![A-Za-zÀ-ÿ])/i.test(texto(i.texto) ?? "")
          ? ementaDoAto(texto(i.tipoDocumento), texto(i.texto), digitos, i)
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
