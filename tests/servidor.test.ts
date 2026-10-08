import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { Cliente } from "../src/cliente.js";
import { criarServidor } from "../src/servidor.js";
import { respostaJson } from "./apoio.js";

/** O Garimpo inteiro, chamado como o Claude chama: cliente MCP em memória e site falso por trás, sem rede. */
async function conectar(site: Cliente) {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await criarServidor(site).connect(ladoServidor);
  const mcp = new Client({ name: "teste", version: "0" });
  await mcp.connect(ladoCliente);
  return mcp;
}

/** Site falso: responde a toda busca com estes registros no formato do site. */
function siteFalso(registros: unknown[]) {
  return new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async () => respostaJson({ results: registros })) as typeof fetch,
  });
}

describe("servidor MCP", () => {
  it("marca como só leem as buscas, obter ementa e listar tribunais; obter inteiro teor não; as buscas saem para a internet", async () => {
    const mcp = await conectar(siteFalso([]));
    const { tools } = await mcp.listTools();
    const marca = Object.fromEntries(tools.map((t) => [t.name, t.annotations ?? {}]));

    for (const nome of ["busca_direta", "busca_ampla", "obter_ementa", "listar_tribunais"]) {
      expect(marca[nome].readOnlyHint, nome).toBe(true);
    }
    expect(marca.obter_inteiro_teor.readOnlyHint).not.toBe(true);
    expect(marca.busca_direta.openWorldHint).toBe(true);
    expect(marca.busca_ampla.openWorldHint).toBe(true);
    expect(marca.obter_ementa.openWorldHint).toBe(false);
    expect(marca.listar_tribunais.openWorldHint).toBe(false);
  });

  describe("aviso de natureza jurídica", () => {
    const AVISO =
      "Resultado de busca em base não oficial. Confira o acórdão no link oficial do tribunal antes de citar; " +
      "a ementa não substitui o inteiro teor.";
    const acordao = {
      id: "aviso1",
      texto_ementa: "EMENTA FICTÍCIA. Responsabilidade civil do Estado por omissão.",
      numero_processo: "1.000.001/SP",
      orgao_julgador: "Turma Exemplo",
      data_julgamento: "2024-01-02T00:00:00.000Z",
      link_pdf: "https://exemplo.test/aviso1",
    };

    async function chamar(mcp: Client, name: string, args: Record<string, unknown>) {
      const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { isError: r.isError, texto: r.content[0].text };
    }

    it("vem, com o texto exato e em campo próprio, na busca direta, na busca ampla e no obter ementa", async () => {
      const mcp = await conectar(siteFalso([acordao]));
      const direta = await chamar(mcp, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil" });
      const ampla = await chamar(mcp, "busca_ampla", { formulacoes: ["responsabilidade civil"], tribunais: ["stj"] });
      const ementa = await chamar(mcp, "obter_ementa", { id: "stj:aviso1" });

      for (const r of [direta, ampla, ementa]) {
        expect(r.isError).toBeFalsy();
        expect(JSON.parse(r.texto).avisoNaturezaJuridica).toBe(AVISO);
      }
      expect(JSON.parse(direta.texto).acordaos).toHaveLength(1);
      expect(JSON.parse(ampla.texto).acordaos).toHaveLength(1);
      expect(JSON.parse(ementa.texto).ementa).toMatch(/Responsabilidade civil do Estado/);
    });

    it("não vem em listar tribunais, em obter inteiro teor nem nas respostas de erro", async () => {
      const mcp = await conectar(
        new Cliente({
          nome: "O site",
          esperar: async () => {},
          fetch: (async () => {
            throw new Error("site fora do ar");
          }) as typeof fetch,
        }),
      );
      const respostas = [
        await chamar(mcp, "listar_tribunais", {}),
        // STF é só link: devolve o link sem chamar o tribunal, então segue sem rede.
        await chamar(mcp, "obter_inteiro_teor", { tribunal: "stf", link: "https://exemplo.test/stf.pdf" }),
        await chamar(mcp, "obter_ementa", { id: "stj:nunca-buscado" }),
        await chamar(mcp, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil" }),
      ];

      expect(respostas.map((r) => Boolean(r.isError))).toEqual([false, false, true, true]);
      for (const r of respostas) {
        expect(r.texto).not.toMatch(/base não oficial/);
      }
    });
  });
});

describe("erro nunca vira lista vazia (busca ampla)", () => {
  /** Site falso que responde conforme o tribunal e a ordem da chamada. */
  function siteQueResponde(responder: (tribunal: string, n: number) => Response) {
    let n = 0;
    return new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async (url: string) => responder(String(url).match(/tribunais\/(\w+)\/search/)![1], n++)) as typeof fetch,
    });
  }
  const acordao = (id: string) => ({
    id,
    texto_ementa: `EMENTA FICTÍCIA ${id}. Responsabilidade civil.`,
    numero_processo: `${id}/UF`,
    data_julgamento: "2024-01-02T00:00:00.000Z",
    link_pdf: `https://exemplo.test/${id}`,
  });
  // Resposta que o Garimpo não sabe ler: busca com erro que não é recusa.
  const formatoDesconhecido = () => respostaJson({ mensagem: "formato que o Garimpo não conhece" });

  async function ampla(site: Cliente, args: Record<string, unknown>) {
    const mcp = await conectar(site);
    const r = (await mcp.callTool({ name: "busca_ampla", arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: r.isError, texto: r.content[0].text };
  }

  it("todas as buscas com erro comum: responde com erro e o motivo de cada busca, sem lista vazia", async () => {
    const r = await ampla(siteQueResponde(formatoDesconhecido), { formulacoes: ["tese a", "tese b"], tribunais: ["stj", "tjgo"] });

    expect(r.isError).toBe(true);
    for (const busca of ["STJ / formulação 1", "STJ / formulação 2", "TJGO / formulação 1", "TJGO / formulação 2"]) {
      expect(r.texto).toMatch(new RegExp(`${busca}: .*formato`));
    }
    expect(r.texto).toMatch(/^Nenhuma das 4 buscas deu resposta/);
    expect(r.texto).not.toMatch(/base não oficial/);
  });

  it("recusa já na primeira busca, nenhuma feita: responde com erro e a mensagem de recusa", async () => {
    const r = await ampla(siteQueResponde(() => new Response("", { status: 429 })), { formulacoes: ["tese a", "tese b"], tribunais: ["stj"] });

    expect(r.isError).toBe(true);
    expect(r.texto).toMatch(/recusou a chamada duas vezes/);
    expect(r.texto).toMatch(/Espere alguns minutos e tente de novo/);
    expect(r.texto).toMatch(/^Nenhuma das 2 buscas deu resposta/);
    expect(r.texto).not.toMatch(/base não oficial/);
  });

  it("falha parcial: um tribunal deu resposta e o outro só erro → resultado, com o tribunal \"com erro\"", async () => {
    const r = await ampla(
      siteQueResponde((tribunal, n) => (tribunal === "stj" ? respostaJson({ results: [acordao(`ok${n}`)] }) : formatoDesconhecido())),
      { formulacoes: ["tese a", "tese b"], tribunais: ["stj", "tjgo"] },
    );

    expect(r.isError).toBeFalsy();
    const dado = JSON.parse(r.texto);
    expect(dado.acordaos).toHaveLength(2);
    expect(dado.cabecalhoDeCobertura.porTribunal.find((t: { tribunal: string }) => t.tribunal === "tjgo")).toMatchObject({
      comErro: 2,
      situacao: "com erro",
    });
  });

  it("recusa no meio, com alguma busca feita: resultado parcial com o aviso de busca incompleta no topo", async () => {
    const r = await ampla(
      siteQueResponde((_t, n) => (n === 0 ? respostaJson({ results: [acordao("ok")] }) : new Response("", { status: 429 }))),
      { formulacoes: ["tese a", "tese b", "tese c", "tese d"], tribunais: ["stj"] },
    );

    expect(r.isError).toBeFalsy();
    const dado = JSON.parse(r.texto);
    expect(dado.completa).toBe(false);
    expect(dado.acordaos).toHaveLength(1);
    expect(dado.avisos[0]).toMatch(/^BUSCA INCOMPLETA: 1 de 4 buscas/);
  });
});

describe("erros que ensinam e listas como texto", () => {
  /** Site falso que anota cada busca que chegou (tribunal e texto) e devolve um acórdão por busca. */
  function siteQueAnota() {
    const buscas: string[] = [];
    let n = 0;
    const site = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async (url: string, init: RequestInit) => {
        const tribunal = String(url).match(/tribunais\/(\w+)\/search/)![1];
        buscas.push(`${tribunal}: ${JSON.parse(String(init.body)).query}`);
        const id = `a${n++}`;
        return respostaJson({
          results: [{ id, texto_ementa: `EMENTA FICTÍCIA ${id}.`, numero_processo: `${id}/UF`, link_pdf: `https://exemplo.test/${id}` }],
        });
      }) as typeof fetch,
    });
    return { site, buscas };
  }

  async function chamar(site: Cliente, name: string, args: Record<string, unknown>) {
    const mcp = await conectar(site);
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: r.isError, texto: r.content[0].text };
  }

  // Embrulho técnico da validação que o modelo não deve receber.
  const TECNICO = /validation|Invalid|invalid_|"code"|"path"|MCP error/;

  it("tribunal inválido: frase em português com as siglas válidas, sem texto técnico e sem chamar o site", async () => {
    const { site, buscas } = siteQueAnota();
    const respostas = [
      await chamar(site, "busca_direta", { tribunal: "trf9", texto: "responsabilidade civil" }),
      await chamar(site, "busca_ampla", { formulacoes: ["responsabilidade civil"], tribunais: ["stj", "trf9"] }),
      await chamar(site, "obter_inteiro_teor", { tribunal: "trf9", link: "https://exemplo.test/trf9.pdf" }),
    ];

    for (const r of respostas) {
      expect(r.isError).toBe(true);
      expect(r.texto).toMatch(/Tribunal "trf9" não existe no Garimpo/);
      expect(r.texto).toMatch(/stf, stj, .*tjgo/);
      expect(r.texto).not.toMatch(TECNICO);
    }
    expect(buscas).toEqual([]);
  });

  it("data fora do formato: frase \"use AAAA-MM-DD\", sem texto técnico e sem chamar o site", async () => {
    const { site, buscas } = siteQueAnota();
    const respostas = [
      await chamar(site, "busca_direta", { tribunal: "stj", texto: "responsabilidade civil", de: "15/03/2024" }),
      await chamar(site, "busca_ampla", { formulacoes: ["responsabilidade civil"], tribunais: ["stj"], ate: "2024-3-15" }),
    ];

    for (const r of respostas) {
      expect(r.isError).toBe(true);
      expect(r.texto).toMatch(/use AAAA-MM-DD/);
      expect(r.texto).not.toMatch(TECNICO);
    }
    expect(respostas[0].texto).toMatch(/"15\/03\/2024"/);
    expect(buscas).toEqual([]);
  });

  it("formulações e tribunais mandados como texto de lista JSON: a busca roda normalmente", async () => {
    const { site, buscas } = siteQueAnota();
    const r = await chamar(site, "busca_ampla", {
      formulacoes: '["responsabilidade civil", "dano moral"]',
      tribunais: '["stj", "tjgo"]',
    });

    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.texto).acordaos).toHaveLength(4);
    expect(buscas.sort()).toEqual(["stj: dano moral", "stj: responsabilidade civil", "tjgo: dano moral", "tjgo: responsabilidade civil"]);
  });

  it("texto solto vale como um item só, inteiro: nunca parte por vírgula", async () => {
    const { site, buscas } = siteQueAnota();
    const r = await chamar(site, "busca_ampla", { formulacoes: "art. 37, § 6º", tribunais: "stj" });

    expect(r.isError).toBeFalsy();
    expect(buscas).toEqual(["stj: art. 37, § 6º"]);
    expect(JSON.parse(r.texto).cabecalhoDeCobertura.porTribunal).toHaveLength(1);
  });

  it("os limites (até 20 formulações, até 5 tribunais) valem depois da conversão, sem chamar o site", async () => {
    const { site, buscas } = siteQueAnota();
    const vinteEUma = JSON.stringify(Array.from({ length: 21 }, (_, i) => `tese ${i + 1}`));
    const seisTribunais = JSON.stringify(["stf", "stj", "tst", "tse", "stm", "tjgo"]);
    const respostas = [
      await chamar(site, "busca_ampla", { formulacoes: vinteEUma, tribunais: "stj" }),
      await chamar(site, "busca_ampla", { formulacoes: "responsabilidade civil", tribunais: seisTribunais }),
    ];

    for (const r of respostas) expect(r.isError).toBe(true);
    expect(buscas).toEqual([]);
  });
});
