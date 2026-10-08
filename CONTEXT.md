# CONTEXT.md — glossário do Garimpo

## Pesquisa

**Tese**:
A proposição jurídica para a qual se procuram precedentes. Uma tese é pesquisada por uma ou mais formulações.
_Evitar_: assunto, pergunta, consulta

**Formulação**:
Um jeito de escrever a mesma tese em palavras de busca (sinônimos técnicos, dispositivo legal, nome do instituto). A busca ampla roda várias formulações da mesma tese.
_Evitar_: query, prompt

**Acórdão**:
Um julgamento colegiado: um órgão julgador, numa data, decidindo um recurso ou ação. Recurso e embargos do mesmo processo são dois acórdãos.
_Evitar_: processo (um processo pode ter vários acórdãos), decisão (genérico demais)

**Registro**:
Uma entrada na base do JurisprudênciaIA. Normalmente um registro é um acórdão, mas a base pode ter o mesmo acórdão em dois registros; para o Garimpo, os dois são um acórdão só.
_Evitar_: resultado, item, documento

**Busca direta**:
Uma consulta à base do JurisprudênciaIA, num tribunal, que devolve ementas inteiras, metadados e link do portal oficial, sem passar pelo chat de IA do site.
_Evitar_: pesquisa IA, chat, scraping

**Busca ampla**:
Um conjunto de buscas diretas com várias formulações da mesma tese, em um ou mais tribunais, cujos resultados são juntados sem acórdão repetido e ordenados por quantas formulações acharam cada acórdão.
_Evitar_: varredura, crawler, burst

**Aderência**:
O quanto as palavras de uma formulação aparecem na ementa de um acórdão. Mede proximidade do texto com a tese, não relevância jurídica.
_Evitar_: cobertura (é métrica do banco de provas), relevância, score

**Precedente qualificado**:
Tema de repercussão geral, tema repetitivo, súmula, súmula vinculante, IAC, PUIL, IRR ou OJ, que o site devolve em listas próprias, separadas dos acórdãos.
_Evitar_: tema (sozinho, é ambíguo entre tribunais)

**Inteiro teor oficial**:
O PDF do acórdão baixado do portal do próprio tribunal, nunca de cópia de terceiro.
_Evitar_: íntegra (do site), documento

**Recusa**:
Uma resposta do site ou do tribunal que nega a chamada (429, 403, 503, desafio anti-robô, captcha). O Garimpo nunca contorna uma recusa: espera e tenta uma vez, ou para e avisa.
_Evitar_: erro (genérico demais), bloqueio contornável

## Banco de provas

**Banco de provas**:
O conjunto de teses genéricas, com gabarito, usado para medir o Garimpo e compará-lo com outros sistemas antes e depois de cada mudança.
_Evitar_: benchmark, suíte de testes (são os testes automáticos, sem rede)

**Relevante**:
Acórdão cuja ementa enuncia, aplica ou enfrenta a tese, a favor ou contra, ainda que o recurso não tenha sido conhecido ou a tese apareça como premissa de outra discussão.
_Evitar_: pertinente, útil, bom resultado

**Gabarito**:
Para cada tese, a marcação de relevante ou irrelevante de cada acórdão da lista unificada, confirmada pelo dono.
_Evitar_: resposta certa, ground truth

**Pré-marcação**:
Marcação provisória (relevante, irrelevante ou dúvida) feita por IA lendo a ementa; só vira gabarito depois da revisão do dono.
_Evitar_: gabarito (antes da revisão)

**Lista unificada**:
Todos os acórdãos que os sistemas comparados acharam para uma tese, sem acórdão repetido, indicando quem achou cada um.
_Evitar_: pool, base

**Cobertura**:
Relevantes que um sistema achou, divididos pelos relevantes da lista unificada.
_Evitar_: recall, aderência

**Precisão**:
Relevantes que um sistema devolveu, divididos por tudo o que ele devolveu.
_Evitar_: acerto, acurácia
