# Conferência de citação: só diferença de diagramação conta como literal

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

O `conferir_citacao` só diz "encontrado literalmente" quando a citação e a fonte diferem apenas em espaço, quebra
de linha, espaço não separável, forma Unicode dos acentos, aspas ou apóstrofos tipográficos, e a resposta avisa
quais equivalências usou. Hífen, meia-risca e travessão não são trocados entre si, e o hífen de fim de linha do
PDF nunca é retirado para fechar uma palavra: isso gera no máximo uma passagem candidata para conferência. Letra,
acento, número, ordinal, palavra, maiúscula/minúscula e pontuação diferentes nunca são literal. Supressão só com
`(...)` ou `[...]`, pedaços na ordem, cada um com 5 palavras ou mais; reticências são procuradas como texto, salvo
opção explícita. Uma citação que atravessa a quebra de página só é confirmada se a quebra for limpa; com possível
cabeçalho ou rodapé no meio, o Garimpo avisa e não confirma. Motivo: regra do dono, "citação é literal ou não é
citação"; perder um encontro automático é aceitável, validar texto alterado não é.

## Opções consideradas

- Retirar hífen de fim de linha e tratar traços como iguais: rejeitada, porque o hífen pode pertencer à palavra e
  o traço pode mudar o sentido.
- Ignorar linhas que se repetem no topo/rodapé das páginas para emendar a frase: rejeitada neste bloco, porque a
  repetição não prova que a linha é descartável e emendar pode criar uma continuidade que não existe.
- Comparar sem diferenciar maiúsculas e pontuação: rejeitada; vira veredito próprio, não literal.
