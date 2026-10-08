# Referência a precedente só com tribunal explícito; artigos de lei fora

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

O mapa de referências e o filtro `cita` da busca ampla reconhecem só Tema, Súmula e Súmula Vinculante pelo número
("1.199" = "1199"). O tribunal da referência só é anotado quando a ementa o declara junto ("Tema 1.199/STF", "Súmula 7
do STJ") ou ao fim de uma enumeração contínua ("Súmulas 7 e 83/STJ" vale para as duas); Súmula Vinculante é do STF
pelo próprio tipo. Fora disso, a referência fica com **tribunal não indicado**. Motivo: "Tema 1199" do STF e do STJ são
precedentes diferentes, e completar o tribunal pelo do acórdão ou pela memória jurídica do agente seria palpite
apresentado como dado.

## Opções consideradas

- Atribuir o tribunal do acórdão à referência sem tribunal: rejeitada. Um acórdão do STJ cita Tema do STF com
  frequência; o erro seria silencioso.
- Estender o tribunal do fim de uma enumeração através de outra frase, outro tipo de precedente ou intervalo de
  números: rejeitada; atribuição incerta fica "não indicado".
- Incluir artigos de lei ("art. 37, § 6º, da CF"): rejeitada neste bloco. O diploma muitas vezes não está junto na
  ementa, e o filtro por texto (`deveConter`) já atende quem quer um artigo.

## Consequências

- `cita` com tribunal só casa referências com aquele tribunal identificado; `cita` sem tribunal casa tipo e número em
  qualquer tribunal e avisa que não identifica um precedente único.
- Na medição, referência sem tribunal não conta como acerto do precedente esperado.
