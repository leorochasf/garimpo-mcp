# Medição do filtro "não pode conter X perto de Y" (I-09 / G-65)

Medida em 2026-10-13, sem rede, sobre as ementas já marcadas nas rodadas 2 e 3 do banco de provas. Reproduzir:
`npx vite-node scripts/rodarMedirPertoDe.ts <pasta banco-de-provas-resultados>` (a pasta fica fora do git; o script só
imprime contagens, nunca ementa, número ou os termos escolhidos). Código: `scripts/medirPertoDe.ts`, testado em
`tests/medirPertoDe.test.ts`.

**Decisão: NÃO SEGUE.** A forma "perto de" não atingiu o ganho exigido; a ideia do G-65 fica `nao-fazer` (DQ-15: "só se a medição
mostrar ganho"). Nenhum código novo em `src/`.

## Critério de ganho (escrito antes de medir)

Uma regra é *segura* se, no lote em que é escolhida, tira irrelevantes e nenhuma relevante. Por tese com pelo menos 6
irrelevantes marcadas, o lote (ementas ordenadas de forma estável) é dividido em duas metades alternadas; a melhor regra
segura é escolhida numa metade (tem de tirar pelo menos 2 irrelevantes ali) e **contada na outra** (nos dois sentidos).
Compara-se, com a mesma escolha:

- **forma simples**: palavra solta, inclusive curta, ou expressão de até 3 palavras seguidas, preservando a pontuação
  como o filtro real ("incentivo, fiscal" não casa com "incentivo fiscal"). O limite de 3 palavras é da medição,
  não do filtro em produção;
- **forma "perto de"**: duas ocorrências de palavras quaisquer, inclusive curtas ou repetidas, com até 60 caracteres entre o fim de uma e o começo
  da outra, em qualquer ordem.

Há ganho real só se valem juntas: (1) "perto de" tira pelo menos **10 irrelevantes a mais** que a simples na validação,
somando as teses; (2) isso vem de pelo menos **4 teses**; (3) "perto de" não derruba mais relevantes que a simples. O
"teto" (escolher e contar no lote inteiro) é só diagnóstico otimista da melhor regra segura nesse lote, nunca critério
nem limite matemático da validação (que usa duas regras e pode perder relevantes).

O ticket declara que o critério foi escrito antes da medição. Os limiares +10 / 4 teses / nenhuma perda adicional
foram mantidos na revisão. Como o ticket fica fora do git e o documento foi commitado depois do script, o histórico
versionado disponível não comprova de forma independente essa anterioridade.

## Base

1.482 ementas com marca definitiva (1.335 relevantes, 147 irrelevantes); 100 dúvidas únicas e 1 conflito entre marcas
definitivas ficaram fora das duas contas. A mesma ementa normalizada na mesma tese conta uma vez. Uma marca definitiva
prevalece sobre dúvida; relevante e irrelevante contraditórias são excluídas, independentemente da ordem das rodadas.
Só 9 teses têm 6+ irrelevantes marcadas; as outras 12 não entram. A marca é
pré-marcação por IA com parte do dono (não é o gabarito do dono).

## Resultado

| Tese | Simples (validação) | Perto de (validação) | Teto simples | Teto perto de |
|---|---|---|---|---|
| 4 | 2 tirados / 4 relevantes perdidos | 3 tirados / 4 relevantes perdidos | 3 / 0 | 3 / 0 |
| 6 | 2 / 0 | 1 / 5 | 3 / 0 | 3 / 0 |
| 10 | 3 / 0 | 4 / 2 | 6 / 0 | 6 / 0 |
| 12 | 2 / 7 | 1 / 4 | 5 / 0 | 5 / 0 |
| 13 | 3 / 0 | 2 / 0 | 4 / 0 | 5 / 0 |
| 14 | 1 / 0 | 1 / 0 | 4 / 0 | 4 / 0 |
| 17 | 3 / 3 | 1 / 1 | 5 / 0 | 5 / 0 |
| 19 | 6 / 0 | 3 / 0 | 6 / 0 | 6 / 0 |
| 21 | 19 / 0 | 28 / 4 | 21 / 0 | 21 / 0 |

(`irrelevantes tirados / relevantes perdidos`.)

- Ganho líquido na validação (perto − simples): **+3** (precisava de +10).
- Teses em que "perto de" tira mais: **3** de 9 (precisava de 4).
- Relevantes perdidos na validação: simples 14, "perto de" 20 (precisava de ≤).
- Teto: "perto de" tira mais em 1 tese e empata nas outras 8. Há algum espaço no lote inteiro, que não se confirmou
  no ganho e na segurança exigidos na validação.

Os três critérios falham. A revisão corrigiu as restrições indevidas a palavras de 4+ letras e pares diferentes, a remoção de pontuação nas
expressões simples e a preferência pela primeira marca definitiva em caso de conflito. Os números anteriores
(−18 / 2 teses / perdas 11 e 12) foram reproduzidos, mas são substituídos pelos números corrigidos acima.

## O que isto não prova

Há poucas irrelevantes marcadas (147 em 1.482), porque as listas marcadas foram montadas quase só de relevantes. O
resultado é "ganho não demonstrado" com a base que existe, não "provado inútil". Reabrir só se o gabarito do dono
trouxer irrelevantes em número suficiente (6+ por tese em pelo menos 4 teses, com uma pergunta concreta de
"sentido da palavra" que o usuário queira separar). A forma simples continua cobrindo o caso real: o usuário pode
listar a expressão completa no `naoPodeConter` (ADR-0013).

## Verificação da revisão

Medição reproduzida com conexões de rede bloqueadas no processo Node (sockets, HTTP/HTTPS e fetch), saída 0.
Regressão: os testes corrigidos falham em 4 casos com o script anterior; com o script corrigido, a suíte inteira passa.

Saída crua de `npx vitest run` (saída 0):

```text
 Test Files  47 passed | 4 skipped (51)
      Tests  1144 passed | 7 skipped (1151)
```

`npx tsc --noEmit`: saída 0. Como o tsconfig do projeto inclui só `src/`, foi conferida também a medição:
`npx tsc --noEmit --target ES2022 --module Node16 --moduleResolution Node16 --strict --skipLibCheck scripts/medirPertoDe.ts scripts/rodarMedirPertoDe.ts tests/medirPertoDe.test.ts`: saída 0.
