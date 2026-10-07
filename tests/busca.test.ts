import { describe, expect, it } from "vitest";
import { acordaoNaMemoria, buscaDireta, normalizar } from "../src/busca.js";
import { FormatoInesperadoError } from "../src/cliente.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

describe("busca direta", () => {
  it("STF: lê os acórdãos do campo juris e avisa do teto de 4", async () => {
    const { cliente, chamadas } = clienteFalso([respostaJson(fixture("stf-juris.json"))]);
    const r = await buscaDireta(cliente, { tribunal: "STF", texto: "exemplo", limite: 50 });
    expect(r.acordaos.map((a) => a.numero)).toEqual(["RE 100001", "ARE 100002"]);
    expect(r.acordaos[0]).toMatchObject({ orgao: "Tribunal Pleno", dataJulgamento: "2020-03-11" });
    expect(r.avisos.join(" ")).toMatch(/no máximo 4/);
    expect(r.avisos.join(" ")).toMatch(/sem ementa/);
    expect(r.qualificados.map((q) => q.tipo)).toEqual(["súmula vinculante", "repercussão geral"]);
    const corpo = JSON.parse(String(chamadas[0].init.body));
    expect(chamadas[0].url).toMatch(/\/api\/tribunais\/stf\/search$/);
    expect(corpo).toMatchObject({ query: "exemplo", limit: 50, include_rg: true });
  });

  it("STJ sem classe: não quebra, mantém o número e segue a ordem reranqueada", async () => {
    const { cliente } = clienteFalso([respostaJson(fixture("stj-sem-classe.json"))]);
    const r = await buscaDireta(cliente, { tribunal: "stj", texto: "exemplo" });
    expect(r.acordaos.map((a) => a.id)).toEqual(["stj:202", "stj:201"]);
    const semClasse = r.acordaos[1];
    expect(semClasse.numero).toBe("1.000.001/SP");
    expect(semClasse.classe).toBeUndefined();
    expect(semClasse.relevancia).toBe(0.1);
    expect(semClasse.link).toMatch(/num_registro=202000000001/);
    expect(acordaoNaMemoria("stj:201")?.ementa).toMatch(/EXEMPLO FICTÍCIO/);
  });

  it("precedentes qualificados ficam separados dos acórdãos (súmula do reranqueamento não vira acórdão)", () => {
    const r = normalizar("stj", fixture("stj-sem-classe.json"));
    expect(r.acordaos).toHaveLength(2);
    expect(r.qualificados).toEqual([
      {
        tipo: "tema repetitivo",
        numero: "1001",
        texto: "Tese fictícia de tema repetitivo.",
        orgao: "PRIMEIRA SEÇÃO",
        link: "https://processo.stj.jus.br/repetitivos/exemplo",
      },
      {
        tipo: "súmula",
        numero: "2",
        texto: "Enunciado fictício de súmula do STJ.",
        orgao: "PRIMEIRA SEÇÃO",
        link: "https://scon.stj.jus.br/SCON/exemplo",
      },
    ]);
  });

  it("TJGO: acórdão completo com CNJ, classe, câmara, data e link", () => {
    const [a] = normalizar("tjgo", fixture("tjgo.json")).acordaos;
    expect(a).toMatchObject({
      id: "tjgo:301",
      numero: "0000001-11.2025.8.09.0001",
      numeroCnj: "0000001-11.2025.8.09.0001",
      classe: "Apelação Cível",
      orgao: "1ª Câmara Cível",
      dataJulgamento: "2026-03-13",
    });
    expect(a.ementa).toMatch(/^EMENTA/);
    expect(a.link).toMatch(/^https:\/\/projudi/);
  });

  it("formato inesperado vira erro claro, não lista vazia", () => {
    expect(() => normalizar("stj", { mensagem: "outra coisa" })).toThrow(FormatoInesperadoError);
  });

  it("tribunal fora da cobertura é recusado antes de chamar o site", async () => {
    const { cliente, chamadas } = clienteFalso([]);
    await expect(buscaDireta(cliente, { tribunal: "trf1", texto: "x" })).rejects.toThrow(/não é coberto/);
    expect(chamadas).toHaveLength(0);
  });
});
