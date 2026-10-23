# Velocidade: versão 1.1.0 × 1.1.1 (2026-10-22)

Pergunta: o que entrou depois da 1.1.0 (inteiro teor do TJGO pelo Projudi, leitura dos `.p7s`, rótulo do TJPI)
deixou o Garimpo mais lento?

**Resposta: não. Em todas as operações medidas, com 1 e com 2 janelas, a diferença ficou dentro do ruído ("igual"),
nas duas rodadas.**

## Método

O mesmo de [`velocidade-0.5.0-x-1.0.md`](velocidade-0.5.0-x-1.0.md), sem rede: `7b5b3af` (1.1.0, worktree
`garimpo-mcp-wt/vel-110`) × main a caminho da 1.1.1 (`05fc876`), cada um compilado e chamado por MCP no stdio, com o
fetch trocado por respostas gravadas. Mesma bateria (início do servidor, busca simples fria e repetida, busca ampla
5 × 3 fria e repetida, Falcão, PDF já baixado), 1 e 2 janelas, N = 30 por versão e por número de janelas, duas
rodadas. "Piorou"/"melhorou" só com |z| ≥ 2,58 e diferença ≥ 5 % e ≥ 2 ms na mediana. As mudanças da 1.1.1 ficam no
`obter_inteiro_teor` do TJGO, que a bateria não chama (precisaria da rede do Projudi); o que a bateria mede é o resto
do Garimpo, que não pode ter piorado por elas. Ferramentas no `tools/list`: 16 nas duas versões.

CPU ocupada (antes / depois de cada rodada): rodada 1, 89 % / 41 %; rodada 2, 48 % / 54 %.

## Resultado (mediana, ms; diferença = 1.1.1 − 1.1.0)

| Operação | Jan. | R1 1.1.0 | R1 1.1.1 | R1 diferença | R2 1.1.0 | R2 1.1.1 | R2 diferença | Resultado |
|---|---|---|---|---|---|---|---|---|
| (e) início até tools/list | 1 | 669 | 635 | −34 (−5,1 %) | 633 | 620 | −12 (−2,0 %) | igual |
| (e) início até tools/list | 2 | 702 | 698 | −4 (−0,6 %) | 710 | 712 | +2 (+0,3 %) | igual |
| (a) busca simples, fria | 1 | 36 | 36 | +0 | 37 | 35 | −2 | igual |
| (a) busca simples, fria | 2 | 73 | 67 | −6 | 55 | 50 | −6 | igual |
| (a) busca simples, repetida | 1 | 4 | 3 | −0 | 3 | 3 | +0 | igual |
| (a) busca simples, repetida | 2 | 4 | 4 | +0 | 4 | 4 | −0 | igual |
| (b) busca ampla, fria | 1 | 183 | 177 | −5 (−2,9 %) | 181 | 176 | −5 (−2,8 %) | igual |
| (b) busca ampla, fria | 2 | 311 | 326 | +16 (+5,1 %) | 517 | 301 | −216 (−41,8 %) | igual |
| (b) busca ampla, repetida | 1 | 48 | 47 | −1 | 43 | 46 | +3 | igual |
| (b) busca ampla, repetida | 2 | 48 | 45 | −4 | 49 | 48 | −1 | igual |
| (c) Falcão (TRT) | 1 | 174 | 181 | +6 (+3,7 %) | 182 | 170 | −13 (−6,9 %) | igual |
| (c) Falcão (TRT) | 2 | 362 | 921 | +559 (+154,5 %) | 927 | 345 | −581 (−62,7 %) | igual |
| (d) PDF já baixado, parte 1 | 1 | 313 | 320 | +7 (+2,2 %) | 315 | 304 | −11 (−3,5 %) | igual |
| (d) PDF já baixado, parte 1 | 2 | 607 | 624 | +16 (+2,7 %) | 657 | 620 | −38 (−5,7 %) | igual |

Maior |z|: 1,4 nas duas rodadas, abaixo de 2,58. Chamadas ao site falso iguais nas duas versões. O Falcão com 2
janelas trocou de sinal entre as rodadas (+155 % e −63 %): é o freio de 1 s entre chamadas ao mesmo site, que faz
uma janela esperar a outra por acaso, igual nas duas versões, como na medição da 1.0.

Tempos crus (fora do git): `banco-de-provas-resultados/velocidade/2026-10-23T00-24-08-607Z.json` (rodada 1) e
`…T00-31-41-971Z.json` (rodada 2).
