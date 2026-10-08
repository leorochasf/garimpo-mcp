# B3 — medição da memória e do freio compartilhado (2026-10-08)

Conclusão genérica do ticket 07 do B3. Scripts, saídas, relatório e o PDF baixado ficam fora do git, em
`banco-de-provas-resultados/b3/`. Pasta de dados sempre temporária (`GARIMPO_DADOS`), apagada no fim.

**Como:** servidor MCP do Garimpo montado, cliente MCP em memória, coordenação real em arquivo. Sem rede: gravação da
rodada 2 do banco de provas (11 teses, 132 buscas por execução fria), com fetch, socket e DNS proibidos; PDF real do STJ
servido por um tribunal falso. Ao vivo, com exclusividade e os freios da regra 3, em série: uma busca ampla pequena
(3 formulações × STJ) duas vezes e um PDF do STJ duas vezes. Nenhuma recusa, nenhum 429/503.

## Antes × depois

| | Antes (sem memória) | Depois |
|---|---|---|
| Busca ampla repetida, ao vivo (3 buscas) | 3 chamadas, 2,6 s | **0 chamadas, 31 ms** |
| Busca ampla repetida, banco de provas (11 teses) | 132 chamadas; 5,6 a 46,7 s por tese na gravação | **0 chamadas**; 75–250 ms, mesma janela ou outra |
| Ampliação com 3 formulações novas (2 pares de teses) | 30 e 24 chamadas | **15 e 12** (só as novas) |
| PDF do STJ pedido de novo, ao vivo | 3 chamadas, 1,5 s | **0 chamadas, 83 ms** |
| PDF pedido de novo noutra janela sem memória, por id ou por link | 3 chamadas | **0 chamadas** (nenhuma busca para resolver o pedido) |

## Neutralidade da memória (banco de provas)

- Busca guardada × busca fria com a chegada fixa na ordem das tarefas: resposta idêntica, menos as marcas da busca
  guardada, em 11 de 11 teses — lista, ordem, trechos, corte, cabeçalho de cobertura e qualificados. Precisão e
  cobertura por tese iguais.
- Contra a busca fria com chegada natural (duas filas), o corte é sempre igual; a ordem (e, em poucas teses, o
  conjunto cortado) muda só nos empates exatos desfeitos pela ordem de chegada — o achado colateral do B5. A própria
  busca fria varia assim entre execuções (2 a 5 ordens distintas em 5 execuções), e a ordem guardada é uma delas e é
  estável. Não é efeito da memória.
- Texto das buscas em claro nos arquivos da memória: nenhum. Marcas de busca guardada (quantas, data da mais antiga)
  presentes por tribunal; ausentes na busca fria.

## PDF já baixado (ao vivo)

O PDF começa com a assinatura de PDF e o sha256 bate com o recibo; a repetição devolve o mesmo arquivo, diz a data do
download original e que nenhuma chamada foi feita; origem "conferida" nas duas; 1ª parte idêntica nas duas respostas
e à parte 1 do `ler_inteiro_teor`.

## Custo da coordenação e teste entre processos (Windows)

- Por chamada sem disputa, à parte do servidor falso: **≈ 5 ms na mediana, 8–11 ms no p99** (500 chamadas, 2
  execuções); meta < 20 ms atingida até o p99. Picos isolados de 21–27 ms (uma chamada por execução). Menos de 1% do
  tempo de uma busca real no site.
- `tests/janelas.test.ts` (processos reais, mesma pasta de dados, servidor falso em 127.0.0.1): 5 de 5 passando no
  Windows.

## Observações

- A memória ocupa de 2 a 7 MB por busca ampla de 5 tribunais × 3 formulações (limite 100 por busca): o teto de
  200 MB comporta algumas dezenas dessas buscas em 24 h; acima disso, as mais antigas saem primeiro.
- A variação da ordem por chegada continua na busca fria; um desempate estável é assunto do bloco que cuidar da ordem.
