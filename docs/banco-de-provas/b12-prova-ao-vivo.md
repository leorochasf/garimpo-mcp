# B12 — prova ao vivo curta do Falcão (CSJT) (2026-10-09)

Ticket 01 do B12. Termos de uso: [`../fonte-falcao.md`](../fonte-falcao.md). Programa descartável e log das chamadas
ficam fora do git, em `banco-de-provas-resultados/b12-prova/`; **nenhuma resposta real foi gravada** (corpos lidos em
memória a partir de arquivos em `%TEMP%`, apagados no fim). Nenhum número de processo, id ou nome real aqui.

**Como:** `Cliente` real (`dist/`, v0.3.2) com `GARIMPO_DADOS` numa pasta temporária nova em `%TEMP%` (instrução do
orquestrador; o ticket pedia a pasta de proteção compartilhada real — ela foi só **lida** antes: sem disjuntor `jt`,
legível). UA de navegador (Firefox 139) + `Origin`/`Referer` do site + `Accept` postos por um `fetch` envolvido, só
nessas chamadas. Uma chamada por execução, em série.

**Proteção demonstrada antes da 1ª chamada** (com log simulado, sem rede): o programa recusou sair com restante
anterior = 10 ("parado: restante 10 <= 10"), depois de um 429 ("parado: última chamada deu 429") e com 10 chamadas
já gastas ("teto de 10 chamadas atingido"); e o `Cliente` com `esperaMaximaMs: 0`, diante de um 429 falso com
`x-rate-limit-retry-after-seconds: 20880`, fez **1** ida e lançou `RecusaError` (sem nova tentativa).

## Chamadas (10 de 10; nenhum 403/429)

| # | Hora (UTC) | O quê | HTTP | `x-rate-limit-remaining` |
|---|---|---|---|---|
| 1 | 14:15:01 | página inicial | 200 | — (ausente) |
| 2 | 14:17:17 | `main.*.js` (rodapé e rotas) | 200 | — |
| 3 | 14:17:54 | `runtime.*.js` (nome do módulo dos termos) | 200 | — |
| 4 | 14:18:02 | módulo `399.*.js` (página "Privacidade e Termos de Uso") | 200 | — |
| 5 | 14:19:07 | pesquisa, `tribunais=TRT3`, sem filtro | 200 | 39 |
| 6 | 14:19:28 | + `dataInicio=2024-03-01&dataFim=2024-03-31` | 200 | 39 |
| 7 | 14:20:07 | + `dataInicio=dataFim=2024-03-05` | 200 | 39 |
| 8 | 14:20:10 | + `classeProcesso=AP` (3,7 s depois da 7) | 200 | **38** |
| 9 | 14:20:15 | + `nomeRelator` e `orgaoJulgador` (do 1º resultado da 5) | 200 | **39** |
| 10 | 14:24:25 | + só `orgaoJulgador`, ~4 min depois | 200 | 39 |

## Limite de taxa

- `x-rate-limit-remaining` só vem da API; páginas e arquivos do site não o trazem (e não se sabe se contam).
- **Não desce 1 por chamada** em ritmo lento: 39 nas chamadas 5–7, feitas a 20–40 s de intervalo; caiu a 38 com 3,7 s de intervalo e voltou a
  39 em 4,7 s; ~4 min depois, 39. Leitura: balde de ~40 que recarga na ordem de segundos (≈ 1 unidade a cada poucos segundos), não de
  horas. Evidência de 5 pontos, **não** janela comprovada; capacidade e taxa exatas **não verificadas**.
- Ajuste proposto para o ticket 03: reserva 10 e pausa 15 min continuam seguras, mas a pausa é folgada para um balde
  que recarga em segundos. Sugestão: manter a reserva 10 (o 429 custa horas de bloqueio) e baixar a pausa preventiva
  para **1 min**, mantendo o intervalo mínimo de 1 s — o orquestrador/dono decide; o spec chama os números de iniciais.

## Filtros (Q14)

| Filtro | Formato aceito | Significado | Evidência |
|---|---|---|---|
| `dataInicio`/`dataFim` | ISO `AAAA-MM-DD` | **data de juntada** | janela de 1 dia: 10/10 com `dataJuntada` no dia, só 6/10 com `dataJulgamento` no dia; total 304 |
| `classeProcesso` | **sigla** (`AP`) | classe processual | 10/10 com `siglaClasseProcesso` = `AP`; nome por extenso não testado (juscraper: zero resultados, **não verificado**) |
| `nomeRelator` | nome como vem no campo `relator` | relator | com `orgaoJulgador`: 10/10 mesmo relator e mesma turma; total 418 |
| `orgaoJulgador` | nome como vem no campo `turma` (não `gabinete`) | turma | sozinho: 10/10 com a mesma `turma` (relator variado); total segue 10000 |

`quantidadeTotal` fica em 10000 mesmo com filtro de classe (teto: "10.000 ou mais"); com filtro de data caiu a 6257/304.

## Formato da resposta (rota `GET /jurisprudencia-nacional-backend/api/no-auth/pesquisa`)

Parâmetros usados: `texto`, `colecao=acordaos`, `sessionId` ("_" + 7 letras/dígitos), `page=0`, `size=10`,
`tribunais=TRT3`. JSON de ~1,0–2,4 MB por página de 10. Topo: `documentos` (lista), `temasTopFive` (lista de
objetos de precedentes, com `tribunal`, `numero`, `categoria`, `situacao`, `highlightTese` etc.), `quantidadeTotal`
(número). Cada documento (sempre presentes nas 10 amostras da chamada 5):

| Campo | Tipo | Observação |
|---|---|---|
| `numeroProcesso` | string | CNJ com máscara, 25 caracteres, ramo 5 |
| `siglaClasseProcesso` / `classeProcesso` | string | ex.: `ROT`, `AP`, `RORSum` / nome por extenso |
| `relator`, `gabinete`, `turma` | string | `turma` no formato "Na. Turma" |
| `idGabinete`, `idTurma` | número | |
| `tribunal` | string | `TRT3` (letras + número) |
| `idDocumentoAcordao` | string | 8 dígitos |
| `textoAcordao` | string HTML | 22–50 mil caracteres; 5–15 mil de texto; **sempre** com imagem embutida (base64); traz nomes de partes |
| `ementa` | string HTML ou `""` | 5 de 10 vazias |
| `possuiEmenta` | `"S"`/`"N"` | nas 50 amostras (chamadas 5–9), `"N"` ⇔ ementa vazia e `"S"` ⇔ ementa preenchida (sem divergência) |
| `highlightTextoAcordaoAnonimizado` | string HTML | texto puro de tamanho próximo ao do `textoAcordao` (±3%); nomes trocados por `____` |
| `highlightEmenta`, `highlightTextoAcordao` | string HTML | com destaques |
| `referenciaLegislativa` | lista de strings | códigos (ex.: `art_71_clt`) |
| `prioridades` | `null` | |
| `dataJulgamento`, `dataJuntada` | string `dd/mm/aaaa` | sem data de publicação |
| `score` | número | |

Fixture **sintética** derivada desse formato (sem dado real): [`../fonte-falcao-resposta-sintetica.json`](../fonte-falcao-resposta-sintetica.json)
— dois acórdãos fictícios (com e sem ementa), HTML com imagem, entidades, etiquetas aninhadas, lista, tabela,
comentário, `script` e `style`. O ticket que escrever os testes a copia para `tests/fixtures/`.

## Destrava

Termos sem proibição expressa de acesso automatizado nem de reuso → o ticket 01 deixa de bloquear. Destravado
já: **02** (só dependia do 01). Os demais seguem a cadeia: 03 ← 02; 04 ← 03; 05, 06, 07 ← 04; 08 (a-triar) ← 04.
O 11 (a-triar) perde o bloqueio do 01, mas segue fora do escopo do B12.
