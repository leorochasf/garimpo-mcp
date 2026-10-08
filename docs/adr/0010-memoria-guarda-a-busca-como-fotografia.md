# A memória guarda a busca inteira por 24 h, como fotografia marcada, sem o texto da busca em claro

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

Além dos acórdãos (pelo id), a memória guarda a resposta utilizável de cada busca direta, inclusive busca vazia,
por 24 h contadas da obtenção no site. Repetir ou ampliar uma busca ampla dentro desse prazo só chama o site para as
combinações novas. A resposta diz que é **busca guardada** e quando foi feita no site; `renovar` ignora a memória, e
um `renovar` que falha é busca com erro, nunca a fotografia antiga. Erro e recusa nunca são guardados. A chave é o
sha256 dos parâmetros, e o texto da busca não fica em claro no disco. Motivo: velocidade e menos chamadas ao site
(proteção do IP), sem fingir atualidade.

## Opções consideradas

- Guardar só acórdãos, nunca a busca (cautela do relatório C, porque o site muda a ordem a cada chamada): rejeitada.
  O conjunto devolvido é o mesmo; a busca guardada só congela uma amostra da ordem, que entra apenas no desempate da
  busca ampla. A medição do B3 confere, sobre as respostas gravadas do banco de provas, que lista, corte, cobertura e
  precisão não mudam.
- Devolver a guardada quando o `renovar` falha: rejeitada; mascararia a falha de quem pediu dado novo.
- Gravar o texto da busca: rejeitada pela privacidade. O hash não é criptografia: quem conhece uma formulação pode
  testá-la, e o README diz isso.
