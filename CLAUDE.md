# CLAUDE.md — Garimpo

Servidor MCP local (stdio), em Node/TypeScript, que pesquisa jurisprudência brasileira pela busca direta
do JurisprudênciaIA e baixa o inteiro teor oficial dos tribunais. **Cliente não oficial**: não é afiliado
ao JurisprudênciaIA nem à JAI. Licença MIT. Feito para qualquer pessoa usar.

> **Vocabulário:** [`CONTEXT.md`](CONTEXT.md). Use os termos de lá.

## Onde está o plano

- Desenho aprovado: [`docs/design/2026-10-07-garimpo.md`](docs/design/2026-10-07-garimpo.md)
- Referência da API (rotas, campos, limites, inteiro teor por tribunal): [`docs/api-jurisprudenciaia.md`](docs/api-jurisprudenciaia.md)
- Tickets: [`TICKETS/`](TICKETS/) — um por arquivo, linha `Status:` no topo, `Bloqueado por:` declara dependência.
  Ticket sem bloqueio aberto pode começar. Ao terminar: critérios conferidos, `Status: resolvido`, nota em `## Comentários`.

## Regras inegociáveis

1. **Código escrito do zero.** Existe um MCP de terceiros sem licença para a mesma API
   (e eventuais cópias locais dele na máquina). Não copie, não adapte, não abra
   esse código como base. O conhecimento da API vem de `docs/api-jurisprudenciaia.md`, mapeada de forma independente.
2. **Nada específico de usuário ou instituição.** Nenhum dado de processo real, nome de pessoa, órgão
   público, caminho de máquina ou fluxo de trabalho de alguém. Exemplos de busca são genéricos.
3. **Uso responsável é requisito, não opção.** Toda chamada ao site passa pelo cliente único, com: no
   máximo 2 chamadas simultâneas no total do processo (site e tribunais somados); em 429/503, espera e **uma** nova tentativa; recusa de novo = para e
   avisa o usuário; User-Agent honesto identificando o Garimpo. **Nunca** contornar limite, captcha ou
   bloqueio anti-robô (Cloudflare, AWS WAF, reCAPTCHA): o que não sai por HTTP comum devolve link + explicação.
4. **Publicação só com OK final do dono.** A JAI autorizou a publicação (informado pelo dono em 2026-10-08).
   O repositório no GitHub nasce **privado**; torná-lo público e rodar `npm publish` só com OK expresso do dono (ticket 04).
5. **Testes sem rede por padrão.** Unitários sobre respostas gravadas (fixtures); teste ao vivo só opcional,
   curto, atrás de variável de ambiente.

## Como trabalhar

- O dono é jurista, não programador: antes de mudança relevante, 2–3 frases do que vai fazer e por quê.
- Pronto = rodou e foi visto funcionando (testes + uma chamada real quando o ticket pede), não "deveria funcionar".
- Commits pequenos, mensagem em pt-BR, `git add` com caminho explícito.
