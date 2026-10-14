/**
 * Monta o servidor MCP do Garimpo com o cliente do site, o dos tribunais e a pasta de gravação injetados, sem
 * ligá-lo a transporte nenhum: o stdio liga em index.ts; os testes ligam um cliente MCP em memória com site e
 * tribunais falsos por trás e uma pasta temporária.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Cliente, PausaPreventivaError, RecusaError, VERSAO } from "./cliente.js";
import { buscaDireta, conferirDadosDoAcordao, ementaAparentementeIncompleta } from "./busca.js";
import { buscaAmpla, type ResultadoAmplo } from "./ampla.js";
import {
  type CoordenacaoEmArquivo,
  coordenacaoPadrao,
  naFerramenta,
  pastaDeDados,
  RECUSAS_PARA_INDICIO,
} from "./coordenacao.js";
import { lerFiltrosLocais, listaJson } from "./filtroLocal.js";
import { AVISO_CONTEUDO_OCULTO } from "./html.js";
import { conferirNaEmenta, conferirNoInteiroTeor, conferirNoTextoIntegral, lerCitacao, naoVerificavel } from "./conferencia.js";
import {
  type ClientePorTribunal,
  clientePadrao,
  type InteiroTeorBaixado,
  obterInteiroTeor,
  pastaPadrao,
} from "./inteiroTeor.js";
import {
  AVISO_DE_CORTE,
  contarPaginas,
  ehTextoDoPortal,
  type InteiroTeorParaConferir,
  LIMITE_CARACTERES_PARTE,
  lerInteiroTeor,
  lerParaConferir,
  lerTextoIntegral,
  naturezaDoTexto,
  avisoSemTextoIntegral,
  textoForaDaMemoria,
} from "./leitura.js";
import { Memoria, obtidoDoSite } from "./memoria.js";
import { AVISO_DE_AMOSTRA, panorama } from "./panorama.js";
import { ChaveDoDataJud, clienteDoDataJud, TERMO_DE_USO_DATAJUD } from "./datajud.js";
import { clienteDoDjen, FonteDjen } from "./djen.js";
import { julgamentosDoProcesso } from "./julgamentos.js";
import { avisoRecorridoDoAcordao } from "./recorrido.js";
import { INSTRUCTIONS, roteiroDePesquisa } from "./roteiro.js";
import { clienteDoFalcao } from "./falcao.js";
import { clienteDosPrecedentes, PrecedentesAoVivo, respostaDoStf } from "./precedentesAoVivo.js";
import {
  avisoDeLinkDoTjgo,
  ehDoFalcao,
  INTEIRO_TEOR_PORTAL,
  INTEIRO_TEOR_TRT,
  paginaDeTribunais,
  QUALIFICADOS_TRT,
  SIGLAS,
  TRIBUNAIS,
} from "./tribunais.js";
import {
  consultarPrecedente,
  reforcoDaTabela,
  sobreATabela,
  type TabelaDePrecedentes,
  TIPOS_NA_TABELA,
} from "./tabelaDePrecedentes.js";
import {
  consultarPrecedenteStf,
  dataDaTabelaStf,
  reforcoDoStf,
  sobreATabelaDoStf,
  type TabelaDoStf,
  TIPOS_NO_STF,
} from "./tabelaDoStf.js";

// Tribunal e datas são conferidos dentro da ferramenta, não no esquema: o erro do esquema sai embrulhado em texto
// técnico de validação, e a chamada errada precisa de uma frase que diga como corrigir.
const tribunal = z.string().describe(`Sigla do tribunal: ${SIGLAS.join(", ")}`);

/** Recusa, com frase que ensina a corrigir, tribunal fora da tabela. */
function conferirTribunais(...tribunais: (string | undefined)[]) {
  for (const t of tribunais) {
    if (t !== undefined && !SIGLAS.includes(t.toLowerCase())) {
      throw new Error(`Tribunal "${t}" não existe no Garimpo. Use uma destas siglas: ${SIGLAS.join(", ")}.`);
    }
  }
}

// Maior formulação gravada no banco de provas (rodadas 1 a 3, 202 itens, 65 distintos): 105 caracteres. O teto dá cerca
// de 3 vezes essa folga e fica muito abaixo de um trecho de petição, que não deve ir ao site (CLAUDE.md, regra 2).
const TETO_DA_FORMULACAO = 300;

/**
 * Junta espaços e quebras repetidos e recusa, com frase que ensina a corrigir, texto curto (o mínimo do esquema vale
 * depois de juntar os espaços: texto só de espaços não vai ao site) ou acima do teto.
 */
function conferirFormulacao(texto: string): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length < 2) {
    throw new Error(
      "A formulação precisa de ao menos 2 caracteres além dos espaços. Escreva a tese em palavras-chave " +
        "(instituto, dispositivo legal, tema).",
    );
  }
  if (limpo.length > TETO_DA_FORMULACAO) {
    throw new Error(
      `A formulação tem ${limpo.length} caracteres e o teto é de ${TETO_DA_FORMULACAO} caracteres. A busca é por tese em abstrato: ` +
        "resuma em palavras-chave (instituto, dispositivo legal, tema) e não cole trecho de petição, de decisão ou dos autos, " +
        "nem dado do caso (nomes, números de processo, fatos).",
    );
  }
  return limpo;
}

const filtros = {
  de: z.string().optional().describe("Data inicial, AAAA-MM-DD: data de juntada do acórdão nos TRTs, data de julgamento nas demais fontes"),
  ate: z.string().optional().describe("Data final, AAAA-MM-DD: data de juntada do acórdão nos TRTs, data de julgamento nas demais fontes"),
  relator: z.string().optional().describe("Nome do relator"),
  orgao: z.string().optional().describe("Órgão julgador (turma, câmara, seção)"),
  classe: z.string().optional().describe("Classe processual (nos TRTs, a sigla da classe, como ROT ou AP)"),
};

/** Opções só da busca direta nos TRTs (Falcão); outro tribunal as recusa. */
const opcoesDosTrts = {
  somenteEmentas: z
    .boolean()
    .optional()
    .describe("Só TRTs: true pesquisa apenas nas ementas (mais preciso; acórdão sem ementa não aparece). Padrão: ementa e texto integral"),
  ordenacao: z
    .enum(["relevancia", "recentes"])
    .optional()
    .describe("Só TRTs: relevancia (padrão da fonte) ou recentes (data de juntada, do mais novo ao mais antigo)"),
};

const renovar = z
  .boolean()
  .optional()
  .describe("true ignora a busca guardada e busca de novo no site; se falhar, é busca com erro (padrão false)");

/** Como a tabela de precedentes entra nas listas de qualificados: vai na descrição das duas buscas. */
const SOBRE_A_TABELA_NAS_LISTAS =
  "Tema repetitivo e IAC do STJ da lista de qualificados são conferidos, sem rede, na tabela de precedentes do STJ " +
  "(fotografia datada do Portal de Dados Abertos do STJ): a situação na fonte vem literal, com a data da tabela, e é " +
  "situação processual, nunca vigência; o tema sem tese no site e com tese firmada na tabela vai ao inciso III com " +
  "essa evidência; Cancelado ou Revisado ganham nota sem mudar o inciso; tese do site diferente da tabela é avisada; " +
  "o que não consta na tabela diz isso. Repercussão geral, súmula e súmula vinculante do STF são conferidas na " +
  "tabela do STF (fotografia datada obtida pelo mantenedor no portal do STF), quando a versão a traz: a situação do " +
  "tema ou a marca da lista de súmulas entra no aviso de situação, sem mudar o inciso; a falta de marca não prova " +
  "vigência; o campo tabelaDoStf traz atribuição, fundamento e data. " +
  "Quando a tabela do STJ é usada, o campo tabelaDePrecedentes traz atribuição e datas.";

/** Como a memória entra nas buscas: vai na descrição das duas. */
const SOBRE_A_BUSCA_GUARDADA =
  "Busca repetida dentro de 24 h volta da memória do Garimpo, sem chamada ao site, como busca guardada: fotografia " +
  "da busca feita no site na data e hora informadas, não uma busca nova. Para dado novo, use renovar.";

/** O aviso de recorrido ausente: vai na descrição das duas buscas. */
const SOBRE_O_RECORRIDO =
  "Embargos de declaração, agravo interno e similares sem o acórdão recorrido do mesmo número na resposta ganham um " +
  "aviso (uma vez, até 10 números; na busca ampla, até 3): o recorrido não veio nesta busca e pode não estar na base.";

/**
 * Lista mandada como texto (ADR-0002): modelos que não são o Claude costumam mandar listas assim. Texto de lista
 * JSON vira a lista; qualquer outro texto vale como um item só. Nunca parte por vírgula ("art. 37, § 6º").
 */
function listaOuTexto<T extends z.ZodTypeAny>(lista: T) {
  return z.preprocess((valor) => (typeof valor === "string" ? (listaJson(valor) ?? [valor]) : valor), lista);
}

/** Recusa, com frase que ensina a corrigir, data de julgamento fora de AAAA-MM-DD. */
function conferirDatas(datas: { de?: string; ate?: string }) {
  for (const campo of ["de", "ate"] as const) {
    const d = datas[campo];
    if (d !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      throw new Error(`A data em "${campo}" ("${d}") está fora do formato: use AAAA-MM-DD, por exemplo 2024-03-15.`);
    }
  }
}

/** Recusa, com frase que ensina a corrigir, as opções dos TRTs pedidas para outro tribunal (nunca ignoradas em silêncio). */
function conferirOpcoesDosTrts(p: { tribunal: string; somenteEmentas?: boolean; ordenacao?: string }) {
  const pedidas = [p.somenteEmentas !== undefined && "somenteEmentas", p.ordenacao !== undefined && "ordenacao"].filter(Boolean);
  if (pedidas.length && !ehDoFalcao(p.tribunal)) {
    throw new Error(
      `${pedidas.join(" e ")} só ${pedidas.length > 1 ? "valem" : "vale"} nos TRTs (trt1 a trt24, pelo Falcão); ` +
        `no ${p.tribunal.toUpperCase()} a busca não tem essa opção. Repita sem ${pedidas.length > 1 ? "elas" : "ela"}.`,
    );
  }
}

/** JSON sem recuo: o recuo não leva informação e custa ~10% da resposta da busca ampla. */
function json(dado: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(dado) }] };
}

/** Aviso de natureza jurídica: vai, em campo próprio, em toda resposta que traz jurisprudência (nunca em erro). */
const AVISO_NATUREZA_JURIDICA =
  "Resultado de busca em base não oficial. Confira o acórdão na fonte oficial do tribunal antes de citar; " +
  "a ementa não substitui o inteiro teor.";

/** "Não encontrado" na ementa que parece ter vindo cortada do site (heurística de busca.ts). */
const AVISO_CITACAO_NA_EMENTA_CORTADA =
  "A ementa parece ter vindo incompleta do JurisprudênciaIA (termina no meio da frase): a citação pode estar no " +
  "trecho que faltou. Confira no inteiro teor.";

/** Aviso de natureza jurídica das respostas que vêm da tabela de precedentes (fotografia, não consulta ao vivo). */
const AVISO_DA_TABELA =
  "Fotografia da tabela de precedentes do STJ na data informada, não consulta ao vivo: a situação e a tese podem " +
  "ter mudado depois. Confira no portal do STJ antes de citar; a situação na fonte não é vigência.";

/** Aviso de natureza jurídica das respostas que vêm da tabela do STF. */
const AVISO_DA_TABELA_STF =
  "Fotografia da tabela do STF na data informada (arquivos obtidos pelo mantenedor no portal do STF), não consulta " +
  "ao vivo: a situação e o texto podem ter mudado depois. Confira no portal do STF antes de citar; a situação na " +
  "fonte e a marca da lista de súmulas não são vigência.";

/** Aviso de natureza jurídica das respostas consultadas ao vivo no portal do tribunal (ADR-0020). */
const AVISO_AO_VIVO =
  "Consultado no portal oficial do tribunal pelo Garimpo (cliente não oficial), na data e hora informadas: a situação " +
  "pode mudar depois. A situação na fonte e a marca da lista de súmulas não são vigência; confira no portal antes de citar.";

/** Plano B do STF (ADR-0020): o portal não respondeu e a resposta vem da tabela empacotada, com a data dela. */
function planoB(data: string, e: unknown) {
  return {
    origem: `tabela de ${data}, o portal do STF não respondeu`,
    motivoDoPlanoB: (e as Error).message,
  };
}

/** Aviso de natureza jurídica do Falcão: a fonte é oficial, o Garimpo não; nunca diz que o acórdão foi conferido. */
const AVISO_FALCAO =
  "Resultado obtido do repositório oficial da Justiça do Trabalho (Falcão) por cliente não oficial (Garimpo); " +
  "confira no portal do tribunal antes de citar.";

/**
 * O aviso das fontes usadas, pelos tribunais: só JurisprudênciaIA, só Falcão, ou os dois, cada um com o seu (a
 * oficialidade do Falcão não se estende ao JurisprudênciaIA).
 */
function avisoDasFontes(tribunais: readonly string[]): string {
  const falcao = tribunais.some(ehDoFalcao);
  const site = tribunais.some((t) => !ehDoFalcao(t));
  if (falcao && site) {
    return `Acórdãos do JurisprudênciaIA: ${AVISO_NATUREZA_JURIDICA} Acórdãos dos TRTs: ${AVISO_FALCAO}`;
  }
  return falcao ? AVISO_FALCAO : AVISO_NATUREZA_JURIDICA;
}

function comAvisoNaturezaJuridica<T extends object>(dado: T, tribunais: readonly string[] = []) {
  return json({ ...dado, avisoNaturezaJuridica: avisoDasFontes(tribunais) });
}

/**
 * Pausa em vigor que o erro carrega (só disjuntor aberto e pausa preventiva), na marca fixa que a IA de quem usa lê
 * para esperar e retomar. A marca só informa o fim de uma pausa que já existe: nunca convida a repetir antes dele.
 * Com a chamada de prova já recusada, não há o que agendar: a marca diz para não repetir, sem `esperaSegundos`.
 */
function marcaDePausa(e: unknown): { estruturada: { liberadoEm: string } & Record<string, unknown>; texto: string } | undefined {
  // Erro que junta outros (busca ampla sem nenhuma resposta): a marca da pausa que acaba por último.
  if (!(e instanceof RecusaError || e instanceof PausaPreventivaError) && e instanceof Error && e.cause !== undefined) {
    const marcas = [e.cause].flat().map(marcaDePausa).filter((m) => m !== undefined);
    const maisTardia = marcas.sort((a, b) => Date.parse(b.estruturada.liberadoEm) - Date.parse(a.estruturada.liberadoEm))[0];
    // Se qualquer fonte já recusou a prova, a marca final é a de "não repita", mesmo que outra pausa termine depois.
    const recusada = marcas.find((m) => m.estruturada.indicioDeRecusaSistematica === true);
    if (!maisTardia || !recusada || maisTardia === recusada) return maisTardia;
    const liberadoEm = maisTardia.estruturada.liberadoEm;
    return {
      estruturada: { tipoDePausa: "recusa-da-fonte", liberadoEm, indicioDeRecusaSistematica: true },
      texto: recusada.texto.replace(/liberadoEm=\S+/, `liberadoEm=${liberadoEm}`),
    };
  }
  if (e instanceof RecusaError && e.pausa && e.pausa.aberturas >= RECUSAS_PARA_INDICIO) {
    const liberadoEm = new Date(e.pausa.ate).toISOString();
    return {
      estruturada: { tipoDePausa: "recusa-da-fonte", liberadoEm, indicioDeRecusaSistematica: true },
      texto:
        `[PAUSA tipo=recusa-da-fonte liberadoEm=${liberadoEm} indicioDeRecusaSistematica=true] A fonte já recusou a ` +
        "chamada de prova feita depois de uma pausa: não repita. É indício de recusa sistemática (esperar " +
        "provavelmente não resolve); veja diagnostico_dos_freios.",
    };
  }
  const [tipoDePausa, ate, segundos] =
    e instanceof RecusaError && e.pausa
      ? (["recusa-da-fonte", e.pausa.ate, e.pausa.segundos] as const)
      : e instanceof PausaPreventivaError && e.segundos !== undefined
        ? (["ritmo-proprio", e.ate, e.segundos] as const)
        : [];
  if (!tipoDePausa) return undefined;
  const liberadoEm = new Date(ate).toISOString();
  const depois =
    tipoDePausa === "recusa-da-fonte"
      ? "depois dele vem uma única chamada de prova, e se a fonte recusar de novo, não insista."
      : "depois dele, a primeira chamada confere o limite antes de liberar as outras.";
  return {
    estruturada: { tipoDePausa, liberadoEm, esperaSegundos: segundos },
    texto: `[PAUSA tipo=${tipoDePausa} liberadoEm=${liberadoEm} esperaSegundos=${segundos}] Não repita antes de liberadoEm; ${depois}`,
  };
}

function erro(e: unknown) {
  const marca = marcaDePausa(e);
  const texto = { type: "text" as const, text: (e as Error).message };
  return marca
    ? { content: [texto, { type: "text" as const, text: marca.texto }], structuredContent: marca.estruturada, isError: true }
    : { content: [texto], isError: true };
}

/**
 * A resposta de um download feito: com a 1ª parte do texto ou, sem texto, com o total de páginas. Uma falha aqui não
 * desfaz o download: vem o motivo, nunca um número inventado. A 1ª parte que não couber no teto junto com os dados do
 * download fica para o ler_inteiro_teor.
 */
async function comPrimeiraParteOuTotal(baixado: InteiroTeorBaixado, texto: boolean) {
  if (!texto) {
    try {
      return { ...baixado, totalDePaginasDoPdf: await contarPaginas(baixado.arquivo) };
    } catch (e) {
      return { ...baixado, totalDePaginasDoPdf: "não disponível", motivo: (e as Error).message };
    }
  }
  let parte;
  try {
    parte = await lerInteiroTeor(baixado.arquivo, 1);
  } catch (e) {
    return {
      ...baixado,
      erroDeLeitura: `${(e as Error).message} O download continua valendo: o PDF e o recibo de origem estão salvos.`,
    };
  }
  const resposta = { ...baixado, ...parte };
  if (JSON.stringify(resposta).length <= LIMITE_CARACTERES_PARTE) return resposta;
  return {
    ...baixado,
    aviso: "A 1ª parte não coube nesta resposta junto com os dados do download; leia-a com o ler_inteiro_teor.",
    proximaParte: { ferramenta: "ler_inteiro_teor", argumentos: { caminho: baixado.arquivo, parte: 1 } },
  };
}

export interface OpcoesServidor {
  /** Cliente de cada tribunal para baixar o inteiro teor (padrão: os portais reais). */
  tribunais?: ClientePorTribunal;
  /** Pasta onde o PDF é salvo quando a chamada não informa outra (padrão: pastaPadrao(), lida a cada chamada). */
  pasta?: string;
  /** Pasta de dados, cuja subpasta "memoria" guarda os acórdãos para todas as janelas (padrão: pastaDeDados()). */
  dados?: string;
  /** Relógio (ms) da validade da memória e da data de obtenção. */
  agora?: () => number;
  /** Teto de espaço da memória em disco (padrão: 200 MB). */
  tetoDaMemoria?: number;
  /**
   * Tabela de precedentes do STJ (index.ts passa a empacotada em dados/): plano B do consultar_precedente. Sem ela,
   * o portal fora do ar vira erro e as listas de qualificados seguem a regra sem a tabela.
   */
  tabela?: TabelaDePrecedentes;
  /**
   * Tabela do STF (index.ts passa a empacotada em dados/): plano B do consultar_precedente do STF. Sem ela, o portal
   * fora do ar vira erro e as listas de qualificados do STF seguem a regra sem a tabela.
   */
  tabelaStf?: TabelaDoStf;
  /** Cliente do DataJud (padrão: o real, com os freios dele). */
  datajud?: Cliente;
  /** Cliente do DJEN (padrão: o real, com os freios dele). */
  djen?: Cliente;
  /** Cliente do Falcão, a fonte dos TRTs (padrão: o real, com UA de navegador, 1 s e freio preventivo). */
  falcao?: Cliente;
  /** Cliente do portal do STF, consultado ao vivo pelo consultar_precedente (ADR-0020). */
  precedentesStf?: Cliente;
  /** Estado de proteção que o diagnostico_dos_freios lê (padrão: o de todos os clientes do processo). */
  coordenacao?: CoordenacaoEmArquivo;
}

export function criarServidor(
  site: Cliente,
  {
    tribunais = clientePadrao,
    pasta,
    dados,
    agora,
    tetoDaMemoria,
    tabela,
    tabelaStf,
    datajud = clienteDoDataJud(),
    djen = clienteDoDjen(),
    falcao = clienteDoFalcao(),
    precedentesStf = clienteDosPrecedentes(),
    coordenacao,
  }: OpcoesServidor = {},
): McpServer {
  const servidor = new McpServer({ name: "garimpo", version: VERSAO }, { instructions: INSTRUCTIONS });
  /** Registra a ferramenta com o nome dela anotado nas recusas que levar (o histórico do diagnostico_dos_freios). */
  const registrar = ((nome: string, config: never, fazer: (...a: unknown[]) => unknown) =>
    servidor.registerTool(nome, config, ((...a: unknown[]) => naFerramenta(nome, () => fazer(...a))) as never)) as typeof servidor.registerTool;
  // GARIMPO_SEM_MEMORIA=1 desliga só a memória em disco (a janela guarda enquanto está aberta), nunca o freio.
  const memoria = new Memoria({
    dados: process.env.GARIMPO_SEM_MEMORIA === "1" ? undefined : (dados ?? pastaDeDados()),
    agora,
    tetoBytes: tetoDaMemoria,
  });

  /** A chave do DataJud desta janela: a renovada pela wiki vale para as chamadas seguintes. */
  const chaveDoDataJud = new ChaveDoDataJud();
  const fonteDjen = new FonteDjen(djen);
  const aoVivo = new PrecedentesAoVivo(precedentesStf, memoria, agora);

  /** Atribuição e datas da tabela, quando ela reforçou algum tema ou IAC do STJ da lista de qualificados. */
  const comATabela = (qualificados: { tribunal: string; tipo: string; numero?: string }[], { curta = false } = {}) => {
    // Com tipos do STF obtidos em dias diferentes, vale a data mais antiga (a idade nunca sai menor que a real).
    const doStf = tabelaStf && TIPOS_NO_STF.filter((tipo) => qualificados.some((q) => q.tipo === tipo && reforcoDoStf(tabelaStf, q.tribunal, q.tipo, q.numero)))
      .sort((a, b) => dataDaTabelaStf(tabelaStf, a).localeCompare(dataDaTabelaStf(tabelaStf, b)))[0];
    return {
      ...(tabela && qualificados.some((q) => reforcoDaTabela(tabela, q.tribunal, q.tipo, q.numero))
        ? { tabelaDePrecedentes: sobreATabela(tabela, (agora ?? Date.now)(), { curta }) }
        : {}),
      ...(tabelaStf && doStf
        ? { tabelaDoStf: sobreATabelaDoStf(tabelaStf, doStf, (agora ?? Date.now)(), { curta }) }
        : {}),
    };
  };

  registrar(
    "busca_direta",
    {
      title: "Busca direta",
      description:
        "Pesquisa jurisprudência num tribunal pela busca direta do JurisprudênciaIA (sem o chat de IA do site). " +
        "Devolve acórdãos com a ementa como veio do site (avisoDeEmenta quando ela parece cortada pelo próprio site), " +
        "número, órgão, data e link oficial, e, em lista separada, os " +
        "precedentes qualificados (temas, súmulas). O site costuma devolver poucos acórdãos do STF por busca (de 2 a 7 na medição de out/2026). " +
        "O campo cabecalhoDeCobertura diz se veio o número pedido (pode haver mais) ou menos (a base não tem mais " +
        "para o texto; no STF, que devolve poucos por busca, pode haver mais). " +
        "Cada acórdão e cada precedente qualificado traz enquadramento927: o inciso do art. 927 do CPC com a " +
        "evidência tirada dos dados do site, ou \"não classificado\" com o motivo; o rótulo da lista de qualificados " +
        "não prova enquadramento, vigência nem aplicabilidade. " +
        "Ementas são longas: prefira limite baixo aqui e busca_ampla para volume. " +
        "TRTs (trt1 a trt24) vêm do Falcão, o repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT " +
        "401/2024), só acórdãos: limite padrão 10, máximo 30; cada acórdão traz o rótulo da fonte, \"julgado em\" " +
        "(dataJulgamento) e \"juntado em\" (dataJuntada, que não é publicação), e \"sem ementa no Falcão\" quando ela " +
        "não veio; o cabecalhoDeCobertura separa o total informado pelo Falcão (\"10.000 ou mais\" no teto da contagem) " +
        "de quantos vieram e quantos são mostrados. O texto integral fica na memória por 24 h para ler_inteiro_teor e " +
        "conferir_citacao pelo id. Nos TRTs, somenteEmentas (pesquisa só nas ementas) e ordenacao (relevancia ou " +
        "recentes, pela data de juntada) estão disponíveis e os filtros de, ate, relator, orgao e classe também " +
        "(de e ate valem para a data de juntada, não a de julgamento; classe só por sigla; data inexistente ou intervalo " +
        "invertido é erro que ensina) e precedentes qualificados não são pesquisados. " +
        `${SOBRE_A_TABELA_NAS_LISTAS} ` +
        `${SOBRE_A_BUSCA_GUARDADA} A busca guardada traz o campo buscaGuardada com essa data. ` +
        SOBRE_O_RECORRIDO,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        tribunal,
        texto: z.string().min(2).describe("Texto da busca (palavras da tese, dispositivo legal, instituto)"),
        limite: z.number().int().min(1).max(100).optional().describe("Máximo de acórdãos (1 a 100; padrão 10)"),
        ...filtros,
        ...opcoesDosTrts,
        renovar,
      },
    },
    async ({ renovar, ...args }) => {
      try {
        conferirTribunais(args.tribunal);
        conferirDatas(args);
        conferirOpcoesDosTrts(args);
        args.texto = conferirFormulacao(args.texto);
        const r = await buscaDireta(site, args, memoria, { renovar, tabela, tabelaStf, falcao });
        return comAvisoNaturezaJuridica(
          { ...r, ...comATabela(r.qualificados.map((q) => ({ ...q, tribunal: r.tribunal }))) },
          [r.tribunal],
        );
      } catch (e) {
        return erro(e);
      }
    },
  );

  registrar(
    "busca_ampla",
    {
      title: "Busca ampla",
      description:
        "Roda várias formulações da mesma tese em um ou mais tribunais e devolve uma lista única de acórdãos, sem " +
        "repetidos (registros duplicados na base do site viram um acórdão só), ordenada pela aderência (quantas " +
        "palavras de alguma formulação estão na ementa), depois por quantas formulações acharam cada acórdão e pela " +
        "posição na busca de origem. Cada tribunal pedido com acórdão aderente tem vagas garantidas. Aderência mede " +
        "proximidade de texto, não relevância jurídica. Saída compacta: número, tribunal, data, órgão, trecho da " +
        "ementa onde a tese aparece e link; e, em lista separada, os precedentes qualificados (temas, súmulas) que " +
        "o site devolveu. O campo cabecalhoDeCobertura traz, por tribunal, buscas feitas, vazias, com erro e não " +
        "feitas, acórdãos achados e mostrados; as formulações que não trouxeram nada; e se a lista foi cortada pelo " +
        "máximo. Busca vazia não é busca com erro: tribunal em que nenhuma busca deu resposta aparece \"com erro\" " +
        "(ou \"não pesquisado\"), sem achados. Se nenhuma busca deu resposta, a ferramenta responde com erro e o " +
        "motivo de cada busca, nunca com lista vazia. Para ler a ementa inteira, use obter_ementa com o id. " +
        "Cada precedente qualificado traz o enquadramento927 (enquadramento no art. 927 do CPC) em forma curta: " +
        "inciso e aviso de situação, ou \"não classificado\" e o motivo abreviado; a forma completa vem na " +
        "busca_direta. O dos acórdãos vem no obter_ementa. " +
        `${SOBRE_A_TABELA_NAS_LISTAS} ` +
        "Formulações boas variam sinônimos técnicos, dispositivo legal e nome do instituto. " +
        `Cada busca (formulação × tribunal) passa pela memória: ${SOBRE_A_BUSCA_GUARDADA} Ampliar a busca com ` +
        "formulações novas só busca no site as novas. No cabecalhoDeCobertura, o tribunal com busca guardada traz " +
        "guardadas (quantas das buscasFeitas vieram da memória), feitasAgora (quantas foram feitas no site agora) e " +
        "maisAntiga (data e hora local em que foi feita no site a busca guardada mais antiga); os acórdãos dessas " +
        "buscas são da data delas, não de hoje. " +
        "Filtros locais (deveConter, naoPodeConter), sem nenhuma chamada a mais ao site: tiram da lista os acórdãos " +
        "cuja ementa descumpre a condição, sem mudar a ordem dos que ficam; a reserva por tribunal e o máximo valem " +
        "só entre os que passaram. Casam a expressão inteira, sem diferenciar acento e maiúscula, sem radical e sem " +
        "sinônimo automático: liste você as variantes (\"doloso\", \"dolosa\"; \"14.230\", \"14230\"). No " +
        "cabecalhoDeCobertura, cada tribunal traz excluidos (excluídos pelo filtro) e, se houver, semEmenta (acórdãos " +
        "sem ementa para conferir, que saem com qualquer filtro ativo); \"mostrando X de Y\" conta só os que " +
        "passaram. Se o filtro local tirar todos, a lista vem vazia com o motivo no campo filtroLocal. Os precedentes " +
        "qualificados não passam pelos filtros locais. Repetir a busca mudando só o filtro não chama o site (buscas " +
        "guardadas). TRTs (trt1 a trt24) vêm do Falcão e contam como tribunal (até 5): 1 página (10 acórdãos) por " +
        "formulação × TRT, com teto de 5 páginas do Falcão por chamada, usadas primeiro na 1ª formulação de cada TRT " +
        "pedido, na ordem dada, depois nas seguintes; o que não couber (ou parar na pausa preventiva) sai no " +
        "cabecalhoDeCobertura como foraDoTeto ou pausaPreventiva, nunca como busca vazia, e repetir a mesma chamada " +
        "executa as que faltam. Com TRT, cada acórdão traz a fonte (rótulos em fontes) e o aviso cita as duas fontes; " +
        "os filtros de, ate, relator, orgao e classe valem também com TRT (de e ate = data de juntada nos TRTs, " +
        "julgamento nas demais fontes; classe só por sigla). " +
        `${SOBRE_O_RECORRIDO}`,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        formulacoes: listaOuTexto(z.array(z.string().min(2)).min(1).max(20)).describe("Formulações da mesma tese (até 20)"),
        tribunais: listaOuTexto(z.array(tribunal).min(1).max(5)).describe("Tribunais (até 5)"),
        limitePorBusca: z.number().int().min(1).max(100).optional().describe("Acórdãos por busca (padrão 100)"),
        maximo: z.number().int().min(1).max(200).optional().describe("Máximo de acórdãos na resposta (padrão 50)"),
        ordem: z
          .enum(["aderencia", "data"])
          .optional()
          .describe(
            'Ordem da lista (padrão "aderencia"). "data": os mesmos acórdãos, escolhidos e cortados pelo máximo pela ' +
              "aderência, do julgamento mais antigo ao mais recente, para ver mudança de entendimento; sem data vai ao " +
              "fim, com aviso. Nenhuma chamada a mais",
          ),
        agrupar: z
          .boolean()
          .optional()
          .describe(
            "Padrão sim: acórdãos do mesmo tribunal, órgão e relator com a mesma ementa inteira saem numa linha só, com " +
              "mesmaEmenta (contagem, período e ids dos demais). Só muda a apresentação; false lista cada acórdão",
          ),
        ...filtros,
        // Conferidos dentro da ferramenta, como tribunal e datas: o erro precisa dizer o formato aceito.
        deveConter: z
          .union([z.string(), z.array(z.unknown())])
          .optional()
          .describe(
            'Filtro local: grupos de sinônimos que a ementa deve conter, como [["improbidade"], ["dolo", "dolosa"]] ' +
              "(basta um termo de cada grupo; todos os grupos são exigidos); texto solto vale um termo",
          ),
        naoPodeConter: z
          .union([z.string(), z.array(z.unknown())])
          .optional()
          .describe('Filtro local: termos que excluem o acórdão, como ["multa administrativa"]; texto solto vale um termo'),
        renovar,
      },
    },
    async ({ deveConter, naoPodeConter, ...args }) => {
      try {
        conferirTribunais(...args.tribunais);
        conferirDatas(args);
        args.formulacoes = args.formulacoes.map(conferirFormulacao);
        const filtrosLocais = lerFiltrosLocais({ deveConter, naoPodeConter });
        // Tabelas e aviso de natureza jurídica entram na resposta final: a busca mede o teto com eles.
        const acrescimos = (r: ResultadoAmplo) => ({ ...comATabela(r.qualificados, { curta: true }), avisoNaturezaJuridica: avisoDasFontes(args.tribunais) });
        const r = await buscaAmpla(site, { ...args, ...filtrosLocais }, memoria, { tabela, tabelaStf, falcao, acrescimos });
        return json({ ...r, ...acrescimos(r) });
      } catch (e) {
        return erro(e);
      }
    },
  );

  registrar(
    "obter_ementa",
    {
      title: "Obter ementa",
      description:
        "Devolve a ementa como veio do site (avisoDeEmenta quando ela parece cortada pelo próprio site) e os dados de " +
        "um acórdão já devolvido por busca_direta ou busca_ampla, pelo id " +
        "(ex.: \"stj:12345\"), com o mesmo enquadramento927 da busca e a data e hora em que foi obtido do site " +
        "(obtidoDoSite). A memória do Garimpo guarda os acórdãos por 24 h desde a busca, para todas as janelas " +
        "(com GARIMPO_SEM_MEMORIA=1, só na janela que fez a busca, enquanto ela estiver aberta). " +
        "Não faz nova busca no site: fora da memória, refaça a busca que o trouxe. " +
        "Acórdão de embargos de declaração, agravo interno e similares, com número CNJ, traz avisoRecorrido: o " +
        "acórdão recorrido não vem nesta resposta e pode não estar na base.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: { id: z.string().describe("Id do acórdão, como veio na busca (tribunal:id)") },
    },
    async ({ id }) => {
      const guardado = await memoria.obter(id);
      if (!guardado) {
        return erro(
          new Error(
            `O acórdão ${id} não está na memória do Garimpo, que guarda os acórdãos por 24 h desde a busca. ` +
              "Refaça a busca que o trouxe.",
          ),
        );
      }
      const avisoRecorrido = avisoRecorridoDoAcordao(guardado.acordao);
      const [avisoLink] = avisoDeLinkDoTjgo([guardado.acordao]);
      const obtido = obtidoDoSite(guardado.obtidoEm);
      return comAvisoNaturezaJuridica(
        {
          ...guardado.acordao,
          obtidoDoSite: ehDoFalcao(guardado.acordao.tribunal) ? obtido.replace("do site", "do Falcão") : obtido,
          ...(avisoRecorrido && { avisoRecorrido }),
          ...(avisoLink && { avisoDeLink: avisoLink }),
        },
        [guardado.acordao.tribunal],
      );
    },
  );

  registrar(
    "obter_inteiro_teor",
    {
      title: "Obter inteiro teor oficial",
      description:
        "Baixa o PDF oficial do acórdão do portal do próprio tribunal e devolve o caminho do arquivo salvo, o " +
        "sha256 e o caminho do recibo de origem gravado ao lado (link oficial, data e hora, sha256; declaração do " +
        "Garimpo, não certidão). Nunca sobrescreve nem deixa arquivo pela metade; recusa PDF acima de 50 MB. " +
        "Já devolve a 1ª parte do texto, com o mesmo cabeçalho do ler_inteiro_teor e a chamada pronta para a parte " +
        "seguinte; com texto: false, devolve só o caminho, o recibo e o total de páginas do PDF. Se o PDF salvo não " +
        "puder ser lido, o download continua valendo e vem o motivo. " +
        "Antes de baixar, procura só na pasta de destino um PDF do mesmo acórdão que o Garimpo já baixou (pelo recibo " +
        "de origem, mesmo tribunal e id, ou o mesmo link da busca; nunca só pelo número do processo); com o PDF " +
        "intacto (mesmo sha256 do recibo), responde na hora, sem nenhuma chamada, e diz de quando é o download " +
        "(jaEstavaNaPasta). Não há como forçar novo download: para outra cópia do tribunal, mova o PDF e o recibo para " +
        "fora da pasta de destino. " +
        "Acórdão que veio da busca sem link nenhum: pede o link oficial, uma vez, à rota de link do JurisprudênciaIA " +
        "(exceto TST) e diz que ele veio de lá; sem link também ali, diz como achar o acórdão pelo número CNJ. " +
        "Baixa do TJMG, TJSP e TSE. STJ: não baixa (o robots.txt de processo.stj.jus.br veda o acesso automatizado); devolve o link para conferência manual, e o PDF baixado antes com recibo, ou trazido pelo usuário, é lido normalmente. TRT (Falcão): não há PDF a baixar; explica e aponta o ler_inteiro_teor pelo " +
        "id. TJTO: o portal entrega o acórdão em HTML; o Garimpo o traz como texto do portal do tribunal (sem PDF " +
        "nem recibo) para a memória e aponta o ler_inteiro_teor e o conferir_citacao pelo id. Para STF, TJGO e demais devolve o link e explica como obter no navegador " +
        "(o Garimpo não contorna captcha nem proteção anti-robô) e como ler o PDF baixado: passar o caminho do " +
        "arquivo ao ler_inteiro_teor. Informe o id que veio na busca ou tribunal + link.",
      // Só grava arquivo novo, nunca sobrescreve: sem a marca, o MCP presume "destrutiva".
      annotations: { destructiveHint: false },
      inputSchema: {
        id: z.string().optional().describe("Id do acórdão, como veio na busca (tribunal:id)"),
        tribunal: tribunal.optional().describe("Tribunal, se informar o link em vez do id"),
        link: z.string().url().optional().describe("Link do inteiro teor que veio na busca"),
        pasta: z.string().optional().describe(`Pasta onde salvar o PDF (padrão: ${pasta ?? pastaPadrao()})`),
        texto: z
          .boolean()
          .optional()
          .describe("Devolver a 1ª parte do texto (padrão: sim); false devolve só o caminho, o recibo e o total de páginas"),
      },
    },
    async ({ texto = true, ...args }) => {
      try {
        conferirTribunais(args.tribunal);
        const r = await obterInteiroTeor({ ...args, pasta: args.pasta ?? pasta }, tribunais, memoria, site);
        return json(r.baixado ? await comPrimeiraParteOuTotal(r, texto) : r);
      } catch (e) {
        return erro(e);
      }
    },
  );

  registrar(
    "ler_inteiro_teor",
    {
      title: "Ler inteiro teor",
      description:
        "Lê, pelo caminho do arquivo, o PDF do inteiro teor que o obter_inteiro_teor baixou, ou um PDF que o " +
        "usuário baixou à mão (em qualquer pasta; não aceita URL nem pasta, só PDF de até 50 MB), e devolve uma " +
        "parte do texto (cerca de 8 mil tokens estimados, feita de páginas do PDF inteiras; página grande demais " +
        "vem em segmentos). Cada parte traz o mesmo cabeçalho: tribunal, número, data, link oficial, sha256, id, " +
        "nome do arquivo, origem e \"páginas X–Y de N (parte P de T)\" (páginas do PDF, não folhas dos autos); o que faltar " +
        "vem como \"não informado\". A origem só é conferida com o recibo de origem ao lado do PDF e o mesmo sha256; " +
        "senão vem \"não conferida\", com o motivo. PDF sem recibo é inteiro teor trazido pelo usuário: origem " +
        "declarada, não conferida, nunca oficial. Para ele, informe se quiser o id da busca, ou tribunal + número: o " +
        "cabeçalho vem como vínculo declarado (da memória do Garimpo, sem rede) e diz se o número aparece no texto " +
        "(encontrado / não encontrado / não verificável; só informativo). Página sem texto extraível é avisada " +
        "(não faz OCR). Só lê: não grava, não copia e não chama a rede. Comece pela parte 1; a resposta traz a " +
        "chamada para a parte seguinte. TRT (Falcão): informe só o id que veio na busca, sem caminho: devolve o " +
        "texto integral do repositório oficial, convertido de HTML (não é PDF, sem recibo de origem), em partes por " +
        "tamanho (não são páginas de PDF), com cabeçalho de fonte, julgado em e juntado em; o texto fica na memória " +
        "por 24 h desde a busca, e texto com indício de corte vem marcado como incompleto. TJTO, só com o id, depois " +
        "do obter_inteiro_teor: o texto do portal do tribunal, do mesmo jeito.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        caminho: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Caminho do PDF: o campo arquivo do obter_inteiro_teor ou o de um PDF que você baixou (não URL); sem " +
              "caminho, só para TRT, pelo id",
          ),
        parte: z.number().int().optional().describe("Número da parte (padrão 1)"),
        id: z
          .string()
          .optional()
          .describe("TRT ou TJTO: id do acórdão (lê o texto da memória). PDF trazido, opcional: id do acórdão que ele seria"),
        tribunal: tribunal.optional().describe("Opcional, PDF trazido: tribunal do acórdão que ele seria"),
        numero: z.string().optional().describe("Opcional, PDF trazido: número do processo do acórdão que ele seria"),
      },
    },
    async ({ caminho, parte, ...vinculo }) => {
      try {
        conferirTribunais(vinculo.tribunal);
        if (caminho === undefined) {
          if (vinculo.id && (ehDoFalcao(vinculo.id.split(":")[0]) || ehTextoDoPortal(vinculo.id))) {
            return json(await lerTextoIntegral(vinculo.id, parte, memoria));
          }
          throw new Error(
            "Informe o caminho do PDF (o campo arquivo do obter_inteiro_teor ou o de um PDF que você baixou). Sem " +
              "caminho, só o id de um acórdão de TRT (Falcão) ou do TJTO (depois do obter_inteiro_teor), cujo texto " +
              "fica na memória do Garimpo.",
          );
        }
        return json(await lerInteiroTeor(caminho, parte, vinculo, memoria));
      } catch (e) {
        return erro(e);
      }
    },
  );

  registrar(
    "conferir_citacao",
    {
      title: "Conferir citação",
      description:
        "Confere, por regra fixa e sem IA, se cada citação está literalmente na ementa do acórdão (id que veio " +
        "na busca; ementa guardada na memória do Garimpo) e/ou no inteiro teor (caminho do PDF, o do " +
        "obter_inteiro_teor ou um trazido pelo usuário). Com id e caminho juntos, um veredito para cada fonte. Até 20 " +
        "citações por chamada; cada uma com 5 palavras ou mais e " +
        "(TRT, Falcão: com o id, confere na ementa e no texto integral do repositório oficial, convertido de HTML, " +
        "dizendo em qual achou; texto fora da memória = \"não verificável\" no texto integral) " +
        "até 3 mil caracteres, mandada sem as aspas de abertura e fechamento. Vereditos: \"encontrado literalmente\" " +
        "(só diferença de espaço, quebra de linha, espaço não separável, forma Unicode dos acentos ou aspas e " +
        "apóstrofos tipográficos, avisadas em equivalencias); \"encontrado com supressão indicada\" (cortes marcados " +
        "com (...) ou [...], pedaços de 5 palavras ou mais, na ordem; no PDF, em até 3 páginas seguidas); \"difere só " +
        "em maiúsculas/pontuação\" (não é literal; vem o texto exato da fonte); \"não encontrado\" (com a passagem " +
        "parecida da fonte, quando houver, que não é o texto informado; no PDF, também a passagem candidata, nunca " +
        "confirmada, quando a citação só fecha retirando hífen de fim de linha ou pulando linhas que podem ser " +
        "cabeçalho/rodapé na quebra de página; na ementa que parece ter vindo cortada do site, o aviso de que a " +
        "citação pode estar no trecho que faltou); \"não verificável\" (acórdão fora da memória, sem ementa, erro de leitura do PDF " +
        "ou sem texto extraível). Hífen, meia-risca e travessão nunca são iguais. Reticências soltas são procuradas " +
        "como texto, salvo reticenciasComoCorte. Na ementa, a posição vem como a frase que contém a citação; no " +
        "inteiro teor, como página do PDF (nunca folha dos autos), parte do ler_inteiro_teor e segmento, com a origem " +
        "do PDF (conferida, não conferida ou declarada pelo usuário, no PDF trazido) e a seção do acórdão pelo título " +
        "de seção (EMENTA, ACÓRDÃO, RELATÓRIO, VOTO, VOTO-VISTA, VOTO VENCIDO, VOTO VOGAL, CERTIDÃO), ou \"não " +
        "identificada\". Passagem entre aspas, ou no PDF logo depois de \"in verbis\", \"confira-se\" e semelhantes, " +
        "ganha o aviso de que pode ser de outro autor; no relatório ou num voto vencido, aviso forte. O Garimpo nunca " +
        "diz de quem é a passagem. Achar o texto não autentica a fonte, e o id junto do caminho de um PDF trazido é só " +
        "vínculo declarado. Só lê: não chama a rede e não grava.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        // Item malformado é conferido dentro da ferramenta: vira resultado próprio, com frase que ensina a corrigir,
        // sem derrubar as outras citações.
        citacoes: listaOuTexto(
          z.array(
            z.union([
              z.object({
                citacao: z.string().optional().describe("Texto a conferir, sem as aspas das pontas; cortes com (...) ou [...]"),
                id: z.string().optional().describe("Id do acórdão, como veio na busca (tribunal:id): confere na ementa"),
                caminho: z
                  .string()
                  .optional()
                  .describe("Caminho do PDF do inteiro teor (não URL): confere no inteiro teor"),
              }),
              z.string(),
            ]),
          ),
        ).describe("Citações a conferir (até 20), cada uma { citacao, id } e/ou { citacao, caminho }"),
        reticenciasComoCorte: z
          .boolean()
          .optional()
          .describe("Reticências soltas (... ou …) valem como corte (padrão: não; são procuradas como texto)"),
      },
    },
    async ({ citacoes, reticenciasComoCorte = false }) => {
      if (!citacoes.length || citacoes.length > 20) {
        return erro(
          new Error(
            `São ${citacoes.length} citações; mande de 1 a 20 por chamada, cada uma { citacao, id } e/ou ` +
              "{ citacao, caminho }. Com mais de 20, divida-as em mais de uma chamada.",
          ),
        );
      }
      // Cada PDF é extraído uma vez por chamada, por mais citações que o usem.
      const leituras = new Map<string, Promise<InteiroTeorParaConferir>>();
      const resultados = [];
      for (const [i, item] of citacoes.entries()) {
        if (typeof item === "string" || item.citacao === undefined || (item.id === undefined && item.caminho === undefined)) {
          resultados.push({
            citacao: i + 1,
            erro:
              "Cada citação vai como { citacao, id } (confere na ementa) e/ou { citacao, caminho } (confere no " +
              'inteiro teor): o texto a conferir e o id do acórdão como veio na busca, ou o caminho do PDF (ex.: { ' +
              '"citacao": "…", "id": "stj:12345" }).',
          });
          continue;
        }
        const { citacao, id, caminho } = item;
        let lida;
        try {
          lida = lerCitacao(citacao, { reticenciasComoCorte });
        } catch (e) {
          resultados.push({ citacao: i + 1, erro: (e as Error).message });
          continue;
        }
        const fontes = [];
        if (id !== undefined) {
          const a = (await memoria.obter(id))?.acordao;
          const doFalcao = ehDoFalcao(id.split(":")[0]);
          const doPortal = ehTextoDoPortal(id);
          const conferida = a
            ? conferirNaEmenta(a.ementa, lida, doFalcao ? "Sem ementa no Falcão: não há ementa para conferir." : undefined)
            : naoVerificavel(`O acórdão ${id} não está na memória do Garimpo. Refaça a busca que o trouxe e confira de novo.`);
          const cortada =
            a && !doFalcao && conferida.veredito === "não encontrado" && ementaAparentementeIncompleta(a.ementa)
              ? { aviso: AVISO_CITACAO_NA_EMENTA_CORTADA }
              : {};
          fontes.push({ fonte: "ementa", id, ...conferida, ...cortada });
          if (doFalcao || doPortal) {
            const t = await memoria.obterTexto(id);
            const semTexto = t?.motivoSemTexto;
            const noTexto = semTexto
              ? naoVerificavel(`${avisoSemTextoIntegral(semTexto)} Não há acórdão para conferir além da ementa.`)
              : t
                ? conferirNoTextoIntegral(t.texto, lida)
                : naoVerificavel(textoForaDaMemoria(id));
            const corte =
              t?.indicioDeCorte && noTexto.veredito !== "não verificável"
                ? { aviso: `${AVISO_DE_CORTE} Uma citação "não encontrada" pode estar no trecho que faltou.` }
                : {};
            const avisos = [(corte as { aviso?: string }).aviso, t?.conteudoOculto ? AVISO_CONTEUDO_OCULTO : undefined].filter(Boolean);
            fontes.push({
              fonte: "texto integral", id,
              origem: naturezaDoTexto(Boolean(semTexto), doPortal),
              ...noTexto,
              ...(avisos.length > 0 && { aviso: avisos.join(" ") }),
            });
          }
        }
        if (caminho !== undefined) {
          if (!leituras.has(caminho)) leituras.set(caminho, lerParaConferir(caminho));
          try {
            const leitura = await leituras.get(caminho)!;
            // Com o id junto, o usuário diz qual acórdão seria o PDF: vínculo declarado, que não vira prova.
            const vinculo =
              id !== undefined && !leitura.origem.startsWith("conferida")
                ? {
                    vinculo:
                      `declarado pelo usuário: o id ${id} diz qual acórdão seria este PDF, mas não prova que ele é ` +
                      "esse acórdão; achar a citação no texto também não prova",
                  }
                : {};
            fontes.push({
              fonte: "inteiro teor",
              caminho,
              origem: leitura.origem,
              ...vinculo,
              ...conferirNoInteiroTeor(leitura, lida),
            });
          } catch (e) {
            fontes.push({ fonte: "inteiro teor", caminho, ...naoVerificavel((e as Error).message) });
          }
        }
        resultados.push({ citacao: i + 1, fontes });
      }
      const ids = citacoes.flatMap((c) => (typeof c === "object" && c.id ? [c.id.split(":")[0]] : []));
      const doFalcao = ids.some(ehDoFalcao);
      return comAvisoNaturezaJuridica({
        reticenciasComoCorte,
        resultados,
        aviso:
          "Achar o texto não autentica a fonte: a ementa é a que o JurisprudênciaIA devolveu, e o PDF só tem origem " +
          "conferida com o recibo de origem ao lado dele e o mesmo sha256." +
          (doFalcao
            ? " Nos TRTs, a ementa e o texto integral são os que o Falcão devolveu, convertidos de HTML pelo Garimpo: " +
              "achar a citação também não autentica o texto nem confere a origem (não há PDF nem recibo)."
            : ""),
        notaSinalDeOutroAutor:
          "Sinal de outro autor é indício, não autoria: o Garimpo não diz de quem é a passagem nem se é a tese " +
          "vencedora, e a falta de sinal não prova que a passagem é do tribunal. No inteiro teor, a seção vem do último " +
          "título de seção antes da passagem (EMENTA, ACÓRDÃO, RELATÓRIO, VOTO, VOTO-VISTA, VOTO VENCIDO, VOTO VOGAL, " +
          'CERTIDÃO, sozinho na linha); sem título assim, seção "não identificada".',
      }, ids);
    },
  );

  registrar(
    "consultar_precedente",
    {
      title: "Consultar precedente (STJ pela tabela, STF pelo portal)",
      description:
        "Consulta um precedente pelo número. STJ: tema repetitivo ou IAC, direto na tabela de precedentes que vai no " +
        "Garimpo (fotografia datada do Portal de Dados Abertos do STJ), sem consultar o portal do STJ: o robots.txt de " +
        "processo.stj.jus.br veda o acesso automatizado ao host, e o Garimpo respeita. A resposta diz \"tabela de " +
        "<data>; consulta automática ao portal não realizada por restrição de acesso\", traz a situação na fonte (literal, " +
        "situação processual, nunca vigência), a tese firmada ou \"sem tese firmada na tabela\", a questão submetida (a " +
        "pergunta, não a tese), órgão julgador, processo paradigma, a atribuição e, com mais de 90 dias, o aviso de idade; " +
        "número ausente volta como \"não consta na tabela de <data>\", nunca como inexistente. Para a situação do dia, " +
        "o usuário confere no portal do STJ pelo navegador. STF: no portal do tribunal, na hora da pergunta: repercussão " +
        "geral (ficha do tema e página da tese, 2 chamadas), súmula ou súmula vinculante (lista do tipo e página da " +
        "súmula, 2 chamadas, 1 com a lista na memória); devolve a situação do tema e a tese, ou a marca de situação da " +
        "lista do STF e o enunciado; a falta de marca não prova vigência. A resposta diz \"consultado no portal do STF em " +
        "<data e hora>\" e fica na memória por 24 h. Se o portal do STF recusar, estiver fora ou devolver uma página que " +
        "o Garimpo não reconhece, responde a tabela do STF que vai no Garimpo (obtida pelo mantenedor, fundamento Lei " +
        "9.610/98, art. 8º, IV), com origem \"tabela de <data>, o portal do STF não respondeu\", o motivo e a " +
        "atribuição. Sempre com o enquadramento927. O tipo é obrigatório: a numeração de cada tipo é separada.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        tribunal: z.string().describe('"stj" ou "stf": só esses dois tribunais'),
        tipo: z
          .string()
          .optional()
          .describe('STJ: "tema repetitivo" ou "IAC"; STF: "repercussão geral", "súmula" ou "súmula vinculante" (obrigatório)'),
        numero: z.number().int().min(1).describe("Número do tema, do IAC ou da súmula"),
      },
    },
    async ({ tribunal, tipo, numero }) => {
      try {
        const sigla = tribunal.trim().toLowerCase();
        if (sigla === "stf") {
          const doTipo = TIPOS_NO_STF.find((t) => t === tipo?.trim());
          if (!doTipo) {
            throw new Error(
              `Diga o tipo do STF: "repercussão geral", "súmula" ou "súmula vinculante"${tipo ? ` ("${tipo}" não é um deles)` : ""}. ` +
                "A numeração de cada tipo é separada: a Súmula 1 e a Súmula Vinculante 1 são precedentes diferentes.",
            );
          }
          try {
            return json({ ...respostaDoStf(await aoVivo.doStf(doTipo, numero)), avisoNaturezaJuridica: AVISO_AO_VIVO });
          } catch (e) {
            if (!tabelaStf) {
              throw new Error(
                `O portal do STF não respondeu (${(e as Error).message}) e a tabela do STF não foi carregada neste servidor.`,
              );
            }
            const resposta = consultarPrecedenteStf(tabelaStf, doTipo, numero, (agora ?? Date.now)());
            return json({
              ...planoB(resposta.tabela.dataDaObtencao, e),
              ...resposta,
              avisoNaturezaJuridica: AVISO_DA_TABELA_STF,
            });
          }
        }
        if (sigla !== "stj") {
          throw new Error(
            `O consultar_precedente só cobre o STJ (temas repetitivos e IAC) e o STF (repercussão geral, súmulas e ` +
              `súmulas vinculantes); "${tribunal}" não está entre eles. Use tribunal "stj" ou "stf", ou busque o precedente ` +
              "com busca_direta.",
          );
        }
        const doTipo = TIPOS_NA_TABELA.find((t) => t === tipo?.trim());
        if (!doTipo) {
          throw new Error(
            `Diga o tipo: "tema repetitivo" ou "IAC"${tipo ? ` ("${tipo}" não é um deles)` : ""}. Tema e IAC do STJ ` +
              "têm numeração separada: o Tema 1 e o IAC 1 são precedentes diferentes.",
          );
        }
        // D-18: o robots.txt de processo.stj.jus.br veda o host inteiro; o STJ responde só pela tabela, sem tentar o portal.
        if (!tabela) {
          throw new Error(
            "A tabela de precedentes do STJ não foi carregada neste servidor, e a consulta automática ao portal do STJ " +
              "não é feita por restrição de acesso: o precedente não pôde ser verificado.",
          );
        }
        const resposta = consultarPrecedente(tabela, doTipo, numero, (agora ?? Date.now)());
        return json({
          origem: `tabela de ${resposta.tabela.dataDaColeta}; consulta automática ao portal não realizada por restrição de acesso`,
          ...resposta,
          avisoNaturezaJuridica: AVISO_DA_TABELA,
        });
      } catch (e) {
        return erro(e);
      }
    },
  );

  registrar(
    "julgamentos_do_processo",
    {
      title: "Julgamentos do processo",
      description:
        "Pelo número CNJ (com ou sem máscara; o tribunal sai do número), mostra os julgamentos registrados do processo " +
        "no DataJud, a base pública de metadados do CNJ (sem texto de decisão e sem nome de parte): só registros de 2º " +
        "grau ou de tribunal superior (os de 1º grau são contados, não listados), só os movimentos de resultado de " +
        "julgamento da Tabela Processual Unificada (ex.: Não-Provimento, Não-Acolhimento de Embargos de Declaração) e, " +
        "à parte, a juntada de documento com complemento \"Acórdão\". Cada linha traz lancadoEm (data do lançamento no " +
        "DataJud, não a da sessão), código, nome e órgão; cada registro, a última atualização no DataJud. Use tribunal " +
        "(ex.: stj, tst) para consultar o processo depois que ele subiu. O DataJud não cobre o STF. Ao lado, os " +
        "acórdãos do mesmo número que uma busca pelo número no JurisprudênciaIA devolve, com o id para o obter_ementa " +
        "(busca guardada, se houver). ladoALado traz os totais das duas fontes; só com as duas respostas utilizáveis e " +
        "sem corte, compara embargos de declaração com embargos de declaração e diz o que conferir no portal do " +
        "tribunal (o movimento de tipo não verificado, ou a diferença de embargos). Nunca afirma que um acórdão falta. " +
        "Cada fonte vem com o seu estado (ok, vazia, erro, recusa, pausa, não consultada); \"o DataJud não devolveu este " +
        "processo\" não prova que ele não exista. " +
        "Com incluir_djen (padrão), também as comunicações do processo no DJEN (uma página, até 100): data de " +
        "disponibilização, tipo de comunicação e de documento, órgão, classe e link; nunca o texto nem nome de parte ou " +
        "advogado; são comunicações do processo, não um inventário de acórdãos. Se o DJEN pedir para esperar, vem o " +
        "que as outras fontes trouxeram e o instante em que se pode tentar de novo (estado pausa). " +
        "Consulta repetida em 24 h volta da memória do Garimpo, sem nova chamada. Não busca por nome de parte. " +
        `Uso sob o termo de uso da API Pública do CNJ (${TERMO_DE_USO_DATAJUD}); as obrigações do termo são de quem ` +
        "usa a API.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        numero: z.string().describe("Número CNJ do processo, com ou sem máscara (NNNNNNN-DD.AAAA.J.TR.OOOO)"),
        tribunal: z
          .string()
          .optional()
          .describe("Opcional: sigla do tribunal onde consultar (ex.: stj, tst); padrão: o tribunal do número"),
        incluir_djen: z
          .boolean()
          .optional()
          .describe("Consultar também as comunicações do processo no DJEN (padrão: true; false responde mais rápido)"),
      },
    },
    async (args) => {
      try {
        const { incluir_djen: incluirDjen, ...pedido } = args;
        const fontes = { site, datajud, djen: fonteDjen, chave: chaveDoDataJud, memoria, agora, tabela };
        return json(await julgamentosDoProcesso({ ...pedido, incluirDjen }, fontes));
      } catch (e) {
        return erro(e);
      }
    },
  );

  registrar(
    "listar_tribunais",
    {
      title: "Listar tribunais",
      description:
        "Lista os tribunais cobertos pelo Garimpo e, para cada um: a fonte (JurisprudênciaIA ou Falcão (CSJT), o " +
        "repositório oficial da Justiça do Trabalho, para os 24 TRTs), se tem busca, quais precedentes qualificados " +
        "o site devolve, o teto de resultados por busca e se o inteiro teor oficial é baixado, só linkado ou, nos " +
        "TRTs, texto integral do repositório oficial (sem PDF); no TJTO, texto do portal do tribunal. Detalhes dos limites do Falcão na página " +
        "garimpo://tribunais.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () =>
      json(
        TRIBUNAIS.map((t) => ({
          tribunal: t.sigla,
          nome: t.nome,
          fonte: t.fonte,
          busca: true,
          qualificados: t.fonte === "Falcão (CSJT)" ? QUALIFICADOS_TRT : t.qualificados,
          tetoResultados: t.tetoResultados,
          inteiroTeor: t.inteiroTeor,
          ...(t.motivoLink ? { motivo: t.motivoLink } : {}),
          ...(t.inteiroTeor === "texto" ? { motivo: INTEIRO_TEOR_TRT } : {}),
          ...(t.inteiroTeor === "portal" ? { motivo: INTEIRO_TEOR_PORTAL } : {}),
        })),
      ),
  );

  registrar(
    "diagnostico_dos_freios",
    {
      title: "Diagnóstico dos freios (por que parou?)",
      description:
        "Explica por que uma fonte parou de responder, sem chamar fonte nenhuma: só lê o estado de proteção guardado " +
        "neste computador. Fonte por fonte: se está pausada e até quando, se é pausa preventiva (com o restante que a " +
        "fonte informou), as recusas e retomadas das últimas 24 h (sem termo de busca nem número de processo) e se há " +
        "indício de recusa sistemática (esperar não resolve) ou se parece rajada (a pausa costuma passar). Avisa também " +
        "quando a rede está parada e quando esta janela não conseguiu gravar uma recusa. Use quando uma chamada falhar " +
        "por recusa ou pausa, antes de decidir se tenta de novo.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => json(await (coordenacao ?? coordenacaoPadrao()).diagnosticar()),
  );

  registrar(
    "conferir_acordao_citado",
    {
      title: "Conferir os dados do acórdão citado",
      description:
        "Confere o número, o tribunal e, se informados, a data de julgamento (AAAA-MM-DD) e o órgão de um acórdão citado. " +
        "Com o id que veio numa busca e o acórdão na memória do Garimpo, não chama o site; sem id, faz uma busca direta " +
        "pelo número (a busca guardada da mesma conferência não chama o site de novo). Estados: \"confirmado\" (o " +
        "registro bate em tudo o que foi informado), \"dados em conflito\" (cada divergência vem com o que foi informado " +
        "e o que está no registro) e \"não verificado\" (a busca não trouxe o número: isso NÃO quer dizer que o " +
        "acórdão não existe). Dado informado que o registro não traz vem em naoConferidos. Número com mais de um " +
        "acórdão (recurso e embargos) lista os outros. Compara só com a base do JurisprudênciaIA; confira o acórdão " +
        "no portal do tribunal antes de citar. Não vale para TRT. Busca com erro é erro, nunca \"não verificado\".",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        tribunal,
        numero: z.string().min(1).describe("Número do processo citado, como a citação traz (com ou sem pontos e classe)"),
        data: z.string().optional().describe("Data de julgamento citada, AAAA-MM-DD"),
        orgao: z.string().optional().describe("Órgão julgador citado (turma, câmara, seção)"),
        id: z.string().optional().describe("Id do acórdão, como veio numa busca (tribunal:id): confere na memória, sem chamar o site"),
        renovar,
      },
    },
    async ({ renovar, id, ...citado }) => {
      try {
        const { tribunal: sigla } = citado;
        conferirTribunais(sigla);
        if (ehDoFalcao(sigla)) {
          throw new Error(
            "A conferência por número não foi verificada nos TRTs (Falcão). Use busca_direta no TRT com o número e " +
              "confira na lista, ou confira no portal do tribunal.",
          );
        }
        if (citado.data !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(citado.data)) {
          throw new Error(`A data ("${citado.data}") está fora do formato: use AAAA-MM-DD, por exemplo 2024-03-15.`);
        }
        if (!/\d/.test(citado.numero)) {
          throw new Error("O número citado não tem nenhum algarismo: informe o número do processo, como na citação.");
        }
        if (id !== undefined && id.split(":")[0].toLowerCase() !== sigla.toLowerCase()) {
          throw new Error(`O id ${id} não é do tribunal ${sigla}: informe o id que a busca devolveu para este acórdão.`);
        }
        const aviso =
          '"Não verificado" quer dizer só que o número não pôde ser conferido no registro: não que ele não exista. ' +
          "Confira no portal do tribunal.";
        const guardado = id !== undefined ? await memoria.obter(id) : undefined;
        if (guardado) {
          return comAvisoNaturezaJuridica({ ...conferirDadosDoAcordao(citado, [], guardado.acordao), consultaAoSite: false, aviso }, [sigla]);
        }
        const r = await buscaDireta(site, { tribunal: sigla, texto: citado.numero, limite: 10 }, memoria, { renovar, tabela, tabelaStf });
        return comAvisoNaturezaJuridica(
          {
            ...conferirDadosDoAcordao(citado, r.acordaos),
            consultaAoSite: !r.buscaGuardada,
            aviso,
          },
          [sigla],
        );
      } catch (e) {
        return erro(e);
      }
    },
  );

  registrar(
    "panorama_da_amostra",
    {
      title: "Panorama da amostra",
      description:
        "Conta, por tribunal, por ano de julgamento e por órgão julgador, os acórdãos que uma busca já trouxe (informe " +
        "os ids, de 1 a 200, como vieram na busca_direta ou na busca_ampla; o acórdão tem de estar na memória do " +
        "Garimpo, que guarda por 24 h). Não chama o site. É contagem da amostra da busca, não estatística do tribunal: " +
        "o aviso vem em toda resposta. Sem data, vai em \"sem data\"; sem órgão, em \"sem órgão informado\"; por " +
        "tribunal, os 20 órgãos mais frequentes e \"outros\". Id repetido conta uma vez; id fora da memória vem em " +
        "foraDaMemoria, sem entrar na conta.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        ids: listaOuTexto(z.array(z.string())).describe("Ids dos acórdãos (tribunal:id), de 1 a 200"),
      },
    },
    async ({ ids }) => {
      try {
        if (!ids.length || ids.length > 200) {
          throw new Error(`São ${ids.length} ids; mande de 1 a 200 ids de acórdãos, como vieram na busca (ex.: "stj:12345").`);
        }
        const unicos = [...new Set(ids)];
        const guardados = await Promise.all(unicos.map(async (id) => ({ id, guardado: await memoria.obter(id) })));
        const foraDaMemoria = guardados.filter((g) => !g.guardado).map((g) => g.id);
        return comAvisoNaturezaJuridica(
          {
            ...panorama(guardados.flatMap((g) => (g.guardado ? [g.guardado.acordao] : []))),
            foraDaMemoria,
            avisoDeAmostra: AVISO_DE_AMOSTRA,
            ...(foraDaMemoria.length && {
              aviso: "Os ids em foraDaMemoria não entraram na conta: refaça a busca que os trouxe e peça o panorama de novo.",
            }),
          },
          [...new Set(guardados.flatMap((g) => (g.guardado ? [g.guardado.acordao.tribunal] : [])))],
        );
      } catch (e) {
        return erro(e);
      }
    },
  );

  servidor.registerResource(
    "tribunais",
    "garimpo://tribunais",
    {
      title: "Tribunais cobertos pelo Garimpo",
      description:
        "Por tribunal: sigla, nome, fonte, precedentes qualificados, teto por busca e se o inteiro teor é baixado, só " +
        "linkado (e por quê) ou texto integral (TRTs); e os limites do Falcão. Mesma tabela do listar_tribunais, sem rede.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: paginaDeTribunais() }] }),
  );

  servidor.registerPrompt(
    "pesquisar_tese",
    {
      title: "Pesquisar tese",
      description:
        "Roteiro de pesquisa: o passo a passo para pesquisar uma tese com as ferramentas do Garimpo, da formulação à " +
        "conferência da citação. Não afirma jurisprudência.",
      argsSchema: {
        tese: z.string().describe("A tese a pesquisar, em palavras suas"),
        tribunais: z
          .string()
          .optional()
          .describe("Tribunais em que pesquisar, em texto livre (opcional; sem eles, o roteiro manda perguntar)"),
      },
    },
    ({ tese, tribunais }) => ({
      messages: [{ role: "user", content: { type: "text", text: roteiroDePesquisa(tese, tribunais) } }],
    }),
  );

  return servidor;
}
