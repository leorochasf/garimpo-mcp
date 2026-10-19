# TNU: busca oficial do e-Proc do CJF e texto do portal do tribunal

_Proposto pelo worker da missão «Coloca TRF2 TNU» (Claude), em 2026-10-19 — sujeito a revisão do dono. Fonte nova por
decisão da ADR-0017. A investigação D-07 de 2026-10-14 deixou o host da TNU (`eproctnu-jur.cjf.jus.br`) para o dono
decidir; o pedido do dono de colocar a TNU no Garimpo é tratado como essa decisão._

A TNU (Turma Nacional de Uniformização dos Juizados Especiais Federais) publica a jurisprudência nova no mesmo módulo de
jurisprudência do e-Proc que o TRF4 usa (ADR-0024), em host próprio do CJF. O adaptador do e-Proc passou a ser comum
(`src/eproc.ts`); a TNU é a segunda fonte dele (`src/tnu.ts`). A antiga base JSF do CJF (`jurisprudencia.cjf.jus.br/tnu`),
que podia estar parada desde 2025, **não** é usada.

## O que foi lido e provado (2026-10-19)

- `https://eproctnu-jur.cjf.jus.br/robots.txt`: 404, sem regras. Termos de uso do CJF para esse host: **não achados**
  (busca na web e `www.cjf.jus.br/cjf/termos-de-uso` = 404; `www.cjf.jus.br` e `www2` derrubaram a conexão em 2026-10-14).
  Sem vedação encontrada não equivale a autorização: o termo fica **não verificado quanto a uso automatizado**, como no TRF4.
  **Decisão do dono (2026-10-19): «aceito o risco da TNU».** A TNU fica no Garimpo com o termo de uso do host não
  encontrado, risco assumido pelo dono, como no TRF4; o termo segue não verificado.
- Formulário (GET, 200, 38 KB, sem login nem captcha, cookie `PHPSESSID`); origem `selOrigem[]=1` = TNU; tipo `1` = Acórdão;
  `hdnInfraPrefixoCookie=TRF4_Eproc_` (valor que o próprio formulário traz).
- Busca de prova (POST, 2 chamadas no total, UA honesto): 200, HTML ISO-8859-1, 817 documentos para «aposentadoria
  especial», 10 cards, **julgados de 30/09/2026 e publicados de 01 a 06/10/2026** (base viva; o congelamento de 2025
  dito para a base antiga do CJF não vale aqui).
- Inteiro teor (GET, 200, HTML, 143 KB): relatório, voto e acórdão, com «Conferência de autenticidade emitida em …» e
  as partes por iniciais.
- Teste ao vivo opcional: `GARIMPO_VIVO_TNU=1` (`tests/vivoTnu.test.ts`), 1 busca e 1 inteiro teor.

## Decisões

- **Mesmas regras do TRF4** (ADR-0024): UA honesto, tudo pelo Cliente único (freios da regra 3, disjuntor por serviço),
  uma página de 10 por busca, só ementa, só acórdãos, ordem do portal; filtros, `somenteEmentas`, `precedentes` e
  `ordenacao` diferente de `relevancia` recusados com erro que ensina; redirecionamento não é seguido.
- **O que a TNU muda:** o card não tem «ÓRGÃO JULGADOR» (o campo `orgao` fica ausente e a resposta marca que falta, sem
  inventar) e não tem link de acompanhamento processual (links esperados: 1, o do inteiro teor); pode ter «RELATOR PARA
  ACÓRDÃO», que sai junto do relator («X (relator para o acórdão: Y)») sem trocar um pelo outro.
- **Marca do documento:** o HTML da TNU não traz «Documento eletrônico assinado por»; só vale a página com «Turma
  Nacional de Uniformização» e «Conferência de autenticidade emitida em», texto útil mínimo e o mesmo número CNJ do
  card. O Garimpo não verifica autenticidade. Rótulo: «texto do portal do tribunal (TNU)», nunca «inteiro teor oficial».
- **Ids** `tnu:<id>`; a busca guardada tem chave própria (a TNU não colide com o TRF4).
- **Precedentes qualificados da TNU** (representativo de controvérsia, precedente relevante) não são pesquisados: a lista
  vem vazia, dito na resposta. O filtro `chkPrecedenteRelevante` do portal não foi testado.

## Fora desta decisão

- **TRF2:** ficou fora desta decisão pela Resolução TRF2-RSP-2022/00032, art. 13, § 1º («É proibida a utilização de
  robôs ou qualquer programa automatizado nos Portais sem expressa autorização»). Atualização de 2026-10-19: o dono
  decidiu que «a proibição não alcança o sistema de consulta de jurisprudência dele do TRF2», e o TRF2 entrou pela
  [ADR-0028](0028-trf2-pelo-eproc-do-tribunal.md).
- **TRF1 pela base antiga do CJF:** continua fora (conexão derrubada; frescor não verificado).

## Consequências

- Sigla `tnu` em `src/tribunais.ts` (fonte «e-Proc da TNU»), inteiro teor `portal`, teto 10.
- **Não verificado:** termos de uso de `eproctnu-jur.cjf.jus.br` (risco aceito pelo dono em 2026-10-19); limite de ritmo; estabilidade dos ids; velocidade; filtros
  avançados; PDF (`gerarPDFDocumento`). Se o formato mudar, o leitor dá erro de formato, nunca lista vazia; se o CJF
  recusar, o disjuntor do serviço abre e o usuário recebe o aviso.
