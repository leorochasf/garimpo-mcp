# TJGO: inteiro teor pela consulta pública do processo no Projudi

_Proposto pelo worker da missão «Encontrei forma de acessar processo» (Claude), em 2026-10-22, a partir de decisão do
dono da mesma data sobre o estudo
[`docs/estudos/2026-10-22-tjgo-inteiro-teor-pelo-projudi.md`](../estudos/2026-10-22-tjgo-inteiro-teor-pelo-projudi.md)._

O link do TJGO já abre a página pública do processo no Projudi pelo número CNJ (commit `4bca673`). O estudo mostrou que,
a partir dessa página, os arquivos do acórdão abrem sem login, em HTML, e concluiu: tecnicamente viável, inviável pelas
regras de então, porque o formulário oficial de consulta pública do Projudi exige a verificação anti-robô (Cloudflare
Turnstile) e o caminho do link direto chega ao processo sem passar por ela. O estudo deixou a decisão para o dono.

## Decisão do dono (2026-10-22)

Palavras do dono: **«pode seguir, prepara o ADR pra baixar pelo Projudi, se há como baixar, isso não é driblar, é uma
parte sem robô uai»**.

Fundamento do dono: o caminho do link direto do processo é público e não tem verificação anti-robô; usá-lo não é
contornar a verificação, que fica só no formulário de busca, que o Garimpo não usa. O Garimpo passa a baixar o inteiro
teor do TJGO por esse caminho com base nessa decisão. Ela é a leitura do dono sobre o caminho público, não autorização
do TJGO; nenhuma autorização foi pedida nem recebida.

## O que foi visto (2026-10-22, além do estudo)

Chamadas pelo cliente do Garimpo, uma por vez, com pausa, sobre processos que buscas genéricas do Garimpo devolveram
(números, nomes e endereços assinados fora deste documento, regra 2 do `CLAUDE.md`).

- O `link_pdf` que o JurisprudênciaIA devolve (`ConsultaJurisprudencia?…&Id_Arquivo=<n>`) aponta para o arquivo
  **«Ementa»** da movimentação do julgamento: o redirecionamento desse arquivo na página do processo leva a
  `…/id_<n>_ementa.html`, com o mesmo `<n>`. O «Relatório e Voto» da mesma movimentação veio como `id_<n+1>_…` nas três
  amostras, o que resolve a observação do estudo (o link do site é o da ementa, não o do relatório e voto).
- Processo com três movimentações de julgamento, uma delas de embargos de declaração (o acórdão que a busca achou): a
  data e a hora do «julgado em» da ementa casaram com uma só, a dos embargos, e o `Id_Arquivo` do site casou com a
  ementa dela.
- A hora do «julgado em» da busca veio igual à da movimentação ou **um segundo depois** (três casos:
  «15:51:36» × «15:51:35», «07:32:55» × «07:32:54», «15:49:00» × «15:48:59»).
- O «Relatório e Voto» nem sempre repete a ementa: em duas amostras com o `Id_Arquivo` já amarrado, menos da metade
  da ementa da busca estava nele; a ementa está no arquivo «Ementa» do mesmo julgamento.
- Em um agravo de instrumento de 2025, o «julgado em» da busca era a data e a hora da **sessão** (10:00:00), e o
  julgamento foi lançado quatro dias depois: nada no instante, não baixa.
- Ementa com «julgado em DD/MM/AAAA 00:00:00» (apelação criminal de 2022): nenhuma movimentação no instante; a data
  era a da sessão, e o julgamento lançado dias depois. Sem hora, não há casamento seguro.
- Arquivos de 2020 a 2024 vieram como `.html.p7s` (arquivo assinado, PKCS#7/CMS). O Projudi os entrega com 200
  direto, sem redirecionamento e sem o id no endereço: o corpo já é o documento de dentro do envelope, em HTML
  ISO-8859-1 (visto em 2026-10-22, por ordem do dono de 2026-10-22: «pode fazer a leitura dos .p7s também»).
- O Projudi respondeu com erros esparsos sem recusa (504, 555, 500, 404) a chamadas que funcionaram minutos antes ou
  depois.

- **Verificação real pelo código (2026-10-22):** 27 acórdãos distintos do TJGO de buscas genéricas (apelação cível e
  criminal, agravo de instrumento, embargos de declaração, família, fazenda pública; de 2020 a 2026), um por vez. Com a
  leitura dos `.p7s`: 21 baixados, todos o julgamento que a busca achou, inclusive em processos com 3, 4, 5 e 9
  julgamentos (antes dela, 13); 6 não baixados, com o motivo (4 ementas sem hora ou com 00:00:00, 1 hora da sessão, 1
  processo em segredo). Erros HTTP do Projudi (504, 555) apareceram e sumiram ao repetir. Nenhum acórdão de outro
  julgamento foi entregue.

## Decisões

- **Rótulo:** «texto do portal do tribunal (TJGO)», como TJPI, TRF2 e TRF4 (DQ-06, ADR-0021, ADR-0024): HTML convertido
  em texto, guardado na memória por 24 h pelo id do acórdão, lido e conferido pelo id. Sem PDF, sem recibo; o Garimpo
  não confere assinatura.
- **Freios (regra 3):** tudo pelo cliente único: no máximo 2 chamadas simultâneas somadas a todas as fontes; 429/503 com
  espera e uma nova tentativa; recusa final abre o disjuntor do serviço `tjgo` (o Projudi e o armazenamento do TJGO
  caem no mesmo serviço) em todas as janelas. UA honesto do Garimpo; nenhum login, captcha, proxy nem UA de navegador.
- **Caminho, em série:** (1) página pública do processo (`BuscaProcesso?PaginaAtual=2&ProcessoNumero=<CNJ>`), que dá a
  sessão; (2) lista de arquivos da movimentação do julgamento (`MovimentacaoArquivo?AJAX=ajax&PaginaAtual=8&…`), com
  o cookie da sessão, como o navegador; (3) o arquivo «Ementa» e (4) o endereço assinado para onde ele redireciona;
  (5) o arquivo «Relatório e Voto» e (6) o endereço assinado dele. Seis chamadas por acórdão (quatro se a
  movimentação não tiver «Ementa»); texto já na memória = nenhuma. O texto guardado é a ementa do julgamento seguida
  do relatório e voto, cada um convertido como veio.
- **Redirecionamento (exceção à ADR-0024, como a do TJTO na ADR-0021):** o Garimpo segue **um** salto, só do arquivo
  do Projudi para o armazenamento do próprio TJGO: https em `projudi-<ano>-prd.s3.tjgo.jus.br`, no caminho
  `…/id_<n>_ementa.html` ou `…/id_<n>_relatorio_voto_acordao.html`. Outro host, outro caminho ou outro salto = não baixa. O cookie do Projudi não
  vai para o armazenamento.
- **Julgado exato, nunca outro do mesmo processo:** o processo pode ter vários acórdãos (apelação, embargos de
  declaração, agravo interno, embargos dos embargos). O Garimpo só entrega o texto quando tudo isto vale:
  1. a ementa da busca termina com «julgado em DD/MM/AAAA HH:MM:SS», com hora diferente de 00:00:00;
  2. exatamente **uma** movimentação «Julgamento -> …» da página tem essa data **e** hora, a até 1 s (duas ou mais
     nessa janela = ambíguo);
  3. a lista dessa movimentação tem um só «Relatório e Voto» (`relatorio_voto_acordao.html`) e no máximo uma «Ementa»,
     de acesso público (nível 1) e válidos;
  4. com o `Id_Arquivo` da busca, a «Ementa» dessa movimentação redireciona para `id_<Id_Arquivo>_ementa.html`;
  5. a ementa e o relatório e voto baixados trazem o número CNJ do processo e a maior parte da ementa da busca
     (trechos de 40 letras e algarismos, sem acento nem pontuação; ao menos metade presente).
  Falhou um item: não baixa, não guarda nada e devolve o link do processo com o motivo.
- **Arquivo assinado (`.p7s`):** o Garimpo lê o documento embutido, sem conferir a assinatura (o rótulo segue «texto
  do portal do tribunal (TJGO)»). Se o Projudi entrega o HTML de dentro do envelope (como ao vivo), lê esse HTML; se
  entrega o envelope cru (CMS, DER ou BER), tira o documento embutido com o leitor próprio, sem dependência nova, e
  lê HTML ou, se for PDF, pelo leitor de PDF do Garimpo. Assinatura destacada (sem documento embutido) ou envelope
  ilegível: não baixa e diz o motivo. Sem endereço do armazenamento, o `Id_Arquivo` não tem como ser conferido pelo
  id: no lugar do item 4, a própria «Ementa» do julgamento tem de trazer ao menos metade da ementa da busca. As
  demais amarrações valem iguais. São 4 chamadas por acórdão nesse caso.
- **Segredo e acesso:** só processo com «Segredo de Justiça: Não» na página e só arquivo de acesso público. Processo em
  segredo, arquivo bloqueado ou de nível acima do público: não baixa e diz o motivo. O Garimpo não tenta outro caminho.
- **Falha do Projudi** (erro HTTP sem recusa, formato diferente, página sem a movimentação): não baixa, devolve
  o link e o motivo. Recusa (429/503 duas vezes) e rede parada seguem a regra 3: param e avisam.
- **`Id_Arquivo`:** o link do site deixa de ser mostrado no TJGO com número CNJ (commit `4bca673`), mas o `Id_Arquivo`
  dele fica no acórdão (`idArquivoProjudi`) para o item 4. Acórdão guardado antes desta versão, sem o campo, vale pelos
  itens 1, 2, 3 e 5.

## Opções consideradas

- Manter o TJGO só com link (veredito do estudo): superada pela decisão do dono.
- Usar o formulário oficial de consulta pública: rejeitada; exige a verificação anti-robô, que o Garimpo não resolve.
- Casar só pela data (sem hora) ou pela data da sessão: rejeitada; não distingue julgamentos do mesmo dia nem prova o
  vínculo.
- Conferir o conteúdo só pelo «Relatório e Voto»: rejeitada; ele nem sempre repete a ementa (duas recusas indevidas
  na verificação real de 2026-10-22).
- Ler os `.p7s` com uma biblioteca de criptografia: rejeitada; o Garimpo não confere a assinatura, e tirar o
  documento do envelope cabe num leitor próprio de poucas linhas (`src/envelopeCms.ts`).

## Consequências

- `tjgo` passa a `inteiroTeor: "portal"` em `src/tribunais.ts`; o caminho fica em `src/tjgo.ts`.
- Os freios da regra 3 continuam valendo para o TJGO como para as demais fontes.
- O TJGO pode fechar este caminho a qualquer momento (verificação anti-robô na página do processo, login, outro
  formato): aí o Garimpo deixa de baixar e volta ao link, com o motivo; o mesmo fechamento afetaria o próprio link.
- Nada de processo em segredo nem de arquivo bloqueado: só arquivo de acesso público.
- **Não verificado:** autorização do TJGO (não pedida); termo de uso do Projudi (nenhum achado no estudo); limite de
  ritmo; estabilidade de `Id_Arquivo` = «Ementa» e do id seguinte para o «Relatório e Voto» fora das amostras;
  processo em segredo e arquivo bloqueado ao vivo; acórdãos com hora 00:00:00 (não baixados); envelope `.p7s` cru e
  PDF embutido ao vivo (só em teste, com fixtures fictícias).
