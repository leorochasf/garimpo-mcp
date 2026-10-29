# TJPR: inteiro teor pela página pública do acórdão e junção das cópias pelo documento do portal

_Proposto pelo Claude em 2026-10-29, a partir do estudo
[`docs/estudos/2026-10-29-tjpr-cobertura.md`](../estudos/2026-10-29-tjpr-cobertura.md) e da decisão do dono da mesma
data (implementar o inteiro teor pelo portal e a junção das cópias). Caso avaliado um a um, pelo critério do
caminho legítimo sem proteção a vencer (o mesmo da ADR-0029)._

O TJPR já tinha busca pelo JurisprudênciaIA e inteiro teor «só link», com a explicação genérica «ainda não testou».
O estudo mostrou que o link que vem da busca abre a página pública do acórdão no portal de jurisprudência do tribunal,
e que essa página já traz a íntegra do acórdão, sem login nem verificação anti-robô. Mostrou também que a base do
site devolve o mesmo acórdão duas vezes (dois lotes de importação) e que a junção de equivalentes não os juntava.

## O que foi lido e provado (2026-10-29)

- `https://portal.tjpr.jus.br/robots.txt`: `User-agent: *` e só `Disallow: /tjpr-assinador/`. A jurisprudência
  (`/jurisprudencia/`) fica fora do vedado. A página do acórdão traz `<meta name="robots" content="nofollow">` (pede a
  buscadores que não sigam links; não veda a leitura da página).
- Resolução TJPR n.º 532-OE, de 23 de março de 2026 (lida em 2026-10-29), altera o
  art. 5º da Resolução TJPR n.º 10/2007: «O acesso automatizado aos dados de movimentações processuais públicas
  dar-se-á por meio do Serviço de Consulta às Movimentações Processuais Públicas Automatizado - SCMPP» (§ 4º); a SETI
  pode «aplicar limitações quantitativas de acessos simultâneos para preservar a estabilidade dos sistemas» (§ 7º). Trata
  de movimentações processuais, não de jurisprudência; não proíbe acesso automatizado.
- Página do acórdão (GET, 200, `text/html; charset=UTF-8`, 48 a 75 KB, cookie de sessão, sem login nem captcha), num
  acórdão de Câmara Cível e num de Turma Recursal: bloco oculto «Íntegra do Acórdão» com o aviso do tribunal «O texto
  abaixo representa a transcrição de Acórdão. Eventuais imagens serão suprimidas.» e o texto em
  `<div id="texto<n>">`, onde `<n>` é o número do documento no link (`/jurisprudencia/j/<n>/…`). Na mesma página:
  «Processo:» com o número CNJ e «Segredo de Justiça: Não».
- A pesquisa pública do portal devolveu HTTP 502 duas vezes em ~12 chamadas; depois de 90 s a nova tentativa passou.
- **O portal troca a íntegra.** Na conferência ao vivo, a página de um mesmo link veio com o cabeçalho certo (mesmo
  «Processo:», mesmo `<n>` no bloco) e a íntegra de **outro** acórdão (outro processo, outro assunto) em 4 de 11
  chamadas; em 3 chamadas seguidas ao mesmo link, 2 vieram trocadas. Nas íntegras certas (6 páginas), o número do
  próprio processo aparece no texto, nos primeiros ~330 caracteres; nas trocadas, não aparece.
- Base do JurisprudênciaIA: cópias do mesmo acórdão com o mesmo `<n>` no link, ementas com rodapés de citação
  diferentes, às vezes sem órgão e classe.

## Decisões

- **Inteiro teor do TJPR = texto do portal do tribunal** (modo `portal`, como TJPI e TJDFT): um GET na página do link
  que veio da busca, pelo Cliente único (freios da regra 3, disjuntor do serviço `tjpr`), UA honesto, redirecionamento
  não seguido. Só `https` em `portal.tjpr.jus.br`, caminho `/jurisprudencia/j/<n>` (com ou sem o nome depois).
- **Só vale a página do documento pedido**: o bloco `texto<n>` do mesmo `<n>` do link, precedido do aviso de
  transcrição do tribunal, com texto útil mínimo; o campo «Processo:» presente e, quando a busca trouxe o número do
  processo, igual a ele; e **o número do processo da página escrito dentro da própria íntegra** (a guarda contra a
  troca). Faltou algo: nada é guardado, e a resposta diz «texto não verificado». Sem nova tentativa automática: chamar
  de novo é decisão de quem pede.
- **Segredo de justiça**: página com «Segredo de Justiça» diferente de «Não» não tem o texto guardado; vai o motivo.
- **502 conta como pedido de espera** no TJPR (mesma espera e única nova tentativa de 429/503): foi o que o portal fez no
  estudo. Recusa de novo abre o disjuntor do serviço `tjpr`, como nas demais fontes.
- **Rótulo**: «texto do portal do tribunal (TJPR)», convertido de HTML pelo Garimpo; não é PDF, não tem recibo de
  origem; imagens do acórdão não vêm (aviso do próprio tribunal).
- **Junção das cópias**: no TJPR, dois registros com o mesmo número de documento no link do portal
  (`/jurisprudencia/j/<n>/`) são o mesmo acórdão, ainda que a ementa mude no rodapé; números de processo que se
  contradigam continuam separando. Fica o registro mais completo (número, órgão, link), como na regra geral.

## Alternativas consideradas

- Manter só link: deixa de entregar um texto que o tribunal publica aberto.
- Buscar direto na pesquisa oficial do TJPR (como o e-Proc do TRF4) para cobrir o que falta na base do site: decisão
  maior, fora deste ADR (estudo, item 4).
- Juntar as cópias do TJPR por ementa sem o rodapé: frágil (o rodapé tem formatos variados); o número do documento no
  link oficial é a identidade do acórdão no próprio tribunal.

## Consequências

- `tjpr` passa a `inteiroTeor: "portal"` em `src/tribunais.ts`; o caminho fica em `src/tjpr.ts`.
- O TJPR pode fechar este caminho (verificação anti-robô, login, outro formato): o formato que mudar dá «texto não
  verificado», nunca texto errado.
- Por causa da troca, parte dos pedidos (cerca de 1 em 3 na medição) sai «texto não verificado» mesmo com o portal no
  ar. Íntegra certa que não cite o próprio número do processo também é recusada (preço aceito: recusa em vez de texto
  de outro caso).
- A busca do TJPR passa a mostrar menos itens repetidos; a contagem do site (`registrosDoSite`) continua contando as
  cópias.
- **Não verificado:** termo de uso específico do portal de jurisprudência do TJPR (nenhum achado); autorização do TJPR
  (não pedida); limite de ritmo do portal; decisões monocráticas; acórdãos com imagens ou tabelas relevantes.
