/**
 * O documento embutido num arquivo assinado .p7s (PKCS#7 / CMS, SignedData), sem dependência: só a leitura das
 * camadas DER/BER até o conteúdo (encapContentInfo.eContent). O Garimpo não confere a assinatura nem o certificado.
 */

/** Um campo DER/BER: etiqueta, onde começa e termina o conteúdo e onde começa o campo seguinte. */
interface Campo {
  etiqueta: number;
  inicio: number;
  fim: number;
  proximo: number;
}

/** OID 1.2.840.113549.1.7.2 (signedData), já codificado. */
const SIGNED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
/** Profundidade máxima de aninhamento aceita: o envelope tem poucas camadas; mais que isso é arquivo estranho. */
const PROFUNDIDADE_MAXIMA = 32;

export class EnvelopeIlegivel extends Error {}

/**
 * O campo que começa em i e tem de terminar até `limite` (o fim do campo de fora): nenhum campo lê bytes de um
 * vizinho, e cada byte pertence a um só caminho. A profundidade conta em todos os caminhos, inclusive o OCTET STRING.
 */
function ler(b: Uint8Array, i: number, limite: number, profundidade: number): Campo {
  if (profundidade > PROFUNDIDADE_MAXIMA || i + 2 > limite) throw new EnvelopeIlegivel();
  const etiqueta = b[i];
  // Etiquetas de mais de um byte não aparecem no SignedData.
  if ((etiqueta & 0x1f) === 0x1f) throw new EnvelopeIlegivel();
  let j = i + 1;
  let tamanho = b[j++];
  if (tamanho === 0x80) {
    // Comprimento indefinido (BER): os campos de dentro até o marcador 00 00.
    if (!(etiqueta & 0x20)) throw new EnvelopeIlegivel();
    let k = j;
    while (!(b[k] === 0 && b[k + 1] === 0)) {
      if (k + 2 > limite) throw new EnvelopeIlegivel();
      k = ler(b, k, limite, profundidade + 1).proximo;
    }
    if (k + 2 > limite) throw new EnvelopeIlegivel();
    return { etiqueta, inicio: j, fim: k, proximo: k + 2 };
  }
  if (tamanho & 0x80) {
    const bytes = tamanho & 0x7f;
    if (bytes === 0 || bytes > 4 || j + bytes > limite) throw new EnvelopeIlegivel();
    tamanho = 0;
    for (let n = 0; n < bytes; n++) tamanho = tamanho * 256 + b[j++];
  }
  if (j + tamanho > limite) throw new EnvelopeIlegivel();
  return { etiqueta, inicio: j, fim: j + tamanho, proximo: j + tamanho };
}

/** Os campos de dentro de c, cada um contido nele. */
function dentro(b: Uint8Array, c: Campo, profundidade: number): Campo[] {
  const campos: Campo[] = [];
  for (let i = c.inicio; i < c.fim; ) {
    const f = ler(b, i, c.fim, profundidade + 1);
    campos.push(f);
    i = f.proximo;
  }
  return campos;
}

/** Os bytes de um OCTET STRING, simples (0x04) ou em pedaços (0x24, BER). */
function octetos(b: Uint8Array, c: Campo, profundidade: number): Uint8Array {
  if (c.etiqueta === 0x04) return b.subarray(c.inicio, c.fim);
  if (c.etiqueta !== 0x24) throw new EnvelopeIlegivel();
  return Buffer.concat(dentro(b, c, profundidade).map((f) => octetos(b, f, profundidade + 1)));
}

/**
 * O documento embutido no envelope; undefined = assinatura destacada (o envelope não traz o documento).
 * Envelope fora do formato SignedData = EnvelopeIlegivel.
 */
export function documentoDoEnvelope(b: Uint8Array): Uint8Array | undefined {
  try {
    const info = ler(b, 0, b.length, 0);
    if (info.etiqueta !== 0x30) throw new EnvelopeIlegivel();
    const [tipo, conteudo] = dentro(b, info, 0);
    const oid = b.subarray(tipo?.inicio ?? 0, tipo?.fim ?? 0);
    if (tipo?.etiqueta !== 0x06 || oid.length !== SIGNED_DATA.length || oid.some((x, k) => x !== SIGNED_DATA[k])) {
      throw new EnvelopeIlegivel();
    }
    if (conteudo?.etiqueta !== 0xa0) throw new EnvelopeIlegivel();
    const [signedData] = dentro(b, conteudo, 1);
    if (signedData?.etiqueta !== 0x30) throw new EnvelopeIlegivel();
    // SignedData: version, digestAlgorithms, encapContentInfo, …
    const encap = dentro(b, signedData, 2)[2];
    if (encap?.etiqueta !== 0x30) throw new EnvelopeIlegivel();
    const [, embutido] = dentro(b, encap, 3);
    if (!embutido) return undefined;
    if (embutido.etiqueta !== 0xa0) throw new EnvelopeIlegivel();
    const [documento] = dentro(b, embutido, 4);
    if (!documento) throw new EnvelopeIlegivel();
    return octetos(b, documento, 5);
  } catch (e) {
    if (e instanceof EnvelopeIlegivel) throw e;
    throw new EnvelopeIlegivel();
  }
}
