# Freio compartilhado entre janelas, em arquivos comuns, e vaga liberada só com prova de abandono

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

Cada janela do Claude roda um Garimpo próprio, e o freio da regra 3 valia por processo: N janelas faziam até 2×N
chamadas simultâneas. Agora todas as janelas do Garimpo do mesmo usuário dividem as 2 vagas, a pausa do TSE e os
disjuntores por **arquivos comuns** numa pasta de dados por usuário (`%LOCALAPPDATA%`, `~/Library/Caches`,
`~/.cache`; `GARIMPO_DADOS` troca a pasta), separada em proteção e memória. A vaga é um arquivo de criação
exclusiva (atômica também no Windows) com o PID dono; ela só é retomada de outro processo quando esse PID
comprovadamente não existe. Tempo decorrido nunca libera vaga: na dúvida, a rede fica parada e o usuário recebe a
saída. Motivo: o objetivo da regra 3 é não ter o IP bloqueado, e liberar vaga por palpite reabre exatamente o
excesso que o freio evita.

## Opções consideradas

- `better-sqlite3`: rejeitada; binário nativo por sistema quebra a instalação via `npx` para o público geral.
- `node:sqlite` embutido: adiada; ainda experimental (aviso a cada início, interface pode mudar). Reavaliar quando
  estabilizar, se houver necessidade medida.
- Pasta temporária do sistema: rejeitada; no Linux é compartilhada entre usuários e o estado ficaria ilegível.
- Liberar vaga presa depois de um prazo: rejeitada; um processo vivo e lento seria atropelado.
- Trava por `fcntl` (como a do oab): não funciona no Windows.

## Consequências

- A proteção vale para as janelas do usuário com o mesmo estado; não protege um IP dividido com outras pessoas,
  máquinas ou programas, nem janelas com versão anterior ao B3.
- A regra 3 do `CLAUDE.md` passa a "no total das janelas do Garimpo do usuário".
