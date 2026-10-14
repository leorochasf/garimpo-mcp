# TCU: acórdãos pelos arquivos anuais de dados abertos, baixados pelo usuário e pesquisados no computador dele

_Decidido pelo dono em 2026-10-14, sobre D-08 (Sol, 2026-10-13); leitura do robots.txt aceita pelo piloto na mesma data._

O Garimpo passa a pesquisar acórdãos do Tribunal de Contas da União nos **arquivos anuais de acórdãos completos** dos
dados abertos do TCU (`acordao-completo-<ano>.csv`). O usuário escolhe quais anos baixar; o Garimpo baixa direto do TCU
para o computador do usuário e pesquisa lá, sem rede. Fonte e termos: `docs/fontes.md`.

- **O usuário escolhe o recorte e é avisado antes de baixar:** que precisa baixar, o tamanho por ano (300 a 500 MB nos
  anos recentes; acervo inteiro cerca de 7,6 GB) e a pasta onde fica. Nunca se baixa o acervo por padrão; download só
  por ação explícita (`confirmar`). Um ano por vez, retomável, pelo cliente único com os freios da regra 3.
- **Sem redistribuição.** O conjunto não declara licença aberta; valem os termos do Portal TCU (uso comercial vedado sem
  permissão; republicar conteúdo público citando fonte, título e autor). Como cada usuário baixa direto do TCU, o
  Garimpo não empacota nem repassa os dados: o código é MIT, os dados não vão no pacote.
- **robots.txt.** Para `User-agent: *` nada veda `/dados-abertos/`; o User-Agent honesto do Garimpo cabe nessa regra e
  não muda. **Alerta registrado:** o mesmo arquivo veda por inteiro robôs de IA nomeados (entre eles `ClaudeBot`,
  `ChatGPT-User`, `GPTBot`). O Garimpo é operado por assistentes de IA; a leitura literal aceita o acesso, e o
  download só acontece a pedido do usuário. Se o TCU passar a vedar `*` em `/dados-abertos/`, a fonte sai.
- **Campos.** `SUMARIO` é "sumário", nunca "ementa". Relatório e voto só existem no tipo `ACÓRDÃO`; o acórdão de
  relação traz só o texto (`ACORDAO`), e a resposta diz isso. `INTERESSADOS` e `ADVOGADO` (LGPD) não são indexados nem
  mostrados. `SITUACAO` aparece em toda resposta; acórdão `INVALIDADO` ou sigiloso não entra como texto válido.
  O voto e o relatório podem citar nomes de pessoas no corpo; é o texto oficial publicado, e a ferramenta avisa.
- **Atualização.** Ano baixado não é baixado de novo; a renovação (corrente ou fechado, o TCU regravou até o de 2025) é
  ação explícita, com pedido condicional (`ETag`/`Last-Modified`). Toda resposta traz a data da base (atualização no TCU
  e data do download). Falha na renovação preserva a cópia anterior.

## Opções consideradas

- Busca do portal por pergunta (`pesquisa.apps.tcu.gov.br`, backend não documentado): rejeitada (D-08).
- Webservice `recupera-acordaos`: não traz relatório nem voto, só sumário e links; fora.
- Empacotar os dados no npm: rejeitado (sem licença aberta declarada).
- Arquivo de "visão geral" gerada por IA (`acordao-completo-resumo.csv`): fora; não é texto oficial.

## Consequências

- Três ferramentas novas: `baixar_anos_tcu`, `pesquisar_acordaos_tcu`, `ler_acordao_tcu`. Servem a ADR-0017 (fonte
  além do JurisprudênciaIA); a resposta rotula a origem como arquivo de dados abertos do TCU.
- O disco do usuário fica com arquivos grandes em `<pasta de dados>/tcu/`; o aviso prévio é parte do contrato.
- Relatório, voto e sumário que o TCU classificou como sigilosos (o arquivo traz só o aviso do art. 108, § 1º, da Lei
  8.443/1992) são reconhecidos: o acórdão continua listado com o texto `ACORDAO`, a resposta marca `partesSigilosas` e
  `temRelatorioEVoto: false`, e a leitura diz "classificados como sigilosos pelo TCU" em vez de entregar o aviso como texto.
- A pesquisa também avisa que o texto oficial cita nomes de pessoas e que o Garimpo não os retira (`avisoNomes`).

## Validação ao vivo (2026-10-14)

Uma linha de rede, `sites.tcu.gov.br`, pelo cliente único. Bateu com o desenho; o que mudou foi o que está acima
(aviso de sigilo, aviso de nomes na pesquisa) e a fixture da lista, que agora segue o formato real.

- **Lista de anos:** 200, 5.945 bytes, UTF-8; cabeçalho `"BASE"|"ANO"|"TAMANHO"|"ARQUIVO"`, coluna `BASE` antes do ano,
  linhas fora de ordem, uma linha do resumo por IA com ano vazio e linhas de outras bases (Súmulas em KB). 35 anos
  (1992–2026), 7.595,57 MB no total; `MB` é MiB.
- **Download de 2025:** 413.563.594 bytes (= 394,40 MB da lista) em 17,0 s; RSS de pico ~90 MB. Renovação por pedido
  condicional: 304, sem baixar de novo.
- **Arquivo de 2025:** 18.588 registros (12.304 de relação, 6.284 comuns); 99 `INVALIDADO` e 11 sigilosos ficam de fora
  (110 contados); `INTERESSADOS`/`ADVOGADO` nunca chegam à memória. 9 acórdãos oficializados com `SUMARIO`/`RELATORIO`
  (e 4 com `VOTO`) substituídos pelo aviso de sigilo.
- **Varredura:** 7,0 a 19,4 s por ano por pesquisa (arquivo de 2025, um processo por consulta); memória em fluxo (a
  pesquisa termina igual com o heap travado em 128 MB).
- **Não verificado:** o link oficial por chave (`pesquisa.apps.tcu.gov.br`, host não liberado) e a retomada por `Range`
  + `If-Range` ao vivo.

## Decisão de velocidade (1.0)

Mantém-se a **varredura por arquivo**, sem índice local: com 10 anos baixados uma pesquisa levaria de 1 a 3 minutos.
Para a 1.0 o custo é **dito, não escondido**: o aviso de baixar diz que cada ano baixado acrescenta cerca de 10 a 20 s a
cada pesquisa e recomenda poucos anos; a pesquisa devolve `anosPercorridos` e `tempoSegundos`. O índice local fica para
o ticket de cache forte e índice local (b19-velocidade), que recebe estes números como caso de uso.
