/**
 * Gerador da tabela de precedentes do STF (ADR-0015, decisão do dono de 2026-10-09): script do mantenedor, fora do
 * pacote npm. **Não usa rede por padrão**: lê os arquivos que o mantenedor obteve do portal do STF no navegador e
 * grava a fotografia datada em dados/tabela-precedentes-stf.json. Modo opcional `--baixar` (I-33, D-11): o script
 * obtém sozinho só a exportação de repercussão geral (uma chamada, pelo cliente único, 10 s entre chamadas, uma nova
 * tentativa em 429/503, parada em recusa, sem login nem desafio), com a trava de G-56; o resto vem da pasta.
 * Download inválido, recusa ou mudança inesperada param antes de gravar e a tabela anterior continua.
 *
 * Pasta de entrada (padrão `entrada-stf/`, fora do git), a cada versão:
 * - `RepercussaoGeral.xls`: tela "Todos os temas" de repercussão geral → botão "Exportar Dados"
 *   (https://portal.stf.jus.br/jurisprudenciaRepercussao/todostemas.asp). É uma tabela HTML, não planilha.
 * - `sumulas.html`: a tela https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=30 salva pelo navegador
 *   ("Salvar como", só HTML).
 * - `sumulas-vinculantes.html`: a tela https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26, idem.
 * - `sumulas/*.html` (opcional): a página de cada súmula cujo enunciado deve entrar na tabela, aberta pelo link da
 *   lista e salva do mesmo jeito.
 * Arquivo que falta deixa a parte dele vazia (a tabela diz quais partes faltam). A data de cada arquivo (data de
 * modificação no disco, que o navegador marca no download) é a data em que foi obtido.
 *
 * Texto: HTML → texto por regra fixa (espaços do código-fonte viram um espaço, <br>, </p> e </div> viram quebra de
 * linha, marcação removida, entidades decodificadas, linhas vazias e espaço das pontas removidos). A única correção é
 * a da coluna "Há Repercussão", que o STF exporta com acentuação duplamente codificada ("HÃ¡"); acentuação corrompida
 * em qualquer outra coluna para o gerador. Cabeçalho diferente do esperado, rótulo fora da forma, número repetido,
 * entidade HTML nomeada fora da lista de src/html.ts (Latin-1 e tipográficas) ou
 * arquivo sem nenhuma linha também param. Qualquer parada acontece antes da gravação.
 *
 * Uso: npx vite-node scripts/rodarGeradorStf.ts [pasta de entrada]
 */

import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATRIBUICAO_STF,
  FUNDAMENTO_STF,
  type LinhaDoStf,
  PAGINAS_DO_STF,
  type ParteDoStf,
  type TabelaDoStf,
  type TipoNoStf,
} from "../src/tabelaDoStf.js";
import { ENTIDADES } from "../src/html.js";
import { conferirComAAnterior, type OpcoesDaTrava } from "../src/tabelaDePrecedentes.js";
import { Cliente, HOST_PORTAL_STF } from "../src/cliente.js";

export const VERSAO_DO_GERADOR_STF = "1";
export const DESTINO_PADRAO_STF = fileURLToPath(new URL("../dados/tabela-precedentes-stf.json", import.meta.url));
/** Onde o relatório de mudanças (G-59) é gravado a cada geração da tabela empacotada. */
export const PASTA_DO_RELATORIO_STF = fileURLToPath(new URL("../docs/tabela-mudancas/", import.meta.url));
/** A exportação de RG do portal do STF (a rota do botão "Exportar Dados"); a única URL que o modo `--baixar` pede. */
export const URL_EXPORTACAO_RG = "https://portal.stf.jus.br/jurisprudenciaRepercussao/exportarDados.asp?";
/** Intervalo mínimo entre chamadas ao portal (D-11). */
export const INTERVALO_MS = 10_000;
export const ENTRADA_PADRAO_STF = fileURLToPath(new URL("../entrada-stf/", import.meta.url));

/** O gerador para: a tabela anterior fica como estava. */
export class ParadaDoGerador extends Error {
  constructor(message: string) {
    super(`${message} Nada foi gravado; a tabela anterior continua.`);
    this.name = "ParadaDoGerador";
  }
}

export interface ArquivoDoMantenedor {
  /** Caminho relativo à pasta de entrada, com "/". */
  nome: string;
  bytes: Buffer;
  /** Data e hora (ISO, UTC) em que o arquivo foi obtido (data de modificação no disco, ou fim do download). */
  obtidoEm: string;
  /** Só no que o próprio script baixou: a URL pedida. */
  url?: string;
}

export interface EntradaDoStf {
  repercussaoGeral?: ArquivoDoMantenedor;
  sumulas?: ArquivoDoMantenedor;
  sumulasVinculantes?: ArquivoDoMantenedor;
  paginasDeSumula: ArquivoDoMantenedor[];
}

/** Lê a pasta de entrada: os três arquivos, se existirem, e as páginas de súmula em sumulas/. */
export function lerEntrada(pasta: string): EntradaDoStf {
  const ler = (nome: string): ArquivoDoMantenedor | undefined => {
    const c = join(pasta, nome);
    if (!existsSync(c)) return undefined;
    return { nome, bytes: readFileSync(c), obtidoEm: statSync(c).mtime.toISOString() };
  };
  const sub = join(pasta, "sumulas");
  const paginas = existsSync(sub)
    ? readdirSync(sub).filter((n) => /\.html?$/i.test(n)).sort().map((n) => ler(`sumulas/${n}`)!)
    : [];
  return {
    repercussaoGeral: ler("RepercussaoGeral.xls"),
    sumulas: ler("sumulas.html"),
    sumulasVinculantes: ler("sumulas-vinculantes.html"),
    paginasDeSumula: paginas,
  };
}

/**
 * Lê, gera, compara com a tabela anterior (trava de G-56) e só então grava (temporário + troca), sem deixar a tabela
 * pela metade. `baixada` (modo `--baixar`) toma o lugar de `RepercussaoGeral.xls` da pasta; o resto vem da pasta.
 */
export function gerarEGravarStf(
  pasta: string = ENTRADA_PADRAO_STF,
  destino: string = DESTINO_PADRAO_STF,
  agora: () => number = Date.now,
  trava: OpcoesDaTrava = {},
  baixada?: ArquivoDoMantenedor,
): TabelaDoStf {
  const momento = new Date(agora()).toISOString();
  const entrada = { ...lerEntrada(pasta), ...(baixada ? { repercussaoGeral: baixada } : {}) };
  const tabela = { ...gerarTabelaStf(entrada, momento), conferidaEm: momento };
  conferirComAAnterior(
    destino,
    tabela,
    { pastaDoRelatorio: destino === DESTINO_PADRAO_STF ? PASTA_DO_RELATORIO_STF : undefined, ...trava },
    (m) => new ParadaDoGerador(m),
    { nome: "stf", proveniencia: proveniencia(tabela, baixada) },
  );
  const provisorio = `${destino}.gerando`;
  writeFileSync(provisorio, `${JSON.stringify(tabela, null, 1)}
`);
  renameSync(provisorio, destino);
  return tabela;
}

/**
 * Origem da versão nova, para o relatório de mudanças: páginas, arquivos (com URL e data do download, se baixado),
 * descartes. O gerador não descarta tema: o que vem sem título entra na tabela e é listado aqui.
 */
export function proveniencia(tabela: TabelaDoStf, baixada?: ArquivoDoMantenedor): string[] {
  const semTitulo = tabela.linhas.filter((l) => l.tipo === "repercussão geral" && !l.titulo).map((l) => l.numero);
  return [
    ...Object.entries(tabela.fonte.paginas).map(([tipo, pagina]) => `página de ${tipo}: ${pagina}`),
    ...tabela.arquivos.map((a) => {
      const url = baixada?.url && a.parte === "repercussão geral" ? `${baixada.url} (baixado pelo script) — ` : "";
      return `${a.parte}: ${url}${a.nome} — obtido em ${a.obtidoEm} — sha256 ${a.sha256}`;
    }),
    "descartes: nenhum",
    `repercussão geral sem título (mantidos na tabela): ${semTitulo.length}${semTitulo.length ? ` — tema ${semTitulo.join(", ")}` : ""}`,
  ];
}

/** Cliente do modo `--baixar`: identificação do portal (UA de navegador, ADR-0020), freios compartilhados e 10 s entre chamadas. */
export function clienteDoGeradorStf(): Cliente {
  return new Cliente({ nome: "O STF", intervaloMinimoPorHost: { [HOST_PORTAL_STF]: INTERVALO_MS }, prazoMs: 300_000 });
}

/**
 * Uma obtenção da exportação de RG. Redirecionamento não é seguido; qualquer coisa que não seja 200 (inclusive a
 * recusa depois da única nova tentativa do cliente) para antes de qualquer gravação. A validade do conteúdo (cabeçalho,
 * números, duplicatas) fica com `gerarTabelaStf`.
 */
export async function baixarExportacaoRg(cliente: Cliente, agora: () => number = Date.now): Promise<ArquivoDoMantenedor> {
  const r = await cliente.requisitar(URL_EXPORTACAO_RG, { redirect: "manual" }).catch((e: Error) => {
    throw new ParadaDoGerador(e.message);
  });
  if (r.status !== 200) {
    await r.body?.cancel();
    throw new ParadaDoGerador(`O STF respondeu HTTP ${r.status} para ${URL_EXPORTACAO_RG}.`);
  }
  const bytes = Buffer.from(await r.arrayBuffer());
  return { nome: "RepercussaoGeral.xls", bytes, obtidoEm: new Date(agora()).toISOString(), url: URL_EXPORTACAO_RG };
}

// ——— Parte pura: arquivos do mantenedor → tabela ———

/** Cabeçalho literal do export de RG (TICKETS/b8-entrevista/fontes.md, item a, acesso 2026-10-09). */
export const CABECALHO_RG = [
  "Tema", "Leading Case", "Relator", "Título", "Descrição", "Assuntos", "Manifestação", "Acórdão", "Plenário Virtual",
  "Há Repercussão", "Data do Julgamento", "Situação do Tema", "Tese", "Data da Tese", "Observação",
];

/** A coluna que o STF exporta com acentuação duplamente codificada: a única que o gerador corrige. */
const COLUNA_CORRIGIDA = "Há Repercussão";

const TRANSFORMACAO =
  "HTML → texto por regra fixa (espaços do código-fonte viram um espaço; <br>, </p> e </div> viram quebra de linha; " +
  "marcação removida; entidades decodificadas; linhas vazias e espaço das pontas removidos); na coluna \"Há " +
  "Repercussão\" do export de repercussão geral, a acentuação duplamente codificada pelo STF (ex.: \"HÃ¡\") é " +
  "desfeita (bytes Latin-1 relidos como UTF-8); nenhuma outra mudança";

export function gerarTabelaStf(e: EntradaDoStf, geradaEm: string): TabelaDoStf {
  const linhas: LinhaDoStf[] = [];
  const arquivos: TabelaDoStf["arquivos"] = [];
  const registrar = (parte: ParteDoStf, a: ArquivoDoMantenedor) =>
    arquivos.push({ parte, nome: a.nome, obtidoEm: a.obtidoEm, sha256: createHash("sha256").update(a.bytes).digest("hex") });

  if (e.repercussaoGeral) {
    linhas.push(...linhasDeRg(e.repercussaoGeral));
    registrar("repercussão geral", e.repercussaoGeral);
  }
  const listas: [TipoNoStf, ArquivoDoMantenedor | undefined][] = [
    ["súmula", e.sumulas],
    ["súmula vinculante", e.sumulasVinculantes],
  ];
  const sumulas: LinhaDoStf[] = [];
  for (const [tipo, a] of listas) {
    if (!a) continue;
    sumulas.push(...linhasDeSumulas(tipo, a));
    registrar(tipo, a);
  }
  for (const p of e.paginasDeSumula) {
    const { tipo, numero, enunciado } = paginaDeSumula(p);
    const alvo = sumulas.find((l) => l.tipo === tipo && l.numero === numero);
    if (!alvo) throw new ParadaDoGerador(`${p.nome}: ${tipo} ${numero} não está na lista de ${tipo} obtida.`);
    alvo.enunciado = enunciado;
    registrar("página de súmula", p);
  }
  linhas.push(...sumulas);
  return {
    fonte: { tribunal: "STF", paginas: PAGINAS_DO_STF },
    atribuicao: ATRIBUICAO_STF,
    fundamento: FUNDAMENTO_STF,
    arquivos,
    partesAusentes: [
      ...(e.repercussaoGeral ? [] : (["repercussão geral"] as const)),
      ...listas.filter(([, a]) => !a).map(([t]) => t),
    ],
    geradaEm,
    versaoDoGerador: VERSAO_DO_GERADOR_STF,
    transformacaoDosTextos: TRANSFORMACAO,
    linhas,
  };
}

function linhasDeRg(a: ArquivoDoMantenedor): LinhaDoStf[] {
  if (!isUtf8(a.bytes)) {
    throw new ParadaDoGerador(`${a.nome}: exportação com UTF-8 inválido; não é seguro ler os textos.`);
  }
  const linhas = [...a.bytes.toString("utf8").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => textoDeHtml(c[2])),
  );
  const [cabecalho, ...corpo] = linhas;
  const corrigida = CABECALHO_RG.indexOf(COLUNA_CORRIGIDA);
  const lido = cabecalho?.map((c, i) => (i === corrigida ? desfazerDuplaCodificacao(c) : c));
  if (!lido || lido.join("|") !== CABECALHO_RG.join("|")) {
    throw new ParadaDoGerador(
      `${a.nome}: cabeçalho diferente do esperado. Esperado: ${CABECALHO_RG.join(" | ")}. Veio: ${lido?.join(" | ") ?? "(nenhuma tabela)"}.`,
    );
  }
  const vistos = new Set<number>();
  const saida: LinhaDoStf[] = [];
  corpo.forEach((celulas, n) => {
    if (celulas.every((c) => !c)) return;
    if (celulas.length !== CABECALHO_RG.length) {
      throw new ParadaDoGerador(`${a.nome}: a linha ${n + 1} tem ${celulas.length} colunas, e o cabeçalho ${CABECALHO_RG.length}.`);
    }
    const r = Object.fromEntries(
      CABECALHO_RG.map((col, i) => [col, col === COLUNA_CORRIGIDA ? desfazerDuplaCodificacao(celulas[i]) : celulas[i]]),
    );
    for (const [col, valor] of Object.entries(r)) {
      if (DUPLA_CODIFICACAO.test(valor)) {
        throw new ParadaDoGerador(`${a.nome}: acentuação corrompida na coluna "${col}" do tema "${r.Tema}"; o gerador parou para decisão.`);
      }
    }
    if (!/^\d+$/.test(r.Tema) || !Number(r.Tema)) throw new ParadaDoGerador(`${a.nome}: tema "${r.Tema}" não é um número inteiro.`);
    const numero = Number(r.Tema);
    if (vistos.has(numero)) throw new ParadaDoGerador(`${a.nome}: o tema ${numero} aparece mais de uma vez.`);
    vistos.add(numero);
    saida.push({
      tipo: "repercussão geral",
      numero,
      ...campo("situacao", r["Situação do Tema"]),
      ...campo("teseFirmada", r.Tese),
      ...(r["Leading Case"] ? { processosParadigma: [r["Leading Case"]] } : {}),
      ...campo("relator", r.Relator),
      ...campo("titulo", r["Título"]),
      ...campo("haRepercussao", r[COLUNA_CORRIGIDA]),
      ...campo("dataJulgamento", r["Data do Julgamento"]),
      ...campo("dataTese", r["Data da Tese"]),
    });
  });
  if (!saida.length) throw new ParadaDoGerador(`${a.nome}: nenhuma linha de tema.`);
  return saida;
}

const BASE: Record<string, string> = { súmula: "30", "súmula vinculante": "26" };
const TITULO_DA_LISTA: Record<string, string> = { súmula: "Súmulas", "súmula vinculante": "Súmulas Vinculantes" };
const ROTULO = /^Súmula( Vinculante)? (\d+)(?: \(([^()]+)\))?$/;

function linhasDeSumulas(tipo: TipoNoStf, a: ArquivoDoMantenedor): LinhaDoStf[] {
  const html = a.bytes.toString("utf8");
  const titulo = html.match(/<h3 class="titulo-sumario-sumula">([\s\S]*?)<\/h3>/);
  if (!titulo || textoDeHtml(titulo[1]) !== TITULO_DA_LISTA[tipo]) {
    throw new ParadaDoGerador(`${a.nome}: não é a tela "${TITULO_DA_LISTA[tipo]}" do STF.`);
  }
  const vistos = new Set<number>();
  const saida: LinhaDoStf[] = [];
  // Todo contêiner de item é visitado: item que não se reconhece para o gerador, nunca some da lista.
  const itens = html.split(/<div\b[^>]*\bclass\s*=\s*(?:"[^"]*\bsumula-item\b[^"]*"|'[^']*\bsumula-item\b[^']*')[^>]*>/i).slice(1);
  for (const [i, item] of itens.entries()) {
    const m = item.match(/^\s*<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/i);
    if (!m) throw new ParadaDoGerador(`${a.nome}: o item ${i + 1} da lista não tem a forma esperada (link com o rótulo).`);
    const rotulo = textoDeHtml(m[3]).match(ROTULO);
    const href = (m[1] ?? m[2]).replace(/&amp;/g, "&");
    if (!rotulo || Boolean(rotulo[1]) !== (tipo === "súmula vinculante")) {
      throw new ParadaDoGerador(`${a.nome}: item "${textoDeHtml(m[3])}" fora da forma "Súmula N (marca)".`);
    }
    if (!new RegExp(`^sumariosumulas\\.asp\\?base=${BASE[tipo]}&sumula=\\d+$`).test(href)) {
      throw new ParadaDoGerador(`${a.nome}: link "${href}" fora da forma esperada.`);
    }
    const numero = Number(rotulo[2]);
    if (vistos.has(numero)) throw new ParadaDoGerador(`${a.nome}: a ${tipo} ${numero} aparece mais de uma vez.`);
    vistos.add(numero);
    saida.push({
      tipo,
      numero,
      ...campo("situacao", rotulo[3]),
      link: `https://portal.stf.jus.br/jurisprudencia/${href}`,
    });
  }
  if (!saida.length) throw new ParadaDoGerador(`${a.nome}: nenhuma ${tipo} na lista.`);
  return saida;
}

function paginaDeSumula(p: ArquivoDoMantenedor): { tipo: TipoNoStf; numero: number; enunciado: string } {
  const html = p.bytes.toString("utf8");
  const m = html.match(/<div class="titulo">([\s\S]*?)<\/div>\s*<div class="parCOM">/);
  const rotulo = m && textoDeHtml(m[1]).match(ROTULO);
  const conteudo = m && conteudoDoDiv(html, m.index! + m[0].length);
  const enunciado = conteudo && textoDeHtml(conteudo);
  if (!rotulo || !enunciado) throw new ParadaDoGerador(`${p.nome}: não é a página de uma súmula do STF na forma esperada.`);
  return { tipo: rotulo[1] ? "súmula vinculante" : "súmula", numero: Number(rotulo[2]), enunciado };
}

/** O conteúdo de um <div> aberto logo antes de `inicio`, até o </div> que o fecha (divs filhos contados); sem ele, undefined. */
function conteudoDoDiv(html: string, inicio: number): string | undefined {
  let nivel = 1;
  for (const t of html.slice(inicio).matchAll(/<(\/?)div\b[^>]*>/gi)) {
    nivel += t[1] ? -1 : 1;
    if (nivel === 0) return html.slice(inicio, inicio + t.index);
  }
  return undefined;
}

/** Campo vazio fica de fora da linha: a consulta diz que a fonte não informa. */
function campo<K extends string>(nome: K, valor: string | undefined): Partial<Record<K, string>> {
  return valor ? ({ [nome]: valor } as Record<K, string>) : {};
}

/** HTML → texto pela regra fixa descrita em TRANSFORMACAO. */
export function textoDeHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (todo, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      // Fora da lista (Latin-1 e tipográficas, nome com maiúsculas significativas), para: nunca grava "&nome;" como texto.
      if (Object.hasOwn(ENTIDADES, e)) return ENTIDADES[e];
      throw new ParadaDoGerador(`entidade HTML "${todo}" desconhecida pelo gerador; decida antes de gerar.`);
    })
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Sinal de UTF-8 relido como Latin-1 ("Ã¡", "Ã£", "Ã§"…). */
const DUPLA_CODIFICACAO = /Ã[\u0080-¿]|Â[ -¿]/;

/** Desfaz a dupla codificação só se o texto a tiver e a releitura for UTF-8 válido; senão devolve o texto como veio. */
function desfazerDuplaCodificacao(s: string): string {
  if (!DUPLA_CODIFICACAO.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const relido = Buffer.from(s, "latin1").toString("utf8");
  return relido.includes("�") ? s : relido;
}
