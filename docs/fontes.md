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
- **Pendências do dono (bloqueiam a publicação, não o código):**
  1. se o uso por advogado em atividade profissional cabe em "não comerciais" (3.3) — **não verificado** com o CNJ;
  2. o alcance de "não distribuir [...] qualquer informação derivada dela" (3.8) para uma ferramenta que mostra o dado
     ao próprio usuário;
  3. dar ciência ao CNJ quando o Garimpo for publicado (3.9).

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
