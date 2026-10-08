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
| P3 `deveConter`/`naoPodeConter` | — | 93,8% \| 94,5% | 46,0% \| 46,7% | **inconclusivo** |
| `cita` (5 teses) | — | 99,6% → 55,6% \| 100% | — | **rejeita** |
| Mapa de referências | — | — | — | **rejeita** |

- **P2 (palavras raras pesam mais):** nenhuma alternativa sobe a média da precisão nos 10, que já está em 97,3% (teto:
  10 de 11 teses em 100% ou perto). A aderência ponderada só muda a lista de uma tese de controle, onde troca 25
  acórdãos marcados por sem marca (24 relevantes a menos no limite pessimista). O BM25 como desempate traz de 10 a 44
  acórdãos sem marca por tese e, mesmo no limite otimista, faz uma tese perder relevantes mostrados e a precisão nos
  10 dela cair de 100% para 90%. Tempo local de ordenar: < 1 ms; pesos e notas: 60–230 ms por tese. Maior resposta:
  21.819 (atual) e 23.984 caracteres (BM25), < 25 mil. P2 fica rejeitado com o número; só reabre com evidência nova.
- **P3 (filtros locais):** aplicado nas 11 teses (média pareada sobre as 11). Tirou 1.672 acórdãos achados no total e
  4 dos 961 relevantes marcados achados (no máximo 3,1% numa tese; limite 5%). A precisão nos 50 só muda numa tese
  (98% → 94% pessimista, 100% otimista), que traz 3 acórdãos sem marca. A adoção depende só deles: com os 3
  relevantes, a média sobe e P3 aprova; com algum não relevante, rejeita. Lista curta de 3 para o dono.
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
o resultado" dos tickets seguintes.

## Limites

- Precisão perto do teto em 10 das 11 teses: o banco mede bem perda, mal ganho.
- Teses de controle e acórdãos novos da rodada 2 com pré-marcação ainda sem revisão do dono.
- Filtros escritos uma vez (rodada de filtros 1); outro jogo seria rodada nova, sem apagar esta.
