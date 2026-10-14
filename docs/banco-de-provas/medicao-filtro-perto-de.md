# Medição do filtro "não pode conter X perto de Y" (I-09 / G-65)

Medida em 2026-10-13, sem rede, sobre as ementas já marcadas nas rodadas 2 e 3 do banco de provas. Reproduzir:
`npx vite-node scripts/rodarMedirPertoDe.ts <pasta banco-de-provas-resultados>` (a pasta fica fora do git; o script só
imprime contagens, nunca ementa, número ou os termos escolhidos). Código: `scripts/medirPertoDe.ts`, testado em
`tests/medirPertoDe.test.ts`.

**Decisão: NÃO SEGUE.** A forma "perto de" não deu ganho; a ideia do G-65 fica `nao-fazer` (DQ-15: "só se a medição
mostrar ganho"). Nenhum código novo em `src/`.

## Critério de ganho (escrito antes de medir)

Uma regra é *segura* se, no lote em que é escolhida, tira irrelevantes e nenhuma relevante. Por tese com pelo menos 6
irrelevantes marcadas, o lote (ementas ordenadas de forma estável) é dividido em duas metades alternadas; a melhor regra
segura é escolhida numa metade (tem de tirar pelo menos 2 irrelevantes ali) e **contada na outra** (nos dois sentidos).
Compara-se, com a mesma escolha:

- **forma simples** (hoje): palavra solta (4+ letras) ou expressão de até 3 palavras seguidas;
- **forma "perto de"**: duas palavras (4+ letras, diferentes) a até 60 caracteres uma da outra, em qualquer ordem.

Há ganho real só se valem juntas: (1) "perto de" tira pelo menos **10 irrelevantes a mais** que a simples na validação,
somando as teses; (2) isso vem de pelo menos **4 teses**; (3) "perto de" não derruba mais relevantes que a simples. O
"teto" (escolher e contar no lote inteiro) é só limite superior otimista, nunca critério.

## Base

1.483 ementas com marca definitiva (1.335 relevantes, 148 irrelevantes); 105 dúvidas ficaram fora das duas contas. A
mesma ementa em duas rodadas conta uma vez. Só 9 teses têm 6+ irrelevantes marcadas; as outras 12 não entram. A marca é
pré-marcação por IA com parte do dono (não é o gabarito do dono).

## Resultado

| Tese | Simples (validação) | Perto de (validação) | Teto simples | Teto perto de |
|---|---|---|---|---|
| 4 | 2 tirados / 4 relevantes perdidos | 1 tirados / 4 relevantes perdidos | 3 / 0 | 3 / 0 |
| 6 | 2 / 0 | 1 / 2 | 3 / 0 | 3 / 0 |
| 10 | 3 / 0 | 5 / 2 | 6 / 0 | 5 / 0 |
| 12 | 3 / 4 | 1 / 0 | 5 / 0 | 5 / 0 |
| 13 | 3 / 0 | 1 / 0 | 4 / 0 | 4 / 0 |
| 14 | 1 / 0 | 2 / 1 | 4 / 0 | 4 / 0 |
| 17 | 3 / 3 | 1 / 1 | 5 / 0 | 4 / 0 |
| 19 | 4 / 0 | 3 / 0 | 6 / 0 | 6 / 0 |
| 21 | 30 / 0 | 18 / 2 | 30 / 0 | 21 / 0 |

(`irrelevantes tirados / relevantes perdidos`.)

- Ganho líquido na validação (perto − simples): **−18** (precisava de +10).
- Teses em que "perto de" tira mais: **2** de 9 (precisava de 4).
- Relevantes perdidos na validação: simples 11, "perto de" 12 (precisava de ≤).
- Teto: em nenhuma tese a melhor regra "perto de" tira mais irrelevantes que a melhor simples (iguais em 6, menor em 3).
  Nem olhando tudo, sem validação, a vizinhança acrescenta algo.

Os três critérios falham; o teto otimista também não mostra espaço.

## O que isto não prova

Há poucas irrelevantes marcadas (148 em 1.483), porque as listas marcadas foram montadas quase só de relevantes. O
resultado é "ganho não demonstrado" com a base que existe, não "provado inútil". Reabrir só se o gabarito do dono
trouxer irrelevantes em número suficiente (ordem de 5+ por tese em pelo menos 4 teses, com uma pergunta concreta de
"sentido da palavra" que o usuário queira separar). A forma simples continua cobrindo o caso real: o usuário pode
listar a expressão completa no `naoPodeConter` (ADR-0013).
