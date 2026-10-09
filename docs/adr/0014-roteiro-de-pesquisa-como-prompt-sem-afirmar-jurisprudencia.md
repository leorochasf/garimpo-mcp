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
