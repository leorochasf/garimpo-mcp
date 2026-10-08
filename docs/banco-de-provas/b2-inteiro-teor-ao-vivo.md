# B2 — conferência ao vivo do inteiro teor como texto (2026-10-08)

Conclusão genérica do ticket 06 do B2. Relatório, PDFs e textos ficam fora do git, em
`banco-de-provas-resultados/b2/`.

**Como:** servidor MCP do Garimpo, clientes reais com os freios da regra 3, em série: 3 buscas curtas (STJ, TJMG,
TSE) e 3 downloads pelo `obter_inteiro_teor`, depois todas as partes pelo `ler_inteiro_teor`. Mais um PDF do TJGO
baixado à mão, lido pelo `ler_inteiro_teor` sem rede. Nenhuma recusa, nenhum 429/503.

| PDF | Págs. com texto / total | Partes | Extração (por leitura) | Conferência visual de uma página |
|---|---|---|---|---|
| STJ | 11/11 | 1 | 107–118 ms | idêntico |
| TJMG | 9/9 | 1 | 41–53 ms | idêntico |
| TSE | 7/7 | 2 | 94–126 ms | palavras certas, ordem errada em trechos com formatação |
| TJGO (trazido à mão) | 7/7 | 1 | 68 ms | idêntico |

- Origem: os baixados saem "conferida" (recibo e sha256 batem); o trazido sai "declarada pelo usuário, não conferida".
- A 1ª parte acrescenta ~50–120 ms ao download (STJ ≈ 2,6 s; TJMG e TSE ≈ 0,3–0,4 s), e a 1ª parte do
  `obter_inteiro_teor` é idêntica à parte 1 do `ler_inteiro_teor`. Respostas < 24 mil caracteres.

## Para o D1

- **Ordem de leitura:** o `pdfjs-dist` segue a ordem do fluxo do PDF; num PDF do TSE, trechos sublinhados, em negrito,
  itálico ou com link saem deslocados dentro da linha. Afeta citação literal (B4) e trechos (B6). A medir no D1:
  ordenar os itens do `getTextContent` pela posição (y, depois x). `pdftotext -layout` acerta a ordem e o PyMuPDF
  padrão repete o erro (os dois só como referência: GPL e AGPL). O `unpdf` usa o mesmo pdfjs.
- **Fim de página:** o último bloco da página sai colado ao carimbo do rodapé, sem quebra de linha.
- **Página impressa ≠ página do PDF:** num PDF do STJ o rodapé impresso diz "Página 6 de 5". Confirma citar a página
  do PDF.
