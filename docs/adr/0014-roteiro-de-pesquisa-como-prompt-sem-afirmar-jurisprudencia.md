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
