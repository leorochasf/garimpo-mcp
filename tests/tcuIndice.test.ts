import { createHash } from "node:crypto";
import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { COMPOSICAO_TCU, CONSULTAS_TCU, gravarTcuSintetico } from "../scripts/tcuSintetico.js";
import { caminhoDoAnoTcu, caminhoDoIndiceTcu, caminhoDoReciboTcu, criarIndiceTcu, type FiltrosTcu, pesquisarTcu, type ResultadoTcu } from "../src/tcuLocal.js";
import { IndiceTcu } from "../src/tcuIndice.js";
import { acordaoFicticio, gravarAnoTcu, type RegistroTcu } from "./apoioTcu.js";

/** As mesmas frações da composição da bateria (B0.3), com menos registros e textos curtos. */
const PEQUENA = {
  ...COMPOSICAO_TCU,
  anos: [2024, 2025],
  registrosPorAno: 300,
  tamanho: { ...COMPOSICAO_TCU.tamanho, comum: { medianaBytes: 5_000, sigma: 0.9 }, relacao: { medianaBytes: 1_500, sigma: 0.5 } },
};

/** A resposta sem o que pode mudar entre varredura e índice: só o tempo e o relato do caminho. */
const semTempo = ({ tempoSegundos, indiceLocal, ...resto }: ResultadoTcu) => (void tempoSegundos, void indiceLocal, resto);

async function mesmaResposta(dados: string, f: FiltrosTcu) {
  const varredura = await pesquisarTcu(dados, f, { indice: false });
  const indice = await pesquisarTcu(dados, f);
  expect(semTempo(indice)).toEqual(semTempo(varredura));
  return { varredura, indice };
}

describe("índice local do TCU: a resposta é a mesma da varredura", () => {
  let dados: string;
  beforeAll(async () => {
    dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-indice-"));
    await gravarTcuSintetico(dados, PEQUENA);
    for (const ano of PEQUENA.anos) await criarIndiceTcu(dados, ano);
  });
  afterAll(() => rm(dados, { recursive: true, force: true }));

  it.each(CONSULTAS_TCU.map((c) => [c.nome, c] as const))("bateria de B0.3: %s", async (_, c) => {
    const { indice } = await mesmaResposta(dados, { ...("filtros" in c ? c.filtros : {}), consulta: c.consulta });
    expect(indice.indiceLocal).toEqual({ comIndice: [2024, 2025], semIndice: [] });
    if (c.nome !== "vazia") expect(indice.total).toBeGreaterThan(0);
  });

  it.each([
    ["limite 1", { consulta: "licitação", limite: 1 }],
    ["limite 50", { consulta: "licitação contrato", limite: 50 }],
    ["um ano só", { consulta: "sobrepreço", anos: [2024] }],
    ["relator e colegiado por parte do nome", { consulta: "contrato", relator: "ficticio b", colegiado: "câmara" }],
    ["acórdão de relação", { consulta: "sobrepreço", tipo: "ACÓRDÃO DE RELAÇÃO" }],
    ["frase de três palavras", { consulta: '"auditoria contas recurso"' }],
    ["frase e palavra solta", { consulta: '"pregão eletrônico" dano' }],
  ] as [string, FiltrosTcu][])("outras consultas: %s", async (_, f) => {
    await mesmaResposta(dados, f);
  });
});

/** O recibo como o baixador deixa, com o sha256 e o tamanho do arquivo gravado. */
async function gravarComRecibo(dados: string, ano: number, registros: RegistroTcu[]) {
  const caminho = await gravarAnoTcu(dados, ano, registros);
  const bytes = await readFile(caminho);
  await writeFile(
    caminhoDoReciboTcu(dados, ano),
    JSON.stringify({ ano, url: "https://exemplo.invalid/", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), baixadoEm: "2026-10-23T00:00:00.000Z" }),
  );
  return caminho;
}

describe("índice local do TCU: casos de borda dão a mesma resposta da varredura", () => {
  let dados: string;
  const registros: RegistroTcu[] = [
    // A triagem barata recusa (o script some do texto, mas não do bruto sem etiquetas): a varredura não acha.
    acordaoFicticio(1, { VOTO: "<p>Voto sobre creden<script>x</script>ciamento de obra.</p>" }),
    // Entidade HTML: a triagem não vale e o texto convertido acha.
    acordaoFicticio(2, { VOTO: "<p>Voto sobre credenciamento&nbsp;de obra e boa-f&eacute;.</p>" }),
    acordaoFicticio(3, { VOTO: "<p>Princípio da boa-fé objetiva; art. 37 da Constituição.</p>", DATASESSAO: "01/12/2025" }),
    acordaoFicticio(4, { VOTO: "<p>Boa fé, sem hífen; art 37 sem ponto.</p>", DATASESSAO: "01/12/2025" }),
    // Frase que atravessa campos (sumário termina, acórdão começa) e frase separada por quebra de bloco.
    acordaoFicticio(5, { SUMARIO: "Contratação por pregão", ACORDAO: "<p>eletrônico com sobrepreço.</p>" }),
    acordaoFicticio(6, { VOTO: "<p>pregão</p><p>eletrônico</p>" }),
    acordaoFicticio(7, { VOTO: "<p>pregão, eletrônico.</p>" }),
    // Sigilo: aviso no lugar do relatório (não é texto) e situação sigilosa (fora).
    acordaoFicticio(8, { RELATORIO: "Documento classificado como sigiloso. obra pública." }),
    acordaoFicticio(9, { SITUACAO: "SIGILOSO", VOTO: "<p>obra pública sigilosa.</p>" }),
    acordaoFicticio(10, { SITUACAO: "INVALIDADO", VOTO: "<p>obra pública invalidada.</p>" }),
    acordaoFicticio(11, { TIPO: "ACÓRDÃO DE RELAÇÃO", SUMARIO: "", RELATORIO: "", VOTO: "", ACORDAO: "<p>Relação sobre obra pública e § 2º.</p>" }),
    // Empate de data e número: fica o que veio antes.
    acordaoFicticio(12, { KEY: "EMPATE-A", NUMACORDAO: "12", DATASESSAO: "09/12/2025", VOTO: "<p>obra pública empatada.</p>" }),
    acordaoFicticio(13, { KEY: "EMPATE-B", NUMACORDAO: "12", DATASESSAO: "09/12/2025", VOTO: "<p>obra pública empatada.</p>" }),
    acordaoFicticio(14, { VOTO: "<p>ÁRVORE Ação AÇÃO ação acao</p>" }),
  ];
  beforeAll(async () => {
    dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-indice-borda-"));
    await gravarComRecibo(dados, 2025, registros);
    await criarIndiceTcu(dados, 2025);
  });
  afterAll(() => rm(dados, { recursive: true, force: true }));

  it.each([
    "credenciamento", "credenciamento de obra", "licitação", "licitacao de obra", '"boa-fé"', "boa-fé", '"boa fé"', '"art. 37"', "art.", '"pregão eletrônico"', "pregão eletrônico",
    "obra pública", '"obra pública"', "sobrepreço", "empatada", "ação", "ACAO", "arvore", "§", '"§ 2º"', "sigiloso", "classificado",
    "2º", "contas", '"de obra"',
  ])("%s", async (consulta) => {
    for (const limite of [1, 3, 50]) await mesmaResposta(dados, { consulta, limite });
  });

  it("o caso da triagem: a varredura não acha o registro 1, e o índice também não", async () => {
    const { indice } = await mesmaResposta(dados, { consulta: "credenciamento", limite: 50 });
    expect(indice.resultados.map((r) => r.numero)).not.toContain("1");
    expect(indice.resultados.map((r) => r.numero)).toContain("2");
  });

  it("termo sem letra nem número: o ano é lido inteiro, e a resposta diz por quê", async () => {
    const { indice } = await mesmaResposta(dados, { consulta: "§" });
    expect(indice.indiceLocal?.comIndice).toEqual([]);
    expect(indice.indiceLocal?.semIndice[0]).toMatchObject({ ano: 2025, motivo: expect.stringMatching(/sem letra nem número/) });
  });
});

describe("índice local do TCU: índice velho, ausente ou estragado nunca muda a resposta", () => {
  const registros = () => [1, 2, 3, 4, 5].map((n) => acordaoFicticio(n, { DATASESSAO: `0${n}/12/2025` }));
  const consulta = { consulta: "sobrepreço" };
  async function pasta() {
    const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-indice-seguro-"));
    await gravarComRecibo(dados, 2025, registros());
    await criarIndiceTcu(dados, 2025);
    expect((await pesquisarTcu(dados, consulta)).indiceLocal).toEqual({ comIndice: [2025], semIndice: [] });
    return dados;
  }
  const motivo = async (dados: string) => {
    const { indice } = await mesmaResposta(dados, consulta);
    expect(indice.indiceLocal?.comIndice).toEqual([]);
    return indice.indiceLocal!.semIndice.map((s) => s.motivo).join(" ");
  };

  it("sem índice: lê o arquivo inteiro e diz como criar o índice", async () => {
    const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-indice-seguro-"));
    await gravarComRecibo(dados, 2025, registros());
    expect(await motivo(dados)).toMatch(/sem índice local.*renovar: true/);
  });

  it("arquivo do ano trocado (novo download, novo recibo): o índice velho não é usado até ser recriado", async () => {
    const dados = await pasta();
    await gravarComRecibo(dados, 2025, [...registros(), acordaoFicticio(6, { DATASESSAO: "10/12/2025" })]);
    expect(await motivo(dados)).toMatch(/mudou depois do índice/);
    expect((await pesquisarTcu(dados, consulta)).resultados[0].numero).toBe("6");
    await criarIndiceTcu(dados, 2025);
    const { indice } = await mesmaResposta(dados, consulta);
    expect(indice.indiceLocal).toEqual({ comIndice: [2025], semIndice: [] });
    expect(indice.resultados[0].numero).toBe("6");
  });

  it("sem recibo: o índice não vale", async () => {
    const dados = await pasta();
    await rm(caminhoDoReciboTcu(dados, 2025));
    expect(await motivo(dados)).toMatch(/sem recibo/);
  });

  it.each([
    ["um byte trocado no corpo", (b: Buffer) => { b[b.length - 3] ^= 0xff; return b; }],
    ["um dígito trocado no cabeçalho", (b: Buffer) => Buffer.from(b.toString("latin1").replace('"excluidos":0', '"excluidos":7'), "latin1")],
    ["cortado", (b: Buffer) => b.subarray(0, Math.floor(b.length / 2))],
    ["lixo", () => Buffer.from("não é um índice")],
    ["vazio", () => Buffer.alloc(0)],
  ])("índice estragado (%s): recusado, com a mesma resposta", async (_, estragar) => {
    const dados = await pasta();
    const caminho = caminhoDoIndiceTcu(dados, 2025);
    await writeFile(caminho, estragar(await readFile(caminho)));
    expect(await motivo(dados)).toMatch(/recusado/);
  });

  // Troca local que preserva tamanho, data e recibo (revisão G1): só o conteúdo denuncia a mudança.
  it.each([
    ["chave trocada", "sobrepreço", (t: string) => t.replace("ACORDAO-COMPLETO-100005", "ACORDAO-COMPLETO-900005")],
    ["texto trocado (abacate → laranja)", "laranja", (t: string) => t.replace("<p>abacate</p>", "<p>laranja</p>")],
    ["acórdão que passou a sigiloso", "abacate", (t: string) => t.replace(/("ACORDAO-COMPLETO-100005"[\s\S]*?)"OFICIALIZADO"/, '$1"SIGILOSO    "')],
  ])("conteúdo do arquivo mudou com o mesmo tamanho, data e recibo (%s): o índice não vale", async (_, termo, trocar) => {
    const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-indice-seguro-"));
    const lista = registros().map((r, i) => (i === 4 ? { ...r, ACORDAO: "<p>abacate</p>" } : r));
    const csv = await gravarComRecibo(dados, 2025, lista);
    const data = new Date("2026-10-01T12:00:00Z"); // segundo redondo: volta exata pelo utimes em qualquer sistema
    await utimes(csv, data, data);
    await criarIndiceTcu(dados, 2025);
    // O índice já valeu neste processo antes da troca.
    expect((await pesquisarTcu(dados, { consulta: termo })).indiceLocal?.comIndice).toEqual([2025]);
    const antes = await readFile(csv);
    const depois = Buffer.from(trocar(antes.toString("utf8")), "utf8");
    expect(depois.equals(antes)).toBe(false);
    expect(depois.length).toBe(antes.length);
    await writeFile(csv, depois);
    await utimes(csv, data, data);
    expect((await stat(csv)).mtimeMs).toBe(data.getTime());
    const { indice } = await mesmaResposta(dados, { consulta: termo });
    expect(indice.indiceLocal).toEqual({ comIndice: [], semIndice: [{ ano: 2025, motivo: expect.stringMatching(/conteúdo do arquivo do ano mudou/) }] });
    return indice;
  });

  it("o acórdão que passou a sigiloso não é devolvido e conta como excluído", async () => {
    const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-indice-seguro-"));
    const lista = registros().map((r, i) => (i === 4 ? { ...r, ACORDAO: "<p>abacate</p>" } : r));
    const csv = await gravarComRecibo(dados, 2025, lista);
    const data = new Date("2026-10-01T12:00:00Z");
    await utimes(csv, data, data);
    await criarIndiceTcu(dados, 2025);
    expect((await pesquisarTcu(dados, { consulta: "abacate" })).total).toBe(1);
    await writeFile(csv, (await readFile(csv, "utf8")).replace(/("ACORDAO-COMPLETO-100005"[\s\S]*?)"OFICIALIZADO"/, '$1"SIGILOSO    "'));
    await utimes(csv, data, data);
    const r = await pesquisarTcu(dados, { consulta: "abacate" });
    expect(r).toMatchObject({ total: 0, resultados: [], excluidosPorSituacao: 1 });
    expect(JSON.stringify(r)).not.toContain("abacate</");
  });

  it("arquivo tocado sem mudar o conteúdo (data regravada): o índice continua valendo, conferido pelo sha256", async () => {
    const dados = await pasta();
    const csv = caminhoDoAnoTcu(dados, 2025);
    // Segundo redondo: volta exata pelo utimes em qualquer sistema. A data lida do stat não volta no Linux: o utimes
    // grava em microssegundos e pode cair 1 µs abaixo, e regravar essa data já a muda de novo.
    const data = new Date("2026-10-01T12:00:00Z");
    await writeFile(csv, await readFile(csv));
    await utimes(csv, data, data);
    await criarIndiceTcu(dados, 2025); // índice com a data nova
    await utimes(csv, data, data);
    expect((await stat(csv)).mtimeMs).toBe(data.getTime());
    expect((await pesquisarTcu(dados, consulta)).indiceLocal).toEqual({ comIndice: [2025], semIndice: [] });
  });

  it("não cria índice de arquivo que não confere com o recibo", async () => {
    const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-indice-seguro-"));
    await gravarComRecibo(dados, 2025, registros());
    await writeFile(caminhoDoAnoTcu(dados, 2025), (await readFile(caminhoDoAnoTcu(dados, 2025), "utf8")) + "\n");
    await expect(criarIndiceTcu(dados, 2025)).rejects.toThrow(/não confere com o recibo/);
    await rm(caminhoDoReciboTcu(dados, 2025));
    await expect(criarIndiceTcu(dados, 2025)).rejects.toThrow(/não tem recibo/);
  });
});

// Troca do arquivo DEPOIS de o índice ser validado e ANTES de a resposta ser montada (revisão M1): a consulta não pode
// misturar o índice velho com o texto novo.
describe("índice local do TCU: troca do arquivo entre a validação e o uso (M1)", () => {
  const DATA = new Date("2026-10-01T12:00:00Z");
  const sigilo = (t: string, chave: string) => t.replace(new RegExp(`("${chave}"[\\s\\S]*?)"OFICIALIZADO"`), '$1"SIGILOSO    "');

  async function pasta(lista: RegistroTcu[]) {
    const dados = await mkdtemp(join(tmpdir(), "garimpo-tcu-indice-janela-"));
    const csv = await gravarComRecibo(dados, 2025, lista);
    await utimes(csv, DATA, DATA);
    await criarIndiceTcu(dados, 2025);
    return { dados, csv };
  }

  /** Na 1ª abertura do leitor do índice (depois da validação), troca o arquivo mantendo tamanho e data. */
  function trocarNaPrimeiraLeitura(csv: string, trocar: (t: string) => string) {
    const original = IndiceTcu.prototype.leitor;
    let trocou = false;
    const espiao = vi.spyOn(IndiceTcu.prototype, "leitor").mockImplementation(async function (this: IndiceTcu) {
      if (!trocou) {
        trocou = true;
        const antes = readFileSync(csv);
        const depois = Buffer.from(trocar(antes.toString("utf8")), "utf8");
        expect(depois.length).toBe(antes.length);
        expect(depois.equals(antes)).toBe(false);
        writeFileSync(csv, depois);
        utimesSync(csv, DATA, DATA);
      }
      return original.call(this);
    });
    return { foiTrocado: () => trocou, restaurar: () => espiao.mockRestore() };
  }

  it("texto trocado: o índice velho acha, o texto novo não — a resposta é a da varredura", async () => {
    const lista = [1, 2, 3, 4, 5].map((n) => acordaoFicticio(n, { DATASESSAO: `0${n}/12/2025`, ...(n === 5 ? { ACORDAO: "<p>abacate</p>" } : {}) }));
    const { dados, csv } = await pasta(lista);
    expect((await pesquisarTcu(dados, { consulta: "abacate" })).indiceLocal?.comIndice).toEqual([2025]); // o índice já valeu antes
    const troca = trocarNaPrimeiraLeitura(csv, (t) => t.replace("<p>abacate</p>", "<p>laranja</p>"));
    try {
      const r = await pesquisarTcu(dados, { consulta: "abacate" });
      expect(troca.foiTrocado()).toBe(true);
      troca.restaurar();
      const varredura = await pesquisarTcu(dados, { consulta: "abacate" }, { indice: false });
      expect(r).toMatchObject({ total: 0, resultados: [] });
      expect(semTempo(r)).toEqual(semTempo(varredura));
      expect(r.indiceLocal?.comIndice).toEqual([]);
      expect(r.indiceLocal?.semIndice[0].motivo).toMatch(/mudou/);
    } finally {
      troca.restaurar();
    }
  });

  it("registro que passou a sigiloso: as contagens também são as da varredura", async () => {
    const lista = [1, 2].map((n) => acordaoFicticio(n, { DATASESSAO: `0${n}/12/2025`, VOTO: "<p>banana</p>" }));
    const { dados, csv } = await pasta(lista);
    const troca = trocarNaPrimeiraLeitura(csv, (t) => sigilo(t, "ACORDAO-COMPLETO-100001"));
    try {
      const r = await pesquisarTcu(dados, { consulta: "banana", limite: 1 });
      expect(troca.foiTrocado()).toBe(true);
      troca.restaurar();
      const varredura = await pesquisarTcu(dados, { consulta: "banana", limite: 1 }, { indice: false });
      expect(r).toMatchObject({ total: 1, excluidosPorSituacao: 1 });
      expect(semTempo(r)).toEqual(semTempo(varredura));
    } finally {
      troca.restaurar();
    }
  });

  it("sem troca: o índice continua valendo (a conferência extra não derruba o caminho rápido)", async () => {
    const { dados } = await pasta([1, 2, 3].map((n) => acordaoFicticio(n)));
    for (let i = 0; i < 3; i++) expect((await pesquisarTcu(dados, { consulta: "sobrepreço" })).indiceLocal).toEqual({ comIndice: [2025], semIndice: [] });
  });
});
