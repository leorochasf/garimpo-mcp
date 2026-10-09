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
- **Freios:** serviço `datajud` (API e wiki) no disjuntor; intervalo mínimo de 0,5 s entre chamadas ao mesmo host, para
  todas as janelas (termo, 3.13: até 120 por minuto); 429/503 pela regra geral (espera e uma nova tentativa). A API
  respondeu em 19 s na medição de 2026-10-09, sem cabeçalho de limite de taxa.
- **O que o Garimpo guarda:** por até 24 h, na memória do Garimpo, só a resposta reduzida que a ferramenta mostra
  (códigos, nomes, datas e órgãos dos movimentos de julgamento), com a fonte e o momento da obtenção; nunca a resposta
  bruta. A ferramenta não busca por nome de parte.
- **Pendências do dono (bloqueiam a publicação, não o código):**
  1. se o uso por advogado em atividade profissional cabe em "não comerciais" (3.3) — **não verificado** com o CNJ;
  2. o alcance de "não distribuir [...] qualquer informação derivada dela" (3.8) para uma ferramenta que mostra o dado
     ao próprio usuário;
  3. dar ciência ao CNJ quando o Garimpo for publicado (3.9).
