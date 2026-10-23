import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Acordao, normalizar } from "../src/busca.js";
import { USER_AGENT } from "../src/cliente.js";
import { obterInteiroTeor } from "../src/inteiroTeor.js";
import { lerTextoIntegral } from "../src/leitura.js";
import { Memoria } from "../src/memoria.js";
import { comLinkDoProcessoNoTjgo, infoTribunal } from "../src/tribunais.js";
import { clienteFalso } from "./apoio.js";

// Tudo fictício (regra 2): número, nomes, ids, hash e endereço assinado. A marcação reproduz a da página real do
// Projudi (linhas de movimentação, campo «Segredo de Justiça», lista de arquivos em JSON e redirecionamento assinado).
const CNJ = "0000001-11.2024.8.09.0001";
const PAGINA = `https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=2&ProcessoNumero=${CNJ}`;
const ARMAZENAMENTO = "https://projudi-2024-prd.s3.tjgo.jus.br/20240923/2133";
const ID_ARQUIVO = "900000100";
const EMENTA_DA_BUSCA =
  "EMENTA: DIREITO DO CONSUMIDOR. APELAÇÃO CÍVEL. EXEMPLO FICTÍCIO DE NEGATIVAÇÃO. I. CASO EM EXAME 1. Apelação " +
  "cível fictícia interposta contra sentença de exemplo que julgou parcialmente procedentes os pedidos. II. QUESTÃO " +
  "EM DISCUSSÃO 2. Saber se a situação exemplar fictícia gera dano moral presumido. III. RAZÕES DE DECIDIR 3. A " +
  "situação inventada para o teste configura dano moral presumido. IV. DISPOSITIVO 4. Recurso conhecido e " +
  "parcialmente provido.";

interface Mov {
  tipo: string;
  dataHora: string;
  idMov?: string;
}

const JULGAMENTO: Mov = {
  tipo: "Julgamento -> Com Resolução do Mérito -> Provimento em Parte",
  dataHora: "25/09/2024 13:20:33",
  idMov: "109900000000000000000000001",
};

function linha({ tipo, dataHora, idMov }: Mov): string {
  const arquivos = idMov
    ? `<a href="javascript:buscarArquivosMovimentacaoJSON('${idMov}', 'BuscaProcesso', 'Id_MovimentacaoArquivo', 6, 'false')">
															<img id='MostrarArquivos_1' src="imagens/22x22/go-bottom.png" alt="Mostrar ou ocultar arquivos" title="Mostrar ou ocultar arquivos" />
														</a>`
    : "";
  return `<tr movi_codigo ="282" class='filtro-entrada TabelaLinha1'>
					                   			<td class="colunaMinima"> 51</td>
					                    		<td class="filtro_coluna_movimentacao" width="55%">
					                    			<span class="filtro_tipo_movimentacao">
                                                        ${tipo}</span><br />
                                                    (Sessão do dia 23/09/2024 10:00)</td>
						                   		<td width="100" align="center">${dataHora}</td>
						                   		<td width="25%"> 	SERVIDOR FICTÍCIO</td>
						                   		<td class="colunaMinima">
													${arquivos}
													</td>
			  									<td class="colunaMinima"></td>
										</tr>`;
}

/** Linha de intimação que cita o julgamento no texto: a data e hora dela são outras, e o tipo não é julgamento. */
const INTIMACAO: Mov = {
  tipo: "Intimação Efetivada</span><br />Referente à Mov. Julgamento -> Com Resolução do Mérito - 25/09/2024 13:20:33<span>",
  dataHora: "26/09/2024 08:00:01",
  idMov: "109900000000000000000000009",
};

function paginaDoProcesso(movs: Mov[], segredo = "Não"): Response {
  const html = `<html><head><title>Dados Processo</title></head><body>
							<div> Segredo de Justi&ccedil;a</div>
							<span class="span3">${segredo}</span>
							<table>${movs.map(linha).join("\n")}</table></body></html>`;
  return new Response(Buffer.from(html, "latin1"), {
    headers: { "content-type": "text/html;charset=iso-8859-1", "set-cookie": "JSESSIONID=sessao-ficticia.cp1; path=/" },
  });
}

interface Arquivo {
  tipo: "Ementa" | "Relatório e Voto";
  nome?: string;
  acesso?: string;
  valido?: string;
}

const EMENTA: Arquivo = { tipo: "Ementa" };
const RELATORIO: Arquivo = { tipo: "Relatório e Voto" };

function listaDeArquivos(arquivos: Arquivo[] = [EMENTA, RELATORIO]): Response {
  const json = JSON.stringify(
    arquivos.map((a, i) => ({
      id: `10990000000000000000000020${i}`,
      id_arquivo: `10990000000000000000000030${i}`,
      nome_arquivo: a.nome ?? (a.tipo === "Ementa" ? "ementa.html" : "relatorio_voto_acordao.html"),
      id_arquivo_tipo: a.tipo === "Ementa" ? "124" : "125",
      arquivo_tipo: a.tipo,
      usuario_assinador: "Servidor Fictício",
      AcessoUsuario: "2",
      AcessoArquivo: a.acesso ?? "1",
      valido: a.valido ?? "true",
      hash: `hashficticio${i}`,
      recibo: "true",
      codigo_temp: "",
    })),
  );
  return new Response(Buffer.from(json, "latin1"), { headers: { "content-type": "application/json; charset=iso-8859-1" } });
}

const redireciona = (location: string) => () => new Response(null, { status: 302, headers: { location } });
const ementaRedireciona = (id = ID_ARQUIVO) => redireciona(`${ARMAZENAMENTO}/id_${id}_ementa.html?Expires=1&Signature=ficticia`);
const relatorioRedireciona = (destino = `${ARMAZENAMENTO}/id_900000101_relatorio_voto_acordao.html?Expires=1&Signature=ficticia`) =>
  redireciona(destino);

const ementaNoArmazenamento = `${ARMAZENAMENTO}/id_${ID_ARQUIVO}_ementa.html?Expires=1&Signature=ficticia`;
const relatorioNoArmazenamento = `${ARMAZENAMENTO}/id_900000101_relatorio_voto_acordao.html?Expires=1&Signature=ficticia`;

/** O arquivo «Ementa» do julgamento, como o armazenamento o entrega (HTML, sem charset no cabeçalho). */
function arquivoDeEmenta(ementa = EMENTA_DA_BUSCA): () => Response {
  const html =
    `<p style="text-align:center">Poder Judici&aacute;rio</p><p><strong>APELA&Ccedil;&Atilde;O C&Iacute;VEL N.&ordm; ${CNJ}</strong></p>` +
    `<p>${ementa}</p><p>(Datado e assinado conforme Resolu&ccedil;&atilde;o n&ordm; 59/2016)</p>`;
  return () => new Response(html, { headers: { "content-type": "text/html" } });
}

function relatorioEVoto(ementa = EMENTA_DA_BUSCA, classe = "APELAÇÃO CÍVEL"): () => Response {
  const html = readFileSync(new URL("./fixtures/tjgo-relatorio-voto.html", import.meta.url), "utf8")
    .replace("{{EMENTA}}", ementa)
    .replace("{{CLASSE}}", classe);
  return () => new Response(html, { headers: { "content-type": "text/html" } });
}

function memoriaComAcordao(sobre: Partial<Acordao> = {}) {
  const memoria = new Memoria();
  const acordao = {
    id: "tjgo:77",
    tribunal: "tjgo",
    numero: CNJ,
    numeroCnj: CNJ,
    semNumero: false,
    classe: "Apelação Cível",
    ementa: `${EMENTA_DA_BUSCA} (Tribunal de Justiça do Estado de Goiás, ${CNJ}, FULANO EXEMPLAR - (DESEMBARGADOR), 9ª Câmara Cível, julgado em 25/09/2024 13:20:33)`,
    link: PAGINA,
    idArquivoProjudi: ID_ARQUIVO,
    ...sobre,
  } as Acordao;
  memoria.lembrar([{ ids: [acordao.id], registro: acordao }]);
  return memoria;
}

const cadeiaCompleta = (movs: Mov[] = [INTIMACAO, JULGAMENTO]) => [
  paginaDoProcesso(movs),
  listaDeArquivos(),
  ementaRedireciona(),
  arquivoDeEmenta(),
  relatorioRedireciona(),
  relatorioEVoto(),
];

describe("inteiro teor — TJGO pela página pública do processo no Projudi (ADR-0029)", () => {
  it("o tribunal é marcado como texto do portal", () => {
    expect(infoTribunal("tjgo")?.inteiroTeor).toBe("portal");
  });

  it("caso simples: página → lista do julgamento → ementa e relatório e voto no armazenamento do TJGO; guarda os dois", async () => {
    const memoria = memoriaComAcordao();
    const { cliente, chamadas } = clienteFalso(cadeiaCompleta());
    const r = await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);

    expect(chamadas.map((c) => c.url)).toEqual([
      PAGINA,
      "https://projudi.tjgo.jus.br/MovimentacaoArquivo?AJAX=ajax&PaginaAtual=8&Id_Movimentacao=109900000000000000000000001",
      "https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=6&Id_MovimentacaoArquivo=109900000000000000000000200&hash=hashficticio0&id_proc=undefined",
      ementaNoArmazenamento,
      "https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=6&Id_MovimentacaoArquivo=109900000000000000000000201&hash=hashficticio1&id_proc=undefined",
      relatorioNoArmazenamento,
    ]);
    const cabecalhos = chamadas.map((c) => new Headers(c.init.headers));
    expect(cabecalhos.every((h) => h.get("user-agent") === USER_AGENT)).toBe(true);
    // A sessão da página vai para o Projudi, como no navegador; nunca para o armazenamento.
    expect([1, 2, 4].map((i) => cabecalhos[i].get("cookie"))).toEqual(Array(3).fill("JSESSIONID=sessao-ficticia.cp1"));
    expect([3, 5].map((i) => cabecalhos[i].get("cookie"))).toEqual([null, null]);
    expect(chamadas.every((c) => c.init.redirect === "manual")).toBe(true);

    expect(r.baixado).toBe(false);
    if (r.baixado) return;
    expect(r.explicacao).toMatch(/texto do portal do tribunal/);
    expect(r.explicacao).toMatch(/ler_inteiro_teor com o id tjgo:77/);
    const guardado = await memoria.obterTexto("tjgo:77");
    // A ementa do julgamento vem antes do relatório e voto.
    expect(guardado?.texto).toMatch(/^Poder Judiciário[\s\S]*EXEMPLO FICTÍCIO DE NEGATIVAÇÃO[\s\S]*VOTO[\s\S]*A C Ó R D Ã O/);
    expect(guardado?.texto).toMatch(/Datado e assinado conforme Resolução nº 59\/2016/);
  });

  describe("julgado exato: processo com vários julgamentos, nunca outro acórdão do mesmo processo", () => {
    const apelacao: Mov = {
      tipo: "Julgamento -> Com Resolução do Mérito -> Provimento em Parte",
      dataHora: "19/08/2024 14:46:47",
      idMov: "109900000000000000000000011",
    };
    const embargos: Mov = {
      tipo: "Julgamento -> Com Resolução do Mérito -> Não-Acolhimento de Embargos de Declaração",
      dataHora: "25/09/2024 13:20:33",
      idMov: "109900000000000000000000012",
    };
    const embargosDosEmbargos: Mov = {
      tipo: "Julgamento -> Com Resolução do Mérito -> Não-Acolhimento de Embargos de Declaração",
      dataHora: "04/11/2024 12:38:00",
      idMov: "109900000000000000000000013",
    };
    const agravoInterno: Mov = {
      tipo: "Julgamento -> Com Resolução do Mérito -> Não-Provimento",
      dataHora: "25/09/2024 09:10:02",
      idMov: "109900000000000000000000014",
    };
    const listaPedida = (chamadas: { url: string }[]) => new URL(chamadas[1].url).searchParams.get("Id_Movimentacao");

    it("três julgamentos (apelação, embargos, embargos dos embargos): a busca achou os embargos, vêm os embargos", async () => {
      const memoria = memoriaComAcordao({ classe: "Embargos de Declaração" });
      const { cliente, chamadas } = clienteFalso(cadeiaCompleta([embargosDosEmbargos, INTIMACAO, embargos, apelacao]));
      await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(listaPedida(chamadas)).toBe(embargos.idMov);
      expect(await memoria.obterTexto("tjgo:77")).toBeDefined();
    });

    it("mesma data, horas diferentes (agravo interno de manhã, embargos à tarde): casa pela hora", async () => {
      const memoria = memoriaComAcordao();
      const { cliente, chamadas } = clienteFalso(cadeiaCompleta([agravoInterno, embargos, apelacao]));
      await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(listaPedida(chamadas)).toBe(embargos.idMov);
    });

    it("dois julgamentos no mesmo instante: ambíguo, não baixa e explica (só a página foi chamada)", async () => {
      const memoria = memoriaComAcordao();
      const gemeo = { ...embargos, tipo: "Julgamento -> Com Resolução do Mérito -> Não-Provimento", idMov: "109900000000000000000000015" };
      const { cliente, chamadas } = clienteFalso([paginaDoProcesso([embargos, gemeo, apelacao])]);
      const r = await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(chamadas).toHaveLength(1);
      expect(r.baixado ? "" : r.explicacao).toMatch(/mais de um julgamento em 25\/09\/2024 13:20:33/);
      expect(r.baixado ? "" : r.link).toBe(PAGINA);
      expect(await memoria.obterTexto("tjgo:77")).toBeUndefined();
    });

    it("julgado da busca sem movimentação de julgamento no mesmo instante: não baixa e explica", async () => {
      const memoria = memoriaComAcordao();
      const { cliente, chamadas } = clienteFalso([paginaDoProcesso([INTIMACAO, apelacao, embargosDosEmbargos])]);
      const r = await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(chamadas).toHaveLength(1);
      expect(r.baixado ? "" : r.explicacao).toMatch(/nenhuma movimentação de julgamento em 25\/09\/2024 13:20:33/);
      expect(await memoria.obterTexto("tjgo:77")).toBeUndefined();
    });

    const julgadoAs = (hora: string) =>
      memoriaComAcordao({
        ementa: `${EMENTA_DA_BUSCA} (Tribunal de Justiça do Estado de Goiás, ${CNJ}, 9ª Câmara Cível, julgado em 25/09/2024 ${hora})`,
      });

    it("o «julgado em» da busca um segundo depois do lançamento (13:20:34 × 13:20:33): casa, se for o único julgamento nessa janela", async () => {
      const memoria = julgadoAs("13:20:34");
      const { cliente, chamadas } = clienteFalso(cadeiaCompleta([agravoInterno, embargos, apelacao]));
      await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(listaPedida(chamadas)).toBe(embargos.idMov);
      expect(await memoria.obterTexto("tjgo:77")).toBeDefined();
    });

    it("um segundo antes também casa (13:20:32 × 13:20:33)", async () => {
      const memoria = julgadoAs("13:20:32");
      const { cliente, chamadas } = clienteFalso(cadeiaCompleta([embargos, apelacao]));
      await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(listaPedida(chamadas)).toBe(embargos.idMov);
    });

    it("dois julgamentos a até 1 s do «julgado em»: ambíguo, não baixa", async () => {
      const memoria = julgadoAs("13:20:34");
      const vizinho = { ...embargos, dataHora: "25/09/2024 13:20:35", idMov: "109900000000000000000000016" };
      const { cliente, chamadas } = clienteFalso([paginaDoProcesso([embargos, vizinho])]);
      const r = await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(chamadas).toHaveLength(1);
      expect(r.baixado ? "" : r.explicacao).toMatch(/mais de um julgamento/);
    });

    it("dois segundos de diferença (13:20:35 × 13:20:33): não casa", async () => {
      const memoria = julgadoAs("13:20:35");
      const { cliente, chamadas } = clienteFalso([paginaDoProcesso([embargos])]);
      const r = await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(chamadas).toHaveLength(1);
      expect(r.baixado ? "" : r.explicacao).toMatch(/nenhuma movimentação de julgamento/);
    });

    it("ementa com hora 00:00:00 (só a data da sessão): sem casamento seguro, nenhuma chamada", async () => {
      const memoria = memoriaComAcordao({
        ementa: `${EMENTA_DA_BUSCA} (Tribunal de Justiça do Estado de Goiás, ${CNJ}, 9ª Câmara Cível, julgado em 25/09/2024 00:00:00)`,
      });
      const { cliente, chamadas } = clienteFalso([]);
      const r = await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(chamadas).toHaveLength(0);
      expect(r.baixado ? "" : r.explicacao).toMatch(/sem a hora do julgamento/);
    });

    it("ementa sem «julgado em»: sem casamento seguro, nenhuma chamada", async () => {
      const memoria = memoriaComAcordao({ ementa: EMENTA_DA_BUSCA });
      const { cliente, chamadas } = clienteFalso([]);
      const r = await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(chamadas).toHaveLength(0);
      expect(r.baixado ? "" : r.explicacao).toMatch(/sem a data e a hora do julgamento/);
    });
  });

  describe("sem casamento seguro ou sem acesso público: não baixa, não guarda e diz o motivo", () => {
    async function tentar(respostas: Parameters<typeof clienteFalso>[0], sobre: Partial<Acordao> = {}) {
      const memoria = memoriaComAcordao(sobre);
      const { cliente, chamadas } = clienteFalso(respostas);
      const r = await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
      expect(r.baixado).toBe(false);
      expect(await memoria.obterTexto("tjgo:77")).toBeUndefined();
      return { explicacao: r.baixado ? "" : r.explicacao, link: r.baixado ? "" : r.link, chamadas };
    }

    it("processo em segredo de justiça: só a página", async () => {
      const { explicacao, chamadas, link } = await tentar([paginaDoProcesso([JULGAMENTO], "Sim")]);
      expect(chamadas).toHaveLength(1);
      expect(explicacao).toMatch(/segredo de justiça/i);
      expect(link).toBe(PAGINA);
    });

    it("página sem o campo «Segredo de Justiça» (formato diferente): não segue", async () => {
      const html = `<html><body><table>${linha(JULGAMENTO)}</table></body></html>`;
      const { explicacao, chamadas } = await tentar([new Response(html, { headers: { "content-type": "text/html" } })]);
      expect(chamadas).toHaveLength(1);
      expect(explicacao).toMatch(/segredo de justiça/i);
    });

    it("relatório e voto bloqueado (acesso acima do público): não pede o arquivo", async () => {
      const { explicacao, chamadas } = await tentar([
        paginaDoProcesso([JULGAMENTO]),
        listaDeArquivos([EMENTA, { ...RELATORIO, acesso: "3" }]),
      ]);
      expect(chamadas).toHaveLength(2);
      expect(explicacao).toMatch(/não é de acesso público/);
    });

    it("relatório e voto inválido: não pede o arquivo", async () => {
      const { explicacao, chamadas } = await tentar([
        paginaDoProcesso([JULGAMENTO]),
        listaDeArquivos([EMENTA, { ...RELATORIO, valido: "false" }]),
      ]);
      expect(chamadas).toHaveLength(2);
      expect(explicacao).toMatch(/não é de acesso público/);
    });

    it("«Ementa» bloqueada, inválida ou em formato desconhecido: não pede nenhum arquivo", async () => {
      for (const ementa of [
        { ...EMENTA, acesso: "3" },
        { ...EMENTA, valido: "false" },
        { ...EMENTA, nome: "ementa.pdf" },
      ]) {
        const { explicacao, chamadas } = await tentar([paginaDoProcesso([JULGAMENTO]), listaDeArquivos([ementa, RELATORIO])]);
        expect(chamadas).toHaveLength(2);
        expect(explicacao).toMatch(/«Ementa»/);
      }
    });

    it("relatório e voto sem o número do processo, mesmo com a ementa certa: não entrega", async () => {
      const semNumero = () =>
        new Response(
          readFileSync(new URL("./fixtures/tjgo-relatorio-voto.html", import.meta.url), "utf8")
            .replaceAll("0000001-11.2024.8.09.0001", "0000009-99.2024.8.09.0001")
            .replace("{{EMENTA}}", EMENTA_DA_BUSCA)
            .replace("{{CLASSE}}", "APELAÇÃO CÍVEL"),
          { headers: { "content-type": "text/html" } },
        );
      const { explicacao } = await tentar([
        paginaDoProcesso([JULGAMENTO]),
        listaDeArquivos(),
        ementaRedireciona(),
        arquivoDeEmenta(),
        relatorioRedireciona(),
        semNumero,
      ]);
      expect(explicacao).toMatch(/«Relatório e Voto» não traz o número do processo/);
    });

    it("relatório e voto em formato desconhecido: não pede o arquivo", async () => {
      const { explicacao, chamadas } = await tentar([
        paginaDoProcesso([JULGAMENTO]),
        listaDeArquivos([EMENTA, { ...RELATORIO, nome: "relatorio_voto_acordao.doc" }]),
      ]);
      expect(chamadas).toHaveLength(2);
      expect(explicacao).toMatch(/formato que o Garimpo não lê/);
    });

    it("dois relatórios e votos na mesma movimentação: ambíguo", async () => {
      const { explicacao, chamadas } = await tentar([
        paginaDoProcesso([JULGAMENTO]),
        listaDeArquivos([EMENTA, RELATORIO, RELATORIO]),
      ]);
      expect(chamadas).toHaveLength(2);
      expect(explicacao).toMatch(/um só «Relatório e Voto»/);
    });

    it("a ementa da movimentação não é o arquivo que a busca apontou (Id_Arquivo): não pede o relatório", async () => {
      const { explicacao, chamadas } = await tentar([
        paginaDoProcesso([JULGAMENTO]),
        listaDeArquivos(),
        ementaRedireciona("900000555"),
      ]);
      expect(chamadas).toHaveLength(3);
      expect(explicacao).toMatch(/não é a que a busca apontou/);
    });

    it("com Id_Arquivo e sem «Ementa» na movimentação: não há como amarrar", async () => {
      const { explicacao, chamadas } = await tentar([paginaDoProcesso([JULGAMENTO]), listaDeArquivos([RELATORIO])]);
      expect(chamadas).toHaveLength(2);
      expect(explicacao).toMatch(/sem o arquivo «Ementa»/);
    });

    it("redirecionamento para fora do armazenamento do TJGO: não é seguido", async () => {
      for (const destino of [
        "https://exemplo.invalid/id_900000101_relatorio_voto_acordao.html",
        "http://projudi-2024-prd.s3.tjgo.jus.br/20240923/2133/id_900000101_relatorio_voto_acordao.html",
        "https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=6",
        "https://projudi-2024-prd.s3.tjgo.jus.br/20240923/2133/id_900000101_outro.html",
      ]) {
        const { explicacao, chamadas } = await tentar([
          paginaDoProcesso([JULGAMENTO]),
          listaDeArquivos(),
          ementaRedireciona(),
          arquivoDeEmenta(),
          relatorioRedireciona(destino),
        ]);
        expect(chamadas).toHaveLength(5);
        expect(explicacao).toMatch(/fora do armazenamento do TJGO/);
      }
    });

    it("o arquivo respondeu sem redirecionamento: não segue", async () => {
      const { explicacao, chamadas } = await tentar([
        paginaDoProcesso([JULGAMENTO]),
        listaDeArquivos(),
        ementaRedireciona(),
        arquivoDeEmenta(),
        relatorioEVoto(),
      ]);
      expect(chamadas).toHaveLength(5);
      expect(explicacao).toMatch(/fora do armazenamento do TJGO/);
    });

    it("o texto baixado não traz a ementa da busca (é outro acórdão): não entrega", async () => {
      const outra =
        "EMENTA: EMBARGOS DE DECLARAÇÃO FICTÍCIOS. OMISSÃO INEXISTENTE NO EXEMPLO. Os embargos de declaração de teste " +
        "não se prestam a rediscutir a matéria inventada já decidida. Embargos conhecidos e rejeitados no exemplo.";
      const { explicacao } = await tentar([
        paginaDoProcesso([JULGAMENTO]),
        listaDeArquivos(),
        ementaRedireciona(),
        arquivoDeEmenta(outra),
        relatorioRedireciona(),
        relatorioEVoto(outra),
      ]);
      expect(explicacao).toMatch(/não trazem a ementa da busca/);
    });

    it("o arquivo «Ementa» não vem como HTML do armazenamento: não segue", async () => {
      const { explicacao, chamadas } = await tentar([
        paginaDoProcesso([JULGAMENTO]),
        listaDeArquivos(),
        ementaRedireciona(),
        () => new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } }),
      ]);
      expect(chamadas).toHaveLength(4);
      expect(explicacao).toMatch(/não entregou o HTML da «Ementa»/);
    });

    it("o texto baixado não traz o número do processo: não entrega", async () => {
      const { explicacao } = await tentar(
        [paginaDoProcesso([JULGAMENTO]), listaDeArquivos(), ementaRedireciona(), arquivoDeEmenta(), relatorioRedireciona(), relatorioEVoto()],
        {
          numero: "0000002-22.2024.8.09.0001",
          numeroCnj: "0000002-22.2024.8.09.0001",
          link: `https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=2&ProcessoNumero=0000002-22.2024.8.09.0001`,
        },
      );
      expect(explicacao).toMatch(/não traz o número do processo/);
    });

    it("erro HTTP do Projudi (sem recusa): não baixa e diz o erro", async () => {
      const { explicacao, chamadas } = await tentar([paginaDoProcesso([JULGAMENTO]), new Response("erro", { status: 500 })]);
      expect(chamadas).toHaveLength(2);
      expect(explicacao).toMatch(/HTTP 500/);
    });
  });

  it("relatório e voto que não repete a ementa: vale a ementa do arquivo «Ementa» do mesmo julgamento", async () => {
    const memoria = memoriaComAcordao();
    const { cliente } = clienteFalso([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos(),
      ementaRedireciona(),
      arquivoDeEmenta(),
      relatorioRedireciona(),
      relatorioEVoto("(ementa em arquivo próprio)"),
    ]);
    await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
    expect((await memoria.obterTexto("tjgo:77"))?.texto).toMatch(/EXEMPLO FICTÍCIO DE NEGATIVAÇÃO[\s\S]*A C Ó R D Ã O/);
  });

  it("acórdão guardado antes do Id_Arquivo: casa por data e hora e pelo conteúdo, com a ementa que houver", async () => {
    const memoria = memoriaComAcordao({ idArquivoProjudi: undefined });
    const { cliente, chamadas } = clienteFalso([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos(),
      ementaRedireciona("900000555"),
      arquivoDeEmenta(),
      relatorioRedireciona(),
      relatorioEVoto(),
    ]);
    await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
    expect(chamadas).toHaveLength(6);
    expect(await memoria.obterTexto("tjgo:77")).toBeDefined();
  });

  it("sem Id_Arquivo e sem «Ementa» na movimentação: vale o relatório e voto, se trouxer a ementa da busca", async () => {
    const memoria = memoriaComAcordao({ idArquivoProjudi: undefined });
    const { cliente, chamadas } = clienteFalso([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos([RELATORIO]),
      relatorioRedireciona(),
      relatorioEVoto(),
    ]);
    await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
    expect(chamadas).toHaveLength(4);
    expect(await memoria.obterTexto("tjgo:77")).toBeDefined();
  });
});

describe("busca do TJGO guarda o Id_Arquivo do link do site, que amarra o arquivo «Ementa» do julgamento", () => {
  const LINK_DO_SITE = "https://projudi.tjgo.jus.br/ConsultaJurisprudencia?PaginaAtual=78&Id_Arquivo=900000100";
  const um = (tribunal: string, item: Record<string, unknown>) =>
    normalizar(tribunal, { results: [{ id: 1, texto_ementa: "EMENTA. EXEMPLO FICTÍCIO.", ...item }] }).acordaos[0];

  it("com número CNJ, o link é o do processo e o Id_Arquivo fica no acórdão", () => {
    const a = um("tjgo", { link_pdf: LINK_DO_SITE, numero_processo_cnj: CNJ });
    expect(a.link).toBe(PAGINA);
    expect(a.idArquivoProjudi).toBe("900000100");
  });

  it("acórdão guardado antes da troca do link: ao trocar, o Id_Arquivo do link antigo fica no acórdão", () => {
    const a = comLinkDoProcessoNoTjgo({ tribunal: "tjgo", numero: CNJ, numeroCnj: CNJ, link: LINK_DO_SITE });
    expect(a.link).toBe(PAGINA);
    expect(a.idArquivoProjudi).toBe("900000100");
  });

  it("link do site sem Id_Arquivo, ou outro tribunal: nada", () => {
    expect(um("tjgo", { link_pdf: "https://projudi.tjgo.jus.br/ConsultaJurisprudencia", numero_processo_cnj: CNJ }).idArquivoProjudi).toBeUndefined();
    expect(um("tjpi", { link_pdf: LINK_DO_SITE }).idArquivoProjudi).toBeUndefined();
  });
});

describe("ler_inteiro_teor — texto do Projudi do TJGO pelo id", () => {
  it("lê da memória com o rótulo do portal do TJGO", async () => {
    const memoria = memoriaComAcordao();
    const { cliente } = clienteFalso(cadeiaCompleta());
    await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);

    const p = await lerTextoIntegral("tjgo:77", 1, memoria);
    expect(p.cabecalho.tribunal).toBe("TJGO");
    expect(p.cabecalho.fonte).toMatch(/Projudi do TJGO/);
    expect(p.cabecalho.natureza).toMatch(/^texto do portal do tribunal \(TJGO\)/);
    expect(JSON.stringify(p.cabecalho)).not.toMatch(/TJTO|Falcão/);
  });
});

/**
 * Arquivos assinados (.p7s). Fixtures fictícias geradas com o openssl e um certificado autoassinado fictício
 * («Assinante Ficticio do Garimpo»), sobre o HTML e o PDF fictícios destes testes:
 *   openssl cms -sign -binary -nodetach [-stream] -in <conteúdo> -signer cert.pem -inkey chave.pem -outform DER
 * tjgo-ementa.html.p7s (DER), tjgo-relatorio-voto.html.p7s (BER de comprimento indefinido, -stream),
 * tjgo-relatorio-voto-pdf.p7s (PDF embutido) e tjgo-destacada.p7s (sem -nodetach: só a assinatura).
 */
describe("TJGO — arquivos assinados (.p7s): o documento embutido, com as mesmas amarrações", () => {
  const fixtureBinaria = (nome: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url)));
  const EMENTA_P7S: Arquivo = { tipo: "Ementa", nome: "ementa.html.p7s" };
  const RELATORIO_P7S: Arquivo = { tipo: "Relatório e Voto", nome: "relatorio_voto_acordao.html.p7s" };
  /** Como o Projudi respondeu ao vivo: 200 direto, o HTML de dentro do envelope, em ISO-8859-1. */
  const htmlDireto = (html: string) => () =>
    new Response(Buffer.from(html, "latin1"), {
      headers: { "content-type": "text/html;charset=iso-8859-1", "content-disposition": 'filename="x.html"' },
    });
  /** O envelope cru (CMS), se o Projudi o mandasse como está. */
  const envelope = (nome: string) => () =>
    new Response(fixtureBinaria(nome), { headers: { "content-type": "application/pkcs7-signature" } });
  const ementaHtml = `<p><strong>APELAÇÃO CÍVEL N.º ${CNJ}</strong></p><p>${EMENTA_DA_BUSCA}</p>`;
  const relatorioHtml = readFileSync(new URL("./fixtures/tjgo-relatorio-voto.html", import.meta.url), "utf8")
    .replace("{{EMENTA}}", "(ementa em arquivo próprio)")
    .replace("{{CLASSE}}", "APELAÇÃO CÍVEL");

  async function tentar(respostas: Parameters<typeof clienteFalso>[0], sobre: Partial<Acordao> = {}) {
    const memoria = memoriaComAcordao(sobre);
    const { cliente, chamadas } = clienteFalso(respostas);
    const r = await obterInteiroTeor({ id: "tjgo:77" }, () => cliente, memoria);
    return { r, chamadas, guardado: await memoria.obterTexto("tjgo:77"), explicacao: r.baixado ? "" : r.explicacao };
  }

  it("o Projudi entrega o HTML de dentro do envelope (como ao vivo): lê a ementa e o relatório e voto, 4 chamadas", async () => {
    const { chamadas, guardado } = await tentar([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos([EMENTA_P7S, RELATORIO_P7S]),
      htmlDireto(ementaHtml),
      htmlDireto(relatorioHtml),
    ]);
    expect(chamadas).toHaveLength(4);
    expect(guardado?.texto).toMatch(/EXEMPLO FICTÍCIO DE NEGATIVAÇÃO[\s\S]*A C Ó R D Ã O/);
  });

  it("envelope cru em DER e em BER de comprimento indefinido: extrai o documento embutido", async () => {
    const { guardado } = await tentar([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos([EMENTA_P7S, RELATORIO_P7S]),
      envelope("tjgo-ementa.html.p7s"),
      envelope("tjgo-relatorio-voto.html.p7s"),
    ]);
    expect(guardado?.texto).toMatch(/APELAÇÃO CÍVEL N\.º 0000001-11\.2024\.8\.09\.0001[\s\S]*EXEMPLO FICTÍCIO DE NEGATIVAÇÃO/);
    expect(guardado?.texto).toMatch(/Datado e assinado conforme Resolução nº 59\/2016/);
    // Nada do envelope (certificado, assinatura) vira texto.
    expect(guardado?.texto).not.toMatch(/Assinante Ficticio/);
  });

  it("envelope com PDF embutido: o texto sai pelo leitor de PDF do Garimpo", async () => {
    const { guardado } = await tentar([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos([EMENTA_P7S, RELATORIO_P7S]),
      envelope("tjgo-ementa.html.p7s"),
      envelope("tjgo-relatorio-voto-pdf.p7s"),
    ]);
    expect(guardado?.texto).toMatch(/A C O R D A O/);
    expect(guardado?.texto).toMatch(/0000001-11\.2024\.8\.09\.0001/);
  });

  it("assinatura destacada (sem documento embutido): não baixa e diz o motivo", async () => {
    const { explicacao, guardado } = await tentar([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos([EMENTA_P7S, RELATORIO_P7S]),
      envelope("tjgo-ementa.html.p7s"),
      envelope("tjgo-destacada.p7s"),
    ]);
    expect(explicacao).toMatch(/assinatura destacada/);
    expect(guardado).toBeUndefined();
  });

  it("envelope ilegível: não baixa e diz o motivo", async () => {
    const { explicacao, guardado } = await tentar([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos([EMENTA_P7S, RELATORIO_P7S]),
      envelope("tjgo-ementa.html.p7s"),
      () => new Response(new Uint8Array([0x30, 0x82, 0xff, 0xff, 0x06]), { headers: { "content-type": "application/octet-stream" } }),
    ]);
    expect(explicacao).toMatch(/envelope de assinatura .*fora do formato/);
    expect(guardado).toBeUndefined();
  });

  it("sem chave do armazenamento para conferir o Id_Arquivo: a «Ementa» sozinha tem de trazer a ementa da busca", async () => {
    const outra = `<p>APELAÇÃO CÍVEL N.º ${CNJ}</p><p>EMENTA: EMBARGOS DE DECLARAÇÃO FICTÍCIOS. OMISSÃO INEXISTENTE NO EXEMPLO.</p>`;
    const { explicacao, guardado } = await tentar([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos([EMENTA_P7S, RELATORIO_P7S]),
      htmlDireto(outra),
      // O relatório e voto repete a ementa da busca: sozinho, isso não basta quando o Id_Arquivo não pôde ser conferido.
      htmlDireto(relatorioHtml.replace("(ementa em arquivo próprio)", EMENTA_DA_BUSCA)),
    ]);
    expect(explicacao).toMatch(/a «Ementa» do julgamento não traz a ementa da busca/);
    expect(guardado).toBeUndefined();
  });

  it("arquivo que não é .p7s respondendo 200 direto (sem ir ao armazenamento): continua recusado", async () => {
    const { explicacao } = await tentar([
      paginaDoProcesso([JULGAMENTO]),
      listaDeArquivos([EMENTA, RELATORIO]),
      htmlDireto(ementaHtml),
    ]);
    expect(explicacao).toMatch(/fora do armazenamento do TJGO/);
  });
});

