/**
 * Leitura do inteiro teor como texto, pelo caminho do PDF, em partes de tamanho controlado. Só lê: não grava, não
 * copia e não chama a rede (ADR-0005). A origem é conferida pelo recibo de origem ao lado do PDF; sem OCR (ADR-0004).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Teto de uma resposta, cabeçalho incluído: cerca de 8 mil tokens estimados, a 3 caracteres por token (estimativa
 * conservadora para texto em português; não é contagem exata nem limite universal de cliente).
 */
export const LIMITE_CARACTERES_PARTE = 24_000;


/** Contrato do recibo de origem: quem grava (inteiroTeor.ts) e quem confere (aqui) usam os mesmos textos. */
export const NAO_INFORMADO = "não informado";
export const FORMATO_RECIBO = "recibo de origem do Garimpo, versão 1";
export const ORIGEM_DOWNLOAD = "download pelo Garimpo";
const SEM_TEXTO = "sem texto extraível; pode ser escaneada";

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
  proximaParte?: { ferramenta: "ler_inteiro_teor"; argumentos: { caminho: string; parte: number } };
}

export async function lerInteiroTeor(caminhoPedido: string, parte = 1): Promise<ParteDoInteiroTeor> {
  const caminho = resolve(caminhoPedido);
  const bytes = await lerArquivo(caminho);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const origem = await conferirOrigem(caminho, sha256);
  const paginas = await extrairPaginas(bytes, caminho);
  const n = paginas.length;

  const avisos = [...origem.avisos];
  if (paginas.every((p) => !p)) {
    avisos.unshift(
      "Nenhuma página deste PDF tem texto extraível; pode ser escaneado. O Garimpo não faz OCR: abra o arquivo " +
        "para ler. Isso não quer dizer que o acórdão esteja sem conteúdo.",
    );
  }
  const base = (paginasDoPdf: string, proxima?: number): ParteDoInteiroTeor => ({
    cabecalho: { ...origem.campos, sha256, arquivo: basename(caminho), origem: origem.origem, paginasDoPdf },
    ...(origem.vinculo ? { vinculoDeclarado: origem.vinculo } : {}),
    avisos,
    texto: "",
    ...(proxima ? { proximaParte: { ferramenta: "ler_inteiro_teor", argumentos: { caminho, parte: proxima } } } : {}),
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
  };
  const reserva =
    JSON.stringify(base(`páginas ${pior}–${pior} de ${pior} (parte ${pior} de ${pior})`, 999_999)).length +
    JSON.stringify(download).length;
  const partes = dividir(paginas, LIMITE_CARACTERES_PARTE - reserva);
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

interface Origem {
  origem: string;
  campos: Pick<Cabecalho, "tribunal" | "numero" | "data" | "linkOficial" | "id">;
  vinculo?: VinculoDeclarado;
  avisos: string[];
  /** Link que veio na busca, como o recibo registra (é a "fonte" na resposta do obter_inteiro_teor). */
  linkDaBusca?: string;
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
    return naoConferida(`não há recibo de origem ao lado deste PDF (${basename(nomeRecibo)}).`);
  }
  const recibo = new Map(
    texto.split(/\r?\n/).flatMap((l) => {
      const i = l.indexOf(": ");
      return i > 0 ? [[l.slice(0, i), l.slice(i + 2).trim()] as const] : [];
    }),
  );
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
    campos,
    avisos: [],
    linkDaBusca,
  };
}

async function lerArquivo(caminho: string): Promise<Uint8Array> {
  try {
    return await readFile(caminho);
  } catch (e) {
    throw new Error(`Não consegui ler o arquivo ${caminho} (${(e as Error).message}).`);
  }
}

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
  const caminho = resolve(caminhoPedido);
  const bytes = await lerArquivo(caminho);
  return comPdf(bytes, caminho, "contar as páginas do PDF", async (documento) => documento.numPages);
}

/** Texto de cada página do PDF ("" = página sem texto extraível). */
function extrairPaginas(bytes: Uint8Array, caminho: string): Promise<string[]> {
  return comPdf(bytes, caminho, "ler o PDF", async (documento) => {
    const paginas: string[] = [];
    for (let i = 1; i <= documento.numPages; i++) {
      const conteudo = await (await documento.getPage(i)).getTextContent();
      const texto = conteudo.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
      paginas.push(texto.trim());
    }
    return paginas;
  });
}

/** Um pedaço de uma parte: uma página do PDF inteira ou um segmento de página grande demais. */
interface Unidade {
  pagina: number;
  texto: string;
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
    if (!texto) return [{ pagina, texto: `[página ${pagina} de ${n}: ${SEM_TEXTO}]` }];
    const inteira = `[página ${pagina} de ${n}]\n${texto}`;
    if (custo(inteira) <= teto) return [{ pagina, texto: inteira }];
    const marcaMaior = `[página ${n} de ${n}, segmento 999 de 999; continua no segmento 999]\n`;
    const trechos = cortar(texto, teto - custo(marcaMaior));
    return trechos.map((trecho, k) => ({
      pagina,
      texto:
        `[página ${pagina} de ${n}, segmento ${k + 1} de ${trechos.length}` +
        `${k + 1 < trechos.length ? `; continua no segmento ${k + 2}` : ""}]\n${trecho}`,
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
