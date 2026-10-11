import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buscaAmpla } from "../src/ampla.js";
import { buscaDireta } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { Memoria } from "../src/memoria.js";
import { criarServidor } from "../src/servidor.js";
import { avisoDeLinkDoTjgo } from "../src/tribunais.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

const LINK = "https://projudi.tjgo.jus.br/ConsultaJurisprudencia?PaginaAtual=78&Id_Arquivo=999001";

describe("link do Projudi do TJGO", () => {
  it("avisa uma vez, com o endereço público da pesquisa, quando algum link é do Projudi", () => {
    const avisos = avisoDeLinkDoTjgo([{ link: LINK }, { link: LINK.replace("999001", "999002") }, { link: "https://exemplo.test/x" }]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/Sem Permissão/);
    expect(avisos[0]).toMatch(/número do processo/);
    expect(avisos[0]).toContain("https://projudi.tjgo.jus.br/ConsultaJurisprudencia");
  });

  it("traz o passo a passo público e o número CNJ do resultado já escrito", () => {
    const cnj = "0000001-02.2024.8.09.0001";
    const [aviso] = avisoDeLinkDoTjgo([{ link: LINK, numeroCnj: cnj }]);
    expect(aviso).toContain("https://projudi.tjgo.jus.br/ConsultaJurisprudencia");
    expect(aviso).toContain(cnj);
    expect(aviso).toMatch(/sem login/);
    expect(aviso).toMatch(/Número do Processo/);
    expect(aviso).toMatch(/anti-robô \(Cloudflare\)/);
    expect(aviso).toMatch(/procure pelo número/);
    expect(aviso).not.toMatch(/reCAPTCHA|@|\?ProcessoNumero/);
  });

  it("com vários resultados do TJGO, não repete o aviso nem lista os números: manda usar o de cada resultado", () => {
    const avisos = avisoDeLinkDoTjgo([
      { link: LINK, numeroCnj: "0000001-02.2024.8.09.0001" },
      { link: LINK.replace("999001", "999002"), numeroCnj: "0000003-04.2024.8.09.0002" },
    ]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/de cada resultado do TJGO/);
    expect(avisos[0]).not.toContain("0000001-02.2024.8.09.0001");
  });

  it("o CNJ de resultado que não é do Projudi não entra no aviso", () => {
    const [aviso] = avisoDeLinkDoTjgo([
      { link: "https://exemplo.test/x", numeroCnj: "0000009-09.2024.8.26.0001" },
      { link: LINK, numeroCnj: "0000001-02.2024.8.09.0001" },
    ]);
    expect(aviso).toContain("0000001-02.2024.8.09.0001");
    expect(aviso).not.toContain("0000009-09");
  });

  it("não avisa quando nenhum link é do Projudi", () => {
    expect(avisoDeLinkDoTjgo([{ link: "https://exemplo.test/x" }, { linkConsulta: "https://outro.test/y" }, {}])).toEqual([]);
  });

  it("busca direta no TJGO traz o aviso", async () => {
    const { cliente } = clienteFalso([respostaJson(fixture("tjgo.json"))]);
    const r = await buscaDireta(cliente, { tribunal: "tjgo", texto: "exemplo" }, new Memoria());
    expect(r.avisos.filter((a) => /Sem Permissão/.test(a))).toHaveLength(1);
  });

  it("busca ampla traz o aviso uma só vez, mesmo com vários acórdãos do Projudi", async () => {
    const cliente = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async () =>
        respostaJson({
          results: [1, 2, 3].map((i) => ({
            id: `p${i}`,
            texto_ementa: `DANO MORAL COLETIVO. EXEMPLO FICTÍCIO ${i}.`,
            numero_processo: `${i}/GO`,
            link_pdf: LINK.replace("999001", `99900${i}`),
            rerank_score: 0.5,
          })),
        })) as unknown as typeof fetch,
    });
    const r = await buscaAmpla(cliente, { formulacoes: ["dano moral coletivo"], tribunais: ["tjgo"] });
    expect(r.acordaos).toHaveLength(3);
    expect(r.avisos.filter((a) => /Sem Permissão/.test(a))).toHaveLength(1);
  });

  it("busca ampla com um só resultado do TJGO que tem CNJ: o aviso traz o número", async () => {
    const cnj = "0000001-11.2025.8.09.0001";
    const cliente = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async () =>
        respostaJson({
          results: [
            {
              id: "g1",
              texto_ementa: "DANO MORAL COLETIVO. EXEMPLO FICTÍCIO.",
              numero_processo: cnj,
              numero_processo_cnj: cnj,
              link_pdf: LINK,
              rerank_score: 0.5,
            },
          ],
        })) as unknown as typeof fetch,
    });
    const r = await buscaAmpla(cliente, { formulacoes: ["dano moral coletivo"], tribunais: ["tjgo"] });
    const avisos = r.avisos.filter((a) => /Sem Permissão/.test(a));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain(cnj);
  });

  it("busca ampla: o aviso vale para o que sobra depois do corte por tamanho (sem TJGO sobrando, sem aviso)", async () => {
    const longo = "x".repeat(400);
    const site = (linkTjgo: string, scoreTjgo: number) =>
      new Cliente({
        nome: "O site",
        esperar: async () => {},
        fetch: (async (url: string, init: RequestInit) => {
          const tjgo = /tribunais\/tjgo\//.test(String(url));
          const texto = JSON.parse(String(init.body)).query as string;
          // O acórdão do TJGO só aparece numa formulação; os do STJ, nas duas: no mesmo nível, o do TJGO fica no fim.
          const itens = tjgo
            ? texto === "dano moral"
              ? [{ id: "g1", texto_ementa: "DANO MORAL. FICTÍCIO TJGO.", numero_processo: "1/GO", link_pdf: linkTjgo, rerank_score: scoreTjgo }]
              : []
            : Array.from({ length: 50 }, (_, i) => ({
                id: `s${i}`,
                texto_ementa: `DANO MORAL. FICTÍCIO STJ ${i}. ${longo}`,
                numero_processo: `${i}/DF`,
                orgao_julgador: "Turma Exemplo ".repeat(10),
                link_pdf: `https://exemplo.test/${i}/${longo}`,
                rerank_score: 0.9,
              }));
          return respostaJson({ results: itens });
        }) as unknown as typeof fetch,
      });
    const pedido = { formulacoes: ["dano moral", "dano moral coletivo"], tribunais: ["stj", "tjgo"], maximo: 200 };

    const cortado = await buscaAmpla(site(LINK, 0.1), pedido);
    expect(cortado.cabecalhoDeCobertura.listaCortada).toMatch(/25 mil caracteres/);
    expect(cortado.acordaos.some((a) => a.tribunal === "tjgo")).toBe(false);
    expect(cortado.avisos.filter((a) => /Sem Permissão/.test(a))).toHaveLength(0);
  });

  it("busca ampla: sobrou acórdão do TJGO depois do corte, o aviso fica", async () => {
    const cliente = new Cliente({
      nome: "O site",
      esperar: async () => {},
      fetch: (async (url: string) => {
        const tjgo = /tribunais\/tjgo\//.test(String(url));
        const itens = tjgo
          ? [{ id: "g1", texto_ementa: "DANO MORAL. FICTÍCIO TJGO.", numero_processo: "1/GO", link_pdf: LINK, rerank_score: 0.9 }]
          : Array.from({ length: 50 }, (_, i) => ({
              id: `s${i}`,
              texto_ementa: `DANO MORAL. FICTÍCIO STJ ${i}. ${"x".repeat(400)}`,
              numero_processo: `${i}/DF`,
              link_pdf: `https://exemplo.test/${i}/${"x".repeat(400)}`,
              rerank_score: 0.5,
            }));
        return respostaJson({ results: itens });
      }) as unknown as typeof fetch,
    });
    const r = await buscaAmpla(cliente, { formulacoes: ["dano moral"], tribunais: ["stj", "tjgo"], maximo: 200 });
    expect(r.acordaos.some((a) => a.tribunal === "tjgo")).toBe(true);
    expect(r.avisos.filter((a) => /Sem Permissão/.test(a))).toHaveLength(1);
  });
});

describe("obter_ementa com acórdão do TJGO", () => {
  async function ementaDe(fixtureNome: string, tribunal: string, id: string) {
    const { cliente } = clienteFalso([respostaJson(fixture(fixtureNome))]);
    const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
    await criarServidor(cliente, { dados: process.env.GARIMPO_DADOS! }).connect(ladoServidor);
    const mcp = new Client({ name: "teste", version: "0" });
    await mcp.connect(ladoCliente);
    const chamar = async (name: string, args: Record<string, unknown>) =>
      JSON.parse(((await mcp.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0].text);
    const busca = await chamar("busca_direta", { tribunal, texto: "exemplo" });
    return chamar("obter_ementa", { id: busca.acordaos[0].id ?? id });
  }

  it("traz o aviso do link do Projudi uma vez", async () => {
    const e = await ementaDe("tjgo.json", "tjgo", "tjgo:301");
    expect(JSON.stringify(e).match(/Sem Permissão/g) ?? []).toHaveLength(1);
  });
});
