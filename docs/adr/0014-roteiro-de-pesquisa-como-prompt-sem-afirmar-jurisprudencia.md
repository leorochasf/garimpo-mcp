# Roteiro de pesquisa como prompt MCP e instructions, sem ferramenta e sem afirmar jurisprudência

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

O Roteiro de pesquisa vive num prompt MCP (`pesquisar_tese`, argumentos `tese` obrigatório e `tribunais` opcional,
ambos texto) e em três frases nas `instructions` do servidor, que apontam a ordem das ferramentas e as proibições.
Não existe ferramenta "roteiro" que devolva o mesmo texto. O texto do roteiro e das `instructions` não contém
nenhuma afirmação de jurisprudência: nenhum número de processo, Tema, Súmula, recurso ou "entende(m) que"; exemplos
só abstratos ("instituto jurídico + expressão alternativa"). Um teste automático de padrões trava isso, junto com
leitura humana. Motivo: o roteiro induz a IA do usuário a pesquisar; se ele próprio afirmasse jurisprudência, a IA
o repetiria como fonte, e o Garimpo passaria a afirmar o que nunca conferiu.

## Opções consideradas

- Só prompt MCP: rejeitado — o prompt só chega quando o usuário o escolhe no menu; vários clientes nunca o mostram.
- Prompt + ferramenta "roteiro" com o mesmo texto: rejeitado — duplica o texto e soma uma ferramenta à lista que a IA
  tem de escolher.
- Exemplos com teses reais no roteiro: rejeitado — exemplo concreto vira afirmação de jurisprudência.

## Consequências

- O teste de padrões é trava parcial, não prova semântica; mudar o texto exige reler.
- Não se promete que todo cliente mostre prompts ou siga as `instructions`; o que foi visto em cada cliente fica
  registrado (Claude Desktop: não verificado até conferência real).
- O passo do roteiro é "separar pelo enquadramento no art. 927" (ADR-0007): "não classificado" quer dizer que os
  dados não provam inciso — nunca fraco, persuasivo ou fora do rol; não se usa "separar por força", e o rótulo da
  lista de qualificados não cria hierarquia.

## Emenda de 2026-10-09: método de leitura do acórdão

O dono aprovou em 2026-10-09 ("aprovo") o método de leitura do acórdão: o passo 8 do `pesquisar_tese` ganhou as
letras a) a h) (certidão, relatório, admissibilidade, ratio, votos, tese e modulação, dispositivo, o que veio depois),
ligadas às ferramentas que existem, e as `instructions` ganharam uma frase no fim, para quem não abre o prompt. É a
única mudança no texto aprovado das `instructions`; o teste de igualdade exata foi atualizado junto. O exemplo do dono
que citava súmula com número virou "por óbice ao reexame de fatos e provas", pela regra deste ADR.

Ajustes de exatidão depois da revisão (2026-10-09), feitos sem o dono e pendentes da conferência dele: corrigem
promessas sobre ferramentas que vieram da adaptação do agente, não do método do dono. Na letra e, o conferir_citacao
só informa a seção no PDF quando reconhece o título; no texto integral de TRT ou sem seção identificada, a atribuição
se confere pelo contexto da leitura, senão "não verificado". Na letra h, o obter_ementa só dá a ementa dos embargos;
o acórdão deles se lê pelo obter_inteiro_teor e ler_inteiro_teor, nos limites do passo 7, senão "não verificado".

## Emenda de 2026-10-13: frase de privacidade (D-14 / G-85)

O dono, por delegação ao Sol (decisão D-14, 2026-10-13), aprovou a frase literal "formule a busca com a tese em
abstrato, sem nome de parte nem dado do caso". Ela entrou nas `instructions` (depois da frase da conferência de
citação) e no passo 1 do `pesquisar_tese`, em revisão mínima própria: nenhuma outra alteração do texto congelado,
e as demais mudanças do roteiro continuam reservadas à revisão única de D-15. O teste de igualdade das
`instructions` e um teste de substring exata (nas duas peças) foram atualizados no mesmo conjunto; os padrões de
afirmação de jurisprudência seguem passando. É orientação ao cliente de IA, não garantia técnica de anonimização.

## Emenda de 2026-10-14: formulações pelo assunto ou fato (D-15 / G-66, forma fraca)

Pela rodada D-15 de 2026-10-14 (`docs/banco-de-provas/rodada-d15-roteiro-2026-10-14.md`), o passo 1 do `pesquisar_tese`
ganhou a frase literal "Inclua formulações que descrevam o assunto ou o fato (o instituto e a situação), e não só a
conclusão que se quer ver confirmada.", entre a lista de exemplos e o "Não invente…". Só a forma fraca da G-66 foi
aplicada: a frase acrescenta, não proíbe nada (a forma forte, "nunca pela conclusão", não passou). Base: a união das
formulações de assunto e de conclusão achou mais relevantes que qualquer uma sozinha em 6 de 10 pares. Amostra
declarada: 5 teses, 1 tribunal cada, gabarito provisório; a rodada não prova precisão nem melhora jurídica. Nenhuma
outra alteração do texto congelado; as `instructions` não mudam. Além da substring exata da frase e dos padrões de
afirmação de jurisprudência, o teste compara o roteiro inteiro com a cópia independente congelada em
`tests/fixtures/roteiro-d15-aprovado.txt` (substituída pela cópia da revisão única, abaixo); texto integral para leitura humana em
`TICKETS/b20-onda-2/15-roteiro-texto-integral.md`.

## Emenda de 2026-10-14: revisão única (D-15 + entrega de súmulas, sugestões 1, 2, 4 e 5)

O dono aprovou em 2026-10-14 as sugestões 5, 1, 2 e 4 de `TICKETS/b20-onda-2/entrega-sumulas-jurisprudencia.md`,
aplicadas junto com a frase D-15 numa revisão única do roteiro (um conjunto: `src/roteiro.ts`, este ADR, os testes de
padrões e de igualdade, e o texto integral para leitura humana em `TICKETS/b20-onda-2/15-roteiro-texto-integral.md`):

- **Sugestão 5** — o passo 1 mantém a frase D-15 e manda mostrar ao usuário a questão central e as formulações usadas,
  antes dos resultados. Não muda a busca.
- **Sugestão 2** — novo passo 11: desgaste em três caixas, nesta ordem: "A fonte indica" (situação na fonte ou marca
  da súmula na lista do STF, literal, com data e origem); "Indício" (algo no material devolvido que sugira mudança,
  sempre com o id e o trecho de onde saiu e a frase "não prova superação"); "Não verificado — conferir no portal
  oficial" (todo o resto). "vigente" e "superado(a)" só dentro de citação literal da fonte.
- **Sugestão 4** — novo passo 12: matriz curta (tribunal, órgão, data, entendimento, fundamento, resultado) e "Onde a
  pesquisa está fraca" tirado só do `cabecalhoDeCobertura` (formulações sem acórdão, tribunais com erro ou não
  pesquisados, lista cortada, buscas da memória com a data da mais antiga) e do aviso da própria `busca_ampla` sobre os
  poucos acórdãos do STF; `panorama_da_amostra` opcional, como amostra, não estatística.
- **Sugestão 1** — bloco "Pergunta por súmula ou tema", depois dos passos numerados, com ordem fixa S1) a S5): texto
  da fonte e de onde veio (súmula do STJ, que o `consultar_precedente` não traz: "texto da lista do site, não
  conferido em fonte oficial"); situação ou marca literal e datada, ou "não verificado"; `enquadramento927` com o
  âmbito; aplicação pelos tribunais com formulações do assunto (menção não é aplicação); desgaste nas três caixas.

As `instructions` ganham uma frase-ponteiro no fim, para clientes que não abrem o prompt: "Pergunta por súmula ou tema:
texto e situação só como o consultar_precedente os devolver, com data e origem; súmula do STJ na lista da busca_ampla:
"texto da lista do site, não conferido em fonte oficial". "vigente" e "superado" só em citação literal da fonte."
O teste de igualdade exata foi atualizado junto. O texto novo segue este ADR: sem número de súmula,
tema, precedente ou processo, sem "entende(m) que", exemplos só abstratos; testes novos travam a ordem do bloco de
súmula, as três caixas, "vigente"/"superado" fora de aspas e a ausência de número. A cópia independente congelada
passou a `tests/fixtures/roteiro-aprovado.txt`. Checagem sem rede sobre respostas gravadas em
`docs/banco-de-provas/checagem-roteiro-sumulas-2026-10-14.md` (checagem, não medição estatística). As sugestões 3
(ficha por precedente) e 6 (procurar o contrário) ficam fora desta revisão.

Lido e aprovado pelo dono em 2026-10-14.

### Correções da revisão adversarial (D-15, 2026-10-14)

- A frase das `instructions` admite a mesma exceção do S1 para súmula do STJ na lista do site, com a ressalva literal;
  antes, restringia o texto ao `consultar_precedente`, que não aceita esse tipo no STJ.
- A conferência literal pelo `conferir_citacao` fica limitada a citação de acórdão (passo 9 e `instructions`): a ferramenta
  não recebe enunciado nem tese de precedente. S1 e S2 continuam exigindo cópia literal do que a fonte devolveu.
- A letra h limita a ressalva de trânsito e superação ao acompanhamento pelo `julgamentos_do_processo`; não nega a
  situação processual literal que o `consultar_precedente` devolve.
- O passo 11 explicita que não encontrar indício não prova que nada mudou; o passo 12 limita a comparação aos acórdãos
  lidos, sem prova de consenso ou ausência de divergência, e identifica `avisos` como origem da ressalva do STF.

Testes de igualdade e das ressalvas atualizados no mesmo conjunto. São travas de texto, não prova de que uma IA siga
as instruções; a leitura semântica continua necessária.

## Emenda de 2026-10-23: roteiro 1.2 (B1.1) — ratificada pelo Codex Sol (D12), com ajustes

Plano 1.2, bloco B1.1 (U03, U12, U13, U15, U16, U24). Os números são os de D11, aprovados pelo dono em 2026-10-23.
As frases novas, propostas pelo executor, foram **ratificadas pelo Codex Sol em 2026-10-23** (D12: o Sol decide a
redação; revisão em `TICKETS/plano-1.2/revisao-b1.1.md`), com ajustes na regra dos TRTs e na 2ª rodada (abaixo). O dono
pode vetar e lê o texto integral antes de publicar; a ratificação não comprova essa leitura. Situação:
**implementado, não medido**. A medição (banco de provas, amostra de distinção com agente, 2ª rodada, custo e tempo
até a matriz) depende de rede e do júri (B0.2, B4.1).

- **Novo prompt `distinguir_precedente`** (argumentos `precedente`, obrigatório, e `fatos`, opcional, ambos texto).
  Não há ferramenta nova, pela mesma razão da decisão original. O prompt pede uma ficha do acórdão: identificação e
  origem do texto lido; depois certidão, quadro fático, admissibilidade, tese literal, ratio como leitura do agente,
  dispositivo, votos, o que veio depois e o `enquadramento927` como a ferramenta o devolveu. Pede também uma matriz
  fato a fato, em quatro estados, cada um provado pelo material lido. "Presente" e "diferente" exigem trecho e posição,
  e "diferente" só vale com o fato **contrário** reconhecido: a falta do fato nunca basta. "Não informado" exige a
  leitura integral das partes pertinentes. "Não localizado" é a leitura que não alcançou o fato. Alegação de parte e
  voto vencido não são fato reconhecido, e fato que o acórdão nega não é "presente". O texto traz a regra "a
  ferramenta não decide se o caso é diferente nem se o precedente caiu". Os fatos do caso não vão aos portais (a frase
  de privacidade de D-14 vem literal), o desgaste usa as três caixas do passo 11, e "vincula" e "só convence" aparecem
  só como palavras proibidas, entre aspas (AC-A03).
- **`pesquisar_tese`**: o texto aprovado não muda uma vírgula; só ganha acréscimos.
  - Linha de orçamento antes do passo 1, como orientação, não trava: até 8 formulações por tese, somando as rodadas;
    uma `busca_ampla` por rodada e, com TRT, no máximo uma repetição; até 10 ementas e até 3 inteiros teores. Gasta
    orçamento a busca que foi ao site, a ementa e o inteiro teor obtidos, e uma operação pode custar mais de uma
    chamada ao site.
  - No passo 1, sempre ao menos uma formulação contrária ou de exceção, em 2º lugar (U16, DV15).
  - Logo abaixo do passo 2, a regra dos TRTs. Cada formulação em cada TRT gasta uma página do Falcão; com até 2 TRTs,
    a contrária vai em 2º lugar e, com 3 ou mais, em 1º. Para executar o `foraDoTeto`, uma repetição no máximo, na
    pesquisa inteira, e só com a memória ligada e legível, buscas guardadas válidas e sem `renovar`. Com `renovar`,
    memória desligada ou sem busca válida guardada, o agente avisa o custo e não repete; se a memória falhar na
    repetição, não repete de novo. Em todo caso, diz onde a busca do contrário ficou incompleta.
  - Logo abaixo do passo 4, a 2ª rodada: uma só e só com o gatilho de D11 (menos de 5 das ementas lidas servindo à
    tese). Usa termos técnicos copiados das ementas devolvidas, cada um com o id de origem, e a união das formulações
    numa só chamada, com as antigas na mesma ordem e grafia e os mesmos parâmetros. As antigas **podem** voltar da
    memória (sem `renovar`, com busca válida guardada, menos de 24 h); senão vão ao site e gastam orçamento, e o agente
    confere as guardadas no `cabecalhoDeCobertura`. O teto de 10 ementas obtidas soma as rodadas.
  - No passo 5, o agente diz se a contrária rodou em cada tribunal; busca sem acórdão contrário não prova que ele não
    exista.

  A numeração dos passos não mudou.
- **`instructions`**: duas frases no fim, para quem não abre os prompts. Uma aponta o `distinguir_precedente`, com as
  três regras críticas; a outra é a orientação anti-injeção (DV12, AC-A11, AC-A29). As duas ampliam o alcance da
  **orientação**, não são trava (Consequências, acima).

Testes no mesmo conjunto:

- igualdade exata das `instructions`;
- cópias independentes congeladas dos dois roteiros: `tests/fixtures/roteiro-aprovado.txt`, atualizada, e
  `tests/fixtures/distinguir-precedente-aprovado.txt`;
- travas de frase das regras novas, que rejeitam remoção, troca e inversão;
- padrões de afirmação de jurisprudência e "vincula" fora de aspas, em todos os textos.

Do lado do servidor, sem rede:

- as cinco fixtures de injeção do B0.2 (`tests/fixtures/banco-de-provas-1.2/injecao.json`) chegam pelo fetch falso;
  a resposta só muda no texto copiado da fonte, com as mesmas chamadas e o mesmo link, e o trecho oculto do HTML fica,
  com aviso;
- na união da 2ª rodada com memória fria (`GARIMPO_SEM_MEMORIA=1`), falha de leitura, busca guardada vencida (24 h)
  ou `renovar`, as formulações antigas vão ao site e o cabeçalho as conta como feitas, não como guardadas;
- com 5 TRTs e 2 formulações, a contrária fica `foraDoTeto`; a repetição a executa com a memória valendo, e refaz as
  páginas da tese com `renovar`, sem memória, com as buscas vencidas ou com falha ao ler a memória.

Isso prova o que o servidor envia e faz, não que a IA do usuário siga o roteiro. Texto integral para leitura humana:
`TICKETS/plano-1.2/b1.1-roteiro-texto-integral.md`.

### Correções da revisão adversarial (B1.1, 2026-10-23)

- **E1** — a 2ª rodada dizia que as antigas "voltam da memória", sem ressalvar `renovar` nem a busca válida guardada.
  Agora "podem voltar", com as condições, o custo quando não voltam e a conferência no `cabecalhoDeCobertura`.
- **E2** — com `renovar` ou sem memória, a regra dos TRTs mandava avisar o custo **antes de repetir**: permitia uma
  repetição que só refaz as páginas já feitas, sem executar a contrária. Agora a repetição exige a memória valendo e
  sem `renovar`; nos outros casos, o agente avisa o custo e não repete.
- **Clareza** — o teto da 2ª rodada passou de "10 ementas apresentadas" a "10 ementas obtidas, somando as rodadas",
  sem zerar a contagem ao mudar de rodada.

Travas no mesmo conjunto: as frases ratificadas, e o texto anterior de cada correção reprovado pela trava; do lado do
servidor, as condições que o texto nomeia (busca vencida e falha de leitura, acima). A ajuda comum para montar o
cliente MCP nos testes, sugerida como opcional, não foi feita: montar no próprio arquivo é o padrão do projeto (25
arquivos de teste), a única ajuda comum exige o cliente do Falcão, e uma terceira forma só para estes arquivos não
tiraria a repetição do resto.

## Emenda de 2026-10-23: abertura das instructions (decisões públicas e freios)

O dono aprovou trocar a 1ª frase das `instructions` (R1 de `TICKETS/plano-1.2/redacao-sem-falso-alarme.md`). A
frase antiga não dizia que o objeto é decisão judicial pública nem que há freios, e um assistente cauteloso podia ler
"baixa PDF de base não oficial" como coleta duvidosa. Texto novo da abertura, literal: "O Garimpo é ferramenta de
pesquisa jurídica: busca decisões judiciais públicas (jurisprudência) em base não oficial e baixa o inteiro teor
oficial que os próprios tribunais publicam, quando disponível; toda chamada passa por um cliente único com freios (no
máximo 2 chamadas simultâneas, espera e uma única nova tentativa em 429/503, parada e aviso em recusa). Use
busca_ampla…". O resto das `instructions` não muda uma vírgula, inclusive as frases do B1.1. Os freios citados são os
da regra 3 do `CLAUDE.md`, e o código não muda. O teste de igualdade foi atualizado no mesmo conjunto.
