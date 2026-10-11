import { describe, expect, it } from "vitest";
import { buscaAmpla } from "../src/ampla.js";
import { buscaDireta } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { Memoria } from "../src/memoria.js";
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
});
