import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  baixarExportacaoRg,
  gerarEGravarStf,
  gerarTabelaStf,
  INTERVALO_MS,
  lerEntrada,
  ParadaDoGerador,
  proveniencia,
  URL_EXPORTACAO_RG,
} from "../scripts/gerarTabelaStf.js";
import { clienteFalso } from "./apoio.js";

const caminho = (nome: string) => new URL(`./fixtures/stf-sintetico/${nome}`, import.meta.url);
const exportacao = () => readFileSync(caminho("RepercussaoGeral.xls"));
const ok = (bytes: Buffer | string = exportacao()) =>
  new Response(bytes, { status: 200, headers: { "content-type": "application / vnd.ms-excel; Charset=UTF-8" } });
const AGORA = "2026-10-14T13:00:00.000Z";
const agora = () => Date.parse(AGORA);

function pastaDeEntrada() {
  const pasta = mkdtempSync(join(process.env.GARIMPO_DADOS!, "entrada-stf-"));
  mkdirSync(join(pasta, "sumulas"));
  for (const n of ["RepercussaoGeral.xls", "sumulas.html", "sumulas-vinculantes.html"]) {
    copyFileSync(caminho(n), join(pasta, n));
    utimesSync(join(pasta, n), new Date("2026-10-08T10:00:00Z"), new Date("2026-10-08T10:00:00Z"));
  }
  return pasta;
}

describe("exportação de repercussão geral baixada pelo mantenedor (I-33 / G-57 / D-11)", () => {
  it("pede só a URL da exportação, sem seguir redirecionamento, e devolve os bytes com URL e data", async () => {
    const { cliente, chamadas } = clienteFalso([ok()]);
    const a = await baixarExportacaoRg(cliente, agora);
    expect(chamadas.map((c) => c.url)).toEqual([URL_EXPORTACAO_RG]);
    expect(URL_EXPORTACAO_RG).toBe("https://portal.stf.jus.br/jurisprudenciaRepercussao/exportarDados.asp?");
    expect(chamadas[0].init.redirect).toBe("manual");
    expect(a).toMatchObject({ nome: "RepercussaoGeral.xls", url: URL_EXPORTACAO_RG, obtidoEm: AGORA });
    expect(a.bytes.equals(exportacao())).toBe(true);
    expect(INTERVALO_MS).toBe(10_000);
  });

  it.each([
    ["403", () => new Response("", { status: 403 })],
    ["404", () => new Response("", { status: 404 })],
    ["redirecionamento", () => new Response("", { status: 302, headers: { location: "https://outro.exemplo/x" } })],
  ])("%s: para com ParadaDoGerador", async (_, recusa) => {
    const { cliente, chamadas } = clienteFalso([recusa()]);
    await expect(baixarExportacaoRg(cliente, agora)).rejects.toThrow(ParadaDoGerador);
    expect(chamadas).toHaveLength(1);
  });

  it("429: espera e tenta uma vez; nova recusa para, sem terceira chamada", async () => {
    const { cliente, chamadas } = clienteFalso([
      new Response("", { status: 429, headers: { "retry-after": "2" } }),
      new Response("", { status: 503 }),
    ]);
    await expect(baixarExportacaoRg(cliente, agora)).rejects.toThrow(/recusou a chamada duas vezes/);
    expect(chamadas).toHaveLength(2);
  });

  it("gera a tabela com a exportação baixada no lugar do arquivo manual, registrando URL, data e hash", () => {
    const pasta = pastaDeEntrada();
    const destino = join(mkdtempSync(join(process.env.GARIMPO_DADOS!, "destino-")), "tabela.json");
    const bytes = exportacao();
    const t = gerarEGravarStf(pasta, destino, agora, {}, { nome: "RepercussaoGeral.xls", bytes, obtidoEm: AGORA, url: URL_EXPORTACAO_RG });
    const rg = t.arquivos.find((a) => a.parte === "repercussão geral")!;
    expect(rg).toMatchObject({ obtidoEm: AGORA, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(t.arquivos.filter((a) => a.parte === "repercussão geral")).toHaveLength(1);
    expect(JSON.parse(readFileSync(destino, "utf8")).conferidaEm).toBe(AGORA);
  });

  it("sem baixar, o arquivo manual da pasta continua valendo", () => {
    const pasta = pastaDeEntrada();
    const destino = join(mkdtempSync(join(process.env.GARIMPO_DADOS!, "destino-")), "tabela.json");
    const t = gerarEGravarStf(pasta, destino, agora);
    expect(t.arquivos.find((a) => a.parte === "repercussão geral")!.obtidoEm).toBe("2026-10-08T10:00:00.000Z");
  });

  it.each([
    ["página sem tabela", () => "<html>manutenção</html>"],
    ["cabeçalho trocado", () => exportacao().toString("utf8").replace("<th>Tese</th>", "<th>Ementa</th>")],
    ["tema repetido", () => exportacao().toString("utf8").replace("<td>0002</td>", "<td>0001</td>")],
  ])("download inválido (%s): para e a tabela anterior continua intacta", (_, texto) => {
    const pasta = pastaDeEntrada();
    const destino = join(mkdtempSync(join(process.env.GARIMPO_DADOS!, "destino-")), "tabela.json");
    gerarEGravarStf(pasta, destino, agora);
    const antes = readFileSync(destino, "utf8");
    const baixada = { nome: "RepercussaoGeral.xls", bytes: Buffer.from(texto()), obtidoEm: AGORA, url: URL_EXPORTACAO_RG };
    expect(() => gerarEGravarStf(pasta, destino, agora, {}, baixada)).toThrow(ParadaDoGerador);
    expect(readFileSync(destino, "utf8")).toBe(antes);
  });

  it("trava de G-56: exportação truncada (tema sumido) para; só --revisado grava", () => {
    const pasta = pastaDeEntrada();
    const destino = join(mkdtempSync(join(process.env.GARIMPO_DADOS!, "destino-")), "tabela.json");
    gerarEGravarStf(pasta, destino, agora);
    const antes = readFileSync(destino, "utf8");
    const truncada = exportacao().toString("utf8").replace(/<tr><td>0003<\/td>[\s\S]*?<\/tr>/, "");
    const baixada = { nome: "RepercussaoGeral.xls", bytes: Buffer.from(truncada), obtidoEm: AGORA, url: URL_EXPORTACAO_RG };
    expect(() => gerarEGravarStf(pasta, destino, agora, {}, baixada)).toThrow(/sumiram[\s\S]*3/);
    expect(readFileSync(destino, "utf8")).toBe(antes);
    gerarEGravarStf(pasta, destino, agora, { revisado: true }, baixada);
    expect(JSON.parse(readFileSync(destino, "utf8")).linhas.some((l: { tipo: string; numero: number }) => l.tipo === "repercussão geral" && l.numero === 3)).toBe(false);
  });

  it("proveniência: URL, obtenção, hash e descartes — temas sem título mantidos e listados", () => {
    const bytes = Buffer.from(
      exportacao().toString("utf8").replace("<td>Título fictício do tema dois.</td>", "<td></td>"),
    );
    const baixada = { nome: "RepercussaoGeral.xls", bytes, obtidoEm: AGORA, url: URL_EXPORTACAO_RG };
    const t = gerarTabelaStf({ ...lerEntrada(pastaDeEntrada()), repercussaoGeral: baixada }, AGORA);
    const linhas = proveniencia(t, baixada).join("\n");
    expect(linhas).toContain(URL_EXPORTACAO_RG);
    expect(linhas).toContain(AGORA);
    expect(linhas).toContain(createHash("sha256").update(bytes).digest("hex"));
    expect(linhas).toMatch(/descartes: nenhum/);
    expect(linhas).toMatch(/sem título \(mantidos na tabela\): 1 — tema 2/);
  });

  it("proveniência sem temas sem título diz zero", () => {
    const baixada = { nome: "RepercussaoGeral.xls", bytes: exportacao(), obtidoEm: AGORA, url: URL_EXPORTACAO_RG };
    const t = gerarTabelaStf({ repercussaoGeral: baixada, paginasDeSumula: [] }, AGORA);
    expect(proveniencia(t, baixada).join("\n")).toMatch(/sem título \(mantidos na tabela\): 0/);
  });
});
