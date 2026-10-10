import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buscaAmpla } from "../src/ampla.js";
import { Cliente } from "../src/cliente.js";
import { CoordenacaoEmArquivo, naFerramenta, RedeParadaError } from "../src/coordenacao.js";
import { criarServidor } from "../src/servidor.js";
import { respostaJson } from "./apoio.js";
import { pdfSintetico } from "./pdfSintetico.js";

/**
 * A coordenação em arquivo vista pelo cliente, num só processo, sobre uma pasta de dados temporária: o que fica
 * na subpasta de proteção e o que a chamada devolve. A disputa entre processos está em janelas.test.ts.
 */

let pasta: string;
let protecao: string;
beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), "garimpo-coordenacao-"));
  protecao = join(pasta, "protecao");
});
afterEach(() => rm(pasta, { recursive: true, force: true }));

const tique = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const vagasNaPasta = async () => (await readdir(protecao)).filter((n) => /^vaga-\d+\.json$/.test(n)).sort();
/**
 * A liberação da vaga termina em segundo plano: espera os arquivos de vaga sumirem. Sem prazo em tempo real (5 s podiam
 * não bastar com a máquina carregada); vaga que nunca volta estoura o prazo do teste.
 */
async function vagasDepoisDaLiberacao() {
  while ((await vagasNaPasta()).length) await tique(20);
  return vagasNaPasta();
}

/** Cliente com a coordenação real na pasta temporária; o relógio, comum ao cliente e à coordenação, pode ser falso. */
function clienteNaPasta(
  respostas: (() => Response)[],
  extra: {
    relogio?: { agora: number };
    intervaloMinimoPorHost?: Record<string, number>;
    esperar?: (ms: number) => Promise<void>;
  } = {},
) {
  const chamadas: string[] = [];
  const relogio = extra.relogio;
  const coordenacao = new CoordenacaoEmArquivo({
    pasta,
    ...(relogio && {
      agora: () => relogio.agora,
      dormir: async () => {
        relogio.agora += 10_000;
      },
    }),
  });
  const cliente = new Cliente({
    nome: "O site",
    vagas: coordenacao,
    intervaloMinimoPorHost: extra.intervaloMinimoPorHost,
    esperar: extra.esperar ?? (async () => {}),
    ...(relogio && { agora: () => relogio.agora }),
    fetch: (async (url: string) => {
      chamadas.push(url);
      const r = respostas.shift();
      if (!r) throw new Error("sem resposta gravada");
      return r();
    }) as typeof fetch,
  });
  return { cliente, chamadas };
}

/** Vaga ocupada por outro dono vivo: PID deste processo e outra aquisição. */
const donoVivo = () =>
  JSON.stringify({ pid: process.pid, maquina: hostname(), aquisicao: randomUUID(), desde: new Date().toISOString() });

// Arquivos reais da coordenação: com outra suíte rodando ao lado, um caso já levou 8 s. O prazo folgado só serve
// para pegar teste travado; nenhum caso daqui mede tempo real.
describe("vagas em arquivo", { timeout: 90_000 }, () => {
  it("fim do corpo, cancelamento e PDF lido até o fim encerram a aquisição", async () => {
    const pdf = () => new Response(pdfSintetico([["Texto."]]), { headers: { "content-type": "application/pdf" } });
    const { cliente } = clienteNaPasta([() => respostaJson({ a: 1 }), () => respostaJson({ b: 2 }), pdf]);

    const a = await cliente.requisitar("https://exemplo.test/a");
    const b = await cliente.requisitar("https://exemplo.test/b");
    expect(await vagasNaPasta()).toEqual(["vaga-1.json", "vaga-2.json"]);
    await a.json();
    await b.body!.cancel();
    expect(await vagasDepoisDaLiberacao()).toEqual([]);

    await (await cliente.requisitar("https://exemplo.test/c")).arrayBuffer();
    expect(await vagasDepoisDaLiberacao()).toEqual([]);
  });

  it("espera da pausa do host não ocupa vaga", async () => {
    // Relógio falso: sob carga, o tempo real entre as chamadas pode passar da pausa, e a espera não aconteceria.
    const relogio = { agora: 0 };
    const esperas: number[] = [];
    const vistasNaEspera: string[][] = [];
    const { cliente, chamadas } = clienteNaPasta([() => respostaJson({}), () => respostaJson({})], {
      relogio,
      intervaloMinimoPorHost: { "tse.test": 300 },
      esperar: async (ms) => {
        esperas.push(ms);
        vistasNaEspera.push(await vagasNaPasta());
        relogio.agora += ms;
      },
    });
    await (await cliente.requisitar("https://tse.test/a")).text();
    expect(await vagasDepoisDaLiberacao()).toEqual([]);
    await (await cliente.requisitar("https://tse.test/b")).text();
    expect(chamadas).toHaveLength(2);
    expect(esperas).toEqual([300]);
    expect(vistasNaEspera).toEqual([[]]);
  });

  it("liberar não apaga a aquisição nova que outro gravou no lugar", async () => {
    const { cliente } = clienteNaPasta([() => respostaJson({ a: 1 })]);
    const r = await cliente.requisitar("https://exemplo.test/a");
    const [vaga] = await vagasNaPasta();
    const nova = donoVivo();
    await writeFile(join(protecao, vaga), nova);

    await r.json();
    await tique();
    expect(await readFile(join(protecao, vaga), "utf8")).toBe(nova);
  });

  it("arquivos de vaga incompletos não são vagas livres: desiste em 3 min de espera, sem liberar nada", async () => {
    await mkdir(protecao, { recursive: true });
    await writeFile(join(protecao, "vaga-1.json"), "");
    await writeFile(join(protecao, "vaga-2.json"), '{"pid":');
    const relogio = { agora: 0 };
    const { cliente, chamadas } = clienteNaPasta([() => respostaJson({})], { relogio });

    const e = await cliente.requisitar("https://exemplo.test/a").catch((x) => x);
    expect(e.message).toMatch(/esperou 3 min por uma vaga/);
    expect(e.message).toMatch(/continuam ocupadas ou não puderam ser verificadas/);
    expect(e.message).toMatch(/Nada foi liberado/);
    expect(e.message).toMatch(/feche todas as instâncias do Garimpo .* antes de qualquer remoção manual/);
    expect(e.message).toMatch(/na dúvida, reinicie a máquina/);
    expect(relogio.agora).toBeGreaterThanOrEqual(180_000);
    expect(relogio.agora).toBeLessThan(200_000);
    expect(chamadas).toEqual([]);
    expect(await readFile(join(protecao, "vaga-1.json"), "utf8")).toBe("");
    expect(await readFile(join(protecao, "vaga-2.json"), "utf8")).toBe('{"pid":');
  });

  it("vaga de dono vivo nunca é tomada; na busca ampla, a busca sem vaga é erro, nunca busca vazia", async () => {
    await mkdir(protecao, { recursive: true });
    const donos = [donoVivo(), donoVivo()];
    await writeFile(join(protecao, "vaga-1.json"), donos[0]);
    await writeFile(join(protecao, "vaga-2.json"), donos[1]);
    const { cliente, chamadas } = clienteNaPasta([], { relogio: { agora: 0 } });

    const e = await buscaAmpla(cliente, { tribunais: ["stj"], formulacoes: ["tese exemplo"] }).catch((x) => x);
    expect(e.message).toMatch(/Nenhuma das 1 buscas deu resposta/);
    expect(e.message).toMatch(/continuam ocupadas ou não puderam ser verificadas/);
    expect(chamadas).toEqual([]);
    expect(await readFile(join(protecao, "vaga-1.json"), "utf8")).toBe(donos[0]);
    expect(await readFile(join(protecao, "vaga-2.json"), "utf8")).toBe(donos[1]);
  });
});

describe("rede parada", { timeout: 90_000 }, () => {
  const estado = () => join(protecao, "estado.json");

  async function lerPdfLocal() {
    const caminho = join(pasta, "acordao.pdf");
    // A 2ª linha leva a página acima do limiar de leitura: página com quase nenhum texto é página sem texto.
    await writeFile(
      caminho,
      pdfSintetico([
        [
          "Texto do acordao de exemplo.",
          "Fundamentacao generica de exemplo, com texto de sobra para a pagina contar como lida, sem dado real.",
        ],
      ]),
    );
    const { cliente } = clienteNaPasta([]);
    const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
    await criarServidor(cliente).connect(ladoServidor);
    const mcp = new Client({ name: "teste", version: "0" });
    await mcp.connect(ladoCliente);
    return (await mcp.callTool({ name: "ler_inteiro_teor", arguments: { caminho } })) as {
      content: { text: string }[];
      isError?: boolean;
    };
  }

  /** A mensagem de rede parada diz o que continua sem rede, como o README: memória válida, PDF na pasta e leitura. */
  function lembraOQueContinua(mensagem: string) {
    expect(mensagem).toMatch(/buscas guardadas e ementas dentro das 24 h da memória/);
    expect(mensagem).toMatch(/PDF já baixado na pasta de destino \(obter_inteiro_teor\)/);
    expect(mensagem).toMatch(/leitura de PDF \(ler_inteiro_teor\)/);
  }

  it("estado ausente é o primeiro uso: criado, e a chamada sai", async () => {
    const { cliente, chamadas } = clienteNaPasta([() => respostaJson({})]);
    await (await cliente.requisitar("https://exemplo.test/a")).text();
    expect(chamadas).toHaveLength(1);
    expect(JSON.parse(await readFile(estado(), "utf8"))).toMatchObject({ versao: 2 });
  });

  it("estado ilegível: nenhuma chamada sai, com o caminho e a instrução; o arquivo fica intacto e a leitura de PDF local continua", async () => {
    await mkdir(protecao, { recursive: true });
    await writeFile(estado(), "{ isto não é o estado");
    const { cliente, chamadas } = clienteNaPasta([() => respostaJson({})]);

    const e = await cliente.requisitar("https://exemplo.test/a").catch((x) => x);
    expect(e).toBeInstanceOf(RedeParadaError);
    expect(e.message).toContain(estado());
    expect(e.message).toMatch(/feche todas as instâncias do Garimpo/);
    expect(e.message).toMatch(/mova só este arquivo/);
    expect(e.message).toMatch(/apaga o histórico de pausa/);
    lembraOQueContinua(e.message);
    expect(chamadas).toEqual([]);
    expect(await readFile(estado(), "utf8")).toBe("{ isto não é o estado");
    expect(await vagasDepoisDaLiberacao()).toEqual([]);

    const lido = await lerPdfLocal();
    expect(lido.isError, lido.content[0].text).toBeFalsy();
    expect(JSON.parse(lido.content[0].text).texto).toContain("Texto do acordao de exemplo.");
  });

  it("estado de versão mais nova: rede parada nesta janela, com a instrução de atualizar, sem sobrescrever", async () => {
    await mkdir(protecao, { recursive: true });
    const futuro = JSON.stringify({ formato: "garimpo-protecao", versao: 99, outra: "coisa" });
    await writeFile(estado(), futuro);
    const { cliente, chamadas } = clienteNaPasta([() => respostaJson({})], {
      intervaloMinimoPorHost: { "tse.test": 10_000 },
    });

    const e = await cliente.requisitar("https://tse.test/a").catch((x) => x);
    expect(e).toBeInstanceOf(RedeParadaError);
    expect(e.message).toMatch(/versão mais nova do Garimpo/);
    expect(e.message).toMatch(/Atualize o Garimpo e reinicie esta janela/);
    expect(e.message).toMatch(/não apague nem mova/);
    lembraOQueContinua(e.message);
    expect(chamadas).toEqual([]);
    expect(await readFile(estado(), "utf8")).toBe(futuro);
  });

  it("estado sem permissão de leitura: rede parada com a instrução de corrigir a permissão", async (ctx) => {
    if (process.platform !== "win32" && process.getuid?.() === 0) ctx.skip(); // root lê mesmo sem permissão
    const { cliente: primeiro } = clienteNaPasta([() => respostaJson({})]);
    await (await primeiro.requisitar("https://exemplo.test/a")).text();
    const usuario = userInfo().username;
    const negar = () =>
      process.platform === "win32"
        ? execFileSync("icacls", [estado(), "/deny", `${usuario}:(R)`], { stdio: "ignore" })
        : execFileSync("chmod", ["000", estado()]);
    const devolver = () =>
      process.platform === "win32"
        ? execFileSync("icacls", [estado(), "/remove:d", usuario], { stdio: "ignore" })
        : execFileSync("chmod", ["600", estado()]);
    negar();
    try {
      const { cliente, chamadas } = clienteNaPasta([() => respostaJson({})]);
      const e = await cliente.requisitar("https://exemplo.test/b").catch((x) => x);
      expect(e).toBeInstanceOf(RedeParadaError);
      expect(e.message).toMatch(/não tem permissão/);
      expect(e.message).toMatch(/Corrija a permissão/);
      expect(e.message).toContain(estado());
      expect(chamadas).toEqual([]);
    } finally {
      devolver();
    }
  });
});

describe("histórico de recusas", { timeout: 90_000 }, () => {
  const recusa = () => new Response("", { status: 429 });

  it("grava só serviço, hora, tipo e ferramenta: nunca o termo de busca nem o número de processo", async () => {
    const relogio = { agora: 1_000_000 };
    const { cliente } = clienteNaPasta([recusa, recusa], { relogio });
    const url = "https://exemplo.test/busca?q=termo-sigiloso&processo=0000000-00.2024.8.26.0000";

    await naFerramenta("busca_direta", () => cliente.requisitar(url)).catch(() => {});

    const texto = await readFile(join(protecao, "estado.json"), "utf8");
    expect(texto).not.toMatch(/termo-sigiloso|0000000-00/);
    const { historico } = JSON.parse(texto);
    expect(historico.map((h: { tipo: string }) => h.tipo)).toEqual(["pediu-espera", "recusou"]);
    for (const h of historico) {
      expect(Object.keys(h).sort()).toEqual(["em", "ferramenta", "servico", "tipo"]);
      expect(h).toMatchObject({ servico: "exemplo.test", ferramenta: "busca_direta" });
    }
  });

  it("tem teto por serviço: o histórico cheio de outro serviço não expulsa as ocorrências deste", async () => {
    await mkdir(protecao, { recursive: true });
    const antigas = Array.from({ length: 30 }, (_, i) => ({ servico: "outro.test", em: i, tipo: "recusou" }));
    await writeFile(
      join(protecao, "estado.json"),
      JSON.stringify({ formato: "garimpo-protecao", versao: 2, pausas: {}, disjuntores: {}, historico: antigas }),
    );
    const { cliente } = clienteNaPasta([recusa, recusa], { relogio: { agora: 1_000_000 } });

    await cliente.requisitar("https://exemplo.test/a").catch(() => {});

    const { historico } = JSON.parse(await readFile(join(protecao, "estado.json"), "utf8"));
    const doOutro = historico.filter((h: { servico: string }) => h.servico === "outro.test");
    expect(doOutro.map((h: { em: number }) => h.em)).toEqual(Array.from({ length: 10 }, (_, i) => 20 + i));
    expect(historico.filter((h: { servico: string }) => h.servico === "exemplo.test").map((h: { tipo: string }) => h.tipo))
      .toEqual(["pediu-espera", "recusou"]);
  });

  it("linha do histórico de tipo desconhecido é descartada: a rede não para e o estado continua valendo", async () => {
    await mkdir(protecao, { recursive: true });
    await writeFile(
      join(protecao, "estado.json"),
      JSON.stringify({
        formato: "garimpo-protecao",
        versao: 2,
        pausas: {},
        disjuntores: {},
        historico: [{ servico: "exemplo.test", em: 1, tipo: "novo-tipo" }],
      }),
    );
    const { cliente } = clienteNaPasta([() => respostaJson({ ok: true })]);

    expect(await (await cliente.requisitar("https://exemplo.test/a")).json()).toEqual({ ok: true });
  });

  it("o diagnóstico avisa quando uma recusa não pôde ser gravada no estado; estado ilegível vira rede parada, sem quebrar", async (ctx) => {
    if (process.platform !== "win32" && process.getuid?.() === 0) ctx.skip(); // root grava mesmo sem permissão
    const { cliente: primeiro } = clienteNaPasta([() => respostaJson({})]);
    await (await primeiro.requisitar("https://exemplo.test/a")).text();
    const usuario = userInfo().username;
    const negar = () =>
      process.platform === "win32"
        ? execFileSync("icacls", [protecao, "/deny", `${usuario}:(W)`], { stdio: "ignore" })
        : execFileSync("chmod", ["555", protecao]);
    const devolver = () =>
      process.platform === "win32"
        ? execFileSync("icacls", [protecao, "/remove:d", usuario], { stdio: "ignore" })
        : execFileSync("chmod", ["755", protecao]);
    const coordenacao = new CoordenacaoEmArquivo({ pasta });
    const cliente = new Cliente({
      nome: "O site",
      vagas: coordenacao,
      esperar: async () => {},
      fetch: (async () => {
        negar(); // a pasta fica sem gravação depois de a chamada sair: a recusa não chega ao estado
        return recusa();
      }) as typeof fetch,
    });
    try {
      await cliente.requisitar("https://exemplo.test/b").catch(() => {});
      const d = await coordenacao.diagnosticar();
      expect(d.avisoDeGravacao).toMatch(/não conseguiu gravar/);
      expect(d.avisoDeGravacao).toMatch(/outras janelas podem não saber/);
    } finally {
      devolver();
    }
    // Depois que a gravação volta a funcionar, o aviso diz isso (a recusa perdida continua sem registro).
    const mesmaJanela = new Cliente({
      nome: "O site",
      vagas: coordenacao,
      esperar: async () => {},
      fetch: (async () => recusa()) as typeof fetch,
    });
    await mesmaJanela.requisitar("https://exemplo.test/c").catch(() => {});
    expect((await coordenacao.diagnosticar()).avisoDeGravacao).toMatch(/gravações seguintes desta janela funcionaram/);

    await writeFile(join(protecao, "estado.json"), "{ isto não é o estado");
    const ilegivel = await new CoordenacaoEmArquivo({ pasta }).diagnosticar();
    expect(ilegivel.redeParada).toBe(true);
    expect(ilegivel.resumo).toMatch(/Rede parada: o estado compartilhado de proteção do Garimpo está ilegível/);
    expect(await readFile(join(protecao, "estado.json"), "utf8")).toBe("{ isto não é o estado");
  });
});

describe("diagnostico_dos_freios com estado de proteção delicado", () => {
  const AGORA = 1_800_000_000_000;
  async function diagnosticarEstado(estado: object) {
    await mkdir(protecao, { recursive: true });
    await writeFile(join(protecao, "estado.json"), JSON.stringify({ formato: "garimpo-protecao", versao: 2, pausas: {}, ...estado }));
    return new CoordenacaoEmArquivo({ pasta, agora: () => AGORA }).diagnosticar();
  }

  it.each([
    ["pausa", { pausa: null }],
    ["espera", { espera: null }],
    ["adiada", { adiada: null }],
    ["prova", { prova: null }],
  ])("%s nula no disjuntor vira rede parada com a instrução, não TypeError", async (_campo, extra) => {
    const d = await diagnosticarEstado({ disjuntores: { jt: { geracao: 1, aberturas: 1, ...extra } } });
    expect(d.redeParada).toBe(true);
    expect(d.resumo).toMatch(/Rede parada: o estado compartilhado de proteção do Garimpo está ilegível/);
    expect(d.resumo).toContain("estado.json");
  });

  it("tentativa única em andamento (espera vencida, dono vivo): não diz que as chamadas podem sair", async () => {
    const d = await diagnosticarEstado({
      disjuntores: {
        jurisprudenciaia: { geracao: 1, aberturas: 0, espera: { ate: AGORA - 1000, dono: { pid: process.pid, id: "dono-vivo" } } },
      },
    });
    expect(d.resumo).not.toMatch(/as chamadas podem sair/);
    expect(d.resumo).toMatch(/nova tentativa em andamento/i);
    expect(d.resumo).toMatch(/jurisprudenciaia/);
    const fonte = d.fontes?.find((f) => f.servico === "jurisprudenciaia");
    expect(fonte?.situacao).toBe("nova tentativa em andamento");
    expect(fonte?.ate).toBeUndefined();
    expect(fonte?.explicacao).toMatch(/única nova tentativa/);
    expect(fonte?.explicacao).not.toMatch(/repita|tente de novo|insista/i);
    expect(fonte?.explicacao).not.toMatch(/pausa venceu/);
  });
});
