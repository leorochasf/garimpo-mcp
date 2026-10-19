# TRF2: busca oficial do e-Proc do tribunal e texto do portal

_Proposto pelo worker da missão «Coloca TRF2 TNU» (Claude), em 2026-10-19, a partir de decisão do dono da mesma data.
Fonte nova por decisão da ADR-0017. Substitui, para o TRF2, a exclusão registrada nas ADRs 0024 e 0027._

O TRF2 publica a jurisprudência no mesmo módulo de jurisprudência do e-Proc que o TRF4 (ADR-0024) e a TNU (ADR-0027),
em `eproc.trf2.jus.br`. O TRF2 é a terceira fonte do adaptador comum (`src/eproc.ts`); `src/trf2.ts` é só o envoltório.

## Decisão do dono sobre o termo de uso (2026-10-19)

A Resolução TRF2-RSP-2022/00032, art. 13, § 1º, diz: «É proibida a utilização de robôs ou qualquer programa
automatizado nos Portais sem expressa autorização» (lida em 2026-10-14; a resolução se aplica aos «Portais
institucionais» do TRF2, da JFRJ e da JFES, art. 2º, e não cita o host `eproc.trf2.jus.br`). Até aqui o TRF2 ficava fora
por essa vedação, com a dúvida sobre o alcance deixada para o dono.

O dono decidiu, em 2026-10-19: **«a proibição não alcança o sistema de consulta de jurisprudência dele do TRF2»**
(referência: Resolução TRF2-RSP-2022/00032, art. 13, § 1º). O TRF2 entra com base nessa decisão. Ela é interpretação do
dono sobre o alcance da resolução, não autorização expressa do TRF2; nenhuma autorização foi pedida nem recebida.

## O que foi lido e provado (2026-10-19)

- `https://eproc.trf2.jus.br/robots.txt`: 404, sem regras (lido em 2026-10-14). A página da pesquisa traz
  `X-Robots-Tag: noindex` (pede para não indexar; não veda acesso).
- Formulário (GET, 200, 64 KB, sem login nem captcha, cookie `PHPSESSID`): mesmo formulário do TRF4; origem
  `selOrigem[]=1` = TRF2 (as outras são TRU2 e Turmas Recursais); tipo `1` = Acórdão; `hdnInfraPrefixoCookie=TRF2_Eproc_`.
- Busca de prova (POST, UA honesto): 200, HTML ISO-8859-1, 410 KB, 21122 documentos para «aposentadoria especial», 10
  cards no mesmo formato do TRF4 (com «ÓRGÃO JULGADOR», «DECISÃO» e «EMENTA»), julgados de 27/08/2026.
- Inteiro teor (GET, 200, HTML, 131 KB): relatório, voto e acórdão, com «Documento eletrônico assinado por …» e o número
  do processo do card.
- Pelo próprio Garimpo (cliente único, depois do código): busca «dano moral», 7083 documentos, 3 mostrados, em 0,9 s;
  inteiro teor do primeiro, 25 mil caracteres, assinado, em 0,6 s. Medida única, não comparada com outras fontes.
- Teste ao vivo opcional: `GARIMPO_VIVO_TRF2=1` (`tests/vivoTrf2.test.ts`), 1 busca e 1 inteiro teor.

## Decisões

- **Mesmas regras do TRF4** (ADR-0024): UA honesto, tudo pelo Cliente único (freios da regra 3, disjuntor por serviço),
  uma página de 10 por busca, só ementa, só acórdãos do TRF2, ordem do portal; filtros, `somenteEmentas`, `precedentes` e
  `ordenacao` diferente de `relevancia` recusados com erro que ensina; redirecionamento não é seguido.
- **O que o TRF2 muda:** host e rota (`/eproc/externo_controlador.php`) e o prefixo do cookie. O card traz «ÓRGÃO
  JULGADOR», como no TRF4. O link de consulta processual aponta para o próprio e-Proc
  (`acao=processo_seleciona_publica`): **só é mostrado** (`linkConsulta`), nunca chamado.
- **Marca do documento:** a mesma do TRF4 («Documento eletrônico assinado por»), com texto útil mínimo e o mesmo número
  CNJ do card. O Garimpo não verifica a assinatura. Rótulo: «texto do portal do tribunal (TRF2)», nunca «inteiro teor
  oficial».
- **Ids** `trf2:<id>`; a busca guardada tem chave própria (o TRF2 não colide com o TRF4 nem com a TNU).
- **Precedentes qualificados do TRF2** não são pesquisados: a lista vem vazia, dito na resposta.

## Consequências

- Sigla `trf2` em `src/tribunais.ts` (fonte «e-Proc do TRF2»), inteiro teor `portal`, teto 10.
- Se o TRF2 recusar (429/503 duas vezes), o disjuntor do serviço abre e o usuário recebe o aviso; o formato que mudar dá
  erro de formato, nunca lista vazia.
- **Não verificado:** autorização expressa do TRF2 (não pedida); limite de ritmo; estabilidade dos ids; TRU2 e Turmas
  Recursais; filtros avançados; busca no inteiro teor; PDF (`gerarPDFDocumento`).
