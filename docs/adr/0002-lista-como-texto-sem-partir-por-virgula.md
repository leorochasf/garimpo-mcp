# Lista mandada como texto: aceita JSON ou uma formulação só, nunca parte por vírgula

`formulacoes` e `tribunais` mandados como texto são aceitos em dois formatos: texto de lista JSON
(`"[\"a\",\"b\"]"`) ou texto solto, que vale como **um** item. Motivo: modelos que não são o Claude costumam
mandar listas como texto, e recusar isso cria falha em laço para o público geral.

## Opções consideradas

- Partir o texto por vírgula: rejeitada, porque quebraria formulações com vírgula, como "art. 37, § 6º", em
  pedaços sem sentido, e o usuário não perceberia.
