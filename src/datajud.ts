/**
 * DataJud (API Pública do CNJ): os julgamentos registrados de um processo, pelo número CNJ. Metadados, sem texto de
 * decisão e sem nome de parte. Fontes, termo de uso e o que o Garimpo guarda: docs/fontes.md.
 */

import { Cliente, ErroHttp, FormatoInesperadoError, type OpcoesCliente } from "./cliente.js";
import { comparavel } from "./enquadramento.js";

const HOST_API = "api-publica.datajud.cnj.jus.br";
const HOST_WIKI = "datajud-wiki.cnj.jus.br";
export const WIKI_ACESSO = `https://${HOST_WIKI}/api-publica/acesso/`;
export const TERMO_DE_USO_DATAJUD =
  "https://formularios.cnj.jus.br/wp-content/uploads/2023/11/Termos-de-uso-api-publica-V1.2.pdf";
/** Variável de ambiente com a chave do próprio usuário: o Garimpo nunca a troca. */
export const VARIAVEL_DA_CHAVE = "GARIMPO_DATAJUD_CHAVE";
/** A chave pública vigente em 2026-10-09 (wiki, página /acesso). O CNJ pode trocá-la a qualquer momento. */
const CHAVE_PUBLICA = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

/** Termo 3.13: até 120 chamadas por minuto; 0,5 s entre chamadas ao mesmo host, para todas as janelas. */
export function clienteDoDataJud(extra: Partial<OpcoesCliente> = {}): Cliente {
  return new Cliente({ nome: "O DataJud", intervaloMinimoPorHost: { [HOST_API]: 500, [HOST_WIKI]: 500 }, ...extra });
}

// ---------------------------------------------------------------------------------------------------------------
// Número CNJ e rota

export interface NumeroCnj {
  digitos: string;
  /** NNNNNNN-DD.AAAA.J.TR.OOOO */
  formatado: string;
  j: string;
  tr: string;
}

/** O número com ou sem máscara, com o dígito verificador conferido (Res. CNJ 65/2008, Anexo VIII); senão, o erro. */
export function lerNumeroCnj(entrada: string): NumeroCnj | { erro: string } {
  const digitos = entrada.replace(/[\s.\-/]/g, "");
  if (!/^\d{20}$/.test(digitos)) {
    return {
      erro:
        `"${entrada}" não é um número CNJ: são 20 dígitos, no formato NNNNNNN-DD.AAAA.J.TR.OOOO (com ou sem ` +
        "pontos e traços), por exemplo 0000123-70.2020.8.27.0001.",
    };
  }
  const [n, dd, a, j, tr, o] = [digitos.slice(0, 7), digitos.slice(7, 9), digitos.slice(9, 13), digitos[13], digitos.slice(14, 16), digitos.slice(16)];
  if (BigInt(`${n}${a}${j}${tr}${o}${dd}`) % 97n !== 1n) {
    return {
      erro: `O número ${entrada} tem o dígito verificador errado (${dd}): confira se não houve erro de digitação.`,
    };
  }
  return { digitos, formatado: `${n}-${dd}.${a}.${j}.${tr}.${o}`, j, tr };
}

/** Estados e DF em ordem alfabética: o TR dos TJs e dos TREs (Res. CNJ 65/2008, art. 1º, § 5º, V e VII). */
const UFS = "ac al ap am ba ce dft es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc se sp to".split(" ");
const intervalo = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);

/** As 91 rotas da lista da wiki (/endpoints, lida em 2026-10-09). Não há rota do STF. */
export const ROTAS: readonly string[] = [
  "stj",
  "tst",
  "tse",
  "stm",
  ...intervalo(1, 6).map((n) => `trf${n}`),
  ...intervalo(1, 24).map((n) => `trt${n}`),
  ...UFS.map((uf) => `tj${uf}`),
  ...UFS.map((uf) => `tre-${uf}`),
  "tjmmg",
  "tjmrs",
  "tjmsp",
];

const NAO_COBRE_STF =
  "O DataJud não cobre o STF: a lista oficial de rotas da API Pública do CNJ não tem o STF. Consulte o processo no " +
  "portal do STF. Nenhuma chamada foi feita.";

/** A rota do DataJud pelo segmento J.TR do número; sem rota, a explicação (nenhuma chamada). */
export function rotaDoNumero({ j, tr }: Pick<NumeroCnj, "j" | "tr">): { rota: string } | { erro: string } {
  const n = Number(tr);
  const uf = UFS[n - 1];
  const rota = (() => {
    switch (j) {
      case "3":
        return n === 0 ? "stj" : undefined;
      case "4":
        return n >= 1 && n <= 6 ? `trf${n}` : undefined;
      case "5":
        return n === 0 ? "tst" : n <= 24 ? `trt${n}` : undefined;
      case "6":
        return n === 0 ? "tse" : uf && `tre-${uf}`;
      case "7":
        return n <= 12 ? "stm" : undefined;
      case "8":
        return uf && `tj${uf}`;
      case "9":
        return { 13: "tjmmg", 21: "tjmrs", 26: "tjmsp" }[n];
    }
  })();
  if (j === "1") return { erro: NAO_COBRE_STF };
  if (rota) return { rota };
  return {
    erro:
      `O segmento ${j}.${tr} do número não tem rota no DataJud (o CNJ, o CJF e o CSJT não têm). Se o processo está ` +
      "em outro tribunal, informe-o em tribunal (ex.: stj). Nenhuma chamada foi feita.",
  };
}

/** A rota pedida pelo usuário (sigla, sem acento nem maiúscula); STF e sigla sem rota = a explicação. */
export function rotaPedida(tribunal: string): { rota: string } | { erro: string } {
  const sigla = tribunal
    .trim()
    .toLowerCase()
    .replace(/^tre-?(?=[a-z]{2,3}$)/, "tre-")
    .replace(/^(tj|tre-)df$/, "$1dft");
  if (sigla === "stf") return { erro: NAO_COBRE_STF };
  if (ROTAS.includes(sigla)) return { rota: sigla };
  return {
    erro:
      `"${tribunal}" não tem rota no DataJud. Use a sigla do tribunal: stj, tst, tse, stm, trf1 a trf6, trt1 a trt24, ` +
      "tj + UF (tjgo, tjdft), tre-UF (tre-go) ou tjmmg, tjmrs, tjmsp. Nenhuma chamada foi feita.",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Movimentos de resultado de julgamento

/**
 * Subárvore 193 "Julgamento" (Magistrado → Julgamento) da TPU de movimentos, ativos e inativos: baixada do SGT/CNJ
 * (gateway.cloud.pje.jus.br/tpu/api/v1/publico/download/movimentos) em 2026-10-09, itens até a versão 2026-09-11.
 */
const RESULTADO_DE_JULGAMENTO = new Set([
  193, 196, 198, 200, 202, 208, 210, 212, 214, 218, 219, 220, 221, 228, 230, 235, 236, 237, 238, 239, 240, 241, 242,
  244, 385, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451, 452, 453, 454, 455, 456, 457, 458, 459, 460, 461, 462,
  463, 464, 465, 466, 471, 472, 473, 853, 871, 884, 900, 901, 972, 973, 1042, 1043, 1044, 1045, 1046, 1047, 1048,
  1049, 1050, 10953, 10961, 10964, 10965, 11373, 11374, 11375, 11376, 11377, 11378, 11379, 11380, 11381, 11394, 11396,
  11401, 11402, 11403, 11404, 11405, 11406, 11407, 11408, 11409, 11411, 11795, 11796, 11801, 11876, 11877, 11878,
  11879, 12028, 12032, 12033, 12034, 12041, 12184, 12187, 12252, 12253, 12254, 12256, 12257, 12258, 12298, 12319,
  12321, 12322, 12323, 12324, 12325, 12326, 12327, 12328, 12329, 12330, 12331, 12433, 12434, 12435, 12436, 12437,
  12438, 12439, 12440, 12441, 12442, 12443, 12450, 12451, 12452, 12453, 12458, 12459, 12475, 12615, 12616, 12617,
  12649, 12650, 12651, 12652, 12653, 12654, 12660, 12661, 12662, 12663, 12664, 12665, 12666, 12667, 12668, 12669,
  12670, 12671, 12672, 12673, 12674, 12675, 12676, 12677, 12678, 12679, 12680, 12681, 12682, 12683, 12684, 12685,
  12686, 12687, 12688, 12689, 12690, 12691, 12692, 12693, 12694, 12695, 12696, 12697, 12698, 12699, 12700, 12701,
  12702, 12703, 12704, 12705, 12706, 12707, 12708, 12709, 12710, 12711, 12712, 12713, 12714, 12715, 12716, 12717,
  12718, 12719, 12720, 12721, 12722, 12723, 12724, 12735, 12738, 12792, 14099, 14210, 14211, 14213, 14214, 14215,
  14216, 14217, 14218, 14219, 14680, 14777, 14778, 14848, 14937, 15022, 15023, 15024, 15026, 15027, 15028, 15029,
  15030, 15165, 15166, 15211, 15212, 15213, 15214, 15245, 15249, 15250, 15251, 15252, 15253, 15254, 15255, 15256,
  15257, 15258, 15259, 15260, 15261, 15262, 15263, 15264, 15265, 15266, 15322, 15408,
]);
/** 581 "Documento" com o complemento "Acórdão": a juntada, como apoio. */
const JUNTADA_DE_DOCUMENTO = 581;
/** Registros de 1º grau: contados, não listados. */
const PRIMEIRO_GRAU = new Set(["G1", "JE"]);

export interface Movimento {
  /** dataHora do movimento, como veio: o lançamento no DataJud, não a sessão. */
  lancadoEm: string;
  codigo: number;
  nome: string;
  orgao?: string;
}

export interface RegistroDataJud {
  grau: string;
  classe?: string;
  orgao?: string;
  /** dataHoraUltimaAtualizacao, como veio, ou "não informada". */
  atualizadoNoDataJud: string;
  resultadosDeJulgamento: Movimento[];
  /** Juntada de documento com o complemento "Acórdão": apoio, em linha separada. */
  juntadasComComplementoAcordao: Movimento[];
  /** Só quando há: andamentos sem código ou sem nome, contados e nunca adivinhados. */
  andamentosSemCodigoOuNomeNaoMostrados?: number;
}

/** O que a ferramenta mostra do DataJud (e o que a memória guarda): nada da resposta bruta. */
export interface ConsultaDataJud {
  /** Registros que o DataJud devolveu, de qualquer grau. */
  total: number;
  registros: RegistroDataJud[];
  registrosDePrimeiroGrauNaoMostrados: number;
}

/** A consulta guardada tem o formato desta versão? (memória de outra versão ou estragada = ausente). */
export function ehConsultaDataJud(d: unknown): d is ConsultaDataJud {
  const c = d as ConsultaDataJud;
  return (
    typeof c === "object" &&
    c !== null &&
    Number.isInteger(c.total) &&
    Number.isInteger(c.registrosDePrimeiroGrauNaoMostrados) &&
    Array.isArray(c.registros) &&
    c.registros.every((r) => Array.isArray(r?.resultadosDeJulgamento) && Array.isArray(r.juntadasComComplementoAcordao))
  );
}

type Bruto = Record<string, unknown>;
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const nomeDe = (v: unknown) => texto((v as Bruto | undefined)?.nome);

/** Reduz a resposta do DataJud ao que a ferramenta mostra. */
export function reduzirDataJud(json: unknown): ConsultaDataJud {
  const hits = (json as { hits?: { total?: { value?: unknown }; hits?: unknown } })?.hits;
  if (!hits || !Array.isArray(hits.hits)) {
    throw new FormatoInesperadoError("O DataJud devolveu uma resposta sem a lista de processos (hits): o formato pode ter mudado.");
  }
  const fontes = (hits.hits as Bruto[]).map((h) => (h._source ?? {}) as Bruto);
  const total = Number.isInteger(hits.total?.value) ? (hits.total!.value as number) : fontes.length;
  const doPrimeiroGrau = fontes.filter((f) => PRIMEIRO_GRAU.has(String(f.grau)));
  return {
    total,
    registros: fontes.filter((f) => !doPrimeiroGrau.includes(f)).map(registro),
    registrosDePrimeiroGrauNaoMostrados: doPrimeiroGrau.length,
  };
}

function registro(f: Bruto): RegistroDataJud {
  const resultados: Movimento[] = [];
  const juntadas: Movimento[] = [];
  let semCodigo = 0;
  const vistos = new Set<string>();
  const movimentos = (Array.isArray(f.movimentos) ? (f.movimentos as Bruto[]) : []).slice();
  movimentos.sort((a, b) => String(a.dataHora ?? "").localeCompare(String(b.dataHora ?? "")));
  for (const m of movimentos) {
    const codigo = Number.isInteger(m.codigo) ? (m.codigo as number) : undefined;
    const nome = texto(m.nome);
    if (codigo === undefined || !nome) {
      semCodigo++;
      continue;
    }
    const lancadoEm = texto(m.dataHora) ?? "não informada";
    // Repetição só comprovada: mesmo código e mesmo instante. Mesmo dia e órgão não bastam.
    const chave = `${codigo}|${lancadoEm}`;
    const ehJuntada =
      codigo === JUNTADA_DE_DOCUMENTO &&
      Array.isArray(m.complementosTabelados) &&
      (m.complementosTabelados as Bruto[]).some((c) => comparavel(String(c?.nome ?? "")) === "acordao");
    if (!RESULTADO_DE_JULGAMENTO.has(codigo) && !ehJuntada) continue;
    // Sem o instante, não há prova de repetição.
    if (lancadoEm !== "não informada" && vistos.has(chave)) continue;
    vistos.add(chave);
    const linha: Movimento = { lancadoEm, codigo, nome, ...(nomeDe(m.orgaoJulgador) && { orgao: nomeDe(m.orgaoJulgador) }) };
    (ehJuntada ? juntadas : resultados).push(linha);
  }
  return {
    grau: texto(f.grau) ?? "não informado",
    ...(nomeDe(f.classe) && { classe: nomeDe(f.classe) }),
    ...(nomeDe(f.orgaoJulgador) && { orgao: nomeDe(f.orgaoJulgador) }),
    atualizadoNoDataJud: texto(f.dataHoraUltimaAtualizacao) ?? "não informada",
    resultadosDeJulgamento: resultados,
    juntadasComComplementoAcordao: juntadas,
    ...(semCodigo && { andamentosSemCodigoOuNomeNaoMostrados: semCodigo }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Chamada e chave

/** A chave em uso: a da variável de ambiente (nunca trocada) ou a pública, que pode ter sido renovada pela wiki. */
export class ChaveDoDataJud {
  private renovada?: string;
  constructor(private readonly ambiente: () => string | undefined = () => process.env[VARIAVEL_DA_CHAVE]) {}

  atual(): { valor: string; daVariavel: boolean } {
    const daVariavel = this.ambiente()?.trim();
    return daVariavel ? { valor: daVariavel, daVariavel: true } : { valor: this.renovada ?? CHAVE_PUBLICA, daVariavel: false };
  }

  renovar(nova: string): void {
    this.renovada = nova;
  }
}

/** A chave da página /acesso da wiki: a que vem depois de "Authorization: APIKey", tags trocadas por espaço. */
export function chaveDaPagina(html: string): string | undefined {
  const pagina = html.replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"');
  const atual = pagina.indexOf("APIKey atual");
  const m = pagina.slice(atual < 0 ? 0 : atual).match(/Authorization:\s*APIKey\s+([A-Za-z0-9+/_-]{16,200}={0,2})(?![A-Za-z0-9+/=_-])/);
  return m?.[1];
}

const SEM_CHAVE =
  `Confira a chave vigente na página de acesso da API Pública do CNJ (${WIKI_ACESSO}).`;

/**
 * Consulta o número na rota. Em 401 com a chave pública: lê uma vez a página de acesso da wiki, confere a chave e
 * repete uma vez. Com a chave da variável de ambiente, nunca troca: explica o 401.
 */
export async function consultarDataJud(
  cliente: Cliente,
  rota: string,
  digitos: string,
  chave: ChaveDoDataJud,
): Promise<ConsultaDataJud> {
  const pedir = (valor: string) =>
    cliente.requisitar(`https://${HOST_API}/api_publica_${rota}/_search`, {
      method: "POST",
      headers: { Authorization: `APIKey ${valor}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { match: { numeroProcesso: digitos } }, size: 20 }),
    });
  const { valor, daVariavel } = chave.atual();
  let resposta: Response;
  try {
    resposta = await pedir(valor);
  } catch (e) {
    if (!(e instanceof ErroHttp && e.status === 401)) throw e;
    if (daVariavel) {
      throw new Error(
        `O DataJud recusou a chave da variável de ambiente ${VARIAVEL_DA_CHAVE} (HTTP 401). O Garimpo não troca a ` +
          `sua chave: ${SEM_CHAVE} Depois, atualize a variável.`,
      );
    }
    const pagina = await (await cliente.requisitar(WIKI_ACESSO)).text();
    const nova = chaveDaPagina(pagina);
    if (!nova || nova === valor) {
      throw new Error(
        "O DataJud recusou a chave pública que o Garimpo traz (HTTP 401), e a página de acesso da wiki não trouxe " +
          `uma chave nova reconhecível. ${SEM_CHAVE} Se ela mudou, ponha-a na variável de ambiente ${VARIAVEL_DA_CHAVE}.`,
      );
    }
    try {
      resposta = await pedir(nova);
    } catch (e2) {
      if (e2 instanceof ErroHttp && e2.status === 401) {
        throw new Error(`O DataJud recusou também a chave da página de acesso da wiki (HTTP 401). ${SEM_CHAVE}`);
      }
      throw e2;
    }
    chave.renovar(nova);
  }
  let json: unknown;
  try {
    json = await resposta.json();
  } catch {
    throw new FormatoInesperadoError("O DataJud devolveu algo que não é JSON.");
  }
  return reduzirDataJud(json);
}
