# Fontes além do JurisprudênciaIA

Fontes públicas que o Garimpo consulta além da busca direta do JurisprudênciaIA ([ADR-0017](adr/0017-garimpo-busca-em-varias-fontes.md)).
Cada uma entra aqui **antes** do código que a usa: endereço, termo de uso lido (com data), limites e o que o Garimpo
guarda. Toda chamada passa pelo cliente único, com as 2 vagas somadas a site e tribunais e os freios da regra 3 do
`CLAUDE.md`.

## DataJud (API Pública do CNJ)

Usada por `julgamentos_do_processo`: os **julgamentos registrados** de um processo, pelo número CNJ. Metadados, sem texto
de decisão e sem nome de parte.

- **Documentação:** https://datajud-wiki.cnj.jus.br/api-publica/ (subpáginas `/acesso`, `/termo-uso`, `/endpoints`,
  `/glossario`), lida em 2026-10-09.
- **Termo de uso:** versão 1.2, de 27/11/2023 —
  https://formularios.cnj.jus.br/wp-content/uploads/2023/11/Termos-de-uso-api-publica-V1.2.pdf (lido inteiro em
  2026-10-09). Trechos que importam ao Garimpo, literais:
  - 3.3 "A API é fornecida exclusivamente para fins legais, não comerciais e autorizados [...]"
  - 3.8 "O usuário concorda em não modificar, distribuir, vender ou explorar comercialmente a API ou qualquer
    informação derivada dela."
  - 3.9 "O usuário concorda em dar ciência ao CNJ de qualquer informação, notícia, estudo, relatório ou documento de
    qualquer natureza que seja disponibilizado ao público em geral."
  - 3.11 "O usuário concorda em não usar a API para coletar informações pessoais de terceiros."
  - 3.13 "O usuário concorda em não realizar mais de 120 requisições por minuto, a menos que tenha autorização expressa
    por escrito do CNJ."
  - 3.17 "O usuário concorda em não tentar contornar as medidas de segurança ou autenticação implementadas pela API."
  - 4.2 "O usuário concorda em não coletar, armazenar ou processar dados pessoais originários da API ou realizar
    cruzamentos de informação para esse fim, exceto conforme permitido pela LGPD [...]"
- **Acesso:** cabeçalho `Authorization: APIKey <chave pública>`. A wiki (`/acesso`) diz que "a chave poderá ser alterada
  pelo CNJ a qualquer momento" e que a vigente fica sempre nela. O Garimpo traz a chave pública no código; a variável
  de ambiente `GARIMPO_DATAJUD_CHAVE` a substitui. Em HTTP 401 com a chave do código, o Garimpo lê uma vez a página
  `/acesso` (pelo cliente único; em 2026-10-09 a wiki aceitou o User-Agent do Garimpo), confere o formato da chave e
  repete a consulta uma vez; falhando, erro com o link da wiki. A chave da variável de ambiente nunca é trocada. A chave
  nunca aparece em mensagem, log ou gravação de teste.
- **Rotas:** `https://api-publica.datajud.cnj.jus.br/api_publica_<sigla>/_search` (POST, consulta no formato
  Elasticsearch), uma por tribunal: 91 rotas na lista da wiki (`/endpoints`, lida em 2026-10-09): STJ, TST, TSE, STM,
  TRF1–6, os 27 TJs (o do DF é `tjdft`), TRT1–24, os 27 TREs (`tre-<uf>`, o do DF é `tre-dft`) e os TJMs de MG, RS e
  SP. **Não há rota do STF** (nem do CNJ, do CJF e do CSJT).
- **Do número à rota:** pelos campos J e TR do número único (Res. CNJ 65/2008, art. 1º, §§ 4º e 5º, lida em
  https://atos.cnj.jus.br/atos/detalhar/119 em 2026-10-09): J=3 STJ; J=4 TRF pelo TR (01–06); J=5 TST (TR 00) ou TRT
  pelo TR (01–24); J=6 TSE (TR 00) ou TRE pelo TR (01–27, Estados e DF em ordem alfabética); J=7 STM; J=8 TJ pelo TR
  (01–27, mesma ordem); J=9 TJM (13 MG, 21 RS, 26 SP). J=1 (STF) e J=2 (CNJ) não têm rota. O dígito verificador é
  conferido antes (módulo 97, Anexo VIII da mesma resolução). O parâmetro `tribunal` troca a rota (ex.: o processo
  que subiu ao STJ).
- **Resultado de julgamento:** os movimentos da subárvore **193 "Julgamento"** (Magistrado → Julgamento) da Tabela
  Processual Unificada de movimentos, baixada do SGT/CNJ em
  `https://gateway.cloud.pje.jus.br/tpu/api/v1/publico/download/movimentos` em 2026-10-09 (versão mais recente dos
  itens: 2026-09-11): 272 códigos, ativos e inativos (processos antigos usam os inativos). Ex.: 239 "Não-Provimento",
  200 "Não-Acolhimento de Embargos de Declaração", 198 "Acolhimento de Embargos de Declaração". A juntada do acórdão
  (581 "Documento" com complemento "Acórdão") vai à parte, como apoio. O nome mostrado é o que o DataJud devolveu.
- **Datas:** a data do movimento é a do **lançamento no DataJud**, não a da sessão (no caso medido, 7 e 1 dia depois
  das sessões); `dataHoraUltimaAtualizacao` diz quando o registro foi atualizado. O CNJ "não garante a precisão,
  integridade ou atualidade dos dados" (termo, 3.6).
- **Freios:** serviços `datajud` (a API) e `datajud-wiki` (a página de acesso) no disjuntor, separados para que
  uma recusa da wiki não pause a API; intervalo mínimo de 0,5 s entre chamadas ao mesmo host, para todas as janelas
  (termo, 3.13: até 120 por minuto); 429/503 pela regra geral (espera e uma nova tentativa). A API respondeu em 19 s na medição de 2026-10-09, sem cabeçalho de limite de taxa.
- **O que o Garimpo guarda:** por até 24 h, na memória do Garimpo, só a resposta reduzida que a ferramenta mostra
  (códigos, nomes, datas e órgãos dos movimentos de julgamento), com a fonte e o momento da obtenção; nunca a resposta
  bruta. A ferramenta não busca por nome de parte.
- **Decidido pelo dono em 2026-10-09:** item 1, se o uso cabe em "não comerciais" (3.3) — o Garimpo é open source
  (licença MIT) e sem cobrança; nas palavras do dono: "garimpo é opensource sem cobrança".
- **Decidido pelo dono em 2026-10-09:** item 3, dar ciência ao CNJ quando o Garimpo for publicado (3.9) — não dar
  ciência ao CNJ; nas palavras do dono: "nao avisar".
- **Decidido pelo dono em 2026-10-09:** item 2, o alcance de "não distribuir [...] qualquer informação derivada dela"
  (3.8) — o Garimpo não distribui informação derivada: é um programa com que cada usuário consulta o DataJud do próprio
  computador, sob demanda, e o resultado aparece só para ele; nenhum dado do DataJud vai no pacote; as obrigações do
  termo são de quem usa a API, e o Garimpo avisa disso na ferramenta e no README; nas palavras do dono: "2. a".
- Não resta pendência do dono sobre o termo do DataJud.

## DJEN (comunicações processuais do CNJ)

Usado por `julgamentos_do_processo` (desligável com `incluir_djen: false`): as **comunicações do processo** publicadas
no Diário de Justiça Eletrônico Nacional — metadados, link e, apenas quando os dois sinais conferirem, trecho saneado da ementa,
rotulado como texto da intimação (melhor esforço); nunca o texto bruto. São comunicações do processo, **não um
inventário de acórdãos**.

- **Especificação:** OpenAPI oficial https://comunicaapi.pje.jus.br/swagger/djen.yml, versão 1.0.4 ("Última
  atualização em 04-03-2026"), lida em 2026-10-09; licença indicada: Resolução CNJ 455/2022. Página do CNJ:
  https://www.cnj.jus.br/programas-e-acoes/processo-judicial-eletronico-pje/comunicacoes-processuais/ (pelo art. 13
  da Res. CNJ 455/2022, citado ali, publicam-se no DJEN, entre outros, "a ementa dos acórdãos"; o texto da resolução
  não foi aberto). **Termo de uso próprio do DJEN: não encontrado.**
- **Trechos literais da especificação:**
  - "Endpoints sem cadeado não exigem autenticação." / "Uso abusivo está sujeito a bloqueios. Observe os cabeçalhos de
    rate limit."
  - "As consultas estão sujeitas a controle de taxa de requisições por IP [...] x-ratelimit-limit [...]
    x-ratelimit-remaining." Na medição de 2026-10-09: `x-ratelimit-limit 20`.
  - "Ao receber um erro 429 orienta-se aguardar 1 minuto para retomar as requisições para evitar um loop de erros."
  - "A utilização de múltiplos IPs por um mesmo cliente para contornar o controle da taxa de requisições é considerado
    uso abusivo e poderá resultar em bloqueios."
- **Rota:** `GET https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroProcesso=<20 dígitos>&itensPorPagina=100&pagina=1`,
  **uma página só**. Com mais de 100 comunicações, a resposta diz "lista cortada: o DJEN tem N comunicações, mostradas
  100".
- **O que é mostrado, por comunicação:** data de disponibilização, tipo de comunicação, tipo de documento, órgão, classe
  e link (só se for https); trecho saneado apenas com o tipo exato `Acórdão`, uma ementa delimitada, número do
  processo antes dela e sem sinal de transcrição ou ato coletivo (ADR-0019). **Nunca** `texto`, `destinatarios`, `destinatarioadvogados`, nomes de advogado ou OAB —
  nem na resposta nem na memória.
- **Freios:** serviço `djen` no disjuntor, nas 2 vagas somadas; intervalo mínimo de 3 s entre chamadas ao mesmo host,
  para todas as janelas (20 por minuto); se `x-ratelimit-remaining` vier 2 ou menos, a próxima chamada ao DJEN espera
  1 minuto (nesta janela). **Exceção à regra geral (adendo proposto ao ADR-0009):** em 429/503, espera mínima de
  60 s dentro da chamada, sem ocupar vaga, e uma nova tentativa; se o DJEN pedir mais de 60 s, a ferramenta devolve na
  hora o que as outras fontes trouxeram, com o instante permitido (data, hora e fuso), e grava um **adiamento** do
  `djen` para todas as janelas, que não é recusa (não abre nem dobra o disjuntor); vencido, a primeira chamada é a
  única nova tentativa; recusada, disjuntor e aviso, como sempre.
- **Medição:** em 2026-10-09 o DJEN respondeu em 1–2 s às consultas do entrevistador; mais tarde no mesmo dia, durante
  a gravação deste ticket, respondeu **HTTP 503** em duas tentativas separadas por cerca de 15 min (em cada uma, a
  chamada e a única nova tentativa, 60 s depois), e o Garimpo parou, como manda a regra 3. Por isso a gravação do DJEN
  nos testes é sintética, montada com os campos da especificação, e não uma resposta real reduzida.
- **O que o Garimpo guarda:** por até 24 h, só a lista reduzida acima (sem texto bruto e sem nomes detectáveis), com a fonte e o momento
  da obtenção.

- **I-31 / PV-12 (2026-10-14):** uma busca no JurisprudênciaIA e uma consulta ao DJEN, ambas HTTP 200; o processo
  sorteado não trouxe comunicação `Acórdão`. O valor desse tipo e a presença da ementa na intimação seguem **não
  verificados ao vivo**; caminho positivo provado só com textos fictícios. Nomes livres não têm garantia de
  detecção: rótulo visível de melhor esforço. Teste opcional exclusivo: `GARIMPO_VIVO_DJEN=1` com
  `GARIMPO_VIVO` desligado, somente `tests/vivoDjen.test.ts`. DataJud não participa desse teste.

## Espelhos de Acórdãos do STJ (Portal de Dados Abertos)

Fonte do **índice "dispositivo legal → acórdãos do STJ"** ([ADR-0022](adr/0022-indice-de-dispositivo-legal-pelos-espelhos-de-acordaos-do-stj.md)).
Gerado só pelo mantenedor e levado no pacote como fotografia datada; o usuário nunca baixa o acervo. O gerador é `scripts/gerarEspelhos.ts`
(`npm run gerar-espelhos`, só do mantenedor); o pacote não tem código de rede para esta fonte.

- **Conjuntos:** 10, `espelhos-de-acordaos-<órgão>` (corte-especial, primeira-secao, segunda-secao, terceira-secao,
  primeira-turma a sexta-turma), em https://dadosabertos.web.stj.jus.br/dataset/ (fichas lidas em 2026-10-13).
  Arquivos mensais em JSON e um ZIP de histórico por conjunto; cada conjunto traz `dicionario-espelhodoacordao.csv`.
- **Licença:** as 10 fichas declaram "Creative Commons Atribuição" (`cc-by`), **sem indicar a versão** (conferido em
  2026-10-13). Exige atribuição: "Portal de Dados Abertos do STJ — Espelhos de Acórdãos, licença CC BY" no README, no
  índice e em toda resposta que o usa. A licença dos dados é separada da MIT do código (ADR-0015). A licença é
  revalidada por conjunto a cada geração.
- **Acesso:** `robots.txt` do portal com `Disallow: /api/` e `Crawl-Delay: 10`. O Garimpo usa só as páginas de ficha e
  os downloads, **uma chamada por vez, ≥ 10 s entre chamadas, nunca `/api/`**, pelo cliente único e com os freios da
  regra 3. Medição de 2026-10-13: 50 chamadas, todas 200, 0,6–14,9 s (mediana 1,8 s).
  Links montados para `processo.stj.jus.br` servem exclusivamente à consulta manual: seu `robots.txt` veda o
  acesso automatizado (D-18), inclusive seguir links ou baixar o inteiro teor por esse host. Uma via independente
  em outro host exige regras e prova próprias, sem desvio da restrição.
- **Periodicidade:** mensal, com defasagem de 1–2 meses; há regravações silenciosas de arquivos já publicados e mês
  ausente (Segunda Turma 06/2026). O sha256 de cada arquivo as detecta.
- **O que o Garimpo guarda:** do campo `referenciasLegislativas`, os pares (lei, ano, artigo, parágrafo, inciso) e,
  por acórdão, classe, número, registro, órgão, relator e datas. **Nunca** `ementa`, `decisao` (traz nome de advogado
  e de parte) nem `acordaosSimilares`.
- **Escopo do piloto:** CPC/15, CC/02 e CDC.
- **Cobertura (medida em amostra, não garantida):** classificação presente em 74% do histórico da Terceira Turma até
  05/2022, mas em 14–16% dos acórdãos de 2025–2026. Fração do total de acórdãos do STJ coberta: **não verificado**.
- **Aviso obrigatório:** o literal está no ADR-0022.

## STJ: `robots.txt` de `processo.stj.jus.br` (D-18)

- **Verificado em:** 2026-10-13 (21:53 no horário de Brasília), somente leitura, UA honesto do Garimpo, 2 pedidos ao mesmo
  host oficial, sem 429/503, sem página de bloqueio.
- **Saltos:** `https://processo.stj.jus.br/robots.txt` → 302 para `https://processo.stj.jus.br/processo/robots.txt` → 200.
  URL final: `https://processo.stj.jus.br/processo/robots.txt` (1454 bytes; `Last-Modified: Tue, 06 Oct 2026 16:59:31 GMT`;
  SHA-256 dos bytes: `586668a6c9e81dc2ebb501a4de62239b268bd17ac095a5cc8ebbbda31023109a`). O arquivo alcançado por
  redirecionamento vale para a autoridade inicial, `processo.stj.jus.br` (RFC 9309, §2.3.1.2).
- **Linhas literais relevantes** (cabeçalho `# STJ BLOQUEIOS GERAIS PARA TODOS OS ROBÔS Rev 20250501`):

  ```
  User-agent: *              # Aplica as regras a todos os bots (Googlebot, Bingbot, etc.) bloqueando acesso em:
  Disallow: /
  Disallow: /processo/        
  Disallow: /processo/pesquisa/  
  Disallow: /SCON/           
  Disallow: /repetitivos      
  Disallow: /processo/dj/edital/  
  Disallow: /portal_stj/teste/    
  Disallow: /grucobranca/    
  ```

  Nenhum grupo cita o Garimpo e o arquivo não tem nenhuma linha `Allow`: pela RFC 9309 (§2.2.1), o grupo `*` vale. **O
  host inteiro é vedado** ao Garimpo, inclusive `/repetitivos` (temas e IAC) e `/processo/` (inteiro teor).
- **Ressalva de formato:** a resposta veio como `text/html;charset=ISO-8859-1` (a RFC pede `text/plain`), mas o corpo é texto
  de robots puro, sem marcação; tratado como robots válido.
- **O que o Garimpo faz (D-18):** nenhuma chamada automatizada a `processo.stj.jus.br`. Temas e IAC do STJ saem da tabela
  empacotada (ADR-0015, emenda no ADR-0020); o inteiro teor do STJ é só link para conferência manual (emenda no
  ADR-0016). Nem `www.stj.jus.br` nem outro subdomínio é usado como desvio.
- **Duas restrições diferentes, em hosts diferentes:** o `/api/` vem do robots do Portal de Dados Abertos
  (`dadosabertos.web.stj.jus.br`), que o gerador da tabela já respeita; o "nunca processo.stj.jus.br" vem do robots do
  próprio `processo.stj.jus.br`. O robots de `www.stj.jus.br` vale só para `www` e não se aplica a `processo`.

## API pública de pesquisa do TJDFT (texto do acórdão)

Usada por `obter_inteiro_teor` no TJDFT (I-13 / G-17): o **texto** do acórdão, pelo identificador e uuid do link do
JurisprudênciaIA. Rótulo: «texto do portal do tribunal»; nunca «inteiro teor oficial» (que é o PDF). Não há PDF nem
recibo.

- **Documentação oficial:** página «Webservice ou API» —
  https://www.tjdft.jus.br/transparencia/tecnologia-da-informacao-e-comunicacao/dados-abertos/webservice-ou-api — e o
  PDF «Documentação da API Pública de Consulta à Jurisprudência do TJDFT» —
  https://www.tjdft.jus.br/transparencia/tecnologia-da-informacao-e-comunicacao/dados-abertos/documentos/documentacao_api_seti_transparencia.pdf
  (ambos lidos em 2026-10-14). Literais: a API existe «para oferecer um ponto de acesso estruturado e padronizado aos
  acórdãos e decisões disponíveis para consulta pública»; `POST https://jurisdf.tjdft.jus.br/api/v1/pesquisa`, corpo
  JSON com `query`, `pagina` (a partir de 0) e `tamanho` obrigatórios e `termosAcessorios` opcional (lista de
  `campo`/`valor`); «Os únicos campos permitidos são»: `base`, `subbase`, `origem`, `uuid`, `identificador`,
  `identificadorOrdenacao`, `processo`, `nomeRelator`, `nomeRevisor`, `nomeRelatorDesignado`,
  `descricaoOrgaoJulgador`, `dataJulgamento`, `dataPublicacao`, `descricaoClasseCnj`. A resposta traz `hits`,
  `agregacoes`, `paginacao` e `registros` (com `uuid`, `identificador`, `processo`, `nomeRelator`, `inteiroTeor`,
  `possuiInteiroTeor`…). A documentação não fala de cota, de `retornaInteiroTeor` nem de segredo de justiça.
- **Termos:** a página da API não traz condições de uso nem limite de chamadas; define, em geral, sistemas «em formatos
  abertos, estruturados e legíveis por máquina» como os que «permitam a leitura sem limitações legais de uso dos
  arquivos por programas de terceiros». Termo de uso do sítio do TJDFT (lido em 2026-10-14): a reprodução do conteúdo
  público «é permitida, total ou parcialmente, desde que citada a fonte e mantida a integridade das informações»; não
  se usam «tecnologias que comprometam a disponibilidade dos serviços oferecidos». O `robots.txt` do host não existe
  (devolve a página do aplicativo, HTTP 200 `text/html`): nenhuma regra publicada.
- **Como o Garimpo chega ao acórdão:** do link `https://jurisdf.tjdft.jus.br/acordaos/<identificador>/inteiro-teor/<uuid>`
  tira o `identificador` e pede `POST` com `termosAcessorios: [{campo: "identificador", valor}]`, `retornaInteiroTeor:
  true` (observado na primeira prova do ticket 02, fora da documentação) e `query` com uma palavra da ementa (a API exige o termo). O
  registro só vale se for o único devolvido, com `identificador` e `uuid` iguais aos do link e, quando a busca trouxe o número CNJ, o `processo` for o mesmo; senão, texto
  **não verificado** e nada é guardado. `segredoJustica` verdadeiro ou `possuiInteiroTeor` falso = sem texto. Busca por
  `uuid` ou pelo número CNJ no `query` não devolveu o registro (primeira prova do ticket 02 e prova de 2026-10-14).
- **Freios:** serviço `tjdft` no disjuntor (regra 3 do `CLAUDE.md`); freio preventivo pelo restante que a API informa em
  cada resposta (`x-ratelimit-limit: 60`, `x-ratelimit-remaining`, `x-ratelimit-reset` em segundos), o mesmo desenho do
  Falcão (`src/freio.ts`): na reserva, pausa em todas as janelas. UA honesto do Garimpo, aceito sem desafio nem login.
- **O que o Garimpo guarda:** por até 24 h, na memória, só o texto do acórdão pelo id; nunca a resposta bruta.
- **Não verificado:** o que a janela da cota mede além de «60 por minuto» (visto: `reset` em segundos); se `query` com
  palavra da ementa casa sempre (visto em 1 acórdão: «apelação»); a combinação `identificador` + `retornaInteiroTeor` numa
  só chamada ao vivo (cada uma vista em chamada separada); o frescor da base.

## Portais de jurisprudência do TJRR e do TJPI (inteiro teor por um GET por documento)

Usados por `obter_inteiro_teor` no TJRR e no TJPI (I-16 / G-23, prova PV-06 de 2026-10-14). Cada tribunal é uma fonte
própria; a aprovação de um host não vale para outro.

Leitura de regras registrada na execução de 2026-10-14 (PV-06; revisão posterior sem rede):
- TJRR: https://jurisprudencia.tjrr.jus.br/robots.txt — 404, portanto sem trecho de regras a citar.
- TJPI: https://jurisprudencia.tjpi.jus.br/robots.txt — 200 `text/plain`, 99 bytes; trecho registrado:
  `# See https://www.robotstxt.org/robotstxt.html`, sem diretivas de proibição.
- TJPA: https://jurisprudencia.tjpa.jus.br/robots.txt — 200 `text/html`, casca da aplicação, sem regras publicadas.
  A execução registra leitura da política de privacidade, sem trecho sobre robôs, mas não preserva seu endereço
  nem trecho literal; esse detalhe documental fica **não verificado**. O TJPA não foi integrado.
- Termos próprios do TJRR e do TJPI: não encontrados na execução; não há trecho de termo a citar.
  Sem vedação encontrada não equivale a autorização. Os termos permanecem **não verificados**.

- **TJRR (`jurisprudencia.tjrr.jus.br`): PDF.** O link da busca (`/inteiroTeor.xhtml?id=<n>`) é uma página JSF com o PDF
  embutido numa sessão; o Garimpo pede direto `GET /pdf?id=<n>` (`application/pdf`, `attachment`), sem cookie, e guarda o
  PDF com recibo como nos demais. `robots.txt`: HTTP 404 (nenhuma regra publicada). Termos de uso do portal: **não
  encontrados** (a página do tribunal só tem o item de proteção de dados, sem regra sobre robôs). Prova: 1 GET do PDF,
  200, 229 048 bytes, 19 páginas, nº do processo igual ao da busca.
- **TJPI (`jurisprudencia.tjpi.jus.br`): texto em HTML.** `GET /jurisprudences/<n>/public` (o link de consulta da busca)
  devolve a página do acórdão já com a ementa e o texto do acórdão no HTML; o Garimpo guarda esse texto na memória pelo
  id (rótulo «texto do portal do tribunal», sem PDF nem recibo; mesma natureza do TJTO e do TJDFT). Só vale a página com
  as seções «Ementa» e «Acórdão», pelo menos 200 caracteres de texto na seção «Acórdão», o delimitador da coluna
  «Detalhes» e, quando a busca trouxe o número CNJ, o mesmo processo nessa coluna. Redirecionamentos não são seguidos:
  outra rota fica não verificada, sem texto guardado. `robots.txt`:
  só uma linha de comentário (nada vedado). Termos de uso: **não encontrados**. Prova: 1 GET (2 na sessão, a segunda para
  guardar a página), 200 `text/html`, 78 KB, texto de ~35 mil caracteres, processo conferido.
- **TJPA (`jurisprudencia.tjpa.jus.br`): não integrado.** O portal é uma aplicação de página única (`/#/documento/<id>`);
  `GET /documento/<id>` (rota citada por terceiros) devolve a casca da aplicação (HTTP 200 `text/html`, 31 663 bytes, a
  mesma do `robots.txt`), não o documento. A API por trás da aplicação não é documentada; o Garimpo não a procura por
  tentativa. O tribunal segue como «só link».
- **Freios:** pelo cliente único (UA honesto, no máximo 2 chamadas simultâneas, uma nova tentativa em 429/503).
- **Não verificado:** estabilidade das rotas `/pdf?id=` e `/jurisprudences/<n>/public`; se acórdãos antigos têm PDF; o
  frescor; se o TJPI mantém o texto integral em todos os acórdãos (visto em 1). A prova registra coincidência do
  número do processo nos dois tribunais, mas não a conferência da data de julgamento no documento: **não verificada**.

## Portal de jurisprudência do TJPR (íntegra na página do acórdão)

Usado por `obter_inteiro_teor` no TJPR ([ADR-0030](adr/0030-tjpr-inteiro-teor-pela-pagina-do-acordao.md); estudo
[`estudos/2026-10-29-tjpr-cobertura.md`](estudos/2026-10-29-tjpr-cobertura.md)).

- **Host:** `portal.tjpr.jus.br` (serviço `tjpr` dos freios), só `https`, caminho `/jurisprudencia/j/<n>` com ou sem o
  nome depois (o link que vem da busca).
- **Regras lidas em 2026-10-29:** `robots.txt` com `User-agent: *` e só `Disallow: /tjpr-assinador/`; a página traz
  `<meta name="robots" content="nofollow">` (não veda leitura). Resolução TJPR n.º 532-OE/2026: acesso automatizado a
  movimentações processuais pelo SCMPP, com possíveis «limitações quantitativas de acessos simultâneos»; não trata de
  jurisprudência nem proíbe acesso automatizado. Termo de uso do portal de jurisprudência: **não encontrado** (sem
  vedação encontrada não equivale a autorização).
- **O que o Garimpo lê:** um GET na página do acórdão (UA honesto, redirecionamento não seguido). O texto vem do bloco
  «Íntegra do Acórdão» (`<div id="texto<n>">`, do mesmo `<n>` do link), depois do aviso do tribunal «O texto abaixo
  representa a transcrição de Acórdão. Eventuais imagens serão suprimidas.», com pelo menos 200 caracteres; o campo
  «Processo:» tem de existir e ser o número CNJ da busca, quando ela o trouxe; e a íntegra tem de conter o número do
  processo da página. **Motivo:** em 2026-10-29 o portal pôs na página certa a íntegra de outro acórdão em 4 de 11
  chamadas (cabeçalho certo, corpo de outro caso); só o número dentro do texto separou as certas das trocadas. «Segredo de Justiça» diferente de «Não»: nenhum
  texto guardado, só o motivo. Rótulo «texto do portal do tribunal (TJPR)», sem PDF nem recibo.
- **Freios:** pelo cliente único; 429, 503 e também 502 (visto duas vezes em ~12 chamadas no estudo) = espera e uma
  nova tentativa; recusa de novo abre o disjuntor do serviço `tjpr`.
- **Prova (2026-10-29):** 2 páginas, uma de Câmara Cível (~33 mil caracteres de íntegra) e uma de Turma Recursal (~8 mil),
  200 `text/html; charset=UTF-8`, sem login nem captcha.
- **Não verificado:** limite de ritmo do portal; estabilidade da rota; decisões monocráticas; acórdãos cujas imagens ou
  tabelas importem para o sentido.

## Portal de jurisprudência do TJBA (o documento da decisão em HTML)

Usado por `obter_inteiro_teor` no TJBA ([ADR-0034](adr/0034-tjba-inteiro-teor-pela-pagina-do-documento.md)), pelo molde
«página com íntegra» ([ADR-0032](adr/0032-molde-pagina-com-integra-e-registro-de-portais.md)).

- **Host:** `jurisprudenciaws.tjba.jus.br` (serviço `tjba` dos freios), só `https`, caminho exato `/inteiroTeor/<uuid>`
  (o link que vem da busca).
- **Regras lidas em 2026-10-29:** `robots.txt` do host responde 404 (erro em JSON): nenhuma regra publicada. Termos do
  tribunal (leitura do cartão Rede, ~15:40): «Política de Privacidade» (`https://www.tjba.jus.br/portal/politica-de-privacidade/`,
  sem data de vigência) e «Política de Privacidade e Cookies»
  (`https://www.tjba.jus.br/portal/politica-de-privacidade-e-cookies/`, «Última atualização: 27 de julho de 2026»):
  nenhuma cláusula sobre robôs ou coleta automatizada. Termo próprio da plataforma `jurisprudencia.tjba.jus.br`: **não
  verificado** (aplicativo, não lido). Limite do método: páginas achadas por busca na web restrita ao domínio e lidas
  por resumo, não pelo HTML bruto; sem vedação encontrada não equivale a autorização.
- **O que o Garimpo lê:** um GET na página do link (UA honesto, redirecionamento não seguido). A página é o próprio
  documento da decisão (cabeçalho do tribunal, processo, partes, ementa, acórdão, relatório e voto); o Garimpo guarda o
  texto inteiro dela se trouxer o cabeçalho «Tribunal de Justiça do Estado da Bahia», o número do processo do cabeçalho
  for o número CNJ da busca e o texto tiver pelo menos 200 caracteres. As imagens embutidas (`data:`) não viram texto.
  A página não tem campo de segredo de justiça: exceção justificada na declaração do tribunal (ADR-0034). Rótulo «texto
  do portal do tribunal (TJBA)», sem PDF nem recibo.
- **Freios:** pelo cliente único; 429/503 = espera e uma nova tentativa; recusa de novo abre o disjuntor do serviço `tjba`.
- **Prova (2026-10-29, cartão Rede, UA «Mozilla/5.0»):** 2 páginas, uma de Turma Recursal (17 KB, ~3,9 mil caracteres) e
  uma de Câmara Cível (132 KB com 4 imagens embutidas, ~14,8 mil caracteres), 200 `text/html` sem charset, sem login nem
  captcha. Com o UA do Garimpo: não verificado até a prova ao vivo curta.
- **Não verificado:** se o portal publica acórdão em segredo de justiça; termo próprio da plataforma de jurisprudência;
  limite de ritmo do host.

## eSAJ do TJMS (PDF do acórdão)

Usado por `obter_inteiro_teor` no TJMS (I-14 / G-21): o **PDF oficial** do acórdão pelo `getArquivo.do` do eSAJ, a mesma
técnica do TJSP (`baixarEsaj`), com o host do tribunal. Só PDF reconhecido vira inteiro teor, com recibo (ADR-0005).

- **robots.txt (lido em 2026-10-14, uma chamada por vez, UA do Garimpo, TLS válido):** `esaj.tjms.jus.br/robots.txt`
  não existe: devolve a página do aplicativo (HTTP 200 `text/html`), nenhuma regra publicada. `www.tjms.jus.br/robots.txt`
  redireciona (302) para `www5.tjms.jus.br/robots.txt`, o do site institucional (HTTP 200 `text/plain`): `User-agent: *`,
  `Allow: /`, mais `Disallow` só de áreas internas (`/intranet*`, `/webfiles*`, `/webmail*`, `/guardian*`, etc.); nada
  sobre `esaj` nem `cjsg`. A resposta 302 do `www` traz um link oculto (`/trap.html`) que o Garimpo **não** seguiu.
- **Termos de uso:** **não encontrados.** A raiz do eSAJ do TJMS é um aplicativo de página única sem texto de termos, e
  uma pesquisa pública não achou termos nem vedação a acesso automatizado do `esaj.tjms.jus.br` (a busca só trouxe termos de
  outros tribunais, que não valem aqui). Sem vedação encontrada ≠ autorização: fica **não verificado**.
- **Prova PV-05 (2026-10-14):** 1 busca no JurisprudênciaIA (TJMS, 3 resultados pedidos, 2 devolvidos) para obter um
  link real; 2 GETs do mesmo `getArquivo.do?cdAcordao=…&cdForo=0` (o 2º só para gravar o PDF e conferir a identidade):
  HTTP 200 `application/pdf;charset=UTF-8`, `%PDF-1.4`, 356 422 bytes, 9 páginas, sem redirect, sem cookie exigido, sem
  429/503/403. Conferência: a 1ª página traz o mesmo número de processo do registro da busca (apelação cível, 2ª Câmara Cível) e a
  data de criação do PDF (2026-04-27) coincide com a data de julgamento do registro. Essa coincidência de metadados
  não confirma a data da sessão no texto do acórdão: essa conferência fica **não verificada**. Nenhum PDF foi guardado
  no repositório.
- **Freios:** serviço `tjms` no disjuntor (regra 3 do `CLAUDE.md`); 403 ou desafio = recusa final, sem recomeço
  (G-21: o «recomeça após 4 s» do projeto de terceiros não foi copiado).
- **Não verificado:** que o TJMS aceita o endereço sem sessão em qualquer acórdão (visto em 1); o frescor e o formato do
  PDF dos demais; o limite de ritmo do portal (um projeto de terceiros cita 403 depois de ~50 downloads seguidos; o
  Garimpo fica muito abaixo); os termos de uso.

## eSAJ do TJCE (PDF do acórdão)

Usado por `obter_inteiro_teor` no TJCE (ticket b22-06): o **PDF oficial** do acórdão pelo `getArquivo.do` do eSAJ do
tribunal, mesmo desenho do TJSP/TJMS, mas num GET direto (sem a volta pela verificação de login). Só PDF reconhecido vira
inteiro teor, com recibo (ADR-0005). Fatos lidos em 2026-10-29 (matriz ao vivo dos TJs, local).

- **robots.txt (2026-10-29):** `esaj.tjce.jus.br/robots.txt` devolve HTTP 404 (página de erro do servidor): nenhuma regra
  publicada. Lido em chamada separada, antes de abrir o link.
- **Termos de uso (lidos pelo Rede em 2026-10-29, ~15:40):** a «Política de Privacidade para Navegação no Portal do TJCE»
  (`https://www.tjce.jus.br/lgpd/politica-de-navegacao-no-portal-do-tjce/`, sem data de vigência; rodapé «versão 1.198.0»)
  **não traz cláusula sobre robôs, crawlers, scraping ou coleta automatizada**; a única menção a «automatizado» é o
  tratamento automatizado do próprio tribunal (consulta unificada de processos e certidões). A página da pesquisa
  eSAJ (`esaj.tjce.jus.br/cjsg/consultaCompleta.do`) não traz aviso, termo ou condição de uso. Termos de aplicativos do
  tribunal (TJCE Mobile, SIMTJ Mobile), a Portaria 153/2026 (robôs **internos** do tribunal) e a Resolução do Órgão
  Especial 40/2022 apareceram na busca e não foram lidos por inteiro; nenhum veda robô de terceiros no portal.
  **Limite do método:** páginas lidas por ferramenta que resume (não o HTML bruto linha a linha); «não encontrado» não
  prova inexistência de outro texto. Sem vedação encontrada ≠ autorização.
- **Prova (2026-10-29):** 1 GET do link `esaj.tjce.jus.br/cjsg/getArquivo.do?cdAcordao=<n>&cdForo=0`: HTTP 200
  `application/pdf;charset=UTF-8`, `Content-Disposition: inline`, 716 192 bytes, PDF de 5 páginas, sem login, captcha ou
  bloqueio; cookie de sessão do portal enviado na resposta. O mesmo desenho do endereço em TJAL, TJAM e TJAC pede captcha:
  é configuração do eSAJ de cada tribunal, não do software; vale só para o TJCE.
- **Freios:** serviço `tjce` no disjuntor (regra 3 do `CLAUDE.md`); 403, captcha ou desafio = recusa final, sem recomeço. A frase «digite o código da figura» (a do eSAJ de TJAL, TJAM e TJAC), mesmo sem título, vale como página de desafio no TJCE.
- **Guarda do número do processo:** o PDF só é guardado se o cabeçalho «Processo: <CNJ>» da primeira página (antes de EMENTA, ACÓRDÃO, RELATÓRIO ou VOTO) for o número
  do processo do registro da busca (não vale qualquer ocorrência: o PDF de 19 páginas observado cita outros 6 CNJs no
  corpo); sem isso, ou sem número no registro, nada é guardado e a resposta diz «não verificado».
- **Conferência do Rede (2026-10-29):** 2 acórdãos (PDFs de 5 e 19 páginas, HTTP 200 `application/pdf`, sem captcha nem
  login); o cabeçalho «Processo:» da 1ª página é o número do registro da busca; têm EMENTA, ACÓRDÃO, RELATÓRIO e VOTO.
- **Não verificado:** que o PDF é sempre o acórdão assinado inteiro (visto em 2); o limite
  de ritmo do eSAJ do TJCE; redirecionamentos.

## Texto da base do JurisprudênciaIA (TJES e TJMA)

- **O que é:** no TJES e no TJMA, o registro da busca do JurisprudênciaIA traz o acórdão em HTML, embutido no campo do
  link como `data:text/html;base64,…`. Gravação do Rede em 2026-10-29 (tamanhos de 15 a 294 KB). Fonte: a própria resposta
  da busca; **nenhum host novo e nenhuma chamada nova**, então não há termo de uso nem `robots.txt` novo a ler (ADR-0017).
- **Como o Garimpo usa:** converte pela regra fixa (`html.ts`), guarda na memória (24 h) pelo id e serve pelo
  `obter_inteiro_teor`, `ler_inteiro_teor` e `conferir_citacao`, sempre com o rótulo «texto da base do JurisprudênciaIA,
  não oficial». O `data:` cru nunca vai à resposta. Decisão e limites: ADR-0035 (provisória).
- **Fixtures** (`tests/fixtures/texto-da-base-tjes.html`, `texto-da-base-tjma.html`): estrutura real, com todo o texto
  trocado por texto fictício (dígitos viram 9, imagens apontam para `exemplo.test`). As gravações brutas ficam fora do
  repositório. No TJMA o corpo real traz partes e advogados com OAB: nada disso entra no repositório.
- **Não verificado:** que o HTML seja sempre o acórdão inteiro; que o campo `data:` venha em todos os registros; que o
  texto confira com o do tribunal.

## Busca oficial do e-Proc do TRF4 (ementa e texto do portal do tribunal)

Usada por `busca_direta` com `tribunal: "trf4"` e por `obter_inteiro_teor` (D-07 / G-31, [ADR-0024](adr/0024-trf4-busca-oficial-do-eproc-e-texto-do-portal.md)).
Fonte pública do próprio tribunal, sem login nem captcha. Relatório de origem: `TICKETS/b18-investigacoes/trfs-eproc-cjf.md`.

- **Host:** `eproc-jur.trf4.jus.br` (serviço `trf4` no disjuntor). Rotas: `GET /eproc2trf4/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar`
  (formulário e cookie de sessão); `POST …?acao=jurisprudencia@jurisprudencia/listar_resultados` (corpo `txtPesquisa`,
  `rdoCampo=E`, `selOrigem[]=1`, `selTipoDocumento[]=1`, `chkAgruparResultados=on`, `hdnInfraPrefixoCookie=TRF4_Eproc_`);
  `GET …?acao=jurisprudencia@jurisprudencia/download_inteiro_teor&id_jurisprudencia=<id>&termosPesquisados=…`.
- **robots.txt (lido em 2026-10-14):** `eproc-jur.trf4.jus.br/robots.txt` 404 (sem regras); `www.trf4.jus.br/robots.txt` 200,
  `User-agent: *`, 75 `Disallow`, sem jurisprudência nem o host do e-Proc, **com `Disallow: /trf4/processos/`**.
- **Termos de uso (lidos em 2026-10-14):** Termos de Uso da Justiça Federal da 4ª Região (Res. 125/2021),
  https://www.trf4.jus.br/trf4/controlador.php?acao=pagina_visualizar&id_pagina=2201. Item 9, literal: «É de total
  responsabilidade do(a) Usuário(a) a utilização das informações a que teve acesso em qualquer site ou sistema da Justiça
  Federal da 4ª Região.» Os 10 itens e a Política de Privacidade (id_pagina=2200) não falam de robôs nem de coleta
  automatizada. A Política de Cookies (id_pagina=2202) **não foi lida**. Sem vedação ≠ autorização: **não verificado**.
- **Formato:** HTML `iso-8859-1`. Busca: total no campo oculto `hdnTotalResultado`; 10 resultados com ementa inteira, data
  de julgamento e de publicação; dois `data-link` por resultado (inteiro teor e «acompanhamento processual»). Inteiro
  teor: HTML inline do acórdão (relatório, voto, ementa, acórdão), com assinatura eletrônica (Lei 11.419/2006); partes
  por iniciais. Não é PDF.
- **O que o Garimpo chama:** só o host do e-Proc, https, rota `externo_controlador.php` (as 3 ações acima). O link de
  acompanhamento processual (`http://www.trf4.jus.br/trf4/processos/…`) **só é mostrado** (como `linkConsulta`, no
  texto exato que veio, sem https forçado) e nunca é chamado. `https://verificar.trf4.jus.br` só aparece como texto.
- **Rótulo:** «texto do portal do tribunal (TRF4)», sem recibo (não é o inteiro teor oficial, que é o PDF); fica 24 h na
  memória e é lido/conferido pelo id.
- **Freios:** pelo cliente único (UA honesto, 2 chamadas simultâneas no total, 429/503 com uma nova tentativa, recusa final
  abre o disjuntor `trf4`; sem intervalo mínimo próprio, limite de ritmo não verificado); busca = 2 chamadas (formulário + POST); inteiro teor = 2 (formulário + GET);
  redirecionamento não é seguido.
- **Validação da lista em 2026-10-14:** formulário e POST com termo acentuado em ISO-8859-1 confirmados (200), 10 cards
  `resultadoItem`, total 30196; links relativos com `&` cru antes dos campos, RELATOR/RELATORA e EMENTA após DECISÃO.
  Relatório: `TICKETS/b18-investigacoes/trf4-validacao-ao-vivo.md`. A fixture reproduz o recorte real com dados fictícios.
  Corrigidos e testados offline: id/link do vizinho, relator como ementa e perda do último card. O código corrigido
  não foi reexecutado na rede nesta revisão; o inteiro teor não foi baixado nessa validação adicional.
- **Leitor da lista:** isola os cards e campos rotulados `resLabel`/`resValue`, vincula id do link ao próprio card,
  exige total único inteiro e `min(total, 10)` blocos; divergência, campo ausente/duplicado, card truncado ou link
  ausente/ambíguo abortam a lista inteira com erro de formato, sem guardar acórdãos. Não descarta registros em silêncio.
- **Não verificado:** adaptador corrigido de ponta a ponta, download por ele nesta rodada, relação entre total,
  agrupamento e tamanho da página fora dos 10 cards observados; se a busca e o download dispensam o cookie;
  filtros do formulário (por isso recusados);
  TRU4, Turmas Recursais, varas; busca no inteiro teor; PDF oficial e rota `gerarPDFDocumento`; limite de ritmo; estabilidade do `id_jurisprudencia`;
  Política de Cookies; frescor além dos 10 itens de 13/10/2026; velocidade em relação ao STJ pelo JurisprudênciaIA (não medida).
## Busca oficial do e-Proc da TNU (ementa e texto do portal do tribunal)

Usada por `busca_direta` com `tribunal: "tnu"` e por `obter_inteiro_teor` ([ADR-0027](adr/0027-tnu-pelo-eproc-do-cjf.md)).
Mesmo módulo de jurisprudência do e-Proc do TRF4, em outro host; adaptador comum em `src/eproc.ts`. Leituras de 2026-10-19:

- **Host:** `eproctnu-jur.cjf.jus.br` (serviço próprio no disjuntor). Rotas: `GET /eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar`
  (formulário e cookie `PHPSESSID`), `POST …/listar_resultados` (mesmo corpo do TRF4: `txtPesquisa` em ISO-8859-1,
  `rdoCampo=E`, `selOrigem[]=1` = TNU, `selTipoDocumento[]=1` = Acórdão, `chkAgruparResultados=on`,
  `hdnInfraPrefixoCookie=TRF4_Eproc_`), `GET …/download_inteiro_teor&id_jurisprudencia=<id>`.
- **robots.txt:** 404 (sem regras). **Termos de uso:** não achados para este host (busca na web; `www.cjf.jus.br/cjf/termos-de-uso`
  = 404). Não verificado quanto a uso automatizado.
- **Prova:** busca «aposentadoria especial»: 200, HTML ISO-8859-1, 817 documentos, 10 cards, julgados de 30/09/2026; inteiro
  teor: 200, HTML, 143 KB, com «Conferência de autenticidade emitida em …».
- **Diferenças para o TRF4:** card sem «ÓRGÃO JULGADOR» e sem link de acompanhamento processual; pode ter «RELATOR PARA
  ACÓRDÃO»; o documento não traz «Documento eletrônico assinado por».
- **Termo de uso não achado: risco aceito pelo dono em 2026-10-19** («aceito o risco da TNU»), como no TRF4.

## Busca oficial do e-Proc do TRF2 (ementa e texto do portal do tribunal)

Usada por `busca_direta` com `tribunal: "trf2"` e por `obter_inteiro_teor` ([ADR-0028](adr/0028-trf2-pelo-eproc-do-tribunal.md)).
Mesmo módulo de jurisprudência do e-Proc do TRF4, no host do próprio TRF2; adaptador comum em `src/eproc.ts`. Leituras de 2026-10-19:

- **Host:** `eproc.trf2.jus.br` (serviço próprio no disjuntor). Rotas: `GET /eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar`
  (formulário e cookie `PHPSESSID`), `POST …/listar_resultados` (mesmo corpo do TRF4: `txtPesquisa` em ISO-8859-1,
  `rdoCampo=E`, `selOrigem[]=1` = TRF2, `selTipoDocumento[]=1` = Acórdão, `chkAgruparResultados=on`,
  `hdnInfraPrefixoCookie=TRF2_Eproc_`), `GET …/download_inteiro_teor&id_jurisprudencia=<id>`.
- **robots.txt:** 404 (sem regras; lido em 2026-10-14). A pesquisa traz `X-Robots-Tag: noindex` (não veda acesso).
- **Termo de uso:** Res. TRF2-RSP-2022/00032, art. 13, § 1º: «É proibida a utilização de robôs ou qualquer programa
  automatizado nos Portais sem expressa autorização.» **Decisão do dono (2026-10-19):** «a proibição não alcança o sistema
  de consulta de jurisprudência dele do TRF2». Sem autorização expressa do TRF2 (não pedida).
- **Prova:** busca «aposentadoria especial»: 200, HTML ISO-8859-1, 21122 documentos, 10 cards, julgados de 27/08/2026;
  inteiro teor: 200, HTML, 131 KB, com «Documento eletrônico assinado por …». Pelo Garimpo: busca em 0,9 s e inteiro
  teor em 0,6 s (uma medida só).
- **Diferenças para o TRF4:** host, rota e prefixo do cookie; o link de consulta processual é do próprio e-Proc
  (`acao=processo_seleciona_publica`) e **só é mostrado** (`linkConsulta`), nunca chamado. Card com «ÓRGÃO JULGADOR» e
  documento assinado, como no TRF4.
- **Não verificado:** limite de ritmo; estabilidade dos ids; TRU2 e Turmas Recursais; filtros avançados; PDF.

## Consulta pública de processo do Projudi do TJGO (texto do portal do tribunal)

Usada por `obter_inteiro_teor` com acórdão do TJGO
([ADR-0029](adr/0029-tjgo-inteiro-teor-pela-pagina-do-processo-no-projudi.md); estudo
[`estudos/2026-10-22-tjgo-inteiro-teor-pelo-projudi.md`](estudos/2026-10-22-tjgo-inteiro-teor-pelo-projudi.md)).
A busca segue no JurisprudênciaIA. Leituras de 2026-10-22:

- **Hosts:** `projudi.tjgo.jus.br` e o armazenamento `projudi-<ano>-prd.s3.tjgo.jus.br` (os dois no serviço `tjgo` do
  disjuntor). Rotas: `GET /BuscaProcesso?PaginaAtual=2&ProcessoNumero=<CNJ>` (página «Dados Processo», ISO-8859-1,
  cookie `JSESSIONID`), `GET /MovimentacaoArquivo?AJAX=ajax&PaginaAtual=8&Id_Movimentacao=<id>` (lista JSON dos
  arquivos da movimentação, com o cookie), `GET /BuscaProcesso?PaginaAtual=6&Id_MovimentacaoArquivo=<id>&hash=<hash>&id_proc=undefined`
  (302 para endereço assinado e temporário no armazenamento; o Garimpo segue esse salto só para lá).
- **robots.txt:** 404 (sem regras). **Termo de uso:** nenhum achado. **Verificação anti-robô:** Cloudflare Turnstile
  só no formulário de consulta pública (`PaginaAtual=4&TipoConsultaProcesso=24`), que o Garimpo não usa.
  **Decisão do dono (2026-10-22):** «pode seguir, prepara o ADR pra baixar pelo Projudi, se há como baixar, isso não é
  driblar, é uma parte sem robô uai». Sem autorização do TJGO (não pedida).
- **Vínculo com a busca:** o `Id_Arquivo` do `link_pdf` do site é o arquivo «Ementa» (tipo 124) da movimentação do
  julgamento; o «Relatório e Voto» (tipo 125) é outro arquivo da mesma movimentação. O «julgado em» que fecha a ementa
  do site coincide com a data e a hora da movimentação ou fica um segundo depois.
- **Formato:** arquivos em HTML (sem charset no cabeçalho); de 2020 a 2024 também `.html.p7s` (arquivo assinado): o
  Projudi responde 200 direto, `text/html;charset=iso-8859-1`, com o documento de dentro do envelope, e o Garimpo o lê
  (envelope cru também, com leitor próprio em `src/envelopeCms.ts`). Processo em segredo abre noutro leiaute, sem
  movimentações.
- **Prova pelo código:** 27 acórdãos distintos, 21 baixados com os `.p7s` (todos o julgamento certo), 6 com motivo;
  cerca de 1 s por acórdão. Erros esparsos do Projudi (500, 504, 555) sem recusa.
- **Não verificado:** limite de ritmo; arquivo bloqueado ao vivo; estabilidade do vínculo `Id_Arquivo` = «Ementa» fora
  da amostra.

## Exportação de repercussão geral do STF (script do mantenedor, I-33 / D-11)

- **Rota:** `https://portal.stf.jus.br/jurisprudenciaRepercussao/exportarDados.asp?` (o botão "Exportar Dados" de
  `todostemas.asp`). Usada só pelo modo `--baixar` do script do mantenedor, uma chamada por geração; não faz parte do pacote
  nem do servidor MCP.
- **robots.txt (lido em 2026-10-14, uma chamada, cliente único):** `https://portal.stf.jus.br/robots.txt` → 200,
  `text/plain`, `Last-Modified: Wed, 06 Apr 2022 18:04:14 GMT`. Trecho literal: `User-agent: *` / `Disallow: /processos`
  (e `User-agent: AhrefsBot` / `Disallow: /`). `/jurisprudenciaRepercussao/` não é alcançado.
- **Termos de uso:** não encontrados. A página-mãe `https://portal.stf.jus.br/repercussaogeral/` (200, 95.885 bytes, lida
  em 2026-10-14) não traz link nem texto de termos, licença, direitos ou privacidade. **Não verificado**; o fundamento
  continua o do ADR-0015 (Lei 9.610/98, art. 8º, IV).
- **Prova PV-16 (2026-10-14, 12:51 UTC):** 1 GET, UA de navegador (ADR-0020), `redirect: manual`, TLS válido: HTTP 200,
  `Content-Type: application / vnd.ms-excel; Charset=UTF-8`, 4.053.415 bytes, sha256
  `0cf56414955e2f708a9f478f715d6cacc254f697cedc8e826c387cd157732fce`. Sem login, desafio nem captcha. É a exportação
  válida: tabela HTML com o cabeçalho esperado (15 colunas), 1.492 temas (1 a 1.492), os mesmos 1.492 da tabela empacotada
  (gerada de uma exportação de 2026-10-10): nenhum tema a menos, nenhum a mais; 5 mudaram (situação nos temas 1486, 1488 e
  1489; título nos 1490 e 1492). Esse dado **não** regerou a tabela empacotada.
- **Descartes:** nenhum. O gerador não descarta tema: o tema sem título (1491) entra na tabela sem o campo e é listado
  no relatório de mudanças ("repercussão geral sem título"). Cada geração registra URL, data da obtenção, sha256 e essa lista.
- **Falha:** HTTP diferente de 200, redirecionamento, 429/503 depois da única nova tentativa, cabeçalho diferente, tema
  repetido, tabela ausente ou tema que some (trava de G-56) param antes de gravar: a tabela anterior continua e a via
  manual (arquivo salvo no navegador) segue valendo. Uma falha nunca atualiza `geradaEm` nem `conferidaEm`.


## Motivo do «só link» com prova própria (I-23 / G-24, DQ-24b)

O texto de `motivoLink` (src/tribunais.ts) só diz o motivo real onde o Garimpo tem prova própria, com a data; os demais
seguem «ainda não testou». Provas registradas em 14/10/2026 (STJ em 13/10/2026, seção D-18 acima), as de TJ reconferidas em 29/10/2026 abaixo:

- **STF:** `redir.stf.jus.br` respondeu 202 de WAF à leitura do `robots.txt`.

Provas de 29/10/2026 (matriz ao vivo dos TJs, local; leitura, sem contorno, de uma amostra por tribunal):

- **TJRJ:** termo de uso do portal veda robôs e coleta automática sem permissão expressa por escrito (reconferido).
- **TJSE:** `robots.txt` com `Disallow: /` e só `/portal` liberado (reconferido).
- **TJPE:** `robots.txt` de `www.tjpe.jus.br` com `User-agent: *` e `Disallow: /`.
- **TJRS:** `robots.txt` de `www.tjrs.jus.br` com `Disallow: /busca`; o endereço de dados da busca (`/buscas/jurisprudencia/`) começa por `/busca`.
- **TJSC:** a leitura do `robots.txt` de `eproc1g.tjsc.jus.br` devolveu página de bloqueio.
- **TJRO:** o endereço do acórdão em `juris.tjro.jus.br` devolveu HTTP 200 com script de verificação anti-robô, sem o acórdão.
- **TJAL, TJAM, TJAC:** o endereço do acórdão no eSAJ pede o código da figura (captcha) antes do texto.
- **TJAP:** o `robots.txt` de `tucujuris.tjap.jus.br` devolveu HTTP 403 com o desafio do Cloudflare.
- **TJPB:** os dois portais oficiais de jurisprudência estão barrados: `robots.txt` de `juris.tjpb.jus.br` com `Disallow: /` e `pje-jurisprudencia.tjpb.jus.br` com o desafio do Cloudflare (HTTP 403).
- **TJPA:** o endereço do documento abriu só a tela de pesquisa, sem o acórdão, e a pesquisa do portal não isola um acórdão pelo número do processo (antes, em 14/10: só a casca do aplicativo).
- **TJMT:** o serviço da pesquisa (`hellsgate.tjmt.jus.br`) respondeu HTTP 401 pedindo chave de API.
- **TJRN:** segue inconclusivo (busca do site com HTTP 504 em 09/10 e 14/10; nova tentativa de 29/10 também 504 no JurisprudênciaIA).

TRF6 não consta da tabela de tribunais do Garimpo; não foi tratado. O TRF2 entrou pelo e-Proc (ADR-0028).

## TCU (arquivos anuais de acórdãos, dados abertos)

Usado por `baixar_anos_tcu`, `pesquisar_acordaos_tcu` e `ler_acordao_tcu` ([ADR-0025](adr/0025-tcu-arquivos-anuais-baixados-pelo-usuario.md)).
O usuário baixa os anos que escolher, direto do TCU; a pesquisa é local. Leituras de 2026-10-14 (relatório
`TICKETS/b18-investigacoes/tcu-dados-abertos.md`, local):

- **Lista de arquivos:** `https://sites.tcu.gov.br/dados-abertos/jurisprudencia/arquivos/jurisprudencia-arquivos.csv`
  (1ª linha: data da última atualização; depois, arquivo e tamanho declarado). **Arquivo anual:**
  `https://sites.tcu.gov.br/dados-abertos/jurisprudencia/arquivos/acordao-completo/acordao-completo-<ano>.csv`
  (UTF-8, separador `|`, campos entre aspas, quebra de linha dentro do campo, 33 colunas; aceita `Range`; 300 a 500 MB
  nos anos recentes, ~7,6 GB no total; `ETag` e `Last-Modified`).
- **Dicionário:** `https://sites.tcu.gov.br/dados-abertos/jurisprudencia/dicionario-dados.html`. `SUMARIO` = "Resumo do
  conteúdo do Acórdão"; `RELATORIO` e `VOTO` só no tipo `ACÓRDÃO`; `INTERESSADOS` e `ADVOGADO` não são usados.
- **robots.txt** de `sites.tcu.gov.br`: `User-agent: *` não veda `/dados-abertos/`; robôs de IA nomeados têm
  `Disallow: /` (alerta no ADR-0025). O Garimpo não muda de User-Agent.
- **Termos:** `https://portal.tcu.gov.br/sobre-o-portal/termos-de-uso`: itens 2 a 4 (direitos reservados; uso comercial
  vedado sem permissão; republicação permitida citando fonte, título e autor). O conjunto não declara licença aberta:
  **nada do TCU vai no pacote**. Toda resposta cita "TCU, Acórdão N/AAAA – Colegiado, relator X; dados abertos do TCU,
  base de <data>".
- **Freios:** serviço `sites.tcu.gov.br` no disjuntor; um arquivo por vez; 429/503 pela regra geral; sem `-k`, sem
  seguir redirecionamento sozinho.
- **O que o Garimpo guarda:** `<pasta de dados>/tcu/acordao-completo-<ano>.csv` e um recibo ao lado (URL, bytes, sha256,
  `ETag`, `Last-Modified`, data do download). Só o que o usuário mandou baixar.
- **Validado em 2026-10-14:** lista BASE|ANO|TAMANHO|ARQUIVO, `DATASESSAO` dd/mm/aaaa e renovação condicional 304.
- **Não verificado:** link `pesquisa.apps.tcu.gov.br/redireciona/…`, retomada `If-Range` no CDN e anos anteriores a
  2025 (relatório e voto).

## Falcão: decisões monocráticas e sentenças dos TRTs (I-29 / G-38)

- **Rota:** a mesma do Falcão, `GET /jurisprudencia-nacional-backend/api/no-auth/pesquisa` com `colecao=decisoesmonocraticas`
  ou `colecao=sentencas` (nomes de coleção conhecidos pela literatura e confirmados ao vivo). Termos de uso e regras de
  acesso: [`fonte-falcao.md`](fonte-falcao.md). Só na `busca_direta` de um TRT, pela opção `decisoes`
  (`monocraticas` ou `sentencas`); sem a opção nada muda.
- **Prova PV-I29 (2026-10-14, 2 chamadas, pelo Cliente do Falcão, TRT2, texto genérico, página 0, `size=10`):** as duas HTTP 200,
  `x-rate-limit-remaining: 39`, `quantidadeTotal` 10000 nas duas, 10 documentos cada, sem 429. Campos observados:
  - **monocráticas** (373.806 bytes): `idDocumento`, `numeroProcesso`, `siglaClasseProcesso`, `classeProcesso`,
    `orgaoJulgador`, `idOrgaoJulgador`, `nomeRedator`, `tipoDocumento` ("Decisão"), `origemDocumento` (nos 10:
    `DECISAO_MONOCRATICA_2GRAU`), `tribunal`, `dataJuntada` (`dd/mm/aaaa`; **sem** `dataJulgamento`), `conteudoDocumento`
    (HTML com CSS), `textoDocumentoAnonim`, `highlight*`, `prioridades`, `score`. Sem `ementa` nem `relator`.
  - **sentenças** (931.907 bytes): `idSentenca`, `numeroProcesso`, `classeProcessual` (sigla), `classeProcessualPorExtenso`,
    `orgaoJulgador` (código numérico), `orgaoJulgadorPorExtenso` (vara), `nomeRelator` (vazio), `nomeRedator`,
    `tipoDocumento` ("Sentença"), `tribunal`, `dataJulgamento`, `dataJuntada`, `faseProcessual`, `textoSentenca`,
    `highlightSentenca`, `highlightSentencaAnonimizado`, `prioridades`, `score`.
- **O que o Garimpo devolve:** só metadados da 1ª página (até 10, respeitando o `limite` pedido): tipo, id `tribunal:coleção:id`, número (CNJ com a sigla
  da classe), classe, órgão, redator, `dataJuntada` e, na sentença, `dataJulgamento`. **Nunca o texto**: o campo "anonimizado"
  da sentença trazia nome de parte na prova (o nome da pessoa jurídica aparecia no começo do texto), então não é seguro
  como trecho. A decisão monocrática e a sentença não são acórdão (julgamento colegiado) nem precedente do art. 927 do CPC:
  não recebem `enquadramento927` e a resposta diz isso em `ressalvaDecisoes` e em cada item (`natureza`).
- **Freios:** uma chamada por busca, a mesma de qualquer busca do Falcão (UA de navegador, 1 s, freio preventivo, teto
  diário de 50). Sem busca guardada: repetir chama o Falcão de novo. Os filtros (`de`, `ate`, `relator`, `orgao`, `classe`),
  `somenteEmentas`, `ordenacao` e `precedentes` **não foram verificados** nessas coleções e são recusados com a opção.
- **Não verificado:** cobertura por TRT; frescor; outros TRTs além do TRT2 (o TST não tem sentenças); a coleção
  `recursorevista`; se o texto dessas decisões vem anonimizado de fato; rota de leitura do texto por id.

## Legislação: `normas.leg.br` (D-12 / I-43, ADR-0026)

Usada por `texto_de_lei`: o texto literal de um dispositivo de lei, sem afirmar vigência.

- **Verificado em:** 2026-10-14 (13:09–13:14 UTC), UA honesto do Garimpo, uma chamada por vez.
- **`https://normas.leg.br/robots.txt`:** 200 `text/plain`, 25 bytes: `User-agent: *` / `Allow: /`.
- **Licença e termos:** a resposta da norma declara `license` e `sdLicense` = https://creativecommons.org/licenses/by/4.0/
  (CC BY 4.0: citar a fonte). A política de uso do portal do Senado
  (https://www12.senado.leg.br/institucional/documentos/politica-de-uso-do-portal-do-senado-federal, lida em 2026-10-14;
  `www12.senado.leg.br/robots.txt`: `User-agent: *` / `Disallow:` vazio) diz, literal: "Todo o conteúdo deste Portal é de
  propriedade autoral do Senado Federal, mas pode ser utilizado pelos usuários, desde que seja citada a fonte e para fins
  lícitos." e "O cidadão só tem o direito de acessar o conteúdo que é disponibilizado ao público em geral no Portal."
- **Rota:** `GET https://normas.leg.br/api/public/normas?urn=urn:lex:br:federal:lei:2015-03-16;13105&&tipo_documento=maior-detalhe`
  (a forma que o site monta; não é API documentada). 200 `application/json`, 4,1 MB para o CPC. Pedir um dispositivo
  pela URN (`...!art186`) devolve só `{"urn": ...}` — por isso a consulta é sempre da norma inteira.
- **Formato (JSON-LD):** raiz com `headline`, `dateModified` (CPC: 2025-03-13), `sdDatePublished` (2026-04-08) e `hasPart`
  aninhado; cada dispositivo tem `legislationIdentifier` (`...!art85_par2_inc1`) e `workExample` (um objeto ou uma lista
  de redações com `legislationDate`, `legislationType` — Original_Version, Text_Change_Version, Insertion_Version,
  Repeal_Version, Court_Decision_Version —, `text`, `legislationConsolidates`, `publisherNote`, `temporalCoverage` e
  `legislationLegalForce`, ex. `NotInForce`). Revogado: a redação com `Repeal_Version` traz o texto "(Revogado)" e a
  redação anterior fica na lista. O Garimpo mostra essas marcas **como a fonte as dá**, sem concluir vigência.
- **Provado ao vivo (PV-20):** CPC art. 85 (caput, §§, incisos), art. 12 (alterado), art. 945 (revogado), art. 85 § 19
  (decisão judicial anotada). Provas sem sucesso, registradas: `www.planalto.gov.br/robots.txt` → conexão derrubada
  (reset) ao UA honesto; `legis.senado.leg.br/robots.txt` → 403 "Request forbidden by administrative rules". Nenhum dos
  dois é usado.
- **Freios:** serviço `normas.leg.br` no disjuntor (o host), 1 s entre chamadas, 2 vagas somadas, 429/503 pela regra
  geral. **Guarda:** por 24 h na memória, só o dispositivo reduzido, com a data da obtenção original.
- **Ampliação (2026-10-14, I-43/D-12), uma chamada por diploma, URN do documento inteiro, 200 application/json, cliente
  único com freios e UA honesto:**
  `.../normas?urn=urn:lex:br:federal:lei:2002-01-10;10406&&tipo_documento=maior-detalhe` (CC, 5,3 MB, `dateModified`
  2024-06-28): provados art. 186 (redação original com `NotInForce` 2002-01-10/2024-05-21 e redações da ADI 7.055 com a
  nota "Foi conferida interpretação conforme a Constituição ao caput dos arts. 186 e 927...") e art. 229 (`Repeal_Version`
  "(Revogado)" pela Lei 13.105/2015);
  `.../normas?urn=urn:lex:br:federal:constituicao:1988-10-05;1988&&tipo_documento=maior-detalhe` (CF, 4,7 MB,
  `dateModified` 2026-05-05): provado art. 5º, caput, literal. Siglas: `CC`, `CF`.
  `.../normas?urn=urn:lex:br:federal:lei:1990-09-11;8078&&tipo_documento=maior-detalhe` (CDC): 200 com 8 KB, só
  metadados (sem `hasPart` nem texto) — **não provado, fora da lista**; com o teto de 3 chamadas não houve nova
  tentativa. Alguns textos trazem marcação da fonte embutida (ex.: `<span ... xlink:href=...>Constituição</span>` em CF
  art. 5º, I), repassada como veio.
- **Ampliação do B1.4 (2026-10-23): CP, CPP, CLT e CDC, lidos da compilação "Current".** A resposta da norma desses
  quatro vem sem `hasPart` (sem a árvore de dispositivos), mas traz em `encoding` os arquivos de texto da norma, cada um
  com a versão que a fonte marca.
  - **Prova de levantamento (2026-10-23, 11:55:54–11:56:37 UTC),** cliente único com os freios, UA honesto, uma chamada
    por vez: 8 chamadas, todas 200, sem 429/503 e sem redirecionamento.

    | Diploma | URN | JSON `maior-detalhe` | HTML "Current" (`/api/public/binario/<uuid>/texto`) |
    |---|---|---|---|
    | CP | `urn:lex:br:federal:decreto.lei:1940-12-07;2848` | 4.087 B | `412689ff-f565-494a-9adb-8301e314f40d`, 836.969 B |
    | CPP | `urn:lex:br:federal:decreto.lei:1941-10-03;3689` | 5.887 B | `f673d457-87d9-45cb-b467-a3d59aaaad4e`, 1.690.323 B |
    | CLT | `urn:lex:br:federal:decreto.lei:1943-05-01;5452` | 12.865 B | `5e35b26e-26a7-44d7-8a95-b8f0852cabe1`, 1.600.591 B |
    | CDC | `urn:lex:br:federal:lei:1990-09-11;8078` | 8.090 B | `1cc33b77-e5a0-4723-b7fa-ec501fd65c46`, 181.767 B |

  - **Rota:** a mesma resposta da norma (`.../normas?urn=<URN>&&tipo_documento=maior-detalhe`) e, nela, o item de
    `encoding` com `version: "Current"` (`additionalType: "CompilacaoMonoVigenteNaCD"`, `encodingFormat` text/html,
    `contentUrl` absoluto `https://normas.leg.br/api/binario/<uuid>/texto`). O arquivo é baixado pela forma pública do
    mesmo endereço, `https://normas.leg.br/api/public/binario/<uuid>/texto` (200 `text/html`, sem charset no cabeçalho;
    o `<meta>` declara UTF-8); a forma sem `public` não foi testada. São **2 chamadas por consulta**, 1 s entre elas.
    O Garimpo só segue com **uma** versão "Current", em HTML, com `contentUrl` https no `normas.leg.br` e caminho
    `/api/binario/<uuid>/texto`; não segue redirecionamento, decodifica pelo charset declarado e exige a identidade da
    URN e a URL da norma antes de baixar o arquivo. Outra coisa é formato inesperado, nunca texto.
  - **Marca de valor legal:** todas as versões listadas em `encoding` trazem `legislationLegalValue:
    "UnofficialLegalValue"`; só o `isBasedOn` da publicação original (o DOU) diz `OfficialLegalValue`. A resposta repete a
    marca **literal** (`arquivoDaFonte.valorLegalMarcadoPelaFonte`), com a URL do arquivo, `versaoNaFonte: "Current"` e o
    `tipoNaFonte`. A URL oficial é a **da norma** (`https://normas.leg.br/?urn=<URN>`), não a do dispositivo, e não há
    `versoesNaFonte`: a compilação traz só o texto compilado, com as notas de alteração dentro dele ("(Inciso acrescido
    pela Lei nº ...)"), repassadas como vieram.
  - **Leitura do HTML (regra fixa, sem IA):** o arquivo é gerado pelo Aspose.Words; cada `<p>`, `<h1>`–`<h6>` ou célula é
    um parágrafo, e o `<br>` fica dentro dele como quebra de linha. O texto vai do parágrafo exato de início, único no
    arquivo (o título da norma; na CLT, "CONSOLIDAÇÃO DAS LEIS DO TRABALHO"), ao fecho ("Rio de Janeiro|Brasília,
    <data>; ...º da Independência ..."); o que vem depois (as assinaturas) fica de fora, e sem início ou sem fecho é
    formato inesperado. Rótulos: "Art.", "Arts. X a Y." (faixa), "§", "Parágrafo único.", inciso romano com travessão e
    alínea "a)", inclusive alínea direto no caput ou no § (CLT). Cabeçalho estrutural (PARTE, LIVRO, TÍTULO, CAPÍTULO,
    Seção ou Subseção com o número) encerra o artigo. **Título solto** (a rubrica, o nome jurídico): linha sem rótulo,
    com maiúscula no começo, sem pontuação no fim e até 200 caracteres (sem os parênteses do fim), seguida de rótulo, de
    cabeçalho, do fecho ou de outro título solto; ela e a nota só entre parênteses logo depois ficam fora do texto.
    "Pena -" é do caput ou do § (não do inciso) e, depois dos incisos, vem numa parte própria, na ordem da fonte.
    Parágrafo que abre aspas no começo e não fecha é texto de outra norma até as aspas fecharem (artigo novo ou cabeçalho
    também fecham). Rótulo com número ilegível separa os dispositivos, mas o pedido pelo número fica "não verificado".
    Duas ocorrências da mesma identificação: "identificação necessária", com o rótulo e o primeiro parágrafo de cada.
  - **Armadilhas da fonte (todas com teste sobre recorte saneado):** a CLT começa pelo decreto-lei, com arts. 1º e 2º
    próprios, e por isso só é aceita pela sigla e pelo nome; faixas "Arts. 22 a 24. (Revogados ...)" (11 na CLT, 4 no
    CPP); sufixo duplo no CP ("Art. 359-M-A."); erros de digitação da fonte ("Art. l97." no CP, "§ lº" no art. 682 da
    CLT); hífen invisível (U+00AD) antes de "I - na admissão;" (CLT, art. 168); tabela no art. 580 da CLT, com `<br>`
    dentro das células; texto de outra lei entre aspas no CDC (arts. 110 a 117, aspas abertas do § 4º ao § 6º no
    art. 113); rubricas em `<h1>`–`<h6>`; linhas sem rótulo que **são** texto (juramento do art. 472 e quesito do
    art. 483 do CPP, as 24 regiões do art. 674 e o parágrafo partido do art. 791-A da CLT, "(VETADO ...)" solto no CP).
    O `<head>` traz nome de pessoa (autor do documento) e o fim do arquivo, as assinaturas: nenhum dos dois vai para
    fixture nem para a resposta.
  - **Prova offline nos textos inteiros** (os mesmos arquivos, com o código do B1.4 e sem rede): todo rótulo de artigo
    legível foi achado pelo número (CP 433; CPP 832, mais as 4 faixas; CLT 933, mais as 11 faixas; CDC 131), sem
    identificação repetida; ilegível, só o "Art. l97." do CP. Ficaram fora do texto 399 parágrafos no CP, todos rubricas
    ou a nota delas, e 1 no CPP ("Juiz das Garantias (Denominação acrescida ...)"); ficaram dentro, sem rótulo e fora as
    penas, exatamente as linhas das armadilhas acima (CP 3, CPP 4, CLT 47, CDC 10). Leitura local de uma consulta fria:
    7 ms (CDC) a 38 ms (CLT), mediana de 7 rodadas; o tempo real é o das 2 chamadas.
  - **Teste ao vivo final (`GARIMPO_VIVO=1`, 2026-10-23, 13:11:53–13:12:43 UTC):** 9 chamadas (1 do CPC e 2 de cada
    diploma novo, cada arquivo baixado uma vez para as várias consultas), todas aceitas; os 5 testes passaram. Os uuids
    dessa rodada não foram registrados.
  - **Freios e guarda:** os mesmos da rota da norma (serviço `normas.leg.br`, 1 s entre chamadas, 2 vagas somadas, 429/503
    pela regra geral); a consulta repetida volta da memória (24 h), só o dispositivo reduzido, com a data da obtenção
    original. Datas da fonte: os quatro vêm sem `dateModified`; `sdDatePublished` CP 2026-10-02, CPP 2026-08-18, CLT
    2026-04-16, CDC 2026-10-09.
  - **Referência de técnica (regra 1):** o repositório `github.com/ctresb/leis` (scripts em Python; o LICENSE traz o texto
    da MIT, que vale "ao código em scripts/", e uma nota de que os textos das normas são atos oficiais; o GitHub o
    classifica como "Other") foi lido como referência de técnica no parecer do plano 1.2, em 2026-10-23: o caminho
    `encoding` → `contentUrl` → `/api/public/binario/`. Nada foi copiado: o código do Garimpo é escrito do zero, e a rota
    foi conferida de forma independente nas provas acima.
- **Não verificado:** os demais diplomas (cada um pede uma prova ao vivo curta e uma linha na tabela); atualidade da
  compilação (a fonte informa `dateModified` na rota da norma: CPC 2025-03-13, CC 2024-06-28, CF 2026-05-05; ausente
  nos quatro da compilação); se o texto compilado confere com a publicação oficial, que a fonte não afirma
  (`UnofficialLegalValue`); a pena depois de inciso que seja só daquele inciso (no CP, só no art. "l97", ilegível), que
  o Garimpo põe no caput ou no §.
