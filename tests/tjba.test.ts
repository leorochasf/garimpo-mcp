import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Acordao } from "../src/busca.js";
import { Cliente, USER_AGENT } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { lerTextoIntegral } from "../src/leitura.js";
import { Memoria } from "../src/memoria.js";
import { criarServidor } from "../src/servidor.js";
import { infoTribunal } from "../src/tribunais.js";
import { clienteFalso, respostaJson } from "./apoio.js";

// Ticket 04 (TJBA completo, ADR-0034): a página do link é o próprio documento da decisão em HTML, aberta, sem login.
// Fixtures: recortes saneados da estrutura das páginas gravadas em 2026-10-29 (Turma Recursal e Câmara Cível), com
// texto, partes e números fictícios.

const UUID = "0f3b6a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
const LINK = `https://jurisprudenciaws.tjba.jus.br/inteiroTeor/${UUID}`;
const CNJ_TURMA = "0000001-11.2025.8.05.0001";
const CNJ_CAMARA = "0000002-22.2013.8.05.0001";
const TURMA = readFileSync(new URL("./fixtures/tjba-turma-recursal.html", import.meta.url), "utf8");
const CAMARA = readFileSync(new URL("./fixtures/tjba-camara-civel.html", import.meta.url), "utf8");
const ROTULO = "portal de jurisprudência do TJBA (jurisprudenciaws.tjba.jus.br)";

/** Como o portal respondeu na gravação: `text/html` sem charset. */
const pagina = (html: string) => () => new Response(html, { headers: { "content-type": "text/html" } });

function memoriaComAcordao(sobre: Partial<Acordao> = {}) {
  const memoria = new Memoria();
  const acordao = {
    id: "tjba:5448",
    tribunal: "tjba",
    numero: CNJ_TURMA,
    numeroCnj: CNJ_TURMA,
    semNumero: false,
    ementa: "RECURSO INOMINADO. EMENTA FICTÍCIA DO TJBA PARA TESTE.",
    link: LINK,
    ...sobre,
  } as Acordao;
  memoria.lembrar([{ ids: [acordao.id], registro: acordao }]);
  return memoria;
}

async function obter(memoria: Memoria, respostas: Parameters<typeof clienteFalso>[0], id = "tjba:5448") {
  const { cliente, chamadas } = clienteFalso(respostas);
  const r = await obterInteiroTeor({ id }, () => cliente, memoria);
  expect(r.baixado).toBe(false);
  return { explicacao: r.baixado ? "" : r.explicacao, chamadas, texto: (await memoria.obterTexto(id))?.texto };
}

describe("TJBA: texto do portal do tribunal pela página do link (molde «página com íntegra»)", () => {
  it("o tribunal é marcado como texto do portal", () => {
    expect(infoTribunal("tjba")?.inteiroTeor).toBe("portal");
    expect(infoTribunal("tjba")?.motivoLink).toBeUndefined();
  });

  it("Turma Recursal: uma chamada (UA honesto, sem seguir redirecionamento), guarda o documento e lê com o rótulo do TJBA", async () => {
    const memoria = memoriaComAcordao();
    const { chamadas, texto, explicacao } = await obter(memoria, [pagina(TURMA)]);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(LINK);
    expect(chamadas[0].init.redirect).toBe("manual");
    expect(new Headers(chamadas[0].init.headers).get("user-agent")).toBe(USER_AGENT);
    expect(explicacao).toMatch(/ler_inteiro_teor com o id tjba:5448/);
    expect(texto).toMatch(/^Tribunal de Justiça do Estado da Bahia/);
    expect(texto).toMatch(/PROCESSO Nº 0000001-11\.2025\.8\.05\.0001/);
    expect(texto).toMatch(/Ante o exposto, voto por DAR PROVIMENTO AO RECURSO fictício para reformar a sentença\./);

    const lida = await lerTextoIntegral("tjba:5448", 1, memoria);
    expect(lida.cabecalho.fonte).toBe(ROTULO);
    expect(lida.cabecalho.natureza).toBe(
      "texto do portal do tribunal (TJBA), convertido de HTML pelo Garimpo: não é PDF e não tem recibo de origem",
    );
  });

  it("Câmara Cível: relatório e voto vêm; as imagens data: embutidas ficam fora do texto", async () => {
    const memoria = memoriaComAcordao({ id: "tjba:645551", numero: CNJ_CAMARA, numeroCnj: CNJ_CAMARA });
    const { texto } = await obter(memoria, [pagina(CAMARA)], "tjba:645551");
    expect(texto).toMatch(/^PODER JUDICIÁRIO/);
    expect(texto).toMatch(/Processo: APELAÇÃO CÍVEL n\. 0000002-22\.2013\.8\.05\.0001/);
    expect(texto).toMatch(/RELATÓRIO[\s\S]*VOTO[\s\S]*É como voto\./);
    expect(texto).not.toMatch(/data:|base64|iVBOR/);
  });

  it("uuid com os dígitos hexadecimais em maiúsculas é o mesmo documento (como na junção das cópias)", async () => {
    const memoria = memoriaComAcordao({ link: LINK.replace(UUID, UUID.toUpperCase()) });
    const { chamadas, texto } = await obter(memoria, [pagina(TURMA)]);
    expect(chamadas).toHaveLength(1);
    expect(texto).toMatch(/^Tribunal de Justiça do Estado da Bahia/);
  });
});

describe("TJBA: as guardas do molde valem", () => {
  it.each([
    ["sem https", LINK.replace("https:", "http:")],
    ["outro host", LINK.replace("jurisprudenciaws.", "www.")],
    ["caminho em outra caixa", LINK.replace("/inteiroTeor/", "/INTEIROTEOR/")],
    ["sem o uuid", "https://jurisprudenciaws.tjba.jus.br/inteiroTeor/123"],
  ])("link %s: recusa antes de chamar o portal", async (_, link) => {
    const { chamadas, texto, explicacao } = await obter(memoriaComAcordao({ link }), [pagina(TURMA)]);
    expect(chamadas).toHaveLength(0);
    expect(texto).toBeUndefined();
    expect(explicacao).toMatch(/o link não aponta para um documento do portal do tribunal/);
  });

  it("sem número CNJ na busca: recusa sem chamar o portal", async () => {
    const { chamadas, explicacao } = await obter(memoriaComAcordao({ numeroCnj: undefined }), [pagina(TURMA)]);
    expect(chamadas).toHaveLength(0);
    expect(explicacao).toMatch(/a busca não trouxe o número CNJ do acórdão/);
  });

  it("página de outro processo que o da busca: nada guardado", async () => {
    const outro = "0000009-99.2025.8.05.0001";
    const { texto, explicacao } = await obter(memoriaComAcordao({ numeroCnj: outro, numero: outro }), [pagina(TURMA)]);
    expect(texto).toBeUndefined();
    expect(explicacao).toMatch(/a página é de outro processo que o da busca/);
  });

  // Revisão do 04 (B04-R01): o número do processo só vale no cabeçalho, antes da primeira seção do documento; uma
  // citação «processo <CNJ>» no voto nunca vira a identidade da página.
  it("B04-R01: cabeçalho sem o número e o CNJ da busca citado no voto: nada guardado", async () => {
    const semNumero = TURMA.replace(`PROCESSO N&ordm; ${CNJ_TURMA}`, "PROCESSO N&ordm; IDENTIFICADOR AUSENTE").replace(
      "<p dir=\"ltr\" style=\"line-height:1.38;margin-top:0pt;margin-bottom:0pt;text-align:center;\"><span style=\"font-size:12pt;font-family:Arial,sans-serif;white-space:pre-wrap;\">Relatora</span></p>",
      `<p>Precedente citado no voto: processo ${CNJ_TURMA}.</p><p>Relatora</p>`,
    );
    expect(semNumero).not.toContain(`PROCESSO N&ordm; ${CNJ_TURMA}`);
    expect(semNumero).toContain(`Precedente citado no voto: processo ${CNJ_TURMA}.`);
    const { texto, explicacao } = await obter(memoriaComAcordao(), [pagina(semNumero)]);
    expect(texto).toBeUndefined();
    expect(explicacao).toMatch(/a página não mostra o número do processo/);
  });

  it("B04-R01: dois números diferentes no cabeçalho (ambíguo): nada guardado", async () => {
    const dois = TURMA.replace(
      `PROCESSO N&ordm; ${CNJ_TURMA}`,
      `PROCESSO N&ordm; ${CNJ_TURMA} (PROCESSO DE ORIGEM 0000009-99.2024.8.05.0001)`,
    );
    const { texto, explicacao } = await obter(memoriaComAcordao(), [pagina(dois)]);
    expect(texto).toBeUndefined();
    expect(explicacao).toMatch(/a página não mostra o número do processo/);
  });

  it("página de aviso do portal, sem o documento do tribunal: nada guardado", async () => {
    const aviso = "<html><body><h1>Documento não encontrado</h1><p>Verifique o endereço.</p></body></html>";
    const { texto, explicacao } = await obter(memoriaComAcordao(), [pagina(aviso)]);
    expect(texto).toBeUndefined();
    expect(explicacao).toMatch(/a página não traz a íntegra do documento do link/);
  });

  it("erro em JSON do portal: nada guardado", async () => {
    const { texto, explicacao } = await obter(memoriaComAcordao(), [() => respostaJson({ erro: "não encontrado" })]);
    expect(texto).toBeUndefined();
    expect(explicacao).toMatch(/o portal não respondeu com uma página HTML de tamanho normal/);
  });
});

describe("TJBA pela interface MCP: busca, inteiro teor, leitura, conferência e listar_tribunais", () => {
  async function conectar(site: Cliente, portal: Cliente) {
    const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
    const dados = await mkdtemp(join(process.env.GARIMPO_DADOS!, "janela-"));
    await criarServidor(site, { dados, tribunais: () => portal }).connect(ladoServidor);
    const mcp = new Client({ name: "teste", version: "0" });
    await mcp.connect(ladoCliente);
    return mcp;
  }
  async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError, r.content[0].text).toBeFalsy();
    return JSON.parse(r.content[0].text);
  }

  it("a citação literal do voto é encontrada no texto do portal do TJBA", async () => {
    const site = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async () =>
        respostaJson({
          results: [
            {
              id: 5448,
              texto_ementa: "EMENTA: RECURSO INOMINADO. CONSUMIDOR. EXEMPLO FICTÍCIO PARA TESTE DO PORTAL.",
              link_pdf: LINK,
              data_julgamento: "2025-01-27T00:00:00.000Z",
              classe_processual: "Recurso Inominado",
              numero_processo: CNJ_TURMA,
              numero_processo_cnj: CNJ_TURMA,
              relator: "JUÍZA FICTÍCIA",
              orgao_julgador: "Turma Recursal Fictícia",
              score: 1,
            },
          ],
        })) as typeof fetch,
    });
    const { cliente: portal, chamadas } = clienteFalso([pagina(TURMA)]);
    const mcp = await conectar(site, portal);

    const busca = await chamar(mcp, "busca_direta", { tribunal: "tjba", texto: "dano moral", limite: 3 });
    const id = busca.acordaos[0].id;
    expect((await chamar(mcp, "obter_inteiro_teor", { id })).explicacao).toMatch(/texto do portal do tribunal/);
    expect(chamadas).toHaveLength(1);
    expect((await chamar(mcp, "ler_inteiro_teor", { id })).cabecalho.fonte).toBe(ROTULO);

    const citacao = "voto por DAR PROVIMENTO AO RECURSO fictício para reformar a sentença";
    const conferida = await chamar(mcp, "conferir_citacao", { citacoes: [{ citacao, id }] });
    const noTexto = conferida.resultados[0].fontes.find((f: { fonte: string }) => f.fonte === "texto integral");
    expect(noTexto.veredito).toBe("encontrado literalmente");

    const tribunais = await chamar(mcp, "listar_tribunais", {});
    expect(tribunais.find((t: { tribunal: string }) => t.tribunal === "tjba").inteiroTeor).toBe("portal");
  });
});
