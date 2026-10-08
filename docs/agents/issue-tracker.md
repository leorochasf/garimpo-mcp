# Issue tracker: Markdown local em `TICKETS/`

Tickets e specs deste repositório ficam como arquivos markdown em `TICKETS/`, que está no `.gitignore`
(regra do `CLAUDE.md`: tarefas e tickets ficam fora do repositório). Nada de `TICKETS/` entra no git.

## Convenções

- Uma pasta por bloco de trabalho: `TICKETS/<bloco-slug>/` (ex.: `TICKETS/b1-resposta-honesta/`).
- A spec do bloco é `TICKETS/<bloco-slug>/spec.md`.
- Um arquivo por ticket em `TICKETS/<bloco-slug>/issues/<NN>-<slug>.md`, numerados a partir de `01`; nunca um
  arquivo único com todos os tickets.
- Linha `Status:` perto do topo de cada ticket, com o nome do estado em `triage-labels.md`; ao fechar,
  `Status: resolvido`.
- Linha `Bloqueado por: NN, NN` perto do topo quando o ticket depende de outros.
- Comentários e histórico vão no fim do arquivo, sob `## Comentários`.
- Os tickets antigos (`TICKETS/01-...md` a `TICKETS/10-...md`) ficam onde estão.

## Quando uma skill disser "publicar no issue tracker"

Criar o arquivo em `TICKETS/<bloco-slug>/` (criando a pasta se preciso).

## Quando uma skill disser "buscar o ticket"

Ler o arquivo no caminho indicado. O dono normalmente passa o caminho ou o número.

## Operações de wayfinding

Usadas pelo `/wayfinder`. O **mapa** é um arquivo com um **filho** por ticket.

- **Mapa**: `TICKETS/<esforço>/map.md` (Notas / Decisões até aqui / Névoa).
- **Ticket filho**: `TICKETS/<esforço>/issues/NN-<slug>.md`, numerado a partir de `01`, com a pergunta no corpo.
  Linha `Type:` (`research`/`prototype`/`grilling`/`task`); linha `Status:` (`claimed`/`resolvido`).
- **Bloqueio**: linha `Bloqueado por: NN, NN` perto do topo. O ticket destrava quando todos os listados estão `resolvido`.
- **Fronteira**: tickets abertos, destravados e não tomados em `TICKETS/<esforço>/issues/`; o de menor número primeiro.
- **Tomar**: `Status: claimed` e salvar antes de qualquer trabalho.
- **Resolver**: resposta sob `## Resposta`, `Status: resolvido`, e uma linha (resumo + caminho) em Decisões até aqui no `map.md`.
