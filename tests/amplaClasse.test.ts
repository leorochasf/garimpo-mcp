import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { respostaJson } from "./apoio.js";

// Ticket 19 da frente dos TJs: o avisoDeClasse do ticket 18 também chega aos itens da busca_ampla, e o aviso amplo de
// recurso sem recorrido leva a ressalva R1. Registros fictícios, na forma vista na base em 2026-10-29 (TJCE: classe de
// agravo interno em recurso especial num acórdão de apelação; TJMT: nome de órgão no lugar da classe).

const CNJ_TJMT = "0000001-11.2021.8.11.0001";
const CNJ_TJCE = "0000002-22.2022.8.06.0001";
const CLASSE_TJCE = "Agravo Interno em Recurso Especial em Apelação Cível";

const tjmt = (cnj = CNJ_TJMT, id = 1) => ({
  id,
  classe_processual: "TURMA RECURSAL CÍVEL",
  orgao_julgador: "TURMA RECURSAL ÚNICA",
  numero_processo_cnj: cnj,
  data_julgamento: "2022-05-05T00:00:00.000Z",
  texto_ementa:
    `Recurso Inominado: ${cnj} Origem: Juizado Especial de Exemplo Recorrente(s): EMPRESA EXEMPLO Recorrido(s): ` +
    "PESSOA FICTÍCIA Juiz Relator: Fulano de Tal Data do Julgamento: 05/05/2022 EMENTA RECURSO INOMINADO – RELAÇÃO DE " +
    `CONSUMO – DANO MORAL – EXEMPLO FICTÍCIO – RECURSO CONHECIDO E PROVIDO. (TJ-MT, RECURSO INOMINADO ${cnj}, ` +
    "Relator(a) FULANO DE TAL, TURMA RECURSAL ÚNICA, Julgado em 05/05/2022, Publicado em 06/05/2022)",
});
const tjce = (cnj = CNJ_TJCE, id = 2, classe = CLASSE_TJCE, extra = "") => ({
  id,
  classe_processual: classe,
  orgao_julgador: "2ª Câmara Direito Privado",
  numero_processo_cnj: cnj,
  data_julgamento: "2024-05-29T00:00:00.000Z",
  texto_ementa:
    "EMENTA: APELAÇÃO CÍVEL. DIREITO CIVIL E CONSUMIDOR. DANO MORAL. CONTRATO DE EXEMPLO. SENTENÇA DE ORIGEM. RECURSO " +
    "CONHECIDO E PROVIDO. ACÓRDÃO Acordam os Desembargadores integrantes da Câmara de Exemplo, unanimemente, em " +
    `conhecer do recurso.${extra} (Apelação Cível - ${cnj}, Rel. Desembargador(a) FULANO DE TAL, 2ª Câmara Direito ` +
    "Privado, data do julgamento: 29/05/2024, data da publicação: 29/05/2024)",
});

// As frases aprovadas no 18 (A, B e R1), literais.
const RESSALVA =
  "O Garimpo a mostra como veio, mas ela pode estar errada, e o que depende dela também (o enquadramento927 e, se " +
  "vier, o aviso de recurso sem recorrido). Confira a classe no inteiro teor.";
const AVISO_TJMT =
  `A classe que o JurisprudênciaIA informa ("TURMA RECURSAL CÍVEL") é nome de órgão julgador, não de classe processual. ${RESSALVA}`;
const AVISO_TJCE =
  `A classe que o JurisprudênciaIA informa ("${CLASSE_TJCE}") começa por "Agravo Interno", que não aparece na ementa ` +
  `deste acórdão; a ementa nomeia outra classe ("APELAÇÃO CÍVEL"). ${RESSALVA}`;
const r1 = (numeros: string) =>
  `A classe de ${numeros} é posta em dúvida pelo próprio acórdão (avisoDeClasse): pode não ser recurso contra outro acórdão.`;

/** Site falso por tribunal: cada busca devolve os registros do tribunal do caminho. */
function site(porTribunal: Record<string, unknown[]>) {
  return new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string) => respostaJson({ results: porTribunal[/\/tribunais\/([a-z0-9]+)\//.exec(String(url))![1]] ?? [] })) as typeof fetch,
  });
}

async function buscaAmpla(cliente: Cliente, args: Record<string, unknown>) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(cliente, { dados: await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-")) }).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  const r = (await mcp.callTool({ name: "busca_ampla", arguments: { formulacoes: ["dano moral"], ...args } })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  expect(r.isError, r.content[0].text).toBeFalsy();
  return { texto: r.content[0].text, r: JSON.parse(r.content[0].text) as Resposta };
}

interface Resposta {
  acordaos: { id: string; avisoDeClasse?: string }[];
  avisos: string[];
  cabecalhoDeCobertura: { listaCortada?: string };
}
const doRecorrido = (r: Resposta) => r.avisos.find((a) => a.startsWith("Recurso contra acórdão sem o recorrido"));

describe("busca ampla: o acórdão de classe duvidosa traz o avisoDeClasse", () => {
  it("TJCE (outra classe na ementa) e TJMT (órgão no lugar da classe): o aviso do 18, literal, no item", async () => {
    const { r } = await buscaAmpla(site({ tjce: [tjce()], tjmt: [tjmt()] }), { tribunais: ["tjce", "tjmt"] });
    const porId = new Map(r.acordaos.map((a) => [a.id, a.avisoDeClasse]));
    expect(porId.get("tjce:2")).toBe(AVISO_TJCE);
    expect(porId.get("tjmt:1")).toBe(AVISO_TJMT);
  });

  it("classe coerente com o acórdão: nenhum avisoDeClasse no item", async () => {
    const { r } = await buscaAmpla(site({ tjce: [tjce(CNJ_TJCE, 2, "Apelação Cível")] }), { tribunais: ["tjce"] });
    expect(r.acordaos).toHaveLength(1);
    expect(r.acordaos[0].avisoDeClasse).toBeUndefined();
  });
});

describe("busca ampla: o aviso de recurso sem recorrido leva a ressalva R1", () => {
  it("o agravo interno de classe duvidosa: o aviso amplo continua, com a R1 e o número", async () => {
    const { r } = await buscaAmpla(site({ tjce: [tjce()] }), { tribunais: ["tjce"] });
    expect(doRecorrido(r)).toMatch(new RegExp(`${r1(CNJ_TJCE).replace(/[.()]/g, "\\$&")}$`));
  });

  it("com mais de um tribunal, os números da R1 vão com a sigla, como no aviso amplo", async () => {
    const cnjMt = "0000003-33.2023.8.11.0001";
    const agravoMt = { ...tjce(cnjMt, 3, "Agravo Interno em Apelação Cível") };
    const { r } = await buscaAmpla(site({ tjce: [tjce()], tjmt: [agravoMt] }), { tribunais: ["tjce", "tjmt"] });
    const aviso = doRecorrido(r)!;
    const numeros = aviso.match(/A classe de (.+) é posta em dúvida/)![1].split(", ").sort();
    expect(numeros).toEqual([`${CNJ_TJCE} (TJCE)`, `${cnjMt} (TJMT)`]);
    expect(aviso).toMatch(/\(avisoDeClasse\): pode não ser recurso contra outro acórdão\.$/);
  });

  it("mais de 3 números de classe duvidosa: o teto do aviso amplo, com «e mais N»", async () => {
    const cnjs = [2, 4, 5, 6, 7].map((n) => `000000${n}-22.2022.8.06.0001`);
    const { r } = await buscaAmpla(site({ tjce: cnjs.map((c, i) => tjce(c, 10 + i)) }), { tribunais: ["tjce"] });
    const aviso = doRecorrido(r)!;
    const mostrados = aviso.match(/A classe de (.+) é posta em dúvida/)![1];
    expect(mostrados).toMatch(/^(\d{7}-\d{2}\.\d{4}\.8\.06\.0001, ){2}\d{7}-\d{2}\.\d{4}\.8\.06\.0001 e mais 2$/);
  });

  it("agravo interno de verdade (a ementa diz agravo interno): o aviso amplo sem a R1", async () => {
    const verdadeiro = {
      ...tjce(),
      texto_ementa:
        "EMENTA: AGRAVO INTERNO EM RECURSO ESPECIAL. DIREITO CIVIL. DANO MORAL. DECISÃO DE ADMISSIBILIDADE MANTIDA. " +
        "AGRAVO INTERNO CONHECIDO E DESPROVIDO.",
    };
    const { r } = await buscaAmpla(site({ tjce: [verdadeiro] }), { tribunais: ["tjce"] });
    expect(r.acordaos[0].avisoDeClasse).toBeUndefined();
    expect(doRecorrido(r)).toBeDefined();
    expect(doRecorrido(r)).not.toContain("avisoDeClasse");
  });
});

// Como no 17: o teto de 25 mil caracteres mede a resposta final inteira (src/ampla.ts, ajustarAoTeto), avisos e itens.
describe("busca ampla com TODOS os itens de classe duvidosa: o teto vale e o corte é dito", () => {
  it("100 acórdãos do TJCE, todos com o aviso B e ementa longa: resposta ≤ 25 mil, todos os mostrados com o aviso, corte declarado", async () => {
    const longa = " Texto fictício de ementa de tamanho realista para o teste do teto.".repeat(40);
    const registros = Array.from({ length: 100 }, (_, i) => tjce(`${String(1000 + i).padStart(7, "0")}-22.2022.8.06.0001`, 1000 + i, CLASSE_TJCE, longa));
    const { texto, r } = await buscaAmpla(site({ tjce: registros }), { tribunais: ["tjce"], maximo: 200 });
    expect(texto.length).toBeLessThanOrEqual(25_000);
    expect(r.acordaos.length).toBeGreaterThan(0);
    expect(r.acordaos.length).toBeLessThan(100);
    for (const item of r.acordaos) expect(item.avisoDeClasse).toBe(AVISO_TJCE);
    expect(r.cabecalhoDeCobertura.listaCortada).toMatch(new RegExp(`^mostrando ${r.acordaos.length} de 100; resposta limitada a cerca de 25 mil caracteres`));
    expect(doRecorrido(r)).toContain("(avisoDeClasse): pode não ser recurso contra outro acórdão.");
  });
});
