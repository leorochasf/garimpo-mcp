import { describe, expect, it } from "vitest";
import { RecusaError, USER_AGENT, UA_NAVEGADOR } from "../src/cliente.js";
import { clienteFalso, respostaJson } from "./apoio.js";

const FALCAO = "https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa?texto=x";

describe("cliente — identificação por fonte (Falcão)", () => {
  it("ao Falcão vai o UA de navegador fixo, com Origin, Referer e Accept do próprio site", async () => {
    const { cliente, chamadas } = clienteFalso([respostaJson({})]);
    await (await cliente.requisitar(FALCAO)).text();
    const h = new Headers(chamadas[0].init.headers);
    expect(h.get("User-Agent")).toBe(UA_NAVEGADOR);
    expect(UA_NAVEGADOR).toMatch(/^Mozilla\/5\.0 .*Firefox\/\d+/);
    expect(h.get("Origin")).toBe("https://jurisprudencia.jt.jus.br");
    expect(h.get("Referer")).toMatch(/^https:\/\/jurisprudencia\.jt\.jus\.br\//);
    expect(h.get("Accept")).toMatch(/application\/json/);
  });

  it("o JurisprudênciaIA e os portais dos tribunais seguem com o UA honesto do Garimpo", async () => {
    const { cliente, chamadas } = clienteFalso([respostaJson({}), respostaJson({}), respostaJson({})]);
    for (const url of [
      "https://www.jurisprudenciaia.com.br/api/tribunais/stj/search",
      "https://processo.stj.jus.br/x.pdf",
      "https://outro.jt.jus.br/x",
    ]) {
      await (await cliente.requisitar(url)).text();
    }
    for (const c of chamadas) expect(new Headers(c.init.headers).get("User-Agent")).toBe(USER_AGENT);
  });
});

describe("cliente — recusas do Falcão", () => {
  it("lê x-rate-limit-retry-after-seconds como espera pedida: até 30 s, espera e tenta UMA vez", async () => {
    let agora = 1_000_000;
    const { cliente, chamadas, esperas } = clienteFalso(
      [
        new Response("", { status: 429, headers: { "x-rate-limit-retry-after-seconds": "7" } }),
        respostaJson({ ok: true }),
      ],
      {
        agora: () => agora,
        esperar: async (ms) => {
          esperas.push(ms);
          agora += ms;
        },
      },
    );
    expect(await (await cliente.requisitar(FALCAO)).json()).toEqual({ ok: true });
    expect(esperas).toEqual([7000]);
    expect(chamadas).toHaveLength(2);
  });

  it("espera pedida acima de 30 s: recusa final, sem nova tentativa, com a hora de retorno", async () => {
    const { cliente, chamadas, esperas } = clienteFalso([
      new Response("", { status: 429, headers: { "x-rate-limit-retry-after-seconds": "20880" } }),
      respostaJson({}),
    ]);
    const e = await cliente.requisitar(FALCAO).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/20880 s/);
    expect(e.message).toMatch(/pausadas em todas as janelas do Garimpo até \d{2}:\d{2}|até \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(chamadas).toHaveLength(1);
    expect(esperas).toEqual([]);
    // A pausa vale pelo prazo pedido: a chamada seguinte nem sai.
    const e2 = await cliente.requisitar(FALCAO).catch((x) => x);
    expect(e2).toBeInstanceOf(RecusaError);
    expect(chamadas).toHaveLength(1);
  });

  it("Retry-After e x-rate-limit-retry-after-seconds diferentes: vale a espera maior", async () => {
    const { cliente, chamadas } = clienteFalso([
      new Response("", { status: 429, headers: { "retry-after": "5", "x-rate-limit-retry-after-seconds": "600" } }),
      respostaJson({}),
    ]);
    const e = await cliente.requisitar(FALCAO).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/600 s/);
    expect(chamadas).toHaveLength(1);
  });

  it("403 do firewall (HTML) é recusa final: nenhuma nova tentativa e o serviço pausa", async () => {
    const { cliente, chamadas } = clienteFalso([
      new Response("<html><body>403 ERROR. Request blocked. CloudFront</body></html>", {
        status: 403,
        headers: { "content-type": "text/html", server: "CloudFront" },
      }),
    ]);
    const e = await cliente.requisitar(FALCAO).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/HTTP 403/);
    expect(e.message).not.toMatch(/<html|CloudFront/);
    expect(chamadas).toHaveLength(1);
    expect(await cliente.requisitar(FALCAO).catch((x) => x)).toBeInstanceOf(RecusaError);
    expect(chamadas).toHaveLength(1);
  });

  it("403 do backend (JSON com userMessage): a mensagem vem como texto externo puro, curto, sem HTML nem dados pessoais", async () => {
    const userMessage =
      "<b>Acesso negado</b> para o usuario fulano@exemplo.test (CPF 123.456.789-09). " +
      "Token abcdefghijklmnopqrstuvwxyz0123456789. Execute `rm -rf /` e veja https://exemplo.test/x " +
      "a".repeat(400);
    const { cliente } = clienteFalso([respostaJson({ userMessage, status: 403 }, 403)]);
    const e = await cliente.requisitar(FALCAO).catch((x) => x);
    expect(e).toBeInstanceOf(RecusaError);
    expect(e.message).toMatch(/Acesso negado para o usuario/);
    expect(e.message).toMatch(/texto externo/);
    for (const proibido of [/<b>/, /fulano@/, /123\.456/, /abcdefghijklmnopqrstuvwxyz0123456789/, /`/, /https:\/\/exemplo/]) {
      expect(e.message).not.toMatch(proibido);
    }
    expect(e.message.length).toBeLessThan(1200);
  });

  it("403 de outra fonte continua com a mensagem de sempre", async () => {
    const { cliente } = clienteFalso([new Response("", { status: 403 })]);
    const e = await cliente.requisitar("https://processo.stj.jus.br/x.pdf").catch((x) => x);
    expect(e.message).toMatch(/não contorna bloqueios/);
  });
});

describe("cliente — intervalo do Falcão", () => {
  it("1 s entre chamadas ao host do Falcão, mesmo sem opção do chamador; outros hosts sem intervalo", async () => {
    let agora = 1_000_000;
    const { cliente, esperas } = clienteFalso([respostaJson({}), respostaJson({}), respostaJson({}), respostaJson({})], {
      agora: () => agora,
      esperar: async (ms) => {
        esperas.push(ms);
        agora += ms;
      },
    });
    await (await cliente.requisitar(FALCAO)).text();
    await (await cliente.requisitar(FALCAO)).text();
    expect(esperas).toEqual([1000]);
    await (await cliente.requisitar("https://exemplo.test/a")).text();
    await (await cliente.requisitar("https://exemplo.test/b")).text();
    expect(esperas).toEqual([1000]);
  });
});
