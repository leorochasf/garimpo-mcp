import { describe, expect, it } from "vitest";
import { htmlComIndicioDeCorte, htmlParaTexto } from "../src/html.js";

describe("HTML → texto do Falcão", () => {
  it("decodifica entidades nomeadas e numéricas; entidade desconhecida fica como veio", () => {
    expect(htmlParaTexto("SUPRESS&Atilde;O &eacute; &#231;&#xE3; &sect; 1&ordm; &amp; &quot;x&quot; &naoexiste;")).toBe(
      'SUPRESSÃO é çã § 1º & "x" &naoexiste;',
    );
  });

  it("etiquetas aninhadas inline somem sem grudar nem separar palavras", () => {
    expect(htmlParaTexto("<p>Fundamenta&ccedil;&atilde;o, <i>com</i> etiquetas <span><b>aninha</b>das</span>.</p>")).toBe(
      "Fundamentação, com etiquetas aninhadas.",
    );
  });

  it("blocos viram quebra de linha: parágrafo, br, item, célula; palavras de blocos vizinhos não grudam", () => {
    const texto = htmlParaTexto("<p>VOTO</p><p>linha um<br>linha dois</p><ul><li>Item um</li><li>Item dois</li></ul><table><tr><td>A</td><td>B</td></tr></table>");
    expect(texto.split("\n").filter(Boolean)).toEqual(["VOTO", "linha um", "linha dois", "Item um", "Item dois", "A", "B"]);
    expect(texto).not.toMatch(/VOTOlinha|umItem|AB/);
  });

  it("tira imagem (inclusive embutida em base64), script, style e comentários", () => {
    const texto = htmlParaTexto(
      '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="brasão"></p><p>Texto</p><!-- nota --><script>alert(1)</script><style>p{}</style>',
    );
    expect(texto).toBe("Texto");
  });

  it("espaços horizontais repetidos (e &nbsp;) viram um, sem apagar quebras; fim de linha do código-fonte é espaço", () => {
    expect(htmlParaTexto("<p>a  \t b&nbsp;&nbsp;c</p>\n<p>d\ne</p><p></p><p>f</p>")).toBe("a b c\n\nd e\n\n\n\nf");
  });

  it("nenhuma outra mudança: hífen de fim de linha, maiúsculas e grafia ficam como vieram", () => {
    expect(htmlParaTexto("<p>JURISPRU-<br>DÊNCIA extritamente Juriprudência</p>")).toBe("JURISPRU-\nDÊNCIA extritamente Juriprudência");
  });

  it("indício de corte: HTML que termina no meio do texto ou de uma etiqueta", () => {
    expect(htmlComIndicioDeCorte("<p>inteiro</p>")).toBe(false);
    expect(htmlComIndicioDeCorte("<p>cortado no mei")).toBe(true);
    expect(htmlComIndicioDeCorte("<p>cortado</p><p cla")).toBe(true);
    expect(htmlComIndicioDeCorte("")).toBe(false);
  });
});
