/**
 * Leitor mínimo de ZIP para o gerador dos Espelhos (ADR-0022): lê o diretório central e abre as entradas sem
 * compressão ou deflate, conferindo tamanho e CRC. Sem ZIP64, sem criptografia, sem extração em disco: o conteúdo fica
 * em memória e o nome da entrada nunca vira caminho.
 */

import { crc32, inflateRawSync } from "node:zlib";

export interface EntradaDoZip {
  nome: string;
  dados: Buffer;
}

const FIM_DO_DIRETORIO = 0x06054b50;
const ENTRADA_CENTRAL = 0x02014b50;
const ENTRADA_LOCAL = 0x04034b50;

export function lerZip(bytes: Buffer): EntradaDoZip[] {
  // O registro de fim de diretório tem 22 bytes e um comentário opcional de até 65535 bytes depois dele.
  let fim = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (bytes.readUInt32LE(i) === FIM_DO_DIRETORIO) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error("o arquivo não é um ZIP (sem registro de fim de diretório)");
  const quantidade = bytes.readUInt16LE(fim + 10);
  let p = bytes.readUInt32LE(fim + 16);
  if (quantidade === 0xffff || p === 0xffffffff) throw new Error("ZIP64 não é suportado");
  const entradas: EntradaDoZip[] = [];
  for (let n = 0; n < quantidade; n++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== ENTRADA_CENTRAL) throw new Error("ZIP com diretório central corrompido");
    const metodo = bytes.readUInt16LE(p + 10);
    const crc = bytes.readUInt32LE(p + 16);
    const comprimido = bytes.readUInt32LE(p + 20);
    const tamanho = bytes.readUInt32LE(p + 24);
    const tamNome = bytes.readUInt16LE(p + 28);
    const tamExtra = bytes.readUInt16LE(p + 30);
    const tamComentario = bytes.readUInt16LE(p + 32);
    const local = bytes.readUInt32LE(p + 42);
    const nome = bytes.toString("utf8", p + 46, p + 46 + tamNome);
    p += 46 + tamNome + tamExtra + tamComentario;
    if (comprimido === 0xffffffff || tamanho === 0xffffffff || local === 0xffffffff) throw new Error("ZIP64 não é suportado");
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== ENTRADA_LOCAL) throw new Error(`ZIP: cabeçalho local de ${nome} corrompido`);
    const inicio = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const bruto = bytes.subarray(inicio, inicio + comprimido);
    if (bruto.length !== comprimido) throw new Error(`ZIP: ${nome} truncado`);
    if (metodo !== 0 && metodo !== 8) throw new Error(`ZIP: método de compressão ${metodo} de ${nome} não é suportado`);
    const dados = metodo === 0 ? Buffer.from(bruto) : inflateRawSync(bruto);
    if (dados.length !== tamanho) throw new Error(`ZIP: tamanho de ${nome} não confere`);
    if (crc32(dados) >>> 0 !== crc) throw new Error(`ZIP: CRC de ${nome} não confere`);
    entradas.push({ nome, dados });
  }
  return entradas;
}
