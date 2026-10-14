# TRF4: busca oficial do e-Proc e texto do portal do tribunal

_Proposto pelo executor do b18 (Claude, worker), com base na investigação D-07 de 2026-10-14 e na ficha G-31 — sujeito a
revisão do dono. Fonte nova por decisão da ADR-0017 (D-07 do dono: integrar cada fonte só após termos, acesso permitido,
prova e frescor próprios)._

O TRF4 publica a jurisprudência no módulo de jurisprudência do e-Proc (`eproc-jur.trf4.jus.br`), aberto, sem login nem
captcha. O Garimpo passa a pesquisá-lo e a trazer o inteiro teor que ele entrega em HTML assinado. O JurisprudênciaIA
continua sendo a fonte dos demais tribunais; o TRF4 não está na base dele para este fim.

## Rota, formato e o que o Garimpo chama

- **Busca:** `GET https://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar`
  (formulário; devolve o cookie de sessão) e, em seguida, `POST …?acao=jurisprudencia@jurisprudencia/listar_resultados`,
  `application/x-www-form-urlencoded`, com `Referer` do formulário e o cookie: `txtPesquisa=<termo>`, `rdoCampo=E`
  (ementa), `selOrigem[]=1` (TRF4), `selTipoDocumento[]=1` (acórdão), `chkAgruparResultados=on`,
  `hdnInfraPrefixoCookie=TRF4_Eproc_`. Resposta: HTML `iso-8859-1`; o total vem no campo oculto `hdnTotalResultado`; a
  página traz 10 resultados com a ementa inteira, a data de julgamento e a de publicação. **Uma página por pedido.**
- **Inteiro teor:** `GET …?acao=jurisprudencia@jurisprudencia/download_inteiro_teor&id_jurisprudencia=<id>&termosPesquisados=…`
  (o `data-link` de cada resultado; mesmo host): `text/html; charset= ISO-8859-1`, inline, o acórdão (relatório, voto,
  ementa, acórdão) com a assinatura eletrônica. Não é PDF. O Garimpo o pede com a sessão (um GET do formulário antes) e
  só aceita https no host do e-Proc, na rota `externo_controlador.php` com a ação `download_inteiro_teor`.
- **O que só se mostra:** o `data-link` de «acompanhamento processual»
  (`http://www.trf4.jus.br/trf4/processos/acompanhamento/resultado_pesquisa.php?…`, em `http`). O `robots.txt` de
  `www.trf4.jus.br` tem `Disallow: /trf4/processos/`. O Garimpo o devolve em `linkConsulta` **como veio** (sem trocar
  por https, sem seguir, sem chamar); qualquer rota do Garimpo que o encontre em caminho de chamada o recusa. O endereço
  de conferência da assinatura (`https://verificar.trf4.jus.br`) também só é mostrado como texto.

## Termos e robots lidos (2026-10-14, relatório `TICKETS/b18-investigacoes/trfs-eproc-cjf.md`)

- `https://eproc-jur.trf4.jus.br/robots.txt`: 404, sem regras.
- `https://www.trf4.jus.br/robots.txt`: 200, `User-agent: *` com 75 `Disallow` (licitações, contracheque, upload, diário,
  páginas `cojef_*`), nenhum sobre jurisprudência nem sobre o host do e-Proc; contém `Disallow: /trf4/processos/`.
- Termos de Uso (Res. 125/2021), `https://www.trf4.jus.br/trf4/controlador.php?acao=pagina_visualizar&id_pagina=2201`:
  item 1: «Ao utilizar qualquer dos serviços disponibilizados pela Justiça Federal de 1.º e 2.º graus da 4ª Região, o(a)
  Usuário(a) toma ciência e concorda com todas as disposições presentes nestes Termos de Uso [...]»; item 9: «É de total
  responsabilidade do(a) Usuário(a) a utilização das informações a que teve acesso em qualquer site ou sistema da Justiça
  Federal da 4ª Região.» Os 10 itens não falam de robôs, programa automatizado, varredura nem coleta. A Política de
  Privacidade (id_pagina=2200) também não. A Política de Cookies (id_pagina=2202) **não foi lida**. Sem vedação
  encontrada não equivale a autorização: o termo fica **não verificado quanto a uso automatizado**, e a fonte entra
  porque o D-07 do dono a liberou com essa condição cumprida (termos sem vedação, robots sem regra para o host, prova).
- Prova de 2026-10-14: 1 busca (200, HTML, 530 KB, e-Proc 9.23.2, ementa inteira, 10 itens de 13/10/2026) e 1 inteiro
  teor (200, HTML, 142 KB, sem login nem captcha). Tudo com o User-Agent do Garimpo.
- Validação adicional da lista em 2026-10-14 (`TICKETS/b18-investigacoes/trf4-validacao-ao-vivo.md`): GET do formulário
  (200, 73.268 bytes, 396 ms) e POST com termo acentuado em ISO-8859-1 (200, 392.878 bytes, 454 ms), usando cookie,
  Referer e UA honesto. Confirmou formulário, total, 10 cards `resultadoItem`, links relativos com `&` cru antes dos
  campos, RELATOR/RELATORA e EMENTA depois de DECISÃO. Expôs três defeitos: link/id do vizinho, relator na ementa e
  perda do último card. A correção foi testada offline contra recorte fiel, com todos os dados substituídos por fictícios.
  O adaptador corrigido não foi reexecutado na rede nesta revisão; nenhum inteiro teor foi pedido nessa validação adicional.

## Decisões

- **Identificação:** User-Agent honesto do Garimpo (a fonte o aceitou na prova); nenhum UA de navegador, login, captcha,
  proxy nem contorno. Host fora da tabela de identificação do cliente = UA honesto, sem mexer em `src/cliente.ts`.
- **Freios (regra 3):** tudo pelo `Cliente` único; no máximo 2 chamadas simultâneas somadas a todas as fontes; 429/503 com
  espera e uma nova tentativa; recusa final = para e avisa (disjuntor do serviço `trf4`, em todas as janelas). Sem intervalo
  mínimo próprio entre chamadas (a fonte não informa limite; não verificado), só as chamadas em série de um pedido. Cada busca = 2 chamadas (formulário + POST); cada inteiro teor = 2 (formulário + GET).
  A busca repetida em 24 h sai da memória, sem chamada. Redirecionamento não é seguido.
- **Rótulo do inteiro teor: «texto do portal do tribunal»** (DQ-06 / `CONTEXT.md`), não «inteiro teor oficial». O
  oficial é o PDF com recibo (ADR-0005/0011); o TRF4 entrega HTML. O HTML vem com assinatura eletrônica e endereço de
  conferência, mas o Garimpo não verifica assinatura nem CRC e não grava arquivo nem recibo: o texto fica na memória por
  24 h, é lido em partes e conferido por citação pelo id, sempre com o rótulo da fonte. Um PDF oficial do TRF4 não foi
  verificado e, se existir, é outra decisão.
- **Sem texto = «não verificado».** Página que não for o acórdão (sem a assinatura, curta demais, outro processo,
  redirecionamento, não HTML) não é guardada; nenhuma ementa é reconstruída nem o texto de outro acórdão é entregue.
- **Filtros e opções da busca direta:** de/ate, relator, órgão, classe, somenteEmentas, ordenação e precedentes **não** são
  mandados ao e-Proc (a montagem no formulário não foi verificada): pedir um deles dá erro que ensina, nunca é ignorado
  em silêncio. Limite acima de 10 vale 10, com aviso no cabeçalho de cobertura.
- **Lista conferida com recorte saneado:** a fixture reproduz os cards `resultadoItem#resultado<ID>` da resposta real,
  em ISO-8859-1. O leitor isola cada card, lê `resLabel`/`resValue` e vincula o `id_jurisprudencia` ao id do próprio
  card. EMENTA e RELATOR/RELATORA são campos separados; não incorpora a DECISÃO duplicada nem o modal de citação.
  Classe diferente, campo ausente/duplicado, card truncado, link ausente/ambíguo ou id com dados distintos abortam a
  lista inteira com erro de formato antes de guardar qualquer acórdão. A ordem dos dois links não importa.
- **Total ausente ≠ zero:** exige um único `hdnTotalResultado` inteiro completo e exatamente `min(total, 10)` blocos
  na primeira página. Zero só é busca vazia sem blocos/campos de registros; qualquer divergência é erro de formato.
  Dez cards foram observados com agrupamento marcado e total 30196; a regra para totais menores que 10 e o efeito
  geral do agrupamento continuam não verificados ao vivo (testados apenas offline).
- **Vínculo do documento:** o `id_jurisprudencia` do link deve coincidir com o id pedido, antes de qualquer chamada;
  o mesmo processo pode ter vários acórdãos. O número CNJ no texto é uma conferência adicional, não autenticação.
- **LGPD / dados de pessoas:** o inteiro teor traz partes por iniciais («Identificações de pessoas físicas foram
  ocultadas»); as fixtures são fictícias.

## Opções consideradas

- Tratar o HTML assinado como «inteiro teor oficial»: rejeitada; a definição do projeto é o PDF com recibo, e a assinatura
  não é verificada pelo Garimpo.
- Gravar o HTML em arquivo com recibo: rejeitada agora, como na ADR-0021.
- UA de navegador: desnecessário (a prova passou com o UA honesto).
- Entrar com TRF2 e TRF6 pelo mesmo adaptador: fora; vedados por termos próprios (TRF2 art. 13 § 1º; TRF6 «Automação
  indevida»), sem transferir a aprovação de um host para outro.

## Consequências

- Sigla `trf4` em `src/tribunais.ts` (fonte «e-Proc do TRF4»), modo de inteiro teor `portal`.
- **Não verificado, validar ao vivo:** adaptador corrigido de ponta a ponta e download por ele nesta rodada; dispensa
  do cookie; relação total/agrupamento/tamanho da página fora dos 10 cards observados; filtros avançados; PDF oficial
  e rota `gerarPDFDocumento`; limite de ritmo; estabilidade dos ids; Política de Cookies e frescor além da amostra.
  Não foi medida vantagem de velocidade sobre o STJ pelo JurisprudênciaIA. Se o formato mudar, o leitor dá erro,
  nunca lista vazia.
- Se o TRF4 passar a vedar ou a recusar, o disjuntor do serviço abre e o usuário recebe o aviso.
