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
Um conjunto de buscas diretas com várias formulações da mesma tese, em um ou mais tribunais, cujos resultados são juntados sem acórdão repetido (registros equivalentes viram um acórdão só) e ordenados pela aderência, depois por quantas formulações acharam cada acórdão e pela melhor posição na busca de origem; cada tribunal com acórdão aderente tem vagas garantidas na lista, e os precedentes qualificados devolvidos vêm numa lista própria.
_Evitar_: varredura, crawler, burst

**Aderência**:
O quanto as palavras de uma formulação aparecem na ementa de um acórdão. Mede proximidade do texto com a tese, não relevância jurídica.
_Evitar_: cobertura (é métrica do banco de provas), relevância, score

**Trecho**:
O pedaço curto da ementa, mostrado na lista da busca ampla, onde aparecem mais palavras da tese; se nenhuma aparece, é o começo da ementa.
_Evitar_: resumo, snippet, começo da ementa (é só o caso sem palavra nenhuma)

**Cabeçalho de cobertura**:
A parte da resposta que diz o que foi pesquisado e o que ficou de fora: por tribunal, buscas vazias, buscas com erro, acórdãos achados e mostrados; as formulações que não trouxeram nada; e se a lista foi cortada.
_Evitar_: resumo, metadados, estatísticas

**Busca vazia**:
Uma busca direta que o site respondeu sem nenhum acórdão. Diz só que aquela formulação não achou nada naquele tribunal, não que o tribunal nunca decidiu a tese.
_Evitar_: zero resultados (sozinho, confunde com busca com erro)

**Busca com erro**:
Uma busca direta que não chegou a uma resposta utilizável (recusa, erro do site, formato inesperado). Nunca é contada como busca vazia.
_Evitar_: busca vazia, falha silenciosa

**Lista cortada**:
Lista mostrada com menos acórdãos do que a busca achou, por causa do máximo pedido.
_Evitar_: lista completa (quando cortada), resultado parcial (é o caso de recusa)

**Aviso de natureza jurídica**:
A linha fixa, em toda resposta com jurisprudência, que lembra que é resultado de busca em base não oficial e deve ser conferido no link oficial antes de citar.
_Evitar_: disclaimer, ressalva

**Precedente qualificado**:
Tema de repercussão geral, tema repetitivo, súmula, súmula vinculante, IAC, PUIL, IRR ou OJ, que o site devolve em listas próprias, separadas dos acórdãos. É o rótulo da lista do site e não comprova enquadramento, vigência nem aplicabilidade jurídica; o enquadramento legal é informado separadamente em Enquadramento no art. 927, com evidência ou motivo de não classificação.
_Evitar_: tema (sozinho, é ambíguo entre tribunais)
_Ressalva sobre o rótulo decidida pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeita a revisão do dono._

**Enquadramento no art. 927**:
O inciso do art. 927 do CPC em que um precedente se encaixa por regra fixa, com a base legal literal e a evidência tirada dos dados; ou "não classificado", com o motivo. Descreve o tipo identificado, não a vigência nem a aplicação ao caso concreto, e nunca é deduzido da falta de dados.
_Evitar_: força, peso, nível, vinculante (sozinho), persuasivo, fora do rol (para acórdão)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Inteiro teor oficial**:
O PDF do acórdão baixado do portal do próprio tribunal, nunca de cópia de terceiro.
_Evitar_: íntegra (do site), documento

**Inteiro teor trazido pelo usuário**:
O PDF que o usuário entrega ao Garimpo pelo caminho do arquivo (ex.: baixado à mão do STF ou do TJGO). A origem é declarada pelo usuário e não é conferida; nunca é chamado de oficial por declaração ou pelo nome do arquivo.
_Evitar_: inteiro teor oficial, PDF oficial
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Origem conferida**:
Situação do PDF lido ao lado de um recibo de origem válido, que registra download pelo Garimpo, com o mesmo sha256 do arquivo atual. Sem isso, a origem é **não conferida**, mesmo que o recibo exista.
_Evitar_: autenticado, certificado
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Vínculo declarado**:
A indicação, feita pelo usuário, de qual acórdão um PDF trazido seria. Preenche o cabeçalho, mas não prova a identidade do PDF; achar ou não o número do processo no texto é só informativo.
_Evitar_: vínculo confirmado, identificação
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Página do PDF**:
A posição de uma página dentro do arquivo do inteiro teor. Não é a folha dos autos.
_Evitar_: folha, fl.
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Parte**:
Um pedaço da leitura do inteiro teor como texto, formado por páginas do PDF inteiras até um teto de tamanho; uma página grande demais é dividida em segmentos, com a continuação indicada.
_Evitar_: página (uma parte tem várias), bloco, chunk
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Recibo de origem**:
A declaração do próprio Garimpo, gravada ao lado do PDF, de onde, quando e com que sha256 o arquivo foi obtido. Prova que os bytes não mudaram desde então; não é certidão do tribunal nem autenticação independente.
_Evitar_: certidão, comprovante oficial, autenticação
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Página sem texto extraível**:
Página do PDF da qual não sai texto nenhum. Pode ser imagem escaneada, mas isso não é afirmado; nunca é lida como "página sem conteúdo".
_Evitar_: página escaneada (é só uma das causas), página vazia
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Recusa**:
Uma resposta do site ou do tribunal que nega a chamada (429, 403, 503, desafio anti-robô, captcha). O Garimpo nunca contorna uma recusa: espera e tenta uma vez, ou para e avisa.
_Evitar_: erro (genérico demais), bloqueio contornável

## Conferência de citação

**Citação**:
O texto que o usuário pretende citar como sendo de um acórdão e pede para conferir.
_Evitar_: trecho (é outro termo), excerto
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Conferência de citação**:
A comparação literal de uma citação com a ementa ou com o inteiro teor, por regra fixa e sem IA, que termina num veredito: encontrado literalmente, encontrado com supressão indicada, difere só em maiúsculas/pontuação, não encontrado ou não verificável. Achar o texto não autentica a fonte.
_Evitar_: verificação de autenticidade, validação
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Supressão indicada**:
Corte que o usuário marca dentro da citação com "(...)" ou "[...]" — ou com reticências, só quando ele pede expressamente que valham como corte. Sem marcador, frases juntadas não são supressão.
_Evitar_: omissão, resumo
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Passagem parecida**:
Passagem copiada da fonte que tem a grande maioria das palavras da citação na mesma ordem, mostrada só como sugestão e sempre como diferente da citação.
_Evitar_: correção, versão certa, trecho
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Sinal de outro autor**:
Indício, na fonte, de que a passagem pode não ser do tribunal: aspas em volta dela, marcador de transcrição logo antes ("in verbis", "confira-se"…), ou a seção do acórdão (relatório, voto vencido). É indício, não autoria comprovada; a falta de sinal não prova que a passagem é do tribunal.
_Evitar_: autoria, citação de terceiro
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

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
