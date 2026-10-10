# Acórdão que falta: DataJud e DJEN sob pedido, pelo número, lado a lado com o site, sem inferir ausência e sem nome de parte

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

Quando a busca do JurisprudênciaIA não traz um acórdão que existe no tribunal (caso de embargos sem o acórdão
recorrido), o Garimpo não tem como trazer o texto que o site não tem. Ele passa a mostrar, **sob pedido e pelo número
CNJ**, os julgamentos registrados no DataJud (metadados do CNJ, sem texto) e as comunicações do DJEN do processo, e a
pôr ao lado do que uma busca pelo número no site devolve. As listas saem lado a lado, com os totais; a única
comparação é por tipo comprovado (embargos de declaração × embargos de declaração), com respostas utilizáveis e sem
corte nas duas fontes. O Garimpo nunca conclui que um acórdão falta: aponta o movimento cujo tipo não foi verificado
(ou o tipo com diferença) para conferir no portal do tribunal. Nada de nome de parte ou advogado sai, é guardado ou
vai para fixture; o texto do DJEN só aparece em trecho saneado, como texto da intimação. Motivo: o DataJud levou 19 s
numa consulta e registra datas de lançamento dias depois da sessão; chamar sozinho a cada embargos gastaria as vagas
divididas com o site, e comparar por data confundiria julgamentos.

## Opções consideradas

- Chamar o DataJud automaticamente a cada embargos sem o recorrido: rejeitada (lento, gasta vagas, multiplica
  chamadas).
- Comparar por data com tolerância: rejeitada (data de lançamento ≠ sessão; dois julgamentos do mesmo tipo no mesmo
  mês).
- Mostrar o texto inteiro do DJEN: rejeitada (nomes de parte; o "EMENTA" do texto costuma ser de outro acórdão
  transcrito).
- Comparar o total (movimentos × acórdãos) e dizer "pode haver acórdão fora da base": rejeitada (julgamento registrado
  não é acórdão; contagem incerta viraria aviso de ausência). Em troca, o movimento de tipo não verificado é apontado
  para conferência.

## Consequências

- O STF não está no DataJud: a ferramenta diz isso sem chamada.
- Uso sujeito ao termo do DataJud v1.2 (não comercial, não distribuir informação derivada, ciência ao CNJ do que for
  publicado), citado na ferramenta e no README. Item (i), se o uso é "não comercial" (item 3.3): decidido pelo dono em
  2026-10-09 — o Garimpo é open source (licença MIT) e sem cobrança; nas palavras do dono: "garimpo é opensource sem
  cobrança". Item (iii), dar ciência ao CNJ quando o Garimpo for publicado (3.9): decidido pelo dono em 2026-10-09 —
  não dar ciência ao CNJ; nas palavras do dono: "nao avisar". Pendência do dono, que bloqueia a publicação e não o
  código: (ii) o alcance de "não distribuir informação derivada" (3.8).
- A chave pública do DataJud pode mudar: em 401 com a chave do código, uma leitura da página oficial da wiki (pelo
  `Cliente`; User-Agent de navegador permitido se a wiki recusar o do Garimpo) e uma repetição; nunca troca a chave
  definida pelo usuário.
- Nomes de serviço no disjuntor: `datajud` (API e wiki) e `djen` (API de comunicações), em vez de "cnj" e "pje".
- A espera do DJEN depois de um 429 é exceção ao ADR-0009 (ver o adendo lá).
