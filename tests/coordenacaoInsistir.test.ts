import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insistir } from "../src/coordenacao.js";

/**
 * Novas tentativas da coordenação diante de erro passageiro do Windows (antivírus ou indexador segurando o arquivo).
 * Medido em 2026-10-29: com o disco disputado, o antivírus segurou o estado.json por mais de 40 tentativas seguidas
 * (~2 s), e o Garimpo parava a rede com um falso "sem permissão". Relógio falso: nada espera de verdade.
 */

const erro = (code: string) => Object.assign(new Error(code), { code });

/** Falha com `code` nas primeiras `vezes` chamadas e depois devolve "ok"; conta as chamadas. */
function falhaAntes(vezes: number, code = "EPERM") {
  const fazer = vi.fn(async () => {
    if (fazer.mock.calls.length <= vezes) throw erro(code);
    return "ok";
  });
  return fazer;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("insistir: erro passageiro do Windows", () => {
  it("EPERM 100 vezes seguidas (além das 40 tentativas antigas) e depois sucesso: devolve o resultado", async () => {
    const fazer = falhaAntes(100);
    const resultado = insistir(fazer);
    await vi.advanceTimersByTimeAsync(100 * 50);
    await expect(resultado).resolves.toBe("ok");
    expect(fazer).toHaveBeenCalledTimes(101);
  });

  it("EBUSY e EACCES também são passageiros", async () => {
    for (const code of ["EBUSY", "EACCES"]) {
      const fazer = falhaAntes(3, code);
      const resultado = insistir(fazer);
      await vi.advanceTimersByTimeAsync(3 * 50);
      await expect(resultado).resolves.toBe("ok");
    }
  });

  it("erro que não é passageiro (ENOENT) falha na hora, sem nova tentativa nem espera", async () => {
    const fazer = falhaAntes(1, "ENOENT");
    await expect(insistir(fazer)).rejects.toMatchObject({ code: "ENOENT" });
    expect(fazer).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("EPERM que não passa: desiste em ~10 s, nunca antes de 9,9 s, com o próprio erro", async () => {
    const fazer = falhaAntes(Infinity);
    let fim: unknown;
    const resultado = insistir(fazer).catch((e) => (fim = e));
    await vi.advanceTimersByTimeAsync(9_900);
    expect(fim).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    await resultado;
    expect(fim).toMatchObject({ code: "EPERM" });
    expect(fazer).toHaveBeenCalledTimes(200);
  });
});
