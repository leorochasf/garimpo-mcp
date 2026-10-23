import { describe, expect, it } from "vitest";
import { documentoDoEnvelope, EnvelopeIlegivel } from "../src/envelopeCms.js";

// Envelopes montados à mão (fictícios), para os casos que o openssl não gera: campos que passam do campo de fora e
// aninhamento fundo demais. A leitura dos envelopes do openssl está nos testes do TJGO (tests/tjgo.test.ts).

/** Um campo DER com comprimento definido. */
function campo(etiqueta: number, ...conteudo: number[][]): number[] {
  const corpo = conteudo.flat();
  const n = corpo.length;
  const tamanho = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return [etiqueta, ...tamanho, ...corpo];
}

const SIGNED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
const DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01];

/** ContentInfo → SignedData (version, digestAlgorithms vazio, encapContentInfo com o conteúdo dado). */
function envelope(eContent: number[]): Uint8Array {
  const encap = campo(0x30, campo(0x06, DATA), campo(0xa0, eContent));
  const signedData = campo(0x30, campo(0x02, [1]), campo(0x31), encap);
  return new Uint8Array(campo(0x30, campo(0x06, SIGNED_DATA), campo(0xa0, signedData)));
}

const ABC = [0x41, 0x42, 0x43];

describe("documentoDoEnvelope (CMS SignedData, sem conferir assinatura)", () => {
  it("envelope bem formado: o documento embutido", () => {
    expect(Buffer.from(documentoDoEnvelope(envelope(campo(0x04, ABC)))!).toString("latin1")).toBe("ABC");
  });

  it("OCTET STRING em pedaços (0x24): junta os pedaços", () => {
    const pedacos = campo(0x24, campo(0x04, [0x41]), campo(0x04, [0x42, 0x43]));
    expect(Buffer.from(documentoDoEnvelope(envelope(pedacos))!).toString("latin1")).toBe("ABC");
  });

  it("campo que passa do fim do campo que o contém: ilegível, nunca lê bytes de fora", () => {
    const b = envelope(campo(0x04, ABC));
    // O OCTET STRING declara 5 bytes dentro de um [0] que só tem 5 (2 de cabeçalho + 3): os 2 a mais seriam dos vizinhos.
    const i = b.lastIndexOf(0x04);
    b[i + 1] = 5;
    const comSobra = new Uint8Array([...b, 0x44, 0x45]);
    expect(() => documentoDoEnvelope(comSobra)).toThrow(EnvelopeIlegivel);
  });

  it("aninhamento de OCTET STRING em pedaços além do teto: ilegível", () => {
    let fundo = campo(0x04, ABC);
    for (let n = 0; n < 40; n++) fundo = campo(0x24, fundo);
    expect(() => documentoDoEnvelope(envelope(fundo))).toThrow(EnvelopeIlegivel);
  });

  it("muitos campos de comprimento indefinido aninhados: responde rápido e recusa", () => {
    // 30 80 repetido sem fim: cada nível abre outro, até o teto de profundidade.
    const b = new Uint8Array(200_000).map((_, i) => (i % 2 === 0 ? 0x30 : 0x80));
    const inicio = Date.now();
    expect(() => documentoDoEnvelope(b)).toThrow(EnvelopeIlegivel);
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it("sem conteúdo embutido (assinatura destacada): undefined", () => {
    const encap = campo(0x30, campo(0x06, DATA));
    const signedData = campo(0x30, campo(0x02, [1]), campo(0x31), encap);
    expect(documentoDoEnvelope(new Uint8Array(campo(0x30, campo(0x06, SIGNED_DATA), campo(0xa0, signedData))))).toBeUndefined();
  });
});
