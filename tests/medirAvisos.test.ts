import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ErroDeProtocolo,
  kappa,
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

  it("identifica falsos avisos pelo id do item e pelo hash do PDF", async () => {
    await gravar();
    const texto = relatorio(await medir(pasta));
    expect(texto).toMatch(/falsos avisos \(id:hash do PDF\): .*s-[A-Za-z]+:[0-9a-f]{12}/);
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

  it("dois formulários idênticos: não recusa (melhor caso), mas avisa no relatório", async () => {
    await gravar(ITENS, formulario(ITENS));
    const m = await medir(pasta);
    expect(m.avisosDoProtocolo.join(" ")).toMatch(/idênticos/);
    expect(relatorio(m)).toMatch(/Atenção:.*idênticos/);
  });

  it("desempate.json com JSON inválido: erro claro; arquivo ausente: sem desempate", async () => {
    await gravar();
    await writeFile(join(pasta, "desempate.json"), "{ quebrado");
    await expect(medir(pasta)).rejects.toThrow(/desempate\.json não é um JSON válido/);
    await rm(join(pasta, "desempate.json"));
    expect((await medir(pasta)).itens).toBe(ITENS.length);
  });

  it("conjunto fora de ajuste/validacao: recusa com erro claro, sem citar texto", async () => {
    const itens = ITENS.map((i, k) => (k === 0 ? { ...i, conjunto: "validação" as never } : i));
    await gravar(itens, null);
    const erro = await medir(pasta).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(/"conjunto" inválido.*"ajuste" ou "validacao"/);
    expect((erro as Error).message).not.toContain(CITACAO.negacao);
  });

  it("id só de dígitos: recusa (a ordem embaralhada do formulário se perderia)", async () => {
    await gravar([{ id: "123", pdf: "autoria.pdf", citacao: CITACAO.negacao }], null);
    await expect(medir(pasta)).rejects.toThrow(/pelo menos uma letra/);
  });

  it("subpasta do repositório com nome começando por '..' também recusa (regra 2)", async () => {
    await expect(medir(join(import.meta.dirname, "..", "..amostra"))).rejects.toThrow(/dentro do repositório/);
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

describe("medirAvisos — kappa de Cohen", () => {
  it("a=[T,T,F,F], b=[T,F,F,F] dá 0,5; concordância total indefinida quando só há uma resposta", () => {
    expect(kappa([true, true, false, false], [true, false, false, false])).toBeCloseTo(0.5, 10);
    expect(kappa([true, false, true, false], [true, false, true, false])).toBe(1);
    expect(kappa([true, true], [true, true])).toBeNull();
    expect(kappa([], [])).toBeNull();
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

  const semConjunto = () => ITENS.map(({ conjunto: _c, ...resto }) => resto);
  const lerAmostra = async () =>
    JSON.parse(await readFile(join(pasta, "amostra.json"), "utf8")) as { semente: string; itens: Item[] };

  it("divide em metades equilibradas mesmo com PDFs que terminam igual, e a mesma semente repete a divisão", async () => {
    await gravar(semConjunto(), null);
    await writeFile(join(pasta, "amostra.json"), JSON.stringify({ semente: "semente-fixa", itens: semConjunto() }));
    await montar(pasta);
    const primeira = await lerAmostra();
    expect(primeira.semente).toBe("semente-fixa");
    const conta = (c: string) => primeira.itens.filter((i) => i.conjunto === c).length;
    expect([conta("ajuste"), conta("validacao")]).toEqual([4, 4]);

    const outra = await mkdtemp(join(tmpdir(), "garimpo-medicao-"));
    try {
      for (const nome of ["autoria.pdf", "unanime.pdf", "fecho.pdf"]) {
        await writeFile(join(outra, nome), await readFile(join(pasta, nome)));
      }
      await writeFile(join(outra, "amostra.json"), JSON.stringify({ semente: "semente-fixa", itens: semConjunto() }));
      await montar(outra);
      const repetida = JSON.parse(await readFile(join(outra, "amostra.json"), "utf8")) as { itens: Item[] };
      expect(repetida.itens.map((i) => i.conjunto)).toEqual(primeira.itens.map((i) => i.conjunto));
    } finally {
      await rm(outra, { recursive: true, force: true });
    }
  });

  it("sem semente no manifesto, sorteia uma e a registra em amostra.json", async () => {
    await gravar(semConjunto(), null);
    await montar(pasta);
    expect((await lerAmostra()).semente).toMatch(/^[0-9a-f]{16}$/);
  });

  it("embaralha a ordem dos itens nos formulários (a do manifesto vazaria o gabarito), igual nos dois e fixa pela semente", async () => {
    await gravar(semConjunto(), null);
    await writeFile(join(pasta, "amostra.json"), JSON.stringify({ semente: "semente-fixa", itens: semConjunto() }));
    await rm(join(pasta, "rotulos-a.json"));
    await montar(pasta);
    const ordem = async (nome: string) =>
      Object.keys((JSON.parse(await readFile(join(pasta, nome), "utf8")) as { rotulos: object }).rotulos);
    const ordemA = await ordem("rotulos-a.json");
    expect(ordemA).toEqual(await ordem("rotulos-b.json"));
    expect([...ordemA].sort()).toEqual(ITENS.map((i) => i.id).sort());
    expect(ordemA).not.toEqual(ITENS.map((i) => i.id));
    await rm(join(pasta, "rotulos-a.json"));
    await montar(pasta);
    expect(await ordem("rotulos-a.json")).toEqual(ordemA);
  });
});
