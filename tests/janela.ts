/**
 * Uma "janela" do Garimpo para os testes entre processos: processo Node próprio, com o cliente real e a
 * coordenação real na pasta de dados de GARIMPO_DADOS. Avisa "pronto", espera "vai" na entrada e então faz as
 * chamadas ao servidor falso (127.0.0.1), todas de uma vez; no fim imprime o resultado de cada uma em JSON.
 */
import { readFileSync } from "node:fs";
import { Cliente } from "../src/cliente.js";

const { url, chamadas, intervaloMs, relogio } = JSON.parse(process.env.JANELA_TESTE ?? "{}") as {
  url: string;
  chamadas: number;
  intervaloMs?: number;
  /** Arquivo com o relógio comum a todos os processos, que o teste avança; as esperas só cedem a vez. */
  relogio?: string;
};
const host = new URL(url).host;
const cliente = new Cliente({
  nome: "O servidor de teste",
  intervaloMinimoPorHost: intervaloMs ? { [host]: intervaloMs } : undefined,
  ...(relogio && {
    agora: () => {
      // O teste regrava o arquivo: uma leitura no meio da gravação volta vazia e é repetida.
      for (;;) {
        const instante = Number(readFileSync(relogio, "utf8"));
        if (instante > 0) return instante;
      }
    },
    esperar: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 20))),
  }),
});

process.stdout.write("pronto\n");
await new Promise<void>((r) => process.stdin.once("data", () => r()));
process.stdin.pause();
const resultados = await Promise.all(
  Array.from({ length: chamadas }, async (_, i) => {
    try {
      const r = await cliente.requisitar(`${url}/${process.pid}-${i}`);
      return { ok: true, corpo: await r.text() };
    } catch (e) {
      return { ok: false, erro: (e as Error).message };
    }
  }),
);
process.stdout.write(`${JSON.stringify(resultados)}\n`);
