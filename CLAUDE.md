# CLAUDE.md — Garimpo

Servidor MCP local (stdio), em Node/TypeScript, que pesquisa jurisprudência brasileira pela busca direta
do JurisprudênciaIA e baixa o inteiro teor oficial dos tribunais. **Cliente não oficial**: não é afiliado
ao JurisprudênciaIA nem à JAI. Licença MIT. Feito para qualquer pessoa usar.

> **Vocabulário:** [`CONTEXT.md`](CONTEXT.md). Use os termos de lá.

## Onde está o plano

- Desenho aprovado: [`docs/design/2026-10-07-garimpo.md`](docs/design/2026-10-07-garimpo.md)
- Referência da API (rotas, campos, limites, inteiro teor por tribunal): [`docs/api-jurisprudenciaia.md`](docs/api-jurisprudenciaia.md)
- Tarefas e tickets ficam fora do repositório.

## Regras inegociáveis

1. **Código escrito do zero.** Existe um MCP de terceiros sem licença para a mesma API
   (e eventuais cópias locais dele na máquina). Não copie, não adapte, não abra
   esse código como base. O conhecimento da API vem de `docs/api-jurisprudenciaia.md`, mapeada de forma independente.
2. **Nada específico de usuário ou instituição.** Nenhum dado de processo real, nome de pessoa, órgão
   público, caminho de máquina ou fluxo de trabalho de alguém. Exemplos de busca são genéricos.
3. **Uso responsável é requisito, não opção.** Toda chamada ao site passa pelo cliente único, com: no
   máximo 2 chamadas simultâneas no total do processo (site e tribunais somados); em 429/503, espera e **uma** nova tentativa; recusa de novo = para e
   avisa o usuário. Objetivo: o máximo de cobertura do inteiro teor sem que o usuário do Garimpo tenha o IP bloqueado ou banido — por isso esses freios ficam.
4. **Publicação só com OK final do dono.** A JAI autorizou a publicação (informado pelo dono em 2026-10-08).
   O repositório no GitHub nasce **privado**; torná-lo público e rodar `npm publish` só com OK expresso do dono.
5. **Testes sem rede por padrão.** Unitários sobre respostas gravadas (fixtures); teste ao vivo só opcional,
   curto, atrás de variável de ambiente.

## Como trabalhar

- O dono é jurista, não programador: antes de mudança relevante, 2–3 frases do que vai fazer e por quê.
- Pronto = rodou e foi visto funcionando (testes + uma chamada real quando a tarefa pede), não "deveria funcionar".
- Commits pequenos, mensagem em pt-BR, `git add` com caminho explícito.

## Agent skills

### Issue tracker

Tickets e specs ficam em `TICKETS/<bloco>/`, local e fora do git. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Estados em português: a-triar, falta-informacao, pronto-para-agente, pronto-para-humano, nao-fazer (fim: resolvido). Ver `docs/agents/triage-labels.md`.

### Domain docs

Contexto único: `CONTEXT.md` + `docs/adr/` na raiz. Ver `docs/agents/domain.md`.
