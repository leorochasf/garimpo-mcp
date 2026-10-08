# B4 — conferência ao vivo curta da citação e do enquadramento no art. 927 (2026-10-08)

Conclusão genérica do ticket 06 do B4. Relatório, PDFs e respostas ficam fora do git, em
`banco-de-provas-resultados/b4/`.

**Como:** servidor MCP do Garimpo, cliente real do site com os freios da regra 3, `fetch` contado em cada fase. Duas
buscas curtas (STJ e STF, limite 5), em série; nenhum download. Fontes: a ementa de um acórdão do STJ devolvido pela
busca e o PDF do mesmo acórdão, baixado pelo Garimpo no B2 (origem conferida pelo recibo); mais um PDF do TJMG do B2
copiado sem o recibo, como inteiro teor trazido pelo usuário. Citações copiadas por programa da própria fonte; as
alteradas derivam delas. Nenhuma citação inventada.

**Rede:** só as buscas. `obter_ementa`, `ler_inteiro_teor` e `conferir_citacao` fizeram **zero** chamadas.

## `conferir_citacao` (12 citações numa chamada, 124 ms)

| Caso | Veredito |
|---|---|
| Copiada da ementa | encontrado literalmente, com a frase da ementa |
| Ementa com uma palavra trocada | não encontrado, com a passagem parecida da fonte (14 de 15 palavras) |
| Ementa com a caixa trocada | difere só em maiúsculas/pontuação, com o texto exato da fonte |
| Acórdão fora da memória | não verificável, com a orientação de refazer a busca |
| Copiada do voto (PDF) | encontrado literalmente: página do PDF, parte, seção "voto" |
| Voto com uma palavra trocada | não encontrado, com a passagem parecida |
| Supressão `(...)` na ordem / fora de ordem | encontrado com supressão indicada / não encontrado |
| Copiada do voto vencido e do relatório | encontrado literalmente, com o aviso forte de outro autor |
| Mesmo trecho com id e caminho juntos | um veredito por fonte (ementa e inteiro teor), com a equivalência de quebra de linha avisada |
| PDF trazido (sem recibo) | encontrado literalmente; origem declarada pelo usuário, não conferida |

Todos como esperado.

## `enquadramento927` em casos reais

Acórdãos de turma do STJ: não classificado (a classe não basta). Tema repetitivo do STJ com tese: inciso III, com o
aviso de situação. Súmula do STJ: não classificado (matéria do inciso IV não informada). ADI do STF: inciso I, sem
"efeito vinculante", com o aviso de que os dados não provam a decisão definitiva de mérito e a nota do Plenário sem
inciso V. Súmula vinculante: inciso II, com o aviso de situação. Repercussão geral: não classificado, com o motivo
do art. 1.035, § 7º. Nenhum "fora do rol". O `obter_ementa` repete o enquadramento da busca.

## Pendências

- **Typecheck dos testes:** `tests/conferencia.test.ts` não passa no `tsc` (lê campos do resultado sem estreitar o
  tipo "não verificável"); o `vitest` passa e o build também.
- **Títulos com letras espaçadas** ("E M E N T A"), pendência do B2: a seção sai "não identificada" nesses PDFs.
