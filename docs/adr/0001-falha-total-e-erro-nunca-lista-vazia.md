# Falha total da busca é erro, nunca lista vazia

Quando nenhuma busca direta de uma busca ampla dá resposta utilizável, a ferramenta responde com **erro**
(marcado como erro para o cliente) e o motivo de cada busca, e não com uma lista vazia acompanhada de avisos.
Falha parcial continua sendo resultado, mas o cabeçalho de cobertura mostra o tribunal como "com erro", nunca
como "0 achados". Motivo: lista vazia é lida como "o tribunal nunca decidiu isso", o defeito mais comum dos
concorrentes (que engolem erros); um teste sem rede trava os dois casos.

## Opções consideradas

- Sucesso com lista vazia e aviso forte no topo: rejeitada, porque o cliente e a IA tratam a resposta como
  pesquisa feita e o aviso pode não chegar ao usuário.
