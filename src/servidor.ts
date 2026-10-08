/**
 * Monta o servidor MCP do Garimpo com o cliente do site, o dos tribunais e a pasta de gravação injetados, sem
 * ligá-lo a transporte nenhum: o stdio liga em index.ts; os testes ligam um cliente MCP em memória com site e
 * tribunais falsos por trás e uma pasta temporária.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Cliente, VERSAO } from "./cliente.js";
import { acordaoNaMemoria, buscaDireta } from "./busca.js";
import { buscaAmpla } from "./ampla.js";
import { conferirNaEmenta, conferirNoInteiroTeor, lerCitacao, naoVerificavel } from "./conferencia.js";
import {
  type ClientePorTribunal,
  clientePadrao,
  type InteiroTeorBaixado,
  obterInteiroTeor,
  pastaPadrao,
} from "./inteiroTeor.js";
import {
  contarPaginas,
  type InteiroTeorParaConferir,
  LIMITE_CARACTERES_PARTE,
  lerInteiroTeor,
  lerParaConferir,
} from "./leitura.js";
import { SIGLAS, TRIBUNAIS } from "./tribunais.js";

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

const filtros = {
  de: z.string().optional().describe("Data de julgamento inicial, AAAA-MM-DD"),
  ate: z.string().optional().describe("Data de julgamento final, AAAA-MM-DD"),
  relator: z.string().optional().describe("Nome do relator"),
  orgao: z.string().optional().describe("Órgão julgador (turma, câmara, seção)"),
  classe: z.string().optional().describe("Classe processual"),
};

/**
 * Lista mandada como texto (ADR-0002): modelos que não são o Claude costumam mandar listas assim. Texto de lista
 * JSON vira a lista; qualquer outro texto vale como um item só. Nunca parte por vírgula ("art. 37, § 6º").
 */
function listaOuTexto<T extends z.ZodTypeAny>(lista: T) {
  return z.preprocess((valor) => {
    if (typeof valor !== "string") return valor;
    try {
      const lido: unknown = JSON.parse(valor);
      if (Array.isArray(lido)) return lido;
    } catch {
      // Não é JSON: texto solto.
    }
    return [valor];
  }, lista);
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

/** JSON sem recuo: o recuo não leva informação e custa ~10% da resposta da busca ampla. */
function json(dado: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(dado) }] };
}

/** Aviso de natureza jurídica: vai, em campo próprio, em toda resposta que traz jurisprudência (nunca em erro). */
const AVISO_NATUREZA_JURIDICA =
  "Resultado de busca em base não oficial. Confira o acórdão no link oficial do tribunal antes de citar; " +
  "a ementa não substitui o inteiro teor.";

function comAvisoNaturezaJuridica<T extends object>(dado: T) {
  return json({ ...dado, avisoNaturezaJuridica: AVISO_NATUREZA_JURIDICA });
}

function erro(e: unknown) {
  return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
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
}

export function criarServidor(
  site: Cliente,
  { tribunais = clientePadrao, pasta }: OpcoesServidor = {},
): McpServer {
  const servidor = new McpServer({ name: "garimpo", version: VERSAO });

  servidor.registerTool(
    "busca_direta",
    {
      title: "Busca direta",
      description:
        "Pesquisa jurisprudência num tribunal pela busca direta do JurisprudênciaIA (sem o chat de IA do site). " +
        "Devolve acórdãos com ementa inteira, número, órgão, data e link oficial, e, em lista separada, os " +
        "precedentes qualificados (temas, súmulas). O site costuma devolver poucos acórdãos do STF por busca (de 2 a 7 na medição de out/2026). " +
        "O campo cabecalhoDeCobertura diz se veio o número pedido (pode haver mais) ou menos (a base não tem mais " +
        "para o texto; no STF, que devolve poucos por busca, pode haver mais). " +
        "Cada acórdão e cada precedente qualificado traz enquadramento927: o inciso do art. 927 do CPC com a " +
        "evidência tirada dos dados do site, ou \"não classificado\" com o motivo; o rótulo da lista de qualificados " +
        "não prova enquadramento, vigência nem aplicabilidade. " +
        "Ementas são longas: prefira limite baixo aqui e busca_ampla para volume.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        tribunal,
        texto: z.string().min(2).describe("Texto da busca (palavras da tese, dispositivo legal, instituto)"),
        limite: z.number().int().min(1).max(100).optional().describe("Máximo de acórdãos (1 a 100; padrão 10)"),
        ...filtros,
      },
    },
    async (args) => {
      try {
        conferirTribunais(args.tribunal);
        conferirDatas(args);
        return comAvisoNaturezaJuridica(await buscaDireta(site, args));
      } catch (e) {
        return erro(e);
      }
    },
  );

  servidor.registerTool(
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
        "Formulações boas variam sinônimos técnicos, dispositivo legal e nome do instituto.",
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        formulacoes: listaOuTexto(z.array(z.string().min(2)).min(1).max(20)).describe("Formulações da mesma tese (até 20)"),
        tribunais: listaOuTexto(z.array(tribunal).min(1).max(5)).describe("Tribunais (até 5)"),
        limitePorBusca: z.number().int().min(1).max(100).optional().describe("Acórdãos por busca (padrão 100)"),
        maximo: z.number().int().min(1).max(200).optional().describe("Máximo de acórdãos na resposta (padrão 50)"),
        ...filtros,
      },
    },
    async (args) => {
      try {
        conferirTribunais(...args.tribunais);
        conferirDatas(args);
        return comAvisoNaturezaJuridica(await buscaAmpla(site, args));
      } catch (e) {
        return erro(e);
      }
    },
  );

  servidor.registerTool(
    "obter_ementa",
    {
      title: "Obter ementa",
      description:
        "Devolve a ementa inteira e os dados de um acórdão já devolvido por busca_direta ou busca_ampla nesta " +
        "sessão, pelo id (ex.: \"stj:12345\"), com o mesmo enquadramento927 da busca. Não faz nova busca no site.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { id: z.string().describe("Id do acórdão, como veio na busca (tribunal:id)") },
    },
    async ({ id }) => {
      const a = acordaoNaMemoria(id);
      if (!a) return erro(new Error(`O acórdão ${id} não está na memória desta sessão. Refaça a busca que o trouxe.`));
      return comAvisoNaturezaJuridica(a);
    },
  );

  servidor.registerTool(
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
        "Baixa do STJ, TJMG e TSE. Para STF, TJGO e demais devolve o link e explica como obter no navegador " +
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
        const r = await obterInteiroTeor({ ...args, pasta: args.pasta ?? pasta }, tribunais);
        return json(r.baixado ? await comPrimeiraParteOuTotal(r, texto) : r);
      } catch (e) {
        return erro(e);
      }
    },
  );

  servidor.registerTool(
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
        "cabeçalho vem como vínculo declarado (da memória da sessão, sem rede) e diz se o número aparece no texto " +
        "(encontrado / não encontrado / não verificável; só informativo). Página sem texto extraível é avisada " +
        "(não faz OCR). Só lê: não grava, não copia e não chama a rede. Comece pela parte 1; a resposta traz a " +
        "chamada para a parte seguinte.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        caminho: z
          .string()
          .min(1)
          .describe("Caminho do PDF: o campo arquivo do obter_inteiro_teor ou o de um PDF que você baixou (não URL)"),
        parte: z.number().int().optional().describe("Número da parte (padrão 1)"),
        id: z.string().optional().describe("Opcional, PDF trazido: id do acórdão que ele seria, como veio na busca"),
        tribunal: tribunal.optional().describe("Opcional, PDF trazido: tribunal do acórdão que ele seria"),
        numero: z.string().optional().describe("Opcional, PDF trazido: número do processo do acórdão que ele seria"),
      },
    },
    async ({ caminho, parte, ...vinculo }) => {
      try {
        conferirTribunais(vinculo.tribunal);
        return json(await lerInteiroTeor(caminho, parte, vinculo));
      } catch (e) {
        return erro(e);
      }
    },
  );

  servidor.registerTool(
    "conferir_citacao",
    {
      title: "Conferir citação",
      description:
        "Confere, por regra fixa e sem IA, se cada citação está literalmente na ementa do acórdão (id que veio " +
        "na busca; ementa guardada na memória do Garimpo) e/ou no inteiro teor (caminho do PDF, o do " +
        "obter_inteiro_teor ou um trazido pelo usuário). Com id e caminho juntos, um veredito para cada fonte. Até 20 " +
        "citações por chamada; cada uma com 5 palavras ou mais e " +
        "até 3 mil caracteres, mandada sem as aspas de abertura e fechamento. Vereditos: \"encontrado literalmente\" " +
        "(só diferença de espaço, quebra de linha, espaço não separável, forma Unicode dos acentos ou aspas e " +
        "apóstrofos tipográficos, avisadas em equivalencias); \"encontrado com supressão indicada\" (cortes marcados " +
        "com (...) ou [...], pedaços de 5 palavras ou mais, na ordem; no PDF, em até 3 páginas seguidas); \"difere só " +
        "em maiúsculas/pontuação\" (não é literal; vem o texto exato da fonte); \"não encontrado\" (com a passagem " +
        "parecida da fonte, quando houver, que não é o texto informado; no PDF, também a passagem candidata, nunca " +
        "confirmada, quando a citação só fecha retirando hífen de fim de linha ou pulando linhas que podem ser " +
        "cabeçalho/rodapé na quebra de página); \"não verificável\" (acórdão fora da memória, sem ementa, erro de leitura do PDF " +
        "ou sem texto extraível). Hífen, meia-risca e travessão nunca são iguais. Reticências soltas são procuradas " +
        "como texto, salvo reticenciasComoCorte. Na ementa, a posição vem como a frase que contém a citação; no " +
        "inteiro teor, como página do PDF (nunca folha dos autos), parte do ler_inteiro_teor e segmento, com a origem " +
        "do PDF (conferida, não conferida ou declarada pelo usuário, no PDF trazido) e a seção do acórdão pelo título " +
        "de seção (EMENTA, ACÓRDÃO, RELATÓRIO, VOTO, VOTO-VISTA, VOTO VENCIDO, VOTO VOGAL, CERTIDÃO), ou \"não " +
        "identificada\". Passagem entre aspas, ou no PDF logo depois de \"in verbis\", \"confira-se\" e semelhantes, " +
        "ganha o aviso de que pode ser de outro autor; no relatório ou num voto vencido, aviso forte. O Garimpo nunca " +
        "diz de quem é a passagem. Achar o texto não autentica a fonte, e o id junto do caminho de um PDF trazido é só " +
        "vínculo declarado. Só lê: não chama a rede e não grava.",
      annotations: { readOnlyHint: true, openWorldHint: false },
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
          const a = acordaoNaMemoria(id);
          const conferida = a
            ? conferirNaEmenta(a.ementa, lida)
            : naoVerificavel(`O acórdão ${id} não está na memória do Garimpo. Refaça a busca que o trouxe e confira de novo.`);
          fontes.push({ fonte: "ementa", id, ...conferida });
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
      return comAvisoNaturezaJuridica({
        reticenciasComoCorte,
        resultados,
        aviso:
          "Achar o texto não autentica a fonte: a ementa é a que o JurisprudênciaIA devolveu, e o PDF só tem origem " +
          "conferida com o recibo de origem ao lado dele e o mesmo sha256.",
        notaSinalDeOutroAutor:
          "Sinal de outro autor é indício, não autoria: o Garimpo não diz de quem é a passagem nem se é a tese " +
          "vencedora, e a falta de sinal não prova que a passagem é do tribunal. No inteiro teor, a seção vem do último " +
          "título de seção antes da passagem (EMENTA, ACÓRDÃO, RELATÓRIO, VOTO, VOTO-VISTA, VOTO VENCIDO, VOTO VOGAL, " +
          'CERTIDÃO, sozinho na linha); sem título assim, seção "não identificada".',
      });
    },
  );

  servidor.registerTool(
    "listar_tribunais",
    {
      title: "Listar tribunais",
      description:
        "Lista os tribunais cobertos pelo Garimpo e, para cada um: se tem busca, quais precedentes qualificados " +
        "o site devolve, o teto de resultados por busca e se o inteiro teor oficial é baixado ou só linkado.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () =>
      json(
        TRIBUNAIS.map((t) => ({
          tribunal: t.sigla,
          nome: t.nome,
          busca: true,
          qualificados: t.qualificados,
          tetoResultados: t.tetoResultados,
          inteiroTeor: t.inteiroTeor,
          ...(t.motivoLink ? { motivo: t.motivoLink } : {}),
        })),
      ),
  );

  return servidor;
}
