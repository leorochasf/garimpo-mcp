# Melhorias para o Garimpo — consolidação de 11 repositórios

Data: 2026-10-08. Documento de trabalho (sem commit).

**De onde vem.** São três relatórios de pesquisa feitos hoje, que somam 11 repositórios:

- **Relatório A:** jus-mcp, mcp-oab-jurisprudencia, jusratio-mcp-server, astrea-mcp.
- **Relatório B:** mcp-brasil, dr-claudio, juscraper-mcp, juscraper-app.
- **Relatório C:** jurisprudencia-stf-downloader, crawl4ai, Scrapling.

Este documento junta as ideias repetidas e separa cada uma pelos quatro eixos. Antes, conferi no `src/` o que o Garimpo já faz, para não propor o que já existe.

**Ressalvas que valem para tudo:**

- **Só ideias, nunca código** (regra 1). O código do Garimpo é escrito do zero; nenhum trecho de repositório alheio é copiado ou adaptado. **Usar uma biblioteca como dependência instalada não é copiar código**, e a regra 1 não a proíbe; o que limita uma dependência é a licença (seção 4).
- **Python permitido se provado melhor** (decisão do dono, 2026-10-08). O dono aceita obrigar o usuário a instalar Python se o ganho for comprovado. Onde uma biblioteca Python é candidata, o item traz a marca "candidata Python: X — exige prova comparativa". Sem prova no `docs/banco-de-provas/`, vale a alternativa em Node.
- **Quase nada foi medido.** Os ganhos são estimativas dos relatórios. Cada item deve ser medido no `docs/banco-de-provas/` antes e depois.
- **"Não verificado"** marca o que o relatório de origem não conseguiu confirmar. A marca foi mantida.
- **Vitrines.** Três repositórios do relatório A (jus-mcp, jusratio, astrea) só publicam o README. O que eles fazem foi lido no README, não no código.
- **Mudança de regra.** A regra 3 do `CLAUDE.md` foi alterada hoje. Saíram a proibição de contornar anti-robô e a exigência de User-Agent honesto. Ficaram os freios: 2 chamadas simultâneas, uma nova tentativa em 429/503, e depois parar. O relatório B ainda trata o User-Agent honesto como exigência; nesse ponto, ele está desatualizado em relação ao `CLAUDE.md` atual.

**Legenda:**

- **Esforço:** P = pequeno (horas), M = médio (alguns dias), G = grande (semanas, com manutenção contínua).
- **Origem:** oab = mcp-oab-jurisprudencia · jus = jus-mcp · jr = jusratio-mcp-server · mb = mcp-brasil · dc = dr-claudio · jm = juscraper-mcp · ja = juscraper-app · stf-dl = jurisprudencia-stf-downloader · c4a = crawl4ai · derivada = ideia nascida da análise, sem equivalente direto num repositório.

---

## 1. Lista única de melhorias, pelos 4 eixos

### VELOCIDADE (tempo de resposta)

| # | Melhoria (em linguagem de negócio) | Origem | Esforço | Ganho esperado |
|---|---|---|---|---|
| V1 | **Lembrar as buscas e as ementas de um dia para o outro** (cache em disco com validade de 1 a 2 dias). Hoje o Garimpo só lembra o que foi buscado na sessão atual (`src/busca.ts:79`). Atenção: o site muda a ordem dos resultados a cada chamada. Por isso, o uso mais seguro é recuperar **um acórdão pelo número**, e não devolver uma busca inteira repetida (cautela do relatório C) | oab (base local), mb (cache de 5 min), c4a (cache), jr ("chamadas em 5 min contam como uma") | M (P se ficar só na memória) | Busca refeita ou ampliada volta na hora no que já foi visto. `obter_ementa` e `obter_inteiro_teor` funcionam em outro dia sem refazer a busca. Menos chamadas ao site, o que protege o IP |
| V2 | **Não baixar de novo o PDF que já está na pasta.** Hoje o Garimpo só percebe a repetição *depois* de baixar o arquivo (`salvarSemSobrescrever`, em `src/inteiroTeor.ts`). A solução é um índice "número do acórdão → arquivo" | stf-dl (banco + sha256), c4a | P | Resposta imediata para PDF repetido. Evita os 3 passos do STJ e a pausa de 10 s do TSE |
| V3 | **Freio e "disjuntor" compartilhados entre todas as janelas abertas.** O estado fica gravado num arquivo do computador: depois de uma recusa, pausa longa que dobra a cada nova recusa; se o arquivo não puder ser lido, o Garimpo fica parado. Hoje o freio vale por processo, então N janelas fazem até 2×N chamadas simultâneas. O relatório A observa que a trava de arquivo do oab não funciona no Windows: o Garimpo precisa de uma que funcione | oab | M | É a proteção mais direta contra o bloqueio do IP, que é o objetivo da nova regra 3. Vira **pré-requisito** de qualquer contorno (seção 2) |
| V4 | **Mostrar o andamento da busca ampla** ("buscando 7 de 20…") | mb (`ctx.info`), ja (barra de progresso) | P | O tempo real não muda, mas a espera fica menor para quem usa. Alguns clientes renovam o prazo da chamada quando recebem andamento, o que evita estouro de tempo |
| V5 | **Entregar o que já tem quando a busca ampla demora**, com uma instrução de "continuar" que aproveita o cache (V1) | jm (`proxima_pagina_inicial`), jus/jr (busca em duas etapas) | M | Evita que uma busca grande morra por tempo esgotado. **Medir antes**: só vale se houver estouro de tempo real |
| V6 | **Tabela de temas e súmulas de STF e STJ dentro do pacote** (número, tese, situação) | oab (`importar_pacote` com SHA256) | M | Consulta de precedente qualificado instantânea e sem nenhuma chamada. Ajuda também a precisão (Q2). **Não verificado** se a fonte dos temas permite redistribuir os dados |

### QUALIDADE (resultado confiável e honesto sobre os próprios limites)

| # | Melhoria | Origem | Esforço | Ganho esperado |
|---|---|---|---|---|
| Q1 | **Conferir citação literal.** O usuário informa um trecho e o acórdão. O Garimpo diz se o trecho aparece **exatamente** na ementa ou no inteiro teor, e onde. Também avisa quando o trecho é de outro autor citado dentro do acórdão | oab (`verificar_citacao`) | P–M (no inteiro teor, depende de E1) | Combate o risco número 1 de quem escreve peça: a ementa "reconstruída" pela IA. Não faz chamada nova |
| Q2 | **Força do precedente marcada por regra fixa, sem IA**, conforme o art. 927 do CPC: vinculante (súmula vinculante, ADI/ADC/ADPF), qualificado (repetitivo, repercussão geral, IRDR/IAC), observância (súmula, plenário, corte especial) ou persuasivo (turma, câmara). Quando faltar a classe (comum no STJ), o campo diz "não classificado", nunca um palpite | jr (níveis A–E), dc (escala do art. 927) | M | Impede a IA de chamar de "vinculante" um acórdão de turma, erro que o dc aponta como o mais grave. O alerta de superação de tese (overruling) fica para depois de V6 |
| Q3 | **Cabeçalho de cobertura e de corte em toda resposta**: por tribunal, quantas buscas rodaram, quantas voltaram vazias, qual formulação não trouxe nada, quantos acórdãos foram achados e quantos aparecem, se a lista foi cortada e como pegar o resto. **Já existe em parte:** a `busca_ampla` traz avisos de erro por formulação e o aviso do STF (`src/ampla.ts:80-93`) | oab ("base parcial"), jm (`truncado`, `total_resultados_obtidos`) | P | Evita que "zero resultado" seja lido como "o tribunal nunca decidiu isso" e que uma lista cortada pareça completa |
| Q4 | **Recibo de origem do inteiro teor**: ao lado do PDF, um registro com link oficial, data e hora do download e a "impressão digital" (sha256) do arquivo | oab (recibos), stf-dl/c4a (sha256) | P | Prova de origem e integridade para juntar em peça |
| Q5 | **PDF mais robusto**: limite de tamanho; gravação em arquivo temporário antes de renomear, para não deixar PDF pela metade se a conexão cair; aviso claro quando o PDF é escaneado e não tem texto. O Garimpo já confere se o arquivo é mesmo um PDF | stf-dl, c4a | P | Menos arquivo corrompido e menos "texto vazio" tomado por "acórdão sem conteúdo" |
| Q6 | **Painel de saúde por tribunal** (funciona / experimental / fora do ar). É alimentado por um teste ao vivo opcional, atrás de variável de ambiente (regra 5), e mostrado no `listar_tribunais` | ja (testes por tribunal) | M | O `listar_tribunais` passa a dizer o que funciona **hoje**. Serve de base para o banco de provas. A rodada completa (32 chamadas) roda em série |
| Q7 | **Erros que ensinam a corrigir a chamada** (tribunal ou filtro inválido → lista das opções válidas) e **aceitar listas mandadas como texto** em `formulacoes` e `tribunais` | jm (`validar_tribunal`), mb (`tolerant_args`) | P | Menos falhas em laço com modelos que não são o Claude, o que importa para o público geral |
| Q8 | **Teste que trava a regra "erro nunca vira lista vazia"** | contra-exemplo do mb (que engole erros) | P | Protege contra o defeito mais comum dos concorrentes |
| Q9 | **Aviso fixo de natureza jurídica** em cada resposta ("resultado de busca: confira no link oficial antes de citar") | oab | P | Reforça o uso correto. É uma linha de código |

### PRECISÃO (achar o precedente certo, com menos ruído)

| # | Melhoria | Origem | Esforço | Ganho esperado |
|---|---|---|---|---|
| P1 | **Mostrar o trecho da ementa onde as palavras da busca aparecem**, e não o começo dela. Hoje o Garimpo mostra o início (`src/ampla.ts:134`), que costuma ser só cabeçalho processual | oab (`triagem`), derivada (B) | P | **O ganho de precisão mais barato.** A IA julga a pertinência sem chamar `obter_ementa` dezenas de vezes. Não faz chamada nova |
| P2 | **Dar peso maior às palavras raras** (BM25/IDF) na nota de aderência. Hoje "dano" vale o mesmo que "intercorrente" (`src/pontuacao.ts`). O cálculo usa as próprias ementas devolvidas | jr (BM25 na busca híbrida), c4a (`BM25ContentFilter`) | M | Ordenação melhor sem chamada extra nem dependência obrigatória: há biblioteca MIT, ou ~40 linhas próprias. Embeddings ou reordenação por IA só entram se o BM25 não bastar. **Candidata Python: BM25 do crawl4ai (`BM25ContentFilter`) — exige prova comparativa** contra a versão em Node |
| P3 | **Filtros locais "deve conter" / "não pode conter"** (com sinônimos) aplicados às ementas já recebidas | oab (`grupos`, `exato`) | P–M | Corta ruído sem gastar chamada. Medir se a precisão sobe sem perder cobertura |
| P4 | **Filtro e mapa de citações**: achar os acórdãos que citam "Tema 1.234", "Súmula 7" ou "art. 37, § 6º" e listar os mais citados | oab (`cita`, `mapa_de_citacoes`) | M | Liga o acórdão ao precedente qualificado e aponta a tese dominante |
| P5 | **Só os trechos do inteiro teor que tratam da tese** (5 a 10 parágrafos com o número da página), e não as dezenas de páginas inteiras | c4a ("fit markdown") | M (depende de E1) | Menos ruído e menos tokens na leitura do acórdão. **Candidata Python: crawl4ai ("fit markdown") — exige prova comparativa** contra a seleção por parágrafo em Node (o `html2text` embutido nele é GPL: seção 4) |
| P6 | **Catálogo de filtros por tribunal**: recusar o filtro que o tribunal ignora em silêncio, em vez de devolver ruído que parece filtrado | jm (`registry.py`) | M | Evita falsa sensação de filtragem. Exige medir filtro por filtro e registrar em `docs/api-jurisprudenciaia.md` |
| P7 | **Busca oficial do STF** (`jurisprudencia.stf.jus.br/api/search/...`), com 100 resultados por página e filtros de data e classe, para cobrir o ponto mais fraco: o JurisprudênciaIA devolve de 2 a 7 acórdãos do STF por busca | stf-dl, mb | M | Bem mais acórdãos do STF. **Não verificado:** é provável que fique atrás do mesmo AWS WAF; o próprio stf-dl trocou para navegador horas depois. Primeiro passo: **uma chamada de teste**. Também é decisão de escopo, porque seria uma fonte além do JurisprudênciaIA |
| P8 | **Segunda fonte para os TJs: busca de 2º grau do eSAJ.** Traz filtro por assunto e classe da tabela do CNJ e operadores de proximidade | jm, ja (eSAJ), mb (operadores STF/STJ) | G | Mais tribunais e filtro mais preciso. Mas muda a natureza do projeto, cada portal quebra de um jeito e os termos de uso estão **não verificados**. Desempenho informado pelo jm: ~4–5 s por página. **Candidata Python: juscraper (MIT) — exige prova comparativa** contra reescrita em Node: cobertura e velocidade nos mesmos tribunais; custo de instalar Python para todos |

### ENTREGA (formato e inteiro teor que chegam ao usuário)

| # | Melhoria | Origem | Esforço | Ganho esperado |
|---|---|---|---|---|
| E1 | **Inteiro teor entregue como texto, por página, em partes** ("página X de Y"), com cabeçalho (tribunal, número, data, link oficial, sha256). O PDF continua salvo como prova. Hoje o Garimpo devolve só o caminho do arquivo, e a IA do Claude Desktop sem ferramenta de arquivos **não consegue ler o PDF**. Biblioteca indicada: `pdfjs-dist` (Apache-2.0) | jus (`processos_obter_pecas`), jr (`obter_documento_chunk`), c4a (pypdf) | M | **Maior lacuna de entrega hoje.** Permite citar "fl. X" e abre caminho para Q1 e P5. **Candidata Python: pypdf — exige prova comparativa** contra `pdfjs-dist` (texto extraído dos mesmos PDFs de STJ, TJMG e TSE) |
| E2 | **Ler o PDF que o próprio usuário baixou** (STF, TJGO etc.): o usuário passa pelo captcha no navegador, e o Garimpo lê o arquivo da pasta, extrai o texto (E1) e gera o recibo (Q4) | derivada (A) | P (depois de E1) | Cobre STF e TJGO **sem contorno e sem risco ao IP** |
| E3 | **Marcar as ferramentas de leitura como "só leem"** (`readOnlyHint`). Confirmado: o Garimpo não declara isso hoje. O `obter_inteiro_teor` grava arquivo, então **não** recebe a marca | jm | P | O cliente pode liberar as buscas sem pedir "permitir" a cada chamada, o que deixa a pesquisa mais fluida |
| E4 | **Roteiro "pesquisar tese" embutido** (prompt MCP): gerar formulações → `busca_ampla` → ler ementas → separar por força (Q2) → baixar o inteiro teor do que vai ser citado. Mais uma página de consulta com a lista de tribunais | mb (prompts e recursos), dc (fluxo de pesquisa) | P–M | Para o público leigo, é o que mais muda o resultado. O texto do roteiro não pode afirmar jurisprudência |
| E5 | **Paginação sem refazer a busca** (ver os itens 51 a 100) e opção de trazer a ementa inteira | oab, astrea (cursor) | P | Menos chamadas e menos espera |
| E6 | **Exportar a lista para planilha (CSV)** com os parâmetros, a data e a hora da busca | ja (CSV/XLSX) | P | Registro reproduzível da pesquisa, que pode ser anexado |
| E7 | **Resposta em formato estruturado** (campos declarados) além do texto. Hoje é texto JSON solto (`src/index.ts`) | jm, derivada (B) | M | Clientes e automações leem os campos sem adivinhar, e mudança de formato é detectada |
| E8 | **Busca por número CNJ** pela API pública do DataJud: classe, assuntos, órgão e movimentos, **não** o inteiro teor | jus, mb, jm | M | Fecha a lacuna "busca por CNJ" e confirma se o processo citado existe. **Não verificado:** regras de acesso (Res. CNJ 446/2022, chave própria, proibição de redistribuir) e se isso completa a classe que falta no STJ. Devolver sem nomes das partes (LGPD). **Candidata Python: juscraper (MIT, módulo DataJud) — exige prova comparativa** |
| E9 | **Erro com link de "abrir chamado" já preenchido** (tribunal, ferramenta, versão), **sem** o texto da busca | ja | P | Facilita receber avisos de quebra quando o projeto for público |
| E10 | **Texto da decisão pelo Diário de Justiça Eletrônico Nacional** onde hoje só há link | jm (`buscar_comunicacoes_cnj`) | M | Hipótese: as intimações costumam trazer o texto. **Não verificado.** Precisa vir rotulado como "texto da intimação, não o acórdão oficial", e há risco de nome de parte (LGPD). **Candidata Python: juscraper (MIT, comunicações do DJE Nacional, usado pelo jm) — exige prova comparativa** |
| E11 | **LexML como fonte de TRFs e TCU** (hoje ausentes) | jus (`jurisprudencia_buscar`) | P (só levantamento) | Ampliaria a cobertura. Cobertura e atualidade do LexML **não verificadas** |
| E12 | **Versão remota** (claude.ai web e celular) | jm, mb | G | Alcança mais usuários. Porém todos passariam a sair de **um IP só**, o que concentra o limite do site e contraria o desenho. **Não verificado** se a autorização da JAI cobre isso |

---

## 2. Destravar tribunais bloqueados

### Quem está bloqueado hoje (fonte: `docs/api-jurisprudenciaia.md` e `src/tribunais.ts`)

| Tribunal | Barreira registrada |
|---|---|
| STF | Desafio AWS WAF que exige JavaScript (HTTP 202) |
| TJGO | reCAPTCHA na pesquisa; o download só vale dentro da sessão dessa pesquisa |
| TJSP, TST, TJDFT | Página de login ou JavaScript (não investigado) |
| STM e os outros 22 TJs | Aviso genérico de "login, JavaScript ou outra etapa", **não investigado** tribunal a tribunal |

O STJ, o TJMG e o TSE já são baixados por HTTP comum.

### Antes de qualquer contorno: quatro caminhos sem disfarce e sem risco ao IP

1. **TJRN pela rota de íntegra do próprio JurisprudênciaIA.** A rota é `GET /api/tribunais/{tjmsp,tjmrs,tjrn}/integra/{id}` e já está em `docs/api-jurisprudenciaia.md:88`. Não foi testada. Origem: relatório C. Esforço P.
2. **STF pelo campo `inteiro_teor_url` da busca oficial.** O stf-dl baixa o PDF por HTTP comum quando o endereço é `portal.stf.jus.br` ou `www.stf.jus.br`. Pode ser um endereço diferente do que hoje cai no WAF. **Não verificado:** os exemplos do stf-dl são fictícios. Esforço P (uma chamada de teste).
3. **TST, TJSP e TJDFT um por vez, por HTTP comum.** Hoje constam como "não investigado". Esforço P por tribunal.
4. **E2: ler o PDF que o usuário baixou à mão.** Cobre STF e TJGO na hora, com custo quase zero (relatório A).

### As opções de contorno (A–E do relatório C, com as variantes de A e B encaixadas)

| Opção | O que é | Destrava | Risco de bloqueio do IP do usuário | Custo em Node | Recomendação |
|---|---|---|---|---|---|
| **A. Navegador comum automatizado** (sem disfarce) | O Garimpo abre o portal num navegador real (Edge/Chromium, como faz o stf-dl), que executa o desafio JavaScript | **Provavelmente o STF.** Talvez TJSP, TST e TJDFT, se a barreira for só JavaScript (não verificado). **Não** o TJGO | **Médio.** O próprio stf-dl recebeu "202 sem conteúdo" mesmo com navegador e recomenda esperar. Cada página carrega muito mais do que um download simples. Fica mitigado com 2 simultâneas, pausa entre documentos, parada no primeiro 202 e o disjuntor compartilhado (V3) | `playwright` (Apache-2.0), como **dependência opcional ou pacote à parte**, para não pesar o `npx`. No Windows, dá para usar o Edge já instalado; no Mac e no Linux é preciso baixar o Chromium (~150 MB, não verificado). Cada abertura leva segundos e centenas de MB de memória | **Recomendada**, como recurso opcional, **depois** dos 4 caminhos acima e do V3. É a única opção com relação clara entre ganho e custo (relatório C). **Candidata Python: Scrapling (original D4Vinci, `DynamicFetcher`) ou crawl4ai — exige prova comparativa** contra `playwright` em Node, no STF: taxa de sucesso, memória e peso da instalação |
| **A′. Navegador visível, humano resolve** (variante de A; ideias C4 do relatório B e C3 do relatório A) | O Garimpo abre o portal, a pessoa resolve o captcha e o Garimpo pega o PDF na mesma sessão | STF **e TJGO** | **Baixo**: quem resolve o desafio é uma pessoa | O mesmo de A, mais a interação com o usuário. Frágil se o portal mudar | Boa como passo seguinte de A, se o E2 (baixar à mão) incomodar o usuário. O relatório B a considera a mais defensável das opções |
| **B. Navegador disfarçado ("stealth")** | O navegador esconde que é automação (técnicas do crawl4ai e do Scrapling) | Cloudflare Turnstile e detectores de automação em geral. **AWS WAF (STF):** o detector do crawl4ai não tem regra para ele, então o ganho no STF não está demonstrado. **reCAPTCHA (TJGO):** nenhum dos dois resolve | **Alto se for detectado**, porque passa a ser tratado como robô hostil. É uma corrida contra os detectores: cada atualização deles quebra o disfarce | `patchright` ou `playwright-extra` com plugin stealth (não verificados no npm). Manutenção alta. **Candidata Python: Scrapling (D4Vinci, `StealthyFetcher`) ou crawl4ai — exige prova comparativa** (a equivalência em Node não foi verificada) | **Não agora.** Hoje nenhum tribunal bloqueado do Garimpo está registrado atrás de Cloudflare. Pesa também na reputação de um pacote público autorizado pela JAI |
| **C. Conexão que imita navegador** (impressão digital TLS) | Imita a "assinatura" de conexão de um navegador | Bloqueios Cloudflare "managed" (ex.: `scon.stj.jus.br`), que o Garimpo **não precisa** destravar: o STJ já sai pela Revista Eletrônica | Médio a alto (mesma natureza de B) | Sem equivalente maduro em Node verificado; exigiria binário nativo. **Candidata Python: Scrapling (D4Vinci, `Fetcher` com `impersonate` via curl_cffi) — exige prova comparativa**; é onde o Python tem a vantagem mais clara sobre Node | **Não.** Pouco ganho |
| **D. Trocar User-Agent e rodar proxies** | Identificar-se como navegador; espalhar chamadas por vários IPs | Nenhum tribunal da lista acima, por si só. O STF exige JavaScript, que mudar a identificação não executa (inferência deste documento a partir do relatório C). Proxies dão mais volume | **User-Agent de navegador:** o relatório A avisa que, se descoberto, o bloqueio tende a ser mais duro. **Proxies:** são exatamente o contorno de limite por IP que os termos do JurisprudênciaIA citam como causa de bloqueio | Proxies custam dinheiro e são configurados pelo usuário | **Proxies: não.** **User-Agent:** agora permitido pela regra 3, mas com ganho não demonstrado. Manter o User-Agent `Garimpo/<versão>` no JurisprudênciaIA, onde a identificação sustenta a relação com a JAI. Num portal de tribunal, só como teste pontual, medido |
| **E. Resolver captcha** (serviço pago) | Um terceiro resolve o reCAPTCHA ou devolve o documento (o jus-mcp usa Infosimples e Direct Data, "captcha por órgão") | **TJGO**; pelo terceiro, talvez também o STF | Se o terceiro baixa o documento, o IP do usuário nem aparece (relatório A). Se só devolve a resposta do captcha, a chamada sai do IP do usuário, e o relatório C classifica este como o maior dos riscos | Custo por consulta e chave paga do usuário. A pesquisa passa pelo terceiro (privacidade/LGPD). Termos de uso **não verificados** | **Não por padrão.** Se o dono quiser, só como opção paga, desligada por padrão e configurada pelo usuário, depois de E2 e A′ |

### Recomendação

Ordem sugerida:

1. Os 4 caminhos sem contorno.
2. O **V3** (freio compartilhado entre janelas).
3. A **opção A**, opcional, começando pelo STF.
4. Se faltar o TJGO, a **A′**.

As opções **B, C e D (proxies)** não compensam o risco ao IP, que a nova regra 3 manda evitar. A **E** fica como opção paga, só se o dono decidir.

**Documentos a alinhar se o dono adotar A, A′ ou E.** Hoje eles ainda dizem que o Garimpo "nunca contorna":

- `README.md` (seção "Uso responsável");
- `docs/design/2026-10-07-garimpo.md`;
- `CONTEXT.md`;
- o cabeçalho de `src/inteiroTeor.ts`;
- os textos `EXPLICA_STF` e `EXPLICA_TJGO` em `src/tribunais.ts`;
- a descrição do `obter_inteiro_teor` em `src/index.ts`;
- o comentário "User-Agent honesto" em `src/cliente.ts:7`.

---

## 3. Top 5 recomendado, em ordem de execução

**Critérios:**

- Primeiro o que dá mais ganho com menos esforço.
- A base vem antes do que depende dela.
- Nada que arrisque o IP do usuário antes de existir o freio compartilhado.
- Cada passo é medido no banco de provas antes do seguinte.

1. **Pacote rápido de saída: P1 + Q3 + E3.** Trecho da ementa onde a tese aparece, cabeçalho de cobertura e de corte, e ferramentas marcadas como "só leem". Tudo P, sem chamada nova. Melhora na hora a precisão e a leitura de qualquer resultado.
2. **Inteiro teor como texto paginado: E1, seguido de E2.** É a maior lacuna de entrega e a base de Q1 e P5. Com o E2, STF e TJGO passam a ser lidos sem contorno.
3. **Cache, índice de PDFs e freio compartilhado: V1 + V2 + V3.** Buscas e downloads repetidos ficam instantâneos, a pendência "N janelas = 2×N chamadas" é resolvida e o IP fica protegido. É pré-requisito do item 5.
4. **Confiança jurídica: Q1 + Q2.** Conferência literal de citação e força do precedente pelo art. 927, por regra fixa. É o maior ganho de qualidade para quem vai citar em peça.
5. **Destravar o STF.** Primeiro os testes baratos: `inteiro_teor_url` por HTTP comum, TJRN pela rota de íntegra, TST/TJSP/TJDFT. Só depois, se preciso, o navegador comum opcional (opção A). O STF é o tribunal em que o Garimpo é mais fraco, mas é o item de maior risco e custo, por isso vem por último.

---

## 4. O que NÃO usar, e por quê

**Regra geral (regra 1).** Mesmo quando a licença permite, o Garimpo não copia nem adapta código: aproveita só ideias, rotas e formatos, e escreve do zero. **Usar uma biblioteca como dependência instalada é diferente de copiar código** e não viola a regra 1; quem a restringe é a licença (as linhas GPL abaixo continuam proibidas) e a decisão sobre Python (linha própria).

| O quê | Por quê |
|---|---|
| Código do **jurisprudencia-stf-downloader** | **GPL-3.0** (não verificado se "-only" ou "-or-later"): tornaria o pacote MIT incompatível |
| **html2text** embutido no crawl4ai | **GPL-3.0** |
| Resto do **crawl4ai** | Apache-2.0 **com cláusula extra de atribuição**, e a regra 1 exige código do zero |
| **Scrapling (cópia do UriBarros)** | BSD-3, mas é uma cópia parada, 227 commits atrás do original. Se for consultar, use o D4Vinci/Scrapling. Premissas desatualizadas: o `StealthyFetcher` não usa mais Camoufox, `PlayWrightFetcher` virou `DynamicFetcher` e `auto_match` virou `adaptive` |
| Código do **mcp-oab-jurisprudencia**, **mcp-brasil**, **juscraper/juscraper-mcp** | MIT, mas a regra 1 vale do mesmo jeito. No mcp-brasil, o módulo de jurisprudência **não serve nem de referência de rota**: engole erro e devolve lista vazia, e os campos são lidos por tentativa |
| Texto do **dr-claudio** | Sem arquivo LICENSE (MIT só no `plugin.json`): licença ambígua. Usar só a ideia da escala do art. 927, que é lei, e **não** importar os temas "recentes" escritos à mão, que envelhecem e não têm fonte verificada |
| **juscraper-app** | Sem licença: vale só a ideia |
| **jusratio-mcp-server** | Licença `NOASSERTION`, e o repositório original dá 404 (parece cópia). Vale só como vitrine de funções |
| **Bibliotecas Python** (crawl4ai, Scrapling — o original D4Vinci —, juscraper, pypdf etc.) como dependência | **Permitido se o banco de provas (`docs/banco-de-provas/`) mostrar ganho claro sobre a alternativa em Node.** O custo é real: todo usuário do `npx` passaria a precisar de Python, pip e, em alguns casos, de um navegador baixado. Sem a prova, vale o Node. Cada item candidato está marcado "candidata Python: X — exige prova comparativa" na seção 1 e na seção 2. Continuam valendo as proibições por licença: html2text (GPL-3.0) e o código do stf-dl (GPL-3.0); no crawl4ai, conferir a cláusula de atribuição antes de adotá-lo como dependência |
| `pdf-parse` | Depende de módulo nativo (canvas). Preferir `pdfjs-dist` |
| `unpdf` | Exige Node 22+, e o Garimpo pede 20+ |
| Perfilamento de pessoas por CPF/nome (jus-mcp) | Risco grave de LGPD e fora do propósito |
| Senha de sistema de terceiro (astrea-mcp) e token colado no chat (jus-mcp) | A credencial passa por terceiros ou pelo provedor da IA. O astrea, além disso, não é jurisprudência |
| Mais de 2 chamadas simultâneas, novas tentativas em série, proxies rotativos | Contrariam os freios que ficaram na regra 3 e o objetivo de não ter o IP banido |
| Descoberta de ferramentas por BM25 (mcp-brasil) | Faz sentido com 533 ferramentas; o Garimpo tem 5 |

---

## 5. Blocos de trabalho (uma sessão cada)

Todos os itens das seções 1 e 2 estão agrupados abaixo, sem item novo. Cada bloco cabe numa sessão: o dono cola a linha "Para abrir a sessão", e a sessão roda `/mattpocock-skills:grill-with-docs` (perguntas até fechar o escopo) e, depois do grilling, o fluxo descrito em cada linha (`/to-spec`, `/to-tickets`, `/implement`). O critério de "compensa?" é: ganho esperado nos 4 eixos × esforço × risco ao IP. Ele é decidido no grilling e registrado em ADR/CONTEXT.md; item rejeitado fica registrado com o motivo. Os blocos **B1–B10** são trabalho de código já decidido. Os blocos **D1–D4** dependem de decisão do dono ou de prova no `docs/banco-de-provas/`.

### Tabela-resumo: ordem sugerida e paralelismo

| Onda | Bloco | Nome | Eixo(s) | Depende de | Pode rodar junto com |
|---|---|---|---|---|---|
| 1 | B1 | Resposta honesta e fácil de ler | precisão, qualidade, entrega | — | B2, B11 |
| 1 | B2 | Inteiro teor como texto | entrega, qualidade | — | B1, B11 |
| 1 | B11 | Destravar tribunais sem contorno | entrega | — | B1, B2 (veja a nota de chamadas ao vivo) |
| 2 | B3 | Memória e freio compartilhado | velocidade | — (V2 mexe em `src/inteiroTeor.ts`: depois de B2) | B5 |
| 2 | B4 | Confiança jurídica | qualidade | B2 | B3, B5 |
| 2 | B5 | Ordenação e filtros locais | precisão | B1 | B3, B4 |
| 3 | B6 | Roteiro de pesquisa e leitura dirigida | entrega, precisão | B2, B4 | B7, B8, B9, B10 |
| 3 | B7 | Saúde e catálogo de filtros por tribunal | qualidade, precisão | B3 | B6, B8, B9, B10 |
| 3 | B8 | Tabela de temas e súmulas | velocidade, precisão | — (a licença da fonte é conferida na sessão) | B6, B7, B9, B10 |
| 3 | B9 | Busca ampla longa | velocidade | B3 | B6, B7, B8, B10 |
| 3 | B10 | Formato estruturado, exportação e chamado | entrega | — (E5 combina com B3) | B6, B7, B8, B9 |
| decisão | D1 | Prova: Python contra Node | todos | B2, B5 (e B6, para P5) | D3 |
| decisão | D2 | Navegador para STF e TJGO (contorno) | entrega | B3 (V3), B11, B2 | — |
| decisão | D3 | Fontes além do JurisprudênciaIA | precisão, entrega | B11 (testes baratos primeiro) | D1 |
| decisão | D4 | Versão remota | entrega | — | qualquer |

**Regras de ordem.**

- **E1 antes de Q1, P5 e E2:** E1 e E2 estão no B2; Q1 está no B4 e P5 no B6.
- **V3 antes de qualquer contorno:** V3 está no B3; o contorno está no D2.
- **Dono único por arquivo:** B1, B5, B6 e B10 mexem em `src/ampla.ts` ou `src/index.ts`; rode um de cada vez nesses arquivos, ou em ramos separados com junção cuidadosa.
- **Chamadas ao vivo:** B7, B11 e as provas de D1 a D3 fazem chamadas reais ao site ou aos tribunais. Rode **um desses por vez**, para respeitar o teto de 2 chamadas simultâneas (regra 3). Enquanto o V3 não existe, o freio vale por processo.
- **Medição:** cada bloco é medido no banco de provas antes e depois.

---

### B1 — Resposta honesta e fácil de ler

- **Eixo(s):** precisão, qualidade, entrega.
- **Itens:** P1, Q3, Q7, Q8, Q9, E3.
- **Objetivo:** cada resposta mostra o trecho da ementa onde a tese aparece, diz o que foi coberto e o que foi cortado, orienta quem errou a chamada, avisa que o resultado precisa de conferência no link oficial, e as ferramentas de leitura deixam de pedir permissão a cada uso. Nenhuma chamada nova ao site.
- **Depende de:** nada.
- **Pronto quando:** (1) testes sem rede verdes, incluindo o teste que trava "erro nunca vira lista vazia" (Q8); (2) a `busca_ampla` sobre respostas gravadas mostra o trecho com as palavras da busca (P1) e o cabeçalho de cobertura e corte (Q3); (3) tribunal ou filtro inválido devolve a lista de opções válidas, e `formulacoes`/`tribunais` mandados como texto são aceitos (Q7); (4) toda resposta traz a linha de natureza jurídica (Q9); (5) `buscar` e `obter_ementa` saem com `readOnlyHint`, e `obter_inteiro_teor` não (E3); (6) uma chamada real conferida no banco de provas, comparando antes e depois.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B1 da seção 5 de docs/melhorias-2026-10-08.md: itens P1, Q3, Q7, Q8, Q9 e E3 (trecho da ementa onde a tese aparece, cabeçalho de cobertura e corte, erros que ensinam, teste 'erro nunca vira lista vazia', aviso de natureza jurídica, ferramentas marcadas como só leitura). Respeite o CLAUDE.md do Garimpo (código do zero, testes sem rede) e use docs/banco-de-provas/ para medir antes e depois. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B2 — Inteiro teor como texto

- **Eixo(s):** entrega, qualidade.
- **Itens:** E1, E2, Q4, Q5.
- **Objetivo:** a IA lê o acórdão como texto, página por página e em partes, com cabeçalho (tribunal, número, data, link oficial, sha256), mesmo sem ferramenta de arquivos. O PDF continua salvo como prova, agora com recibo de origem, sem arquivo pela metade e com aviso quando for escaneado. O PDF que o usuário baixou à mão (STF, TJGO) também é lido, sem contorno e sem risco ao IP. Extração com `pdfjs-dist`, até a prova do D1.
- **Depende de:** nada.
- **Pronto quando:** (1) `obter_inteiro_teor` devolve texto em partes "página X de Y" com cabeçalho, em PDFs de STJ, TJMG e TSE; (2) o PDF salvo tem recibo com link, data e hora e sha256 (Q4); (3) o download usa arquivo temporário, tem limite de tamanho e avisa PDF sem texto (Q5); (4) um PDF baixado à mão e posto na pasta é lido e recebe recibo (E2); (5) testes sem rede verdes sobre PDFs de exemplo; (6) uma chamada real conferida.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B2 da seção 5 de docs/melhorias-2026-10-08.md: itens E1, E2, Q4 e Q5 (inteiro teor como texto paginado em partes, leitura do PDF que o usuário baixou à mão, recibo de origem com sha256, PDF mais robusto). Extração com pdfjs-dist; a comparação com Python (pypdf) fica para o bloco D1. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B3 — Memória e freio compartilhado

- **Eixo(s):** velocidade (e proteção do IP).
- **Itens:** V1, V2, V3.
- **Objetivo:** buscas e downloads repetidos voltam na hora, em outro dia também, e várias janelas abertas deixam de somar 2×N chamadas: todas obedecem a um freio e a um "disjuntor" gravados em arquivo, com trava que funcione no Windows.
- **Depende de:** nada. V2 mexe em `src/inteiroTeor.ts`; faça depois do B2.
- **Pronto quando:** (1) `obter_ementa` e `obter_inteiro_teor` funcionam em outro dia sem refazer a busca, com validade de 1 a 2 dias, recuperando o acórdão pelo número (V1); (2) PDF já baixado é reconhecido pelo índice "número → arquivo" **antes** de qualquer chamada (V2); (3) duas janelas abertas juntas nunca passam de 2 chamadas simultâneas, e depois de uma recusa as duas esperam, com pausa que dobra a cada recusa; arquivo de estado ilegível = Garimpo parado (V3); (4) teste sem rede que simula duas instâncias, rodado no Windows; (5) medição no banco de provas.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B3 da seção 5 de docs/melhorias-2026-10-08.md: itens V1, V2 e V3 (cache em disco de buscas e ementas, índice de PDFs já baixados, freio e disjuntor compartilhados entre janelas, com trava de arquivo que funcione no Windows). Lembre que o site muda a ordem dos resultados a cada chamada: o cache vale para recuperar um acórdão pelo número. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B4 — Confiança jurídica

- **Eixo(s):** qualidade.
- **Itens:** Q1, Q2.
- **Objetivo:** o usuário confere se um trecho citado está **literalmente** na ementa ou no inteiro teor e onde, e cada precedente sai marcado pela força que a lei lhe dá (art. 927 do CPC), por regra fixa, sem palpite de IA.
- **Depende de:** B2 (Q1 sobre o inteiro teor).
- **Pronto quando:** (1) um trecho verdadeiro é achado com a posição; um trecho alterado em uma palavra é recusado; um trecho que é de outro autor citado dentro do acórdão traz o aviso (Q1); (2) cada acórdão tem a classificação vinculante, qualificado, observância, persuasivo ou "não classificado" (nunca palpite) quando falta a classe, comprovada em casos conhecidos das fixtures (Q2); (3) testes sem rede verdes; (4) nenhuma citação inventada: exemplos do teste são genéricos.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B4 da seção 5 de docs/melhorias-2026-10-08.md: itens Q1 (conferir citação literal) e Q2 (força do precedente pelo art. 927 do CPC, por regra fixa, 'não classificado' quando faltar a classe). O B2 já está pronto. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B5 — Ordenação e filtros locais

- **Eixo(s):** precisão.
- **Itens:** P2, P3, P4.
- **Objetivo:** os melhores acórdãos aparecem primeiro e o ruído é cortado **sem chamada extra**: palavras raras pesam mais, a IA pode exigir ou excluir termos nas ementas já recebidas, e é possível achar quem cita um tema, súmula ou artigo.
- **Depende de:** B1.
- **Pronto quando:** (1) no banco de provas, a ordenação com BM25 acerta mais precedentes do conjunto de teste do que a atual (P2); (2) "deve conter"/"não pode conter", com sinônimos, reduz o ruído sem perder cobertura medida (P3); (3) o filtro por citação ("Tema N", "Súmula N", artigo) acha os acórdãos que citam e lista os mais citados (P4); (4) testes sem rede verdes. Candidata Python para P2: ver D1.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B5 da seção 5 de docs/melhorias-2026-10-08.md: itens P2 (peso maior às palavras raras, BM25), P3 (filtros locais 'deve conter' e 'não pode conter') e P4 (filtro e mapa de citações). O B1 já está pronto. Medir antes e depois no banco de provas. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B6 — Roteiro de pesquisa e leitura dirigida

- **Eixo(s):** entrega, precisão.
- **Itens:** E4, P5.
- **Objetivo:** o usuário leigo recebe um roteiro pronto de "pesquisar tese" dentro do próprio MCP, e a leitura do inteiro teor traz só os 5 a 10 parágrafos que tratam da tese, com o número da página.
- **Depende de:** B2 (E1) e B4 (Q2, usado no roteiro).
- **Pronto quando:** (1) o prompt MCP "pesquisar tese" aparece nos clientes, segue o fluxo formulações → `busca_ampla` → ler ementas → separar por força → baixar o inteiro teor do que vai ser citado, e o texto **não afirma jurisprudência**; (2) a página de consulta lista os tribunais; (3) P5 devolve de 5 a 10 parágrafos com a página, conferidos manualmente contra a tese em 3 acórdãos de exemplo; (4) testes sem rede verdes. Candidata Python para P5: ver D1.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B6 da seção 5 de docs/melhorias-2026-10-08.md: itens E4 (roteiro 'pesquisar tese' embutido como prompt MCP) e P5 (só os trechos do inteiro teor que tratam da tese). Os blocos B2 e B4 já estão prontos. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B7 — Saúde e catálogo de filtros por tribunal

- **Eixo(s):** qualidade, precisão.
- **Itens:** Q6, P6.
- **Objetivo:** o `listar_tribunais` passa a dizer o que funciona **hoje**, e o Garimpo recusa o filtro que o tribunal ignora em silêncio, em vez de devolver ruído que parece filtrado.
- **Depende de:** B3 (V3), porque a rodada completa faz cerca de 32 chamadas ao vivo, em série.
- **Pronto quando:** (1) um teste ao vivo opcional, atrás de variável de ambiente (regra 5), roda em série e alimenta o status "funciona / experimental / fora do ar" mostrado no `listar_tribunais` (Q6); (2) cada filtro foi medido por tribunal e o resultado registrado em `docs/api-jurisprudenciaia.md` (P6); (3) filtro ignorado pelo tribunal é recusado com aviso (P6); (4) testes sem rede verdes.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B7 da seção 5 de docs/melhorias-2026-10-08.md: itens Q6 (painel de saúde por tribunal com teste ao vivo opcional) e P6 (catálogo de filtros por tribunal, recusando o que o tribunal ignora). O B3 já está pronto; as chamadas ao vivo rodam em série. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B8 — Tabela de temas e súmulas

- **Eixo(s):** velocidade, precisão.
- **Itens:** V6.
- **Objetivo:** consulta instantânea, sem chamada, a temas e súmulas de STF e STJ (número, tese, situação), que também reforça a classificação do Q2.
- **Depende de:** nada. A sessão começa conferindo se a fonte dos temas **permite redistribuir os dados** (hoje não verificado); se não permitir, o bloco para e o dono é avisado.
- **Pronto quando:** (1) licença ou termos da fonte conferidos e registrados; (2) a consulta a um tema ou súmula conhecido volta sem rede, com número, tese e situação; (3) a tabela traz data e fonte de cada atualização, sem tese escrita à mão; (4) testes sem rede verdes.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B8 da seção 5 de docs/melhorias-2026-10-08.md: item V6 (tabela de temas e súmulas de STF e STJ dentro do pacote). Primeiro confira se a fonte permite redistribuir os dados; se não permitir, pare e me avise. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B9 — Busca ampla longa

- **Eixo(s):** velocidade.
- **Itens:** V4, V5.
- **Objetivo:** quem faz uma busca ampla grande vê o andamento ("buscando 7 de 20…") e, se ela demorar demais, recebe o que já foi achado com uma instrução de "continuar" que aproveita o cache.
- **Depende de:** B3 (V1, o cache).
- **Pronto quando:** (1) a `busca_ampla` emite andamento durante a execução (V4); (2) **medição prévia**: uma busca grande real mostra se há estouro de tempo; se não houver, V5 é dispensado e isso fica registrado; (3) se houver, a busca devolve o parcial com instrução de continuar, e a continuação não refaz chamadas já feitas (V5); (4) testes sem rede verdes.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B9 da seção 5 de docs/melhorias-2026-10-08.md: itens V4 (mostrar o andamento da busca ampla) e V5 (entregar o parcial e continuar com o cache). V5 só vale se a medição mostrar estouro de tempo real. O B3 já está pronto. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B10 — Formato estruturado, exportação e chamado

- **Eixo(s):** entrega.
- **Itens:** E5, E6, E7, E9.
- **Objetivo:** as respostas têm campos declarados, a paginação não refaz a busca, a lista sai em planilha com os parâmetros, a data e a hora, e o erro oferece um link de "abrir chamado" já preenchido, sem o texto da busca.
- **Depende de:** nada (E5 aproveita o cache do B3, se ele já existir).
- **Pronto quando:** (1) as ferramentas declaram o formato de saída, além do texto, e um teste detecta mudança de formato (E7); (2) pedir os itens 51 a 100 não refaz a busca, e há opção de ementa inteira (E5); (3) o CSV traz a lista com os parâmetros, data e hora (E6); (4) o erro traz o link de chamado com tribunal, ferramenta e versão, **sem** o texto da busca (E9); (5) testes sem rede verdes.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B10 da seção 5 de docs/melhorias-2026-10-08.md: itens E5 (paginação sem refazer a busca), E6 (exportar a lista em CSV), E7 (resposta em formato estruturado) e E9 (erro com link de abrir chamado, sem o texto da busca). Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### B11 — Destravar tribunais sem contorno

- **Eixo(s):** entrega.
- **Itens:** da seção 2, "Antes de qualquer contorno": caminho 1 (TJRN pela rota de íntegra do próprio JurisprudênciaIA) e caminho 3 (TST, TJSP e TJDFT, um por vez, por HTTP comum). O caminho 4 é o E2, no B2. O caminho 2 (STF por `inteiro_teor_url`) está no D3, junto com P7, porque nasce da busca oficial do STF.
- **Objetivo:** descobrir, com uma chamada de teste por tribunal, quais deles já saem por HTTP comum, e liberar o download onde der.
- **Depende de:** nada.
- **Pronto quando:** (1) cada um dos 4 tribunais (TJRN, TST, TJSP, TJDFT) tem teste registrado, com resultado e data, em `docs/api-jurisprudenciaia.md`; (2) onde funcionou, o download entra em `src/inteiroTeor.ts` com teste sem rede, e `listar_tribunais` e `src/tribunais.ts` refletem o novo estado; (3) onde não funcionou, o texto de `src/tribunais.ts` explica o motivo real, não mais "não investigado".
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco B11 da seção 5 de docs/melhorias-2026-10-08.md: seção 2, caminhos 1 e 3 (TJRN pela rota de íntegra; TST, TJSP e TJDFT por HTTP comum, um por vez, com uma chamada de teste cada). Chamadas ao vivo uma por vez, respeitando o freio da regra 3. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

---

### Blocos de decisão e prova

Estes blocos não se abrem sem uma decisão do dono ou sem prova. Cada um começa pela decisão ou prova e só depois vira código.

### D1 — Prova: Python contra Node

- **Eixo(s):** todos (é transversal).
- **Itens:** as marcas "candidata Python: X — exige prova comparativa" da seção 1 (E1/pypdf, P2/BM25 do crawl4ai, P5/crawl4ai, P8/juscraper, E8 e E10/juscraper) e da seção 2 (Scrapling D4Vinci e crawl4ai nas opções A e B, `impersonate` na opção C).
- **Objetivo:** decidir, com medição, se vale pedir Python ao usuário. Para cada item candidato, comparar a alternativa em Node com a biblioteca Python no `docs/banco-de-provas/` e registrar o ganho **e** o custo (instalação, peso, falhas por ambiente). A regra 1 permanece: só dependência instalada, nunca cópia de código; licenças GPL continuam fora (seção 4).
- **Ponto de partida do E1:** a conferência ao vivo do B2 (`docs/banco-de-provas/b2-inteiro-teor-ao-vivo.md`) achou trechos com formatação fora de ordem no texto do `pdfjs-dist` (PDF do TSE). A medição do D1 inclui esse caso.
- **Depende de:** B2 (para E1), B5 (para P2) e B6 (para P5), porque a alternativa em Node precisa existir para ser comparada. As comparações de P8, E8, E10 e das opções A–C seguem D3 e D2.
- **Pronto quando:** existe uma tabela por item candidato com a medição das duas alternativas e a decisão registrada ("adota Python" ou "fica em Node"), sem item decidido por impressão. Onde o dono adotar Python, a lista de documentos a alinhar (seção 4: `npx`, README) é preenchida.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco D1 da seção 5 de docs/melhorias-2026-10-08.md: provas comparativas entre bibliotecas Python (pypdf, BM25 do crawl4ai, crawl4ai, juscraper, Scrapling do D4Vinci) e as alternativas em Node, nos itens marcados 'candidata Python'. Decida só com medição no docs/banco-de-provas/. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### D2 — Navegador para STF e TJGO (contorno)

- **Eixo(s):** entrega.
- **Itens:** opções A (navegador comum), A′ (navegador visível, o humano resolve) e, só se o dono decidir, B (disfarce), C (conexão que imita navegador), D (User-Agent e proxies) e E (resolver captcha). Recomendação da seção 2: A depois de B11 e V3; A′ se faltar o TJGO; B, C e D (proxies) não; E só como opção paga e desligada.
- **Objetivo:** decidir se e como o Garimpo abre um navegador para o STF e, se faltar, o TJGO, sem pôr o IP do usuário em risco.
- **Depende de:** B3 (V3, obrigatório antes de qualquer contorno), B11 (os caminhos baratos primeiro), B2 (E2) e D1 (se uma biblioteca Python entrar na comparação).
- **Pronto quando:** (1) o dono decidiu, por escrito, quais opções adota; (2) para A: o STF baixa um PDF por navegador comum, com 2 simultâneas, pausa entre documentos e parada no primeiro 202, e a taxa de sucesso medida; (3) os documentos que ainda dizem que o Garimpo "nunca contorna" foram alinhados (lista da seção 2); (4) nenhuma opção rejeitada foi implementada.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco D2 da seção 5 de docs/melhorias-2026-10-08.md: seção 2, opções de contorno A, A′ e, se eu decidir, B, C, D e E. Comece me perguntando quais opções adoto. V3 e B11 já estão prontos. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### D3 — Fontes além do JurisprudênciaIA

> **Decidido pelo dono em 2026-10-09:** sim, o Garimpo busca em outras fontes. Ver seção 6 e ADR-0017.

- **Eixo(s):** precisão, entrega.
- **Itens:** P7 (busca oficial do STF), seção 2 caminho 2 (STF por `inteiro_teor_url`, com a mesma chamada de teste de P7), P8 (busca de 2º grau do eSAJ), E8 (DataJud por número CNJ), E10 (texto pelo Diário de Justiça Eletrônico Nacional), E11 (LexML para TRFs e TCU, só levantamento).
- **Objetivo:** decidir se o Garimpo passa a consultar fontes além do JurisprudênciaIA, o que muda a natureza do projeto, e o que cada fonte realmente entrega. Itens P8, E8 e E10 têm candidata Python (juscraper): ver D1.
- **Depende de:** B11 (testes baratos primeiro). Termos de uso, cobertura e regras de acesso dos itens estão "não verificados" e são parte do bloco.
- **Pronto quando:** (1) a **chamada de teste** da busca oficial do STF foi feita e o resultado registrado: passa pelo AWS WAF ou não, e se o `inteiro_teor_url` baixa por HTTP comum; (2) E11 vira um levantamento de cobertura e atualidade; (3) para P8, E8 e E10, os termos de uso e as regras de acesso foram lidos e registrados; E8 e E10 não devolvem nomes de partes (LGPD); E10 sai rotulado "texto da intimação, não o acórdão oficial"; (4) o dono decidiu quais fontes entram.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco D3 da seção 5 de docs/melhorias-2026-10-08.md: itens P7, P8, E8, E10 e E11 e o caminho 2 da seção 2. Comece pela chamada de teste da busca oficial do STF e pelos termos de uso; só depois me pergunte quais fontes entram. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

### D4 — Versão remota

- **Eixo(s):** entrega.
- **Itens:** E12.
- **Objetivo:** decidir se o Garimpo deve existir também como serviço remoto (claude.ai web e celular).
- **Depende de:** decisão do dono. Todos os usuários sairiam de **um IP só**, o que concentra o limite do site e contraria o desenho; **não verificado** se a autorização da JAI cobre isso.
- **Pronto quando:** o dono decidiu "sim" ou "não" por escrito; no "sim", a JAI confirmou que a autorização cobre o uso remoto e o desenho define como o limite do site é dividido entre usuários.
- **Para abrir a sessão:** "Rode /mattpocock-skills:grill-with-docs sobre o Bloco D4 da seção 5 de docs/melhorias-2026-10-08.md: item E12 (versão remota). Comece me perguntando se a autorização da JAI cobre o uso remoto e se aceito concentrar o limite do site em um único IP. Após o grilling: se alguma dúvida só se resolve medindo, desviar por /handoff → /prototype (medido em docs/banco-de-provas/) → /handoff de volta; depois /to-spec e /to-tickets; implementação com /implement, um ticket por sessão, /clear entre eles."

---

## 6. Várias fontes: decisão do dono e blocos novos (2026-10-09)

**D3 decidido.** O dono decidiu em 2026-10-09: "sim, o garimpo vai passar a buscar em outras fontes". Registro em
[ADR-0017](adr/0017-garimpo-busca-em-varias-fontes.md): toda fonte nova passa pelo Cliente único e pelos freios da
regra 3, somados entre fontes e janelas; termos de uso lidos e registrados antes de entrar; sem nome de parte do
DataJud e do DJEN (LGPD); rótulo de origem em toda resposta; o JurisprudênciaIA continua a fonte principal dos
tribunais que cobre. Base: `TICKETS/perguntas/alem-do-jurisprudenciaia.md` (seções "Riscos e condições que valem
para tudo" e "Como isso viraria blocos no plano"); os códigos C1–C8 são os de lá.

| Bloco | Itens | Depende de | Pronto quando |
|---|---|---|---|
| **B11 ampliado — testes baratos** | `consulta.php` do TJTO; busca do TJGO; TREs; reCAPTCHA do CJF | — | Uma chamada por item, resultado e data registrados em `docs/api-jurisprudenciaia.md` |
| **B12 — Justiça do Trabalho (CSJT)** | C1 (TST + 24 TRTs) | D3 (decidido); B3 (V1/V3) | Termos lidos e registrados; 1 chamada de teste registrada em `docs/`; `busca_direta`/`busca_ampla` aceitam TST/TRT por essa fonte, com texto integral; testes sem rede sobre resposta gravada; teto de páginas por busca |
| **B13 — Acórdão que falta** | C4 (DataJud), C5 (DJEN); absorve E8, E10 e o aviso de embargos (`TICKETS/avisos/01`) | B1; D3 (decidido) | Dado um CNJ, o Garimpo lista os julgamentos (data, órgão) do DataJud e marca "não veio na busca do JurisprudênciaIA"; o texto do DJEN sai rotulado "texto da intimação"; sem nome de parte; testes sem rede |
| **B14 — TCU** | C2 (e a rota C2-bis, se oficial) | D3 (decidido) | Dicionário de dados lido; planilha baixada uma vez e indexada no computador do usuário; busca local por número e por texto; data da base informada em toda resposta |
| **D2 revisto — STF oficial** | C3 (opção A com cookie de ~4 dias e alternativa de cookie colado) | B3 (V3), B11 | 1 navegador comum a cada ~4 dias, sem disfarce; buscas STF com mais de 7 resultados medidas no banco de provas; parada no primeiro 202 |
| **D1 (P8) — TJs via juscraper ou equivalente** | C6 | D1, D3 (decidido) | Prova comparativa: cobertura de ementa inteira e de acórdão faltante em 3 TJs (TJTO, TJPA, TJGO), contra o JurisprudênciaIA |
| **TRFs** | C8 | resultado do teste do CJF (B11 ampliado) | Sem bloco até haver caminho sem captcha |

**Ordem decidida pelo dono:**

1. B11 ampliado (testes rápidos: TJTO `consulta.php`, TJGO, TREs, CJF).
2. B12 (CSJT) e B13 (DataJud + DJEN) em paralelo — arquivos diferentes, chamadas ao vivo uma por vez.
3. B14 (TCU).
4. D2 revisto (STF oficial, navegador comum 1× a cada ~4 dias).
5. Por último, D1/P8 (portais dos TJs via juscraper ou equivalente).

TRFs seguem sem bloco até o teste do CJF.
