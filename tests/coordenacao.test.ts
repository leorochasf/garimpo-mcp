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
import { CoordenacaoEmArquivo, RedeParadaError } from "../src/coordenacao.js";
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
/** A liberação da vaga termina em segundo plano: espera os arquivos de vaga sumirem, por até 5 s. */
async function vagasDepoisDaLiberacao() {
  for (let i = 0; i < 250 && (await vagasNaPasta()).length; i++) await tique(20);
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

describe("vagas em arquivo", () => {
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

describe("rede parada", () => {
  const estado = () => join(protecao, "estado.json");

  async function lerPdfLocal() {
    const caminho = join(pasta, "acordao.pdf");
    await writeFile(caminho, pdfSintetico([["Texto do acordao de exemplo."]]));
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
