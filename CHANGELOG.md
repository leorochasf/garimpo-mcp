# Changelog

## 1.2 (não publicada)

- Novo prompt `distinguir_precedente`: monta a ficha do acórdão e uma matriz fato a fato em quatro estados (presente,
  diferente, não informado, não localizado), cada um com o trecho lido como prova; «diferente» só com fato contrário. A
  ferramenta não decide se o precedente se aplica, e os fatos do caso não vão às buscas. O `pesquisar_tese` ganha um
  orçamento orientador de chamadas, a formulação contrária sempre, a regra dos TRTs no teto do Falcão, uma 2ª rodada
  pela união das formulações e o aviso de busca do contrário incompleta.
- TCU: cada ano baixado ganha um índice local das palavras do texto, criado ao baixar o ano (o renovar cria o que
  faltar, sem baixar de novo). A pesquisa usa o índice quando ele confere com o arquivo (sha256) e devolve a mesma
  resposta da leitura inteira, mais rápido: na medição sem rede, busca quente de 7,1× a 354× mais rápida (mediana), p95
  até 98 ms em 10 anos. Se o arquivo mudou, ou se o índice falta ou está estragado, o ano é lido inteiro, com o motivo.
  O aviso antes de baixar estima também o disco do índice.
- `panorama_da_amostra`: passa a contar também por relator, em cada tribunal. O valor de origem é preservado, os não
  informados ficam à parte e as grafias diferentes não são fundidas (até 20, o resto em «outros», sem perder
  contagem). No e-Proc (TRF2, TRF4, TNU), o relator para o acórdão sai à parte. A resposta inteira fica abaixo de 25 mil
  caracteres.
- `texto_de_lei`: passa a ler também CP, CPP, CLT e CDC, pela compilação que o normas.leg.br marca como «Current». A
  resposta traz a URL da norma, o arquivo lido, a versão e o valor legal como a fonte os marca, sem afirmar vigência.
  Uma faixa de artigos («Arts. 498 a 502.») vem com o parágrafo literal e a observação de que a fonte junta os artigos.
  Número ilegível na fonte e dispositivo sem texto ficam «não verificado». Identificação repetida volta como
  «identificação necessária», sem o Garimpo escolher. URL oficial que não comprova a norma pedida para antes de baixar.
- Só link: a resposta do `obter_inteiro_teor` traz a chamada do `ler_inteiro_teor` pronta pelo id, para ler o PDF que
  o usuário baixar, com o aviso de que esse PDF pode ser de outro acórdão e que o Garimpo não confirma a identidade. O
  motivo do «só link» ganha classe (vedação escrita, desafio técnico, rota quebrada ou não testado) e a data da prova
  registrada, ou diz que não há prova própria, na página `garimpo://tribunais` e na resposta.
- TJGO: o texto vindo do PDF embutido no arquivo assinado (.p7s) deixa de sair rotulado como «acórdão em HTML» ou
  «convertido de HTML», na leitura e na conferência.
- Redação: as instruções e as descrições das ferramentas passam a dizer que o Garimpo pesquisa decisões judiciais
  públicas, com freios em toda chamada. No `consultar_precedente` do STJ, «restrição de acesso» dá lugar à causa real:
  o robots.txt do portal veda o acesso automatizado, e o Garimpo respeita. O README ganha a base legal (CF, art. 93,
  IX, conferido em 23/10/2026; Lei 9.610/98, art. 8º, IV). Nenhum comportamento muda.
- Só endereço do tribunal vira link: quando o JurisprudênciaIA manda, no lugar do link do acórdão, algo que não abre
  como página (no TJES e no TJMA, o HTML do acórdão embutido num endereço `data:`; no TJPB, um endereço `gs://` de
  armazenamento em nuvem), o Garimpo não o mostra mais e diz por quê no novo campo `avisoDeLink`. A busca de 3
  acórdãos do TJES deixa de passar de 400 mil caracteres. No `obter_inteiro_teor`, esse acórdão segue o caminho de
  quem não tem link (rota de link do site, depois o número no portal do tribunal), com o mesmo aviso. Só passa como
  link endereço `https` em domínio `.jus.br` (ADR-0031).
- TJBA: cópias do mesmo acórdão na base do JurisprudênciaIA (mesmo link do portal, datas diferentes) viram um
  resultado só, pelo documento do portal no link; números de processo que se contradigam continuam separados.
  Quando as cópias trazem datas de julgamento diferentes, o resultado avisa, no novo campo `avisoDeData`, as datas
  encontradas e que a data mostrada não foi conferida no tribunal (vale também para as cópias do TJPR).
- `listar_tribunais` e `obter_inteiro_teor`: o motivo do «só link» de TJPB, TJPE, TJRS, TJSE, TJRJ, TJSC, TJRO, TJAL,
  TJAM, TJAC, TJAP, TJMT e TJPA passa a dizer a barreira observada e a data (29/10/2026), no lugar do «ainda não
  testou» ou da data de 14/10. TJRN segue inconclusivo.
- Windows com antivírus lento: o Garimpo podia parar de usar a rede com um falso «não tem permissão» sobre o estado
  compartilhado de proteção, quando o antivírus segurava o arquivo por mais de 2 s. Agora espera até ~10 s antes de
  tratar como permissão negada de verdade. Com a permissão negada de fato, o aviso chega em até ~10 s.

## 1.1.2 (2026-10-29)

- TJPR: o `obter_inteiro_teor` passa a trazer o texto do acórdão da página pública dele no portal de jurisprudência do
  tribunal, que já traz a íntegra, como "texto do portal do tribunal" (HTML, sem PDF e sem recibo; o tribunal avisa que
  é transcrição, com as imagens suprimidas). Só o documento do link, com o mesmo número de processo da busca e esse
  número escrito dentro da íntegra: o portal às vezes põe na página certa a íntegra de outro acórdão (cerca de 1 em 3
  chamadas na conferência), e então nada é guardado e vai o motivo. Acórdão em segredo de justiça não tem o texto
  guardado. O `robots.txt` do portal não veda a jurisprudência; não há autorização do
  TJPR. HTTP 502 do portal conta como pedido de espera (uma nova tentativa), como 429/503 (ADR-0030).
- TJPR: cópias do mesmo acórdão na base do JurisprudênciaIA (dois lotes, com rodapés de ementa diferentes) viram um
  resultado só, pelo número do documento no link do portal; números de processo que se contradigam continuam separados.
- Estudo da cobertura do TJPR na base do site (`docs/estudos/2026-10-29-tjpr-cobertura.md`): na amostra, de cerca de 2020
  ao 1º semestre de 2026 nas Câmaras e até o fim de 2025 nas Turmas Recursais.

## 1.1.1 (2026-10-22)

- TJGO: o `obter_inteiro_teor` passa a trazer o texto do acórdão pela consulta pública do processo no Projudi (a
  «Ementa» e o «Relatório e Voto» do julgamento), como "texto do portal do tribunal" (HTML, sem PDF e sem recibo). Só o
  julgado exato que a busca achou: data e hora do julgamento, o arquivo que o site apontou e a ementa conferidos; sem
  casamento seguro, não baixa e diz o motivo. Entra por decisão do dono de que o caminho do link direto do processo é
  público e não passa pela verificação anti-robô, que fica só no formulário de busca do portal; não há autorização do
  TJGO (ADR-0029).
- TJGO: arquivos assinados (`.p7s`) também são lidos, pelo documento de dentro do envelope (o Garimpo não confere a
  assinatura); assinatura sem documento embutido não baixa e diz o motivo.
- TJPI: a leitura do texto do portal (`ler_inteiro_teor`) mostrava a fonte como o portal do TJTO; agora mostra a do TJPI.

## 1.1.0 (2026-10-19)

- TNU (nova): a busca vem da busca oficial do e-Proc da TNU (CJF), com a ementa inteira, 10 acórdãos por busca, e o `obter_inteiro_teor` traz o acórdão como "texto do portal do tribunal" (HTML, sem PDF e sem recibo). Sem órgão julgador na lista e sem precedentes qualificados da TNU. O termo de uso do host não foi achado (não verificado).
- TNU: o dono aceitou o risco do termo de uso não achado (2026-10-19), como no TRF4.
- TRF2 (novo): a busca vem da busca oficial do e-Proc do TRF2, com a ementa inteira e o órgão julgador, 10 acórdãos por busca, e o `obter_inteiro_teor` traz o acórdão como "texto do portal do tribunal" (HTML assinado, sem PDF e sem recibo). Entra por decisão do dono de que a proibição de robôs da Resolução TRF2-RSP-2022/00032 (art. 13, § 1º) não alcança o sistema de consulta de jurisprudência; não há autorização expressa do TRF2.

## 1.0 (2026-10-14)

### Novidades

Mais tribunais com o texto do acórdão
- TJDFT: o texto do acórdão vem pela API pública do tribunal, rotulado "texto do portal do tribunal".
- TJMS: o PDF do acórdão é baixado pelo portal oficial (eSAJ), com recibo.
- TJRR: o PDF é baixado, com recibo. TJPI: o texto vem do portal do tribunal.
- TJPA, TJRJ, TJSE, TJSC e STF seguem "só link", mas agora o Garimpo diz o motivo real e a data em que ele foi conferido.
- TRF4 (novo): a busca vem da busca oficial do e-Proc do tribunal (sem login nem captcha), com a ementa inteira, e o `obter_inteiro_teor` traz o acórdão como "texto do portal do tribunal" (HTML, sem PDF e sem recibo; o Garimpo não confere a assinatura eletrônica do tribunal). Cada busca é uma lista de até 10 resultados; os filtros de período, relator, órgão e classe ainda não funcionam no TRF4 e a ferramenta avisa. O link de acompanhamento do processo só é mostrado, nunca aberto pelo Garimpo, porque o `robots.txt` do tribunal o veda. O termo de uso do TRF4 não fala de acesso automatizado; isso fica registrado como "não verificado".
- TCU (novo): acórdãos do Tribunal de Contas da União pelos arquivos anuais de dados abertos do próprio tribunal. Três ferramentas: `baixar_anos_tcu`, `pesquisar_acordaos_tcu` e `ler_acordao_tcu`. Você escolhe os anos; antes de baixar, o Garimpo avisa o tamanho (de 300 a 500 MB por ano nos anos recentes; o acervo inteiro passa de 7 GB), o tempo e a pasta, e só baixa com a sua confirmação, um ano por vez. A pesquisa roda no seu computador, sem rede. O campo do TCU é "sumário", não "ementa". Acórdão invalidado ou sigiloso não entra como texto; relatório e voto sigilosos são reconhecidos e avisados. O texto oficial pode citar nomes de pessoas, e a pesquisa avisa que o Garimpo não os retira. Os dados não vão no pacote e não são repassados: cada usuário baixa direto do TCU.
- Legislação: nova ferramenta `texto_de_lei`, com o texto literal de UM dispositivo (artigo, parágrafo, inciso ou alínea) do CPC, do CC e da CF, tirado do portal oficial normas.leg.br, com a URL, a data e o aviso "o Garimpo não afirma vigência". Traz todas as redações que a fonte oferece, com as marcas dela, e não diz qual vale. O CDC ainda não está disponível: a fonte respondeu sem o texto.

TRTs (Justiça do Trabalho)
- Precedentes dos TRTs (súmulas, OJs e incidentes como IRDR e IAC) sob pedido, com `precedentes: true` na `busca_direta`. Cada item traz o tipo e a situação como a fonte rotula, com a data, ou "não verificado".
- Filtros novos nos TRTs: pesquisar só nas ementas e escolher a ordenação.
- Busca ampla nos TRTs: o valor `"trt"` em `tribunais` vale pelos 24 TRTs de uma vez (conta como um dos 5 tribunais do pedido). Cobrir uma página por TRT e por formulação custa 24 chamadas por formulação; cada chamada executa no máximo 5 páginas do Falcão, o resto sai como `foraDoTeto` no cabeçalho de cobertura e a mesma busca repetida executa as próximas (as já feitas voltam da memória). Tudo dentro do teto diário próprio de 50 chamadas.
- Decisões monocráticas e sentenças dos TRTs: a opção `decisoes` (`monocraticas` ou `sentencas`) da `busca_direta` traz até 10 itens da coleção do Falcão, **só metadados**, em lista separada. Nunca o texto, e nunca como acórdão nem como precedente do art. 927 do CPC. Testado só no TRT2.

Respostas melhores
- Nova ferramenta `conferir_acordao_citado`: confere número, tribunal, data e órgão de um acórdão que você já tem citado. Diz "confirmado", aponta o que não bate ou diz "não verificado". Isso não prova que o acórdão não existe. Compara com a base do JurisprudênciaIA; não vale para TRT.
- Nova ferramenta `panorama_da_amostra`: conta por tribunal, ano e órgão os acórdãos que uma busca já trouxe, sem nova chamada ao site. É contagem da amostra, não estatística do tribunal.
- Âmbito do precedente: nos casos classificados do STF e do STJ, o enquadramento no art. 927 do CPC informa o alcance nacional do órgão que decidiu. No IRDR de outro tribunal, informa o âmbito de origem (incluindo os juizados da região) sob a condição de ter fixado tese, que o Garimpo não confirma. Sem regra, o âmbito fica ausente.
- Agrupamento em série na busca ampla: acórdãos do mesmo tribunal, órgão e relator com a mesma ementa saem numa linha só, com a contagem, o período e os demais ids. Vem ligado; `agrupar: false` mostra cada acórdão.
- DJEN: a comunicação de acórdão mostra um trecho da ementa, saneado por regras de melhor esforço (sem garantia de detectar nomes livres), só quando o tipo do documento e o texto atendem aos critérios; com dúvida, "não verificado".
- Frase de privacidade nas instruções e no roteiro: "formule a busca com a tese em abstrato, sem nome de parte nem dado do caso".

Roteiro de pesquisa (o que a IA faz ao usar o Garimpo)
- A IA passa a mostrar a estratégia antes dos resultados: a questão central e as formulações de busca que vai usar.
- Pergunta sobre súmula ou tema tem resposta própria, em ordem fixa: o texto e de onde veio, a situação (como a fonte informa, com data, ou "não verificado"), a força pelo art. 927 do CPC e a aplicação pelos tribunais (menção não é aplicação).
- O "desgaste" do entendimento vem em três caixas: "a fonte indica" (literal, com data e origem), "indício" (algo no material que sugere mudança, com o trecho e a frase "não prova superação") e "não verificado". As palavras "vigente" e "superado" só aparecem dentro de citação literal da fonte.
- Nova seção "onde a pesquisa está fraca": formulações sem acórdão, tribunais com erro ou não pesquisados, lista cortada e buscas vindas da memória, tirado só do que a busca devolveu.

Freios novos (proteção do seu IP)
- Limite próprio por janela de tempo para as fontes que não informam quanto resta (precedentes do STF e TSE; o orçamento do STJ permanece definido, mas a consulta ao portal está desligada).
- Teto diário próprio de 50 chamadas por dia para a Justiça do Trabalho, mesmo quando o Falcão diz que ainda há saldo.
- No TJDFT, o freio também lê o saldo informado pela API do tribunal.
- Estado de proteção corrompido ou ilegível para a rede em vez de seguir adivinhando.
- Menos operações de disco por chamada ao Falcão (de 33 para 23 por chamada). Medido sem rede, em duas rodadas de 30: a 1.0 completa ficou igual à 0.5.0 em todas as operações medidas; só o início do servidor mostrou tendência de cerca de +0,1 s, ainda dentro do ruído.

Para quem mantém ou quer ajudar
- Formulários de problema e sugestão no GitHub, sem campo para dado de processo, e verificação automática (tipos, testes sem rede e build). A linha de chamado nos erros inesperados fica desligada até a publicação.
- Script do mantenedor com modo opcional que baixa a exportação de repercussão geral do STF (ver Limites conhecidos).

### Mudanças importantes

STJ
- Temas repetitivos e IAC do STJ respondem só pela tabela datada que acompanha o pacote. O Garimpo não consulta mais o portal do STJ, e a resposta diz "tabela de <data>; consulta automática ao portal não realizada por restrição de acesso".
- O inteiro teor do STJ é só link para conferir no navegador. O `robots.txt` de `processo.stj.jus.br`, lido em 13/10/2026, veda o acesso automatizado a esse host inteiro, e o Garimpo respeita. PDF do STJ já baixado com recibo, ou trazido por você, continua podendo ser lido com `ler_inteiro_teor`.
- STF segue consultado ao vivo, sem mudança.

Motivo do "só link"
- Onde o Garimpo tem prova própria, a resposta diz por que o tribunal é só link e a data da prova (TJRJ, TJSE, TJPA, TJSC, STF e STJ). Onde não há prova, o texto antigo ("ainda não testou") fica como estava.

### Limites conhecidos

- Tribunais que bloqueiam o acesso automatizado por termo de uso ou `robots.txt` (STJ, TJRJ, TJSE; no TJSC e no STF o portal respondeu com página de bloqueio ou desafio) ficam só com o link. O Garimpo não troca de identidade nem contorna.
- Sem o texto do acórdão, só link: TST (o link do PDF é um endereço encurtado que levou só à casca do aplicativo, sem o acórdão), TJPA (o portal devolveu só a casca do aplicativo), STF (o PDF fica atrás da proteção anti-robô do portal) e os demais tribunais não testados.
- Fora do Garimpo por ora: TRF2 e TRF6 (os termos de uso vedam robôs sem autorização expressa), TRF3 e TRF5 (não achamos rota pública de jurisprudência), CJF (TRF1 e TNU; a conexão foi derrubada pelo servidor) e o Banco Nacional de Precedentes do CNJ (a API é só para tribunais credenciados; a consulta pública é só no navegador).
- Os avisos de "quem disse" (órgão do fecho x órgão do registro) continuam **desligados**: faltam a validação cega por dois juristas e o segundo avaliador.
- "Perto de" (filtro "não pode conter X perto de Y"): a medição não mostrou ganho e o filtro não foi feito.
- O índice de dispositivo legal pelos Espelhos de Acórdãos do STJ (artigo → acórdãos) tem gerador e leitor prontos, mas o índice não é entregue no pacote desta versão: o portal do STJ respondeu 504 (erro do servidor) quando se tentou gerá-lo.
- Súmulas do STJ, escolha do texto integral do TST, Jurisprudência em Teses, registros do chat do JurisprudênciaIA e situação de superação ficaram para depois.
- A exportação de repercussão geral do STF por download é um modo opcional do script do mantenedor, não uma função da ferramenta.
- TCU lento: a medição do arquivo de 2025 levou de 7 a 19 segundos por pesquisa; pesquisar vários anos soma esse custo (a pesquisa varre os arquivos; não há índice nesta versão). Baixe poucos anos.
- TRF4: a validação ao vivo cobriu a lista e um inteiro teor; o leitor depois corrigido só foi testado sem rede; a velocidade em relação ao STJ pelo JurisprudênciaIA não foi medida.

## 0.5.0

TJTO
- O inteiro teor do TJTO agora vem como "texto do portal do tribunal": o Garimpo lê a página do acórdão no portal oficial e entrega o texto (sem PDF e sem recibo). O Garimpo se identifica como navegador só no portal do TJTO, por decisão do dono do projeto ([ADR-0021](docs/adr/0021-tjto-ua-de-navegador-e-texto-do-portal.md)).
- Página de erro ou de verificação anti-robô não passa como acórdão. Se o portal recusar, o Garimpo para e avisa.

TJGO
- Aviso de que o link do Projudi não abre fora da sessão do tribunal, com o caminho público da pesquisa (ConsultaJurisprudencia) e o número CNJ do resultado, na busca, no `obter_ementa` e na `busca_ampla`.

README
- Nova seção para liberar só as ferramentas do Garimpo, sem pedido de permissão a cada consulta (Antigravity CLI, Claude Code e Codex).
- Instalação no Antigravity CLI e no Codex CLI, nome Garimpo-Jurídico e tabela de abrangência atualizada (TJTO deixa de ser "só link").
## 0.4.0

Freios e transparência
- Página de bloqueio disfarçada de resposta normal e erro de parser (`HPE_*`) agora contam como recusa e acionam a pausa.
- Marca de pausa legível por máquina nas respostas (tipo, `liberadoEm`, `esperaSegundos`).
- Nova ferramenta `diagnostico_dos_freios` ("por que parou?"): lê o estado de proteção, sem chamar fonte nenhuma, e diz o que está pausado, até quando e se a recusa parece sistemática.
- Ordem fixa da lista de ferramentas e dicas de idempotência.

Leitura de PDF e HTML
- Leitura de PDF mais honesta: carimbo de origem, PDF misto (texto e imagem) e tetos declarados.
- Aviso quando o texto vindo de HTML traz trechos marcados como ocultos.

TRTs (Justiça do Trabalho)
- Quatro filtros nos TRTs, texto integral igual à ementa tratado e paginação do Falcão com conferências.

Busca
- Formulações com teto de 300 caracteres e espaços juntados.
- `busca_ampla` com `ordem: "data"`, estimativa de chamadas e tempo, motivo de falha por tribunal e teto de 25 mil caracteres sobre o texto final.
- Campos que faltam por acórdão (órgão, data, link) e aviso quando relator ou órgão não retorna resultado.
- Ressalva sobre a grafia da formulação.

DataJud
- Cliente mais defensivo diante de respostas inesperadas.

Precedentes e banco de provas
- Tabela de precedentes com trava de gravação e relatório de mudanças entre versões.
- Banco de provas: régua sem rede, 20 paradigmas das tabelas oficiais, teses em versão leiga e medição cega.

Conferência de citação
- Avisos de "quem disse" (órgão do fecho x órgão do registro e posição no julgado) construídos e **desligados** por padrão.

## 0.3.4

Versão anterior; veja o histórico do git.
