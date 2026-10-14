import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { Vagas } from "../src/cliente.js";
import { lerZip } from "../scripts/lerZip.js";
import {
  ATRIBUICAO,
  baixarConjuntos,
  clienteDoGerador,
  ConstrutorDoIndice,
  fetchComRegistro,
  gerarEGravar,
  INTERVALO_MS,
  lerFicha,
  mesesAusentes,
  ORGAOS,
  ParadaDoGerador,
  paginaDaFicha,
  urlPermitida,
} from "../scripts/gerarEspelhos.js";

const BASE = "https://dadosabertos.web.stj.jus.br";
const CONJ = "5ebbfe8a-05f3-4106-a160-794d91b740b8";

const urlDe = (nome: string, recurso = "68565b13-18b5-4ac0-a556-e5c24178fa25") =>
  `${BASE}/dataset/${CONJ}/resource/${recurso}/download/${nome}`;

/** Ficha no formato da página do portal (CKAN), reduzida: licença, atualização e os links de download. */
function ficha(nomes: string[], { licenca = "Creative Commons Atribuição", atualizacao = "setembro 8, 2026, 18:23 (UTC)" } = {}) {
  const links = nomes
    .map(
      (n) => `<li><a class="dropdown-item resource-url-analytics" href="${urlDe(n, `r-${n}`)}" target="_blank" rel="noreferrer">
        <i class="fa fa-arrow-circle-down"></i> Baixar </a></li>`,
    )
    .join("\n");
  return Buffer.from(`<html><body><script>var x = "Creative Commons Atribuição";</script>
<section class="license"><h2>Licença</h2><p><a href="http://www.opendefinition.org/licenses/cc-by">${licenca}</a></p></section>
<table><tr><th scope="row">Última Atualização</th><td><span data-datetime="2026-09-08T18:23:47+0000">${atualizacao}</span></td></tr></table>
<ul>${links}</ul></body></html>`);
}

describe("urlPermitida", () => {
  it("aceita a ficha de cada um dos 10 conjuntos e o download de AAAAMMDD.json/.zip", () => {
    expect(ORGAOS).toHaveLength(10);
    for (const o of ORGAOS) expect(urlPermitida(paginaDaFicha(o))).toBe(true);
    expect(urlPermitida(urlDe("20220531.json"))).toBe(true);
    expect(urlPermitida(urlDe("20220508.zip"))).toBe(true);
  });

  it("recusa /api/, outro host, query, http, outro nome de arquivo e página de outro conjunto", () => {
    expect(urlPermitida(`${BASE}/api/3/action/package_show?id=espelhos-de-acordaos-corte-especial`)).toBe(false);
    expect(urlPermitida(`${BASE}/api/3/action/package_list`)).toBe(false);
    expect(urlPermitida("https://processo.stj.jus.br/processo/revista/documento/mediado/?num_registro=1")).toBe(false);
    expect(urlPermitida(`${urlDe("20220531.json")}?x=1`)).toBe(false);
    expect(urlPermitida(urlDe("20220531.json").replace("https:", "http:"))).toBe(false);
    expect(urlPermitida(urlDe("dicionario-espelhodoacordao.csv"))).toBe(false);
    expect(urlPermitida(`${BASE}/dataset/precedentes-qualificados`)).toBe(false);
    expect(urlPermitida(`${BASE}/dataset/espelhos-de-acordaos-corte-especial/history`)).toBe(false);
    expect(urlPermitida(urlDe("20220531.json").replace("dadosabertos.web.stj.jus.br", "dadosabertos.web.stj.jus.br.mal.com"))).toBe(false);
  });
});

describe("lerFicha", () => {
  it("devolve licença, atualização literal e os arquivos em ordem de data (ZIP do histórico primeiro)", () => {
    const f = lerFicha(ficha(["20220531.json", "dicionario-espelhodoacordao.csv", "20220508.zip", "20220630.json"]), "corte-especial", "2026-10-13T10:00:00.000Z");
    expect(f.licenca).toBe("Creative Commons Atribuição, conforme a ficha do conjunto em 2026-10-13");
    expect(f.atualizacaoDaFonte).toBe("Última Atualização setembro 8, 2026, 18:23 (UTC)");
    expect(f.arquivos.map((a) => a.nome)).toEqual(["20220508.zip", "20220531.json", "20220630.json"]);
    expect(f.arquivos.every((a) => urlPermitida(a.url))).toBe(true);
  });

  it("para quando a ficha deixa de declarar Creative Commons Atribuição (texto de script não vale)", () => {
    expect(() => lerFicha(ficha(["20220531.json"], { licenca: "Todos os direitos reservados" }), "corte-especial", "2026-10-13T10:00:00.000Z")).toThrow(
      ParadaDoGerador,
    );
  });

  it("para quando um link de download aponta para fora do conjunto", () => {
    const mau = Buffer.from(ficha(["20220531.json"]).toString().replace(`${BASE}/dataset`, "https://exemplo.com/dataset"));
    expect(() => lerFicha(mau, "corte-especial", "2026-10-13T10:00:00.000Z")).toThrow(/fora do conjunto/);
  });

  it("para quando a ficha não traz nenhum arquivo", () => {
    expect(() => lerFicha(ficha([]), "corte-especial", "2026-10-13T10:00:00.000Z")).toThrow(/nenhum arquivo/);
  });

  it("registra a atualização como 'não informada' quando a ficha não a traz", () => {
    const sem = Buffer.from(ficha(["20220531.json"]).toString().replace(/Última Atualização/, "Outro rótulo"));
    expect(lerFicha(sem, "corte-especial", "2026-10-13T10:00:00.000Z").atualizacaoDaFonte).toBe("não informada");
  });
});

/** ZIP mínimo montado à mão (local headers + diretório central + fim), com entradas deflate ou sem compressão. */
function zip(entradas: { nome: string; dados: Buffer; guardado?: boolean }[], crcErrado = false): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;
  for (const e of entradas) {
    const comprimido = e.guardado ? e.dados : deflateRawSync(e.dados);
    const nome = Buffer.from(e.nome);
    const crc = (crc32(e.dados) ^ (crcErrado ? 1 : 0)) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.guardado ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(e.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    partes.push(local, nome, comprimido);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(e.guardado ? 0 : 8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comprimido.length, 20);
    c.writeUInt32LE(e.dados.length, 24);
    c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(deslocamento, 42);
    central.push(c, nome);
    deslocamento += local.length + nome.length + comprimido.length;
  }
  const dir = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, dir, fim]);
}

describe("lerZip", () => {
  it("devolve nome e conteúdo de cada entrada, deflate ou sem compressão", () => {
    const a = Buffer.from('[{"id":"1"}]'.repeat(50));
    const b = Buffer.from("[]");
    const lidas = lerZip(zip([{ nome: "20051231.json", dados: a }, { nome: "20101231.json", dados: b, guardado: true }]));
    expect(lidas.map((e) => e.nome)).toEqual(["20051231.json", "20101231.json"]);
    expect(lidas[0].dados.equals(a)).toBe(true);
    expect(lidas[1].dados.equals(b)).toBe(true);
  });

  it("para quando o CRC não confere ou o arquivo não é um ZIP", () => {
    expect(() => lerZip(zip([{ nome: "a.json", dados: Buffer.from("[]") }], true))).toThrow(/CRC/);
    expect(() => lerZip(Buffer.from("<html>desafio anti-robô</html>"))).toThrow(/ZIP/);
  });
});

// ——— Índice ———

const CPC15 = "LEG:FED LEI:013105 ANO:2015\n*****  CPC-15    CÓDIGO DE PROCESSO CIVIL DE 2015\n        ";
const CPC73 = "LEG:FED LEI:005869 ANO:1973\n*****  CPC-73    CODIGO DE PROCESSO CIVIL\n        ";
const CDC = "LEG:FED LEI:008078 ANO:1990\n*****  CDC-90    CÓDIGO DE DEFESA DO CONSUMIDOR\n        ";
const CC02 = "LEG:FED LEI:010406 ANO:2002\n*****  CC-02     CÓDIGO CIVIL DE 2002\n        ";

/** Registro sintético no formato do espelho. Os campos proibidos entram de propósito para provar que não saem. */
function reg(sobre: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "000000001",
    numeroProcesso: "1000001",
    numeroRegistro: "202400000001",
    siglaClasse: "REsp",
    descricaoClasse: "RECURSO ESPECIAL",
    nomeOrgaoJulgador: "TERCEIRA TURMA",
    ministroRelator: "MINISTRO FULANO",
    dataPublicacao: "DJE        DATA:30/08/2024",
    ementa: "EMENTA-QUE-NAO-PODE-SAIR",
    dataDecisao: "20240827",
    decisao: "DECISAO-QUE-NAO-PODE-SAIR",
    referenciasLegislativas: [`${CPC15}ART:00085 PAR:00008`],
    acordaosSimilares: ["SIMILAR-QUE-NAO-PODE-SAIR"],
    ...sobre,
  };
}

const META = {
  geradaEm: "2026-10-14T01:00:00.000Z",
  fichas: ORGAOS.map((o) => ({ orgao: o, licenca: "Creative Commons Atribuição, conforme a ficha do conjunto em 2026-10-14", atualizacaoDaFonte: "Última Atualização setembro 8, 2026, 18:23 (UTC)", url: paginaDaFicha(o) })),
  arquivos: [],
};

function indiceDe(...lotes: Record<string, unknown>[][]) {
  const c = new ConstrutorDoIndice();
  lotes.forEach((l, i) => c.adicionar(l, `terceira-turma/${i}.json`));
  return c.montar(META);
}

describe("ConstrutorDoIndice", () => {
  it("remove ambas as entradas quando o novo ID e a nova identidade colidem com registros diferentes", () => {
    const ix = indiceDe([reg({ id: "A", numeroRegistro: "R1" }), reg({ id: "B", numeroRegistro: "R2" })],
      [reg({ id: "A", numeroRegistro: "R2" })]);
    expect(ix.acordaos.map((a) => a[0])).toEqual(["A"]);
    expect(ix.contagens.duplicadosPorId).toBe(1);
    expect(ix.contagens.duplicadosPorRegistroDataClasse).toBe(1);
  });

  it("indexa dispositivo → acórdão só nas três leis do piloto, com os metadados mínimos", () => {
    const r = reg({
      referenciasLegislativas: [`${CPC15}ART:00085 PAR:00008 ART:00086`, `${CDC}ART:00014`, `${CC02}ART:00186`, `${CPC73}ART:00020`],
    });
    const ix = indiceDe([r]);
    expect(ix.campos).toEqual(["id", "classe", "numero", "registro", "orgao", "relator", "dataJulgamento", "dataPublicacao"]);
    expect(ix.acordaos).toEqual([["000000001", "REsp", "1000001", "202400000001", "TERCEIRA TURMA", "MINISTRO FULANO", "2024-08-27", "2024-08-30"]]);
    expect(Object.keys(ix.dispositivos).sort()).toEqual(["CC/02", "CDC", "CPC/15"]);
    expect(ix.dispositivos["CPC/15"]["85"]["§8"]).toEqual([0]);
    expect(ix.dispositivos["CPC/15"]["86"][""]).toEqual([0]);
    expect(ix.dispositivos.CDC["14"][""]).toEqual([0]);
    expect(ix.dispositivos["CC/02"]["186"][""]).toEqual([0]);
  });

  it("não leva ementa, decisão nem acórdãos similares", () => {
    const texto = JSON.stringify(indiceDe([reg()]));
    for (const proibido of ["EMENTA-QUE-NAO-PODE-SAIR", "DECISAO-QUE-NAO-PODE-SAIR", "SIMILAR-QUE-NAO-PODE-SAIR", "ementa", "decisao", "acordaosSimilares"]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it("ignora acórdão sem nenhum dispositivo do piloto e conta os registros lidos", () => {
    const ix = indiceDe([reg({ id: "1", referenciasLegislativas: [`${CPC73}ART:00020`] }), reg({ id: "2", referenciasLegislativas: null }), reg({ id: "3" })]);
    expect(ix.acordaos.map((a) => a[0])).toEqual(["3"]);
    expect(ix.contagens.registrosLidos).toBe(3);
  });

  it("detalha parágrafo, inciso, alínea e item na chave do dispositivo", () => {
    const r = reg({ referenciasLegislativas: [`${CPC15}ART:00085 PAR:00002 INC:00003 LET:B ITEM:00004 ART:00927 INC:00003`] });
    const d = indiceDe([r]).dispositivos["CPC/15"];
    expect(Object.keys(d["85"])).toEqual(["§2 inc 3 al B item 4"]);
    expect(Object.keys(d["927"])).toEqual(["inc 3"]);
  });

  it("remove duplicado pelo id: a versão do arquivo mais recente vale", () => {
    const antigo = reg({ referenciasLegislativas: [`${CPC15}ART:00085`], ministroRelator: "ANTIGO" });
    const novo = reg({ referenciasLegislativas: [`${CPC15}ART:00086`], ministroRelator: "NOVO" });
    const ix = indiceDe([antigo], [novo]);
    expect(ix.acordaos).toHaveLength(1);
    expect(ix.acordaos[0][5]).toBe("NOVO");
    expect(Object.keys(ix.dispositivos["CPC/15"])).toEqual(["86"]);
    expect(ix.contagens.duplicadosPorId).toBe(1);
  });

  it("remove duplicado com id diferente por registro + data de julgamento + classe", () => {
    const ix = indiceDe([reg({ id: "10" }), reg({ id: "99" }), reg({ id: "11", siglaClasse: "AgInt no REsp" }), reg({ id: "12", dataDecisao: "20240828" })]);
    expect(ix.acordaos.map((a) => a[0]).sort()).toEqual(["11", "12", "99"]);
    expect(ix.contagens.duplicadosPorRegistroDataClasse).toBe(1);
  });

  it("a identidade vale também para registros sem dispositivo do piloto (a versão nova pode tê-lo perdido)", () => {
    const ix = indiceDe([reg({ id: "10" })], [reg({ id: "77", referenciasLegislativas: null })]);
    expect(ix.acordaos).toEqual([]);
  });

  it("ordena os acórdãos de forma estável e aponta os índices certos", () => {
    const a = reg({ id: "1", numeroRegistro: "B", dataDecisao: "20240102", referenciasLegislativas: [`${CC02}ART:00186`] });
    const b = reg({ id: "2", numeroRegistro: "A", dataDecisao: "20240101", referenciasLegislativas: [`${CC02}ART:00186`] });
    const ix = indiceDe([a, b]);
    expect(ix.acordaos.map((x) => x[0])).toEqual(["2", "1"]);
    expect(ix.dispositivos["CC/02"]["186"][""]).toEqual([0, 1]);
  });

  it("para com registro que não é objeto ou sem id nem registro", () => {
    const c = new ConstrutorDoIndice();
    expect(() => c.adicionar(["texto"], "x.json")).toThrow(ParadaDoGerador);
    expect(() => c.adicionar([{ siglaClasse: "REsp" }], "x.json")).toThrow(ParadaDoGerador);
    expect(() => c.adicionar({ id: "1" }, "x.json")).toThrow(/lista/);
  });

  it("data fora do formato vira null em vez de ser inventada", () => {
    const ix = indiceDe([reg({ dataDecisao: "2024-08", dataPublicacao: "sem data" })]);
    expect(ix.acordaos[0].slice(6)).toEqual([null, null]);
  });

  it("registra licença, atualização, atribuição CC BY sem versão e data da fotografia", () => {
    const ix = indiceDe([reg()]);
    expect(ix.geradaEm).toBe("2026-10-14T01:00:00.000Z");
    expect(ix.atribuicao).toBe("Portal de Dados Abertos do STJ — Espelhos de Acórdãos, licença CC BY");
    expect(ix.atribuicao).not.toMatch(/\d\.\d/);
    expect(ix.conjuntos["terceira-turma"].licenca).toMatch(/^Creative Commons Atribuição/);
    expect(ix.conjuntos["terceira-turma"].atualizacaoDaFonte).toBe("Última Atualização setembro 8, 2026, 18:23 (UTC)");
  });
});

describe("mesesAusentes", () => {
  it("lista os meses sem arquivo entre o primeiro e o último mensal, ignorando o ZIP do histórico", () => {
    expect(mesesAusentes(["20220508.zip", "20220531.json", "20220731.json", "20220831.json", "20221031.json"])).toEqual(["2022-06", "2022-09"]);
  });
  it("dois arquivos no mesmo mês não geram ausência", () => {
    expect(mesesAusentes(["20241130.json", "20241231.json", "20241231.json", "20250131.json"])).toEqual([]);
  });
  it("sem mensais, nada ausente", () => {
    expect(mesesAusentes(["20220508.zip"])).toEqual([]);
  });
});

// ——— Download com cache retomável ———

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const JSON_VAZIO = Buffer.from("[]");
const CONJ_DE = (o: string) => (o === "corte-especial" ? CONJ : "7a7a7a7a-0000-4000-8000-000000000002");
const arquivoDe = (o: string, nome: string) => `${BASE}/dataset/${CONJ_DE(o)}/resource/rec-${nome}/download/${nome}`;

/** Servidor falso do portal: ficha por órgão e arquivos por URL; registra cada chamada na ordem. */
function portal(arquivos: Record<string, Record<string, Buffer>>, desvios: Record<string, () => Response> = {}) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const fetchFalso = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    if (desvios[url]) return desvios[url]();
    for (const [orgao, nomes] of Object.entries(arquivos)) {
      if (url === paginaDaFicha(orgao as never)) {
        const html = ficha(Object.keys(nomes)).toString().split(`${BASE}/dataset/${CONJ}`).join(`${BASE}/dataset/${CONJ_DE(orgao)}`);
        return new Response(html.replace(/resource\/r-/g, "resource/rec-"), { status: 200 });
      }
      for (const [nome, bytes] of Object.entries(nomes)) if (url === arquivoDe(orgao, nome)) return new Response(bytes, { status: 200 });
    }
    return new Response("não achei", { status: 404 });
  }) as typeof fetch;
  const esperas: number[] = [];
  let relogio = 0;
  const cliente = clienteDoGerador({
    fetch: fetchFalso,
    vagas: new Vagas(2),
    esperar: async (ms) => {
      esperas.push(ms);
      relogio += ms;
    },
    agora: () => relogio,
  });
  return { cliente, chamadas, esperas };
}

const pastas: string[] = [];
const novoCache = () => {
  const p = mkdtempSync(join(tmpdir(), "garimpo-espelhos-teste-"));
  pastas.push(p);
  return p;
};
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const DOIS = ["corte-especial", "primeira-secao"] as const;
const ACERVO = {
  "corte-especial": { "20220508.zip": zip([{ nome: "20220508.json", dados: JSON_VAZIO }]), "20220531.json": JSON_VAZIO },
  "primeira-secao": { "20220531.json": Buffer.from("[]\n") },
};

describe("baixarConjuntos", () => {
  it.each([429, 503, 504])("HTTP %i tem só uma nova tentativa, espera e registra as duas respostas", async (status) => {
    const cache = novoCache();
    const log = join(cache, "chamadas.log");
    const url = paginaDaFicha("corte-especial");
    let chamadas = 0;
    let relogio = 0;
    const instantes: number[] = [];
    const base = (async () => {
      chamadas++;
      instantes.push(relogio);
      return new Response("indisponível", { status });
    }) as typeof fetch;
    const cliente = clienteDoGerador({ fetch: fetchComRegistro(log, base, () => relogio), vagas: new Vagas(2),
      agora: () => relogio, esperar: async (ms) => { relogio += ms; } });
    await expect(baixarConjuntos(cliente, cache, { orgaos: DOIS })).rejects.toThrow(/duas vezes/);
    expect(chamadas).toBe(2);
    expect(instantes[1] - instantes[0]).toBeGreaterThanOrEqual(10_000);
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(2);
    expect(readFileSync(log, "utf8")).toContain(`${url} ${status}`);
    expect(existsSync(join(cache, "fichas", "corte-especial.html"))).toBe(false);
  });

  it("continua depois de um único 504 se a nova tentativa for aceita", async () => {
    let n = 0;
    const p = portal(ACERVO, { [paginaDaFicha("corte-especial")]: () =>
      ++n === 1 ? new Response("indisponível", { status: 504 }) : new Response(ficha(["20220531.json"]).toString().replace(/resource\/r-/g, "resource/rec-")) });
    const r = await baixarConjuntos(p.cliente, novoCache(), { orgaos: DOIS });
    expect(n).toBe(2);
    expect(r.arquivos).toHaveLength(2);
  });

  it("lê todas as fichas antes de baixar, depois um arquivo por vez em ordem de data, sem /api/ e sem seguir redirecionamento", async () => {
    const { cliente, chamadas } = portal(ACERVO);
    const r = await baixarConjuntos(cliente, novoCache(), { orgaos: DOIS });
    expect(chamadas.map((c) => c.url)).toEqual([
      paginaDaFicha("corte-especial"),
      paginaDaFicha("primeira-secao"),
      arquivoDe("corte-especial", "20220508.zip"),
      arquivoDe("corte-especial", "20220531.json"),
      arquivoDe("primeira-secao", "20220531.json"),
    ]);
    expect(chamadas.every((c) => urlPermitida(c.url) && !c.url.includes("/api/"))).toBe(true);
    expect(chamadas.every((c) => c.init.redirect === "manual")).toBe(true);
    expect((chamadas[0].init.headers as Headers).get("User-Agent")).toMatch(/^Garimpo\//);
    expect(r.fichas.map((f) => f.orgao)).toEqual(DOIS);
    expect(r.arquivos.map((a) => `${a.orgao}/${a.nome}`)).toEqual(["corte-especial/20220508.zip", "corte-especial/20220531.json", "primeira-secao/20220531.json"]);
  });

  it("guarda sha256, tamanho e data de coleta de cada arquivo, e o conteúdo vai para o cache", async () => {
    const { cliente } = portal(ACERVO);
    const cache = novoCache();
    const r = await baixarConjuntos(cliente, cache, { orgaos: DOIS, agora: () => Date.parse("2026-10-14T01:02:03.000Z") });
    const a = r.arquivos.find((x) => x.orgao === "primeira-secao") as (typeof r.arquivos)[number];
    expect(a.sha256).toBe(sha(Buffer.from("[]\n")));
    expect(a.bytes).toBe(3);
    expect(a.coletadoEm).toBe("2026-10-14T01:02:03.000Z");
    expect(a.url).toBe(arquivoDe("primeira-secao", "20220531.json"));
    expect(readFileSync(a.caminho).equals(Buffer.from("[]\n"))).toBe(true);
    expect(a.caminho.startsWith(cache)).toBe(true);
  });

  it("espera 10 s entre as chamadas ao portal (Crawl-Delay do robots.txt)", async () => {
    const { cliente, esperas } = portal(ACERVO);
    await baixarConjuntos(cliente, novoCache(), { orgaos: DOIS });
    expect(INTERVALO_MS).toBe(10_000);
    expect(esperas.filter((e) => e === INTERVALO_MS).length).toBeGreaterThanOrEqual(1);
  });

  it("retoma do cache: uma segunda rodada não faz nenhuma chamada e devolve os mesmos hashes", async () => {
    const cache = novoCache();
    const primeira = await baixarConjuntos(portal(ACERVO).cliente, cache, { orgaos: DOIS });
    const { cliente, chamadas } = portal(ACERVO);
    const segunda = await baixarConjuntos(cliente, cache, { orgaos: DOIS });
    expect(chamadas).toEqual([]);
    expect(segunda.arquivos.map((a) => a.sha256)).toEqual(primeira.arquivos.map((a) => a.sha256));
    expect(segunda.fichas.map((f) => f.licenca)).toEqual(primeira.fichas.map((f) => f.licenca));
  });

  it("baixa de novo o arquivo do cache que não confere com o hash guardado", async () => {
    const cache = novoCache();
    const primeira = await baixarConjuntos(portal(ACERVO).cliente, cache, { orgaos: DOIS });
    const estragado = primeira.arquivos[1];
    writeFileSync(estragado.caminho, "lixo");
    const { cliente, chamadas } = portal(ACERVO);
    await baixarConjuntos(cliente, cache, { orgaos: DOIS });
    expect(chamadas.map((c) => c.url)).toEqual([estragado.url]);
    expect(readFileSync(estragado.caminho).equals(JSON_VAZIO)).toBe(true);
  });

  it("recusa duas vezes seguidas (429): para, registra e a rodada seguinte retoma só o que falta", async () => {
    const cache = novoCache();
    const url = arquivoDe("corte-especial", "20220531.json");
    const recusa = () => new Response("muitas chamadas", { status: 429 });
    const { cliente, chamadas } = portal(ACERVO, { [url]: recusa });
    await expect(baixarConjuntos(cliente, cache, { orgaos: DOIS })).rejects.toThrow(ParadaDoGerador);
    // 2 fichas + zip + 2 tentativas do arquivo recusado; o último arquivo nem foi pedido.
    expect(chamadas.map((c) => c.url)).toEqual([
      paginaDaFicha("corte-especial"),
      paginaDaFicha("primeira-secao"),
      arquivoDe("corte-especial", "20220508.zip"),
      url,
      url,
    ]);
    const retomada = portal(ACERVO);
    const r = await baixarConjuntos(retomada.cliente, cache, { orgaos: DOIS });
    expect(retomada.chamadas.map((c) => c.url)).toEqual([url, arquivoDe("primeira-secao", "20220531.json")]);
    expect(r.arquivos).toHaveLength(3);
  });

  it("para em HTTP que não é 200 (403) sem gravar o arquivo no cache", async () => {
    const cache = novoCache();
    const url = arquivoDe("primeira-secao", "20220531.json");
    const { cliente } = portal(ACERVO, { [url]: () => new Response("proibido", { status: 403 }) });
    await expect(baixarConjuntos(cliente, cache, { orgaos: DOIS })).rejects.toThrow(/403/);
    expect(existsSync(join(cache, "arquivos", "primeira-secao", "20220531.json"))).toBe(false);
  });

  it("para com HTTP 200 que não é o arquivo esperado (página de desafio no lugar do JSON ou do ZIP)", async () => {
    const html = () => new Response("<html>Verificando se você é humano</html>", { status: 200 });
    for (const [orgao, nome] of [["primeira-secao", "20220531.json"], ["corte-especial", "20220508.zip"]] as const) {
      const cache = novoCache();
      const { cliente } = portal(ACERVO, { [arquivoDe(orgao, nome)]: html });
      await expect(baixarConjuntos(cliente, cache, { orgaos: DOIS })).rejects.toThrow(/esperado/);
      expect(existsSync(join(cache, "arquivos", orgao, nome))).toBe(false);
    }
  });

  it("para na ficha quando a licença mudou, antes de baixar qualquer arquivo", async () => {
    const { cliente, chamadas } = portal(ACERVO, {
      [paginaDaFicha("primeira-secao")]: () => new Response(ficha(["20220531.json"], { licenca: "Outra licença" }), { status: 200 }),
    });
    await expect(baixarConjuntos(cliente, novoCache(), { orgaos: DOIS })).rejects.toThrow(/Creative Commons/);
    expect(chamadas.map((c) => c.url)).toEqual([paginaDaFicha("corte-especial"), paginaDaFicha("primeira-secao")]);
  });

  it("não aceita cache dentro do repositório", async () => {
    await expect(baixarConjuntos(portal(ACERVO).cliente, join(process.cwd(), "cache-dentro"), { orgaos: DOIS })).rejects.toThrow(/fora do repositório/);
  });

  it("não confunde uma pasta interna cujo nome começa por dois pontos com a pasta pai", async () => {
    const cache = join(process.cwd(), "..cache-espelhos-teste");
    pastas.push(cache);
    await expect(baixarConjuntos(portal(ACERVO).cliente, cache, { orgaos: DOIS })).rejects.toThrow(/fora do repositório/);
  });
});

// ——— Rodada inteira: baixar, ler (ZIP e JSON), montar e gravar ———

const jsonDe = (...registros: Record<string, unknown>[]) => Buffer.from(JSON.stringify(registros));

describe("gerarEGravar", () => {
  it("recusa índice acima de 3 MB gzip antes de gravar qualquer arquivo no destino", async () => {
    // Ruído determinístico e pouco compressível; nenhum RNG ou acesso à rede.
    const ruido = Buffer.alloc(4_000_000);
    let estado = 123456789;
    for (let i = 0; i < ruido.length; i++) {
      estado ^= estado << 13; estado ^= estado >>> 17; estado ^= estado << 5;
      ruido[i] = estado & 255;
    }
    const dir = novoCache();
    const destino = join(dir, "indice.json");
    const anterior = '{"contagens":{"acordaosIndexados":0}}';
    writeFileSync(destino, anterior);
    const dados = { "corte-especial": { "20220531.json": jsonDe(reg({ ministroRelator: ruido.toString("base64") })) } };
    await expect(gerarEGravar(portal(dados).cliente, { cache: novoCache(), destino, orgaos: ["corte-especial"] })).rejects.toThrow(/3 MB/);
    expect(readFileSync(destino, "utf8")).toBe(anterior);
    expect(readdirSync(dir)).toEqual(["indice.json"]);
  });

  it("grava relatório de alterações no cache antes de substituir a fotografia", async () => {
    const destino = join(novoCache(), "indice.json");
    const dados = (id: string) => ({ "corte-especial": { "20220531.json": jsonDe(reg({ id })) } });
    const opcoes = { destino, orgaos: ["corte-especial"] as const, agora: () => Date.parse("2026-10-14T01:00:00Z") };
    await gerarEGravar(portal(dados("A")).cliente, { ...opcoes, cache: novoCache() });
    const cache = novoCache();
    await gerarEGravar(portal(dados("B")).cliente, { ...opcoes, cache });
    const relatorio = JSON.parse(readFileSync(join(cache, "relatorio-alteracoes.json"), "utf8"));
    expect(relatorio.acordaos.incluidos).toEqual(["B"]);
    expect(relatorio.acordaos.removidos).toEqual(["A"]);
    expect(relatorio.anterior.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(relatorio.nova.sha256).toBe(sha(readFileSync(destino)));
  });

  const acervo = () => ({
    "corte-especial": {
      "20220508.zip": zip([
        { nome: "20220331.json", dados: jsonDe(reg({ id: "1", numeroRegistro: "R1" })) },
        { nome: "20211231.json", dados: jsonDe(reg({ id: "2", numeroRegistro: "R2", referenciasLegislativas: [`${CC02}ART:00186`] })) },
      ]),
      "20220531.json": jsonDe(reg({ id: "1", numeroRegistro: "R1", ministroRelator: "VERSAO NOVA" }), reg({ id: "3", numeroRegistro: "R3", referenciasLegislativas: [`${CPC73}ART:00020`] })),
      "20220731.json": jsonDe(reg({ id: "4", numeroRegistro: "R4", referenciasLegislativas: [`${CDC}ART:00014`] })),
    },
    "primeira-secao": { "20220531.json": jsonDe() },
  });

  it("baixa, lê o ZIP e os JSON em ordem, e grava o índice só do piloto com data, atribuição e meses ausentes", async () => {
    const destino = join(novoCache(), "indice.json");
    const { cliente } = portal(acervo());
    const ix = await gerarEGravar(cliente, { cache: novoCache(), destino, orgaos: DOIS, agora: () => Date.parse("2026-10-14T01:00:00.000Z") });
    const gravado = JSON.parse(readFileSync(destino, "utf8"));
    expect(gravado).toEqual(JSON.parse(JSON.stringify(ix)));
    expect(ix.geradaEm).toBe("2026-10-14T01:00:00.000Z");
    expect(ix.atribuicao).toBe(ATRIBUICAO);
    expect(ix.acordaos.map((a) => a[0]).sort()).toEqual(["1", "2", "4"]);
    expect(ix.acordaos.find((a) => a[0] === "1")?.[5]).toBe("VERSAO NOVA");
    expect(ix.contagens.duplicadosPorId).toBe(1);
    expect(ix.conjuntos["corte-especial"].mesesAusentes).toEqual(["2022-06"]);
    expect(ix.conjuntos["corte-especial"].arquivos.map((a) => a.nome)).toEqual(["20220508.zip", "20220531.json", "20220731.json"]);
    expect(ix.conjuntos["corte-especial"].arquivos.every((a) => /^[0-9a-f]{64}$/.test(a.sha256))).toBe(true);
    expect(ix.conjuntos["primeira-secao"].mesesAusentes).toEqual([]);
    expect(Object.keys(ix.conjuntos)).toEqual(DOIS);
  });

  it("não deixa arquivo provisório nem toca no índice anterior quando o gerador para", async () => {
    const dir = novoCache();
    const destino = join(dir, "indice.json");
    writeFileSync(destino, '{"anterior":true}');
    const url = arquivoDe("corte-especial", "20220531.json");
    const { cliente } = portal(acervo(), { [url]: () => new Response("x", { status: 503 }) });
    await expect(gerarEGravar(cliente, { cache: novoCache(), destino, orgaos: DOIS })).rejects.toThrow(ParadaDoGerador);
    expect(readFileSync(destino, "utf8")).toBe('{"anterior":true}');
    expect(readdirSync(dir)).toEqual(["indice.json"]);
  });

  it("para sem trocar o índice quando o novo tem muito menos acórdãos que o anterior, salvo revisão do mantenedor", async () => {
    const dir = novoCache();
    const destino = join(dir, "indice.json");
    const anterior = { contagens: { acordaosIndexados: 100 } };
    writeFileSync(destino, JSON.stringify(anterior));
    const { cliente } = portal(acervo());
    const cache = novoCache();
    await expect(gerarEGravar(cliente, { cache, destino, orgaos: DOIS })).rejects.toThrow(/revisado/);
    expect(JSON.parse(readFileSync(destino, "utf8"))).toEqual(anterior);
    const ix = await gerarEGravar(portal(acervo()).cliente, { cache, destino, orgaos: DOIS, revisado: true });
    expect(JSON.parse(readFileSync(destino, "utf8")).contagens.acordaosIndexados).toBe(ix.contagens.acordaosIndexados);
  });

  it("para com ZIP ou JSON que a fonte entrega fora do formato", async () => {
    const dir = novoCache();
    const ruim = acervo();
    ruim["primeira-secao"] = { "20220531.json": Buffer.from('{"nao":"lista"}') };
    await expect(gerarEGravar(portal(ruim).cliente, { cache: dir, destino: join(novoCache(), "i.json"), orgaos: DOIS })).rejects.toThrow(/esperado/);
    const zipRuim = acervo();
    zipRuim["corte-especial"]["20220508.zip"] = zip([{ nome: "20220331.json", dados: jsonDe(reg()) }], true);
    await expect(gerarEGravar(portal(zipRuim).cliente, { cache: novoCache(), destino: join(novoCache(), "i.json"), orgaos: DOIS })).rejects.toThrow(/CRC/);
  });
});

describe("fetchComRegistro", () => {
  it("anota cada resposta HTTP (inclusive a recusada) com data, URL, status e bytes", async () => {
    const log = join(novoCache(), "chamadas.log");
    const base = (async (url: string) => (url.endsWith("a") ? new Response("ok", { status: 200 }) : new Response("não", { status: 429 }))) as typeof fetch;
    const f = fetchComRegistro(log, base, () => Date.parse("2026-10-14T01:00:00.000Z"));
    await (await f("https://dadosabertos.web.stj.jus.br/a")).text();
    await (await f("https://dadosabertos.web.stj.jus.br/b")).text();
    const linhas = readFileSync(log, "utf8").trim().split("\n");
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatch(/^2026-10-14T01:00:00.000Z GET https:\/\/dadosabertos.web.stj.jus.br\/a 200 /);
    expect(linhas[1]).toMatch(/\/b 429 /);
  });
});
