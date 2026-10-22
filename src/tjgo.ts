/**
 * TJGO (ADR-0029): o texto do acórdão pela consulta pública do processo no Projudi, sem login e sem a verificação
 * anti-robô (que fica só no formulário de busca, que o Garimpo não usa). Página do processo → lista de arquivos da
 * movimentação do julgamento casada por data e hora → «Relatório e Voto» → um salto para o armazenamento do próprio
 * TJGO. Não é PDF e não tem recibo: o texto vai para a memória pelo id do acórdão, como o do TJPI. Só o julgado exato
 * que a busca achou: qualquer dúvida sobre o vínculo = não baixa, com o motivo.
 */

import { type Cliente, decodificar, ErroHttp } from "./cliente.js";
import { htmlComConteudoOculto, htmlComIndicioDeCorte, htmlParaTexto } from "./html.js";
import type { TextoIntegral } from "./memoria.js";
import { linkDoProcessoNoTjgo } from "./tribunais.js";

const PROJUDI = "https://projudi.tjgo.jus.br/";
/** O armazenamento do próprio TJGO para onde o arquivo redireciona (endereço assinado e temporário; visto em 2026-10-22). */
const ARMAZENAMENTO = /^projudi-\d{4}-prd\.s3\.tjgo\.jus\.br$/;
/** Tipos de arquivo da movimentação de julgamento, como a lista do Projudi os numera. */
const TIPO_EMENTA = "124";
const TIPO_RELATORIO_E_VOTO = "125";
/** Texto útil mínimo: relatório, voto e acórdão passam com folga. */
const MINIMO_TEXTO = 500;
/** Limite de leitura do arquivo (bytes): os medidos têm dezenas de KB. */
const LIMITE_BYTES = 5_000_000;
/** Tamanho dos trechos da ementa procurados no texto (só letras e algarismos) e a parte mínima que tem de aparecer. */
const TRECHO = 40;
const PARTE_MINIMA = 0.5;
/**
 * Distância máxima entre o «julgado em» da busca e o lançamento do julgamento no Projudi: na verificação de
 * 2026-10-22, o site deu o mesmo segundo ou um segundo depois (15:51:36 × 15:51:35; 15:49:00 × 15:48:59).
 */
const TOLERANCIA_MS = 1_000;

/** O texto, ou por que o Garimpo não o trouxe (nada é guardado). */
export type TextoDoTjgo = Omit<TextoIntegral, "id"> | { motivo: string };

interface AcordaoDoTjgo {
  numero: string;
  numeroCnj?: string;
  ementa: string;
  idArquivoProjudi?: string;
}

interface Movimentacao {
  tipo: string;
  dataHora: string;
  id?: string;
}

interface ArquivoDaLista {
  id: string;
  hash: string;
  nome_arquivo: string;
  id_arquivo_tipo: string;
  AcessoArquivo: string;
  valido: string;
}

/** Linhas de movimentação da página do processo: tipo, data e hora da coluna própria e id da lista de arquivos. */
function movimentacoes(html: string): Movimentacao[] {
  return [...html.matchAll(/<tr movi_codigo[\s\S]*?<\/tr>/g)].map(([l]) => ({
    tipo: /filtro_tipo_movimentacao">\s*([^<]*?)\s*</.exec(l)?.[1] ?? "",
    dataHora: /<td width="100" align="center">\s*([^<]*?)\s*</.exec(l)?.[1] ?? "",
    id: /buscarArquivosMovimentacaoJSON\('(\d+)'/.exec(l)?.[1],
  }));
}

/** O valor do campo «Segredo de Justiça» da página; sem o campo, undefined. */
function segredoDeJustica(html: string): string | undefined {
  return /Segredo de Justi(?:&ccedil;|ç)a\s*<\/div>\s*<span[^>]*>\s*([^<]*?)\s*</i.exec(html)?.[1];
}

/** Os cookies da página (nome=valor), que o Projudi espera de volta na lista e no arquivo, como no navegador. */
function sessao(r: Response): string {
  return r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/** Só letras e algarismos, sem acento e em minúsculas: a diagramação do HTML não atrapalha a comparação. */
const soLetrasEAlgarismos = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Parte dos trechos de 40 letras e algarismos da ementa da busca (sem a referência final) que aparecem no texto. */
function parteDaEmentaNoTexto(ementa: string, texto: string): number {
  const corpo = soLetrasEAlgarismos(ementa.replace(/\([^()]*julgado em[^()]*\)\s*$/, ""));
  const alvo = soLetrasEAlgarismos(texto);
  const trechos: string[] = [];
  for (let i = 0; i + TRECHO <= corpo.length; i += TRECHO) trechos.push(corpo.slice(i, i + TRECHO));
  return trechos.length ? trechos.filter((t) => alvo.includes(t)).length / trechos.length : 0;
}

/** «DD/MM/AAAA HH:MM:SS» em milissegundos (a hora local do Projudi; só a diferença importa). */
function instante(dataHora: string): number | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(dataHora);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) : undefined;
}

/** As movimentações de julgamento lançadas no instante do «julgado em» da busca, a até 1 s. */
function julgamentosNoInstante(movs: Movimentacao[], julgadoEm: string): Movimentacao[] {
  const alvo = instante(julgadoEm)!;
  return movs.filter((m) => {
    const t = instante(m.dataHora);
    return m.tipo.startsWith("Julgamento") && t !== undefined && Math.abs(t - alvo) <= TOLERANCIA_MS;
  });
}

/** O destino do redirecionamento, só no armazenamento do TJGO (https) e no arquivo do tipo esperado; senão, undefined. */
function noArmazenamento(r: Response, arquivo: RegExp): URL | undefined {
  const location = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
  if (!location) return undefined;
  const url = new URL(location, PROJUDI);
  return url.protocol === "https:" && ARMAZENAMENTO.test(url.hostname) && arquivo.test(url.pathname) ? url : undefined;
}

export async function textoDoTjgo(cliente: Cliente, acordao: AcordaoDoTjgo): Promise<TextoDoTjgo> {
  const pagina = linkDoProcessoNoTjgo(acordao.numeroCnj) ?? linkDoProcessoNoTjgo(acordao.numero);
  if (!pagina) return { motivo: "a busca não trouxe número CNJ do TJGO para abrir o processo" };
  // A ementa do site termina com «julgado em DD/MM/AAAA HH:MM:SS»: o instante em que o julgamento foi lançado.
  const julgadoEm = /julgado em (\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2})\)\s*$/.exec(acordao.ementa)?.[1];
  if (!julgadoEm) return { motivo: "a ementa da busca veio sem a data e a hora do julgamento, que casam o acórdão" };
  // 00:00:00 é a data da sessão sem hora; o lançamento do julgamento pode ser dias depois.
  if (julgadoEm.endsWith(" 00:00:00")) {
    return { motivo: "a ementa da busca veio sem a hora do julgamento (00:00:00), que separa os acórdãos do processo" };
  }
  try {
    return await pelaPaginaDoProcesso(cliente, acordao, pagina, julgadoEm);
  } catch (e) {
    // Recusa e rede parada sobem (regra 3); erro HTTP sem recusa é motivo para não baixar.
    if (e instanceof ErroHttp) return { motivo: `o Projudi respondeu com erro HTTP ${e.status}` };
    throw e;
  }
}

async function pelaPaginaDoProcesso(
  cliente: Cliente,
  acordao: AcordaoDoTjgo,
  pagina: string,
  julgadoEm: string,
): Promise<TextoDoTjgo> {
  const rp = await cliente.requisitar(pagina, { headers: { accept: "text/html" }, redirect: "manual" });
  const cookie = sessao(rp);
  const html = decodificar(new Uint8Array(await rp.arrayBuffer()), rp.headers.get("content-type") ?? "", "iso-8859-1");
  const segredo = segredoDeJustica(html);
  // Processo em segredo abre noutro leiaute (partes por iniciais, sem movimentações), sem o campo.
  if (segredo === undefined) {
    return { motivo: "a página do processo veio sem o campo «Segredo de Justiça» (processo em segredo ou formato diferente)" };
  }
  if (!/^n(ã|&atilde;)o$/i.test(segredo)) return { motivo: "o processo está em segredo de justiça" };
  const casadas = julgamentosNoInstante(movimentacoes(html), julgadoEm);
  if (casadas.length === 0) {
    return { motivo: `a página do processo não tem nenhuma movimentação de julgamento em ${julgadoEm} (a até 1 s)` };
  }
  if (casadas.length > 1) {
    return { motivo: `a página do processo tem mais de um julgamento em ${julgadoEm} (a até 1 s); não há como saber qual é` };
  }
  const [mov] = casadas;
  if (!mov.id) return { motivo: `o julgamento de ${julgadoEm} não tem arquivos na página do processo` };

  const doProjudi = { headers: { cookie, referer: pagina }, redirect: "manual" as const };
  const rl = await cliente.requisitar(`${PROJUDI}MovimentacaoArquivo?AJAX=ajax&PaginaAtual=8&Id_Movimentacao=${mov.id}`, {
    ...doProjudi,
    headers: { ...doProjudi.headers, accept: "application/json" },
  });
  let lista: ArquivoDaLista[];
  try {
    lista = JSON.parse(decodificar(new Uint8Array(await rl.arrayBuffer()), rl.headers.get("content-type") ?? ""));
    if (!Array.isArray(lista)) throw new Error();
  } catch {
    return { motivo: "a lista de arquivos do julgamento veio fora do formato esperado" };
  }
  const relatorios = lista.filter((a) => a.id_arquivo_tipo === TIPO_RELATORIO_E_VOTO);
  const ementas = lista.filter((a) => a.id_arquivo_tipo === TIPO_EMENTA);
  if (relatorios.length !== 1 || ementas.length > 1) {
    return { motivo: `o julgamento de ${julgadoEm} não tem um só «Relatório e Voto» e no máximo uma «Ementa»` };
  }
  const [relatorio] = relatorios;
  // Os dois arquivos que o Garimpo pede: só de acesso público, válidos e no HTML esperado.
  for (const [a, nome, html] of [
    [relatorio, "«Relatório e Voto»", "relatorio_voto_acordao.html"],
    ...ementas.map((e) => [e, "«Ementa»", "ementa.html"] as const),
  ] as const) {
    if (a.AcessoArquivo !== "1" || a.valido !== "true") {
      return { motivo: `o arquivo ${nome} do julgamento não é de acesso público (bloqueado, restrito ou inválido)` };
    }
    if (a.nome_arquivo !== html) {
      return {
        motivo: `o arquivo ${nome} do julgamento está em formato que o Garimpo não lê (${a.nome_arquivo.endsWith(".p7s") ? "envelope de assinatura .p7s" : "não é o HTML esperado"})`,
      };
    }
  }
  const arquivo = (a: ArquivoDaLista) =>
    `${PROJUDI}BuscaProcesso?PaginaAtual=6&Id_MovimentacaoArquivo=${encodeURIComponent(a.id)}&hash=${encodeURIComponent(a.hash)}&id_proc=undefined`;

  // O Id_Arquivo do link do site é o da «Ementa» do julgamento: o destino dela amarra o julgamento ao que a busca achou.
  if (acordao.idArquivoProjudi && !ementas.length) {
    return { motivo: `o julgamento de ${julgadoEm} veio sem o arquivo «Ementa», que amarra o acórdão à busca` };
  }
  let ementa = "";
  if (ementas.length) {
    const re = await cliente.requisitar(arquivo(ementas[0]), doProjudi);
    await re.body?.cancel();
    const id = acordao.idArquivoProjudi ?? "\\d+";
    const destino = noArmazenamento(re, new RegExp(`/id_${id}_ementa\\.html$`));
    if (!destino) {
      return acordao.idArquivoProjudi
        ? { motivo: `a ementa do julgamento de ${julgadoEm} não é a que a busca apontou` }
        : { motivo: "a «Ementa» não redirecionou para o arquivo no armazenamento do TJGO (destino fora do armazenamento do TJGO)" };
    }
    const lida = await doArmazenamento(cliente, destino, "da «Ementa»");
    if (typeof lida !== "string") return lida;
    ementa = lida;
  }

  const rr = await cliente.requisitar(arquivo(relatorio), doProjudi);
  await rr.body?.cancel();
  const destino = noArmazenamento(rr, /\/id_\d+_relatorio_voto_acordao\.html$/);
  if (!destino) return { motivo: "o «Relatório e Voto» não redirecionou para o arquivo no armazenamento do TJGO (destino fora do armazenamento do TJGO)" };
  const doc = await doArmazenamento(cliente, destino, "do «Relatório e Voto»");
  if (typeof doc !== "string") return doc;

  // A ementa do julgamento antes do relatório e voto: os dois documentos do acórdão, cada um como veio.
  const texto = [htmlParaTexto(ementa), htmlParaTexto(doc)].filter(Boolean).join("\n\n");
  const relatorioEVoto = htmlParaTexto(doc);
  if (relatorioEVoto.length < MINIMO_TEXTO) return { motivo: "o «Relatório e Voto» veio curto demais" };
  // O número vale no próprio relatório e voto: a ementa certa não pode cobrir um relatório de outro processo.
  const numero = soLetrasEAlgarismos(acordao.numeroCnj ?? acordao.numero);
  if (!soLetrasEAlgarismos(relatorioEVoto).includes(numero)) {
    return { motivo: "o «Relatório e Voto» não traz o número do processo da busca" };
  }
  if (parteDaEmentaNoTexto(acordao.ementa, texto) < PARTE_MINIMA) {
    return { motivo: "a ementa e o relatório e voto baixados não trazem a ementa da busca; pode ser outro acórdão do mesmo processo" };
  }
  const documentos = ementa + doc;
  return {
    texto,
    indicioDeCorte: htmlComIndicioDeCorte(ementa) || htmlComIndicioDeCorte(doc),
    ...(htmlComConteudoOculto(documentos) && { conteudoOculto: true }),
  };
}

/** Um salto só, para o armazenamento do TJGO, sem o cookie do Projudi: o HTML do arquivo, ou o motivo. */
async function doArmazenamento(cliente: Cliente, destino: URL, doArquivo: string): Promise<string | { motivo: string }> {
  const r = await cliente.requisitar(destino.href, { headers: { accept: "text/html" }, redirect: "manual" });
  const tipo = r.headers.get("content-type") ?? "";
  if (r.status !== 200 || !/text\/html/i.test(tipo)) {
    await r.body?.cancel();
    return { motivo: `o armazenamento do TJGO não entregou o HTML ${doArquivo}` };
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > LIMITE_BYTES) return { motivo: `o arquivo ${doArquivo} veio grande demais` };
  return decodificar(bytes, tipo);
}
