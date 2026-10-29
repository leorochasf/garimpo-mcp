import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { respostaJson } from "./apoio.js";

// Fixtures saneadas: a forma vista na base em 2026-10-29 (amostras do Rede, fora do git); nomes e números fictícios.
const CNJ_TJMT = "0000001-11.2021.8.11.0001";
const CNJ_TJCE = "0000002-22.2022.8.06.0001";
const TJMT = {
  id: 1,
  classe_processual: "TURMA RECURSAL CÍVEL",
  orgao_julgador: "TURMA RECURSAL ÚNICA",
  numero_processo_cnj: CNJ_TJMT,
  data_julgamento: "2022-05-05T00:00:00.000Z",
  texto_ementa:
    `Recurso Inominado: ${CNJ_TJMT} Origem: Juizado Especial de Exemplo Recorrente(s): EMPRESA EXEMPLO Recorrido(s): ` +
    "PESSOA FICTÍCIA Juiz Relator: Fulano de Tal Data do Julgamento: 05/05/2022 EMENTA RECURSO INOMINADO – RELAÇÃO DE " +
    `CONSUMO – EXEMPLO FICTÍCIO – RECURSO CONHECIDO E PROVIDO. (TJ-MT, RECURSO INOMINADO ${CNJ_TJMT}, Relator(a) ` +
    "FULANO DE TAL, TURMA RECURSAL ÚNICA, Julgado em 05/05/2022, Publicado em 06/05/2022)",
};
const CLASSE_TJCE = "Agravo Interno em Recurso Especial em Apelação Cível";
const TJCE = {
  id: 2,
  classe_processual: CLASSE_TJCE,
  orgao_julgador: "2ª Câmara Direito Privado",
  numero_processo_cnj: CNJ_TJCE,
  data_julgamento: "2024-05-29T00:00:00.000Z",
  texto_ementa:
    "EMENTA: APELAÇÃO CÍVEL. DIREITO CIVIL E CONSUMIDOR. CONTRATO DE EXEMPLO. SENTENÇA DE ORIGEM. RECURSO CONHECIDO " +
    "E PROVIDO. ACÓRDÃO Acordam os Desembargadores integrantes da Câmara de Exemplo, unanimemente, em conhecer do " +
    `recurso. (Apelação Cível - ${CNJ_TJCE}, Rel. Desembargador(a) FULANO DE TAL, 2ª Câmara Direito Privado, data do ` +
    "julgamento: 29/05/2024, data da publicação: 29/05/2024)",
};

const RESSALVA =
  "O Garimpo a mostra como veio, mas ela pode estar errada, e o que depende dela também (o enquadramento927 e, se " +
  "vier, o aviso de recurso sem recorrido). Confira a classe no inteiro teor.";
const AVISO_TJMT =
  `A classe que o JurisprudênciaIA informa ("TURMA RECURSAL CÍVEL") é nome de órgão julgador, não de classe processual. ${RESSALVA}`;
const AVISO_TJCE =
  `A classe que o JurisprudênciaIA informa ("${CLASSE_TJCE}") começa por "Agravo Interno", que não aparece na ementa ` +
  `deste acórdão; a ementa nomeia outra classe ("APELAÇÃO CÍVEL"). ${RESSALVA}`;
const nota = (porque: string) =>
  `a classe informada pelo site é posta em dúvida pelos próprios dados (${porque}): este enquadramento depende dela e ` +
  "pode estar errado (ver avisoDeClasse)";

function site(registro: Record<string, unknown>) {
  return new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async () => respostaJson({ results: [registro] })) as typeof fetch,
  });
}

async function conectar(cliente: Cliente) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
  await criarServidor(cliente, { dados }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  expect(r.isError, r.content[0].text).toBeFalsy();
  return JSON.parse(r.content[0].text);
}

/** A busca_direta e o obter_ementa do mesmo acórdão. */
async function buscaEEmenta(tribunal: string, registro: Record<string, unknown>) {
  const mcp = await conectar(site(registro));
  const busca = await chamar(mcp, "busca_direta", { tribunal, texto: "exemplo" });
  const ementa = await chamar(mcp, "obter_ementa", { id: `${tribunal}:${registro.id}` });
  return { busca, acordao: busca.acordaos[0], ementa };
}

describe("classe da base desmentida pelo acórdão: avisa e continua classificando", () => {
  it("TJMT, órgão no lugar da classe: classe como veio, avisoDeClasse e nota no enquadramento927, na busca e no obter_ementa", async () => {
    const { acordao, ementa } = await buscaEEmenta("tjmt", TJMT);

    for (const a of [acordao, ementa]) {
      expect(a.classe).toBe("TURMA RECURSAL CÍVEL");
      expect(a.avisoDeClasse).toBe(AVISO_TJMT);
      expect(a.enquadramento927.inciso).toBe("não classificado");
      expect(a.enquadramento927.notas).toContain(nota("é nome de órgão julgador"));
    }
  });

  it("TJCE, a ementa nomeia outra classe: aviso B, nota, e o aviso de recurso sem recorrido continua, com a ressalva", async () => {
    const { busca, acordao, ementa } = await buscaEEmenta("tjce", TJCE);

    for (const a of [acordao, ementa]) {
      expect(a.classe).toBe(CLASSE_TJCE);
      expect(a.avisoDeClasse).toBe(AVISO_TJCE);
      expect(a.enquadramento927.notas).toContain(nota('a ementa nomeia "APELAÇÃO CÍVEL"'));
    }
    const recorrido = (busca.avisos as string[]).find((x) => x.startsWith("Recurso contra outro acórdão"));
    expect(recorrido).toContain(CNJ_TJCE);
    expect(recorrido).toContain(
      `A classe de ${CNJ_TJCE} é posta em dúvida pelo próprio acórdão (avisoDeClasse): pode não ser recurso contra outro acórdão.`,
    );
    expect(ementa.avisoRecorrido).toContain(
      "A classe deste acórdão é posta em dúvida pelo próprio acórdão (avisoDeClasse): pode não ser recurso contra outro acórdão.",
    );
  });

  it("agravo interno de verdade (a ementa diz agravo interno): sem avisoDeClasse, sem nota e recorrido sem ressalva", async () => {
    const verdadeiro = {
      ...TJCE,
      texto_ementa: "EMENTA: DIREITO CIVIL. AGRAVO INTERNO EM RECURSO ESPECIAL. APELAÇÃO CÍVEL DE ORIGEM. EXEMPLO. AGRAVO DESPROVIDO.",
    };
    const { busca, acordao, ementa } = await buscaEEmenta("tjce", verdadeiro);

    for (const a of [acordao, ementa]) {
      expect(a.avisoDeClasse).toBeUndefined();
      expect(JSON.stringify(a.enquadramento927)).not.toContain("avisoDeClasse");
    }
    expect(JSON.stringify(busca.avisos)).toContain(CNJ_TJCE);
    expect(JSON.stringify(busca.avisos)).not.toContain("posta em dúvida");
    expect(ementa.avisoRecorrido).not.toContain("posta em dúvida");
  });

  it("classe coerente com o acórdão: nada muda", async () => {
    const { acordao, ementa } = await buscaEEmenta("tjce", { ...TJCE, classe_processual: "Apelação Cível" });

    for (const a of [acordao, ementa]) {
      expect(a.avisoDeClasse).toBeUndefined();
      expect(a.enquadramento927.notas).toEqual([]);
    }
  });
});
