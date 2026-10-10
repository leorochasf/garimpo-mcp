import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type EntradaDoStf,
  gerarEGravarStf,
  gerarTabelaStf,
  lerEntrada,
  ParadaDoGerador,
} from "../scripts/gerarTabelaStf.js";

const caminho = (nome: string) => new URL(`./fixtures/stf-sintetico/${nome}`, import.meta.url);
const gravado = (nome: string) => readFileSync(caminho(nome));
const arquivo = (nome: string, bytes = gravado(nome), obtidoEm = "2026-10-09T12:00:00.000Z") => ({ nome, bytes, obtidoEm });

function entrada(trocas: Partial<EntradaDoStf> = {}): EntradaDoStf {
  return {
    repercussaoGeral: arquivo("RepercussaoGeral.xls"),
    sumulas: arquivo("sumulas.html"),
    sumulasVinculantes: arquivo("sumulas-vinculantes.html"),
    paginasDeSumula: [arquivo("sumulas/sumula-1.html"), arquivo("sumulas/sv-1.html")],
    ...trocas,
  };
}

const GERADA = "2026-10-09T13:00:00.000Z";
const linha = (t: ReturnType<typeof gerarTabelaStf>, tipo: string, numero: number) =>
  t.linhas.find((l) => l.tipo === tipo && l.numero === numero);

/** O export de RG com uma troca de texto (o arquivo é HTML em UTF-8). */
const rgCom = (de: string, para: string) =>
  arquivo("RepercussaoGeral.xls", Buffer.from(gravado("RepercussaoGeral.xls").toString("utf8").replace(de, para)));

describe("gerador da tabela do STF — repercussão geral (exportação do mantenedor)", () => {
  const tabela = gerarTabelaStf(entrada(), GERADA);

  it("cada tema uma vez, com a situação do tema literal e o leading case como processo paradigma", () => {
    expect(tabela.linhas.filter((l) => l.tipo === "repercussão geral").map((l) => l.numero)).toEqual([1, 2, 3]);
    const t1 = linha(tabela, "repercussão geral", 1)!;
    expect(t1.situacao).toBe("Trânsito em Julgado");
    expect(t1.processosParadigma).toEqual(["RE 100001"]);
    expect(t1.relator).toBe("MIN. FICTÍCIO UM");
    expect(t1.titulo).toBe("Título fictício do tema um.");
    expect(t1.dataJulgamento).toBe("01/02/2010");
    expect(t1.dataTese).toBe("01/02/2010");
    expect(linha(tabela, "repercussão geral", 2)!.situacao).toBe("Cancelado");
  });

  it("tese: HTML para texto por regra fixa (entidades decodificadas, <br> vira quebra de linha), nada mais", () => {
    expect(linha(tabela, "repercussão geral", 1)!.teseFirmada).toBe(
      'Tese fictícia do tema um, "com aspas" & e comercial.\nSegunda linha da tese.',
    );
    expect(linha(tabela, "repercussão geral", 2)!.teseFirmada).toBeUndefined();
  });

  it("entidades nomeadas decodificadas, com maiúsculas significativas; entidade desconhecida para o gerador", () => {
    const t = gerarTabelaStf(
      entrada({ repercussaoGeral: rgCom("Tese fictícia do tema um", "Tese fict&iacute;cia do tema um (art. 5&ordm;, &sect; 1&ordm;, &Aacute;rea)") }),
      GERADA,
    );
    expect(linha(t, "repercussão geral", 1)!.teseFirmada).toMatch(/^Tese fictícia do tema um \(art\. 5º, § 1º, Área\)/);
    expect(() => gerarTabelaStf(entrada({ repercussaoGeral: rgCom("Tese fictícia", "Tese fict&inexistente;cia") }), GERADA)).toThrow(
      /entidade/,
    );
  });

  it('"Há Repercussão": desfaz só a dupla codificação conhecida da coluna e registra isso na tabela', () => {
    expect(linha(tabela, "repercussão geral", 1)!.haRepercussao).toBe("Há");
    expect(linha(tabela, "repercussão geral", 2)!.haRepercussao).toBe("Não há (questão infraconstitucional)");
    expect(linha(tabela, "repercussão geral", 3)!.haRepercussao).toBe("Há (com reafirmação de jurisprudência)");
    expect(tabela.transformacaoDosTextos).toMatch(/Há Repercussão/);
  });

  it("para em cabeçalho diferente do esperado", () => {
    expect(() => gerarTabelaStf(entrada({ repercussaoGeral: rgCom("<th>Tese</th>", "<th>Teses</th>") }), GERADA)).toThrow(
      ParadaDoGerador,
    );
  });

  it("para em acentuação corrompida fora da coluna conhecida (não conserta a fonte em silêncio)", () => {
    expect(() =>
      gerarTabelaStf(entrada({ repercussaoGeral: rgCom("Tese fictícia do tema um", "Tese fictÃ­cia do tema um") }), GERADA),
    ).toThrow(/acentuação/);
  });

  it("para em tema repetido e em número que não é inteiro", () => {
    expect(() => gerarTabelaStf(entrada({ repercussaoGeral: rgCom("<td>0002</td>", "<td>0001</td>") }), GERADA)).toThrow(
      ParadaDoGerador,
    );
    expect(() => gerarTabelaStf(entrada({ repercussaoGeral: rgCom("<td>0003</td>", "<td>3a</td>") }), GERADA)).toThrow(
      ParadaDoGerador,
    );
  });

  it("para se o arquivo não tem nenhuma linha de tema (ex.: página de erro salva no lugar do export)", () => {
    const vazio = arquivo("RepercussaoGeral.xls", Buffer.from("<html><body>403 Forbidden</body></html>"));
    expect(() => gerarTabelaStf(entrada({ repercussaoGeral: vazio }), GERADA)).toThrow(ParadaDoGerador);
  });
});

describe("gerador da tabela do STF — súmulas e súmulas vinculantes (telas salvas pelo mantenedor)", () => {
  const tabela = gerarTabelaStf(entrada(), GERADA);

  it("número e marca de situação da lista, literal; sem marca, nenhuma situação", () => {
    expect(tabela.linhas.filter((l) => l.tipo === "súmula").map((l) => [l.numero, l.situacao])).toEqual([
      [1, undefined],
      [2, "superada"],
      [3, "cancelada"],
    ]);
    expect(tabela.linhas.filter((l) => l.tipo === "súmula vinculante").map((l) => [l.numero, l.situacao])).toEqual([
      [1, undefined],
      [2, "cancelada"],
    ]);
  });

  it("link da página da súmula no portal do STF", () => {
    expect(linha(tabela, "súmula", 2)!.link).toBe("https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=30&sumula=9002");
    expect(linha(tabela, "súmula vinculante", 1)!.link).toBe(
      "https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26&sumula=9101",
    );
  });

  it("enunciado só da página da súmula salva; sem a página, sem enunciado", () => {
    expect(linha(tabela, "súmula", 1)!.enunciado).toBe("Enunciado fictício da súmula um, sem valor jurídico.");
    expect(linha(tabela, "súmula vinculante", 1)!.enunciado).toBe("Enunciado fictício da súmula vinculante um.");
    expect(linha(tabela, "súmula", 2)!.enunciado).toBeUndefined();
  });

  it("enunciado com elemento filho: o texto depois do filho fechado continua no enunciado", () => {
    const pagina = arquivo(
      "sumulas/sumula-1.html",
      Buffer.from(
        '<div class="titulo">Súmula 1</div>\n<div class="parCOM"><div>Primeira parte fictícia.</div> Segunda parte fictícia.</div>\n' +
          '<div class="titulo">Observação</div><div class="parCOM">Observação fictícia.</div>',
      ),
    );
    expect(linha(gerarTabelaStf(entrada({ paginasDeSumula: [pagina] }), GERADA), "súmula", 1)!.enunciado).toBe(
      "Primeira parte fictícia.\nSegunda parte fictícia.",
    );
    const semFechar = arquivo("sumulas/sumula-1.html", Buffer.from('<div class="titulo">Súmula 1</div><div class="parCOM"><div>Parte fictícia.</div>'));
    expect(() => gerarTabelaStf(entrada({ paginasDeSumula: [semFechar] }), GERADA)).toThrow(ParadaDoGerador);
  });

  it("para em item da lista com rótulo fora da forma, em lista trocada e em página de súmula fora da lista", () => {
    const troca = (nome: string, de: string, para: string) =>
      arquivo(nome, Buffer.from(gravado(nome).toString("utf8").replace(de, para)));
    expect(() => gerarTabelaStf(entrada({ sumulas: troca("sumulas.html", "Súmula 2 (superada)", "Enunciado 2") }), GERADA)).toThrow(
      ParadaDoGerador,
    );
    expect(() => gerarTabelaStf(entrada({ sumulas: arquivo("sumulas-vinculantes.html") }), GERADA)).toThrow(ParadaDoGerador);
    const fora = arquivo("x.html", Buffer.from(gravado("sumulas/sumula-1.html").toString("utf8").replace("Súmula 1", "Súmula 99")));
    expect(() => gerarTabelaStf(entrada({ paginasDeSumula: [fora] }), GERADA)).toThrow(ParadaDoGerador);
  });

  it("nenhum item da lista some em silêncio: variante válida de HTML entra, item irreconhecível para", () => {
    const sumulasCom = (de: string, para: string) =>
      arquivo("sumulas.html", Buffer.from(gravado("sumulas.html").toString("utf8").replace(de, para)));
    const aspasSimples = sumulasCom('href="sumariosumulas.asp?base=30&sumula=9002"', "href='sumariosumulas.asp?base=30&sumula=9002'");
    const t = gerarTabelaStf(entrada({ sumulas: aspasSimples }), GERADA);
    expect(t.linhas.filter((l) => l.tipo === "súmula").map((l) => l.numero)).toEqual([1, 2, 3]);
    const outroAtributo = sumulasCom('<div class="sumula-item"><a target="_blank" href="sumariosumulas.asp?base=30&sumula=9002">', '<div class="sumula-item" id="s2"><a target="_blank" href="sumariosumulas.asp?base=30&sumula=9002">');
    expect(gerarTabelaStf(entrada({ sumulas: outroAtributo }), GERADA).linhas.filter((l) => l.tipo === "súmula")).toHaveLength(3);
    const semLink = sumulasCom('<a target="_blank" href="sumariosumulas.asp?base=30&sumula=9002">', '<a target="_blank">');
    expect(() => gerarTabelaStf(entrada({ sumulas: semLink }), GERADA)).toThrow(ParadaDoGerador);
  });
});

describe("gerador da tabela do STF — metadados", () => {
  it("fonte, fundamento literal, arquivos com sha256 e data, geração e transformação", () => {
    const t = gerarTabelaStf(entrada(), GERADA);
    expect(t.fundamento).toMatch(/^Lei 9\.610\/98, art\. 8º, IV: "os textos de tratados ou convenções, leis, decretos, regulamentos, decisões judiciais e demais atos oficiais"/);
    expect(t.atribuicao).toMatch(/^Fonte: STF/);
    expect(t.arquivos.map((a) => a.parte)).toEqual([
      "repercussão geral",
      "súmula",
      "súmula vinculante",
      "página de súmula",
      "página de súmula",
    ]);
    for (const a of t.arquivos) {
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.obtidoEm).toBe("2026-10-09T12:00:00.000Z");
    }
    expect(t.geradaEm).toBe(GERADA);
    expect(t.partesAusentes).toEqual([]);
  });

  it("sem arquivo nenhum, a tabela sai vazia e diz quais partes faltam", () => {
    const t = gerarTabelaStf({ paginasDeSumula: [] }, GERADA);
    expect(t.linhas).toEqual([]);
    expect(t.partesAusentes).toEqual(["repercussão geral", "súmula", "súmula vinculante"]);
  });
});

describe("gerador da tabela do STF — pasta de entrada e gravação", () => {
  function pastaDeEntrada() {
    const pasta = mkdtempSync(join(process.env.GARIMPO_DADOS!, "entrada-stf-"));
    mkdirSync(join(pasta, "sumulas"));
    for (const n of ["RepercussaoGeral.xls", "sumulas.html", "sumulas-vinculantes.html", "sumulas/sumula-1.html"]) {
      copyFileSync(caminho(n), join(pasta, n));
      utimesSync(join(pasta, n), new Date("2026-10-08T10:00:00Z"), new Date("2026-10-08T10:00:00Z"));
    }
    return pasta;
  }

  it("lê a pasta, com a data de modificação de cada arquivo como data em que foi obtido", () => {
    const e = lerEntrada(pastaDeEntrada());
    expect(e.repercussaoGeral!.obtidoEm).toBe("2026-10-08T10:00:00.000Z");
    expect(e.paginasDeSumula.map((p) => p.nome)).toEqual(["sumulas/sumula-1.html"]);
  });

  it("grava de uma vez; numa parada, a tabela anterior continua", () => {
    const pasta = pastaDeEntrada();
    const destino = join(mkdtempSync(join(process.env.GARIMPO_DADOS!, "destino-")), "tabela.json");
    const t = gerarEGravarStf(pasta, destino, () => Date.parse(GERADA));
    expect(JSON.parse(readFileSync(destino, "utf8")).linhas).toHaveLength(t.linhas.length);
    writeFileSync(join(pasta, "RepercussaoGeral.xls"), "<html>sem tabela</html>");
    expect(() => gerarEGravarStf(pasta, destino, () => Date.parse(GERADA))).toThrow(ParadaDoGerador);
    expect(JSON.parse(readFileSync(destino, "utf8")).linhas).toHaveLength(t.linhas.length);
    expect(existsSync(`${destino}.gerando`)).toBe(false);
  });
});
