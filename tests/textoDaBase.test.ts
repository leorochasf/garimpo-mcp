import { describe, expect, it } from "vitest";
import { ROTULO_TEXTO_DA_BASE, TETO_BYTES_TEXTO_DA_BASE, textoDaBase } from "../src/textoDaBase.js";

/** Texto da base (ADR do b22-07): o HTML que o JurisprudênciaIA embute no `link` do TJES e do TJMA. HTML sintético, sem dados reais. */
const HTML = `<html><head><style>.x{color:red}</style><script>var a=1;</script></head><body>
<div><img src="https://exemplo.test/brasao.png"></div>
<h2>Inteiro Teor</h2>
<p>EMENTA: APELAÇÃO CÍVEL. Texto fictício de ementa.</p>
<p>VOTO<br>Razões fictícias de decidir, com &ldquo;aspas&rdquo; e acentua&ccedil;&atilde;o.</p>
<table><tr><td>Relator</td><td>Fulano Fictício</td></tr></table>
</body></html>`;

const comoDataUri = (html: string, cabecalho = "data:text/html;base64,") =>
  cabecalho + Buffer.from(html, "utf8").toString("base64");

describe("textoDaBase — decodifica o data:text/html do registro e converte pela regra fixa do Garimpo", () => {
  it("devolve o texto convertido e o rótulo «texto da base do JurisprudênciaIA, não oficial»", () => {
    const r = textoDaBase(comoDataUri(HTML));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rotulo).toBe("texto da base do JurisprudênciaIA, não oficial");
    expect(r.rotulo).toBe(ROTULO_TEXTO_DA_BASE);
    expect(r.texto).toContain("EMENTA: APELAÇÃO CÍVEL. Texto fictício de ementa.");
    expect(r.texto).toContain("Razões fictícias de decidir, com “aspas” e acentuação.");
    expect(r.texto).toMatch(/Relator\s+Fulano Fictício/);
  });

  it("não deixa etiqueta, imagem, estilo nem script no texto", () => {
    const r = textoDaBase(comoDataUri(HTML));
    if (!r.ok) throw new Error("esperava texto");
    expect(r.texto).not.toMatch(/<|brasao|color:red|var a=1/);
  });

  it("aceita charset declarado (iso-8859-1) e lê os acentos certos", () => {
    const latin1 = Buffer.from("<p>EMENTA: ação de indenização, texto fictício.</p>", "latin1").toString("base64");
    const r = textoDaBase(`data:text/html;charset=iso-8859-1;base64,${latin1}`);
    if (!r.ok) throw new Error("esperava texto");
    expect(r.texto).toContain("ação de indenização");
  });

  it("aceita o tipo em maiúsculas e ignora espaços ao redor", () => {
    const r = textoDaBase(`  ${comoDataUri(HTML, "DATA:TEXT/HTML;BASE64,")}  `);
    expect(r.ok).toBe(true);
  });

  it("avisa quando o HTML parece cortado ou tinha trechos ocultos, sem apagar o texto", () => {
    const cortado = textoDaBase(comoDataUri("<p>EMENTA: texto fictício que termina no meio de uma etiq<"));
    if (!cortado.ok) throw new Error("esperava texto");
    expect(cortado.indicioDeCorte).toBe(true);
    const oculto = textoDaBase(comoDataUri(`<div style="display:none">trecho oculto fictício</div><p>${"texto fictício ".repeat(10)}</p>`));
    if (!oculto.ok) throw new Error("esperava texto");
    expect(oculto.conteudoOculto).toBe(true);
    expect(oculto.texto).toContain("trecho oculto fictício");
    const normal = textoDaBase(comoDataUri(HTML));
    if (!normal.ok) throw new Error("esperava texto");
    expect(normal.indicioDeCorte).toBe(false);
    expect(normal.conteudoOculto).toBe(false);
  });
});

describe("textoDaBase — recusa o que não é data:text/html em base64, com o motivo", () => {
  const recusa = (valor: string) => {
    const r = textoDaBase(valor);
    expect(r.ok).toBe(false);
    return r.ok ? undefined : r.recusa;
  };

  it("endereço web, gs:, vazio e outros tipos de data: não são texto da base", () => {
    expect(recusa("https://esaj.tjce.jus.br/cjsg/getArquivo.do?cdAcordao=1&cdForo=0")).toBe("não é data:text/html");
    expect(recusa("gs://bucket/arquivo.pdf")).toBe("não é data:text/html");
    expect(recusa("")).toBe("não é data:text/html");
    expect(recusa("data:application/pdf;base64,JVBERi0=")).toBe("não é data:text/html");
    expect(recusa("data:text/plain;base64,YWJj")).toBe("não é data:text/html");
  });

  it("data:text/html sem base64 ou com base64 inválido", () => {
    expect(recusa("data:text/html,%3Cp%3Etexto%3C%2Fp%3E")).toBe("sem base64");
    expect(recusa("data:text/html;base64,@@@não é base64@@@")).toBe("base64 inválido");
  });

  it("HTML sem texto útil (só imagem, estilo ou vazio)", () => {
    expect(recusa(comoDataUri("<html><body><img src='x.png'><style>p{}</style></body></html>"))).toBe("sem texto");
    expect(recusa("data:text/html;base64,")).toBe("sem texto");
  });

  it("acima do teto de tamanho: recusa sem decodificar", () => {
    const grande = `data:text/html;base64,${"A".repeat(Math.ceil((TETO_BYTES_TEXTO_DA_BASE * 4) / 3) + 8)}`;
    expect(recusa(grande)).toBe("grande demais");
  });

  it("os tamanhos observados (60 a 294 KB de data:) cabem no teto", () => {
    const html = `<p>${"texto fictício de acórdão. ".repeat(10_000)}</p>`; // ~270 KB
    const r = textoDaBase(comoDataUri(html));
    expect(r.ok).toBe(true);
  });
});
