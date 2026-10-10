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

**Acórdão recorrido**:
O acórdão impugnado por um recurso contra acórdão (por exemplo, embargos de declaração ou agravo interno). Pode existir no tribunal e não estar na base do JurisprudênciaIA.
_Evitar_: acórdão principal, acórdão de mérito (nem todo recorrido é de mérito), acórdão embargado (só serve aos embargos)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**Julgamento registrado**:
Um movimento de resultado de julgamento (pela tabela oficial de movimentos do CNJ) num registro de 2º grau ou de tribunal superior do DataJud. Indica que houve uma decisão naquele processo; não é acórdão, não traz texto e não identifica, por si só, qual recurso foi julgado.
_Evitar_: acórdão (do DataJud), decisão (genérico), andamento (é qualquer movimento)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**Data de lançamento**:
A data em que um movimento foi registrado no sistema do tribunal e aparece no DataJud. Pode ficar dias depois da sessão de julgamento; nunca é apresentada como data do julgamento.
_Evitar_: data do julgamento, data da sessão
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**Texto da intimação**:
O texto de uma comunicação publicada no DJEN, mostrado só em trecho saneado (sem nome de parte ou advogado) e sempre rotulado "texto da intimação, não o acórdão oficial". Nunca é inteiro teor oficial nem substitui a ementa do acórdão.
_Evitar_: acórdão, ementa oficial, inteiro teor, publicação (sozinho)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**Busca direta**:
Uma consulta a uma fonte, num tribunal, que devolve ementas inteiras e metadados: no JurisprudênciaIA, com o link do portal oficial e sem passar pelo chat de IA do site; no Falcão, com o texto integral do repositório oficial.
_Evitar_: pesquisa IA, chat, scraping
_Ampliação para outras fontes decidida pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeita a revisão do dono._

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
A linha fixa, em toda resposta com jurisprudência, que lembra que o resultado deve ser conferido na fonte oficial do tribunal antes de citar (vale também para o acórdão que veio sem link). Para o JurisprudênciaIA, diz que a base não é oficial; para o Falcão, diz que a fonte é o repositório oficial da Justiça do Trabalho, consultado por cliente não oficial. Com fontes diferentes na mesma resposta, cita as fontes usadas, sem estender a oficialidade de uma à outra.
_Evitar_: disclaimer, ressalva
_Variante por fonte decidida pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeita a revisão do dono._

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

**Texto integral do repositório oficial**:
O texto do acórdão que vem na resposta do Falcão (repositório oficial de jurisprudência da Justiça do Trabalho, Res. CSJT 401/2024), convertido de HTML para texto pelo Garimpo por regra fixa, sem outra mudança. Não é PDF: não tem página do PDF, recibo de origem nem origem conferida; é lido em partes e pode ser usado na conferência de citação, sempre com o rótulo da fonte.
_Evitar_: inteiro teor oficial (é o PDF), íntegra, PDF
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**HTTP comum**:
O jeito de baixar o PDF do portal usado no B11: pedidos simples, com cookies que o próprio portal entrega na mesma sessão e leitura dos links escritos no HTML, só em https nos endereços oficiais, sem executar JavaScript, login nem captcha. É um recorte técnico, não uma proibição: outras fontes podem se apresentar como navegador quando a fonte exige (ex.: o Falcão), sempre dentro dos freios.
_Evitar_: download direto, sem contorno (sozinho), scraping
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08; recorte ajustado à política do dono em 2026-10-09 — sujeito a revisão do dono._

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
Uma resposta de uma fonte que nega a chamada (429, 403, 503, desafio anti-robô, captcha). Diante dela o Garimpo espera e tenta uma vez, ou para, avisa e pausa a fonte em todas as janelas. Contornar a barreira que causa a recusa (por exemplo, apresentar-se como navegador) é permitido quando decidido para a fonte; insistir depois da recusa, nunca.
_Evitar_: erro (genérico demais), bloqueio contornável
_Ajuste à política do dono (contorno permitido, freios obrigatórios) proposto na entrevista do B12, 2026-10-09 — sujeito a revisão do dono._

## Memória e freio

**Memória**:
As respostas do site (acórdãos e buscas) que o Garimpo guarda por até 24 h desde a obtenção, visíveis por todas as janelas do Garimpo do usuário, sujeitas a limpeza antecipada pelo teto de espaço. Não inclui o PDF do inteiro teor nem promete disponibilidade pelo período todo. Para acórdãos do Falcão, guarda também o texto integral do repositório oficial, que só existe se veio numa busca; a busca guardada leva só ementa e metadados. Do DataJud e do DJEN, guarda só a resposta reduzida e saneada, sem nome de parte ou advogado.
_Evitar_: cache, memória da sessão
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08; notas do Falcão, do DataJud e do DJEN em 2026-10-09 — sujeito a revisão do dono._

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

**Freio preventivo**:
A parada de uma fonte antes de ela recusar, quando a própria fonte informa que restam poucas chamadas (no Falcão, o cabeçalho de restante chegou à reserva). Pausa a fonte em todas as janelas por um prazo fixo; vencido o prazo, o próximo pedido do usuário deixa sair uma só chamada, que confere o restante: acima da reserva, as chamadas voltam; senão, nova pausa igual. Não é recusa: não abre o disjuntor nem dobra a pausa, e nunca sonda sozinho.
_Evitar_: bloqueio, rate limit, disjuntor (é outra coisa)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

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
A fotografia, dentro do Garimpo, de uma fonte oficial de precedentes qualificados (hoje: temas repetitivos e IAC do STJ, do Portal de Dados Abertos do STJ; repercussão geral, súmulas e súmulas vinculantes do STF, de arquivos obtidos pelo mantenedor no portal do STF), com a data da coleta ou da obtenção e, no STJ, a data de atualização informada pela fonte; consultada sem rede. No `consultar_precedente` é o plano B da consulta ao vivo (ADR-0020); nas listas de qualificados das buscas, continua sendo a fonte do reforço.
_Evitar_: base, cache, banco, memória (é outra coisa: respostas do site por 24 h)
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**Consulta ao vivo (de precedente)**:
A busca de um precedente qualificado pelo número no portal do tribunal (STJ ou STF), na hora da pergunta, do computador do usuário, guardada 24 h na memória; a resposta diz "consultado no portal do <tribunal> em <data e hora>". Quando o portal não responde, a tabela de precedentes é o **plano B**, com a data dela.
_Evitar_: atualização, sincronização, raspagem
_Decidido pelo dono em 2026-10-09 (ADR-0020)._

**Situação na fonte**:
O valor literal que a fonte oficial dá a um precedente na data da tabela (ex.: "Trânsito em Julgado", "Afetado", "Cancelado"). Não é vigência nem aplicabilidade, e nunca é traduzido para "vigente" ou "superado".
_Evitar_: vigência, status, situação atual
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**Não consta na tabela**:
O número pedido não está na tabela de precedentes daquela data. Não prova que o precedente não existe (pode ser posterior à fotografia).
_Evitar_: não existe, inexistente, número inválido
_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

**Obtenção**:
O momento em que o mantenedor baixa ou salva, no navegador, um arquivo do portal do STF para a tabela; a data é a de modificação do arquivo, que o navegador marca no download. É a data da tabela do STF.
_Evitar_: coleta (é a do STJ, feita pelo próprio gerador), raspagem
_Registrado em 2026-10-09 a partir da decisão do dono sobre o STF (ticket 04 do B8) — sujeito a revisão do dono._

**Marca (da lista de súmulas)**:
O texto entre parênteses que a lista de súmulas do STF põe no rótulo ("cancelada", "superada", "revogada"…); é a situação na fonte das súmulas do STF. A falta de marca não prova que a súmula está em vigor.
_Evitar_: vigência, status
_Registrado em 2026-10-09 a partir da decisão do dono sobre o STF (ticket 04 do B8) — sujeito a revisão do dono._

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
