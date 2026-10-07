import { readFileSync } from "node:fs";
import { Cliente, type OpcoesCliente } from "../src/cliente.js";

export function fixture(nome: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), "utf8"));
}

export function respostaJson(dado: unknown, status = 200): Response {
  return new Response(JSON.stringify(dado), { status, headers: { "content-type": "application/json" } });
}

type Gravada = Response | ((url: string, init: RequestInit) => Response | Promise<Response>);

/** Cliente com fetch falso que devolve as respostas gravadas na ordem e registra as chamadas. */
export function clienteFalso(respostas: Gravada[], extra: Partial<OpcoesCliente> = {}) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const esperas: number[] = [];
  const cliente = new Cliente({
    nome: "O site",
    fetch: (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      const r = respostas.shift();
      if (!r) throw new Error("sem resposta gravada");
      return typeof r === "function" ? r(url, init) : r;
    }) as typeof fetch,
    esperar: async (ms) => {
      esperas.push(ms);
    },
    ...extra,
  });
  return { cliente, chamadas, esperas };
}
