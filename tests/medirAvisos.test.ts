import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ErroDeProtocolo,
  medir,
  montar,
  relatorio,
  SINAIS,
  SINAIS_DE_PASSAGEM,
  type Item,
  type Sinal,
} from "../scripts/medirAvisos.js";
import { pdfComDispositivoECertidao, pdfComSinaisDeAutoria, pdfUnanimeComDivergencia } from "./pdfSintetico.js";

let pasta: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-medicao-"));
});
afterEach(() => rm(pasta, { recursive: true, force: true }));

// Citações no PDF de 05: cada uma vem logo depois da marca do seu sinal.
const CITACAO = {
  negacao: "se admite a tese de que o negocio generico e nulo por vicio de forma",
  alegacaoDaParte: "o prazo generico seria decenal e que a sentenca violou a lei",
  ementaTranscrita: "A prescricao da pretensao generica ocorre em tres anos",
  divergencia: "para negar provimento, por entender valido o negocio generico",
  raciocinioHipotetico: "o resultado seria o mesmo, pois o prazo ja estaria vencido",
} as const;
const LIMPA = "Ha divergencia na jurisprudencia sobre o tema, mas nao neste colegiado";

const ITENS: Item[] = [
  ...SINAIS_DE_PASSAGEM.map((sinal): Item => ({
    id: `s-${sinal}`,
    pdf: "autoria.pdf",
    conjunto: sinal === "divergencia" || sinal === "raciocinioHipotetico" ? "validacao" : "ajuste",
    citacao: CITACAO[sinal],
  })),
  { id: "limpa", pdf: "unanime.pdf", conjunto: "ajuste", citacao: LIMPA },
  { id: "orgao-igual", pdf: "fecho.pdf", conjunto: "ajuste", tribunal: "trt1", orgaoDoRegistro: "3ª Câmara Cível" },
  { id: "orgao-outro", pdf: "fecho.pdf", conjunto: "ajuste", tribunal: "trt1", orgaoDoRegistro: "5ª Câmara Cível" },
];

/** Verdade do rotulador: o sinal do item vale (e só ele); "orgao-outro" diverge de verdade. */
function verdade(item: Item, sinal: Sinal): boolean {
  return item.id === `s-${sinal}` || (item.id === "orgao-outro" && sinal === "orgaoDoFecho");
}

function formulario(itens: Item[], muda: (id: string, sinal: Sinal, valor: boolean) => boolean = (_i, _s, v) => v) {
  const rotulos: Record<string, Record<string, boolean>> = {};
  for (const item of itens) {
    const sinais = item.citacao ? SINAIS_DE_PASSAGEM : [];
    rotulos[item.id] = Object.fromEntries(
      [...sinais, ...(item.tribunal ? (["orgaoDoFecho"] as const) : [])].map((s) => [s, muda(item.id, s, verdade(item, s))]),
    );
  }
  return { rotulos };
}

async function gravar(
  itens: Item[] = ITENS,
  b: ReturnType<typeof formulario> | null = formulario(itens, (id, s, v) => (id === "s-negacao" && s === "negacao" ? !v : v)),
) {
  await writeFile(join(pasta, "autoria.pdf"), pdfComSinaisDeAutoria());
  await writeFile(join(pasta, "unanime.pdf"), pdfUnanimeComDivergencia());
  await writeFile(join(pasta, "fecho.pdf"), pdfComDispositivoECertidao(3));
  await writeFile(join(pasta, "amostra.json"), JSON.stringify({ itens }));
  await writeFile(join(pasta, "rotulos-a.json"), JSON.stringify(formulario(itens)));
  if (b) await writeFile(join(pasta, "rotulos-b.json"), JSON.stringify(b));
}

const de = (m: Awaited<ReturnType<typeof medir>>, sinal: Sinal, conjunto: "ajuste" | "validacao") =>
  m.numeros.find((n) => n.sinal === sinal && n.conjunto === conjunto)!;

describe("medirAvisos — os três números por sinal", () => {
  it("conta acerto quando avisa, alcance e falso aviso em frase limpa, com a concordância dos dois rotuladores", async () => {
    await gravar();
    const m = await medir(pasta);

    // Órgão do fecho: o registro "5ª" avisa (acerto), o "3ª" não avisa (frase limpa).
    const orgao = de(m, "orgaoDoFecho", "ajuste");
    expect([orgao.acertos, orgao.falsosAvisos, orgao.perdidos, orgao.limpos]).toEqual([1, 0, 0, 1]);

    // Negação: os rotuladores discordam do item "s-negacao" e não há desempate → fora dos números, dentro da concordância.
    const negacao = de(m, "negacao", "ajuste");
    expect(negacao.semConsenso).toBe(1);
    expect(negacao.concordancia).toMatchObject({ itens: 4, iguais: 3 });
    expect(negacao.avaliados).toBe(3);

    // Divergência (validação): avisa na passagem do voto divergente (acerto) e também na que vem depois dele, sem
    // ser de voto divergente (falso aviso real do sinal, que a medição existe para mostrar). A frase limpa, de acórdão
    // unânime, não avisa.
    const diverg = de(m, "divergencia", "validacao");
    expect([diverg.acertos, diverg.falsosAvisos, diverg.perdidos]).toEqual([1, 1, 0]);
    const limpaDiverg = de(m, "divergencia", "ajuste");
    expect(limpaDiverg.falsosAvisos).toBe(0);
    expect(limpaDiverg.limpos).toBe(limpaDiverg.avaliados);
  });

  it("separa ajuste e validação e publica todos os sinais, também os ruins", async () => {
    await gravar();
    const m = await medir(pasta);
    const conjuntos = new Set(m.numeros.map((n) => n.conjunto));
    expect(conjuntos).toEqual(new Set(["ajuste", "validacao"]));
    for (const sinal of SINAIS_DE_PASSAGEM) expect(m.numeros.some((n) => n.sinal === sinal)).toBe(true);
    const texto = relatorio(m);
    for (const sinal of SINAIS) expect(texto).toContain(`[${sinal}]`);
    expect(texto).toMatch(/acerto quando avisa: +\d+\/\d+/);
  });

  it("usa o desempate para o item em que os rotuladores discordam", async () => {
    await gravar();
    await writeFile(join(pasta, "desempate.json"), JSON.stringify({ rotulos: { "s-negacao": { negacao: true } } }));
    const negacao = de(await medir(pasta), "negacao", "ajuste");
    expect(negacao.semConsenso).toBe(0);
    expect(negacao.avaliados).toBe(4);
  });
});

describe("medirAvisos — entradas que o protocolo recusa, com frase que ensina", () => {
  it("sem o formulário do segundo rotulador: erro que explica a dupla", async () => {
    await gravar(ITENS, null);
    await expect(medir(pasta)).rejects.toThrow(/rotulos-b\.json.*independentes/s);
  });

  it("formulário incompleto: lista quais rótulos faltam, sem texto da amostra", async () => {
    const incompleto = formulario(ITENS);
    incompleto.rotulos["limpa"] = {};
    await gravar(ITENS, incompleto);
    const erro = (await medir(pasta).catch((e: unknown) => e)) as Error;
    expect(erro).toBeInstanceOf(ErroDeProtocolo);
    expect(erro.message).toMatch(/rotulos-b\.json está incompleto.*limpa\/negacao/);
    expect(erro.message).not.toContain(LIMPA);
  });

  it("dois formulários idênticos: não é dupla independente", async () => {
    await gravar(ITENS, formulario(ITENS));
    await expect(medir(pasta)).rejects.toThrow(/idênticos/);
  });

  it("pasta dentro do repositório: recusa (regra 2)", async () => {
    await expect(medir(join(import.meta.dirname, "..", "tests"))).rejects.toThrow(/dentro do repositório/);
  });
});

describe("medirAvisos — nada do texto sai", () => {
  it("o relatório e a mensagem de montar não contêm citação, órgão nem frase do PDF", async () => {
    await gravar();
    const saida = relatorio(await medir(pasta)) + (await montar(pasta));
    for (const proibido of [...Object.values(CITACAO), LIMPA, "Camara", "Câmara", "Acordam", "prescricao", "trt1"]) {
      expect(saida).not.toContain(proibido);
    }
    // Só hashes (12 hex) identificam casos.
    expect(relatorio(await medir(pasta))).toMatch(/Amostra [0-9a-f]{12}:/);
  });
});

describe("medirAvisos — montar", () => {
  it("sorteia o conjunto de cada item de forma fixa e cria os formulários em branco sem sobrescrever", async () => {
    const semConjunto = ITENS.map(({ conjunto: _c, ...resto }) => resto);
    await gravar(semConjunto, null);
    await rm(join(pasta, "rotulos-a.json"));
    const resumo = await montar(pasta);
    expect(resumo).toMatch(/Amostra: 8 PDFs \(ajuste \d+, validação \d+\)/);
    const depois = JSON.parse(await readFile(join(pasta, "amostra.json"), "utf8")) as { itens: Item[] };
    expect(depois.itens.every((i) => i.conjunto === "ajuste" || i.conjunto === "validacao")).toBe(true);
    const branco = JSON.parse(await readFile(join(pasta, "rotulos-b.json"), "utf8").catch(() => "null"));
    expect(branco.rotulos["limpa"]).toEqual({
      negacao: null, alegacaoDaParte: null, ementaTranscrita: null, divergencia: null, raciocinioHipotetico: null,
    });
    // Segunda rodada: mesmo sorteio, nada sobrescrito.
    await writeFile(join(pasta, "rotulos-b.json"), JSON.stringify({ rotulos: { feito: {} } }));
    expect(await montar(pasta)).toMatch(/nada sobrescrito|criados: rotulos-a\.json/);
    expect(JSON.parse(await readFile(join(pasta, "rotulos-b.json"), "utf8")).rotulos.feito).toEqual({});
    const de2 = JSON.parse(await readFile(join(pasta, "amostra.json"), "utf8")) as { itens: Item[] };
    expect(de2.itens.map((i) => i.conjunto)).toEqual(depois.itens.map((i) => i.conjunto));
  });
});
