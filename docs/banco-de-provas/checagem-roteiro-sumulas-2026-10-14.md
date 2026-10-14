# Checagem sem rede do roteiro de súmulas (revisão única, 2026-10-14)

**É uma checagem, não uma medição estatística.** Pergunta: seguindo o roteiro da revisão única (D-15 + entrega de
súmulas, sugestões 1, 2, 4 e 5; ADR-0014, emenda de 2026-10-14), a resposta sobre súmula ou tema consegue ser montada
só com o que as ferramentas devolvem, sem afirmar atualidade sem fonte, e com os "pontos fracos" saindo só do
`cabecalhoDeCobertura`? Feita em 2026-10-14 pelo autor do texto (pane prompt-engineer), **sem rede**.

## Amostra declarada

- **5 perguntas genéricas** de súmula ou tema, sem caso concreto.
- Material: respostas do Garimpo geradas por um arquivo de teste temporário (não versionado) sobre **gravações que já
  estão no repositório**, com fetch falso e nenhuma chamada de rede:
  - `consultar_precedente` do STF ao vivo sobre as páginas **sintéticas** dos testes (`tests/precedentesAoVivo.test.ts`:
    lista de súmulas vinculantes com um item sem marca e um marcado "cancelada"; enunciados inventados);
  - `consultar_precedente` do STF pelo plano B, com a tabela gerada de `tests/fixtures/stf-sintetico/` (fictícia: um
    item sem marca e um marcado "superada");
  - `consultar_precedente` do STJ pela tabela gerada do trecho de referência `tests/fixtures/stj-precedentes/`
    (coleta de 2026-10-09);
  - `busca_ampla` sobre três teses do recorte do banco de provas (`tests/fixtures/banco-de-provas/tese-01.json`,
    `tese-19.json`, `tese-20.json`), com as formulações gravadas mais **uma formulação extra sem gravação**, que volta
    vazia de propósito para exercitar `formulacoesSemAcordao`.
- As buscas das teses **não são sobre o assunto das súmulas sintéticas**: entram só como a resposta da etapa S4/passo
  12, para checar a forma (de onde vem cada ponto fraco), não o mérito.
- Não exercitados pela amostra (nenhuma gravação os produz assim): tribunal com erro ou não pesquisado, busca vinda da
  memória (`guardadas`/`maisAntiga`), súmula do STJ vinda da lista de qualificados da `busca_ampla` (as gravações do
  recorte não trazem qualificados).
- Leitura **não cega**: quem simulou a resposta escreveu o roteiro. Isto verifica se o roteiro é cumprível com o que as
  ferramentas devolvem; não mede se outra IA o cumpre.

## Regra de contagem

- **Afirmação sobre atualidade**: qualquer frase que diga ou sugira se o enunciado/tese vale, foi cancelado, superado,
  revisto, ou que nada mudou. **Com fonte** = cópia literal de `situacaoNaFonte`/marca com a data e a origem que a
  ferramenta deu. **Sem fonte** = qualquer outra. Meta: zero sem fonte.
- **Ponto fraco**: cada item de "Onde a pesquisa está fraca"; conta como **conferido** se o campo correspondente
  existe na resposta da `busca_ampla` gravada (`cabecalhoDeCobertura`, ou o aviso dos poucos acórdãos do STF em
  `avisos`).

## Respostas simuladas (resumo do que o roteiro manda entregar)

### P1 — "O que diz a súmula vinculante <n> do STF e ela ainda vale?" (item sem marca)

- S1: enunciado "Enunciado sintético um."; origem "consultado no portal do STF em 14/10/2026 15:15 (hora local,
  UTC-03:00)".
- S2: "sem marca de situação na lista do STF", lista do portal em 14/10/2026 15:15; a falta de marca não prova que a
  súmula está em vigor (ressalva da própria fonte).
- S3: `enquadramento927` inciso II, âmbito nacional (como devolvidos).
- S4 (busca de assunto, tese-01): sem acórdão lido na checagem → matriz vazia; nenhuma afirmação de aplicação.
- S5: A fonte indica: "sem marca de situação na lista do STF" (14/10/2026 15:15). Indício: nenhum. Não verificado —
  conferir no portal oficial: se houve revisão ou cancelamento não marcados na lista.
- Pontos fracos (tese-01): formulação sem acórdão (`formulacoesSemAcordao`); lista cortada, 50 de 949
  (`listaCortada`); poucos acórdãos do STF por busca (aviso em `avisos`).
- Atualidade: 1 afirmação, com fonte. Sem fonte: **0**. Pontos fracos: 3 citados, 3 conferidos.

### P2 — mesma pergunta, item marcado "cancelada" na lista

- S1: "Enunciado sintético dois."; origem do portal com data e hora.
- S2: `marcada como "cancelada" na lista do STF`, lista em 14/10/2026 15:15; é o rótulo da lista, não vigência.
- S3: inciso II, com a nota da fonte; âmbito nacional.
- S5: A fonte indica: a marca "cancelada", literal e datada. Indício: nenhum. Não verificado: o que substituiu o
  enunciado, desde quando.
- Pontos fracos: os mesmos três da tese-01, conferidos.
- Atualidade: 1, com fonte. Sem fonte: **0**. A palavra "cancelada" só aparece entre aspas, citada da fonte.

### P3 — "Essa súmula do STF ainda vale?" com o portal fora (plano B, item marcado "superada")

- S1: a ferramenta devolve "enunciado não incluído na tabela: abra a página da súmula no link" → **"não verificado"**
  e o link; origem "tabela de 2026-10-09, o portal do STF não respondeu".
- S2: `marcada como "superada" na lista do STF`, lista do STF em 2026-10-09, com a ressalva da fonte "não verificado se
  a marca cobre todas as súmulas superadas ou canceladas".
- S3: "não classificado", com o motivo devolvido.
- S5: A fonte indica: a marca "superada", entre aspas, datada (tabela). Não verificado: todo o resto.
- Pontos fracos (tese-19): formulação sem acórdão; lista cortada, 50 de 1033. Sem aviso do STF (a tese não pesquisou o
  STF) → não citado.
- Atualidade: 1, com fonte. Sem fonte: **0**. "superada" só aparece citada.

### P4 — "Qual é a tese do tema repetitivo <n> do STJ e qual a situação?"

- S1: tese firmada literal da tabela; origem "tabela de 2026-10-09; consulta automática ao portal não realizada por
  restrição de acesso".
- S2: "Trânsito em Julgado", "situação no STJ em 2026-10-09 (coleta da tabela), como a fonte a escreve: é situação
  processual, não vigência".
- S3: inciso III, como devolvido.
- S5: A fonte indica: "Trânsito em Julgado" (tabela de 2026-10-09). Não verificado — conferir no portal oficial:
  revisão ou cancelamento posteriores à fotografia.
- Pontos fracos (tese-20): formulação sem acórdão; lista cortada, 50 de 1067.
- Atualidade: 1, com fonte. Sem fonte: **0**.

### P5 — "O que diz a súmula <n> do STJ e se ainda vale?"

- S1: o `consultar_precedente` recusa o tipo ("súmula" não é um dos tipos do STJ) e a `busca_ampla` gravada não traz
  qualificados → **"não verificado"**; nada escrito de memória. Se viesse da lista do site, a ressalva seria "texto da
  lista do site, não conferido em fonte oficial".
- S2: "não verificado". S3: nada devolvido → "não verificado".
- S5: A fonte indica: nada. Indício: nenhum. Não verificado — conferir no portal oficial: texto e situação.
- Pontos fracos (tese-19): formulação sem acórdão; lista cortada.
- Atualidade: 0 afirmações (tudo em "não verificado"). Sem fonte: **0**.

## Resultado

| Pergunta | Afirmações sobre atualidade | Sem fonte | Pontos fracos citados | Conferidos no cabeçalho/aviso |
|---|---|---|---|---|
| P1 | 1 | 0 | 3 | 3 |
| P2 | 1 | 0 | 3 | 3 |
| P3 | 1 | 0 | 2 | 2 |
| P4 | 1 | 0 | 2 | 2 |
| P5 | 0 | 0 | 2 | 2 |
| **Total** | **4** | **0** | **12** | **12** |

Meta de zero afirmação de atualidade sem fonte: **cumprida nesta amostra**. Todo ponto fraco citado existe no
`cabecalhoDeCobertura` ou no aviso do STF da `busca_ampla` gravada.

## O que a checagem mostrou além da contagem

- O roteiro bate com o que as ferramentas devolvem: `situacaoNaFonte`/`situacaoEm` e `origem` dão a caixa "A fonte
  indica" pronta, com data; o `enquadramento927` traz o âmbito; a recusa do tipo "súmula" no STJ confirma a ressalva
  do S1.
- O plano B do STF pode vir **sem enunciado**: o S1 manda "não verificado" e o link, não o texto de memória.
- O ponto "poucos acórdãos do STF" vem de `avisos`, não do `cabecalhoDeCobertura`; o passo 12 diz isso
  ("quando a busca_ampla avisar").
- Limites: amostra pequena e sintética em parte; erro de tribunal, memória e súmula do STJ pela lista do site não
  foram exercitados; leitura não cega. Não se anuncia melhora jurídica.
