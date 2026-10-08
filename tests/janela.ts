/**
 * Uma "janela" do Garimpo para os testes entre processos: processo Node próprio, com o cliente real e a
 * coordenação real na pasta de dados de GARIMPO_DADOS. Avisa "pronto", espera "vai" na entrada e então faz as
 * chamadas ao servidor falso (127.0.0.1), todas de uma vez; no fim imprime o resultado de cada uma em JSON.
 */
import { Cliente } from "../src/cliente.js";

const { url, chamadas, intervaloMs } = JSON.parse(process.env.JANELA_TESTE ?? "{}") as {
  url: string;
  chamadas: number;
  intervaloMs?: number;
};
const host = new URL(url).host;
const cliente = new Cliente({
  nome: "O servidor de teste",
  intervaloMinimoPorHost: intervaloMs ? { [host]: intervaloMs } : undefined,
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
