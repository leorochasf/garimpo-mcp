# B5 — medição-protótipo da ordenação e dos filtros locais (2026-10-08)

Conclusão genérica do ticket 01 do B5. **Medição provisória, sujeita à revisão do dono** (o gabarito das teses de
controle e dos acórdãos novos da rodada 2 ainda é pré-marcação). Script, filtros, saídas e listas para revisão ficam
fora do git, em `banco-de-provas-resultados/b5/`.

**Como:** protótipo fora do `src/`, sem rede (fetch, socket e DNS derrubam o script), sobre a gravação da rodada 2
(11 teses: 7 da rodada 1 + 4 de controle; 264 respostas servidas, nenhuma sobra), a partir do commit `0d3c656`
compilado à parte. Gabarito: o do ticket 10, **sem nenhuma marcação nova por IA**. Acórdão sem marca que entra na
lista não vira relevante nem irrelevante: cada número sai em dois limites, pessimista (sem marca = não relevante) e
otimista (sem marca = relevante). Veredito: aprova se a regra da spec passa nos dois; rejeita se falha nos dois;
inconclusivo se divide. Filtros por tese escritos só a partir do texto da tese e gravados (com sha256) antes da
primeira execução; regras de medição gravadas antes também. Fórmulas e parâmetros da spec, sem calibração.

## Resultados (média das 11 teses; pessimista | otimista)

| Recurso | Precisão nos 10 | Precisão nos 50 | Cobertura (7 teses) | Veredito |
|---|---|---|---|---|
| Ordem atual (referência) | 97,3% \| 97,3% | 94,2% \| 94,4% | 46,4% \| 46,5% | — |
| P2 aderência ponderada | 97,3% \| 97,3% | 89,8% \| 94,5% | 46,4% \| 46,5% | **rejeita** |
| P2 BM25 como desempate | 46,4% \| 97,3% | 32,9% \| 96,4% | 18,7% \| 46,4% | **rejeita** |
| P2 as duas | 46,4% \| 97,3% | 32,0% \| 96,4% | 18,7% \| 46,4% | **rejeita** |
| P3 `deveConter`/`naoPodeConter` (com a marca do dono) | — | 94,4% \| 94,5% | 46,6% \| 46,7% | **aprova** |
| `cita` (5 teses) | — | 99,6% → 55,6% \| 100% | — | **rejeita** |
| Mapa de referências | — | — | — | **rejeita** |

- **P2 (palavras raras pesam mais):** nenhuma alternativa sobe a média da precisão nos 10, que já está em 97,3% (teto:
  10 de 11 teses em 100% ou perto). A aderência ponderada só muda a lista de uma tese de controle, onde troca 25
  acórdãos marcados por sem marca (24 relevantes a menos no limite pessimista). O BM25 como desempate traz de 10 a 44
  acórdãos sem marca por tese e, mesmo no limite otimista, faz uma tese perder relevantes mostrados e a precisão nos
  10 dela cair de 100% para 90%. Tempo local de ordenar: < 1 ms; pesos e notas: 60–230 ms por tese. Maior resposta:
  21.819 (atual) e 23.984 caracteres (BM25), < 25 mil. P2 fica rejeitado com o número; só reabre com evidência nova.
- **P3 (filtros locais):** aplicado nas 11 teses (média pareada sobre as 11, nenhuma lista vazia). Na primeira rodada
  ficou inconclusivo (precisão nos 50: pessimista 94,2% → 93,8%; otimista 94,4% → 94,5%): só mudava numa tese, por 3
  acórdãos sem marca. O dono marcou os 3 como relevantes (2026-10-08) e o veredito foi refeito sem rede, com a mesma
  gravação, os mesmos filtros e só essas 3 marcas a mais: a média sobe nos dois limites (pessimista 94,2% → 94,4%;
  otimista 94,4% → 94,5%); naquela tese, 98% → 100%. Tirou 1.672 acórdãos achados no total e 4 dos 964 relevantes
  marcados achados (no máximo 3,0% numa tese; limite 5%). **P3 aprova.** As 3 marcas não mudam o veredito dos outros
  recursos (o `cita` passa a perder 311 de 517 relevantes marcados achados).
- **`cita`:** nas 5 teses que nomeiam Tema ou Súmula, tirou de 48% a 73% dos relevantes marcados achados (308 de
  514; limite 5% por tese). A maioria das ementas relevantes não menciona o precedente pelo número.
- **Mapa:** 5 teses elegíveis (as que nomeiam Tema/Súmula); a meta da spec (≥ 8) não é alcançável neste banco. Com o
  tribunal que a tese declara, o precedente nomeado está entre os 2 primeiros em 2 de 3; nas 2 teses que não
  declaram o tribunal, a regra (ADR-0012) não deixa contar acerto. Tipo e número entre os 2 primeiros: 5 de 5. A
  mesma referência se divide em "tribunal não indicado" e com tribunal, e a primeira costuma ser a maior; "Súmula 7"
  do STJ aparece entre as 3 primeiras em 3 teses. Maior resposta com mapa: 22.681 caracteres (< 25 mil).

## Achado colateral: empate exato depende da ordem de chegada

Rodando a busca ampla do commit base 6 vezes sobre a mesma gravação, a ordem dos 50 mudou em todas as 11 teses e o
conjunto dos 50 mudou em 4. Acórdãos empatados em faixa, nº de formulações e melhor posição ficam na ordem em que as
respostas das duas filas chegam, que varia. O protótipo fixa a chegada em série para comparar as alternativas, e
reproduz a ordem do commit base a menos desses empates em 11 de 11 teses. Afeta qualquer "a mesma gravação reproduz
o resultado" dos tickets seguintes; o desempate final fixo (ex.: pelo id) virou ticket próprio, que vem antes do P3.

**Resolvido no ticket 07 (2026-10-08):** as respostas (guardadas e do site) passam a ser juntadas na ordem das
tarefas (tribunal → formulação), nunca na de chegada; o critério principal não mudou, só os empates exatos ficaram
fixos, na mesma ordem em série do protótipo. Refeito sem rede sobre a mesma gravação (264 respostas, nenhuma sobra),
com pasta de dados temporária: 1 ordem e 1 conjunto por tese em 6 execuções nas 11 teses (antes: 2 a 6 ordens e até
2 conjuntos); a lista real do servidor é a do protótipo em 11 de 11 teses (antes: 2 de 11). Gabarito com a marca do
dono, por tese e na média, igual ao da ordem atual: precisão nos 10 97,3% | 97,3%, nos 50 94,2% | 94,4%, cobertura
(7 teses) 46,4% | 46,5%; nenhuma tese mudou. Maior resposta: 21.819 caracteres (< 25 mil).

**Implementado no ticket 03 (2026-10-08):** `deveConter` e `naoPodeConter` na busca ampla. Refeito sem rede sobre a
mesma gravação (264 respostas, nenhuma sobra), com os mesmos filtros (rodada de filtros 1, sha256 conferido) e pasta de
dados temporária, comparando a lista real do servidor com a do protótipo (pessimista | otimista):

| | Protótipo (marca do dono) | Servidor (ticket 03) |
|---|---|---|
| Lista dos 50 igual à do protótipo | — | 11 de 11 teses |
| Precisão nos 50 (média, 11 teses) | 94,4% \| 94,5% | 94,4% \| 94,5% |
| Excluídos pelo filtro (total) | 1.672 | 1.672 |
| Sem ementa para conferir | 0 | 0 |
| Respostas do site gastas na busca filtrada | — | 0 (todas buscas guardadas) |
| Maior resposta com filtro | — | 22.124 caracteres |

No teste sem rede de pior caso (campos de tamanho real, 2 tribunais, buscas guardadas, exclusões de 3 dígitos), a
resposta com filtro fica em 24.997 caracteres, abaixo do teto de 25 mil: por isso o cabeçalho usa nomes curtos
(`excluidos`; `semEmenta` só quando há).

## Limites

- Precisão perto do teto em 10 das 11 teses: o banco mede bem perda, mal ganho.
- Teses de controle e acórdãos novos da rodada 2 com pré-marcação ainda sem revisão do dono.
- Filtros escritos uma vez (rodada de filtros 1); outro jogo seria rodada nova, sem apagar esta.
