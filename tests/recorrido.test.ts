import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buscaAmpla } from "../src/ampla.js";
import { buscaDireta } from "../src/busca.js";
import { Cliente } from "../src/cliente.js";
import { Memoria } from "../src/memoria.js";
import { clienteFalso, fixture, respostaJson } from "./apoio.js";

/** Acórdão fictício do TJTO no formato do site (números no padrão 0000xxx-xx.2020.8.27.0001). */
function tjto(id: number, classe: string | null, cnj: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    texto_ementa: `EMENTA: EXEMPLO FICTÍCIO ${id}.`,
    classe_processual: classe,
    numero_processo: cnj ?? `id-${id}`,
    numero_processo_cnj: cnj,
    orgao_julgador: "GAB. DO RELATOR 1",
    data_julgamento: "2023-12-11T00:00:00.000Z",
    link_pdf: `https://exemplo.test/tjto/${id}`,
    ...extra,
  };
}

const CNJ_A = "0000123-45.2020.8.27.0001";
const CNJ_B = "0000124-11.2020.8.27.0001";

async function direta(registros: unknown[], tribunal = "tjto") {
  const { cliente } = clienteFalso([respostaJson({ results: registros })]);
  return buscaDireta(cliente, { tribunal, texto: "exemplo" });
}

const avisosDeRecorrido = (avisos: string[]) => avisos.filter((a) => /recorrido/.test(a));
const PROIBIDO = /não existe|não está na base/i;

describe("aviso de acórdão recorrido ausente: busca direta", () => {
  it("embargos de declaração sozinho: um aviso com o número, o tribunal e sem afirmar ausência na base", async () => {
    const r = await direta([tjto(1, "Embargos de Declaração Cível", CNJ_A)]);
    const avisos = avisosDeRecorrido(r.avisos);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain(CNJ_A);
    expect(avisos[0]).toMatch(/pode não estar na base do JurisprudênciaIA/);
    expect(avisos[0]).toMatch(/julgamentos_do_processo, pelo número, e confira no portal do TJTO\./);
    expect(avisos[0]).not.toMatch(PROIBIDO);
    expect(r.acordaos[0]).not.toHaveProperty("avisoRecorrido");
  });

  it("embargos e a apelação do mesmo número (com ou sem máscara): sem aviso", async () => {
    const r = await direta([
      tjto(1, "Embargos de Declaração", CNJ_A),
      tjto(2, "Apelação Cível", CNJ_A.replace(/\D/g, "")),
    ]);
    expect(avisosDeRecorrido(r.avisos)).toEqual([]);
  });

  it("dois embargos do mesmo número, sem o mérito: aviso com o número uma vez só", async () => {
    const r = await direta([tjto(1, "Embargos de Declaração", CNJ_A), tjto(2, "Embargos de Declaração", CNJ_A)]);
    const [aviso] = avisosDeRecorrido(r.avisos);
    expect(aviso.split(CNJ_A)).toHaveLength(2);
  });

  it("acórdão sem número CNJ (estilo STJ): sem aviso", async () => {
    const base = fixture("stj-sem-classe.json") as { results: Record<string, unknown>[] };
    const r = await direta([{ ...base.results[0], numero_processo: "1.000.001/SP", sigla_classe: "EDcl" }], "stj");
    expect(r.acordaos[0].numero).toMatch(/^EDcl/);
    expect(avisosDeRecorrido(r.avisos)).toEqual([]);
  });

  it.each([
    ["Agravo Interno Cível", {}],
    ["Embargos Infringentes", {}],
    ["Embargos de Divergência em Recurso Especial", {}],
    ["Agravo Regimental", {}],
    [null, { sigla_classe: "AgRg", numero_processo: `AgRg no REsp ${CNJ_A}` }],
    [null, { sigla_classe: "EDcl" }],
  ])("classe %s avisa", async (classe, extra) => {
    const r = await direta([tjto(1, classe, CNJ_A, extra)]);
    expect(avisosDeRecorrido(r.avisos)).toHaveLength(1);
  });

  it.each(["Agravo em Recurso Especial", "Agravo de Instrumento", "Apelação Cível"])("classe %s não avisa", async (classe) => {
    const r = await direta([tjto(1, classe, CNJ_A)]);
    expect(avisosDeRecorrido(r.avisos)).toEqual([]);
  });

  it("mais de 10 números: os 10 primeiros, na ordem, e \"e mais N\"", async () => {
    const numeros = Array.from({ length: 13 }, (_, i) => `00001${String(i).padStart(2, "0")}-11.2020.8.27.0001`);
    const r = await direta(numeros.map((n, i) => tjto(i, "Embargos de Declaração", n)));
    const [aviso] = avisosDeRecorrido(r.avisos);
    expect(aviso).toContain(`${numeros.slice(0, 10).join(", ")} e mais 3`);
    expect(aviso).not.toContain(numeros[10]);
  });

  it("busca guardada: repetida da memória, o aviso aparece uma vez, não duas", async () => {
    const { cliente } = clienteFalso([respostaJson({ results: [tjto(1, "Embargos de Declaração", CNJ_A)] })]);
    const memoria = new Memoria({ dados: await mkdtemp(join(process.env.GARIMPO_DADOS!, "recorrido-")) });
    const p = { tribunal: "tjto", texto: "exemplo" };
    await buscaDireta(cliente, p, memoria);
    const r = await buscaDireta(cliente, p, memoria);
    expect(r.buscaGuardada).toBeDefined();
    expect(avisosDeRecorrido(r.avisos)).toHaveLength(1);
  });
});

/** Site da busca ampla: responde por tribunal e formulação. */
function siteAmplo(responder: (tribunal: string, texto: string) => unknown[] | object) {
  return new Cliente({
    nome: "O site",
    esperar: async () => {},
    fetch: (async (url: string, init: RequestInit) => {
      const tribunal = String(url).match(/tribunais\/(\w+)\/search/)![1];
      const corpo = responder(tribunal, JSON.parse(String(init.body)).query);
      return respostaJson(Array.isArray(corpo) ? { results: corpo } : corpo);
    }) as typeof fetch,
  });
}

describe("aviso de acórdão recorrido ausente: busca ampla", () => {
  it("recorrido achado mas cortado pelo máximo: sem aviso", async () => {
    const cliente = siteAmplo(() => [
      tjto(1, "Embargos de Declaração", CNJ_A, { texto_ementa: "EMENTA: exemplo ficticio exemplo." }),
      tjto(2, "Apelação Cível", CNJ_A, { texto_ementa: "EMENTA: outra coisa." }),
    ]);
    const r = await buscaAmpla(cliente, { formulacoes: ["exemplo ficticio"], tribunais: ["tjto"], maximo: 1 });
    expect(r.acordaos.map((a) => a.id)).toEqual(["tjto:1"]);
    expect(avisosDeRecorrido(r.avisos)).toEqual([]);
  });

  it("recorrido só em outra formulação: sem aviso", async () => {
    const cliente = siteAmplo((_t, texto) =>
      texto === "primeira" ? [tjto(1, "Embargos de Declaração", CNJ_A)] : [tjto(2, "Apelação Cível", CNJ_A)],
    );
    const r = await buscaAmpla(cliente, { formulacoes: ["primeira", "segunda"], tribunais: ["tjto"] });
    expect(avisosDeRecorrido(r.avisos)).toEqual([]);
  });

  it("embargos em dois tribunais: números com sigla e o fim que sugere julgamentos_do_processo, uma vez só", async () => {
    const cliente = siteAmplo((t) =>
      t === "tjto"
        ? [tjto(1, "Embargos de Declaração", CNJ_A)]
        : [{ ...tjto(2, "Embargos de Declaração", "0000124-11.2020.8.09.0001"), id: 2 }],
    );
    const r = await buscaAmpla(cliente, { formulacoes: ["a", "b"], tribunais: ["tjto", "tjgo"] });
    const avisos = avisosDeRecorrido(r.avisos);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain(`${CNJ_A} (TJTO)`);
    expect(avisos[0]).toContain("0000124-11.2020.8.09.0001 (TJGO)");
    expect(avisos[0]).toMatch(/julgamentos_do_processo/);
    expect(avisos[0]).not.toMatch(PROIBIDO);
  });

  it("um tribunal só: sem sigla nos números", async () => {
    const cliente = siteAmplo(() => [tjto(1, "Embargos de Declaração", CNJ_A), tjto(2, "Agravo Interno", CNJ_B)]);
    const [aviso] = avisosDeRecorrido((await buscaAmpla(cliente, { formulacoes: ["a"], tribunais: ["tjto"] })).avisos);
    expect(aviso).toContain(`${CNJ_A}, ${CNJ_B}`);
    expect(aviso).toMatch(/julgamentos_do_processo/);
  });

  it("50 embargos mostrados, sem recorrido, e 10 qualificados: aviso uma vez, 3 números e \"e mais 47\", < 25 mil", async () => {
    const link = (i: number) =>
      `https://jurisprudencia.tribunal-exemplo.invalid/consulta/inteiro-teor/documento?id=${String(i).padStart(10, "0")}`;
    const cliente = siteAmplo((tribunal, texto) => ({
      results: Array.from({ length: 100 }, (_, i) => {
        // Número distinto por tribunal, formulação e posição: nenhum recorrido em lugar nenhum.
        const cnj = `${String(i).padStart(3, "0")}${texto.length}${tribunal.length}0-11.2024.8.21.0001`;
        return {
          id: `${tribunal}${texto.length}${String(i).padStart(9, "0")}`,
          texto_ementa:
            `EMENTA: EMBARGOS DE DECLARAÇÃO. EXEMPLO FICTÍCIO ${i}. ${"Texto fictício de ementa. ".repeat(75)}` +
            `DANO MORAL COLETIVO RECONHECIDO. ${"Texto fictício de ementa. ".repeat(75)}`,
          classe_processual: "Embargos de Declaração Cível",
          sigla_classe: "ED",
          numero_processo: cnj,
          numero_processo_cnj: cnj,
          orgao_julgador: "Décima Segunda Câmara Cível",
          data_julgamento: "2024-01-02T00:00:00.000Z",
          link_pdf: link(i),
        };
      }),
      rg: Array.from({ length: 30 }, (_, i) => ({
        numero: 1000 + i,
        tese_firmada: "Tese fictícia de repercussão geral, longa como as reais. ".repeat(80),
        orgao_julgador: "Tribunal Pleno",
        numero_processo_paradigma: `RE ${1_000_000 + i}`,
        link: link(900 + i),
      })),
    }));
    const r = await buscaAmpla(cliente, {
      formulacoes: ["dano moral coletivo", "dano moral difuso", "dano moral transindividual"],
      tribunais: ["tjrs", "stj"],
    });
    expect(r.acordaos).toHaveLength(50);
    expect(r.qualificados).toHaveLength(10);
    const avisos = avisosDeRecorrido(r.avisos);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/ e mais 47\./);
    expect(avisos[0].match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g)).toHaveLength(3);
    expect(JSON.stringify(r).length).toBeLessThan(25_000);
  });
});
