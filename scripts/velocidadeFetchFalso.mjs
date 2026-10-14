/**
 * Fetch falso da medição de velocidade (scripts/medirVelocidade.ts), sem rede. Carregado com `node --import` antes do
 * servidor compilado do Garimpo (qualquer versão): troca o fetch global, que os clientes do Garimpo usam, por respostas
 * gravadas, devolvidas na hora, e proíbe o DNS. Cada chamada vai para o arquivo VEL_CHAMADAS (uma linha por chamada;
 * "?" na frente = rota sem resposta gravada, que leva 404).
 *
 * VEL_GRAVADAS aponta o JSON montado pelo script: `site` (tribunal|texto da busca → registros do JurisprudênciaIA) e
 * `falcao` (documentos de uma página do Falcão).
 */
import dns from "node:dns";
import { appendFileSync, readFileSync } from "node:fs";

const gravadas = JSON.parse(readFileSync(process.env.VEL_GRAVADAS, "utf8"));
const registro = process.env.VEL_CHAMADAS;

const semRede = () => {
  throw new Error("Medição sem rede: DNS proibido.");
};
dns.lookup = semRede;
dns.promises.lookup = semRede;

const json = (dado, cabecalhos = {}) =>
  new Response(JSON.stringify(dado), { headers: { "content-type": "application/json", ...cabecalhos } });

globalThis.fetch = async (entrada, init = {}) => {
  const url = new URL(typeof entrada === "string" || entrada instanceof URL ? entrada : entrada.url);
  const busca = url.pathname.match(/^\/api\/tribunais\/(\w+)\/search$/);
  if (url.host === "www.jurisprudenciaia.com.br" && busca) {
    appendFileSync(registro, `${url.host}${url.pathname}\n`);
    const corpo = JSON.parse(String(init.body));
    return json({ juris: (gravadas.site[`${busca[1]}|${corpo.query}`] ?? []).slice(0, corpo.limit ?? 10) });
  }
  if (url.host === "jurisprudencia.jt.jus.br" && url.pathname.endsWith("/pesquisa")) {
    appendFileSync(registro, `${url.host}${url.pathname}\n`);
    // Restante folgado: o freio preventivo do Falcão não para a medição.
    return json({ documentos: gravadas.falcao, temasTopFive: [], quantidadeTotal: 10_000 }, { "x-rate-limit-remaining": "900" });
  }
  appendFileSync(registro, `?${url.host}${url.pathname}\n`);
  return new Response("sem resposta gravada", { status: 404 });
};
