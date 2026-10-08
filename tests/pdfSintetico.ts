/**
 * PDF sintético para os testes, gerado aqui mesmo, sem rede e sem dependência. Cada página é uma lista de linhas
 * de texto genérico (lista vazia = página sem texto extraível) ou uma lista de textos posicionados, desenhados na
 * ordem da lista — o fluxo do PDF —, que pode não ser a ordem visual. Fonte Helvetica com WinAnsi, então acentos de
 * latin1 saem certos.
 */
export function pdfSintetico(paginas: (string[] | TextoPosicionado[])[]): Uint8Array<ArrayBuffer> {
  const objetos: string[] = [];
  const novo = (corpo: string) => objetos.push(corpo); // devolve o número do objeto (1, 2, 3…)

  novo("<< /Type /Catalog /Pages 2 0 R >>");
  novo(""); // páginas: preenchido depois de saber os números dos filhos
  novo("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const filhos: number[] = [];
  for (const pagina of paginas) {
    const linhas = pagina.filter((l) => typeof l === "string");
    const posicionados = pagina.filter((l) => typeof l !== "string");
    // Página alta o bastante para todas as linhas: o extrator ignora texto fora da página.
    const altura = Math.max(842, 12 * linhas.length + 64);
    const formularios: string[] = [];
    const conteudo = posicionados.length
      ? posicionados
          .map(({ x, y, texto, girado, tamanho = 9, carimbo }) => {
            const bt = `BT /F1 ${tamanho} Tf ${girado ? "0 1 -1 0" : "1 0 0 1"} ${x} ${y} Tm (${escapar(texto)}) Tj ET`;
            if (!carimbo) return bt;
            const n = novo(
              `<< /Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> ` +
                `/Length ${Buffer.byteLength(bt, "latin1")} >>\nstream\n${bt}\nendstream`,
            );
            formularios.push(`/X${n} ${n} 0 R`);
            return `/X${n} Do`;
          })
          .join("\n")
      : linhas.length
        ? `BT /F1 9 Tf 12 TL 30 ${altura - 32} Td ${linhas.map((l) => `(${escapar(l)}) Tj T*`).join(" ")} ET`
        : "";
    const fluxo = novo(`<< /Length ${Buffer.byteLength(conteudo, "latin1")} >>\nstream\n${conteudo}\nendstream`);
    filhos.push(
      novo(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 ${altura}] ` +
          `/Resources << /Font << /F1 3 0 R >> /XObject << ${formularios.join(" ")} >> >> /Contents ${fluxo} 0 R >>`,
      ),
    );
  }
  objetos[1] = `<< /Type /Pages /Kids [${filhos.map((n) => `${n} 0 R`).join(" ")}] /Count ${filhos.length} >>`;

  let saida = "%PDF-1.4\n";
  const posicoes: number[] = [];
  objetos.forEach((corpo, i) => {
    posicoes.push(Buffer.byteLength(saida, "latin1"));
    saida += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });
  const xref = Buffer.byteLength(saida, "latin1");
  saida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  saida += posicoes.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("");
  saida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(saida, "latin1"));
}

/**
 * Texto desenhado em (x, y) da página A4 (595 × 842), em corpo 9 se não disser outro tamanho; girado = de baixo para
 * cima, como carimbo de margem; carimbo = num formulário à parte (XObject), como a assinatura eletrônica aposta depois.
 */
export interface TextoPosicionado {
  x: number;
  y: number;
  texto: string;
  girado?: boolean;
  tamanho?: number;
  carimbo?: boolean;
}

function escapar(texto: string): string {
  return texto.replace(/[\\()]/g, (c) => `\\${c}`);
}
