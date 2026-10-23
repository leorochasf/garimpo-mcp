import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs do script de medição, sem tipos
import { criarFetchFalso, lerChamadas } from "../scripts/velocidadeFetchFalso.mjs";

const p7s = (nome: string) => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url)).toString("base64");

const GRAVADAS = {
  site: { "stj|dano moral": [{ id: "a1", texto_ementa: "EMENTA FICTÍCIA." }] },
  falcao: [{ id: "f1" }],
  normas: { "urn:lex:br:federal:lei:2015-03-16;13105": { "@type": "Legislation", headline: "Lei fictícia" } },
  projudi: {
    cnj: "0000001-11.2024.8.09.0001",
    dataHora: "25/09/2024 13:20:33",
    idMov: "109900000000000000000000001",
    ementaP7s: p7s("tjgo-ementa.html.p7s"),
    relatorioP7s: p7s("tjgo-relatorio-voto.html.p7s"),
  },
};

function montar() {
  const linhas: string[] = [];
  const fetch = criarFetchFalso(GRAVADAS, (l: string) => linhas.push(l)) as typeof globalThis.fetch;
  return { fetch, linhas };
}

describe("fetch falso da medição de velocidade: cada requisição registrada com os bytes, no transporte", () => {
  it("busca no JurisprudênciaIA: devolve os registros gravados e anota bytes enviados (corpo) e recebidos", async () => {
    const { fetch, linhas } = montar();
    const corpo = JSON.stringify({ query: "dano moral", limit: 10 });
    const r = await fetch("https://www.jurisprudenciaia.com.br/api/tribunais/stj/search", { method: "POST", body: corpo });
    const texto = await r.text();
    expect(JSON.parse(texto)).toEqual({ juris: GRAVADAS.site["stj|dano moral"] });
    expect(linhas).toEqual([`www.jurisprudenciaia.com.br/api/tribunais/stj/search\t${Buffer.byteLength(corpo)}\t${Buffer.byteLength(texto)}`]);
  });

  it("busca sem registros gravados: lista vazia, ainda contada como chamada", async () => {
    const { fetch, linhas } = montar();
    const r = await fetch("https://www.jurisprudenciaia.com.br/api/tribunais/stj/search", {
      method: "POST",
      body: JSON.stringify({ query: "outra coisa" }),
    });
    expect(await r.json()).toEqual({ juris: [] });
    expect(lerChamadas(linhas.join("\n")).total).toBe(1);
  });

  it("rota sem resposta gravada: 404 e a linha marcada com «?»", async () => {
    const { fetch, linhas } = montar();
    const r = await fetch(new URL("https://exemplo.invalid/qualquer"));
    expect(r.status).toBe(404);
    expect(linhas[0]).toMatch(/^\?exemplo\.invalid\/qualquer\t0\t\d+$/);
  });

  it("texto_de_lei: o normas.leg.br devolve a norma gravada pela urn", async () => {
    const { fetch } = montar();
    const r = await fetch(
      "https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:lei:2015-03-16;13105&&tipo_documento=maior-detalhe",
    );
    expect(await r.json()).toEqual(GRAVADAS.normas["urn:lex:br:federal:lei:2015-03-16;13105"]);
  });

  it("Projudi: página do processo com sessão, lista do julgamento e os dois envelopes .p7s, byte a byte", async () => {
    const { fetch, linhas } = montar();
    const pagina = await fetch(`https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=2&ProcessoNumero=${GRAVADAS.projudi.cnj}`);
    expect(pagina.headers.get("set-cookie")).toMatch(/^JSESSIONID=/);
    const html = Buffer.from(await pagina.arrayBuffer()).toString("latin1");
    expect(html).toContain(GRAVADAS.projudi.dataHora);
    expect(html).toContain(`buscarArquivosMovimentacaoJSON('${GRAVADAS.projudi.idMov}'`);

    const lista = await fetch(
      `https://projudi.tjgo.jus.br/MovimentacaoArquivo?AJAX=ajax&PaginaAtual=8&Id_Movimentacao=${GRAVADAS.projudi.idMov}`,
    );
    const arquivos = JSON.parse(Buffer.from(await lista.arrayBuffer()).toString("latin1")) as { id: string; nome_arquivo: string }[];
    expect(arquivos.map((a) => a.nome_arquivo)).toEqual(["ementa.html.p7s", "relatorio_voto_acordao.html.p7s"]);

    const envelopes = await Promise.all(
      arquivos.map(async (a) => {
        const r = await fetch(`https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=6&Id_MovimentacaoArquivo=${a.id}&hash=x`);
        return Buffer.from(await r.arrayBuffer()).toString("base64");
      }),
    );
    expect(envelopes).toEqual([GRAVADAS.projudi.ementaP7s, GRAVADAS.projudi.relatorioP7s]);

    const contas = lerChamadas(linhas.join("\n"));
    expect(contas.total).toBe(4);
    expect(contas.semResposta).toEqual([]);
    expect(contas.recebidos).toBeGreaterThan(
      Buffer.from(GRAVADAS.projudi.ementaP7s, "base64").length + Buffer.from(GRAVADAS.projudi.relatorioP7s, "base64").length,
    );
  });
});

describe("lerChamadas: soma o registro do fetch falso", () => {
  it("conta chamadas, as sem resposta e os bytes; aceita a linha antiga, sem bytes", () => {
    const texto = ["a.invalid/x\t10\t100", "?b.invalid/y\t0\t19", "", "c.invalid/z"].join("\n");
    expect(lerChamadas(texto)).toEqual({ total: 3, semResposta: ["?b.invalid/y"], enviados: 10, recebidos: 119 });
  });
});
