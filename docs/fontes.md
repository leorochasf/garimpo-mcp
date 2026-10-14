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
no Diário de Justiça Eletrônico Nacional — metadados e link, nunca o texto. São comunicações do processo, **não um
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
  e link (só se for https). **Nunca** `texto`, `destinatarios`, `destinatarioadvogados`, nomes de advogado ou OAB —
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
- **O que o Garimpo guarda:** por até 24 h, só a lista reduzida acima (sem texto e sem nomes), com a fonte e o momento
  da obtenção.

## Espelhos de Acórdãos do STJ (Portal de Dados Abertos)

Fonte do **índice "dispositivo legal → acórdãos do STJ"** ([ADR-0022](adr/0022-indice-de-dispositivo-legal-pelos-espelhos-de-acordaos-do-stj.md)).
Gerado só pelo mantenedor e levado no pacote como fotografia datada; o usuário nunca baixa o acervo. **Nenhum código
de rede para esta fonte existe ainda**; esta entrada precede o gerador (ADR-0017).

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
  registro só vale se o `uuid` for o do link e, quando a busca trouxe o número CNJ, o `processo` for o mesmo; senão, texto
  **não verificado** e nada é guardado. `segredoJustica` verdadeiro ou `possuiInteiroTeor` falso = sem texto. Busca por
  `uuid` ou pelo número CNJ no `query` não devolveu o registro (primeira prova do ticket 02 e prova de 2026-10-14).
- **Freios:** serviço `tjdft` no disjuntor (regra 3 do `CLAUDE.md`); freio preventivo pelo restante que a API informa em
  cada resposta (`x-ratelimit-limit: 60`, `x-ratelimit-remaining`, `x-ratelimit-reset` em segundos), o mesmo desenho do
  Falcão (`src/freio.ts`): na reserva, pausa em todas as janelas. UA honesto do Garimpo, aceito sem desafio nem login.
- **O que o Garimpo guarda:** por até 24 h, na memória, só o texto do acórdão pelo id; nunca a resposta bruta.
- **Não verificado:** o que a janela da cota mede além de «60 por minuto» (visto: `reset` em segundos); se `query` com
  palavra da ementa casa sempre (visto em 1 acórdão: «apelação»); a combinação `identificador` + `retornaInteiroTeor` numa
  só chamada ao vivo (cada uma vista em chamada separada); o frescor da base.
