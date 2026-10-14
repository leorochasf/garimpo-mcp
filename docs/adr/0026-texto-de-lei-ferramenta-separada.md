# Texto literal de lei: ferramenta separada, fonte oficial, sem afirmar vigência

_Decidido em 2026-10-14 (D-12, pelo Sol por delegação do dono, com condição; item I-43 / G-44)._

Até aqui nenhum ADR declarava legislação fora do escopo: o [ADR-0012](0012-referencia-a-precedente-so-com-tribunal-explicito.md)
só tirou artigos de lei do mapa de referências a precedentes e do filtro `cita`, e isso **continua valendo**. A extensão é
uma ferramenta pequena e separada, `texto_de_lei`: dado um diploma e um dispositivo (artigo, parágrafo, inciso, alínea),
devolve o **texto literal** da página oficial, com URL, data de obtenção e o aviso fixo "texto conforme a página oficial
em <data>; o Garimpo não afirma vigência". Não faz busca, não resume e **não liga artigo a precedente**.

## Fonte e termos (lidos em 2026-10-14; detalhes em `docs/fontes.md`)

`normas.leg.br` (Congresso Nacional e Senado Federal): `robots.txt` com `User-agent: *` / `Allow: /`; a própria resposta
declara a licença CC BY 4.0 (exige citar a fonte); a política de uso do portal do Senado permite o uso do conteúdo
com citação da fonte e para fins lícitos. O Planalto derrubou a conexão (reset) ao UA honesto do Garimpo e o resolvedor
`legis.senado.leg.br/robots.txt` respondeu 403: nenhum dos dois é usado, e o Garimpo não se disfarça de navegador.

A rota usada, `normas.leg.br/api/public/normas?urn=<URN>&&tipo_documento=maior-detalhe`, é a API que o próprio site usa
para mostrar a norma; **não é contrato documentado** e pode mudar. Formato inesperado vira erro ou "não verificado",
nunca texto inventado. A norma inteira vem numa resposta (o CPC passa de 4 MB): cada consulta é uma chamada, 1 s entre
chamadas, pelo cliente único com os freios da regra 3; a consulta repetida volta da memória (24 h) com a **data da
obtenção original**.

## Regras da ferramenta (condição de D-12)

- Lista curta de diplomas, por sigla; só entra diploma cuja resposta foi vista ao vivo (hoje: CPC/2015, CC/2002 e CF/88; CDC não provado, ver nota abaixo). Diploma ou
  dispositivo que o Garimpo não entende vira erro que ensina, sem chamada.
- Dispositivo sem texto na fonte: "não verificado". Dois dispositivos com a mesma identificação: "identificação
  necessária", o Garimpo não escolhe.
- O texto vem como a fonte entrega. As redações vêm todas (`versoesNaFonte`), mesmo quando há só uma, da mais antiga para a
  mais recente, com as marcas dela (tipo da versão, lei alteradora, nota, período, força marcada). O Garimpo **não conclui
  qual redação vale, não reconstitui alteração e não inclui histórico que a fonte não traga**. Redação antiga fiel pode
  ser lida como lei vigente; por isso o aviso fixo e a data vão em toda resposta.
- Não cobre vigência, consolidação oficial nem constitucionalidade; "NotInForce" e similares são marcas da fonte, repetidas
  sem interpretação.

## Opções consideradas

- Planalto (texto oficial do Poder Executivo): rejeitada, recusa o UA honesto.
- API de dados abertos do Senado (`legis.senado.leg.br/dadosabertos`): traz metadados e a lista de alterações, não o
  texto do dispositivo; usada só na prova, não no código.
- Corpus 927 / histórico por IA: rejeitada (D-12).

## Consequências

- Nova ferramenta no fim do `tools/list`; descrição do projeto e README refletem a extensão. Glossário: termo proposto no
  ticket, a incluir pelo dono/piloto.
- Acrescentar um diploma exige uma prova ao vivo curta dele (`GARIMPO_VIVO=1`) e uma linha na tabela de diplomas.

## Nota de 2026-10-14: CC e CF entram, CDC não

Com a mesma rota e a URN do **documento inteiro** (uma chamada por diploma, 200), o Código Civil (Lei 10.406/2002, 5,3 MB,
`dateModified` 2024-06-28) e a Constituição (4,7 MB, `dateModified` 2026-05-05) trouxeram o texto literal e as marcas da
fonte (CC art. 186 com nota da ADI 7.055; art. 229 revogado; CF art. 5º, caput) e entraram na lista (siglas `CC`, `CF`).
O CDC (Lei 8.078/1990) respondeu 200, mas só com metadados (8 KB, sem `hasPart`, sem texto): **não provado, fora da
lista**, com a resposta honesta de diploma desconhecido. Planalto continua descartado.
