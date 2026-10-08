# Disjuntor por serviço, com chamada de prova; estado ilegível = rede parada, com saída manual

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

Depois de uma recusa final (a única nova tentativa recusada, 403, desafio anti-robô ou Retry-After acima de 30 s),
o serviço fica pausado para todas as janelas: 1 min, dobrando a cada nova abertura até 60 min, ou mais se o
serviço pedir. O disjuntor é **por serviço** (JurisprudênciaIA, STJ, TJMG, TSE…), não um só para tudo. Vencida a
pausa, sai uma única chamada de prova, sem nova tentativa; só a aceitação dela zera a dobra, e uma resposta de antes
da abertura nunca fecha o disjuntor. Estado de proteção ilegível (corrompido, formato desconhecido ou de versão mais
nova, sem permissão) para a rede de todos os serviços até o usuário agir, com o caminho e a instrução; a leitura
local continua. Motivo: recusa repetida é o caminho para o bloqueio do IP, e qualquer saída automática (retomar
todos juntos, sucesso antigo apagando recusa nova, recriar estado por tempo) reabre esse risco.

## Opções consideradas

- Um disjuntor só para tudo: rejeitado; cada serviço tem limite próprio por IP, e parar a busca no site por uma
  recusa do TSE não protege nada.
- Retomar todas as chamadas quando a pausa vence: rejeitado; várias janelas voltariam juntas.
- Ferramenta de "liberar freio": rejeitada; daria à IA um botão para desligar a proteção.
- Recriar o estado ilegível depois de X horas: rejeitado; é tempo decorrido sem evidência.
- Tratar tempo esgotado como recusa: rejeitado; lentidão não é recusa e não aumenta a dobra, mas também não libera a
  vaga de um processo vivo.
