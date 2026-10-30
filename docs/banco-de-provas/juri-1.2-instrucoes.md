# Instruções ao júri — banco de provas 1.2

Você vai ler acórdãos e dizer, para cada um, se ele **serve para fundamentar a tese** do lote. O critério é o do dono
do Garimpo; o resultado é o **veredito do júri** (protocolo 1.2 do banco de provas, seção 5). Estas instruções vão
copiadas para a pasta do júri; o original fica em `docs/banco-de-provas/juri-1.2-instrucoes.md`.

## Onde está cada coisa

- `lotes/lote-NNN.md` — os acórdãos a julgar, em lotes de até 25, todos da mesma tese. O enunciado da tese vem no topo
  do lote.
- A sua pasta (`jurado-a/`, `jurado-b/` ou `desempate/`): grave nela `respostas/lote-NNN.csv`, um arquivo por lote, com
  o mesmo número do lote.
- Não abra nada fora da pasta `juri/`. As pastas vizinhas (`reservado/`, `rodada/`, `veredito/`,
  `conferencia-do-dono/`) são proibidas ao júri. Não pesquise na internet nem em ferramenta de jurisprudência.

## A pergunta, por acórdão

**"Serve para fundamentar a tese?"** Uma letra:

- **S (sim)** — a razão de decidir (ratio) do acórdão afirma a tese, ou a aplica como fundamento do resultado.
- **P (em parte)** — a ratio sustenta só um pedaço da tese (um dos seus elementos, um recorte), ou a sustenta com
  ressalva relevante.
- **C (contra)** — o acórdão enfrenta a tese e a rejeita: a ratio decide em sentido contrário a ela. É relevante, do
  lado contrário.
- **N (não)** — não serve: o acórdão é de outro assunto; só menciona a tese de passagem (obiter, citação solta,
  relatório); o que aparece é só alegação da parte ou voto vencido, não o que o tribunal decidiu; ou o acórdão não
  chega à questão (por exemplo, só admissibilidade).

## Critério

Leia como jurista que vai citar o acórdão numa peça ou parecer. Conta a ratio sobre a tese; mera menção não conta;
alegação da parte e voto vencido não contam. Julgue só pelo que está no lote (ementa e dados); não pesquise fora e não
presuma o conteúdo do inteiro teor. Ementa vazia ou insuficiente para decidir: **N**, com "ementa insuficiente" no
motivo.

Algumas linhas podem estar sob a tese errada de propósito. Julgue cada uma com o mesmo critério, sem tentar adivinhar
quais são.

A ordem é aleatória e nada indica como cada acórdão chegou ao lote; não tente inferir. Julgue só o conteúdo.

## Como responder

`respostas/lote-NNN.csv`, UTF-8, separador `;`, com o cabeçalho `id;resposta;motivo` e uma linha por acórdão do lote:

    id;resposta;motivo
    J-0001;S;a ratio aplica a tese e decide o caso por ela
    J-0002;N;trata de outro instituto

- `resposta`: uma letra só, S, P, C ou N.
- `motivo`: uma linha curta com o porquê, sem `;` e sem quebra de linha. Não copie a ementa.
- Todos os ids do lote, nenhum a mais. Grave lote a lote: se a sessão cair, retome do primeiro lote sem resposta.
- No fim, rode `node ../conferir.mjs` (no desempate: `node ../conferir.mjs --lotes lotes`) e corrija o que ele apontar
  até sair "tudo respondido".
