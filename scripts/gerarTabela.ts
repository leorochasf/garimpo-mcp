/**
 * Gerador da tabela de precedentes (ADR-0015): script do mantenedor, fora do pacote npm. Baixa do Portal de Dados
 * Abertos do STJ o conjunto "Precedentes qualificados" (página do conjunto, temas.csv e processos.csv) pelo cliente
 * único do Garimpo e grava a fotografia datada dos temas repetitivos e IAC em dados/.
 *
 * Rede: só as três URLs abaixo (nunca /api/, nunca processo.stj.jus.br, que o robots.txt proíbem), 10 s entre
 * chamadas (Crawl-Delay do robots.txt), uma nova tentativa em 429/503 e parada em recusa, 403 ou desafio anti-robô
 * que o cliente reconhece (cf-mitigated, AWS WAF). Uma página de desafio desconhecida com HTTP 200 para o gerador
 * porque não traz a licença (página) nem o cabeçalho esperado (CSV).
 * Qualquer parada acontece antes da gravação: a tabela anterior só é trocada no fim, de uma vez.
 *
 * Uso: npm run gerar-tabela (scripts/rodarGerador.ts)
 */

import { createHash } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Cliente } from "../src/cliente.js";
import {
  ATRIBUICAO,
  type LinhaDaTabela,
  type TabelaDePrecedentes,
  type TipoNaTabela,
} from "../src/tabelaDePrecedentes.js";

export const PAGINA_DO_CONJUNTO = "https://dadosabertos.web.stj.jus.br/dataset/precedentes-qualificados";
const RECURSOS = "https://dadosabertos.web.stj.jus.br/dataset/4238da2f-c07b-4c1a-b345-4402accacdcf/resource";
export const URL_TEMAS = `${RECURSOS}/df29da13-7d6b-41ba-ad96-cd1a5bbd191c/download/temas.csv`;
export const URL_PROCESSOS = `${RECURSOS}/7ed21202-0049-4fcb-aa7c-48d810d3c499/download/processos.csv`;
const HOST = "dadosabertos.web.stj.jus.br";
/** Crawl-Delay: 10 do robots.txt do portal de dados. */
export const INTERVALO_MS = 10_000;
export const VERSAO_DO_GERADOR = "1";

export const DESTINO_PADRAO = fileURLToPath(new URL("../dados/tabela-precedentes-stj.json", import.meta.url));

/** O gerador para: a tabela anterior fica como estava. */
export class ParadaDoGerador extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParadaDoGerador";
  }
}

/** Só a página do conjunto e os downloads do conjunto; nunca /api/ nem outro host. */
export function urlPermitida(url: string): boolean {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.host !== HOST || u.search || /^\/api(\/|$)/.test(u.pathname)) return false;
  return url === PAGINA_DO_CONJUNTO || (url.startsWith(`${RECURSOS}/`) && /\/download\/[^/]+$/.test(u.pathname));
}

export interface Arquivo {
  url: string;
  bytes: Buffer;
  /** Data e hora (ISO, UTC) em que o download terminou. */
  coletadoEm: string;
}

export interface ConjuntoBaixado {
  pagina: Arquivo;
  temas: Arquivo;
  processos: Arquivo;
}

/** Cliente do gerador: identificação do Garimpo, freios compartilhados e 10 s entre chamadas ao portal de dados. */
export function clienteDoGerador(): Cliente {
  return new Cliente({ nome: "O STJ", intervaloMinimoPorHost: { [HOST]: INTERVALO_MS }, prazoMs: 300_000 });
}

export async function baixarConjunto(cliente: Cliente, agora: () => number = Date.now): Promise<ConjuntoBaixado> {
  const baixar = async (url: string): Promise<Arquivo> => {
    if (!urlPermitida(url)) throw new ParadaDoGerador(`URL fora do conjunto, não pedida: ${url}`);
    // Redirecionamento não é seguido: o destino poderia ser uma URL que o gerador não pode pedir.
    const r = await cliente.requisitar(url, { redirect: "manual" }).catch((e: Error) => {
      throw new ParadaDoGerador(`${e.message} Nada foi gravado; a tabela anterior continua.`);
    });
    if (r.status !== 200) {
      await r.body?.cancel();
      throw new ParadaDoGerador(`O STJ respondeu HTTP ${r.status} para ${url}. Nada foi gravado; a tabela anterior continua.`);
    }
    const bytes = Buffer.from(await r.arrayBuffer());
    return { url, bytes, coletadoEm: new Date(agora()).toISOString() };
  };
  const pagina = await baixar(PAGINA_DO_CONJUNTO);
  const temas = await baixar(URL_TEMAS);
  const processos = await baixar(URL_PROCESSOS);
  return { pagina, temas, processos };
}

/** Baixa, gera e só então grava (arquivo temporário + troca), para nunca deixar a tabela pela metade. */
export async function gerarEGravar(
  cliente: Cliente,
  destino: string = DESTINO_PADRAO,
  agora: () => number = Date.now,
): Promise<TabelaDePrecedentes> {
  const conjunto = await baixarConjunto(cliente, agora);
  const tabela = gerarTabela(conjunto, new Date(agora()).toISOString());
  const provisorio = `${destino}.gerando`;
  writeFileSync(provisorio, `${JSON.stringify(tabela, null, 1)}\n`);
  renameSync(provisorio, destino);
  return tabela;
}

// ——— Parte pura: bytes dos CSV e da página → tabela ———

/** Cabeçalho literal de temas.csv (fontes.md, item c). Outro cabeçalho para o gerador. */
export const CABECALHO_TEMAS = [
  "sequencialPrecedente", "tipoPrecedente", "numeroPrecedente", "dataPrimeiraAfetacao", "dataJulgamento",
  "dataPublicacaoAcordao", "situacao", "informacoesComplementares", "questaoSubmetidaAJulgamento", "teseFirmada",
  "anotacoesNUGEPNAC", "delimitacaoJulgado", "entendimentoAnterior", "referenciaLegislativa", "referenciaSumular",
  "sumulaOriginada", "audienciaPublica", "dataAudienciaPublica", "orgaoJulgador", "Assuntos",
  "numeroRepercussaoGeralSTF", "descricaoRepercussaoGeral",
];

/** Cabeçalho literal de processos.csv (conferido no arquivo baixado em 2026-10-09). */
export const CABECALHO_PROCESSOS = [
  "sequencialPrecedente", "tipoPrecedente", "numeroPrecedente", "Processo", "numeroRegistro", "ministroRelator",
  "leadingCase", "dataAfetacao", "dataPublicacaoAfetacao", "observacaoAfetacao", "NOME_MINISTRO_AFETACAO",
  "dataVistaMPF", "dataJulgamento", "dataPbulicacaoAcordao", "processoSTF", "dataRemessaSTF", "situacaoProcessoSTF",
  "tribunalOrigem", "siglaTribunalOrigem", "siglaRegiaoOrigem", "origemUF", "tipoJusticaOrigem",
  "quantidadeProcessosSuspensoNaOrigem", "dataPublicacaoEmbargosDeDeclaração", "Desafetação", "Embargos de Divergência",
];

/** Tipos da fonte que entram, com o rótulo que o Garimpo dá às listas do site. */
const TIPOS: Record<string, TipoNaTabela> = { Tema: "tema repetitivo", IAC: "IAC" };

export function gerarTabela(c: ConjuntoBaixado, geradaEm: string): TabelaDePrecedentes {
  const temas = lerCsv(c.temas.bytes, CABECALHO_TEMAS, "temas.csv");
  const paradigmas = paradigmasPorSequencial(lerCsv(c.processos.bytes, CABECALHO_PROCESSOS, "processos.csv"));
  const porChave = new Map<string, LinhaDaTabela>();
  for (const t of temas) {
    const tipo = TIPOS[t.tipoPrecedente];
    if (!tipo) continue;
    const numero = Number(t.numeroPrecedente);
    if (!/^\d+$/.test(t.numeroPrecedente) || !numero) {
      throw new ParadaDoGerador(`temas.csv: ${t.tipoPrecedente} com número "${t.numeroPrecedente}" que não é inteiro.`);
    }
    const onde = `${t.tipoPrecedente} ${numero}`;
    const processos = paradigmas.get(t.sequencialPrecedente);
    const linha: LinhaDaTabela = {
      tipo,
      numero,
      ...campo("situacao", t.situacao),
      ...campo("teseFirmada", textoLiteral(t.teseFirmada, `${onde}, teseFirmada`)),
      ...campo("questaoSubmetida", textoLiteral(t.questaoSubmetidaAJulgamento, `${onde}, questaoSubmetidaAJulgamento`)),
      ...campo("orgaoJulgador", t.orgaoJulgador),
      ...campo("dataPrimeiraAfetacao", t.dataPrimeiraAfetacao),
      ...campo("dataJulgamento", t.dataJulgamento),
      ...campo("dataPublicacaoAcordao", t.dataPublicacaoAcordao),
      ...(processos ? { processosParadigma: processos } : {}),
      ...campo("sumulaOriginada", t.sumulaOriginada),
      ...campo("referenciaSumular", t.referenciaSumular),
    };
    const rg = t.numeroRepercussaoGeralSTF.trim();
    // A fonte repete a linha do tema uma vez por tema de repercussão geral ligado: as linhas se juntam numa só, com
    // os números de RG em lista. Qualquer outro campo diferente para o mesmo número para o gerador, que não escolhe.
    const chave = `${tipo} ${numero}`;
    const anterior = porChave.get(chave);
    if (anterior) {
      const { numerosRepercussaoGeralSTF: rgs = [], ...resto } = anterior;
      if (JSON.stringify(resto) !== JSON.stringify(linha)) {
        throw new ParadaDoGerador(`temas.csv: ${onde} aparece em linhas com conteúdo diferente; o gerador parou para decisão.`);
      }
      if (rg && !rgs.includes(rg)) anterior.numerosRepercussaoGeralSTF = [...rgs, rg];
      continue;
    }
    porChave.set(chave, rg ? { ...linha, numerosRepercussaoGeralSTF: [rg] } : linha);
  }
  const linhas = [...porChave.values()];
  return {
    fonte: { conjunto: "Precedentes qualificados", portal: "STJ — Portal de Dados Abertos", pagina: PAGINA_DO_CONJUNTO },
    atribuicao: ATRIBUICAO,
    licenca: licencaDaPagina(c.pagina),
    atualizacaoDaFonte: atualizacaoDaFonte(c.pagina),
    arquivos: [c.pagina, c.temas, c.processos].map((a) => ({
      url: a.url,
      coletadoEm: a.coletadoEm,
      sha256: createHash("sha256").update(a.bytes).digest("hex"),
    })),
    geradaEm,
    versaoDoGerador: VERSAO_DO_GERADOR,
    transformacaoDosTextos: "tese firmada e questão submetida: só CRLF → LF e espaço das pontas removido",
    linhas,
  };
}

/**
 * Processos paradigma por sequencial do precedente: os marcados `S` em leadingCase ("Processo que lidera o grupo de
 * processos", dicionário de processos.csv), sem os que têm qualquer texto em Desafetação. Sem nenhum, o campo não sai.
 */
function paradigmasPorSequencial(processos: Record<string, string>[]): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const p of processos) {
    const processo = p.Processo.trim();
    if (p.leadingCase !== "S" || p["Desafetação"].trim() || !processo) continue;
    const lista = mapa.get(p.sequencialPrecedente) ?? [];
    if (!lista.includes(processo)) lista.push(processo);
    mapa.set(p.sequencialPrecedente, lista);
  }
  return mapa;
}

/** Campo vazio fica de fora da linha: a consulta diz que a fonte não informa. */
function campo<K extends string>(nome: K, valor: string | undefined): Partial<Record<K, string>> {
  const v = valor?.replace(/\r\n/g, "\n").trim();
  return v ? ({ [nome]: v } as Record<K, string>) : {};
}

/** Marcação HTML no texto da fonte para o gerador: limpar seria reescrever a fonte em silêncio. */
function textoLiteral(valor: string, onde: string): string {
  if (/<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>|&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(valor)) {
    throw new ParadaDoGerador(`Marcação HTML em ${onde}: o gerador parou para decisão (não limpa o texto da fonte).`);
  }
  return valor;
}

/** "Última Atualização …" literal da página do conjunto, ou "não informada". Nunca Last-Modified nem Date. */
function atualizacaoDaFonte(pagina: Arquivo): { texto: string; pagina: string } {
  const texto = textoDaPagina(pagina.bytes).match(/Última Atualização\s+([^\n]*?\(UTC\))/);
  return { texto: texto ? `Última Atualização ${texto[1]}` : "não informada", pagina: pagina.url };
}

/** A licença como a página declara; sem ela, o gerador para. */
function licencaDaPagina(pagina: Arquivo): { declarada: string; conferidaEm: string } {
  const texto = textoDaPagina(pagina.bytes);
  if (!/Creative Commons Atribuição/.test(texto)) {
    throw new ParadaDoGerador('A página do conjunto não declara mais "Creative Commons Atribuição": o gerador parou.');
  }
  return {
    declarada: `Creative Commons Atribuição, conforme a página do conjunto em ${pagina.coletadoEm.slice(0, 10)}`,
    conferidaEm: pagina.coletadoEm,
  };
}

/** Texto visível da página, com espaços simples por linha (só para achar os rótulos literais). */
function textoDaPagina(bytes: Buffer): string {
  return bytes
    .toString("utf8")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * CSV (RFC 4180): vírgula, aspas duplas, aspas dobradas e quebra de linha dentro do campo. O cabeçalho precisa ser
 * exatamente o esperado; senão o gerador para em vez de adivinhar campos.
 */
export function lerCsv(bytes: Buffer, esperado: readonly string[], nome: string): Record<string, string>[] {
  const texto = bytes.toString("utf8").replace(/^﻿/, "");
  const registros: string[][] = [];
  let registro: string[] = [];
  let valor = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') {
        valor += '"';
        i++;
      } else if (ch === '"') aspas = false;
      else valor += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ",") {
      registro.push(valor);
      valor = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      registro.push(valor);
      registros.push(registro);
      registro = [];
      valor = "";
    } else valor += ch;
  }
  if (aspas) throw new ParadaDoGerador(`${nome}: aspas sem fechamento no fim do arquivo.`);
  if (valor || registro.length) registros.push([...registro, valor]);
  const [cabecalho, ...corpo] = registros.filter((r) => r.length > 1 || r[0] !== "");
  if (!cabecalho || cabecalho.join(",") !== esperado.join(",")) {
    throw new ParadaDoGerador(
      `${nome}: cabeçalho diferente do esperado. Esperado: ${esperado.join(",")}. Veio: ${cabecalho?.join(",") ?? "(vazio)"}.`,
    );
  }
  return corpo.map((r, n) => {
    if (r.length !== cabecalho.length) {
      throw new ParadaDoGerador(`${nome}: o registro ${n + 1} tem ${r.length} campos, e o cabeçalho ${cabecalho.length}.`);
    }
    return Object.fromEntries(cabecalho.map((c, i) => [c, r[i]]));
  });
}
