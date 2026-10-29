/**
 * Fetch falso da medição de velocidade (scripts/medirVelocidade.ts), sem rede. Carregado com `node --import` antes do
 * servidor compilado do Garimpo (qualquer versão): troca o fetch global, que os clientes do Garimpo usam, por respostas
 * gravadas, devolvidas na hora, e proíbe o DNS. Cada chamada vai para o arquivo VEL_CHAMADAS, uma linha por chamada,
 * com os bytes contados aqui, no transporte: `host/caminho<TAB>bytes enviados (corpo)<TAB>bytes recebidos (corpo)`;
 * "?" na frente = rota sem resposta gravada, que leva 404.
 *
 * VEL_GRAVADAS aponta o JSON montado pelo script: `site` (tribunal|texto da busca → registros do JurisprudênciaIA),
 * `falcao` (documentos de uma página do Falcão), `normas` (urn → resposta do normas.leg.br) e `projudi` (número,
 * julgamento e os dois envelopes .p7s, em base64, da consulta pública do processo no Projudi do TJGO). Tudo fictício.
 *
 * Sem VEL_GRAVADAS (num teste), só exporta as funções e não troca nada.
 */
import dns from "node:dns";
import { appendFileSync, readFileSync } from "node:fs";

/** Ids da lista de arquivos do julgamento no Projudi (fictícios; o final 0 = «Ementa», 1 = «Relatório e Voto»). */
const ID_DO_ARQUIVO = (i) => `10990000000000000000000020${i}`;

const bytes = (corpo) => (corpo == null ? 0 : typeof corpo === "string" ? Buffer.byteLength(corpo) : corpo.byteLength ?? 0);

/** O fetch que responde as gravadas e chama `registrar(linha)` a cada requisição. */
export function criarFetchFalso(gravadas, registrar) {
  const responder = (url, init, corpo, cabecalhos = {}, status = 200) => {
    const semResposta = status === 404 ? "?" : "";
    registrar(`${semResposta}${url.host}${url.pathname}\t${bytes(init.body)}\t${bytes(corpo)}`);
    return new Response(corpo, { status, headers: cabecalhos });
  };
  const json = (url, init, dado, cabecalhos = {}) =>
    responder(url, init, JSON.stringify(dado), { "content-type": "application/json", ...cabecalhos });
  const latin1 = (texto) => Buffer.from(texto, "latin1");

  return async (entrada, init = {}) => {
    const url = new URL(typeof entrada === "string" || entrada instanceof URL ? entrada : entrada.url);
    const busca = url.pathname.match(/^\/api\/tribunais\/(\w+)\/search$/);
    if (url.host === "www.jurisprudenciaia.com.br" && busca) {
      const corpo = JSON.parse(String(init.body));
      return json(url, init, { juris: (gravadas.site[`${busca[1]}|${corpo.query}`] ?? []).slice(0, corpo.limit ?? 10) });
    }
    if (url.host === "jurisprudencia.jt.jus.br" && url.pathname.endsWith("/pesquisa")) {
      // Restante folgado: o freio preventivo do Falcão não para a medição.
      return json(url, init, { documentos: gravadas.falcao, temasTopFive: [], quantidadeTotal: 10_000 }, { "x-rate-limit-remaining": "900" });
    }
    const norma = gravadas.normas?.[url.searchParams.get("urn")];
    if (url.host === "normas.leg.br" && url.pathname === "/api/public/normas" && norma) return json(url, init, norma);
    const p = gravadas.projudi;
    if (url.host === "projudi.tjgo.jus.br" && p) {
      const q = url.searchParams;
      if (url.pathname === "/BuscaProcesso" && q.get("ProcessoNumero") === p.cnj) {
        return responder(url, init, latin1(paginaDoProcesso(p)), {
          "content-type": "text/html;charset=iso-8859-1",
          "set-cookie": "JSESSIONID=sessao-ficticia.cp1; path=/",
        });
      }
      if (url.pathname === "/MovimentacaoArquivo" && q.get("Id_Movimentacao") === p.idMov) {
        return responder(url, init, latin1(listaDeArquivos()), { "content-type": "application/json; charset=iso-8859-1" });
      }
      const envelope = [p.ementaP7s, p.relatorioP7s][[0, 1].find((i) => q.get("Id_MovimentacaoArquivo") === ID_DO_ARQUIVO(i))];
      if (url.pathname === "/BuscaProcesso" && envelope) {
        return responder(url, init, Buffer.from(envelope, "base64"), { "content-type": "application/pkcs7-signature" });
      }
    }
    return responder(url, init, "sem resposta gravada", {}, 404);
  };
}

/** A página pública do processo, com a marcação do Projudi: sem segredo de justiça e a linha do julgamento. */
function paginaDoProcesso({ dataHora, idMov }) {
  return `<html><head><title>Dados Processo</title></head><body>
	<div> Segredo de Justi&ccedil;a</div>
	<span class="span3">Não</span>
	<table><tr movi_codigo ="282" class='filtro-entrada TabelaLinha1'>
		<td class="colunaMinima"> 51</td>
		<td class="filtro_coluna_movimentacao" width="55%">
			<span class="filtro_tipo_movimentacao">
				Julgamento -> Com Resolução do Mérito -> Provimento em Parte</span><br />
			(Sessão do dia 23/09/2024 10:00)</td>
		<td width="100" align="center">${dataHora}</td>
		<td width="25%"> 	SERVIDOR FICTÍCIO</td>
		<td class="colunaMinima">
			<a href="javascript:buscarArquivosMovimentacaoJSON('${idMov}', 'BuscaProcesso', 'Id_MovimentacaoArquivo', 6, 'false')">
				<img src="imagens/22x22/go-bottom.png" alt="Mostrar ou ocultar arquivos" />
			</a>
		</td>
		<td class="colunaMinima"></td>
	</tr></table></body></html>`;
}

/** A lista de arquivos da movimentação do julgamento: «Ementa» e «Relatório e Voto», os dois assinados (.p7s). */
function listaDeArquivos() {
  return JSON.stringify(
    [
      ["ementa.html.p7s", "124", "Ementa"],
      ["relatorio_voto_acordao.html.p7s", "125", "Relatório e Voto"],
    ].map(([nome, tipo, rotulo], i) => ({
      id: ID_DO_ARQUIVO(i),
      id_arquivo: `10990000000000000000000030${i}`,
      nome_arquivo: nome,
      id_arquivo_tipo: tipo,
      arquivo_tipo: rotulo,
      usuario_assinador: "Servidor Fictício",
      AcessoUsuario: "2",
      AcessoArquivo: "1",
      valido: "true",
      hash: `hashficticio${i}`,
      recibo: "true",
      codigo_temp: "",
    })),
  );
}

/** Soma o registro de chamadas (as linhas sem bytes, do formato antigo, contam como 0 byte). */
export function lerChamadas(texto) {
  const linhas = texto.split("\n").filter(Boolean);
  const soma = (i) => linhas.reduce((s, l) => s + (Number(l.split("\t")[i]) || 0), 0);
  return {
    total: linhas.length,
    semResposta: linhas.filter((l) => l.startsWith("?")).map((l) => l.split("\t")[0]),
    enviados: soma(1),
    recebidos: soma(2),
  };
}

if (process.env.VEL_GRAVADAS) {
  const semRede = () => {
    throw new Error("Medição sem rede: DNS proibido.");
  };
  dns.lookup = semRede;
  dns.promises.lookup = semRede;
  const gravadas = JSON.parse(readFileSync(process.env.VEL_GRAVADAS, "utf8"));
  const registro = process.env.VEL_CHAMADAS;
  globalThis.fetch = criarFetchFalso(gravadas, (linha) => appendFileSync(registro, `${linha}\n`));
}
