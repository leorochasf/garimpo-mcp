# TJES e TJMA: o texto da base do JurisprudênciaIA

_Decisão do dono em 2026-10-29. Aprovado pelo dono em 2026-10-30._

O TJES e o TJMA não têm caminho oficial para o inteiro teor que o Garimpo possa usar (nenhum PDF por GET, nenhum portal
registrado no molde da ADR-0032). Mas, nos dois, o registro que o JurisprudênciaIA devolve na busca traz o acórdão em
HTML, embutido no campo do link como `data:text/html;base64,…` (observado em 2026-10-29: de 15 a 294 KB por registro).
Até aqui o Garimpo descartava esse valor, porque `data:` não é página de tribunal (ADR-0031).

## Decisão

- **Modo novo `base`** na tabela de tribunais, só para TJES e TJMA. O texto vem **só do registro da busca**: nenhuma
  chamada nova, nenhum host novo. Por isso não há termo de uso novo a ler (ADR-0017): a fonte é a própria resposta do
  JurisprudênciaIA, já coberta pelos freios e pela autorização registrada.
- **O módulo `src/textoDaBase.ts` é puro**: aceita só `data:text/html;base64`, respeita o charset, recusa com motivo o que
  for outra coisa, base64 inválido, grande demais (teto de 2 MiB) ou sem texto, e converte pela regra fixa do Garimpo
  (`html.ts`), com o indício de corte e o aviso de conteúdo oculto de sempre.
- **A busca guarda o texto** (`normalizar` devolve uma lista paralela, `textosDaBase`, como a das teses; `lembrarTextos`
  grava pelo id do acórdão que a busca mostra, mesmo se o texto veio de uma cópia juntada). O `paraAcordao` segue
  descartando o `data:`: **o valor cru nunca vai à resposta ao usuário**.
- **Rótulo em toda resposta que usa o texto:** «texto da base do JurisprudênciaIA, não oficial». Aparece na explicação do
  `obter_inteiro_teor`, na fonte e na natureza do cabeçalho do `ler_inteiro_teor`, na origem do `conferir_citacao` e em
  `listar_tribunais`. Nenhuma dessas respostas chama o texto de «oficial», de «inteiro teor do tribunal» nem lhe dá recibo.
- **O oficial prevalece.** O texto da base só vale onde não há caminho oficial: tribunal em modo `baixa` ou `portal`, ou
  com portal registrado no molde, nunca o usa. Com portal registrado, a busca nem guarda o texto da base (guardado, o
  `ler_inteiro_teor` o serviria no lugar do texto do portal).
- **Metadados que o registro não traz não são inventados** (no TJMA faltam número, órgão e data): saem «não informado».
- Sem o HTML no registro, a resposta diz isso, com a sigla, e manda abrir o link (se houver link https do tribunal) ou
  procurar o acórdão no portal do tribunal; a ponte para o PDF trazido pelo usuário segue igual.

## Alternativas

- **Ficar só link** (como era): perde um texto que o Garimpo já recebe. Descartada pelo dono.
- **Tratar como texto do portal:** mentiria sobre a origem. Descartada: a natureza é outra (cópia de terceiro, não oficial).
- **Guardar o `data:` no acórdão:** 60 a 294 KB por registro na memória e risco de vazar na resposta. Descartada.

## Consequências

- TJES e TJMA saem de «só link / não testado»: `listar_tribunais` mostra `base`.
- A fidelidade do texto não é conferida com o tribunal: quem cita deve conferir no portal do tribunal.
- Os testes dos motivos (`motivoSoLink`, `motivoClassificado`) deixam de listar TJES e TJMA como «não testado».
- Não verificado: se o HTML da base é sempre o acórdão inteiro; se TJES e TJMA mantêm o campo `data:` em todos os registros.
