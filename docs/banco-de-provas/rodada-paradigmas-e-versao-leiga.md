# Banco de provas — rodada de paradigmas e de versão leiga (B15, ticket 21; G-73 e G-74)

Rodada de gravação **ao vivo**, feita em 2026-10-10 (das 19h17 às 19h32, UTC), uma só vez, sozinha, pelo cliente único do
Garimpo (build do commit desta branch, versão 0.3.4), contra a busca direta do JurisprudênciaIA. Tudo abaixo é **amostra**:
o teto de chamadas foi de 80 na rodada inteira (decisão conservadora do piloto, para não pressionar o site).

> **Leia antes dos números.**
> 1. É **amostra**: 24 temas de um universo de centenas (12 do STJ e 12 do STF, sorteados) e 21 teses buscadas **uma vez
>    por versão e por tribunal**, não por toda a lista de tribunais da tese.
> 2. A parte dos paradigmas mede **cobertura de UM item por tema** (o acórdão do processo paradigma). **Nunca mede
>    precisão.** Além disso, a busca usa o **texto oficial da tese**, que é quase o texto do próprio acórdão: isso
>    **infla o acerto**. Um usuário real não digita a tese firmada.
> 3. A parte das teses mede contra o **gabarito da rodada 2** (marcas da rodada 1, do dono e da IA — a maioria
>    **pré-marcação por IA, não confirmada pelo dono**). Acórdão que não está nesse gabarito aparece como "sem julgamento",
>    **não** como errado; por isso **não há precisão**, só "relevantes conhecidos achados" (cobertura do gabarito conhecido).
> 4. A **versão leiga** das teses é redação de agente, de 2026-10-10, **ainda não revisada pelo dono**. Se o dono mudar uma
>    versão, só aquela tese é refeita.
> 5. A **versão técnica** aqui é a coluna "Tese (resumo)" de `teses-propostas.md` (frase curta), **não** as três formulações
>    da rodada 2. Por isso não se compara 1 a 1 com a cobertura da rodada 2.
> 6. Onze buscas devolveram só 2 a 5 acórdãos (ver 2.3): é o que o site devolveu; **o motivo não foi verificado**.

## O que foi chamado

| Item | Valor |
|---|---|
| Host | `www.jurisprudenciaia.com.br` (só `POST /api/tribunais/<sigla>/search`; nenhum outro host, nenhum tribunal, nenhum Falcão) |
| Chamadas ao site | **78** (teto 80; margem de 2 guardada para nova tentativa) |
| 429 / 503 / 403 / recusa | **0** (nenhuma nova tentativa foi necessária; o disjuntor ficou fechado) |
| Espaçamento | 1 chamada por vez, 10 s entre uma e outra, sem paralelismo próprio |
| Antes de rodar | estado de proteção lido sem erro; o serviço do JurisprudênciaIA não estava pausado (só o TJTO tinha pausa antiga, de outro serviço); nenhum outro pane da missão fazia rede |
| Semente do sorteio dos temas | `20261010` (`scripts/montarRodadaDeProvas.ts`); mesma semente e mesmas tabelas (commit da branch), mesma amostra |

Divisão das 78: 24 temas + 21 teses × técnica + 21 teses × leiga = 66 principais; 3 verificações pelo número; 9 buscas "só
palavras" com a sobra do teto (teses 2, 4, 5, 10, 14, 16, 17, 18 e 21, na ordem do sorteio). **As outras 12 teses não
têm a linha "só palavras"**: o teto acabou. As gravações cruas ficam em `banco-de-provas-resultados/b15-21/` (fora do git).

## 1. Paradigma obrigatório (G-73): o acórdão do processo paradigma aparece na busca pela tese do tema?

Como: amostra de temas com tese firmada e **um único** processo paradigma legível na tabela oficial (STJ: tema repetitivo e
IAC; STF: repercussão geral), busca **pelo texto da tese firmada** (cortado em palavra inteira em 300 caracteres; 10 das 24
teses foram cortadas) no tribunal do tema, com `limite` 100. "No topo" = entre os 10 primeiros. Quando o paradigma não
apareceu, **uma segunda busca pelo número do processo** (no STJ, os 2 casos medidos mostram o site tratando-a como busca por classe e número; no STF não vale, ver abaixo) separa
"não indexado" de "fora do que a busca devolveu".

| Tribunal | Temas | No topo (1–10) | Dentro de 100, fora do topo | Ausente da busca por tese **e** do número | Média de acórdãos devolvidos |
|---|---|---|---|---|---|
| STJ | 12 | **9** (posições 1, 1, 1, 1, 1, 4, 4, 4, 5) | **1** (posição 16) | **2** | 91,6 |
| STF | 12 | **11** (posições 1 a 3) | 0 | **1** | 3,75 |

- **Fora do topo (1 caso, STJ):** o paradigma veio na posição 16 de 100 (Tema 687, `REsp 1358281`). É o único caso em
  que "caiu para fora do topo" é o que aconteceu.
- **"Não indexado" (3 casos):** STJ Tema 143 (`REsp 1111002`) e Tema 181 (`REsp 1112884`); STF RG 141 (`RE 572921`). Em
  todos, a busca pela tese não trouxe o acórdão. No STJ (Temas 143 e 181) a busca pelo número, que o site tratou como
  "classe-número", trouxe outros acórdãos (ou um só, de outro número), nunca o paradigma. No STF (RG 141, gravação 069) o
  paradigma `RE 572921` veio no bloco `rg`, como registro de repercussão geral (Tema 141), **não como acórdão**; não há
  prova de que o acórdão do `RE 572921` esteja na base. **Isto é inferência, não prova**: indica que o site não tem o
  acórdão sob aquele número, mas não exclui que o tenha sob outro número ou classe. Marcado **não verificado** (conferir
  no portal do tribunal).
- **STF: o "topo" quase não discrimina.** O site devolve em média 3,75 acórdãos por busca no STF (2 a 7, como já medido),
  então estar "no topo" ali é estar entre poucos. A leitura honesta do STF é "apareceu / não apareceu" (11 de 12), não posição.
- **Resumo por tribunal (cobertura do item conhecido):** STJ **9/12 no topo e 10/12 dentro do que a busca devolveu** (2 não
  indexados); STF **11/12**. Com 12 temas por tribunal, cada tema vale ~8 pontos
  percentuais: **não se generaliza** para o universo de temas.
- A verificação pelo número (1 chamada) só foi feita nos 3 que não apareceram; os outros 21 apareceram já na busca pela tese.

## 2. Técnica × leiga × só palavras por tese (G-74)

Cada tese foi buscada **uma vez por versão** no **tribunal principal** dela (STJ onde a lista do documento cita o STJ; senão
TST, TSE ou STF, nessa ordem de preferência), com `limite` 100. Tribunais de justiça e TRFs da lista ficaram de fora.
"Relevantes achados" = acórdãos devolvidos que o gabarito da rodada 2 marca como relevantes **para o mesmo tribunal**; o
percentual é sobre o total de relevantes do gabarito para aquele tribunal e tese (a rodada 2 chegou a esse total com 3
formulações; aqui há **uma** busca por versão).

### 2.1. Teses com gabarito (11 de 21)

Formato de cada célula: acórdãos devolvidos · relevantes achados (% do gabarito do tribunal) · relevantes entre os 10 primeiros.
`P` = "só palavras" (só nas teses em que o teto permitiu).

| Tese | Tribunal | Relevantes no gabarito | Técnica | Leiga | Só palavras |
|---|---|---|---|---|---|
| 1 Dolo específico (Lei 14.230) | STJ | 20 | 99 · 10 (50%) · 1 | 100 · 1 (5%) · 0 | — |
| 9 Medicamento fora da lista do SUS | STJ | 53 | 100 · 20 (38%) · 3 | 100 · 14 (26%) · 1 | — |
| 10 Imprescritibilidade do dano ambiental | STJ | 11 | 100 · 10 (91%) · 7 | 100 · 1 (9%) · 1 | 100 · 4 (36%) · 2 |
| 11 Obrigação ambiental *propter rem* | STJ | 20 | 100 · 19 (95%) · 7 | 100 · 4 (20%) · 3 | — |
| 15 Terceirização da atividade-fim | TST | 123 | 100 · 14 (11%) · 4 | 100 · 1 (1%) · 0 | — |
| 16 Tráfico privilegiado | STJ | 32 | **3** · 0 · 0 | 100 · 0 · 0 | 100 · 0 · 0 |
| 17 ITBI: base de cálculo | STJ | 25 | **3** · 2 (8%) · 2 | 99 · 10 (40%) · 7 | 99 · 5 (20%) · 3 |
| 18 Fraude à cota de gênero | TSE | 92 | 99 · 44 (48%) · 8 | 99 · 37 (40%) · 8 | 100 · 40 (43%) · 6 |
| 19 Prisão civil do devedor de alimentos | STJ | 43 | **3** · 1 (2%) · 1 | 100 · 1 (2%) · 1 | — |
| 20 Negativação indevida | STJ | 62 | **3** · 0 · 0 | 100 · 6 (10%) · 2 | — |
| 21 Auxílio-acidente | STJ | 14 | 100 · 11 (79%) · 3 | 100 · 7 (50%) · 2 | 100 · 5 (36%) · 2 |

**Soma nas 11 teses (técnica e leiga):** técnica **131** relevantes achados de 495 (**26%**), leiga **82** (**17%**);
entre os 10 primeiros, técnica 36 e leiga 25. Isso conta as 4 técnicas que devolveram só 3 acórdãos (16, 17, 19, 20) como
zero ou quase zero, o que **puxa a média da técnica para baixo**; a diferença técnica × leiga **não** é "o leigo acha menos
porque escreve pior" em todas as teses: em duas (17 e 20) a leiga achou **mais**, justamente onde a técnica quase não
devolveu nada. Nas sete teses em que as duas devolveram ~100 e acharam algo, a técnica achou mais relevantes em **todas**
(1, 9, 10, 11, 15, 18, 21); nas teses 16 e 19 as duas empatam (zero e um).

Acórdãos "irrelevantes" do gabarito entre os devolvidos: tese 10 (técnica 17, só palavras 7), 17 (técnica 1, leiga 2, só
palavras 1) e 21 (técnica 7, leiga 4, só palavras 5); em todas as outras teses o gabarito não tem acórdão marcado irrelevante
entre os devolvidos. **Não é medida de precisão**: o resto vem como "sem julgamento" (a maioria dos devolvidos).

### 2.2. Teses sem gabarito (10 de 21): só o que se mede sem julgar

Nenhuma dessas teses tem gabarito (2, 3, 4, 5, 6, 7, 8, 12, 13, 14). Só dá para contar **quantos acórdãos voltaram** e **quantos
dos 10 primeiros as versões têm em comum**:

| Tese | Tribunal | Devolvidos: técnica · leiga · só palavras | Dos 10 primeiros em comum: técnica × leiga |
|---|---|---|---|
| 2 | STJ | 100 · **3** · 98 | 0 |
| 3 | STJ | 100 · 100 · — | 1 |
| 4 | STF | **3** · 4 · 5 | 0 |
| 5 | STF | **2** · 4 · 5 | 0 |
| 6 | STJ | 100 · 100 · — | 1 |
| 7 | STJ | 98 · 100 · — | 0 |
| 8 | STJ | 100 · 100 · — | 3 |
| 12 | STJ | 100 · 100 · — | 0 |
| 13 | STJ | 100 · 100 · — | 1 |
| 14 | STJ | 100 · 99 · 100 | 1 (leiga × só palavras: 0) |

Em todo o conjunto, **técnica e leiga compartilham de 0 a 3 dos 10 primeiros acórdãos** (média de 1 nas teses com 100
devolvidos): são dois pedidos que o site entende de modo bem diferente; isso não diz qual é o melhor.

### 2.3. O que se vê com cuidado

- **A frase curta pode devolver quase nada.** Onze buscas devolveram só 2 a 5 acórdãos de um tribunal que costuma
  devolver 100 (no STF isso é o normal): técnica das teses 4, 5, 16, 17, 19 e 20; leiga das teses 2, 4 e 5; só palavras das
  teses 4 e 5. Fora o STF, as quatro técnicas com 3 acórdãos são as das teses 16, 17, 19 e 20. O padrão não depende de a frase ser curta (a da 3 também é curta e devolveu 100). **Causa não verificada.**
- **Leiga acha, em geral, menos relevantes conhecidos do que técnica, mas acha** (17% × 26% de cobertura do gabarito
  conhecido, nas 11 teses) — exceto onde a técnica falhou. Isto sustenta a meta "público geral" só em parte: a versão
  leiga **funciona**, mas devolve um conjunto bem diferente, e **não** se sabe, sem julgamento do dono, se o que ela
  traz de novo é bom.
- **Só palavras** (9 teses, 5 com gabarito: 10, 16, 17, 18, 21): ficou abaixo da técnica em 10, 18 e 21, empatou em zero na
  16 e ficou acima da técnica na 17 (que devolveu 3 acórdãos); frente à leiga, ficou acima na 10, abaixo na 17 e na 21 e entre
  as duas na 18. Com 5 teses, **não se tira regra**.

## 3. O que esta rodada **não** prova

- Não prova precisão de nada (ver as ressalvas acima).
- O texto oficial da tese **provavelmente infla** a cobertura de paradigma (hipótese: o usuário real escreve de outro jeito e o número seria menor). O desempenho com formulações de usuário real **não foi medido**.
- Os paradigmas vêm da tabela oficial **sem** revisão do dono; "um único processo paradigma legível" foi o critério
  conservador do agente, não decisão do dono.
- Não prova que o site "não tem" os três acórdãos que ficaram ausentes (ver a ressalva em 1).
- A transferência para a busca ampla (várias formulações × vários tribunais) **não foi medida** aqui: cada tese teve 1 busca
  por versão. **Não verificado.**
- Os "obrigatórios" do banco de provas (`tests/fixtures/banco-de-provas/regua.json`) **não** ganharam os paradigmas:
  o recorte versionável do ticket 18 só guarda as teses da rodada 2, sem rodapé de paradigma. Falta uma regra do dono para
  quais paradigmas valem como obrigatórios; ver `## Comentários` do ticket.

## 4. Reprodução (sem rede)

- Montagem das consultas: `scripts/montarRodadaDeProvas.ts` (testado em `tests/montarRodadaDeProvas.test.ts`, tabela falsa
  → consultas esperadas); a rodada ao vivo é `scripts/rodarRodadaDeProvas.ts` (teto, parada na recusa, só a busca direta do
  site). **Não rode de novo sem necessidade**: ela é uma rodada normal do banco de provas e gasta chamadas do site.
- Cada chamada gravada tem corpo enviado, status, tempo e resposta crua; a apuração acima sai de `resultados.json` da
  mesma pasta e do gabarito da rodada 2.
