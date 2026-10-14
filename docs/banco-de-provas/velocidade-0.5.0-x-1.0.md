# Velocidade: versão 0.5.0 × main a caminho da 1.0 (2026-10-14)

Pergunta: o que entrou depois da 0.5.0 (b16 a b18: DJEN, TJDFT, TJMS, TJRR, TJPI, precedentes dos TRTs, freio
preventivo, linha de chamado, ajustes de disco do ticket 16 etc.) deixou o Garimpo mais lento?

**Resposta: não. Em todas as operações medidas, com 1 e com 2 janelas, a diferença ficou dentro do ruído ("igual"),
nas duas rodadas.** Nenhuma operação piorou nem melhorou de forma que se possa distinguir da variação normal da máquina.
A [rodada final](#rodada-final-10-completa), com a 1.0 completa (16 ferramentas), confirmou: igual em tudo; só o início
do servidor mostra tendência de ≈ +0,1 s, ainda dentro do ruído.

## Método

- **Versões:** `bc3e0f5` (0.5.0, worktree `garimpo-mcp-wt/vel-050`) × `3977d10` (main de 2026-10-14, ramo
  `vel-medicao`). Mesma máquina (Windows, 16 threads, Node 22.16), mesmo script, versões alternadas a cada rodada para a
  carga da máquina pesar igual nas duas.
- **Como o Claude chama:** cada versão é compilada (`tsc`) e o `dist/index.js` sobe como processo próprio, conversando
  por MCP no stdio. Pasta de dados temporária nova a cada rodada (memória vazia, freios zerados).
- **Sem rede:** antes do servidor, `scripts/velocidadeFetchFalso.mjs` troca o fetch por respostas gravadas devolvidas na
  hora e proíbe o DNS. O tempo medido é só o do Garimpo: processamento, disco, vagas e freios entre janelas, memória.
  Respostas: o recorte do banco de provas (`tests/fixtures/banco-de-provas/`, teses 1 e 10) para o JurisprudênciaIA e a
  fixture do Falcão (`falcao-pv13.json`, 10 acórdãos). Nenhuma chamada caiu fora do gravado, nenhuma ferramenta deu erro.
- **Bateria, por rodada:** (e) início do servidor até a lista de ferramentas; (a) busca simples no STJ, limite 10, fria
  e repetida (a repetida vem da memória); (b) busca ampla, 5 tribunais × 3 formulações (15 buscas), fria e repetida;
  (c) busca no Falcão (TRT3, limite 10); (d) parte 1 de um PDF já baixado (20 páginas, sintético).
- **1 e 2 janelas:** com 2, dois processos do Garimpo na mesma pasta de dados rodam a bateria ao mesmo tempo (a 2ª com
  outra tese e outro texto no Falcão); o tempo anotado é o da 1ª janela, que faz o mesmo trabalho da rodada com 1.
- **N = 30** por versão e por número de janelas, em duas rodadas completas.
- **Ruído:** "piorou"/"melhorou" só se a diferença for estatística (teste de Mann-Whitney, |z| ≥ 2,58, p < 0,01) **e**
  relevante (≥ 5 % e ≥ 2 ms na mediana). Fora disso, "igual".
- **Carga da máquina:** alta e fora do meu controle — outros panes rodando (processos node passageiros, um `find` no
  disco todo, OCR, indexador do Windows). CPU ocupada medida pelo script: rodada 1, 100 % antes e 50 % depois; rodada 2,
  60 % antes e 83 % depois. Por isso os piores casos (até 3 s) e a variação com 2 janelas são grandes; a alternância das
  versões reparte essa carga.

## Resultado (mediana / pior caso, ms)

Rodada 1 (13:25) e rodada 2 (13:34). Diferença = depois − antes, na mediana.

| Operação | Jan. | R1 0.5.0 | R1 main | R1 diferença | R2 0.5.0 | R2 main | R2 diferença | Resultado |
|---|---|---|---|---|---|---|---|---|
| (e) início até tools/list | 1 | 803 / 1609 | 828 / 1954 | +26 (+3,2 %) | 699 / 1583 | 729 / 1363 | +31 (+4,4 %) | igual |
| (e) início até tools/list | 2 | 859 / 1834 | 865 / 1603 | +6 (+0,7 %) | 748 / 1513 | 756 / 1261 | +9 (+1,1 %) | igual |
| (a) busca simples, fria | 1 | 43 / 237 | 44 / 304 | +0 (+1,1 %) | 36 / 183 | 40 / 66 | +3 (+9,5 %) | igual |
| (a) busca simples, fria | 2 | 80 / 1467 | 74 / 632 | −6 (−7,3 %) | 72 / 111 | 73 / 459 | +1 (+0,7 %) | igual |
| (a) busca simples, repetida | 1 | 4 / 31 | 4 / 17 | −0 | 4 / 44 | 4 / 8 | +0 | igual |
| (a) busca simples, repetida | 2 | 4 / 47 | 4 / 18 | −0 | 4 / 18 | 4 / 36 | +0 | igual |
| (b) busca ampla, fria | 1 | 223 / 872 | 257 / 644 | +34 (+15,4 %) | 189 / 456 | 205 / 436 | +16 (+8,3 %) | igual |
| (b) busca ampla, fria | 2 | 606 / 3135 | 358 / 1153 | −248 (−40,9 %) | 351 / 1389 | 458 / 1071 | +107 (+30,6 %) | igual |
| (b) busca ampla, repetida | 1 | 55 / 158 | 60 / 110 | +6 (+10,1 %) | 49 / 95 | 50 / 77 | +1 (+2,0 %) | igual |
| (b) busca ampla, repetida | 2 | 58 / 170 | 58 / 244 | −0 (−0,8 %) | 49 / 87 | 58 / 92 | +10 (+19,6 %) | igual |
| (c) Falcão (TRT) | 1 | 227 / 756 | 215 / 738 | −13 (−5,6 %) | 197 / 400 | 220 / 357 | +23 (+11,9 %) | igual |
| (c) Falcão (TRT) | 2 | 929 / 1274 | 328 / 1651 | −601 (−64,7 %) | 535 / 1911 | 845 / 1977 | +310 (+57,9 %) | igual |
| (d) PDF já baixado, parte 1 | 1 | 378 / 820 | 364 / 885 | −14 (−3,6 %) | 338 / 536 | 365 / 594 | +27 (+7,9 %) | igual |
| (d) PDF já baixado, parte 1 | 2 | 703 / 881 | 674 / 856 | −29 (−4,2 %) | 643 / 864 | 646 / 849 | +3 (+0,5 %) | igual |

Chamadas ao site falso por operação, iguais nas duas versões: (a) fria 1, (b) fria 15, (c) 1; as repetidas e a leitura
do PDF, 0. Maior |z| nas duas rodadas: 1,8 (longe de 2,58). Todas as operações existem na 0.5.0; nenhuma ficou
"não existe na 0.5.0".

Tempos crus (fora do git): `banco-de-provas-resultados/velocidade/2026-10-14T13-25-08-380Z.json` e
`…T13-34-31-510Z.json`.

## Leitura em linguagem simples

- **Igual em tudo.** A versão nova faz o mesmo trabalho (mesmas chamadas) no mesmo tempo que a 0.5.0.
- **As diferenças grandes com 2 janelas são ruído, não mudança:** a busca ampla e o Falcão com 2 janelas trocam de
  sinal de uma rodada para a outra (−41 % e depois +31 %; −65 % e depois +58 %). No Falcão, quase todo o tempo com 2
  janelas é o freio de 1 s entre chamadas ao mesmo site, que vale para as duas janelas juntas: quando as duas chegam ao
  Falcão no mesmo instante, uma espera — e isso acontece ou não por acaso. É o freio da regra 3 funcionando, igual
  nas duas versões.
- **O que observar na próxima medição:** o início do servidor saiu 3–4 % mais lento nas duas rodadas (≈ 30 ms em
  ≈ 0,7–0,8 s), sem significância (z ≤ 0,7). Pode ser a carga de mais código/dados no início; vale conferir se a
  tendência cresce quando entrarem TRF4, TCU, legislação e TRTs na busca ampla.
- **Onde o tempo está, nas duas versões:** início do servidor (~0,7–0,8 s), leitura do PDF (~0,35 s por parte 1) e
  busca ampla fria (~0,2 s de trabalho próprio para 15 buscas). A memória responde a busca repetida em 4 ms (simples)
  e ~50 ms (ampla).

## Rodada final (1.0 completa)

Mesma medição, agora contra o main completo da 1.0: `d387c34` (ramo `vel-medicao` com o main mesclado — TRF4, TCU,
legislação, TRTs na busca ampla, monocráticas do Falcão) × `bc3e0f5` (0.5.0). Mesmo comando, mesmo método, N = 30 por
versão e por número de janelas, duas rodadas completas. O script passou a anotar quantas ferramentas cada versão lista
no início: **0.5.0 com 10, 1.0 com 16** (em todas as 120 aberturas de cada rodada). A busca ampla medida continua nos 5
tribunais do recorte (STF, STJ, TJSP, TJMG, TJRS), para comparar a mesma coisa nas duas versões; as fontes novas não
entram nela.

CPU ocupada (medida pelo script, antes / depois de cada rodada): rodada 1, 89 % / 90 %; rodada 2, 98 % / 79 %. Máquina
bem carregada nas duas — por isso os tempos absolutos saíram maiores que os das rodadas da manhã (início ≈ 1 s, antes
≈ 0,7–0,8 s), igualmente para as duas versões.

Mediana / pior caso, ms. Diferença = 1.0 − 0.5.0, na mediana.

| Operação | Jan. | R1 0.5.0 | R1 1.0 | R1 diferença | R2 0.5.0 | R2 1.0 | R2 diferença | Resultado |
|---|---|---|---|---|---|---|---|---|
| (e) início até tools/list | 1 | 1147 / 1879 | 1106 / 2043 | −41 (−3,6 %) | 925 / 1458 | 1024 / 1392 | +100 (+10,8 %) | igual |
| (e) início até tools/list | 2 | 1060 / 1624 | 1124 / 2359 | +64 (+6,0 %) | 970 / 1585 | 1075 / 1765 | +105 (+10,8 %) | igual |
| (a) busca simples, fria | 1 | 70 / 398 | 63 / 764 | −7 (−9,7 %) | 57 / 281 | 57 / 376 | −0 (−0,2 %) | igual |
| (a) busca simples, fria | 2 | 79 / 569 | 102 / 560 | +23 (+29,8 %) | 80 / 595 | 80 / 359 | +0 (+0,5 %) | igual |
| (a) busca simples, repetida | 1 | 6 / 22 | 6 / 38 | −0 | 5 / 20 | 5 / 30 | +0 | igual |
| (a) busca simples, repetida | 2 | 6 / 32 | 5 / 91 | −1 | 5 / 18 | 5 / 45 | +1 | igual |
| (b) busca ampla, fria | 1 | 371 / 1561 | 286 / 2210 | −85 (−22,9 %) | 284 / 777 | 295 / 737 | +12 (+4,1 %) | igual |
| (b) busca ampla, fria | 2 | 539 / 1601 | 901 / 2207 | +362 (+67,1 %) | 633 / 1348 | 683 / 2936 | +50 (+7,9 %) | igual |
| (b) busca ampla, repetida | 1 | 55 / 97 | 70 / 173 | +15 (+27,5 %) | 61 / 91 | 68 / 181 | +7 (+11,6 %) | igual |
| (b) busca ampla, repetida | 2 | 62 / 228 | 72 / 223 | +10 (+15,9 %) | 61 / 151 | 60 / 127 | −1 (−1,7 %) | igual |
| (c) Falcão (TRT) | 1 | 321 / 605 | 299 / 788 | −22 (−6,8 %) | 314 / 1005 | 312 / 526 | −2 (−0,5 %) | igual |
| (c) Falcão (TRT) | 2 | 839 / 2812 | 796 / 2518 | −43 (−5,1 %) | 919 / 2006 | 866 / 2136 | −53 (−5,7 %) | igual |
| (d) PDF já baixado, parte 1 | 1 | 492 / 984 | 501 / 1096 | +10 (+2,0 %) | 489 / 717 | 480 / 677 | −8 (−1,7 %) | igual |
| (d) PDF já baixado, parte 1 | 2 | 838 / 1392 | 945 / 1502 | +107 (+12,7 %) | 838 / 1448 | 866 / 1494 | +28 (+3,3 %) | igual |

Chamadas ao site falso por operação, iguais nas duas versões e às das rodadas da manhã; nenhuma chamada sem resposta
gravada, nenhuma ferramenta com erro (30/30 medidas válidas em cada célula). Maior |z|: 1,89 na rodada 1 (busca ampla
repetida, 1 janela) e 1,80 na rodada 2 (a mesma) — abaixo de 2,58 nas duas.

Tempos crus (fora do git): `banco-de-provas-resultados/velocidade/2026-10-14T16-47-31-364Z.json` (rodada 1) e
`…T16-59-42-357Z.json` (rodada 2), no worktree `garimpo-mcp-wt/vel-main`.

**Em linguagem simples:**

- **Igual em tudo, pelo critério combinado.** Nenhuma operação piorou nem melhorou de forma distinguível do ruído, nas
  duas rodadas. A 1.0 faz o mesmo trabalho (mesmas chamadas) no mesmo tempo que a 0.5.0 em buscas, memória, Falcão e
  leitura de PDF.
- **Início do servidor: igual pelo critério, mas é o único ponto com sinal consistente.** Com 16 ferramentas em vez de 10,
  o início saiu mais lento em 3 das 4 comparações. Juntando as duas rodadas (60 aberturas por versão), a mediana passa
  de ≈ 0,98–1,00 s para ≈ 1,07–1,10 s: **+92 a +95 ms (≈ +9,5 %)**, com z 1,5–1,6 — ainda abaixo do limite de 2,58,
  logo não comprovado. Nas rodadas da manhã (antes de TRF4, TCU e legislação) a mesma diferença era ≈ +30 ms. Se for
  real, custa ≈ 0,1 s uma vez por janela aberta do Claude, não por busca. Vale reconferir na próxima versão; não pede
  ação agora.
- **As oscilações grandes com 2 janelas são ruído,** como nas rodadas da manhã: a busca ampla fria com 2 janelas foi
  +67 % numa rodada e +8 % na outra, e o z ficou abaixo de 1,8. O freio entre janelas no mesmo site faz uma esperar
  a outra por acaso, igual nas duas versões.

## Para medir de novo

Com o worktree da versão anterior pronto (`git worktree add ../garimpo-mcp-wt/vel-050 v0.5.0` e `npm ci` nele), na
pasta da versão nova:

```
npx vite-node scripts/medirVelocidade.ts --antes ../garimpo-mcp-wt/vel-050 --n 30
```

(Caminho de `--antes` relativo à pasta onde o comando roda; `--depois` padrão é a pasta atual.) O script compila as
duas versões, roda a bateria, imprime a tabela com o veredito e grava os tempos crus. Fonte nova na busca ampla: pôr o
tribunal em `TRIBUNAIS_DA_AMPLA` (scripts/medirVelocidade.ts) e a resposta gravada dele no fetch falso; operação que a
versão antiga não tiver sai como "não existe / erro" na coluna dela. Rode sem outras suítes em paralelo, se der, e
repita a medição: uma rodada só não separa tendência de ruído.
