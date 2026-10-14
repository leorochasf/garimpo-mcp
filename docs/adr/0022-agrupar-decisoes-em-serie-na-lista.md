# Agrupar, na lista da busca ampla, as decisões em série de mesma ementa

_Decidido em 2026-10-13 (D-17, pelo Sol por delegação do dono; item I-46)._

Inadmissibilidades em série do mesmo relator enchem a lista da `busca_ampla` com dezenas de linhas de mesma ementa e
escondem o resto. A lista agora mostra uma linha para a série, com `mesmaEmenta`: contagem, período de datas e os ids
dos demais acórdãos, que seguem acessíveis (`obter_ementa`, `obter_inteiro_teor`).

Só agrupa o que é textualmente a mesma ementa: **mesmo tribunal, órgão e relator, ementa inteira idêntica** depois de
normalizar apenas espaços e quebras de linha (palavras, negações, números, pontuação e maiúsculas contam). Ementa
ausente ou cortada, ou tribunal, órgão ou relator sem valor, deixa o acórdão sozinho. O agrupamento vem **depois** do
filtro local, da ordem e do corte: não muda quem entra na lista, `totalAcordaos`, `mostrados` nem o aviso de lista
cortada (todos contam acórdãos, não linhas). O teto é calculado pela lista individual; se os campos do grupo
fizerem a apresentação ultrapassar o teto, mantém-se a lista individual, com a mesma seleção. Vale por padrão; `agrupar: false` devolve a lista como era.

O rótulo é "mesma ementa": nunca "mesma tese" nem "mesmo resultado". Não é a junção de `src/equivalencia.ts`, que
trata o **mesmo** acórdão duplicado na base do site; aqui são acórdãos distintos, só apresentados juntos.

## Opções consideradas

- Similaridade aproximada ("quase igual"): rejeitada na 1.0; uma negação ou um número muda a decisão, e a diferença
  ocultada exigiria medição própria antes.
- Agrupar entre relatores ou tribunais: rejeitada; sem identidade de órgão e relator, a série é só coincidência de texto.

## Consequências

- Risco aceito e mitigado: esconder acórdão com distinção relevante e inflar a impressão de consenso. Mitigação: critério
  rígido, aviso fixo na resposta, todos os ids listados e o desligamento por `agrupar: false`.
- Séries fora do alcance (ementas quase iguais) continuam em linhas separadas, como antes.
