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
