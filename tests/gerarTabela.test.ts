import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
import { compararLinhas, motivoDaTrava, relatorioDeMudancas } from "../src/tabelaDePrecedentes.js";
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
    const destino = join(mkdtempSync(join(process.env.GARIMPO_DADOS!, "garimpo-tabela-")), "tabela.json");
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
    writeFileSync(destino, JSON.stringify(gerarTabela(conjunto(), "2026-10-01T00:00:00.000Z")));
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

  describe("trava contra a tabela anterior (G-56)", () => {
    /** Tabela anterior gravada no destino, a partir da geração real do trecho, com a troca que o teste pedir. */
    const anteriorCom = (mexer: (t: ReturnType<typeof gerarTabela>) => void) => {
      const destino = destinoComTabelaAnterior();
      const t = gerarTabela(conjunto(), "2026-10-01T00:00:00.000Z");
      mexer(t);
      writeFileSync(destino, JSON.stringify(t));
      return destino;
    };
    const rodar = async (destino: string, opcoes?: Parameters<typeof gerarEGravar>[3]) => {
      const { cliente, agora } = comRelogio(respostas());
      return gerarEGravar(cliente, destino, agora, opcoes);
    };

    it("tema que sumiu: para, mostra o relatório e deixa a tabela anterior como estava", async () => {
      const destino = anteriorCom((t) => t.linhas.push({ tipo: "tema repetitivo", numero: 9999 }));
      const antes = readFileSync(destino, "utf8");
      await expect(rodar(destino)).rejects.toThrow(/sumiram[\s\S]*tema repetitivo 9999/);
      expect(readFileSync(destino, "utf8")).toBe(antes);
    });

    it("tema que sumiu, com revisado: grava e relata", async () => {
      const destino = anteriorCom((t) => t.linhas.push({ tipo: "tema repetitivo", numero: 9999 }));
      const relatorios: string[] = [];
      const tabela = await rodar(destino, { revisado: true, aoComparar: (r) => relatorios.push(r) });
      expect(JSON.parse(readFileSync(destino, "utf8")).linhas).toHaveLength(tabela.linhas.length);
      expect(relatorios[0]).toMatch(/removidas: 1 \(tema repetitivo 9999\)/);
    });

    it("mudança grande (≥ proporção e ≥ mínimo): para; com revisado, grava", async () => {
      const mexer = (t: ReturnType<typeof gerarTabela>) => t.linhas.slice(0, 3).forEach((l) => (l.situacao = "outra"));
      const limiares = { proporcao: 0.25, minimo: 3 };
      const destino = anteriorCom(mexer);
      await expect(rodar(destino, { limiares })).rejects.toThrow(/3 de 8 precedentes mudaram/);
      expect(JSON.parse(readFileSync(destino, "utf8")).linhas[0].situacao).toBe("outra");
      await rodar(destino, { limiares, revisado: true });
      expect(JSON.parse(readFileSync(destino, "utf8")).linhas[0].situacao).not.toBe("outra");
    });

    it("mudança pequena: grava, relata e marca conferidaEm", async () => {
      const destino = anteriorCom((t) => (t.linhas[0].situacao = "outra"));
      const relatorios: string[] = [];
      const tabela = await rodar(destino, { aoComparar: (r) => relatorios.push(r) });
      expect(relatorios[0]).toMatch(/alteradas: 1 /);
      expect(tabela.conferidaEm).toBe(tabela.geradaEm);
      expect(JSON.parse(readFileSync(destino, "utf8")).conferidaEm).toBe(tabela.conferidaEm);
    });

    it("erro de rede nunca conta como conferência: a tabela anterior segue com o conferidaEm de antes", async () => {
      const destino = anteriorCom((t) => (t.conferidaEm = "2026-10-01T00:00:00.000Z"));
      const r = respostas();
      r[1] = new Response("", { status: 403 });
      const { cliente } = comRelogio(r);
      await expect(gerarEGravar(cliente, destino)).rejects.toThrow(ParadaDoGerador);
      expect(JSON.parse(readFileSync(destino, "utf8")).conferidaEm).toBe("2026-10-01T00:00:00.000Z");
    });

    it("sem tabela anterior (primeira geração): grava sem comparar", async () => {
      const destino = join(mkdtempSync(join(process.env.GARIMPO_DADOS!, "garimpo-tabela-")), "nova.json");
      const tabela = await rodar(destino);
      expect(JSON.parse(readFileSync(destino, "utf8")).linhas).toHaveLength(tabela.linhas.length);
    });

    it("tabela anterior ilegível: para em vez de gravar às cegas", async () => {
      const destino = destinoComTabelaAnterior();
      await expect(rodar(destino)).rejects.toThrow(/ilegível/);
      expect(readFileSync(destino, "utf8")).toBe("tabela anterior");
    });
  });

  describe("relatório de mudanças gravado ao gerar (G-59)", () => {
    const pastaNova = () => mkdtempSync(join(process.env.GARIMPO_DADOS!, "garimpo-relatorio-"));
    const anteriorEm = (pasta: string, mexer: (t: ReturnType<typeof gerarTabela>) => void) => {
      const destino = join(pasta, "tabela.json");
      const t = gerarTabela(conjunto(), "2026-10-01T00:00:00.000Z");
      mexer(t);
      writeFileSync(destino, JSON.stringify(t));
      return destino;
    };
    const gerar = async (destino: string, opcoes: Parameters<typeof gerarEGravar>[3]) => {
      const { cliente, agora } = comRelogio(respostas());
      return gerarEGravar(cliente, destino, agora, opcoes);
    };

    it("grava docs-style AAAA-MM-DD-stj.md na pasta pedida, com as duas versões e a origem", async () => {
      const pasta = pastaNova();
      const destino = anteriorEm(pasta, (t) => (t.linhas[0].teseFirmada = "Tese antiga sintética."));
      const tabela = await gerar(destino, { pastaDoRelatorio: join(pasta, "mudancas") });
      const arquivo = join(pasta, "mudancas", `${tabela.geradaEm.slice(0, 10)}-stj.md`);
      const texto = readFileSync(arquivo, "utf8");
      expect(texto).toContain("Tese antiga sintética.");
      expect(texto).toContain(tabela.linhas[0].teseFirmada!);
      expect(texto).toContain(URL_TEMAS);
    });

    it("sem mudança: grava relatório 'sem mudanças'", async () => {
      const pasta = pastaNova();
      const destino = anteriorEm(pasta, () => {});
      const tabela = await gerar(destino, { pastaDoRelatorio: join(pasta, "mudancas") });
      expect(readFileSync(join(pasta, "mudancas", `${tabela.geradaEm.slice(0, 10)}-stj.md`), "utf8")).toMatch(/sem mudanças/i);
    });

    it("trava recusa: nenhum relatório gravado; primeira geração: nenhum relatório", async () => {
      const pasta = pastaNova();
      const destino = anteriorEm(pasta, (t) => t.linhas.push({ tipo: "tema repetitivo", numero: 9999 }));
      await expect(gerar(destino, { pastaDoRelatorio: join(pasta, "mudancas") })).rejects.toThrow(/sumiram/);
      expect(existsSync(join(pasta, "mudancas"))).toBe(false);
      await gerar(join(pasta, "nova.json"), { pastaDoRelatorio: join(pasta, "mudancas") });
      expect(existsSync(join(pasta, "mudancas"))).toBe(false);
    });
  });
});

describe("trava — comparação e limiares (puros, sintéticos)", () => {
  const lista = (n: number, mexer = 0) =>
    Array.from({ length: n }, (_, i) => ({ tipo: "tema repetitivo", numero: i + 1, situacao: i < mexer ? "b" : "a" }));

  it("compara por identificador: removidas, adicionadas e alteradas", () => {
    const d = compararLinhas(lista(4), [...lista(4, 1).slice(0, 3), { tipo: "IAC", numero: 1 }]);
    expect(d).toMatchObject({ anteriores: 4, removidas: ["tema repetitivo 4"], adicionadas: ["IAC 1"], alteradas: ["tema repetitivo 1"] });
  });

  it("25% de 100 (25 itens) para; 24% não; 25% de 40 (10 itens, abaixo de 20) não", () => {
    expect(motivoDaTrava(compararLinhas(lista(100), lista(100, 25)))).toMatch(/25 de 100/);
    expect(motivoDaTrava(compararLinhas(lista(100), lista(100, 24)))).toBeUndefined();
    expect(motivoDaTrava(compararLinhas(lista(40), lista(40, 10)))).toBeUndefined();
    expect(motivoDaTrava(compararLinhas(lista(80), lista(80, 20)))).toMatch(/20 de 80/);
  });

  it("linha sumida sempre trava, mesmo sendo uma só", () => {
    expect(motivoDaTrava(compararLinhas(lista(500), lista(499)))).toMatch(/1 precedente/);
  });
});

describe("relatório de mudanças entre versões (G-59, puro, sintético)", () => {
  const meta = {
    nome: "stj",
    geradaEm: "2026-11-01T10:00:00.000Z",
    geradaEmAnterior: "2026-10-01T10:00:00.000Z",
    proveniencia: ["https://fonte.exemplo/temas.csv — coletado em 2026-11-01T09:59:00.000Z — sha256 abc123"],
  };
  const tema = (numero: number, extra: object = {}) => ({ tipo: "tema repetitivo", numero, situacao: "Julgado", teseFirmada: "Tese A.", ...extra });

  it("tese mudada: item com as duas versões literais e a proveniência (URL, data)", () => {
    const r = relatorioDeMudancas([tema(1), tema(2)], [tema(1, { teseFirmada: "Tese B,\nem duas linhas." }), tema(2)], meta);
    expect(r).toContain("tema repetitivo 1");
    expect(r).toContain("Tese A.");
    expect(r).toContain("Tese B,");
    expect(r).toContain("em duas linhas.");
    expect(r).toContain("https://fonte.exemplo/temas.csv");
    expect(r).toContain("2026-11-01T09:59:00.000Z");
    expect(r).not.toContain("tema repetitivo 2");
    expect(r).not.toMatch(/sem mudanças/i);
  });

  it("tema cancelado e súmula revista levam a marca correspondente", () => {
    const r = relatorioDeMudancas(
      [tema(7), { tipo: "súmula", numero: 3, situacao: "vigente" }],
      [tema(7, { situacao: "Cancelado" }), { tipo: "súmula", numero: 3, situacao: "revista" }],
      meta,
    );
    expect(r).toMatch(/tema repetitivo 7[\s\S]*Marca: tema cancelado/);
    expect(r).toMatch(/súmula 3[\s\S]*Marca: súmula revista/);
  });

  it("linhas novas e removidas aparecem separadas; mudança sem marca não inventa marca", () => {
    const r = relatorioDeMudancas([tema(1), tema(2)], [tema(2, { orgaoJulgador: "Corte" }), tema(3)], meta);
    expect(r).toMatch(/Removidas \(1\)[\s\S]*tema repetitivo 1/);
    expect(r).toMatch(/Adicionadas \(1\)[\s\S]*tema repetitivo 3/);
    expect(r).not.toContain("Marca:");
  });

  it("sem mudança: diz 'sem mudanças' e ainda traz a proveniência", () => {
    const r = relatorioDeMudancas([tema(1)], [tema(1)], meta);
    expect(r).toMatch(/sem mudanças/i);
    expect(r).toContain("https://fonte.exemplo/temas.csv");
  });
});
