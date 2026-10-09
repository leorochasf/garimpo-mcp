/**
 * Leitura do inteiro teor como texto, pelo caminho do PDF, em partes de tamanho controlado. Só lê: não grava, não
 * copia e não chama a rede (ADR-0005). A origem é conferida pelo recibo de origem ao lado do PDF; sem OCR (ADR-0004).
 * Nos TRTs (ADR-0018), o texto integral do repositório oficial que a busca no Falcão deixou na memória, pelo id.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Acordao } from "./busca.js";
import type { Memoria } from "./memoria.js";
import { ROTULO_FALCAO } from "./tribunais.js";

/**
 * Teto de uma resposta, cabeçalho incluído: cerca de 8 mil tokens estimados, a 3 caracteres por token (estimativa
 * conservadora para texto em português; não é contagem exata nem limite universal de cliente).
 */
export const LIMITE_CARACTERES_PARTE = 24_000;


/** Contrato do recibo de origem: quem grava (inteiroTeor.ts) e quem confere (aqui) usam os mesmos textos. */
export const NAO_INFORMADO = "não informado";
export const FORMATO_RECIBO = "recibo de origem do Garimpo, versão 1";
export const ORIGEM_DOWNLOAD = "download pelo Garimpo";
/** O aviso do obter_inteiro_teor quando o PDF já estava na pasta de destino (ADR-0011): vem junto da 1ª parte. */
export function avisoJaNaPasta(baixadoEm: string, outrasVersoes: number): string {
  const outras =
    outrasVersoes === 0
      ? ""
      : outrasVersoes === 1
        ? " Há outra versão válida deste acórdão na pasta de destino, preservada."
        : ` Há ${outrasVersoes} outras versões válidas deste acórdão na pasta de destino, preservadas.`;
  return (
    `O PDF já estava na pasta de destino: baixado pelo Garimpo em ${baixadoEm}, com o mesmo sha256 do recibo de ` +
    "origem. Nenhuma chamada foi feita ao tribunal nem ao JurisprudênciaIA. Para obter outra cópia do tribunal, mova " +
    `o PDF e o recibo para fora da pasta de destino.${outras}`
  );
}

const SEM_TEXTO = "sem texto extraível; pode ser escaneada";
const TRAZIDO = "declarada pelo usuário, não conferida (inteiro teor trazido pelo usuário)";

interface Cabecalho {
  tribunal: string;
  numero: string;
  data: string;
  linkOficial: string;
  sha256: string;
  id: string;
  arquivo: string;
  origem: string;
  /** Páginas do PDF, nunca folhas dos autos. */
  paginasDoPdf: string;
  /** Só com vínculo informado pelo usuário: a marca de que os dados acima são declarados, não comprovados. */
  vinculo?: string;
  /** Só com vínculo informado: se o número do processo aparece no texto extraído (informativo, nunca bloqueia). */
  numeroNoTexto?: "encontrado" | "não encontrado" | "não verificável";
}

/** Qual acórdão o usuário diz que o PDF é: o id da busca, ou tribunal + número. */
export interface VinculoInformado {
  id?: string;
  tribunal?: string;
  numero?: string;
}

/** Acórdão que um recibo que não confere diz que o PDF seria: no máximo vínculo declarado, nunca fato. */
interface VinculoDeclarado {
  declaradoPor: string;
  tribunal: string;
  numero: string;
  data: string;
  linkOficial: string;
  id: string;
}

export interface ParteDoInteiroTeor {
  cabecalho: Cabecalho;
  vinculoDeclarado?: VinculoDeclarado;
  avisos: string[];
  texto: string;
  proximaParte?: { ferramenta: "ler_inteiro_teor"; argumentos: { caminho: string; parte: number } & VinculoInformado };
}

export async function lerInteiroTeor(
  caminhoPedido: string,
  parte = 1,
  informado: VinculoInformado = {},
  memoria?: Memoria,
): Promise<ParteDoInteiroTeor> {
  const { base, partes, n } = await abrir(caminhoPedido, informado, memoria);
  const total = partes.length;
  if (!Number.isInteger(parte) || parte < 1 || parte > total) {
    throw new Error(
      `A parte ${parte} não existe: este PDF tem ${total} ${total === 1 ? "parte" : "partes"} (de 1 a ${total}).`,
    );
  }
  const escolhida = partes[parte - 1];
  const [x, y] = [escolhida[0].pagina, escolhida[escolhida.length - 1].pagina];
  const paginasDoPdf = `${x === y ? `página ${x}` : `páginas ${x}–${y}`} de ${n} (parte ${parte} de ${total})`;
  return {
    ...base(paginasDoPdf, parte < total ? parte + 1 : undefined),
    texto: escolhida.map((u) => u.texto).join(SEPARADOR),
  };
}

/** O que o texto integral do Falcão é (vai no cabeçalho de cada parte e na conferência). */
export const NATUREZA_DO_TEXTO_INTEGRAL =
  "texto integral do repositório oficial (Falcão), convertido de HTML pelo Garimpo: não é PDF e não tem recibo de origem";

export const AVISO_DE_CORTE =
  "Texto com indício de corte: o HTML do Falcão parecia terminar no meio; o texto pode estar incompleto.";

/** O erro que ensina quando o texto integral já saiu da memória: não há como pedir ao Falcão um acórdão pelo id. */
export function textoForaDaMemoria(id: string): string {
  return (
    `O texto integral do acórdão ${id} não está na memória do Garimpo, que o guarda por 24 h desde a busca; o Falcão ` +
    "não oferece busca pelo id. Refaça a busca que o trouxe (uma busca nova pode não trazer o mesmo acórdão)."
  );
}

export interface ParteDoTextoIntegral {
  cabecalho: {
    tribunal: string;
    numero: string;
    julgadoEm: string;
    juntadoEm: string;
    id: string;
    fonte: string;
    natureza: string;
    /** Partes por tamanho do texto, nunca páginas do PDF. */
    partes: string;
    /** Só com indício de corte: o texto nunca é apresentado como completo. */
    completo?: string;
  };
  avisos: string[];
  texto: string;
  proximaParte?: { ferramenta: "ler_inteiro_teor"; argumentos: { id: string; parte: number } };
}

/** O texto integral de um acórdão de TRT, da memória, em partes por tamanho. Só lê: sem rede e sem disco novo. */
export async function lerTextoIntegral(id: string, parte = 1, memoria?: Memoria): Promise<ParteDoTextoIntegral> {
  const guardado = await memoria?.obterTexto(id);
  if (!guardado) throw new Error(textoForaDaMemoria(id));
  const a = (await memoria?.obter(id))?.acordao;
  const base = (partes: string, proxima?: number): ParteDoTextoIntegral => ({
    cabecalho: {
      tribunal: (a?.tribunal ?? id.split(":")[0]).toUpperCase(),
      numero: a && !a.semNumero ? a.numero : NAO_INFORMADO,
      julgadoEm: a?.dataJulgamento ?? NAO_INFORMADO,
      juntadoEm: a?.dataJuntada ?? NAO_INFORMADO,
      id,
      fonte: ROTULO_FALCAO,
      natureza: NATUREZA_DO_TEXTO_INTEGRAL,
      partes,
      ...(guardado.indicioDeCorte ? { completo: "não: há indício de corte" } : {}),
    },
    avisos: guardado.indicioDeCorte ? [AVISO_DE_CORTE] : [],
    texto: "",
    ...(proxima ? { proximaParte: { ferramenta: "ler_inteiro_teor", argumentos: { id, parte: proxima } } } : {}),
  });
  const reserva = JSON.stringify(base("parte 999999 de 999999 (por tamanho do texto; não são páginas de PDF)", 999_999)).length;
  const partes = guardado.texto ? cortar(guardado.texto, LIMITE_CARACTERES_PARTE - reserva) : [""];
  const total = partes.length;
  if (!Number.isInteger(parte) || parte < 1 || parte > total) {
    throw new Error(`A parte ${parte} não existe: este texto tem ${total} ${total === 1 ? "parte" : "partes"} (de 1 a ${total}).`);
  }
  return {
    ...base(`parte ${parte} de ${total} (por tamanho do texto; não são páginas de PDF)`, parte < total ? parte + 1 : undefined),
    texto: partes[parte - 1],
  };
}

/** Segmento de uma página grande demais: o número dele e quantos são. */
export interface Segmento {
  numero: number;
  de: number;
}

/** Um pedaço do inteiro teor com a posição dele: página do PDF, parte do ler_inteiro_teor e segmento. */
export interface UnidadeDoInteiroTeor {
  pagina: number;
  parte: number;
  /** Só em página grande demais, dividida em segmentos. */
  segmento?: Segmento;
  /** O texto da página ou do segmento; "" = página sem texto extraível. */
  texto: string;
}

/** O inteiro teor inteiro, extraído uma vez, com a posição de cada pedaço, para a conferência de citação. */
export interface InteiroTeorParaConferir {
  origem: string;
  totalDePaginas: number;
  totalDePartes: number;
  unidades: UnidadeDoInteiroTeor[];
}

/**
 * Todo o texto do PDF, com as mesmas páginas, partes e segmentos que o ler_inteiro_teor mostra quando recebe só o
 * caminho. Só lê, como ele: não grava, não copia e não chama a rede.
 */
export async function lerParaConferir(caminhoPedido: string): Promise<InteiroTeorParaConferir> {
  const { origem, partes, n } = await abrir(caminhoPedido, {});
  return {
    origem,
    totalDePaginas: n,
    totalDePartes: partes.length,
    unidades: partes.flatMap((unidades, i) =>
      unidades.map(({ pagina, segmento, semMarca }) => ({
        pagina,
        parte: i + 1,
        ...(segmento ? { segmento } : {}),
        texto: semMarca,
      })),
    ),
  };
}

/** Lê o PDF, confere a origem, extrai o texto e o divide em partes; o cabeçalho de cada parte sai de `base`. */
async function abrir(caminhoPedido: string, informado: VinculoInformado, memoria?: Memoria) {
  const { bytes, caminho } = await lerArquivo(caminhoPedido);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const origem = await conferirOrigem(caminho, sha256);
  const paginas = await extrairPaginas(bytes, caminho);
  const n = paginas.length;

  const avisos = [...origem.avisos];
  const declarado = Object.values(informado).some(Boolean);
  const usado = declarado && !origem.conferida;
  let campos: Origem["campos"] & Pick<Cabecalho, "vinculo" | "numeroNoTexto"> = origem.campos;
  if (declarado && origem.conferida) {
    avisos.push(
      "O vínculo informado não foi usado: a origem deste PDF é conferida pelo recibo, e o cabeçalho vem dele.",
    );
  } else if (usado) {
    const lembrado = informado.id ? (await memoria?.obter(informado.id))?.acordao : undefined;
    campos = vinculoDoUsuario(informado, paginas, lembrado);
    if (informado.id && !lembrado) {
      avisos.push(
        `O acórdão ${informado.id} não está na memória do Garimpo: o cabeçalho traz só o que foi informado.`,
      );
    }
  }
  if (paginas.every((p) => !p)) {
    avisos.unshift(
      "Nenhuma página deste PDF tem texto extraível; pode ser escaneado. O Garimpo não faz OCR: abra o arquivo " +
        "para ler. Isso não quer dizer que o acórdão esteja sem conteúdo.",
    );
  }
  const base = (paginasDoPdf: string, proxima?: number): ParteDoInteiroTeor => ({
    cabecalho: { ...campos, sha256, arquivo: basename(caminho), origem: origem.origem, paginasDoPdf },
    ...(origem.vinculo ? { vinculoDeclarado: origem.vinculo } : {}),
    avisos,
    texto: "",
    ...(proxima
      ? {
          proximaParte: {
            ferramenta: "ler_inteiro_teor",
            argumentos: { caminho, parte: proxima, ...(usado ? informado : {}) },
          },
        }
      : {}),
  });

  // O cabeçalho é o mesmo em todas as partes, menos as páginas e a próxima parte: reserva-se o pior caso dos dois.
  const pior = "9".repeat(6);
  // Mais os dados do download, medidos, que vão junto quando a 1ª parte sai na resposta do obter_inteiro_teor:
  // reservados em todas as partes, para a divisão ser a mesma nas duas ferramentas.
  const download = {
    baixado: true,
    arquivo: caminho,
    recibo: caminhoDoRecibo(caminho),
    sha256,
    bytes: bytes.length,
    fonte: origem.linkDaBusca ?? "",
    // E o aviso de que o PDF já estava na pasta, no pior caso, quando ele é reaproveitado em vez de baixado.
    jaEstavaNaPasta: avisoJaNaPasta("9999-99-99T99:99:99.999+99:99", 999),
  };
  const reserva =
    JSON.stringify(base(`páginas ${pior}–${pior} de ${pior} (parte ${pior} de ${pior})`, 999_999)).length +
    JSON.stringify(download).length;
  return { base, origem: origem.origem, partes: dividir(paginas, LIMITE_CARACTERES_PARTE - reserva), n };
}

/**
 * Cabeçalho pelo vínculo declarado pelo usuário: o que a memória do Garimpo tem do id (`a`), os dados informados por cima e
 * "não informado" no resto, sem chamar a rede. A busca do número do processo no texto é só informativa.
 */
function vinculoDoUsuario(informado: VinculoInformado, paginas: string[], a: Acordao | undefined) {
  const numero = informado.numero ?? (a && !a.semNumero ? a.numero : undefined);
  const campos = {
    tribunal: (informado.tribunal ?? a?.tribunal ?? informado.id?.split(":")[0])?.toUpperCase() || NAO_INFORMADO,
    numero: numero || NAO_INFORMADO,
    data: a?.dataJulgamento || NAO_INFORMADO,
    linkOficial: a?.link || a?.linkConsulta || NAO_INFORMADO,
    id: informado.id || NAO_INFORMADO,
  };
  return {
    ...campos,
    vinculo:
      "declarado pelo usuário: os dados acima dizem qual acórdão seria este PDF, mas não provam que ele é esse " +
      "acórdão; o número no texto é só informativo",
    // O número indicado pelo usuário; sem ele, o que a memória tem do id (número e CNJ).
    numeroNoTexto: numeroNoTexto(informado.numero ? [informado.numero] : [numero, a?.numeroCnj], paginas.join("\n")),
  };
}

/**
 * O número aparece no texto, com qualquer pontuação entre os dígitos ("1.000.002/0001" = "10000020001")? Sem texto
 * extraível, ou sem número com dígitos bastantes para não achar por acaso (5), não dá para verificar.
 */
function numeroNoTexto(numeros: (string | undefined)[], texto: string): NonNullable<Cabecalho["numeroNoTexto"]> {
  const digitos = numeros.map((n) => n?.replace(/\D/g, "") ?? "").filter((d) => d.length >= 5);
  if (!digitos.length || !texto.trim()) return "não verificável";
  const achou = digitos.some((d) => new RegExp(`(?<!\\d)${[...d].join("[\\s./-]*")}(?!\\d)`).test(texto));
  return achou ? "encontrado" : "não encontrado";
}

interface Origem {
  origem: string;
  /** Recibo válido, de download pelo Garimpo, com o mesmo sha256. */
  conferida?: boolean;
  campos: Pick<Cabecalho, "tribunal" | "numero" | "data" | "linkOficial" | "id">;
  vinculo?: VinculoDeclarado;
  avisos: string[];
  /** Link que veio na busca, como o recibo registra (é a "fonte" na resposta do obter_inteiro_teor). */
  linkDaBusca?: string;
}

/** As linhas "Campo: valor" do recibo de origem. */
export function camposDoRecibo(texto: string): Map<string, string> {
  return new Map(
    texto.split(/\r?\n/).flatMap((l) => {
      const i = l.indexOf(": ");
      return i > 0 ? [[l.slice(0, i), l.slice(i + 2).trim()] as const] : [];
    }),
  );
}

const caminhoDoRecibo = (caminho: string) => `${caminho.replace(/\.pdf$/i, "")}.recibo.txt`;

const SEM_DADOS = {
  tribunal: NAO_INFORMADO,
  numero: NAO_INFORMADO,
  data: NAO_INFORMADO,
  linkOficial: NAO_INFORMADO,
  id: NAO_INFORMADO,
};

/**
 * Origem conferida só com recibo ao lado do PDF, de formato reconhecido, que registra download pelo Garimpo e traz o
 * mesmo sha256 do arquivo atual. Qualquer outro caso: não conferida, com aviso específico.
 */
async function conferirOrigem(caminho: string, sha256: string): Promise<Origem> {
  const nomeRecibo = caminhoDoRecibo(caminho);
  let linkDaBusca: string | undefined;
  const naoConferida = (motivo: string, vinculo?: VinculoDeclarado): Origem => ({
    linkDaBusca,
    origem: "não conferida",
    campos: SEM_DADOS,
    vinculo,
    avisos: [
      `Origem não conferida: ${motivo} Não trate este PDF como inteiro teor oficial sem conferir no link oficial ` +
        "do tribunal.",
    ],
  });

  let texto: string;
  try {
    texto = await readFile(nomeRecibo, "utf8");
  } catch {
    // Sem recibo, o Garimpo não tem registro de ter baixado este PDF: é inteiro teor trazido pelo usuário.
    return {
      origem: TRAZIDO,
      campos: SEM_DADOS,
      avisos: [
        `Inteiro teor trazido pelo usuário — origem declarada, não conferida: não há recibo de origem ao lado deste ` +
          `PDF (${basename(nomeRecibo)}), então o Garimpo não tem registro de tê-lo baixado. Não trate este PDF como ` +
          "inteiro teor oficial sem conferir no link oficial do tribunal.",
      ],
    };
  }
  const recibo = camposDoRecibo(texto);
  if (recibo.get("Formato") !== FORMATO_RECIBO) {
    return naoConferida(
      `o recibo ao lado deste PDF (${basename(nomeRecibo)}) não está num formato que o Garimpo reconheça.`,
    );
  }
  linkDaBusca = recibo.get("Link que veio na busca");
  const campo = (nome: string) => recibo.get(nome) || NAO_INFORMADO;
  const campos = {
    tribunal: campo("Tribunal"),
    numero: campo("Número"),
    data: campo("Data do julgamento"),
    linkOficial: campo("Link oficial final"),
    id: campo("Id"),
  };
  const vinculo = (declaradoPor: string) => ({ declaradoPor, ...campos });
  if (recibo.get("Origem") !== ORIGEM_DOWNLOAD) {
    return naoConferida(
      `o recibo ao lado deste PDF não registra download pelo Garimpo (origem: ${campo("Origem")}).`,
      vinculo("recibo ao lado do PDF, que não registra download pelo Garimpo"),
    );
  }
  if (recibo.get("Sha256") !== sha256) {
    return naoConferida(
      "o PDF mudou depois do download (o sha256 do arquivo não é o do recibo). Os dados do recibo aparecem só " +
        "como vínculo declarado, não como fato sobre este arquivo.",
      vinculo("recibo de um download anterior, cujo sha256 não é o deste arquivo"),
    );
  }
  return {
    origem: `conferida: download pelo Garimpo em ${campo("Data e hora")}, com o mesmo sha256 do recibo ao lado do PDF`,
    conferida: true,
    campos,
    avisos: [],
    linkDaBusca,
  };
}

/** Teto de um PDF, no download e na leitura: 50 MB. */
export const LIMITE_BYTES_PDF = 50 * 1024 * 1024;

/**
 * Só o arquivo que o usuário indicou: nada de URL nem de pasta. Aceita só arquivo regular, de até 50 MB, que
 * comece com a assinatura PDF; se o extrator consegue abri-lo, quem diz é o comPdf.
 */
async function lerArquivo(caminhoPedido: string): Promise<{ bytes: Uint8Array; caminho: string }> {
  // Duas letras ou mais antes de ":": "C:\…" é caminho do Windows, não endereço.
  if (/^[a-z][a-z0-9+.-]+:/i.test(caminhoPedido)) {
    throw new Error(
      `O ler_inteiro_teor não aceita endereço da internet (${caminhoPedido}), só o caminho de um PDF no seu ` +
        "computador. Abra o link no navegador, baixe o PDF e passe o caminho do arquivo.",
    );
  }
  const caminho = resolve(caminhoPedido);
  let bytes: Uint8Array;
  try {
    const info = await stat(caminho);
    if (info.isDirectory()) {
      throw new CaminhoRecusado(
        `O caminho ${caminho} é uma pasta, não um arquivo. Informe o caminho do PDF; o Garimpo não procura ` +
          "arquivos em pastas.",
      );
    }
    if (!info.isFile()) {
      throw new CaminhoRecusado(`O caminho ${caminho} não é um arquivo comum. Informe o caminho do PDF.`);
    }
    if (info.size > LIMITE_BYTES_PDF) {
      throw new CaminhoRecusado(`O arquivo ${caminho} passa de 50 MB; o Garimpo não lê PDF desse tamanho.`);
    }
    bytes = await readFile(caminho);
  } catch (e) {
    if (e instanceof CaminhoRecusado) throw e;
    throw new Error(`Não consegui ler o arquivo ${caminho} (${(e as Error).message}).`);
  }
  if (Buffer.from(bytes.subarray(0, 4)).toString("latin1") !== "%PDF") {
    throw new Error(
      `O arquivo ${caminho} não é um PDF (não começa com a assinatura %PDF). Informe o caminho de um PDF.`,
    );
  }
  return { bytes, caminho };
}

/** Caminho recusado, com a frase pronta para o usuário (não é falha de leitura do disco). */
class CaminhoRecusado extends Error {}

type DocumentoPdf = Awaited<ReturnType<typeof getDocument>["promise"]>;

/** Abre o PDF no extrator, usa e fecha. Falha do extrator é erro de leitura explícito, com o que se tentava fazer. */
async function comPdf<T>(
  bytes: Uint8Array,
  caminho: string,
  tentativa: string,
  usar: (documento: DocumentoPdf) => Promise<T>,
): Promise<T> {
  // O pdfjs toma posse do buffer que recebe e recusa Buffer: vai uma cópia em Uint8Array.
  const tarefa = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    return await usar(await tarefa.promise);
  } catch (e) {
    throw new Error(
      `Erro de leitura: o extrator não conseguiu ${tentativa} ${basename(caminho)} (${(e as Error).message}). ` +
        "O arquivo pode estar truncado ou corrompido; nada foi alterado. Abra o arquivo para conferir.",
    );
  } finally {
    await tarefa.destroy();
  }
}

/** Total de páginas do PDF, contado pela estrutura do documento, sem extrair texto. */
export async function contarPaginas(caminhoPedido: string): Promise<number> {
  const { bytes, caminho } = await lerArquivo(caminhoPedido);
  return comPdf(bytes, caminho, "contar as páginas do PDF", async (documento) => documento.numPages);
}

/** Texto de cada página do PDF ("" = página sem texto extraível). */
function extrairPaginas(bytes: Uint8Array, caminho: string): Promise<string[]> {
  return comPdf(bytes, caminho, "ler o PDF", async (documento) => {
    const paginas: string[] = [];
    for (let i = 1; i <= documento.numPages; i++) {
      const conteudo = await (await documento.getPage(i)).getTextContent();
      paginas.push(naOrdemDeLeitura(conteudo.items.filter((item) => "str" in item)).trim());
    }
    return paginas;
  });
}

/** O que o extrator devolve de cada item de texto: o texto, a matriz de posição [a, b, c, d, x, y] e a largura. */
interface ItemDoExtrator {
  str: string;
  transform: number[];
  width: number;
}

/** Pedaço de texto numa linha: onde começa ao longo da linha, quanto ocupa e o corpo da letra. */
interface Pedaco {
  str: string;
  inicio: number;
  largura: number;
  corpo: number;
}

/** Linha da página: direção do texto (vetor unitário), altura da base nessa direção e maior corpo de letra. */
interface Linha {
  dx: number;
  dy: number;
  base: number;
  corpo: number;
  pedacos: Pedaco[];
}

/**
 * Texto da página na ordem de leitura. As linhas seguem a ordem do fluxo do PDF (colunas, cabeçalho e rodapé ficam
 * onde o PDF os põe), mas a quebra de linha vem da posição: pedaços seguidos na mesma direção e na mesma altura são
 * uma linha, e uma mudança de altura é uma linha nova — o carimbo aposto à parte não cola no último parágrafo.
 * Dentro de uma linha que o fluxo desenha fora de ordem (pedaços com negrito, itálico, sublinhado ou link), os
 * pedaços vão do começo para o fim da linha. Texto girado (carimbo de margem) segue a mesma regra na sua direção.
 */
function naOrdemDeLeitura(itens: ItemDoExtrator[]): string {
  const linhas: Linha[] = [];
  let atual: Linha | undefined;
  for (const { str, transform, width } of itens) {
    // Item vazio só marca fim de linha do fluxo, às vezes no meio de uma linha da página: a posição decide.
    if (!str) continue;
    const [a, b, c, d, x, y] = transform;
    const escala = Math.hypot(a, b) || 1;
    const [dx, dy] = [a / escala, b / escala];
    const corpo = Math.hypot(c, d) || 1;
    // Na direção do texto: horizontal, base = y e início = x; girado, o mesmo nos eixos girados.
    const base = dx * y - dy * x;
    // Meia altura de letra (a maior da linha) de tolerância: índice e expoente ficam na linha; a linha seguinte, nunca.
    if (
      !atual ||
      dx * atual.dx + dy * atual.dy < 0.999 ||
      Math.abs(base - atual.base) > Math.max(corpo, atual.corpo) / 2
    ) {
      linhas.push((atual = { dx, dy, base, corpo, pedacos: [] }));
    }
    atual.corpo = Math.max(atual.corpo, corpo);
    atual.pedacos.push({ str, inicio: dx * x + dy * y, largura: width, corpo });
  }
  return linhas.map(({ pedacos }) => juntarLinha(pedacos)).join("\n");
}

/**
 * Linha em ordem no fluxo sai como o extrator a deu, espaços dele incluídos. Fora de ordem, os pedaços com texto vão
 * do começo para o fim da linha, e os espaços do extrator (que cobrem o vão do salto, às vezes por cima de outro
 * pedaço) dão lugar a um espaço onde houver vão visível entre dois pedaços.
 */
function juntarLinha(pedacos: Pedaco[]): string {
  const comTexto = pedacos.filter((p) => p.str.trim());
  const emOrdem = comTexto.every((p, k) => k === 0 || p.inicio >= comTexto[k - 1].inicio - p.corpo / 2);
  if (emOrdem) return pedacos.map((p) => p.str).join("");
  comTexto.sort((p, q) => p.inicio - q.inicio);
  return comTexto.reduce((linha, p, k) => {
    const anterior = comTexto[k - 1];
    const vao = anterior && p.inicio - (anterior.inicio + anterior.largura) > p.corpo * 0.15;
    return linha + (vao && !/\s$/.test(linha) && !/^\s/.test(p.str) ? " " : "") + p.str;
  }, "");
}

/** Um pedaço de uma parte: uma página do PDF inteira ou um segmento de página grande demais. */
interface Unidade {
  pagina: number;
  /** Com a marca de página (e de segmento), como sai na parte. */
  texto: string;
  /** O texto sem a marca; "" = página sem texto extraível. */
  semMarca: string;
  segmento?: Segmento;
}

const SEPARADOR = "\n\n";

/** Custo de um texto dentro da resposta JSON (as aspas, as quebras de linha e os controles saem escapados). */
const custo = (texto: string) => JSON.stringify(texto).length - 2;

/**
 * Divide as páginas em partes de páginas inteiras até o teto; a página que sozinha passa do teto vira segmentos.
 * Determinística: o mesmo texto dá sempre a mesma divisão.
 */
function dividir(paginas: string[], teto: number): Unidade[][] {
  const n = paginas.length;
  const unidades = paginas.flatMap((texto, i): Unidade[] => {
    const pagina = i + 1;
    if (!texto) return [{ pagina, texto: `[página ${pagina} de ${n}: ${SEM_TEXTO}]`, semMarca: "" }];
    const inteira = `[página ${pagina} de ${n}]\n${texto}`;
    if (custo(inteira) <= teto) return [{ pagina, texto: inteira, semMarca: texto }];
    const marcaMaior = `[página ${n} de ${n}, segmento 999 de 999; continua no segmento 999]\n`;
    const trechos = cortar(texto, teto - custo(marcaMaior));
    return trechos.map((trecho, k) => ({
      pagina,
      texto:
        `[página ${pagina} de ${n}, segmento ${k + 1} de ${trechos.length}` +
        `${k + 1 < trechos.length ? `; continua no segmento ${k + 2}` : ""}]\n${trecho}`,
      semMarca: trecho,
      segmento: { numero: k + 1, de: trechos.length },
    }));
  });

  const partes: Unidade[][] = [];
  let atual: Unidade[] = [];
  let ocupado = 0;
  for (const u of unidades) {
    const c = custo(u.texto);
    if (atual.length && ocupado + custo(SEPARADOR) + c > teto) {
      partes.push(atual);
      atual = [];
    }
    ocupado = atual.length ? ocupado + custo(SEPARADOR) + c : c;
    atual.push(u);
  }
  if (atual.length) partes.push(atual);
  return partes;
}

/**
 * Corta o texto em trechos de custo até o teto, de preferência numa quebra de linha da metade final de cada trecho,
 * senão num espaço, senão onde o teto mandar.
 */
function cortar(texto: string, teto: number): string[] {
  const trechos: string[] = [];
  let resto = [...texto];
  while (resto.length) {
    let fim = 0;
    let ocupado = 0;
    while (fim < resto.length && ocupado + custo(resto[fim]) <= teto) ocupado += custo(resto[fim++]);
    if (fim < resto.length) {
      const ultimo = (alvo: RegExp) => {
        let i = fim - 1;
        while (i >= fim / 2 && !alvo.test(resto[i])) i--;
        return i >= fim / 2 ? i + 1 : 0;
      };
      fim = ultimo(/\n/) || ultimo(/\s/) || fim;
    }
    trechos.push(resto.slice(0, fim).join("").trimEnd());
    resto = resto.slice(fim);
  }
  return trechos;
}
