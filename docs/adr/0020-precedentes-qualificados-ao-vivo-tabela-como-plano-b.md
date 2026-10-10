# Precedentes qualificados ao vivo, tabela como plano B

_Decidido pelo dono em 2026-10-09._

Nas palavras do dono: "eu nao quero algo que fique desatualizado, pense diferente"; e, escolhendo entre as opções,
"(A) Consulta ao vivo, na hora da pergunta".

O `consultar_precedente` passa a buscar o precedente qualificado **no portal do tribunal, na hora da pergunta, do
computador do usuário**: tema repetitivo e IAC na página de precedentes do STJ; repercussão geral, súmula e súmula
vinculante no portal do STF. A resposta diz "consultado no portal do <tribunal> em <data e hora>". O resultado fica
na memória do Garimpo por 24 h (todas as janelas), como as outras consultas. A **tabela de precedentes** empacotada
(ADR-0015) vira o **plano B**: só é usada quando o portal recusa, está fora, demora demais, está pausado pelo
disjuntor ou devolve uma página que o Garimpo não reconhece; nesse caso a resposta diz "tabela de <data>, o portal
não respondeu" e o motivo.

O dono autorizou o Garimpo a se apresentar com User-Agent de navegador no STF (decisão (c) do ADR-0015, antes
pendente), porque o STF recusa (403) quem se identifica como o Garimpo — prova de 2026-10-09,
[`precedentes-ao-vivo-prova.md`](../banco-de-provas/precedentes-ao-vivo-prova.md). O STJ aceita a identificação
honesta e continua com ela. Tudo passa pelo cliente único, com os freios da regra 3 (no máximo 2 chamadas
simultâneas no total, 429/503 com espera e uma nova tentativa, recusa final abre o disjuntor) e com **serviço
próprio no disjuntor**: `stj-precedentes` e `stf-precedentes`. Uma recusa na página de precedentes não pausa o resto
do tribunal, e vice-versa.

**Chamadas por pergunta** (teto, sem contar a memória): STJ 1; STF repercussão geral 2 (a ficha do tema, que traz a
situação e o endereço da página com a tese; e essa página); STF súmula e súmula vinculante 2 (a lista do tipo, que
traz o código interno da página e a marca de situação; e a página com o enunciado), 1 enquanto a lista estiver na
memória. Ou seja, **no máximo 2**.

**Listas de qualificados das buscas continuam pela tabela.** Uma busca direta do STF pode trazer até 15
qualificados (5 de cada tipo), e a ampla mais; conferir cada um ao vivo seria até ~30 chamadas extras por busca, num
portal que já recusa programas, e deixaria a busca lenta. A tabela ali é reforço, com a data dela; para o dado do
dia, o usuário (ou a IA) chama o `consultar_precedente` para o precedente que importa.

A leitura confere o tipo e o número no corpo da página antes de aceitar: o STJ, com código de tipo errado, devolve
outro tipo sem erro. Página sem o precedente pedido, ou sem os rótulos esperados, não é "não existe": é plano B.

## Opções consideradas

- (B) Atualizar a tabela no computador do usuário de tempos em tempos: rejeitada pelo dono; ainda fica desatualizada
  entre uma atualização e outra.
- Só a tabela, com versões mais frequentes do pacote (ADR-0015): rejeitada pelo dono pelo mesmo motivo.
- Listas de qualificados também ao vivo: rejeitada agora pelo número de chamadas (acima); pode voltar com teto
  próprio por busca, por decisão registrada.
- Sem plano B (erro quando o portal não responde): rejeitada; a tabela datada ainda responde, dizendo a data.

## Consequências

- A tabela continua sendo gerada e empacotada (ADR-0015), com as mesmas datas e avisos, agora como plano B.
- `consultar_precedente` deixa de ser só leitura local: usa rede (`openWorldHint` verdadeiro).
- Mudança de layout dos portais leva ao plano B (nunca a dado inventado); o teste ao vivo atrás de `GARIMPO_VIVO=1`
  mostra quando isso acontecer.
