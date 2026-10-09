# Teste lado a lado: Garimpo × jurisprudenciaia-mcp (2026-10-08)

Conclusão genérica do primeiro teste com as duas ferramentas rodando de verdade. **Medição provisória, sujeita à
revisão do dono:** a precisão depende de acórdãos ainda sem marca. Plano (gravado antes da primeira chamada),
scripts, respostas brutas, relatório completo e a lista para revisão ficam fora do git, em
`banco-de-provas-resultados/vs-bruno/`.

**Como:** Garimpo do commit `0999677` × o jurisprudenciaia-mcp de terceiros, usado como caixa-preta, só pela
interface MCP (o código dele não foi aberto, regra 1). As 11 teses do banco de provas (7 da rodada 1 + 4 de
controle), com as mesmas formulações e tribunais: no Garimpo, uma `busca_ampla` por tese; no outro, uma
`buscar_precedentes` por formulação, com o mesmo recorte de tribunal (3 chamadas por tese). Tudo em série, uma
chamada por vez, nunca as duas ferramentas juntas, quem ia primeiro alternando por tese. Tempo de parede medido por
script, sem o tempo do modelo. Gabarito do ticket 10 + marcas do dono do B5, **sem nenhuma marcação nova por IA**;
acórdão sem marca sai em dois limites, pessimista (não relevante) e otimista (relevante). Nenhuma recusa, cota ou
aviso de custo em nenhum lado. Pasta de dados temporária; a pasta real do Garimpo ficou igual.

## Resultados (média das 11 teses; pessimista | otimista)

| Eixo | Garimpo | jurisprudenciaia-mcp | Quem ganha |
|---|---|---|---|
| Velocidade por tese (média / mediana) | 9,0 s / 8,7 s | 48,9 s / 47,5 s (3 chamadas) | Garimpo, em 11 de 11 teses |
| Uma chamada só | 9,0 s (a tese inteira) | 16,3 s (de 11 a 22 s) | Garimpo |
| Acórdãos entregues por tese | 50 | 26,2 | Garimpo |
| Cobertura (7 teses da rodada 1) | 42,5% \| 46,7% | 16,4% \| 21,4% | Garimpo, nos dois limites, em 7 de 7 |
| Precisão nos 10 | 96,4% \| 97,3% | 64,3% \| 100% | inconclusivo |
| Precisão nos 50 (ou na lista inteira) | 85,5% \| 96,4% | 58,6% \| 98,3% | inconclusivo |
| Irrelevantes entre os marcados | 4,1% | 3,8% | empate prático |
| Ementa contra o PDF oficial (amostra 5 + 5) | corpo literal em 5 de 5 | corpo literal em 5 de 5 | empate |
| Texto gerado por IA na resposta | nenhum | em todas as respostas | Garimpo |
| Órgão julgador em campo próprio | 75% | sem campo (só dentro da ementa) | Garimpo |
| Link oficial | 86% | 78% | Garimpo, por pouco |
| Inteiro teor oficial (STJ, TJMG, TSE) | 3 de 3 PDFs, de 0,3 a 2,2 s | 0 de 3 ("não informado pela fonte"; só o link) | Garimpo |

- **Velocidade:** a busca ampla inteira do Garimpo (12 buscas ao site em média) sai antes de uma única chamada do
  outro. Mesmo quem fizer uma chamada só no outro espera ~16 s por ~9 acórdãos.
- **Cobertura:** o Garimpo entrega mais relevantes em todas as teses medidas, em parte por entregar mais acórdãos.
  O outro trouxe 67 relevantes marcados que não estavam nos 50 primeiros do Garimpo — sinal de que vale olhar o corte
  de 50 e a ordem, não de que a busca do Garimpo não os acha (isso não foi medido).
- **Precisão:** fica em aberto. Entre os acórdãos marcados, as duas erram na mesma proporção; mas 45% da lista do
  outro não tem marca (11% no Garimpo), e o gabarito nasceu das listas das rodadas anteriores. A faixa só fecha com a
  marcação do dono (181 acórdãos na lista de revisão, sem pré-marcação).
- **Entrega:** as duas repassam a mesma ementa da base, sem reescrever; nos dois casos o que não bate com o PDF
  oficial é só a linha de referência que a base acrescenta no fim e o cabeçalho/rodapé de página que o PDF intercala.
  O outro mistura em toda resposta um texto gerado pela IA do site (tese principal, cautelas); numa das execuções esse
  texto chamou de "futura" uma data de julgamento já passada, erro que não se repetiu na execução seguinte.

## Limites

- Uma rodada só, num horário só; variação de rede e do site não foi medida.
- O pedido ao outro foi de 3 chamadas por tese para fazer a mesma pergunta; a ferramenta dele sem recorte de tribunal
  não foi medida. No uso pelo assistente, cada chamada soma o tempo do modelo, o que pesa mais em 3 chamadas do que
  em 1.
- Precisão do Garimpo com dados de hoje (85,5% | 96,4% nos 50) é mais larga que na gravação do B5 porque entraram
  acórdãos novos, ainda sem marca.
- Um erro de leitura das respostas do outro (o primeiro precedente de cada chamada ficava de fora) foi achado e
  corrigido antes da conclusão; os números acima são da versão corrigida.
