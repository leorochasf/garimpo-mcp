# Índice de dispositivo legal pelos Espelhos de Acórdãos do STJ

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-13 (D-09 do mapa de implementação do b16;
item I-45) — sujeito a revisão do dono._

O Garimpo passa a poder levar dentro do pacote um **índice "dispositivo legal → acórdãos do STJ"**, gerado dos
conjuntos "Espelhos de Acórdãos" (`espelhos-de-acordaos-<órgão>`, 10 conjuntos) do Portal de Dados Abertos do STJ,
cuja ficha declara "Creative Commons Atribuição" (`cc-by`, versão não indicada; conferido em 2026-10-13). Substitui a
proposta de "consulta sob pedido" (DQ-08b / G-42): os arquivos do portal são por mês e por órgão, não por artigo, e a
rota `/api/` é vedada pelo `robots.txt`, então responder "art. X" ao vivo exigiria baixar todo o acervo (≈ 540
arquivos, ≈ 1 GB, no mínimo 1,5 h). Mesmo modelo da tabela de precedentes ([ADR-0015](0015-tabela-de-precedentes-de-fonte-com-licenca-como-fotografia-datada.md)):
fotografia empacotada e datada, gerada pelo mantenedor, consultada sem rede.

## Condições

- **Piloto limitado.** Só CPC/15, CC/02 e CDC. O tamanho real do piloto é medido antes de ampliar a outras leis; o
  pacote nunca provoca o download do acervo no computador do usuário.
- **Só índice e metadados mínimos.** Identificação inequívoca de lei, ano, artigo, parágrafo e inciso, mais o
  necessário para identificar o acórdão (classe, número, registro, órgão, relator, datas). **Sem ementa, sem o campo
  `decisao` e sem `acordaosSimilares`.** O `decisao` traz, em parte dos acórdãos, nome de advogado e de parte (13 de
  8.996 na amostra); "acórdãos similares" são decisões em série do mesmo relator, não jurisprudência semelhante, e
  nunca são apresentados como semelhança temática.
- **Licença.** Atribuição CC BY ao Portal de Dados Abertos do STJ, Espelhos de Acórdãos, **sem inventar a versão da
  licença** (a ficha não a informa). A licença dos dados é distinta da licença MIT do código; a atribuição acompanha
  README, o índice e toda resposta que o usa.
- **Gerador do mantenedor, fora do pacote.** Cliente único do Garimpo, só as páginas de ficha e os arquivos de download
  dos conjuntos, **uma chamada por vez, com ao menos 10 s entre elas** (Crawl-Delay do `robots.txt`), **nunca `/api/`**,
  uma nova tentativa em 429/503, parada em recusa ou desafio anti-robô. Antes de substituir a fotografia anterior:
  validar a licença de cada conjunto, o hash de cada arquivo, meses ausentes, a identidade dos acórdãos (duplicados pelo
  `id` e também por registro + data + classe) e gravar o relatório de alterações. Link montado a partir de registro e
  data é link para consulta, não prova de que o download é viável, e respeita o acesso ao STJ decidido em D-18.
- **Consulta sob demanda rejeitada**, pelo motivo acima.
- **Aviso obrigatório em toda resposta que usa o índice** (texto literal):

  > Classificação da Secretaria de Jurisprudência do STJ, Espelhos de Acórdãos, CC BY; fotografia de <data>. Inclui
  > apenas acórdãos selecionados e classificados pelo STJ, com lacunas importantes nos recentes. Não é a lista de todos
  > os acórdãos que aplicaram o dispositivo. Para complementar, use a busca.

  Fotografia com mais de 90 dias sai com aviso adicional. Resultado vazio significa ausência **no índice dessa
  fotografia**, nunca ausência de julgado.

## Por que com condição

Medido em amostra (2026-10-13; `espelhos-stj-viabilidade.md`): dos 15 acórdãos lidos, 14 tratam do artigo ligado; o
acervo até ~2021 é bem classificado (74% da Terceira Turma tem referência legislativa), mas nos arquivos mensais o
percentual cai (2023: 64%; 2024: 35%; 2025: 16%; 2026: 14%) e os arquivos publicados não são refeitos. São medidas de
amostra, não precisão nem cobertura globais. Que fração dos acórdãos do STJ o conjunto cobre **não foi medida**: a ficha
diz que só os acórdãos cuja ementa traz novidade recebem tratamento. O risco principal é a rapidez local sugerir
completude; por isso o aviso é fixo. A rapidez da consulta local não foi medida no Garimpo e não se promete aceleração
da busca textual do JurisprudênciaIA, que continua sendo a porta para acórdão recente.

## Opções consideradas

- Consulta sob demanda no portal: rejeitada (inviável, ver acima).
- Índice do STJ inteiro de uma vez: rejeitado agora; ≈ 20 MB compactados estimados (contra 2,4 MB de `dados/`) e
  estimativa frágil. O piloto mede antes.
- Levar a ementa no pacote: rejeitado; ≈ 10,8 MB a mais na amostra, e a ementa já vem da busca pelo número do processo.
- "Acórdãos similares" como jurisprudência semelhante: rejeitado.

## Consequências

- A fonte é registrada em [`docs/fontes.md`](../fontes.md) antes de qualquer código que a use (ADR-0017).
- O leitor do texto de `referenciasLegislativas` (campo do espelho) é o primeiro passo; gerador e ferramenta MCP são
  tickets seguintes. O gerador com rede só roda quando nenhuma outra prova de rede estiver rodando.
- Publicação segue exigindo OK final do dono (`CLAUDE.md`, regra 4).
