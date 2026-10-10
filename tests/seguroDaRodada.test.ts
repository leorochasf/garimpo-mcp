import { describe, expect, it } from "vitest";
import { criarGravador, rodadaCompleta, saidaInvalida, type Registro } from "../scripts/seguroDaRodada.js";

const URL_OK = "https://www.jurisprudenciaia.com.br/api/tribunais/stj/search";
const PERMITIDA = /^https:\/\/www\.jurisprudenciaia\.com\.br\/api\/tribunais\/(stj|stf|tst|tse)\/search$/;

function montar(fetchFalso: typeof fetch) {
  const registros: Registro[] = [];
  const hosts = new Map<string, number>();
  const gravador = criarGravador({
    fetch: fetchFalso,
    permitida: PERMITIDA,
    teto: 5,
    consultaAtual: () => "c1",
    gravarRegistro: (r) => registros.push(r),
    aoContar: () => undefined,
    aoRecusa: () => undefined,
    hosts,
  });
  return { gravador, registros, hosts };
}

describe("saidaInvalida", () => {
  it("ausente, vazio ou começando por traço é recusado; pasta comum passa", () => {
    expect(saidaInvalida(undefined)).toMatch(/--saida/);
    expect(saidaInvalida("")).toMatch(/--saida/);
    expect(saidaInvalida("  ")).toMatch(/--saida/);
    expect(saidaInvalida("--ao-vivo")).toMatch(/--saida/);
    expect(saidaInvalida("-x")).toMatch(/--saida/);
    expect(saidaInvalida("pasta")).toBeUndefined();
  });
});

describe("criarGravador", () => {
  it("pede ao fetch sem seguir redirecionamento; um 302 vira falha registrada, sem 2ª requisição", async () => {
    const pedidos: string[] = [];
    const falso = (async (url: string | URL | Request, init?: RequestInit) => {
      pedidos.push(String(url));
      if (init?.redirect === "error") throw new TypeError("fetch failed: redirect mode is set to error");
      pedidos.push("https://outro-host.example/seguido");
      return new Response("", { status: 302, headers: { location: "https://outro-host.example/x" } });
    }) as typeof fetch;
    const { gravador, registros, hosts } = montar(falso);
    await expect(gravador(URL_OK, { method: "POST", body: "{}" })).rejects.toThrow(/redirect/);
    expect(pedidos).toEqual([URL_OK]);
    expect([...hosts.keys()]).toEqual(["www.jurisprudenciaia.com.br"]);
    expect(registros).toHaveLength(1);
    expect(registros[0].erroDeRede).toMatch(/redirect/);
  });

  it("resposta normal passa e é gravada; URL fora da permitida e teto continuam bloqueando", async () => {
    const { gravador, registros } = montar((async () => new Response('{"ok":1}', { status: 200 })) as typeof fetch);
    const r = await gravador(URL_OK, { method: "POST", body: "{}" });
    expect(await r.text()).toBe('{"ok":1}');
    expect(registros[0].status).toBe(200);
    await expect(gravador("https://outro.example/api", {})).rejects.toThrow(/bloqueada/);
    for (let i = 0; i < 4; i++) await gravador(URL_OK, { body: "{}" });
    await expect(gravador(URL_OK, { body: "{}" })).rejects.toThrow(/teto/);
  });
});

describe("rodadaCompleta", () => {
  const ok = (id: string) => ({ id });
  const erro = (id: string) => ({ id, erro: "HTTP 500" });
  it("tudo bem sucedido e sem parada: completa", () => {
    expect(rodadaCompleta({ principais: ["a", "b"], verificacoes: ["v"], resultados: [ok("a"), ok("b"), ok("v")] })).toBe(true);
  });
  it("registro de erro numa consulta principal não conta como concluída", () => {
    expect(rodadaCompleta({ principais: ["a", "b"], verificacoes: [], resultados: [ok("a"), erro("b")] })).toBe(false);
  });
  it("paradigma com erro (sem verificação possível) deixa a rodada incompleta", () => {
    expect(rodadaCompleta({ principais: ["p1"], verificacoes: [], resultados: [erro("p1")] })).toBe(false);
  });
  it("verificação com erro ou faltando, ou parada, é incompleta", () => {
    expect(rodadaCompleta({ principais: ["a"], verificacoes: ["v"], resultados: [ok("a"), erro("v")] })).toBe(false);
    expect(rodadaCompleta({ principais: ["a"], verificacoes: ["v"], resultados: [ok("a")] })).toBe(false);
    expect(rodadaCompleta({ parou: "x", principais: ["a"], verificacoes: [], resultados: [ok("a")] })).toBe(false);
  });
});
