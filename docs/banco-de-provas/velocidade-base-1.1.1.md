# Velocidade: linha de base da 1.1.1, bateria estendida, sem rede (B0.3)

Pergunta: quanto tempo o Garimpo 1.1.1 gasta **por dentro** em cada operação, quantas requisições faria e quantos
bytes trocaria, para que a 1.2 seja comparada depois com a mesma régua.

**Resultados: em medição (N = 30). Esta seção é preenchida assim que a rodada terminar.**

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
