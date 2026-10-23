# Velocidade: linha de base da 1.1.1, bateria estendida, sem rede (B0.3)

Pergunta: quanto tempo o Garimpo 1.1.1 gasta **por dentro** em cada operação, quantas requisições faria e quantos
bytes trocaria, para que a 1.2 seja comparada depois com a mesma régua.

## Resultado bruto (N = 30, saída da medição)

Medição de 2026-10-23T05:15:10.535Z a 2026-10-23T06:08:42.688Z · N = 30 por nº de janelas
Máquina: AMD Ryzen 7 5700X 8-Core Processor, 16 threads, 31.9 GB (livres 6 GB no início) · win32 10.0.26200 · Node v22.16.0 · CPU ocupada antes 33 %, depois 20 %
Commits: depois c780162

| Operação | Janelas | Mediana (ms) | p95 (ms) | Pior (ms) | Chamadas | Bytes enviados | Bytes recebidos | Erros |
|---|---|---|---|---|---|---|---|---|
| (e) início do servidor até o tools/list | 1 | 498 | 542 | 546 | 0 | 0 B | 0 B | 0 |
| (e) início do servidor até o tools/list | 2 | 512 | 540 | 543 | 0 | 0 B | 0 B | 0 |
| (a) busca simples JurisprudênciaIA, fria | 1 | 32 | 35 | 42 | 1 | 204 B | 2,2 KB | 0 |
| (a) busca simples JurisprudênciaIA, fria | 2 | 36 | 341 | 351 | 1 | 204 B | 2,2 KB | 0 |
| (a) busca simples JurisprudênciaIA, repetida (memória) | 1 | 3 | 3 | 3 | 0 | 0 B | 0 B | 0 |
| (a) busca simples JurisprudênciaIA, repetida (memória) | 2 | 3 | 5 | 9 | 0 | 0 B | 0 B | 0 |
| (b) busca ampla 5 tribunais × 3 formulações, fria | 1 | 135 | 160 | 172 | 15 | 2,4 KB | 287,3 KB | 0 |
| (b) busca ampla 5 tribunais × 3 formulações, fria | 2 | 169 | 1557 | 1682 | 15 | 2,4 KB | 287,3 KB | 0 |
| (b) busca ampla, repetida (memória) | 1 | 38 | 43 | 47 | 0 | 0 B | 0 B | 0 |
| (b) busca ampla, repetida (memória) | 2 | 37 | 81 | 86 | 0 | 0 B | 0 B | 0 |
| (f) união da 2ª rodada (3 + 2 formulações), memória quente | 1 | 308 | 370 | 459 | 10 | 1,4 KB | 183,4 KB | 0 |
| (f) união da 2ª rodada (3 + 2 formulações), memória quente | 2 | 430 | 1383 | 2088 | 10 | 1,4 KB | 183,4 KB | 0 |
| (f) união da 2ª rodada, com renovar | 1 | 669 | 783 | 863 | 25 | 3,8 KB | 470,7 KB | 0 |
| (f) união da 2ª rodada, com renovar | 2 | 918 | 1784 | 2171 | 25 | 3,8 KB | 470,7 KB | 0 |
| (c) busca no Falcão (TRT) | 1 | 140 | 162 | 163 | 1 | 0 B | 4,1 KB | 0 |
| (c) busca no Falcão (TRT) | 2 | 220 | 868 | 1069 | 1 | 0 B | 4,1 KB | 0 |
| (d) leitura de inteiro teor já baixado (PDF, parte 1) | 1 | 222 | 240 | 248 | 0 | 0 B | 0 B | 0 |
| (d) leitura de inteiro teor já baixado (PDF, parte 1) | 2 | 471 | 536 | 555 | 0 | 0 B | 0 B | 0 |
| (g) texto_de_lei (CPC art. 85, § 2º), frio | 1 | 23 | 50 | 78 | 1 | 0 B | 78,2 KB | 0 |
| (g) texto_de_lei (CPC art. 85, § 2º), frio | 2 | 148 | 910 | 1132 | 1 | 0 B | 78,2 KB | 0 |
| (g) texto_de_lei, repetido (memória) | 1 | 2 | 11 | 12 | 0 | 0 B | 0 B | 0 |
| (g) texto_de_lei, repetido (memória) | 2 | 6 | 16 | 17 | 0 | 0 B | 0 B | 0 |
| (h) busca simples no TJGO (acha o julgado) | 1 | 31 | 40 | 42 | 1 | 87 B | 964 B | 0 |
| (h) busca simples no TJGO (acha o julgado) | 2 | 56 | 425 | 427 | 1 | 87 B | 964 B | 0 |
| (h) inteiro teor do TJGO pelo Projudi (.p7s) | 1 | 153 | 183 | 186 | 4 | 0 B | 7,0 KB | 0 |
| (h) inteiro teor do TJGO pelo Projudi (.p7s) | 2 | 182 | 655 | 854 | 4 | 0 B | 7,0 KB | 0 |
| (f) união da 2ª rodada, memória fria (GARIMPO_SEM_MEMORIA=1) | 1 | 187 | 207 | 209 | 25 | 3,8 KB | 470,7 KB | 0 |
| (f) união da 2ª rodada, memória fria (GARIMPO_SEM_MEMORIA=1) | 2 | 256 | 537 | 553 | 25 | 3,8 KB | 470,7 KB | 0 |
| (f) união da 2ª rodada, falha de leitura da memória | 1 | 204 | 224 | 227 | 25 | 3,8 KB | 470,7 KB | 0 |
| (f) união da 2ª rodada, falha de leitura da memória | 2 | 218 | 461 | 496 | 25 | 3,8 KB | 470,7 KB | 0 |
| (i) TCU 1 ano(s), 1ª pesquisa do processo (comum) | 1 | 439 | 455 | 459 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), 1ª pesquisa do processo (comum) | 2 | 456 | 485 | 522 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), seletiva | 1 | 242 | 253 | 273 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), seletiva | 2 | 252 | 291 | 292 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), comum | 1 | 411 | 436 | 461 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), comum | 2 | 431 | 449 | 529 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), vazia | 1 | 242 | 261 | 261 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), vazia | 2 | 250 | 273 | 281 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), semAcento | 1 | 285 | 306 | 308 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), semAcento | 2 | 300 | 313 | 328 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), aspas | 1 | 433 | 448 | 449 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), aspas | 2 | 450 | 477 | 515 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), filtros | 1 | 101 | 112 | 116 | 0 | 0 B | 0 B | 0 |
| (i) TCU 1 ano(s), filtros | 2 | 106 | 114 | 154 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), 1ª pesquisa do processo (comum) | 1 | 1960 | 2041 | 2075 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), 1ª pesquisa do processo (comum) | 2 | 2080 | 2402 | 2534 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), seletiva | 1 | 1288 | 1413 | 1566 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), seletiva | 2 | 1422 | 1710 | 1718 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), comum | 1 | 2578 | 2699 | 2700 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), comum | 2 | 2744 | 3004 | 3029 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), vazia | 1 | 1463 | 1559 | 1580 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), vazia | 2 | 1544 | 1668 | 1723 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), semAcento | 1 | 1625 | 1699 | 1724 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), semAcento | 2 | 1712 | 1850 | 1882 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), aspas | 1 | 2509 | 2624 | 2630 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), aspas | 2 | 2665 | 2852 | 2897 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), filtros | 1 | 561 | 595 | 618 | 0 | 0 B | 0 B | 0 |
| (i) TCU 5 ano(s), filtros | 2 | 593 | 634 | 679 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), 1ª pesquisa do processo (comum) | 1 | 4467 | 4707 | 4860 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), 1ª pesquisa do processo (comum) | 2 | 4721 | 4876 | 5340 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), seletiva | 1 | 2977 | 3153 | 3455 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), seletiva | 2 | 3204 | 3262 | 3366 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), comum | 1 | 5236 | 5398 | 5448 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), comum | 2 | 5538 | 5688 | 6061 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), vazia | 1 | 2946 | 3041 | 3103 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), vazia | 2 | 3132 | 3244 | 3331 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), semAcento | 1 | 3383 | 3476 | 3561 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), semAcento | 2 | 3604 | 3757 | 3867 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), aspas | 1 | 5138 | 5307 | 5321 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), aspas | 2 | 5418 | 5568 | 5796 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), filtros | 1 | 1163 | 1220 | 1283 | 0 | 0 B | 0 B | 0 |
| (i) TCU 10 ano(s), filtros | 2 | 1251 | 1291 | 1308 | 0 | 0 B | 0 B | 0 |

Custo interno por tese (1ª janela, uma bateria inteira; requisições e bytes contados no transporte do fetch falso):

- 1 janela(s): 108 requisições; 15,6 KB enviados; 1975,5 KB recebidos.
- 2 janela(s): 108 requisições; 15,6 KB enviados; 1975,5 KB recebidos.

Ferramentas no tools/list: depois 16. Buscas guardadas estragadas para a falha de leitura, por rodada: 28/56.

TCU sintético (composição registrada; gerado nesta medição, fora do git):

| Ano | Registros | Relação | INVALIDADO | Sigiloso | Aviso de sigilo | Com entidade HTML | MB | Bytes/registro p10 / mediana / p90 / máx. | Palavras distintas | Plantadas | sha256 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2016 | 465 | 308 | 2 | 1 | 1 | 233 | 10.4 | 2672 / 4843 / 61207 / 896129 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | f76e4edfd105 |
| 2017 | 465 | 308 | 2 | 1 | 1 | 233 | 9.2 | 2501 / 4766 / 55765 / 354789 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | b9e72df2b36a |
| 2018 | 465 | 308 | 2 | 1 | 1 | 233 | 9.4 | 2679 / 5026 / 59619 / 269268 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | 8e6129429fe5 |
| 2019 | 465 | 308 | 2 | 1 | 1 | 233 | 10.5 | 2510 / 4688 / 61075 / 602093 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | 198be1f2d044 |
| 2020 | 465 | 308 | 2 | 1 | 1 | 233 | 9.1 | 2561 / 4991 / 57179 / 516404 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | d36c6feace32 |
| 2021 | 465 | 308 | 2 | 1 | 1 | 233 | 8.6 | 2700 / 4778 / 51155 / 218057 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | 193b09586847 |
| 2022 | 465 | 308 | 2 | 1 | 1 | 233 | 9.7 | 2665 / 4708 / 58529 / 837922 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | 5818f3930faa |
| 2023 | 465 | 308 | 2 | 1 | 1 | 233 | 9.2 | 2689 / 4812 / 59940 / 284592 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | b93ee2413b88 |
| 2024 | 465 | 308 | 2 | 1 | 1 | 233 | 9.6 | 2653 / 4603 / 69076 / 251028 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | 71a9e71a62c3 |
| 2025 | 465 | 308 | 2 | 1 | 1 | 233 | 9.8 | 2671 / 4758 / 57979 / 773797 | 8119 | dragagem 2; sobrepreço 37; pregão eletrônico 19 | 3753b7493ea7 |

Tempos crus (fora do git): `banco-de-provas-resultados/velocidade/2026-10-23T05-15-10-535Z.json`.

## O que esta bateria mede e o que NÃO mede

- Mede o tempo **interno** do Garimpo (CPU, disco, vagas, freios, memória) e o **custo interno** em requisições e bytes
  que o servidor faria, contados no transporte do fetch falso (`scripts/velocidadeFetchFalso.mjs`).
- **Não mede o tempo do agente** (geração do LLM) **nem a latência das fontes**: o fetch falso responde na hora, sem
  rede (DNS proibido). "Tempo até a matriz final" e custo HTTP do fluxo real saem do ensaio pareado de B4.1, não daqui
  (N02).
- É **sintético e proporcional**: respostas gravadas fictícias, PDF sintético, TCU sintético (composição abaixo). O
  ganho que se medir contra esta base vale só para esta composição.

## Método

`npx vite-node scripts/medirVelocidade.ts --n 30` (sem `--antes`: modo linha de base, uma versão só). Código de
produto da 1.1.1 (`cc956b4`; o branch não muda `src/`), compilado e chamado por MCP no stdio, como o Claude chama;
pasta de dados temporária nova a cada rodada; cada rodada com 1 e com 2 janelas (processos) na mesma pasta de dados,
a 2ª com outra tese ao mesmo tempo, tempo anotado sempre o da 1ª.

Fase 1, numa janela: (e) início até o `tools/list`; (a) busca simples fria e repetida; (b) busca ampla 5 tribunais ×
3 formulações fria e repetida; (f) união da 2ª rodada (as 3 formulações e mais 2 copiadas de ementas devolvidas, numa
chamada só) com a memória quente e com `renovar`; (c) Falcão (TRT); (d) parte 1 de um PDF já baixado; (g)
`texto_de_lei` (CPC art. 85, § 2º, recorte gravado de 78 KB; a norma real pesa mais de 4 MB) frio e repetido; (h) busca
no TJGO e inteiro teor pelo Projudi com os dois arquivos assinados `.p7s` (fixtures fictícias já do repositório).
Fase 2, cada uma num processo novo na mesma pasta: (f) a união com a memória fria (`GARIMPO_SEM_MEMORIA=1`) e com
falha de leitura (as buscas guardadas trocadas por pastas, que o disco não lê); (i) TCU sintético com 1, 5 e 10 anos.

**TCU frio e quente:** para cada bloco (1, 5, 10 anos) abre-se um processo novo; "fria" é a 1ª pesquisa do processo
(consulta comum); "quente" são as consultas seguintes no mesmo processo: seletiva (`dragagem`), comum (`licitação
contrato`), vazia = sem resultado (`ornitorrinco`), sem acento (`licitacao sobrepreco`), entre aspas (`"pregão
eletrônico"`) e com filtros (`sobrepreço`, tipo ACÓRDÃO, colegiado Plenário). O cache de arquivos do sistema
operacional não é esvaziado: "fria" é fria de processo, não de disco.

**Composição do TCU sintético** (`scripts/tcuSintetico.ts`, determinístico, gerado em tempo de execução numa pasta
temporária, fora do git): 10 anos (2016–2025), 465 registros por ano (1/40 dos 18.588 do arquivo real de 2025,
ADR-0025), 66 % de acórdãos de relação, INVALIDADO, sigilosos e avisos de sigilo nas frações do real de 2025 com pelo
menos 1 por ano, tamanho lognormal (relação: mediana 2,5 KB; comum: mediana 34 KB, calibrada para a média ficar perto
dos 22,2 KB por registro do real), metade dos registros com entidade HTML (suposição, não medida no real), vocabulário
de palavras comuns de direito administrativo com cauda de 8.000 pseudopalavras (Zipf), termos plantados em quantidade
fixa. A tabela por ano, com os hashes, sai na saída da medição.

Tempos crus (fora do git): `banco-de-provas-resultados/velocidade/`.
