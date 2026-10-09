import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ConjuntoBaixado,
  gerarEGravar,
  gerarTabela,
  INTERVALO_MS,
  PAGINA_DO_CONJUNTO,
  ParadaDoGerador,
  URL_PROCESSOS,
  URL_TEMAS,
  urlPermitida,
} from "../scripts/gerarTabela.js";
import { clienteFalso } from "./apoio.js";

const gravado = (nome: string) => readFileSync(new URL(`./fixtures/stj-precedentes/${nome}`, import.meta.url));

function conjunto(trocas: Partial<Record<"pagina" | "temas" | "processos", Buffer>> = {}): ConjuntoBaixado {
  return {
    pagina: { url: PAGINA_DO_CONJUNTO, bytes: trocas.pagina ?? gravado("pagina-trecho.html"), coletadoEm: "2026-10-09T12:22:25.614Z" },
    temas: { url: URL_TEMAS, bytes: trocas.temas ?? gravado("temas-trecho.csv"), coletadoEm: "2026-10-09T12:22:35.742Z" },
    processos: { url: URL_PROCESSOS, bytes: trocas.processos ?? gravado("processos-trecho.csv"), coletadoEm: "2026-10-09T12:22:47.212Z" },
  };
}

const linha = (t: ReturnType<typeof gerarTabela>, tipo: string, numero: number) =>
  t.linhas.find((l) => l.tipo === tipo && l.numero === numero);

describe("gerador da tabela de precedentes — parte pura (gravação real)", () => {
  const tabela = gerarTabela(conjunto(), "2026-10-09T12:23:00.000Z");

  it("só Tema e IAC entram, cada número uma vez, com Tema 1 e IAC 1 separados", () => {
    expect(tabela.linhas.map((l) => `${l.tipo} ${l.numero}`).sort()).toEqual(
      ["IAC 1", "IAC 14", "tema repetitivo 1", "tema repetitivo 126", "tema repetitivo 14", "tema repetitivo 18",
        "tema repetitivo 56", "tema repetitivo 978"].sort(),
    );
    expect(linha(tabela, "tema repetitivo", 1)!.teseFirmada).not.toBe(linha(tabela, "IAC", 1)!.teseFirmada);
  });

  it("copia a situação e a tese literais; tema afetado sem tese fica sem o campo", () => {
    const iac1 = linha(tabela, "IAC", 1)!;
    expect(iac1.situacao).toBe("Trânsito em Julgado");
    expect(iac1.orgaoJulgador).toBe("S2");
    expect(iac1.numerosRepercussaoGeralSTF).toEqual(["1162"]);
    const afetado = linha(tabela, "tema repetitivo", 978)!;
    expect(afetado.situacao).toBe("Afetado");
    expect(afetado.teseFirmada).toBeUndefined();
    expect(afetado.questaoSubmetida).toBeTruthy();
    expect(linha(tabela, "tema repetitivo", 56)!.situacao).toBe("Cancelado");
    expect(linha(tabela, "tema repetitivo", 126)!.situacao).toBe("Revisado");
    expect(linha(tabela, "tema repetitivo", 14)!.sumulaOriginada).toBe("378");
  });

  it("textos só com CRLF → LF e espaço das pontas removido", () => {
    for (const l of tabela.linhas) {
      for (const texto of [l.teseFirmada, l.questaoSubmetida]) {
        if (!texto) continue;
        expect(texto).not.toMatch(/\r/);
        expect(texto).toBe(texto.trim());
      }
    }
    // O texto da tabela aparece, igual, no CSV gravado depois da mesma troca de fim de linha.
    const csv = gravado("temas-trecho.csv").toString("utf8").replace(/\r\n/g, "\n");
    expect(csv).toContain(linha(tabela, "tema repetitivo", 1)!.teseFirmada!.replace(/"/g, '""'));
  });

  it("linhas repetidas da fonte, uma por tema de RG do STF ligado, viram uma linha com os números em lista", () => {
    expect(linha(tabela, "tema repetitivo", 18)!.numerosRepercussaoGeralSTF).toEqual(["165", "388"]);
    expect(linha(tabela, "IAC", 14)!.numerosRepercussaoGeralSTF).toEqual(["793", "1234"]);
  });

  it("paradigma = processo leadingCase S sem desafetação; os N ficam de fora", () => {
    expect(linha(tabela, "tema repetitivo", 1)!.processosParadigma).toEqual(["REsp 1091443"]);
    expect(linha(tabela, "IAC", 1)!.processosParadigma).toEqual(["EREsp 1604412"]);
    // Linha repetida em processos.csv não duplica o paradigma.
    expect(linha(tabela, "IAC", 14)!.processosParadigma).toEqual(["CC 187276"]);
  });

  it("processo S com texto em Desafetação não é paradigma", () => {
    const desafetado = gravado("processos-trecho.csv")
      .toString("utf8")
      .replace(/^(263,Tema,1,REsp 1091443,.*),,$/m, (_, inicio: string) => `${inicio},2009-01-01 : Afetação cancelada,`);
    expect(desafetado).not.toBe(gravado("processos-trecho.csv").toString("utf8"));
    const t = gerarTabela(conjunto({ processos: Buffer.from(desafetado) }), "2026-10-09T12:23:00.000Z");
    expect(linha(t, "tema repetitivo", 1)!.processosParadigma).toBeUndefined();
  });

  it("metadados: fonte, URL, licença como declarada, sha256 de cada arquivo e as três datas separadas", () => {
    expect(tabela.fonte.pagina).toBe(PAGINA_DO_CONJUNTO);
    expect(tabela.atribuicao).toBe("Fonte: STJ — Portal de Dados Abertos, conjunto Precedentes qualificados");
    expect(tabela.licenca.declarada).toBe("Creative Commons Atribuição, conforme a página do conjunto em 2026-10-09");
    expect(tabela.atualizacaoDaFonte.texto).toBe("Última Atualização outubro 8, 2026, 17:25 (UTC)");
    expect(tabela.geradaEm).toBe("2026-10-09T12:23:00.000Z");
    expect(tabela.arquivos.map((a) => a.url)).toEqual([PAGINA_DO_CONJUNTO, URL_TEMAS, URL_PROCESSOS]);
    for (const a of tabela.arquivos) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(tabela.arquivos[1].coletadoEm).toBe("2026-10-09T12:22:35.742Z");
  });

  it("página sem \"Última Atualização\": a data da fonte é \"não informada\"", () => {
    const pagina = Buffer.from(gravado("pagina-trecho.html").toString("utf8").replace("Última Atualização", "Atualizado"));
    expect(gerarTabela(conjunto({ pagina }), "x").atualizacaoDaFonte.texto).toBe("não informada");
  });

  it("para em cabeçalho de CSV diferente do esperado", () => {
    const temas = Buffer.from(gravado("temas-trecho.csv").toString("utf8").replace("teseFirmada", "tese"));
    expect(() => gerarTabela(conjunto({ temas }), "x")).toThrow(/temas\.csv: cabeçalho diferente do esperado/);
    const processos = Buffer.from(gravado("processos-trecho.csv").toString("utf8").replace(",Desafetação,", ",Desafetacao,"));
    expect(() => gerarTabela(conjunto({ processos }), "x")).toThrow(/processos\.csv: cabeçalho diferente/);
  });

  it("para em marcação HTML na tese, sem limpar", () => {
    const temas = Buffer.from(gravado("temas-trecho.csv").toString("utf8").replace("A majoração do auxílio", "A <b>majoração</b> do auxílio"));
    expect(() => gerarTabela(conjunto({ temas }), "x")).toThrow(/Marcação HTML em Tema 18, teseFirmada/);
  });

  it("para quando o mesmo número aparece com conteúdo diferente", () => {
    const texto = gravado("temas-trecho.csv").toString("utf8");
    const ultima = texto.lastIndexOf("A majoração do auxílio");
    const temas = Buffer.from(`${texto.slice(0, ultima)}B${texto.slice(ultima + 1)}`);
    expect(() => gerarTabela(conjunto({ temas }), "x")).toThrow(/Tema 18 aparece em linhas com conteúdo diferente/);
  });

  it("para se a página deixar de declarar a licença", () => {
    const pagina = Buffer.from(gravado("pagina-trecho.html").toString("utf8").replace("Creative Commons Atribuição", "Outra"));
    expect(() => gerarTabela(conjunto({ pagina }), "x")).toThrow(ParadaDoGerador);
  });
});

describe("gerador da tabela de precedentes — rede (fetch falso)", () => {
  const respostas = () => [
    new Response(gravado("pagina-trecho.html"), { status: 200, headers: { "content-type": "text/html" } }),
    new Response(gravado("temas-trecho.csv"), { status: 200, headers: { "content-type": "text/csv" } }),
    new Response(gravado("processos-trecho.csv"), { status: 200, headers: { "content-type": "text/csv" } }),
  ];
  const destinoComTabelaAnterior = () => {
    const destino = join(mkdtempSync(join(tmpdir(), "garimpo-tabela-")), "tabela.json");
    writeFileSync(destino, "tabela anterior");
    return destino;
  };
  /** Cliente falso com o intervalo do portal e relógio próprio, que anda com as esperas. */
  const comRelogio = (r: Response[]) => {
    let relogio = 0;
    const esperas: number[] = [];
    const agora = () => relogio;
    const falso = clienteFalso(r, {
      intervaloMinimoPorHost: { "dadosabertos.web.stj.jus.br": INTERVALO_MS },
      agora,
      esperar: async (ms) => {
        esperas.push(ms);
        relogio += ms;
      },
    });
    return { ...falso, esperas, agora };
  };

  it("pede só a página e os dois downloads, com 10 s entre chamadas, e grava a tabela", async () => {
    const { cliente, chamadas, esperas, agora } = comRelogio(respostas());
    const destino = destinoComTabelaAnterior();
    const tabela = await gerarEGravar(cliente, destino, agora);
    expect(chamadas.map((c) => c.url)).toEqual([PAGINA_DO_CONJUNTO, URL_TEMAS, URL_PROCESSOS]);
    expect(esperas).toEqual([INTERVALO_MS, INTERVALO_MS]);
    for (const c of chamadas) {
      expect(c.url).not.toMatch(/\/api\/|processo\.stj\.jus\.br/);
      expect(c.init.redirect).toBe("manual");
    }
    expect(JSON.parse(readFileSync(destino, "utf8"))).toEqual(tabela);
  });

  it("só aceita a página do conjunto e downloads do conjunto", () => {
    expect(urlPermitida(PAGINA_DO_CONJUNTO)).toBe(true);
    expect(urlPermitida(URL_TEMAS)).toBe(true);
    expect(urlPermitida("https://dadosabertos.web.stj.jus.br/api/3/action/package_list")).toBe(false);
    expect(urlPermitida("https://processo.stj.jus.br/repetitivos/temas_repetitivos/")).toBe(false);
    expect(urlPermitida(`${URL_TEMAS}?x=1`)).toBe(false);
    expect(urlPermitida(URL_TEMAS.replace("https:", "http:"))).toBe(false);
  });

  it.each([
    ["403", () => new Response("", { status: 403 })],
    ["desafio anti-robô", () => new Response("", { status: 503, headers: { "cf-mitigated": "challenge" } })],
    ["redirecionamento", () => new Response("", { status: 302, headers: { location: "https://dadosabertos.web.stj.jus.br/api/x" } })],
  ])("para em %s sem tocar a tabela anterior", async (_, recusa) => {
    const r = respostas();
    r[1] = recusa();
    const { cliente, chamadas } = comRelogio(r);
    const destino = destinoComTabelaAnterior();
    await expect(gerarEGravar(cliente, destino)).rejects.toThrow(ParadaDoGerador);
    expect(chamadas).toHaveLength(2);
    expect(readFileSync(destino, "utf8")).toBe("tabela anterior");
  });

  it("429: espera, tenta uma vez (também com 10 s) e, em nova recusa, para sem tocar a tabela anterior", async () => {
    const r = respostas();
    r.splice(1, 1, new Response("", { status: 429, headers: { "retry-after": "2" } }), new Response("", { status: 503 }));
    const { cliente, chamadas, esperas, agora } = comRelogio(r);
    const destino = destinoComTabelaAnterior();
    await expect(gerarEGravar(cliente, destino, agora)).rejects.toThrow(/recusou a chamada duas vezes/);
    expect(chamadas.map((c) => c.url)).toEqual([PAGINA_DO_CONJUNTO, URL_TEMAS, URL_TEMAS]);
    // 10 s antes do temas.csv; 2 s pedidos pelo 429; o resto até completar 10 s desde a chamada recusada.
    expect(esperas).toEqual([INTERVALO_MS, 2_000, INTERVALO_MS - 2_000]);
    expect(readFileSync(destino, "utf8")).toBe("tabela anterior");
  });

  it("cabeçalho trocado no download: para sem tocar a tabela anterior", async () => {
    const r = respostas();
    r[2] = new Response(gravado("processos-trecho.csv").toString("utf8").replace("leadingCase", "lead"), { status: 200 });
    const { cliente } = comRelogio(r);
    const destino = destinoComTabelaAnterior();
    await expect(gerarEGravar(cliente, destino)).rejects.toThrow(/processos\.csv: cabeçalho diferente/);
    expect(readFileSync(destino, "utf8")).toBe("tabela anterior");
  });
});
