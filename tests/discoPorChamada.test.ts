import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cliente } from "../src/cliente.js";
import { type ContaDeEspera, CoordenacaoEmArquivo } from "../src/coordenacao.js";

/**
 * Custo de disco por chamada (ticket b17/16): conta as operações de arquivo que a coordenação faz do pedido à
 * liberação da vaga, sobre resposta falsa (sem rede). O teto trava o custo; não muda nenhum freio.
 */
const contagem = vi.hoisted(() => ({ ops: 0, atrasoMs: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const contar =
    <A extends unknown[], R>(f: (...a: A) => R) =>
    (...a: A): R => {
      contagem.ops++;
      return f(...a);
    };
  return {
    ...real,
    default: real,
    readFile: contar(async (...args: Parameters<typeof real.readFile>) => {
      if (contagem.atrasoMs && /vaga-\d+\.json$/.test(String(args[0]))) {
        await new Promise((r) => setTimeout(r, contagem.atrasoMs));
      }
      return real.readFile(...args);
    }),
    writeFile: contar(real.writeFile),
    rename: contar(real.rename),
    rm: contar(real.rm),
    link: contar(real.link),
    mkdir: contar(real.mkdir),
  };
});

let pasta: string;
beforeEach(async () => {
  contagem.atrasoMs = 0;
  pasta = await mkdtemp(join(tmpdir(), "garimpo-disco-"));
});
afterEach(() => rm(pasta, { recursive: true, force: true }));

/** Aguarda o fim real da liberação iniciada em segundo plano pelo cliente. */
class CoordenacaoMedida extends CoordenacaoEmArquivo {
  liberacao = Promise.resolve();

  override async ocupar(conta: ContaDeEspera, sinal?: AbortSignal) {
    const liberar = await super.ocupar(conta, sinal);
    return () => (this.liberacao = liberar());
  }
}

/** Operações de arquivo da chamada número `n` (a primeira cria o estado; a medida vale para as seguintes). */
async function opsPorChamada(url: string): Promise<number[]> {
  // Relógio falso comum ao cliente e à coordenação: a pausa de 1 s entre chamadas ao Falcão passa sem espera real.
  const relogio = { agora: 1_700_000_000_000 };
  const vagas = new CoordenacaoMedida({
    pasta,
    agora: () => relogio.agora,
    dormir: async (ms) => {
      relogio.agora += ms;
    },
  });
  const cliente = new Cliente({
    nome: "O servidor de teste",
    vagas,
    agora: () => relogio.agora,
    esperar: async (ms) => {
      relogio.agora += ms;
    },
    fetch: (async () =>
      new Response(JSON.stringify({ a: 1 }), {
        headers: { "content-type": "application/json", "x-rate-limit-remaining": "900" },
      })) as typeof fetch,
  });
  const ops: number[] = [];
  for (let i = 0; i < 4; i++) {
    const antes = contagem.ops;
    await (await cliente.requisitar(url)).json();
    // A liberação da vaga termina em segundo plano.
    await vagas.liberacao;
    ops.push(contagem.ops - antes);
    relogio.agora += 5_000;
  }
  return ops;
}

describe("operações de arquivo por chamada", () => {
  it("JurisprudênciaIA (sem freio, sem orçamento)", async () => {
    const ops = await opsPorChamada("https://jurisprudenciaia.com.br/api/x");
    // Antes do ticket 16: 8 por chamada (conferir 1, vaga 4 com mkdir, reservar 1, liberar 2).
    expect(Math.max(...ops.slice(1))).toBeLessThanOrEqual(7);
  });

  it("Falcão (freio + orçamento diário + pausa por host)", async () => {
    const ops = await opsPorChamada("https://jurisprudencia.jt.jus.br/api/x");
    // Antes do ticket 16: 33 por chamada (3 mkdir e uma trava inteira a mais).
    expect(Math.max(...ops.slice(1))).toBeLessThanOrEqual(23);
  });

  it("inclui a liberação mesmo quando o disco demora mais que a antiga espera fixa", async () => {
    contagem.atrasoMs = 80;
    const ops = await opsPorChamada("https://jurisprudenciaia.com.br/api/x");
    expect(ops.slice(1)).toEqual([7, 7, 7]);
  });

  it("pasta de proteção apagada no meio é recriada, como antes", async () => {
    const vagas = new CoordenacaoMedida({ pasta });
    const cliente = new Cliente({
      nome: "O servidor de teste",
      vagas,
      esperar: async () => {},
      fetch: (async () => new Response("{}", { headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    await (await cliente.requisitar("https://jurisprudenciaia.com.br/api/x")).json();
    await vagas.liberacao;
    await rm(join(pasta, "protecao"), { recursive: true, force: true });
    await (await cliente.requisitar("https://jurisprudenciaia.com.br/api/x")).json();
    await vagas.liberacao;
    expect(await readdir(join(pasta, "protecao"))).toEqual(["estado.json"]);
  });
});
