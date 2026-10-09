# Comparativo: Garimpo × jurisprudenciaia-mcp

Data: 2026-10-08. Garimpo na versão `garimpo-mcp@0.1.0`.

## De onde veio cada informação

**Outro projeto (jurisprudenciaia-mcp).** O código-fonte não foi aberto (regra 1 do `CLAUDE.md`). As fontes foram só estas:

- **[P]** página pública https://brunoflma.github.io/jurisprudenciaia-mcp/. O catálogo de ferramentas dessa página só aparece depois que o navegador a monta, por isso ela foi aberta num navegador sem interface e o texto foi lido na tela, sem abrir arquivo de script.
- **[G]** guia público de instalação https://brunoflma.github.io/jurisprudenciaia-mcp/deploy-guide.html, que tem link na página [P].
- **[S]** documento "Compatibilidade e segurança" (`docs/compatibility-and-security.md`), que tem link na página [P]. É um texto de documentação, não código.
- **[M]** metadados públicos do repositório na API do GitHub: licença, data de criação, último envio e estrelas. Nenhum arquivo do repositório foi lido.

**Garimpo.** As fontes foram `README.md`, `src/` (`tribunais.ts`, `cliente.ts`, `inteiroTeor.ts`, `index.ts`), `TICKETS/`, `docs/design/2026-10-07-garimpo.md` e `docs/api-jurisprudenciaia.md`. A suíte de testes também foi rodada hoje.

Nesta comparação não houve nenhuma chamada ao site do JurisprudênciaIA nem aos tribunais. Por isso, **nenhuma afirmação sobre a qualidade dos resultados dos dois projetos foi testada lado a lado.**

## Critério por critério

### 1. Ferramentas oferecidas

| | Garimpo | jurisprudenciaia-mcp |
|---|---|---|
| Quantidade | 5 (README, `src/index.ts`) | 14 [P] |
| Lista | `busca_direta`, `busca_ampla`, `obter_ementa`, `obter_inteiro_teor`, `listar_tribunais` | Pesquisa: `consultar_jurisprudenciaia`, `pesquisar_jurisprudencia`, `buscar_precedentes`, `buscar_informativos`, `buscar_precedentes_qualificados`. Teses: `analisar_tese_juridica`, `comparar_teses_juridicas`. Processos: `buscar_por_cnj`. Normas: `pesquisar_legislacao`, `buscar_citacoes_dispositivo`, `historico_alteracoes_norma`. Panorama: `analisar_jurimetria`, `linha_do_tempo_precedentes`, `listar_overruling_tema` [P] |
| Natureza | Devolve dados crus (ementa inteira, número, órgão, data, link oficial). Quem interpreta é a IA de quem usa (README) | As 14 ferramentas "encaminham pedidos ao serviço JurisprudênciaIA; não são 14 bases de dados independentes". Várias "solicitam" uma resposta: "resposta em Markdown, tese principal, precedentes e cautelas", "resposta consolidada" [P] |

O desenho do Garimpo (`docs/design/2026-10-07-garimpo.md`) afirma que os conectores existentes usam o **chat de IA** do site, "lento (~16 s)", e que o texto gerado ali não serve de fonte. A página [P] não diz qual rota do site o conector usa. A descrição das ferramentas, que "solicitam resposta", é compatível com essa leitura, mas **o tempo de ~16 s e a rota usada não foram verificados nesta sessão.**

### 2. Tribunais cobertos

- **Garimpo:** 31 tribunais. São STF, STJ, TST, TSE, STM e 26 TJs, entre eles o TJDFT. O TJTO não aparece na lista (**correção de 2026-10-09:** o TJTO faltou por esquecimento no mapeamento; a busca do site o aceita e ele entrou no Garimpo, que passou a 32 tribunais e 27 TJs), e não há TRFs, TCU nem tribunais de contas (`src/tribunais.ts`, `docs/api-jurisprudenciaia.md` linhas 19–20, README "Limites conhecidos"). Também há limites por tribunal: o STF devolve no máximo 4 acórdãos por busca, e o TJGO tem cerca de 2 meses de defasagem (README).
- **jurisprudenciaia-mcp:** **não informado.** A página diz apenas que "a cobertura, a qualidade e a disponibilidade dos resultados dependem da fonte" [P]. O único recorte que aparece num exemplo é `"tribunais":["STJ"]` [P].

### 3. Busca simples × busca ampla, sem repetidos

- **Garimpo:** tem as duas.
  - `busca_direta` faz uma busca num tribunal, com até 100 acórdãos e os precedentes qualificados numa lista separada.
  - `busca_ampla` roda várias formulações da mesma tese em um ou mais tribunais e junta tudo numa lista única, sem repetidos, ordenada por quantas formulações acharam cada acórdão (README).
  - O desenho registra um teste comparativo em que a busca ampla "reencontrou ~87–89% dos acórdãos de STJ e TJGO que uma ferramenta paga havia entregado" (`docs/design/2026-10-07-garimpo.md`). Esse número é do próprio projeto e não foi refeito nesta sessão.
- **jurisprudenciaia-mcp:** tem várias ferramentas de pesquisa, com recorte opcional por tribunais em `buscar_precedentes` [P]. Juntar várias formulações e tirar repetidos: **não informado.**

### 4. Inteiro teor

- **Garimpo:** baixa o **PDF oficial** do portal do tribunal no caso de **STJ, TJMG e TSE** e salva numa pasta local (README, `src/tribunais.ts`). Nos demais tribunais devolve o link e explica o motivo. No STF o portal tem um desafio anti-robô (AWS WAF); no TJGO há reCAPTCHA; nos outros, o portal exige login ou JavaScript.
- **jurisprudenciaia-mcp:** as instruções do conector "solicitam e orientam preservar o inteiro teor ou a transcrição integral disponibilizada pela fonte". A página também diz: "Não há garantia de acesso ao inteiro teor de todos os resultados" [P]. Se ele baixa o PDF oficial do portal do tribunal: **não informado.** A página fala no texto "disponibilizado pela fonte", ou seja, pelo JurisprudênciaIA.

### 5. Uso responsável

| | Garimpo | jurisprudenciaia-mcp |
|---|---|---|
| Chamadas simultâneas ao site e aos tribunais | No máximo 2 no total (README, `src/cliente.ts`) | Não informado |
| Nova tentativa após recusa | Em 429/503 espera o tempo pedido e tenta **uma** vez; se a espera pedida passar de 30 s, para (`src/cliente.ts`) | Não informado |
| Anti-robô e captcha | 403 ou desafio anti-robô = recusa imediata, nunca contorna; devolve o link (README, `src/cliente.ts`) | Não informado |
| User-Agent | Honesto: `Garimpo/<versão> …` (README) | Não informado |
| Cache | Só guarda as ementas da sessão em memória (`obter_ementa`) | Tem um "cache de pesquisa" (namespace `JURIS_CACHE`) [G] |
| Controles que existem do lado dele | — | Valem para **quem acessa o servidor dele**, não para as chamadas que ele faz ao JurisprudênciaIA: OAuth 2.1 com PKCE, lista de e-mails autorizados que bloqueia tudo quando está vazia, limite de 1 MB por requisição, limite de taxa local e logs sem argumentos nem resultados [S] |

### 6. Instalação

- **Garimpo:** roda na própria máquina. Basta um comando, `claude mcp add garimpo -- npx -y garimpo-mcp`, ou um bloco no `claude_desktop_config.json`. Pede Node.js 20 ou mais novo e não precisa de conta, nuvem nem login (README). Cada pessoa usa o próprio IP (desenho). O README documenta o Claude Code e o Claude Desktop. Uma versão em servidor "fica para depois" (desenho), de modo que **hoje não há um endereço remoto para usar no claude.ai web ou no celular.**
- **jurisprudenciaia-mcp:** é preciso **montar um servidor na Cloudflare Workers**. O guia [G] pede:
  - conta Cloudflare e conta Google Cloud;
  - Node 22 ou mais novo e Git;
  - criar dois espaços de armazenamento (KV);
  - configurar o OAuth do Google, com Client ID e Client Secret;
  - cadastrar a lista de e-mails autorizados;
  - publicar com `npm run deploy:worker`.

  O guia oferece um "prompt" para um agente de IA conduzir essa instalação. A vantagem é que uma instalação atende a equipe inteira: quem recebe o link `/mcp` e está na lista conecta pelo Claude (conectores remotos) ou pelo Codex [G][P]. Ele não está publicado no npm; a instalação é por `git clone` [G].

### 7. Licença e situação legal

- **Garimpo:** licença MIT. O registro do npm confirma `license = MIT`, e a API do GitHub mostra o repositório público com licença MIT, consultada hoje. Segundo o dono, a JAI autorizou a publicação em 2026-10-08 (`CLAUDE.md` regra 4, `TICKETS/04-publicacao.md`). O README se declara "cliente não oficial", sem afiliação ao JurisprudênciaIA nem à JAI.
- **jurisprudenciaia-mcp:** a API do GitHub mostra `license: null`, ou seja, o repositório não declara licença [M]. Sem licença, o código não pode ser copiado nem reaproveitado: vale o direito autoral padrão. A página [P] não menciona licença. Se ele tem autorização do JurisprudênciaIA ou da JAI: **não informado.** A página diz apenas "Serviço de pesquisa: JurisprudênciaIA" [P]. Sobre custos, a página diz que "podem estar sujeitos às condições, cotas e planos de cada serviço" [P].

### 8. Testes e maturidade

- **Garimpo:** 61 testes, todos aprovados (`npx vitest run` rodado hoje: PASS 61, FAIL 0). Os testes não usam rede: trabalham sobre respostas gravadas. Os 4 tickets estão resolvidos (`TICKETS/`). O projeto foi criado em 2026-10-07 e está na versão 0.1.0, ou seja, tem dois dias de vida.
- **jurisprudenciaia-mcp:** `npm run verify` cobre tipos, testes, auditoria e build. A integração contínua (CI) testa num contêiner sem rede, e há testes que impedem dados de instalação no repositório público [S][G]. A quantidade de testes **não foi informada**. O repositório foi criado em 2026-06-14, teve o último envio em 2026-10-07 e tem 14 estrelas [M]. Ou seja, está no ar há cerca de 4 meses e tem algum uso público.

### 9. O que o outro faz e o Garimpo não faz

Pelo catálogo [P], estas são as funções que o Garimpo não tem:

- **Análise de tese** (`analisar_tese_juridica`) e **comparação de duas teses** (`comparar_teses_juridicas`).
- **Busca por número CNJ** (`buscar_por_cnj`).
- **Legislação:** texto da norma (`pesquisar_legislacao`), precedentes que citam um dispositivo (`buscar_citacoes_dispositivo`) e histórico de alterações (`historico_alteracoes_norma`).
- **Informativos** (`buscar_informativos`).
- **Jurimetria e panorama** (`analisar_jurimetria`), **linha do tempo** (`linha_do_tempo_precedentes`) e **overruling** (`listar_overruling_tema`).
- **Uso remoto e multiusuário**, com login Google e lista de e-mails, que funciona no Claude por conectores remotos e no Codex.

Parte dessas funções o Garimpo deixa de propósito para a IA de quem usa, como julgar a tese e comparar entendimentos. Nesses casos, o Garimpo entrega os acórdãos crus, e a análise é feita pelo assistente (desenho, "Decisões").

Na direção contrária, isto o Garimpo faz e a página do outro não informa: busca ampla sem repetidos, download do PDF oficial (STJ, TJMG, TSE), tabela de cobertura por tribunal (`listar_tribunais`) e travas de uso responsável documentadas.

## Veredito, em linguagem simples

**Não há como dizer que um é "melhor" de forma geral: eles fazem coisas diferentes.**

**Onde o Garimpo é melhor**

- **Fonte verificável.** Ele traz a ementa inteira, o número do processo e o link oficial, sem texto gerado por IA no meio. Para quem precisa citar com segurança, isso pesa.
- **Inteiro teor oficial.** No STJ, no TJMG e no TSE ele baixa o PDF do próprio tribunal. A página do outro só promete repassar o texto que o JurisprudênciaIA disponibiliza, sem garantia.
- **Busca ampla.** Ele junta várias formulações da tese, tira os repetidos e ordena o resultado. É bom para não perder precedente.
- **Instalação.** Basta um comando, sem nuvem, sem conta Google e sem servidor.
- **Situação legal clara.** Tem licença MIT e, segundo o dono, autorização da JAI. O outro não declara licença no repositório, e a página não fala em autorização.
- **Uso responsável documentado.** O limite de concorrência, a única nova tentativa, a recusa de contornar anti-robô e o User-Agent honesto estão descritos. Do outro lado, esse ponto não é informado.

**Onde o Garimpo é pior**

- **Faz menos coisas.** São 5 ferramentas contra 14. Não tem busca por número CNJ, legislação, informativos, linha do tempo, overruling, jurimetria nem análise ou comparação pronta de teses.
- **É um projeto novo.** Tem dois dias e está na versão 0.1.0; o outro está no ar há cerca de 4 meses e tem algum uso público.
- **Só roda no computador de cada um.** Não serve hoje para usar no claude.ai pelo navegador ou pelo celular, nem para dar um único link à equipe.
- **Limites na cobertura.** O STF devolve no máximo 4 acórdãos por busca, faltam TRFs, TCU e TJTO (o TJTO entrou em 2026-10-09), e o inteiro teor só é baixado de 3 tribunais.

**Para quem serve cada um**

- **Garimpo:** para quem pesquisa no próprio computador (Claude Code ou Desktop) e quer **matéria-prima conferível**: muitos acórdãos, sem repetição, com ementa inteira e PDF oficial, deixando a análise para o próprio assistente. É o perfil de quem escreve peça e precisa citar.
- **jurisprudenciaia-mcp:** para uma **equipe com apoio técnico** que aceita montar um servidor na Cloudflare e quer que todos usem o mesmo link, inclusive no Claude pela web. Também serve a quem quer funções prontas de análise, como tese, CNJ, legislação e panorama, sabendo que a resposta é uma síntese do serviço e precisa ser conferida na fonte, como a própria página adverte.

**Ressalva:** esta comparação se baseia no que cada projeto declara e nos testes do Garimpo. Não houve teste lado a lado de qualidade nem de velocidade dos resultados.
