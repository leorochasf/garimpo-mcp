# TCU: acórdãos pelos arquivos anuais de dados abertos, baixados pelo usuário e pesquisados no computador dele

_Decidido pelo dono em 2026-10-14, sobre D-08 (Sol, 2026-10-13); leitura do robots.txt aceita pelo piloto na mesma data._

O Garimpo passa a pesquisar acórdãos do Tribunal de Contas da União nos **arquivos anuais de acórdãos completos** dos
dados abertos do TCU (`acordao-completo-<ano>.csv`). O usuário escolhe quais anos baixar; o Garimpo baixa direto do TCU
para o computador do usuário e pesquisa lá, sem rede. Fonte e termos: `docs/fontes.md`.

- **O usuário escolhe o recorte e é avisado antes de baixar:** que precisa baixar, o tamanho por ano (300 a 500 MB nos
  anos recentes; acervo inteiro cerca de 7,6 GB) e a pasta onde fica. Nunca se baixa o acervo por padrão; download só
  por ação explícita (`confirmar`). Um ano por vez, retomável, pelo cliente único com os freios da regra 3.
- **Sem redistribuição.** O conjunto não declara licença aberta; valem os termos do Portal TCU (uso comercial vedado sem
  permissão; republicar conteúdo público citando fonte, título e autor). Como cada usuário baixa direto do TCU, o
  Garimpo não empacota nem repassa os dados: o código é MIT, os dados não vão no pacote.
- **robots.txt.** Para `User-agent: *` nada veda `/dados-abertos/`; o User-Agent honesto do Garimpo cabe nessa regra e
  não muda. **Alerta registrado:** o mesmo arquivo veda por inteiro robôs de IA nomeados (entre eles `ClaudeBot`,
  `ChatGPT-User`, `GPTBot`). O Garimpo é operado por assistentes de IA; a leitura literal aceita o acesso, e o
  download só acontece a pedido do usuário. Se o TCU passar a vedar `*` em `/dados-abertos/`, a fonte sai.
- **Campos.** `SUMARIO` é "sumário", nunca "ementa". Relatório e voto só existem no tipo `ACÓRDÃO`; o acórdão de
  relação traz só o texto (`ACORDAO`), e a resposta diz isso. `INTERESSADOS` e `ADVOGADO` (LGPD) não são indexados nem
  mostrados. `SITUACAO` aparece em toda resposta; acórdão `INVALIDADO` ou sigiloso não entra como texto válido.
  O voto e o relatório podem citar nomes de pessoas no corpo; é o texto oficial publicado, e a ferramenta avisa.
- **Atualização.** Ano baixado não é baixado de novo; a renovação (corrente ou fechado, o TCU regravou até o de 2025) é
  ação explícita, com pedido condicional (`ETag`/`Last-Modified`). Toda resposta traz a data da base (atualização no TCU
  e data do download). Falha na renovação preserva a cópia anterior.

## Opções consideradas

- Busca do portal por pergunta (`pesquisa.apps.tcu.gov.br`, backend não documentado): rejeitada (D-08).
- Webservice `recupera-acordaos`: não traz relatório nem voto, só sumário e links; fora.
- Empacotar os dados no npm: rejeitado (sem licença aberta declarada).
- Arquivo de "visão geral" gerada por IA (`acordao-completo-resumo.csv`): fora; não é texto oficial.

## Consequências

- Três ferramentas novas: `baixar_anos_tcu`, `pesquisar_acordaos_tcu`, `ler_acordao_tcu`. Servem a ADR-0017 (fonte
  além do JurisprudênciaIA); a resposta rotula a origem como arquivo de dados abertos do TCU.
- O disco do usuário fica com arquivos grandes em `<pasta de dados>/tcu/`; o aviso prévio é parte do contrato.
- Relatório, voto e sumário que o TCU classificou como sigilosos (o arquivo traz só o aviso do art. 108, § 1º, da Lei
  8.443/1992) são reconhecidos: o acórdão continua listado com o texto `ACORDAO`, a resposta marca `partesSigilosas` e
  `temRelatorioEVoto: false`, e a leitura diz "classificados como sigilosos pelo TCU" em vez de entregar o aviso como texto.
- A pesquisa também avisa que o texto oficial cita nomes de pessoas e que o Garimpo não os retira (`avisoNomes`).

## Validação ao vivo (2026-10-14)

Uma linha de rede, `sites.tcu.gov.br`, pelo cliente único. Bateu com o desenho; o que mudou foi o que está acima
(aviso de sigilo, aviso de nomes na pesquisa) e a fixture da lista, que agora segue o formato real.

- **Lista de anos:** 200, 5.945 bytes, UTF-8; cabeçalho `"BASE"|"ANO"|"TAMANHO"|"ARQUIVO"`, coluna `BASE` antes do ano,
  linhas fora de ordem, uma linha do resumo por IA com ano vazio e linhas de outras bases (Súmulas em KB). 35 anos
  (1992–2026), 7.595,57 MB no total; `MB` é MiB.
- **Download de 2025:** 413.563.594 bytes (= 394,40 MB da lista) em 17,0 s; RSS de pico ~90 MB. Renovação por pedido
  condicional: 304, sem baixar de novo.
- **Arquivo de 2025:** 18.588 registros (12.304 de relação, 6.284 comuns); 99 `INVALIDADO` e 11 sigilosos ficam de fora
  (110 contados); `INTERESSADOS`/`ADVOGADO` nunca chegam à memória. 9 acórdãos oficializados com `SUMARIO`/`RELATORIO`
  (e 4 com `VOTO`) substituídos pelo aviso de sigilo.
- **Varredura:** 7,0 a 19,4 s por ano por pesquisa (arquivo de 2025, um processo por consulta); memória em fluxo (a
  pesquisa termina igual com o heap travado em 128 MB).
- **Não verificado:** o link oficial por chave (`pesquisa.apps.tcu.gov.br`, host não liberado) e a retomada por `Range`
  + `If-Range` ao vivo.

## Decisão de velocidade (1.0)

Mantém-se a **varredura por arquivo**, sem índice local: com 10 anos baixados uma pesquisa levaria de 1 a 3 minutos.
Para a 1.0 o custo é **dito, não escondido**: o aviso de baixar diz que cada ano baixado acrescenta cerca de 10 a 20 s a
cada pesquisa e recomenda poucos anos; a pesquisa devolve `anosPercorridos` e `tempoSegundos`. O índice local fica para
o ticket de cache forte e índice local (b19-velocidade), que recebe estes números como caso de uso.

## Decisão de velocidade 1.2 (B1.2, 2026-10-23)

Substitui a da 1.0 no que diz respeito à pesquisa: cada ano baixado ganha um **índice textual local** ao lado do CSV
(`acordao-completo-<ano>.indice`), e a pesquisa usa o índice quando ele vale. A resposta é **a mesma** da varredura —
ids, total, ordem, todos os campos (inclusive `trechos` e `partesSigilosas`), exclusões por situação, anos usados e
sem arquivo; muda só o tempo, e a resposta ganha `indiceLocal` (por ano: pelo índice ou lido inteiro, e por quê).

- **O que o índice guarda:** as palavras do mesmo texto que a pesquisa compara (normalizado como o filtro local), com
  documentos e posições, e por acórdão só onde ele está no CSV, chave, tipo, colegiado, relator, data e número. Nada de
  INTERESSADOS/ADVOGADO, nenhum texto novo, nenhum resumo por IA. Sem dependência nativa (`src/tcuIndice.ts`).
- **Mesma resposta por construção:** o índice decide sozinho só palavra solta e frase de palavras separadas por espaço;
  termo com pontuação e acórdão que a triagem barata recusaria (marcado ao criar o índice) são conferidos no texto pelo
  mesmo caminho da varredura; os acórdãos mostrados são relidos do CSV e montados pelo mesmo código. Termo sem letra
  nem número: o ano é lido inteiro.
- **Amarrado ao conteúdo do arquivo:** o índice nasce só de CSV com recibo e que confere com o sha256 dele, e guarda
  sha256, tamanho e data do arquivo. Tamanho e data iguais não bastam (revisão do B1.2, G1: um CSV alterado no lugar,
  com tamanho, data e chave preservados, fazia o índice velho valer e devolver acórdão que passara a sigiloso): o sha256
  do arquivo é **recalculado na 1ª pesquisa de cada processo** e de novo sempre que o arquivo for tocado (muda tamanho,
  data de modificação, data de alteração do sistema ou número do arquivo no disco). CSV trocado, conteúdo diferente,
  recibo ausente, índice ausente, de outra versão ou estragado (sha256 do índice inteiro) → aquele ano é lido inteiro,
  com o motivo em `indiceLocal`. Segunda defesa: cada acórdão relido do CSV para a resposta precisa ter a chave, o tipo,
  o colegiado e o relator que o índice registrou e não pode estar INVALIDADO nem sigiloso; senão a pesquisa inteira é
  refeita lendo os arquivos. Nunca resposta pela metade. Limite: dentro de um mesmo processo, uma troca que forje
  também a data de alteração do sistema (exige ferramenta de baixo nível) só é pega pela segunda defesa.
- **Quando nasce (D14, recomendação "sob pedido, ao baixar o ano"):** ao baixar, retomar ou atualizar um ano; e
  `renovar: true` com `confirmar: true`, quando o TCU diz que não mudou (304), cria o índice que falta sem baixar de
  novo — é o caminho para anos baixados pela 1.1. Falha ao criar o índice não desfaz o download. O aviso antes de baixar
  estima o disco do índice (`indiceEstimadoMb`, 35 % do arquivo).

**Medição** (sem rede; TCU sintético da composição registrada em B0.3; servidor compilado chamado por MCP no stdio,
processo novo por bloco; N = 30 por braço, varredura e índice alternados na mesma rodada, respostas comparadas campo a
campo: idênticas nas 30 rodadas; `scripts/medirIndiceTcu.ts`, 2026-10-23, mesma máquina da linha de base, já com a
conferência do sha256 do arquivo da correção G1):

| Pesquisa quente, mediana (p95), ms | 1 ano | 5 anos | 10 anos |
|---|---|---|---|
| seletiva | 257 → 6,5 (7,6) | 1.331 → 18,5 (21,1) | 2.995 → 22,5 (25,5) |
| comum | 415 → 16,9 (20,0) | 2.608 → 21,4 (22,8) | 5.274 → 25,0 (27,8) |
| vazia | 248 → 2,7 (3,2) | 1.467 → 5,2 (5,9) | 2.974 → 8,4 (10,3) |
| sem acento | 290 → 39,2 (43,0) | 1.628 → 44,8 (46,5) | 3.394 → 45,7 (48,9) |
| entre aspas | 449 → 50,0 (55,9) | 2.515 → 58,9 (62,8) | 5.176 → 67,6 (72,3) |
| com filtros | 102 → 9,8 (13,4) | 569 → 36,9 (39,8) | 1.181 → 41,4 (46,8) |
| 1ª do processo (comum, com a conferência do sha256) | 449 → 47,5 (54,9) | 2.021 → 98,0 (104,3) | 4.586 → 161,4 (174,9) |

Ganho na mediana de 7,4× (sem acento, 1 ano) a 355× (vazia, 10 anos); com 10 anos, p95 de no máximo 175 ms (a 1ª
pesquisa do processo, que confere o sha256 dos 10 arquivos), dentro da meta de D11 (≥ 5× e ≤ 2 s no p95 com 10 anos
sintéticos). O braço varredura reproduz a linha de base da 1.1.1 (`docs/banco-de-provas/velocidade-base-1.1.1.md`:
comum de 10 anos 5.236 ms lá, 5.274 ms aqui). Vale para esta composição; o tempo absoluto no arquivo real não sai daqui.

**Criação do índice** (processo próprio, servidor compilado): 1 / 5 / 10 anos sintéticos (9,8 / 46,9 / 95,5 MB de CSV)
→ 3,4 / 16,7 / 33,9 MB de índice (35,1 a 35,7 % do CSV), 1,2 / 6,1 / 13,2 s e RAM de pico de 130 / 155 / 177 MB (40 MB
do processo vazio). **Um ano sintético do tamanho do real** (18.588 registros, 388 MB;
`scripts/medirIndiceTcuAnoReal.ts`): índice de 131 MB (33,9 %), 47,6 s e 366 MB de RAM de pico para criar; a pesquisa
comum caiu de 18,8 s (varredura) para 27 ms (índice), com o mesmo total (16.316); a 1ª do processo leva 375 ms, dos quais
cerca de 200 ms são a conferência do sha256 do arquivo (com 10 anos reais, estimam-se 2 a 3 s só na 1ª pesquisa de cada
sessão; não medido). **Não medido:** a fração e o tempo no arquivo real do TCU, que tem mais marcação HTML por palavra.

**Fica para depois:** as descrições das ferramentas no `servidor.ts` ainda falam em 10 a 20 s por ano (B2.1); o teto
de disco aceitável é decisão do dono (D14), com os 35 % acima na mão.
