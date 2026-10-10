# Garimpo

Servidor MCP local (stdio) para pesquisar jurisprudência brasileira pela **busca direta** do
[JurisprudênciaIA](https://www.jurisprudenciaia.com.br) e baixar o **inteiro teor oficial** dos tribunais. Os 24 TRTs
vêm do **Falcão** (CSJT), o repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024), com o
texto integral do acórdão.
Devolve dados crus e verificáveis (ementa como veio do site, número, órgão, data, link oficial); quem interpreta é a IA
de quem usa.

> **Cliente não oficial.** O Garimpo não é afiliado ao JurisprudênciaIA, à JAI, ao CSJT nem a nenhuma outra fonte. A API usada não é
> documentada e pode mudar sem aviso. Licença MIT.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `busca_direta` | Uma busca num tribunal: acórdãos (até 100) e, em lista separada, precedentes qualificados (temas, súmulas). Filtros opcionais: período, relator, órgão, classe. No campo `cabecalhoDeCobertura`, uma linha diz se o site devolveu o número pedido de registros (pode haver mais: aumente o limite ou use a busca ampla) ou menos (a base não tem mais para este texto e os filtros; no STF, que devolve poucos por busca, pode haver mais). A mesma busca repetida em até 24 h pode voltar da memória como **busca guardada**, com o campo `buscaGuardada` dizendo quando foi feita no site; `renovar: true` busca de novo no site (veja [Memória](#memória)) |
| `busca_ampla` | Várias formulações da mesma tese em um ou mais tribunais (até 20 formulações e 5 tribunais), juntadas numa lista única de acórdãos: **sem repetidos** (o mesmo acórdão achado por buscas diferentes, ou guardado em dois registros na base do site, vira um acórdão só); ordenada pela **aderência** (palavras de alguma formulação presentes na ementa), depois por quantas formulações acharam cada acórdão e pela melhor posição na busca de origem; com **vagas por tribunal** (cada tribunal pedido que tenha acórdão na faixa mais alta de aderência tem até 3 vagas garantidas na lista). Saída compacta, 50 acórdãos por padrão (até 200): número, tribunal, data, órgão, **trecho** da ementa onde a tese aparece, link. Em lista própria, até 10 **precedentes qualificados** (temas, súmulas) que o site devolveu, sem repetidos. No campo `cabecalhoDeCobertura`: por tribunal, buscas feitas, vazias, com erro e não feitas (recusa no meio), acórdãos achados e mostrados (tribunal em que nenhuma busca deu resposta aparece "com erro" ou "não pesquisado", nunca "0 achados"); as formulações que não trouxeram nenhum acórdão em nenhum tribunal; e, quando a lista foi cortada pelo máximo, "mostrando X de Y". Se nenhuma busca deu resposta (recusa ou outro erro), a ferramenta responde com **erro** e o motivo de cada busca, nunca com lista vazia. Cada busca (formulação × tribunal) repetida em até 24 h pode voltar da memória como **busca guardada**, e ampliar a busca com formulações novas só busca no site as novas; no cabeçalho, o tribunal com busca guardada traz `guardadas` (quantas vieram da memória), `feitasAgora` e `maisAntiga` (data e hora local da busca guardada mais antiga). `renovar: true` busca tudo de novo no site (veja [Memória](#memória)). **Filtros locais** opcionais, sem nenhuma chamada a mais ao site (veja [Filtros locais](#filtros-locais-da-busca-ampla)) |
| `obter_ementa` | Ementa de um acórdão, como veio do site (com `avisoDeEmenta` quando ela parece cortada pelo próprio site: heurística, o texto não é mexido), já devolvido por uma busca nas últimas 24 h, em qualquer janela do Garimpo, pelo id, sem nova busca no site (com `GARIMPO_SEM_MEMORIA=1`, só na janela que fez a busca); diz quando o acórdão foi obtido do site (veja [Memória](#memória)) |
| `obter_inteiro_teor` | Baixa o PDF oficial do portal do tribunal (STJ, TJMG, TJSP, TSE) e devolve o caminho do arquivo e o sha256. Ao lado do PDF grava o recibo de origem (`.recibo.txt`: link oficial, data e hora, sha256; declaração do Garimpo, não certidão). Recusa PDF acima de 50 MB e nunca deixa arquivo pela metade. Já devolve a **1ª parte** do texto, com o mesmo cabeçalho do `ler_inteiro_teor` e a chamada pronta para a parte seguinte. Se, num caso extremo (pasta ou link muito longos), a 1ª parte não couber no teto junto com os dados do download, vem um aviso e a chamada pronta para lê-la com o `ler_inteiro_teor`. Com `texto: false`, devolve só o caminho, o recibo e o total de páginas do PDF, sem extrair o texto (para baixar vários e ler depois, economizando tokens). Antes de baixar, procura **só na pasta de destino** um PDF do mesmo acórdão já baixado pelo Garimpo, pelo recibo de origem (mesmo tribunal e id, ou o mesmo link da busca; nunca só pelo número do processo): com o PDF intacto (mesmo sha256 do recibo), responde na hora, sem nenhuma chamada, dizendo de quando é o download (`jaEstavaNaPasta`); com várias versões válidas, usa a de download mais recente e preserva as outras. Isso vale mesmo depois das 24 h da memória, pedindo pelo id do download ou pelo link (pelo id de outra cópia equivalente do mesmo acórdão, só dentro das 24 h). Não há como forçar novo download: para outra cópia do tribunal, mova o PDF e o recibo para fora da pasta de destino (sem apagar). Se o PDF salvo não puder ser lido ou contado, o download continua valendo e vem o motivo ("total de páginas não disponível" ou o erro de leitura), nunca um número inventado. STF, TJGO e demais: devolve o link, explica como obter no navegador e ensina a ler o PDF baixado: passar o caminho do arquivo ao `ler_inteiro_teor`. Acórdão que veio da busca sem link nenhum: pede o link, uma vez, à rota de link do JurisprudênciaIA (exceto TST; só aceita https em domínio .jus.br) e diz que veio de lá; sem link também ali, diz como achar o acórdão pelo número CNJ no portal de jurisprudência do tribunal |
| `ler_inteiro_teor` | Lê, pelo caminho do arquivo, o PDF que o `obter_inteiro_teor` baixou, ou um PDF que você baixou à mão em qualquer pasta, e devolve uma **parte** do texto (cerca de 8 mil tokens estimados, feita de páginas do PDF inteiras; página grande demais vem em segmentos, com a continuação indicada). Cada parte traz o mesmo cabeçalho: tribunal, número, data, link oficial, sha256, id, nome do arquivo, origem e "páginas X–Y de N (parte P de T)" (páginas do PDF, não folhas dos autos), com "não informado" no que faltar, e a chamada pronta para a parte seguinte. Origem **conferida** só quando o recibo de origem ao lado do PDF é reconhecido, registra download pelo Garimpo e tem o mesmo sha256 do arquivo; senão, **não conferida**, com o motivo (sem recibo, recibo de formato desconhecido, PDF alterado depois do download). Página sem texto extraível é avisada ("pode ser escaneada"; não há OCR); PDF que o extrator não consegue ler é erro de leitura. PDF sem recibo é **inteiro teor trazido pelo usuário**: origem declarada, não conferida, nunca chamado de oficial. Só aceita arquivo PDF de até 50 MB (não aceita URL nem pasta, e não procura arquivos sozinho). Para esse PDF, se quiser, informe o id que veio na busca, ou tribunal + número: o cabeçalho é preenchido como **vínculo declarado pelo usuário** (com a memória do Garimpo, sem nova chamada à rede) e diz se o número do processo aparece no texto (encontrado / não encontrado / não verificável), só como informação. Não grava, não copia e não chama a rede |
| `julgamentos_do_processo` | Pelo número CNJ (com ou sem máscara; o tribunal sai do número, ou informe `tribunal`, ex.: `stj` para o processo que subiu), os **julgamentos registrados** do processo no **DataJud**, a base pública de metadados do CNJ (sem texto de decisão e sem nome de parte): só registros de 2º grau ou de tribunal superior (os de 1º grau são contados), só movimentos de resultado de julgamento da Tabela Processual Unificada e, à parte, a juntada de documento com complemento "Acórdão". Cada linha traz a data do **lançamento no DataJud** (não a da sessão), código, nome e órgão; cada registro, a última atualização no DataJud. Ao lado, os acórdãos do mesmo número que uma busca pelo número no JurisprudênciaIA devolve, com o id; em `ladoALado`, os totais das duas fontes e, só com as duas respostas utilizáveis e sem corte, a comparação de embargos de declaração com embargos de declaração e o que conferir no portal do tribunal (o movimento de tipo não verificado, ou a diferença de embargos). **Nunca afirma que um acórdão falta.** Cada fonte vem com o seu estado (ok, vazia, erro, recusa, pausa, não consultada): "o DataJud não devolveu este processo" não prova que ele não exista. O DataJud não cobre o STF. Consulta repetida em 24 h volta da memória. Uso sob o [termo de uso da API Pública do CNJ](https://formularios.cnj.jus.br/wp-content/uploads/2023/11/Termos-de-uso-api-publica-V1.2.pdf) (fins legais e não comerciais): a consulta sai do computador de quem usa o Garimpo, e as obrigações do termo são de quem usa a API; a chave pública vem no Garimpo e pode ser trocada pela variável `GARIMPO_DATAJUD_CHAVE`. Com `incluir_djen` (padrão; `false` responde mais rápido), também as **comunicações do processo no DJEN** (uma página, até 100; "lista cortada" quando há mais): data de disponibilização, tipo de comunicação e de documento, órgão, classe e link, nunca o texto nem nome de parte ou advogado — comunicações do processo, não um inventário de acórdãos. Se o DJEN pedir para esperar mais de 1 minuto, a resposta vem na hora com o que as outras fontes trouxeram e o instante em que se pode tentar de novo (estado `pausa`, que não é recusa). Fontes e limites: [`docs/fontes.md`](docs/fontes.md) |
| `listar_tribunais` | Para cada tribunal: a fonte (JurisprudênciaIA ou Falcão), busca, precedentes qualificados, teto de resultados por busca e se o inteiro teor é baixado, só linkado ou, nos TRTs, texto integral do repositório oficial (sem PDF). A mesma tabela, com os limites do Falcão, sai no recurso `garimpo://tribunais` |
| `conferir_citacao` | Confere, por regra fixa e sem IA, se cada citação (até 20 por chamada; 5 palavras ou mais, até 3 mil caracteres) está literalmente na ementa do acórdão, pelo id que veio na busca (ementa guardada na memória do Garimpo). Vereditos: **encontrado literalmente** (só diferença de espaço, quebra de linha, espaço não separável, forma Unicode dos acentos ou aspas/apóstrofos tipográficos, avisadas); **encontrado com supressão indicada** (cortes marcados com `(...)` ou `[...]`, pedaços de 5 palavras ou mais, na ordem); **difere só em maiúsculas/pontuação** (não é literal; vem o texto exato da fonte); **não encontrado** (com a passagem parecida copiada da fonte, quando 80% ou mais das palavras estão na mesma ordem, rotulada como diferente da citação); **não verificável** (acórdão fora da memória — refaça a busca — ou sem ementa). Hífen, meia-risca e travessão nunca são iguais. Reticências soltas (e o corte escrito com a reticência de um caractere só, `(…)`) são texto, salvo `reticenciasComoCorte`. Item da lista sem `citacao` ou `id`, e citação curta ou longa demais, recebem resultado próprio com a frase que ensina a corrigir, sem derrubar as outras. A posição vem como a frase da ementa que contém a citação (até 10 ocorrências, com o total); passagem entre aspas ganha o aviso de que pode ser de outro autor. Com `caminho` (o PDF do `obter_inteiro_teor` ou um trazido pelo usuário), confere também no inteiro teor: a posição vem como página do PDF, parte e segmento, com a origem do PDF (no PDF trazido, declarada pelo usuário, não conferida; o `id` junto é só vínculo declarado) e a seção do acórdão pelo título de seção sozinho na linha (EMENTA, ACÓRDÃO, RELATÓRIO, VOTO, VOTO-VISTA, VOTO VENCIDO, VOTO VOGAL, CERTIDÃO), ou "não identificada"; no relatório e no voto vencido, aviso forte. O Garimpo nunca diz de quem é a passagem, e a falta de sinal não prova que ela é do tribunal. Achar o texto não autentica a fonte. Não grava e não chama a rede |
| `consultar_precedente` | Precedente pelo número (tipo obrigatório: a numeração de cada tipo é separada), **consultado ao vivo no portal do tribunal**, na hora da pergunta, com memória de 24 h. **STJ** (tema repetitivo ou IAC): situação na fonte literal, tese firmada, questão submetida, órgão julgador, processo paradigma e a última atualização da página. **STF** (repercussão geral, súmula ou súmula vinculante): situação do tema e tese, ou a marca de situação da lista de súmulas e o enunciado, com o endereço. A resposta diz "consultado no portal do <tribunal> em <data e hora>". Se o portal não responder, a resposta vem da tabela de precedentes do pacote, dizendo "tabela de <data>, o portal não respondeu" e o motivo (veja [Precedentes ao vivo](#precedentes-ao-vivo)). Sempre com enquadramento no art. 927 |

As respostas de `busca_direta`, `busca_ampla` e `obter_ementa` trazem, no campo `avisoNaturezaJuridica`, a linha
"Resultado de busca em base não oficial. Confira o acórdão na fonte oficial do tribunal antes de citar; a ementa não
substitui o inteiro teor." Nos TRTs, o aviso é o do Falcão: "Resultado obtido do repositório oficial da Justiça do
Trabalho (Falcão) por cliente não oficial (Garimpo); confira no portal do tribunal antes de citar."; na busca ampla
com as duas fontes, vêm os dois, cada um com a sua (a oficialidade do Falcão não se estende ao JurisprudênciaIA).

### TRTs pelo Falcão

- **Busca direta** (`trt1` a `trt24`): só acórdãos; `limite` padrão 10, máximo 30 (3 páginas do Falcão). Cada
  acórdão traz o rótulo "Falcão — repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024)",
  número, classe, relator, turma, **julgado em** (`dataJulgamento`) e **juntado em** (`dataJuntada`, que não é data
  de publicação; a publicação não é informada pela fonte). Acórdão sem ementa aparece como "sem ementa no Falcão",
  sem trecho inventado. O cabeçalho de cobertura separa o total que o Falcão informa ("10.000 ou mais" no teto da
  contagem dele) de quantos vieram e quantos são mostrados. Nomes de partes nunca vão a listas, cabeçalhos nem à busca
  guardada.
- **Busca ampla:** cada TRT conta como tribunal (até 5), 1 página (10) por formulação × TRT, com teto de **5 páginas
  do Falcão por chamada**, usadas primeiro na 1ª formulação de cada TRT pedido, na ordem dada; o que não couber sai
  no cabeçalho como `foraDoTeto` (repita a chamada para executar o que faltou: o já feito volta da memória).
- **Texto integral:** vem na própria busca e fica na memória do Garimpo por 24 h (o Falcão não tem busca por id).
  `ler_inteiro_teor` com o `id` (sem caminho) o devolve em partes por tamanho, convertido de HTML (não é PDF, sem
  recibo de origem); `conferir_citacao` com o `id` confere na ementa e no texto integral, dizendo em qual achou;
  `obter_inteiro_teor` explica que não há PDF. Fora da memória, refaça a busca (pode não trazer o mesmo acórdão).
- **Ainda não:** filtros `de`, `ate`, `relator`, `orgao` e `classe` nos TRTs (erro que ensina, sem chamada),
  precedentes qualificados dos TRTs, TST pelo Falcão. Termos de uso do Falcão lidos e registrados em
  [`docs/fonte-falcao.md`](docs/fonte-falcao.md).

Tribunal inválido e data fora do formato recebem uma frase em português que diz como corrigir: as siglas válidas;
"use AAAA-MM-DD". Na `busca_ampla`, `formulacoes` e `tribunais` aceitam lista, texto
de lista JSON (`"[\"a\", \"b\"]"`) ou texto solto, que vale como **um** item só: o texto nunca é partido por
vírgula, para que uma formulação como "art. 37, § 6º" chegue inteira.

### Filtros locais da busca ampla

_Medição provisória, sujeita à revisão do dono_ (banco de provas do B5; veja
[`docs/banco-de-provas/b5-medicao-prototipo.md`](docs/banco-de-provas/b5-medicao-prototipo.md)).

`deveConter` e `naoPodeConter` conferem as ementas que a busca ampla já recebeu, sem nenhuma chamada a mais ao site
(repetir a busca mudando só o filtro usa as buscas guardadas):

- `deveConter`: lista de grupos de sinônimos, como `[["improbidade"], ["dolo", "dolosa", "doloso"]]`. Basta um termo
  de cada grupo, e todos os grupos são exigidos. `naoPodeConter`: lista de termos, como `["multa administrativa"]`;
  qualquer um exclui.
- Casam a **expressão inteira**, sem diferenciar acento e maiúscula, com espaços normalizados: "culpa" não casa com
  "culposa" nem com "culpabilidade". Não há radical nem sinônimo automático: liste você as variantes ("14.230" e
  "14230", "doloso" e "dolosa").
- O filtro só tira acórdãos da lista; a ordem dos que ficam não muda, e a reserva por tribunal e o máximo valem só
  entre eles. Os precedentes qualificados não passam pelos filtros locais.
- No `cabecalhoDeCobertura`, cada tribunal traz `excluidos` (acórdãos achados cuja ementa descumpriu o filtro) e, se
  houver, `semEmenta` (acórdãos que vieram sem ementa: com qualquer filtro ativo, saem por não haver texto a conferir,
  e são contados à parte). "Mostrando X de Y" conta só os que passaram pelo filtro. Se o filtro tirar todos, a lista
  vem vazia e o campo `filtroLocal` diz que foi o filtro, não a falta de acórdãos.
- Como `formulacoes`, aceitam texto de lista JSON ou texto solto, que vale um termo só (nunca partido por vírgula).
  Grupo vazio, termo vazio ou elemento fora do formato (por exemplo, `deveConter: ["a", "b"]`, que não diz se os
  termos são sinônimos ou exigências separadas) dão erro com o formato aceito, antes de qualquer busca.

### Precedentes ao vivo

O `consultar_precedente` busca o precedente **no portal do tribunal, na hora da pergunta, do seu computador**
([ADR-0020](docs/adr/0020-precedentes-qualificados-ao-vivo-tabela-como-plano-b.md)):

- **STJ:** a página do tema repetitivo ou do IAC em `processo.stj.jus.br/repetitivos/` — 1 chamada, com a
  identificação própria do Garimpo.
- **STF:** repercussão geral pela ficha do tema e pela página com a tese (2 chamadas); súmula e súmula vinculante pela
  lista do tipo e pela página da súmula (2 chamadas; 1 enquanto a lista estiver na memória). O portal do STF recusa
  (HTTP 403) quem se identifica como o Garimpo; por decisão do dono, ali o Garimpo se apresenta como navegador.
- **Freios:** tudo passa pelo mesmo cliente das outras fontes (no máximo 2 chamadas simultâneas no total, em 429/503
  espera e tenta uma vez, recusa final pausa o serviço em todas as janelas), com serviço próprio no disjuntor
  (`stj-precedentes` e `stf-precedentes`) e prazo de 30 s por chamada. O resultado fica 24 h na memória.
- **Plano B:** se o portal recusar, estiver fora, pausado ou devolver uma página que o Garimpo não reconhece, a
  resposta vem da tabela do pacote (abaixo), com "tabela de <data>, o portal do <tribunal> não respondeu" e o motivo.
- **Listas de qualificados das buscas** continuam pela tabela: conferir cada item ao vivo custaria dezenas de chamadas
  por busca. Para o dado do dia, use o `consultar_precedente` no precedente que importa.

### Tabela de precedentes do STJ

O pacote leva uma **fotografia datada** dos temas repetitivos e dos IAC do STJ, tirada do conjunto
[Precedentes qualificados](https://dadosabertos.web.stj.jus.br/dataset/precedentes-qualificados) do Portal de Dados
Abertos do STJ (`dados/tabela-precedentes-stj.json`). É dela que vêm o plano B do `consultar_precedente` e, nas listas
de precedentes qualificados das buscas, a situação na fonte do tema ou IAC do STJ.

- **Fonte e licença dos dados:** "Fonte: STJ — Portal de Dados Abertos, conjunto Precedentes qualificados". A página
  do conjunto declara a licença "Creative Commons Atribuição" (sem indicar a versão; conferida na data gravada na
  tabela). Essa licença vale para os dados da tabela e é distinta da licença MIT do código do Garimpo. Toda resposta
  que usa a tabela traz a atribuição, a licença como declarada e as datas.
- **Datas:** a tabela guarda a data e hora da coleta de cada arquivo, a data de atualização que a própria página do
  conjunto informa (texto literal "Última Atualização …", ou "não informada") e a data em que a tabela foi gerada.
  Com mais de 90 dias, a resposta traz um aviso: a situação e a tese podem ter mudado no STJ.
- **Como é gerada:** pelo mantenedor, a cada versão, com `npm run gerar-tabela`, que baixa a página do conjunto,
  `temas.csv` e `processos.csv` pelo cliente do Garimpo (identificação própria, 10 s entre chamadas como pede o
  robots.txt do portal, nunca `/api/`); para, sem trocar a tabela anterior, em recusa, cabeçalho de CSV diferente do
  esperado ou marcação HTML nos textos. Tese firmada e questão submetida são copiadas da fonte (só quebra de linha
  CRLF → LF e espaço das pontas); nada é escrito à mão. Guarda o sha256 de cada arquivo baixado.
- **O que fica de fora e por quê:** Controvérsia, SIRDR e PUIL do mesmo arquivo (não são o que o art. 927, III, usa);
  os campos de anotação da fonte; o enunciado das súmulas (a fonte só traz os números); o STF, que tem tabela
  própria ([Tabela de precedentes do STF](#tabela-de-precedentes-do-stf)). A **situação
  na fonte** é a situação processual como o STJ escreve ("Afetado", "Trânsito em Julgado", "Cancelado"…): nunca vira
  "vigente" ou "superado" e nunca muda o inciso do art. 927.

### Tabela de precedentes do STF

O pacote leva também uma **fotografia datada** do STF (`dados/tabela-precedentes-stf.json`): os temas de repercussão
geral, as súmulas e as súmulas vinculantes, para o plano B do `consultar_precedente` (tribunal `stf`) e para a
situação dessas listas nas buscas.

- **Fonte e fundamento:** o STF não publica termo de uso nem licença para esses dados (não encontrados em
  2026-10-09). A Resolução STF nº 774/2022, que institui o programa Corte Aberta, não trata de licença nem proíbe
  reuso; prevê "permitir a livre exportação dos dados brutos ou semiestruturados" (art. 5º, II) — lida em 2026-10-09
  na cópia que o STJ publica (`stj.jus.br/internet_docs/biblioteca/clippinglegislacao/Res_774_2022_STF.pdf`), porque
  o site do STF recusou o acesso. A inclusão foi decidida pelo dono em 2026-10-09 com fundamento na Lei 9.610/98,
  art. 8º, IV ("não são objeto de proteção como direitos autorais ... decisões judiciais e demais atos oficiais").
  A mesma lei protege compilações que, "por sua seleção, organização ou disposição de seu conteúdo, constituam uma
  criação intelectual" (art. 7º, XIII), mas essa proteção "não abarca os dados ou materiais em si mesmos" (§ 2º);
  a tabela guarda os dados, no formato do próprio Garimpo (texto conferido no planalto.gov.br em 2026-10-09; a
  aplicação ao caso é decisão do dono, não parecer). Toda resposta que usa a tabela traz a atribuição, o fundamento
  e a data em que os arquivos foram obtidos.
- **Como é gerada:** o **mantenedor** obtém os arquivos no próprio navegador, a cada versão, e os põe na pasta
  `entrada-stf/` (fora do git):
  - `RepercussaoGeral.xls`: na tela [Todos os temas](https://portal.stf.jus.br/jurisprudenciaRepercussao/todostemas.asp),
    botão "Exportar Dados" (o arquivo é uma tabela HTML, não planilha);
  - `sumulas.html` e `sumulas-vinculantes.html`: as telas
    [Súmulas](https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=30) e
    [Súmulas Vinculantes](https://portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26) salvas pelo navegador
    ("Salvar como", só HTML);
  - `sumulas/*.html` (opcional): a página de cada súmula cujo enunciado deve entrar, aberta pelo link da lista.

  Depois roda `npx vite-node scripts/rodarGeradorStf.ts`, que não usa a internet: lê esses arquivos, guarda o sha256
  e a data de cada um (a data de modificação do arquivo, que o navegador marca no download: não edite os arquivos) e grava a tabela de uma vez; para, sem trocar a tabela anterior, em cabeçalho diferente do
  esperado, rótulo fora da forma, número repetido ou arquivo sem linhas. O texto sai do HTML por regra fixa; a única
  correção é a acentuação da coluna "Há Repercussão", que o STF exporta duplamente codificada. Arquivo que falta
  deixa aquela parte vazia, e a resposta diz que a tabela não a tem.
- **Situação:** a do tema de repercussão geral vem literal ("Situação do Tema"); a das súmulas é só a marca entre
  parênteses que a lista do STF põe no rótulo ("cancelada", "superada"…). **A falta de marca não prova que a súmula
  está em vigor** (não foi verificado se a marca cobre todas as superadas ou canceladas). Nenhuma das duas muda o
  inciso do art. 927.

`busca_direta`, `busca_ampla`, `obter_ementa`, `ler_inteiro_teor`, `conferir_citacao`, `consultar_precedente` e `listar_tribunais` são declaradas ao cliente como
ferramentas que só leem (as duas buscas e o `consultar_precedente`, como ferramentas que consultam serviço externo); `obter_inteiro_teor` não, porque grava
o PDF no disco. Cabe a cada cliente decidir se usa essa marca para dispensar o pedido de permissão.

## Uso responsável (travas embutidas)

Toda chamada ao site passa por um cliente único que:

- faz **no máximo 2 chamadas simultâneas no total das janelas do Garimpo do usuário** (JurisprudênciaIA e
  tribunais somados): cada janela do Claude roda um Garimpo próprio, e todas dividem as mesmas 2 vagas pela pasta
  de dados (abaixo);
- em recusa temporária (HTTP 429 ou 503), **espera e tenta uma única vez** (o tempo que o serviço pedir, ou 5 s;
  no TSE, no mínimo 10 s; no DJEN, no mínimo 60 s, e pedido acima de 60 s **adia** o DJEN em todas as janelas até o
  instante pedido, sem contar como recusa); enquanto isso, as outras chamadas ao mesmo serviço, em todas as janelas, esperam essa
  nova tentativa sem ocupar vaga;
- trata 403 e desafios anti-robô (Cloudflare, AWS WAF, reCAPTCHA) como recusa: devolve o link para abrir no
  navegador; no Falcão, a recusa do sistema traz a mensagem dele como texto externo (curta, sem HTML, sem dados
  pessoais);
- depois de uma **recusa final** (a nova tentativa recusada de novo, 403, desafio anti-robô ou pedido de espera
  acima de 30 s), **pausa o serviço** em todas as janelas (abaixo);
- identifica-se com um User-Agent honesto (`Garimpo/<versão> …`). **Exceções: o Falcão (CSJT) e o portal do STF**
  recusam programas que não se apresentam como navegador (HTTP 403); por isso o Garimpo usa nesses dois, **e só
  neles**, um User-Agent de navegador fixo por versão (no Falcão, com `Origin`/`Referer` do próprio site), sempre
  dentro destes freios; no Falcão, com 1 s entre chamadas em todas as janelas. Termos do Falcão lidos e registrados
  em [`docs/fonte-falcao.md`](docs/fonte-falcao.md); o uso no STF é decisão do dono
  ([ADR-0020](docs/adr/0020-precedentes-qualificados-ao-vivo-tabela-como-plano-b.md)).

Os termos de uso do site preveem limites por IP e bloqueio em caso de uso abusivo. Use com moderação.

**Atualize e reinicie todas as janelas.** Janelas com versão do Garimpo anterior a esta não participam da proteção
compartilhada (vagas, pausa do TSE e pausas por recusa): com uma delas aberta, o total pode passar de 2 e uma
pausa pode ser ignorada. A proteção também não alcança outras pessoas, máquinas
ou programas que usem o mesmo IP.

### Pausa depois de uma recusa

A pausa é **por serviço**: uma recusa do TSE não pausa o JurisprudênciaIA nem os outros tribunais. Ela dura 1 min
na primeira recusa final e dobra a cada nova (2, 4, 8… até 60 min); se o serviço pedir mais tempo, vale o pedido,
mesmo acima de 60 min. Durante a pausa, a chamada àquele serviço falha na hora, sem sair para a rede, dizendo até
que horas ele está pausado; na busca ampla, as buscas pausadas aparecem "com erro" no cabeçalho de cobertura.
O que não precisa de rede continua respondendo durante a pausa, como na [rede parada](#pasta-de-dados-e-rede-parada).

- **Recuperação:** vencida a pausa, sai uma única **chamada de prova** (um pedido real, sem nova tentativa); as
  outras chamadas ao serviço esperam a decisão dela. Aceita, tudo volta ao normal e a próxima pausa recomeça em
  1 min. Recusada, a pausa recomeça dobrada. Erro sem recusa (serviço fora do ar, tempo esgotado) não conta como
  recusa: outra prova pode sair 5 s depois (10 s no TSE), e cada ferramenta faz no máximo uma prova.
- Não há comando para "liberar" a pausa: espere a hora indicada. Resposta atrasada de uma chamada feita antes da
  recusa nunca encerra a pausa.

### Pasta de dados e rede parada

As vagas, a pausa do TSE e as pausas por recusa ficam em arquivos comuns na subpasta `protecao` da pasta de
dados do usuário: `%LOCALAPPDATA%\garimpo` (Windows), `~/Library/Caches/garimpo` (macOS) ou `$XDG_CACHE_HOME/garimpo`
(`~/.cache/garimpo`) no Linux. A variável de ambiente `GARIMPO_DADOS` troca a pasta inteira. Janelas com valores
diferentes **não dividem** o freio entre si: isso serve para separar instalações, não para escapar de uma recusa.

- Uma vaga só é retomada de uma janela que comprovadamente fechou (processo inexistente); tempo decorrido nunca
  libera vaga. Se a espera por vaga passar de 3 min, a chamada desiste sem liberar nada e diz que as vagas
  continuam ocupadas ou não puderam ser verificadas.
- **Rede parada:** se o arquivo de estado da proteção estiver ilegível, sem permissão ou gravado por uma versão
  mais nova do Garimpo, nenhuma chamada ao site ou aos tribunais sai até você agir; a mensagem traz o caminho e o
  que fazer. O que não precisa de rede continua funcionando: buscas guardadas e ementas dentro das 24 h da
  memória, PDF já baixado na pasta de destino (`obter_inteiro_teor`) e leitura de PDF (`ler_inteiro_teor`).
- **Recuperação manual:** feche **todas** as instâncias do Garimpo (todas as janelas do Claude que o usam) antes
  de mexer em qualquer arquivo da pasta `protecao`; na dúvida, reinicie a máquina. Estado ilegível: mova só
  o arquivo indicado (isso apaga o histórico de pausa). Sem permissão: corrija o acesso, sem apagar. Versão mais
  nova: atualize o Garimpo da janela antiga, sem apagar nem mover.

### Memória

Os acórdãos que as buscas devolvem ficam guardados por **24 h** desde a busca, na subpasta `memoria` da pasta de
dados, e valem para todas as janelas do Garimpo: o `obter_ementa` e o `obter_inteiro_teor` pelo id funcionam
noutra janela ou no dia seguinte, dentro desse prazo, sem nova busca no site. A ementa vinda da memória diz quando
foi obtida do site ("obtido do site em DD/MM/AAAA HH:MM", hora local). Passadas as 24 h, o Garimpo pede para refazer
a busca; nunca busca sozinho.

- **Busca guardada:** cada busca com resposta do site (inclusive a busca vazia) também fica guardada por até
  24 h. Repetida nesse prazo, em qualquer janela, volta da memória sem chamada ao site, marcada como fotografia da
  busca feita no site na data e hora informadas, não como busca nova (veja `busca_direta` e `busca_ampla` em
  [Ferramentas](#ferramentas)). Busca com erro (inclusive recusa) nunca é guardada.
- **`renovar: true`** (nas duas buscas) ignora a busca guardada e busca de novo no site, passando pelo freio e pelas
  pausas. Se falhar, a busca sai **com erro**; a guardada não é usada nem apagada.
- **O texto das buscas não é gravado em claro:** cada busca guardada é achada por uma impressão digital (sha256) de
  todos os parâmetros. Isso **não é criptografia**: quem tem acesso à pasta e conhece uma formulação pode
  calcular a impressão dela e saber se essa busca foi feita nas últimas 24 h. Os acórdãos guardados ficam legíveis.
- **Consultas a outras fontes** (`julgamentos_do_processo`): só a resposta reduzida que a ferramenta mostra fica
  guardada por até 24 h, achada pela impressão digital (sha256) da fonte, do tribunal e do número; nunca a resposta
  bruta.
- A memória ocupa no máximo 200 MB (acórdãos e buscas somados, por versão do formato da memória): acima disso, o mais antigo é apagado primeiro. A
  limpeza só mexe na pasta `memoria`, nunca na `protecao`, nos PDFs nem nos recibos de origem. Memória gravada por
  outra versão do Garimpo, num formato que esta não entende, é ignorada e não é apagada.
- Falha ao ler uma busca guardada ou ao gravar a memória nunca derruba a ferramenta e, nas buscas, nunca é
  silenciosa: a busca é tratada como busca nova (vai ao site) e a resposta avisa em `avisos` (na `busca_direta`, com
  o código do erro e, na falha de gravação, a pasta; na `busca_ampla`, numa frase curta, com quantas buscas a memória
  não conseguiu ler). Como a gravação corre por trás da resposta, a falha de gravação aparece nas respostas seguintes
  da janela, até uma gravação dar certo; enquanto isso, o que a janela guarda vale só nela, enquanto estiver aberta.
  Com a rede parada ou o serviço pausado, a busca que a memória não conseguiu ler dá o erro da rede (na busca ampla,
  "com erro"), como qualquer busca nova.
- `GARIMPO_SEM_MEMORIA=1` desliga a memória em disco: cada janela guarda os acórdãos só enquanto está aberta,
  como antes, e nenhuma busca é guardada. O freio (vagas e pausas) e a conferência do PDF continuam ligados.
- **Apagar só a memória:** apague a pasta `memoria` dentro da pasta de dados (por exemplo,
  `%LOCALAPPDATA%\garimpo\memoria` no Windows). Apague só a `memoria`, nunca a pasta de dados inteira: a
  `protecao` guarda o freio.

## Instalação

Requer **Node.js 22.13 ou mais novo** (o leitor de PDF, `pdfjs-dist`, exige essa versão). Confira com
`node --version`; se aparecer uma versão mais antiga (por exemplo, `v20.x`), instale a versão LTS atual em
[nodejs.org](https://nodejs.org/) (ou, se usa um gerenciador de versões, `nvm install --lts` / `fnm install --lts`)
e reinicie o cliente MCP.

### Pelo npm (recomendado)

Não precisa baixar nada: o `npx` busca o pacote [`garimpo-mcp`](https://www.npmjs.com/package/garimpo-mcp)
na primeira execução. Se preferir instalar de vez: `npm install -g garimpo-mcp` (o comando passa a ser
`garimpo-mcp`).

**Claude Code**

```bash
claude mcp add garimpo -- npx -y garimpo-mcp
```

**Claude Desktop** — no arquivo `claude_desktop_config.json` (Configurações → Desenvolvedor → Editar configuração):

```json
{
  "mcpServers": {
    "garimpo": {
      "command": "npx",
      "args": ["-y", "garimpo-mcp"]
    }
  }
}
```

No Windows, se o Claude Desktop não achar o `npx`, use `"command": "cmd"` e
`"args": ["/c", "npx", "-y", "garimpo-mcp"]`.

### Pelo código-fonte

```bash
git clone https://github.com/leorochasf/garimpo-mcp.git
cd garimpo-mcp
npm install
npm run build
```

**Claude Code**

```bash
claude mcp add garimpo -- node /caminho/para/garimpo-mcp/dist/index.js
```

**Claude Desktop**

```json
{
  "mcpServers": {
    "garimpo": {
      "command": "node",
      "args": ["/caminho/para/garimpo-mcp/dist/index.js"]
    }
  }
}
```

### Pasta dos PDFs

Os PDFs são salvos na pasta indicada no pedido; sem pasta, em `Garimpo/inteiro-teor` dentro da pasta do usuário
(ou na pasta da variável de ambiente `GARIMPO_PASTA`).

Reinicie o Claude e peça, por exemplo: *"Use o Garimpo para buscar no STJ acórdãos sobre responsabilidade
civil do Estado por omissão."*

## Limites conhecidos

- **STF:** poucos acórdãos por busca, qualquer que seja o limite pedido (de 2 a 7 na medição de 2026-10-08); na
  busca ampla, a cobertura do STF depende do número de formulações.
- **STJ:** a maioria dos números de processo vem sem a classe (ex.: `1.234.567/SP`).
- **TJGO:** dados completos, mas com cerca de 2 meses de defasagem.
- Mesma busca repetida traz o mesmo conjunto em **ordem variável** (o site reordena por IA).
- **Busca ampla:** aderência mede proximidade de texto com a formulação, não relevância jurídica. A nota de
  relevância do site não entra na ordem: o site só reranqueia os primeiros de cada busca e dá aos demais uma nota
  de outra escala. Para caber numa resposta, a saída mostra um trecho de ~120 caracteres de cada ementa, onde mais
  palavras da formulação mais aderente aparecem juntas (sem nenhuma, o começo da ementa, sem o rótulo "Ementa:"),
  e 200 do texto de cada precedente qualificado; a ementa inteira sai por `obter_ementa`. A lista de
  precedentes qualificados só traz o que o site devolve: há teses com tema conhecido em que ela vem vazia.
- **Inteiro teor:** STF (proteção anti-robô), TJGO (reCAPTCHA) e os demais tribunais não são baixados
  automaticamente: o Garimpo devolve o link e explica como obter no navegador. Baixado o PDF, passe o caminho do
  arquivo ao `ler_inteiro_teor` para ler o texto (origem declarada, não conferida).
- **TSE:** downloads seguidos esperam 10 s entre si, contados da última saída de qualquer janela do Garimpo (o
  portal recusa chamadas em sequência).
- Tribunais cobertos (56): STF, STJ, TST, TSE, STM e os 27 TJs, inclusive TJDFT e TJTO, pelo JurisprudênciaIA; os 24
  TRTs pelo Falcão. Não há TRFs, TCU nem tribunais de contas.
- **Falcão (TRTs):** sem login, no máximo 200 documentos por busca na fonte; o Garimpo para antes do limite de pedidos
  do Falcão (**freio preventivo**: pausa de 15 min em todas as janelas, com a hora para tentar de novo), porque passar
  dele bloqueia o IP por horas. O freio reduz esse risco, sem garanti-lo: outros usos do mesmo IP não são vistos pelo
  Garimpo.

## Desenvolvimento

```bash
npm test          # testes sem internet, sobre respostas gravadas
```

Os testes não acessam a internet nem o site ou os tribunais: rodam sobre respostas gravadas e, para a
concorrência, sobre um servidor local controlado. Os de disputa entre janelas abrem processos Node reais que chamam
um servidor falso na própria máquina (`127.0.0.1`), com pasta de dados temporária.
