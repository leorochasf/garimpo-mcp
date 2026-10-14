/**
 * Gerador do índice "dispositivo legal → acórdãos do STJ" (ADR-0022): script do mantenedor, fora do pacote npm. Lê as
 * fichas dos 10 conjuntos "Espelhos de Acórdãos" do Portal de Dados Abertos do STJ, baixa o ZIP do histórico e os JSON
 * mensais pelo cliente único do Garimpo e grava, em dados/, a fotografia datada só das leis do piloto.
 *
 * Rede: só as 10 páginas de ficha e os downloads AAAAMMDD.json/.zip desses conjuntos (nunca /api/, que o robots.txt
 * do portal proíbe; nunca processo.stj.jus.br), uma chamada por vez com 10 s entre elas (Crawl-Delay do robots.txt),
 * sem seguir redirecionamento, uma nova tentativa em 429/503/504 e parada em recusa. Cada arquivo baixado vai para um cache
 * FORA do repositório; a rodada é retomável: arquivo já no cache (com o mesmo sha256) não é baixado de novo.
 * Qualquer parada acontece antes da gravação: o índice anterior só é trocado no fim, de uma vez.
 *
 * Uso: npm run gerar-espelhos (scripts/rodarGeradorEspelhos.ts)
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Cliente, type OpcoesCliente } from "../src/cliente.js";
import { lerReferenciasLegislativas } from "../src/referenciaLegislativa.js";
import { lerZip } from "./lerZip.js";

export const HOST = "dadosabertos.web.stj.jus.br";
/** Crawl-Delay: 10 do robots.txt do portal de dados. */
export const INTERVALO_MS = 10_000;
export const VERSAO_DO_GERADOR = "1";

export const ORGAOS = [
  "corte-especial",
  "primeira-secao",
  "segunda-secao",
  "terceira-secao",
  "primeira-turma",
  "segunda-turma",
  "terceira-turma",
  "quarta-turma",
  "quinta-turma",
  "sexta-turma",
] as const;
export type Orgao = (typeof ORGAOS)[number];

export const paginaDaFicha = (orgao: Orgao): string => `https://${HOST}/dataset/espelhos-de-acordaos-${orgao}`;

/** O gerador para: o índice anterior fica como estava; o cache fica para a retomada. */
export class ParadaDoGerador extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParadaDoGerador";
  }
}

const DOWNLOAD = /^\/dataset\/[0-9a-f-]{36}\/resource\/[^/]+\/download\/(\d{8})\.(json|zip)$/;
const DICIONARIO = /^\/dataset\/[0-9a-f-]{36}\/resource\/[^/]+\/download\/dicionario-espelhodoacordao\.csv$/;

function analisar(url: string): URL | undefined {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.host === HOST && !u.search && !u.hash ? u : undefined;
  } catch {
    return undefined;
  }
}

/** Só a ficha dos 10 conjuntos e os downloads AAAAMMDD.json/.zip deles; nunca /api/ nem outro host. */
export function urlPermitida(url: string): boolean {
  const u = analisar(url);
  if (!u || /^\/api(\/|$)/.test(u.pathname)) return false;
  return ORGAOS.some((o) => url === paginaDaFicha(o)) || DOWNLOAD.test(u.pathname);
}

export interface ArquivoDaFicha {
  /** AAAAMMDD.json ou AAAAMMDD.zip, como no link de download. */
  nome: string;
  url: string;
}

export interface Ficha {
  orgao: Orgao;
  licenca: string;
  /** "Última Atualização …" literal da ficha, ou "não informada". */
  atualizacaoDaFonte: string;
  /** Em ordem de data do nome: o histórico (ZIP) antes dos mensais. */
  arquivos: ArquivoDaFicha[];
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
 * Lê a ficha de um conjunto: confere a licença declarada, guarda a atualização literal e lista os arquivos de download.
 * Licença ausente, link fora do conjunto, links de mais de um conjunto ou ficha sem arquivo param o gerador.
 */
export function lerFicha(bytes: Buffer, orgao: Orgao, coletadoEm: string): Ficha {
  const texto = textoDaPagina(bytes);
  if (!/Creative Commons Atribuição/.test(texto)) {
    throw new ParadaDoGerador(`A ficha de ${orgao} não declara mais "Creative Commons Atribuição": o gerador parou.`);
  }
  const atualizacao = texto.match(/Última Atualização\s+([^\n]*?\(UTC\))/);
  const arquivos = new Map<string, ArquivoDaFicha>();
  const conjuntos = new Set<string>();
  for (const [, link] of bytes.toString("utf8").matchAll(/href="([^"]*\/download\/[^"]*)"/g)) {
    const u = analisar(link);
    if (u && DICIONARIO.test(u.pathname)) continue;
    const nome = u && DOWNLOAD.test(u.pathname) ? u.pathname.split("/").pop() : undefined;
    if (!u || !nome) throw new ParadaDoGerador(`A ficha de ${orgao} aponta para um download fora do conjunto: ${link}`);
    conjuntos.add(u.pathname.split("/")[2]);
    arquivos.set(link, { nome, url: link });
  }
  if (conjuntos.size > 1) throw new ParadaDoGerador(`A ficha de ${orgao} mistura downloads de mais de um conjunto.`);
  if (arquivos.size === 0) throw new ParadaDoGerador(`A ficha de ${orgao} não traz nenhum arquivo de download.`);
  return {
    orgao,
    licenca: `Creative Commons Atribuição, conforme a ficha do conjunto em ${coletadoEm.slice(0, 10)}`,
    atualizacaoDaFonte: atualizacao ? `Última Atualização ${atualizacao[1]}` : "não informada",
    arquivos: [...arquivos.values()].sort((a, b) => a.nome.localeCompare(b.nome)),
  };
}

// ——— Índice: registros dos espelhos → dispositivo → acórdãos ———

export const ATRIBUICAO = "Portal de Dados Abertos do STJ — Espelhos de Acórdãos, licença CC BY";

/** As leis do piloto (ADR-0022), por tipo, número e ano do ato; a sigla da fonte varia e não identifica a lei. */
const LEIS_DO_PILOTO: Record<string, { chave: string; descricao: string }> = {
  "LEI:13105/2015": { chave: "CPC/15", descricao: "Lei 13.105/2015 (Código de Processo Civil)" },
  "LEI:10406/2002": { chave: "CC/02", descricao: "Lei 10.406/2002 (Código Civil)" },
  "LEI:8078/1990": { chave: "CDC", descricao: "Lei 8.078/1990 (Código de Defesa do Consumidor)" },
};

const CAMPOS = ["id", "classe", "numero", "registro", "orgao", "relator", "dataJulgamento", "dataPublicacao"] as const;
type Linha = (string | null)[];

export interface ArquivoBaixado {
  orgao: Orgao;
  nome: string;
  url: string;
  coletadoEm: string;
  sha256: string;
  bytes: number;
}

export interface MetaDoIndice {
  geradaEm: string;
  fichas: { orgao: Orgao; licenca: string; atualizacaoDaFonte: string; url: string }[];
  arquivos: ArquivoBaixado[];
}

export interface IndiceEspelhos {
  fonte: { conjunto: string; portal: string; paginas: string[] };
  atribuicao: string;
  geradaEm: string;
  versaoDoGerador: string;
  aviso: string;
  campos: readonly string[];
  leis: Record<string, { descricao: string; acordaos: number; artigos: number; dispositivos: number }>;
  conjuntos: Record<
    string,
    { pagina: string; licenca: string; atualizacaoDaFonte: string; mesesAusentes: string[]; arquivos: Omit<ArquivoBaixado, "orgao">[] }
  >;
  contagens: {
    registrosLidos: number;
    duplicadosPorId: number;
    duplicadosPorRegistroDataClasse: number;
    acordaosDistintos: number;
    acordaosIndexados: number;
    textosDeReferenciaSemPar: number;
  };
  acordaos: Linha[];
  /** lei → artigo → detalhe ("" = só o artigo; "§8", "inc 3"…) → posições em `acordaos`. */
  dispositivos: Record<string, Record<string, Record<string, number[]>>>;
}

const AVISO =
  "Classificação da Secretaria de Jurisprudência do STJ, Espelhos de Acórdãos, CC BY. Inclui apenas acórdãos " +
  "selecionados e classificados pelo STJ, com lacunas importantes nos recentes. Não é a lista de todos os acórdãos que " +
  "aplicaram o dispositivo.";

function dataDaDecisao(v: unknown): string | null {
  const m = typeof v === "string" ? /^(\d{4})(\d{2})(\d{2})$/.exec(v.trim()) : null;
  return m ? dataValida(m[1], m[2], m[3]) : null;
}

function dataDaPublicacao(v: unknown): string | null {
  const m = typeof v === "string" ? /DATA:(\d{2})\/(\d{2})\/(\d{4})/.exec(v) : null;
  return m ? dataValida(m[3], m[2], m[1]) : null;
}

function dataValida(a: string, m: string, d: string): string | null {
  const dia = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  return dia.getUTCFullYear() === Number(a) && dia.getUTCMonth() === Number(m) - 1 && dia.getUTCDate() === Number(d)
    ? `${a}-${m}-${d}`
    : null;
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

type Dispositivo = readonly [lei: string, artigo: string, detalhe: string];
interface Entrada {
  identidade?: string;
  linha?: Linha;
  dispositivos?: Dispositivo[];
}

/** "§8 inc 3 al B item 4": só os níveis que a fonte trouxe, do mais alto ao mais fundo. */
function detalheDe(p: { paragrafo?: string; inciso?: string; alinea?: string; item?: string }): string {
  return [p.paragrafo && `§${p.paragrafo}`, p.inciso && `inc ${p.inciso}`, p.alinea && `al ${p.alinea}`, p.item && `item ${p.item}`]
    .filter(Boolean)
    .join(" ");
}

/** Meses (AAAA-MM) sem arquivo mensal entre o primeiro e o último mensal; o ZIP do histórico não conta. */
export function mesesAusentes(nomes: readonly string[]): string[] {
  const meses = new Set(nomes.filter((n) => n.endsWith(".json")).map((n) => `${n.slice(0, 4)}-${n.slice(4, 6)}`));
  if (meses.size === 0) return [];
  const ordenados = [...meses].sort();
  const ausentes: string[] = [];
  let [a, m] = ordenados[0].split("-").map(Number);
  const [fa, fm] = ordenados[ordenados.length - 1].split("-").map(Number);
  while (a < fa || (a === fa && m <= fm)) {
    const mes = `${a}-${String(m).padStart(2, "0")}`;
    if (!meses.has(mes)) ausentes.push(mes);
    if (++m > 12) [a, m] = [a + 1, 1];
  }
  return ausentes;
}

export class ConstrutorDoIndice {
  private readonly porId = new Map<string, Entrada>();
  private readonly porIdentidade = new Map<string, string>();
  private lidos = 0;
  private duplicadosPorId = 0;
  private duplicadosPorIdentidade = 0;
  private textosSemPar = 0;

  /** Registros de um arquivo, do mais antigo para o mais novo: a versão nova de um acórdão substitui a antiga. */
  adicionar(registros: unknown, origem: string): void {
    if (!Array.isArray(registros)) throw new ParadaDoGerador(`${origem}: o JSON não é uma lista de registros.`);
    for (const r of registros) {
      if (typeof r !== "object" || r === null || Array.isArray(r)) {
        throw new ParadaDoGerador(`${origem}: registro que não é um objeto; o formato mudou.`);
      }
      this.adicionarUm(r as Record<string, unknown>, origem);
    }
  }

  private adicionarUm(r: Record<string, unknown>, origem: string): void {
    this.lidos++;
    const registro = texto(r.numeroRegistro);
    const classe = texto(r.siglaClasse);
    const decisao = texto(r.dataDecisao);
    const identidade = registro && classe && decisao ? `${registro}|${decisao}|${classe}` : undefined;
    const id = texto(r.id) ?? (identidade && `sem-id:${identidade}`);
    if (!id) throw new ParadaDoGerador(`${origem}: registro sem id e sem registro+data+classe; o formato mudou.`);
    if (this.porId.has(id)) {
      this.duplicadosPorId++;
      this.remover(id);
    }
    if (identidade && this.porIdentidade.has(identidade)) {
      this.duplicadosPorIdentidade++;
      this.remover(this.porIdentidade.get(identidade) as string);
    }
    const dispositivos = this.dispositivosDoPiloto(r.referenciasLegislativas, origem);
    const entrada: Entrada = { identidade };
    if (dispositivos.length > 0) {
      entrada.dispositivos = dispositivos;
      entrada.linha = [
        id,
        classe,
        texto(r.numeroProcesso),
        registro,
        texto(r.nomeOrgaoJulgador),
        texto(r.ministroRelator),
        dataDaDecisao(r.dataDecisao),
        dataDaPublicacao(r.dataPublicacao),
      ];
    }
    this.porId.set(id, entrada);
    if (identidade) this.porIdentidade.set(identidade, id);
  }

  private remover(id: string): void {
    const antiga = this.porId.get(id);
    if (antiga?.identidade && this.porIdentidade.get(antiga.identidade) === id) this.porIdentidade.delete(antiga.identidade);
    this.porId.delete(id);
  }

  private dispositivosDoPiloto(referencias: unknown, origem: string): Dispositivo[] {
    if (referencias === null || referencias === undefined) return [];
    const textos = typeof referencias === "string" ? [referencias] : referencias;
    if (!Array.isArray(textos) || textos.some((t) => typeof t !== "string")) {
      throw new ParadaDoGerador(`${origem}: referenciasLegislativas fora do formato (texto ou lista de textos); o formato mudou.`);
    }
    const achados = new Map<string, Dispositivo>();
    for (const t of textos as string[]) {
      const pares = lerReferenciasLegislativas([t]);
      if (pares.length === 0 && t.trim()) this.textosSemPar++;
      for (const p of pares) {
        const lei = p.numero && p.ano ? LEIS_DO_PILOTO[`${p.tipo}:${p.numero}/${p.ano}`] : undefined;
        if (!lei || p.esfera !== "FED" || p.artigo === undefined) continue;
        const d: Dispositivo = [lei.chave, p.artigo, detalheDe(p)];
        achados.set(d.join("\u0000"), d);
      }
    }
    return [...achados.values()];
  }

  montar(meta: MetaDoIndice): IndiceEspelhos {
    const entradas = [...this.porId.values()].filter((e): e is Entrada & { linha: Linha; dispositivos: Dispositivo[] } => !!e.linha);
    // Posição estável: data do julgamento, registro, id.
    entradas.sort((a, b) => {
      const [ia, , , ra, , , da] = a.linha;
      const [ib, , , rb, , , db] = b.linha;
      return (da ?? "").localeCompare(db ?? "") || (ra ?? "").localeCompare(rb ?? "") || (ia ?? "").localeCompare(ib ?? "");
    });
    const dispositivos: IndiceEspelhos["dispositivos"] = {};
    const acordaosPorLei = new Map<string, Set<number>>();
    entradas.forEach((e, posicao) => {
      for (const [lei, artigo, detalhe] of e.dispositivos) {
        const porDetalhe = ((dispositivos[lei] ??= {})[artigo] ??= {});
        (porDetalhe[detalhe] ??= []).push(posicao);
        let conjunto = acordaosPorLei.get(lei);
        if (!conjunto) acordaosPorLei.set(lei, (conjunto = new Set()));
        conjunto.add(posicao);
      }
    });
    const leis: IndiceEspelhos["leis"] = {};
    for (const { chave, descricao } of Object.values(LEIS_DO_PILOTO)) {
      const artigos = dispositivos[chave] ?? {};
      leis[chave] = {
        descricao,
        acordaos: acordaosPorLei.get(chave)?.size ?? 0,
        artigos: Object.keys(artigos).length,
        dispositivos: Object.values(artigos).reduce((n, d) => n + Object.keys(d).length, 0),
      };
    }
    const conjuntos: IndiceEspelhos["conjuntos"] = {};
    for (const f of meta.fichas) {
      const arquivos = meta.arquivos.filter((a) => a.orgao === f.orgao).map(({ orgao: _orgao, ...resto }) => resto);
      conjuntos[f.orgao] = {
        pagina: f.url,
        licenca: f.licenca,
        atualizacaoDaFonte: f.atualizacaoDaFonte,
        mesesAusentes: mesesAusentes(arquivos.map((a) => a.nome)),
        arquivos,
      };
    }
    return {
      fonte: { conjunto: "Espelhos de Acórdãos", portal: "STJ — Portal de Dados Abertos", paginas: meta.fichas.map((f) => f.url) },
      atribuicao: ATRIBUICAO,
      geradaEm: meta.geradaEm,
      versaoDoGerador: VERSAO_DO_GERADOR,
      aviso: AVISO,
      campos: CAMPOS,
      leis,
      conjuntos,
      contagens: {
        registrosLidos: this.lidos,
        duplicadosPorId: this.duplicadosPorId,
        duplicadosPorRegistroDataClasse: this.duplicadosPorIdentidade,
        acordaosDistintos: this.porId.size,
        acordaosIndexados: entradas.length,
        textosDeReferenciaSemPar: this.textosSemPar,
      },
      acordaos: entradas.map((e) => e.linha),
      dispositivos,
    };
  }
}

// ——— Download com cache retomável ———

/** Raiz do repositório (a pasta acima de scripts/): o cache nunca fica dentro dela. */
const RAIZ_DO_REPOSITORIO = fileURLToPath(new URL("..", import.meta.url));

/** Cache padrão: pasta temporária do sistema, fora do repositório. */
export const CACHE_PADRAO = join(tmpdir(), "garimpo-espelhos-cache");
export const DESTINO_PADRAO = fileURLToPath(new URL("../dados/indice-espelhos-stj.json", import.meta.url));

/** Cliente do gerador: identificação do Garimpo, freios compartilhados e 10 s entre chamadas ao portal de dados. */
export function clienteDoGerador(extra: Partial<OpcoesCliente> = {}): Cliente {
  return new Cliente({ nome: "O STJ", intervaloMinimoPorHost: { [HOST]: INTERVALO_MS }, prazoMs: 600_000,
    statusAdicionaisDeEspera: [504], ...extra });
}

export interface ArquivoNoCache extends ArquivoBaixado {
  caminho: string;
}

export interface OpcoesDeDownload {
  orgaos?: readonly Orgao[];
  agora?: () => number;
  /** Uma linha por passo (ficha lida, arquivo baixado, arquivo reaproveitado do cache). */
  registrar?: (linha: string) => void;
}

interface Manifesto {
  versao: 1;
  itens: Record<string, { coletadoEm: string; sha256: string; bytes: number }>;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** O que o arquivo precisa ser para entrar no cache: uma página de desafio com HTTP 200 nunca entra. */
function formatoEsperado(nome: string, bytes: Buffer): boolean {
  if (nome.endsWith(".zip")) return bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50;
  if (nome.endsWith(".json")) return /^(?:﻿)?\s*\[/.test(bytes.subarray(0, 64).toString("utf8"));
  return true;
}

/**
 * Fichas dos conjuntos e depois os arquivos, um por vez, em ordem de data. Tudo o que chega vai para o cache (com sha256
 * no manifesto) e é reaproveitado na rodada seguinte; qualquer parada deixa o cache como está para a retomada.
 */
export async function baixarConjuntos(
  cliente: Cliente,
  cache: string,
  { orgaos = ORGAOS, agora = Date.now, registrar = () => {} }: OpcoesDeDownload = {},
): Promise<{ fichas: Ficha[]; arquivos: ArquivoNoCache[] }> {
  const relativo = relative(RAIZ_DO_REPOSITORIO, resolve(cache));
  if (relativo !== ".." && !relativo.startsWith(`..${sep}`) && !isAbsolute(relativo)) {
    throw new ParadaDoGerador(`O cache de downloads precisa ficar fora do repositório (${resolve(cache)}).`);
  }
  mkdirSync(cache, { recursive: true });
  const caminhoDoManifesto = join(cache, "manifesto.json");
  const manifesto: Manifesto = existsSync(caminhoDoManifesto)
    ? (JSON.parse(readFileSync(caminhoDoManifesto, "utf8")) as Manifesto)
    : { versao: 1, itens: {} };
  const guardar = () => {
    writeFileSync(`${caminhoDoManifesto}.gravando`, JSON.stringify(manifesto, null, 1));
    renameSync(`${caminhoDoManifesto}.gravando`, caminhoDoManifesto);
  };

  /** Do cache, se o arquivo está lá e confere com o hash do manifesto; senão baixa, confere o formato e guarda. */
  const obter = async (url: string, caminho: string, nome: string, validar: (b: Buffer, em: string) => void = () => {}) => {
    const guardado = manifesto.itens[url];
    // As fichas mudam: reler licença e recursos em cada rodada; só downloads são reaproveitados.
    if ((nome.endsWith(".json") || nome.endsWith(".zip")) && guardado && existsSync(caminho)) {
      const bytes = readFileSync(caminho);
      if (sha256(bytes) === guardado.sha256) {
        registrar(`cache  ${url}`);
        return { bytes, coletadoEm: guardado.coletadoEm };
      }
    }
    if (!urlPermitida(url)) throw new ParadaDoGerador(`URL fora do conjunto, não pedida: ${url}`);
    // Redirecionamento não é seguido: o destino poderia ser uma URL que o gerador não pode pedir.
    const r = await cliente.requisitar(url, { redirect: "manual" }).catch((e: Error) => {
      throw new ParadaDoGerador(`${e.message} O gerador parou; o cache fica para a retomada.`);
    });
    if (r.status !== 200) {
      await r.body?.cancel();
      throw new ParadaDoGerador(`O STJ respondeu HTTP ${r.status} para ${url}. O gerador parou; o cache fica para a retomada.`);
    }
    const bytes = Buffer.from(await r.arrayBuffer());
    const coletadoEm = new Date(agora()).toISOString();
    if (!formatoEsperado(nome, bytes)) {
      throw new ParadaDoGerador(`${url}: a resposta (HTTP 200) não é o arquivo esperado (${bytes.length} bytes); possível página de desafio.`);
    }
    validar(bytes, coletadoEm);
    guardarNoCache(url, caminho, bytes, coletadoEm);
    return { bytes, coletadoEm };
  };

  const guardarNoCache = (url: string, caminho: string, bytes: Buffer, coletadoEm: string) => {
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(`${caminho}.gravando`, bytes);
    renameSync(`${caminho}.gravando`, caminho);
    manifesto.itens[url] = { coletadoEm, sha256: sha256(bytes), bytes: bytes.length };
    guardar();
    registrar(`baixou ${url} (${bytes.length} bytes)`);
  };

  const fichas: Ficha[] = [];
  for (const orgao of orgaos) {
    const url = paginaDaFicha(orgao);
    const caminho = join(cache, "fichas", `${orgao}.html`);
    // Licença ausente ou link estranho param antes de a ficha entrar no cache.
    let lida: Ficha | undefined;
    const validar = (b: Buffer, em: string) => void (lida = lerFicha(b, orgao, em));
    const { bytes, coletadoEm } = await obter(url, caminho, `${orgao}.html`, validar);
    fichas.push(lida ?? lerFicha(bytes, orgao, coletadoEm));
  }

  const arquivos: ArquivoNoCache[] = [];
  for (const ficha of fichas) {
    for (const a of ficha.arquivos) {
      const caminho = join(cache, "arquivos", ficha.orgao, a.nome);
      const { bytes, coletadoEm } = await obter(a.url, caminho, a.nome);
      arquivos.push({ orgao: ficha.orgao, nome: a.nome, url: a.url, coletadoEm, sha256: sha256(bytes), bytes: bytes.length, caminho });
    }
  }
  return { fichas, arquivos };
}

// ——— Rodada inteira ———

/** Anota cada resposta HTTP de verdade (inclusive 429/503 e a nova tentativa): data, método, URL, status, bytes declarados, ms. */
export function fetchComRegistro(arquivoDeLog: string, base: typeof fetch = fetch, agora: () => number = Date.now): typeof fetch {
  mkdirSync(dirname(arquivoDeLog), { recursive: true });
  return (async (entrada, init) => {
    const inicio = agora();
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const r = await base(entrada, init);
    appendFileSync(
      arquivoDeLog,
      `${new Date(inicio).toISOString()} ${init?.method ?? "GET"} ${url} ${r.status} ${r.headers.get("content-length") ?? "-"} ${agora() - inicio}ms\n`,
    );
    return r;
  }) as typeof fetch;
}

/** Os registros de um arquivo baixado, na ordem: o ZIP traz um JSON por período, do mais antigo ao mais novo. */
function registrosDoArquivo(a: ArquivoNoCache): { origem: string; registros: unknown }[] {
  const bytes = readFileSync(a.caminho);
  const origem = `${a.orgao}/${a.nome}`;
  try {
    if (a.nome.endsWith(".zip")) {
      return lerZip(bytes)
        .filter((e) => e.nome.endsWith(".json"))
        .sort((x, y) => x.nome.localeCompare(y.nome))
        .map((e) => ({ origem: `${origem}:${e.nome}`, registros: JSON.parse(e.dados.toString("utf8")) }));
    }
    return [{ origem, registros: JSON.parse(bytes.toString("utf8")) }];
  } catch (e) {
    throw new ParadaDoGerador(`${origem}: arquivo ilegível (${(e as Error).message}); o gerador parou.`);
  }
}

export interface OpcoesDaGeracao extends OpcoesDeDownload {
  cache?: string;
  destino?: string;
  /** O mantenedor leu o que mudou e aceita a queda grande de acórdãos. */
  revisado?: boolean;
}

/** Abaixo desta fração dos acórdãos da fotografia anterior, o gerador para e pede revisão. */
const QUEDA_ACEITA = 0.9;

/** O relatório fica junto ao cache, fora do pacote; associa dispositivos a IDs, nunca a posições transitórias. */
function relatarAlteracoes(anterior: IndiceEspelhos, nova: IndiceEspelhos) {
  const linhas = (ix: IndiceEspelhos) => new Map((ix.acordaos ?? []).map((a) => [a[0], JSON.stringify(a)]));
  const antes = linhas(anterior);
  const depois = linhas(nova);
  const vinculos = (ix: IndiceEspelhos) => {
    const mapa: Record<string, (string | null)[]> = {};
    for (const [lei, artigos] of Object.entries(ix.dispositivos ?? {})) {
      for (const [artigo, detalhes] of Object.entries(artigos)) {
        for (const [detalhe, posicoes] of Object.entries(detalhes)) {
          mapa[`${lei} art ${artigo} ${detalhe}`.trim()] = posicoes.map((p) => ix.acordaos[p][0]).sort();
        }
      }
    }
    return mapa;
  };
  const a = vinculos(anterior);
  const b = vinculos(nova);
  return {
    acordaos: {
      incluidos: [...depois.keys()].filter((id) => !antes.has(id)),
      removidos: [...antes.keys()].filter((id) => !depois.has(id)),
      alterados: [...depois.keys()].filter((id) => antes.has(id) && antes.get(id) !== depois.get(id)),
    },
    dispositivos: [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
      .filter((chave) => JSON.stringify(a[chave]) !== JSON.stringify(b[chave]))
      .map((chave) => ({ chave, antes: a[chave] ?? [], depois: b[chave] ?? [] })),
  };
}

/**
 * Baixa (ou retoma do cache), lê, monta o índice, compara com o anterior e só então grava (arquivo temporário + troca),
 * para nunca deixar o índice pela metade. Erro de rede ou parada nunca chegam a gravar.
 */
export async function gerarEGravar(cliente: Cliente, opcoes: OpcoesDaGeracao = {}): Promise<IndiceEspelhos> {
  const { cache = CACHE_PADRAO, destino = DESTINO_PADRAO, revisado = false, agora = Date.now } = opcoes;
  const { fichas, arquivos } = await baixarConjuntos(cliente, cache, opcoes);
  const construtor = new ConstrutorDoIndice();
  for (const a of arquivos) {
    for (const { origem, registros } of registrosDoArquivo(a)) construtor.adicionar(registros, origem);
    opcoes.registrar?.(`leu    ${a.orgao}/${a.nome}`);
  }
  const indice = construtor.montar({
    geradaEm: new Date(agora()).toISOString(),
    fichas: fichas.map((f) => ({ orgao: f.orgao, licenca: f.licenca, atualizacaoDaFonte: f.atualizacaoDaFonte, url: paginaDaFicha(f.orgao) })),
    arquivos: arquivos.map(({ caminho: _caminho, ...resto }) => resto),
  });
  const json = Buffer.from(`${JSON.stringify(indice)}\n`);
  if (gzipSync(json).length > 3_000_000) {
    throw new ParadaDoGerador("O índice ultrapassa 3 MB compactado (gzip). Nada foi gravado; o piloto precisa de decisão.");
  }
  if (existsSync(destino)) {
    const bytesAnteriores = readFileSync(destino);
    const fotografiaAnterior = JSON.parse(bytesAnteriores.toString("utf8")) as IndiceEspelhos;
    const anterior = fotografiaAnterior.contagens?.acordaosIndexados;
    const relatorio = {
      anterior: { geradaEm: fotografiaAnterior.geradaEm, sha256: sha256(bytesAnteriores), leis: fotografiaAnterior.leis },
      nova: { geradaEm: indice.geradaEm, sha256: sha256(json), leis: indice.leis },
      ...relatarAlteracoes(fotografiaAnterior, indice),
    };
    const caminhoDoRelatorio = join(cache, "relatorio-alteracoes.json");
    writeFileSync(`${caminhoDoRelatorio}.gravando`, `${JSON.stringify(relatorio, null, 1)}\n`);
    renameSync(`${caminhoDoRelatorio}.gravando`, caminhoDoRelatorio);
    opcoes.registrar?.(`relatório de alterações: ${caminhoDoRelatorio}`);
    if (!revisado && typeof anterior === "number" && indice.contagens.acordaosIndexados < anterior * QUEDA_ACEITA) {
      throw new ParadaDoGerador(
        `O índice novo tem ${indice.contagens.acordaosIndexados} acórdãos e o anterior tinha ${anterior}. ` +
          "Nada foi gravado; confira o cache e rode de novo com --revisado se a queda é esperada.",
      );
    }
  }
  const provisorio = `${destino}.gerando`;
  writeFileSync(provisorio, json);
  renameSync(provisorio, destino);
  return indice;
}
