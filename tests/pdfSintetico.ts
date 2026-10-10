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

// ---- PDFs de acórdão genérico para os testes de leitura e de conferência (tickets 06 a 09 do bloco b15) ----

/** Linha de assinatura eletrônica genérica (~80 caracteres), a única que um PDF escaneado costuma ter como texto. */
export const LINHA_DE_CARIMBO = "Documento assinado eletronicamente, conforme MP 2.200-2/2001. Codigo de verificacao 000000";

/** Página de carimbo: só a linha de assinatura eletrônica, como no PDF escaneado. */
const paginaDeCarimbo = (n: number): string[] => [`${LINHA_DE_CARIMBO} - pagina ${n}`];

/** Página de texto nativo corrido, genérico, com marca de página para o teste achar o que leu. */
const paginaNativa = (n: number): string[] =>
  Array.from({ length: 20 }, (_, l) => `Pagina ${n} (nativa) linha ${l + 1}: texto ficticio do inteiro teor.`);

/** PDF de `paginas` páginas só com a linha de carimbo de assinatura eletrônica (uma por página). */
export function pdfSoCarimbos(paginas: number): Uint8Array<ArrayBuffer> {
  return pdfSintetico(Array.from({ length: paginas }, (_, i) => paginaDeCarimbo(i + 1)));
}

/** PDF misto: `nativas` páginas de texto corrido seguidas de `carimbos` páginas só de carimbo (limiar de fração). */
export function pdfMisto(nativas: number, carimbos: number): Uint8Array<ArrayBuffer> {
  return pdfSintetico([
    ...Array.from({ length: nativas }, (_, i) => paginaNativa(i + 1)),
    ...Array.from({ length: carimbos }, (_, i) => paginaDeCarimbo(nativas + i + 1)),
  ]);
}

/** PDF com `paginas` páginas de uma linha curta cada, barato de gerar (milhares de páginas, G-11). */
export function pdfMuitasPaginas(paginas: number): Uint8Array<ArrayBuffer> {
  return pdfSintetico(Array.from({ length: paginas }, (_, i) => [`Pagina ${i + 1} de ${paginas}.`]));
}

/** Os títulos da ementa no modelo padronizado, na ordem em que aparecem. */
export const TITULOS_DA_EMENTA = ["Caso em exame", "Questão em discussão", "Razões de decidir", "Dispositivo e tese"];

/** PDF de uma página com a ementa padronizada (títulos I a IV, cada um com um parágrafo genérico) e um relatório. */
export function pdfEmentaPadronizada(): Uint8Array<ArrayBuffer> {
  return pdfSintetico([
    [
      "EMENTA: DIREITO CIVIL. APELACAO. OBRIGACAO GENERICA.",
      `I. ${TITULOS_DA_EMENTA[0]}`,
      "1. Apelacao contra sentenca que julgou improcedente o pedido de obrigacao generica.",
      `II. ${TITULOS_DA_EMENTA[1]}`,
      "2. Ha duas questoes em discussao: (i) a validade do negocio; (ii) o prazo aplicavel.",
      `III. ${TITULOS_DA_EMENTA[2]}`,
      "3. O negocio e valido quando presentes os requisitos legais genericos.",
      `IV. ${TITULOS_DA_EMENTA[3]}`,
      "4. Recurso provido. Tese de julgamento: o negocio generico e valido.",
      "RELATORIO",
      "Trata-se de apelacao interposta contra sentenca de primeiro grau.",
    ],
  ]);
}

/**
 * PDF com relatório, voto aberto por "Ante o exposto" no dispositivo, certidão de julgamento e fecho de acórdão na
 * fórmula genérica "acordam os Magistrados da <N>ª Câmara…". `camaraDoFecho` é a câmara que o fecho diz que julgou
 * (compare com a do registro para o caso de órgão diferente).
 */
export function pdfComDispositivoECertidao(camaraDoFecho = 3): Uint8Array<ArrayBuffer> {
  return pdfSintetico([
    ["RELATORIO", "Trata-se de recurso contra decisao generica de primeiro grau.", "VOTO", "Fundamentacao generica do relator."],
    [
      "Ante o exposto, voto por dar provimento ao recurso para reformar a decisao.",
      "CERTIDAO DE JULGAMENTO",
      "Certifico que a Turma, ao apreciar o processo, proferiu a seguinte decisao: recurso provido.",
      `Acordam os Magistrados da ${camaraDoFecho}ª Camara Civel do Tribunal, por unanimidade, em dar provimento ao recurso.`,
      "Sessao de julgamento realizada em 01/01/2020.",
    ],
  ]);
}

/** A passagem de cada sinal de "quem disse" (ticket 08), uma frase marcadora por sinal. */
export const FRASES_DE_AUTORIA = {
  negada: "Nao se admite a tese de que o negocio generico e nulo por vicio de forma.",
  alegacaoDaParte: "O apelante sustenta que o prazo generico seria decenal e que a sentenca violou a lei.",
  ementaTranscrita:
    "A prescricao da pretensao generica ocorre em tres anos (TJXX, Apelacao 0000000-00.2000.0.00.0000, Rel. Fulano, j. 01/01/2000).",
  votoDivergente: "Divirjo do eminente relator para negar provimento, por entender valido o negocio generico.",
  hipotetica: "Ainda que assim nao fosse, o resultado seria o mesmo, pois o prazo ja estaria vencido.",
} as const;

/**
 * PDF com uma passagem para cada sinal de "quem disse": negação ("não …" antes), alegação da parte, ementa transcrita
 * com fecho entre parênteses, voto divergente sem título e "ainda que assim não fosse". Cada frase está em
 * FRASES_DE_AUTORIA, numa página própria, para o teste apontar a que quiser.
 */
export function pdfComSinaisDeAutoria(): Uint8Array<ArrayBuffer> {
  return pdfSintetico([
    ["RELATORIO", FRASES_DE_AUTORIA.negada],
    ["RELATORIO", FRASES_DE_AUTORIA.alegacaoDaParte],
    ["FUNDAMENTACAO", FRASES_DE_AUTORIA.ementaTranscrita],
    [FRASES_DE_AUTORIA.votoDivergente],
    ["FUNDAMENTACAO", FRASES_DE_AUTORIA.hipotetica],
  ]);
}

/** Acórdão unânime que contém a palavra "divergência" (falso positivo esperado do aviso de voto divergente). */
export function pdfUnanimeComDivergencia(): Uint8Array<ArrayBuffer> {
  return pdfSintetico([
    [
      "RELATORIO",
      "Ha divergencia na jurisprudencia sobre o tema, mas nao neste colegiado.",
      "Acordam os Magistrados da 3ª Camara Civel do Tribunal, por unanimidade, em dar provimento ao recurso.",
      "Votaram de acordo com o relator os demais integrantes da Turma.",
    ],
  ]);
}
