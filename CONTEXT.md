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

**Fonte**:
Um serviço público de onde o Garimpo tira jurisprudência ou dados de processo (JurisprudênciaIA, CSJT, DataJud, DJEN, TCU, STF, portal de um tribunal), com termos de uso lidos antes de entrar. Toda resposta diz de que fonte veio cada acórdão ou texto.
_Evitar_: base (sozinho), API, site (sozinho, é o JurisprudênciaIA)
_Decidido pelo dono em 2026-10-09._

**Fonte principal**:
O JurisprudênciaIA, para os tribunais que ele cobre. As outras fontes entram onde ele não chega; não o substituem nesses tribunais.
_Evitar_: fonte padrão, fonte oficial (o JurisprudênciaIA não é oficial)
_Decidido pelo dono em 2026-10-09._

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
Lista mostrada com menos acórdãos do que a busca achou (com filtro local, do que passaram pelo filtro), por causa do máximo pedido.
_Evitar_: lista completa (quando cortada), resultado parcial (é o caso de recusa)

**Aviso de natureza jurídica**:
A linha fixa, em toda resposta com jurisprudência, que lembra que é resultado de busca em base não oficial e deve ser conferido na fonte oficial do tribunal antes de citar (vale também para o acórdão que veio sem link).
_Evitar_: disclaimer, ressalva

**Precedente qualificado**:
Tema de repercussão geral, tema repetitivo, súmula, súmula vinculante, IAC, PUIL, IRR ou OJ, que o site devolve em listas próprias, separadas dos acórdãos. É o rótulo da lista do site e não comprova enquadramento, vigência nem aplicabilidade jurídica; o enquadramento legal é informado separadamente em Enquadramento no art. 927, com evidência ou motivo de não classificação.
_Evitar_: tema (sozinho, é ambíguo entre tribunais)
_Ressalva sobre o rótulo decidida pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeita a revisão do dono._

**Enquadramento no art. 927**:
O inciso do art. 927 do CPC em que um precedente se encaixa por regra fixa, com a base legal literal e a evidência tirada dos dados; ou "não classificado", com o motivo. Descreve o tipo identificado, não a vigência nem a aplicação ao caso concreto, e nunca é deduzido da falta de dados.
_Evitar_: força, peso, nível, vinculante (sozinho), persuasivo, fora do rol (para acórdão)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Roteiro de pesquisa**:
O passo a passo que o Garimpo oferece para pesquisar uma tese com as suas ferramentas: formular, buscar, separar pelo enquadramento no art. 927, ler ementas e inteiro teor, conferir antes de citar. Orienta quem pesquisa; nunca afirma jurisprudência.
_Evitar_: workflow, receita, prompt (sozinho)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Inteiro teor oficial**:
O PDF do acórdão baixado do portal do próprio tribunal, nunca de cópia de terceiro. O endereço do PDF pode ter sido indicado por terceiro (ex.: a rota de íntegra do JurisprudênciaIA), mas o arquivo vem do portal.
_Evitar_: íntegra (do site), documento
_Nota sobre endereço indicado por terceiro decidida pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeita a revisão do dono._

**HTTP comum**:
Obter o PDF do portal só com pedidos simples, com a identificação do próprio Garimpo: cookies que o próprio portal entrega na mesma sessão e leitura dos links escritos no HTML, só em https nos endereços oficiais. Não inclui executar JavaScript, fazer login, resolver captcha, se passar por navegador nem usar proxy.
_Evitar_: download direto, sem contorno (sozinho), scraping
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

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

## Memória e freio

**Memória**:
As respostas do site (acórdãos e buscas) que o Garimpo guarda por até 24 h desde a obtenção, visíveis por todas as janelas do Garimpo do usuário, sujeitas a limpeza antecipada pelo teto de espaço. Não inclui o PDF do inteiro teor nem promete disponibilidade pelo período todo.
_Evitar_: cache, memória da sessão
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Busca guardada**:
A resposta de uma busca direta tirada da memória: fotografia da busca feita no site em certa data e hora, não uma busca nova.
_Evitar_: busca em cache, resultado atualizado
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Vaga**:
Uma das duas permissões para uma chamada em andamento, compartilhadas entre as janelas do Garimpo do mesmo usuário, somando site e tribunais; fica ocupada até a chamada terminar ou ser abortada.
_Evitar_: slot, conexão, licença
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Disjuntor**:
O estado de um serviço, compartilhado por todas as janelas do Garimpo do usuário, que impede chamadas a ele depois de uma recusa final, por uma pausa que dobra a cada nova abertura.
_Evitar_: bloqueio, ban
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Chamada de prova**:
A única chamada, um pedido real, que sai a um serviço quando a pausa do disjuntor vence. Não tem nova tentativa: aceita, as chamadas voltam; recusada, a pausa recomeça dobrada; erro sem recusa deixa o serviço aguardando outra prova.
_Evitar_: teste, nova tentativa (essa é a da recusa inicial)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Rede parada**:
Situação em que o Garimpo não chama um serviço enquanto o disjuntor dele está aberto, ou não chama nenhum serviço se o estado compartilhado estiver ilegível; a leitura local (memória válida e PDFs) continua.
_Evitar_: Garimpo travado, fora do ar
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

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

## Filtros locais e referências a precedente

**Filtro local**:
Condição que a chamada da busca ampla impõe às ementas já recebidas ("deve conter", "não pode conter", referência a precedente), sem nova chamada ao site. Tira acórdãos da lista e não muda a ordem relativa dos que ficam; a reserva por tribunal e o corte vêm depois.
_Evitar_: filtro (sozinho — confunde com os filtros do site: data, relator, órgão, classe), refinamento
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Excluído pelo filtro**:
Acórdão achado, com ementa conferível, que descumpriu um filtro local e saiu da lista. É contado no cabeçalho de cobertura e não se confunde com lista cortada.
_Evitar_: descartado, oculto
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Sem ementa para conferir**:
Acórdão achado que veio sem ementa e, com um filtro local ativo, sai da lista por não haver texto a conferir. É contado à parte de excluído pelo filtro.
_Evitar_: excluído pelo filtro, acórdão vazio
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Referência a precedente**:
Menção, na ementa, a Tema, Súmula ou Súmula Vinculante pelo número, com o tribunal só quando o texto o declara junto (ou ao fim de uma enumeração reconhecida); Súmula Vinculante é do STF pelo próprio tipo. Não é conferência de citação nem prova de que o acórdão aplica o precedente.
_Evitar_: citação (é o texto que o usuário confere), tema (sozinho)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Tribunal não indicado**:
Situação da referência a precedente cuja ementa não diz de que tribunal ela é. Nunca é completada pelo tribunal do acórdão.
_Evitar_: tribunal desconhecido, tribunal presumido
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

**Mapa de referências**:
A lista, na busca ampla, das referências a precedente mais frequentes entre os acórdãos achados (antes dos filtros locais e do corte), com quantos acórdãos fazem cada uma. Frequência não é relevância.
_Evitar_: mapa de citações, ranking de precedentes
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

## Tabela de precedentes

**Tabela de precedentes**:
A fotografia, dentro do Garimpo, de uma fonte oficial de precedentes qualificados (hoje: temas repetitivos e IAC do STJ, do Portal de Dados Abertos do STJ), com a data da coleta e a data de atualização informada pela fonte; consultada sem rede.
_Evitar_: base, cache, banco, memória (é outra coisa: respostas do site por 24 h)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**Situação na fonte**:
O valor literal que a fonte oficial dá a um precedente na data da tabela (ex.: "Trânsito em Julgado", "Afetado", "Cancelado"). Não é vigência nem aplicabilidade, e nunca é traduzido para "vigente" ou "superado".
_Evitar_: vigência, status, situação atual
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**Não consta na tabela**:
O número pedido não está na tabela de precedentes daquela data. Não prova que o precedente não existe (pode ser posterior à fotografia).
_Evitar_: não existe, inexistente, número inválido
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

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
