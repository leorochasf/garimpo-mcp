<div align="center">

<img src="docs/imagens/gabinetinho.png" width="180" alt="Gabinetinho, mascote do ia.de.gabinete">

# ⛏️ Garimpo-Jurídico

**Pesquisa de jurisprudência que acha o acórdão, traz o texto do tribunal e confere a citação antes de ela ir para a peça.**

[![npm](https://img.shields.io/npm/v/garimpo-mcp?label=npm&color=cb3837)](https://www.npmjs.com/package/garimpo-mcp)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)](#licença)
[![Node.js 22.13+](https://img.shields.io/badge/node-%E2%89%A5%2022.13-339933?logo=nodedotjs&logoColor=white)](#instalação)
[![MCP](https://img.shields.io/badge/MCP-servidor%20local-6e56cf)](https://modelcontextprotocol.io)

by [ia.de.gabinete](https://www.instagram.com/ia.de.gabinete/)

</div>

> [!IMPORTANT]
> **Cliente não oficial.** O Garimpo-Jurídico não é afiliado ao JurisprudênciaIA, à JAI, ao CSJT nem a nenhuma outra fonte. A
> busca direta do JurisprudênciaIA, que o Garimpo usa, não tem documentação pública e pode mudar sem aviso. Licença MIT.

O **Garimpo-Jurídico** (pacote npm `garimpo-mcp`, chamado de "Garimpo" daqui em diante) é um servidor MCP local (stdio) para pesquisar jurisprudência brasileira pela **busca direta** do
[JurisprudênciaIA](https://www.jurisprudenciaia.com.br) e baixar o **inteiro teor oficial** dos tribunais. Os 24 TRTs
vêm do **Falcão** (CSJT), o repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024), com o
texto integral do acórdão. Também pesquisa o **TRF2**, o **TRF4** e a **TNU** pela busca oficial de cada um, os **acórdãos do TCU** em
arquivos de dados abertos que você baixa para o seu computador e, em ferramenta à parte, o **texto literal de um
dispositivo de lei** (CPC, CC e CF) do portal oficial normas.leg.br.
Devolve dados crus e verificáveis (ementa como veio do site, número, órgão, data, link oficial); quem interpreta é a IA
de quem usa.

## Por que o Garimpo é mais que buscar jurisprudência

Achar o acórdão é o começo. O trabalho está em saber se ele diz mesmo o que você vai citar, se o texto veio do
tribunal e se o precedente ainda vale. O Garimpo cuida dessa parte.

| | O que você ganha |
|---|---|
| 🔎 **Várias fontes num pedido só** | Até 20 formulações da mesma tese em até 5 tribunais, numa lista única e sem repetidos. Cobre STF, STJ, TST, TSE, STM, TRF2, TRF4, TNU, os 27 TJs e os 24 TRTs (o valor `"trt"` pede os 24 de uma vez). Acórdãos repetidos em série, da mesma ementa, saem numa linha só. |
| 📄 **Inteiro teor oficial, com recibo** | Baixa o PDF do portal do tribunal (TJMG, TJMS, TJRR, TJSP, TSE) e grava ao lado um recibo de origem com o link oficial, a data e o sha256. No TRF2, TRF4, TNU, TJDFT, TJGO, TJPI, TJPR e TJTO, o texto vem do portal do tribunal (sem PDF, sem recibo). Nos TRTs, o texto integral vem do repositório oficial da Justiça do Trabalho. No STJ não há download automático: o robots.txt do portal veda o acesso automatizado, e o Garimpo devolve o link para você conferir e baixar no navegador. |
| 🔢 **Dados do acórdão citado, conferidos** | `conferir_acordao_citado` confere número, tribunal, data e órgão de um acórdão que você já tem citado: diz "confirmado", aponta o que não bate ou diz "não verificado" (que não prova que o acórdão não existe). `panorama_da_amostra` conta, por tribunal, ano e órgão, os acórdãos que uma busca já trouxe, sem nova chamada ao site. |
| ✅ **Citação conferida antes da peça** | Confere, por regra fixa e sem IA, se o trecho está literalmente na ementa ou no inteiro teor, com a página e a seção (ementa, voto, voto vencido…). Página que não foi lida dá "não verificável", nunca "não encontrado". |
| ⚖️ **Precedente qualificado à parte** | Temas e súmulas vêm separados dos acórdãos comuns, com o enquadramento no art. 927 do CPC. A situação e a tese do STF são consultadas no portal na hora da pergunta; as do STJ vêm da tabela datada que acompanha o pacote. Quando há informação suficiente, indica o alcance do órgão que decidiu: nacional para os casos classificados do STF e do STJ; no IRDR de outro tribunal, o âmbito de origem é condicional, sem confirmar que o incidente fixou tese. |
| 🗂️ **O processo pelo número** | Pelo número CNJ, os julgamentos registrados no DataJud e as comunicações no DJEN, ao lado dos acórdãos que a busca acha. Nunca afirma que um acórdão falta. |
| 🛡️ **Uso responsável das fontes** | No máximo 2 chamadas simultâneas, somadas em todas as janelas; em 429/503, espera e tenta uma única vez; se a fonte recusar, o Garimpo para e avisa, sem insistir. Os freios respeitam os limites das fontes e reduzem o risco de bloqueio do seu IP. O `diagnostico_dos_freios` explica por que parou e até quando. |
| 🧭 **Respostas honestas** | Falha não vira "zero resultados". Vem aviso quando falta dado (órgão, data, link), quando a lista foi cortada e quando o texto traz trecho oculto. |
| 💻 **Tudo no seu computador** | Sem conta, sem cadastro, sem servidor do Garimpo. A memória de 24 h fica numa pasta local: na medição do projeto, repetir uma busca ampla passou de 3 chamadas e 2,6 s para nenhuma chamada e 31 ms ([B3](docs/banco-de-provas/b3-medicao.md)). |

> O Garimpo encontra, baixa e confere. Não substitui a leitura do inteiro teor nem o juízo de quem assina a peça.

## Abrangência

<img src="docs/imagens/gabinetinho-lanterna.png" align="right" width="110" alt="Gabinetinho com a lanterna">

**59 tribunais**, mais fontes de apoio. A tabela diz o que cada grupo oferece; o que é **só link** não é baixado pelo Garimpo.

| Grupo | Tribunais | Busca | Precedentes qualificados | Inteiro teor |
|---|---|---|---|---|
| **Superiores** | STF | ✅ | repercussão geral, súmula vinculante, súmula | 🔗 só link (o portal usa desafio anti-robô; o Garimpo não contorna) |
| | STJ | ✅ | tema repetitivo, súmula, IAC, PUIL | 🔗 só link (o robots.txt do STJ veda o acesso automatizado) |
| | TSE | ✅ | não | 📄 PDF baixado, com recibo |
| | TST | ✅ | súmula, IRR, OJ | 🔗 só link |
| | STM | ✅ | não | 🔗 só link |
| **Justiça Estadual** | TJMG, TJMS, TJRR, TJSP | ✅ | não | 📄 PDF baixado, com recibo |
| | TJDFT, TJGO, TJPI, TJPR, TJTO | ✅ | não | 📝 texto do portal do tribunal, trazido pelo `obter_inteiro_teor` (sem PDF, sem recibo) |
| | os outros 18 TJs | ✅ | não | 🔗 só link |
| **Justiça Federal** | TRF2, TRF4 e TNU, pela busca oficial do e-Proc de cada um | ✅ (10 resultados por busca) | não | 📝 texto do portal do tribunal, trazido pelo `obter_inteiro_teor` (HTML, sem PDF, sem recibo; o Garimpo não confere a assinatura eletrônica) |
| **Justiça do Trabalho** | TRT1 a TRT24, pelo Falcão (CSJT) | ✅ | sob pedido (`precedentes: true` na `busca_direta`) | 📝 texto integral do repositório oficial (sem PDF, sem recibo) |

<details>
<summary>Os 27 TJs</summary>

TJAC, TJAL, TJAM, TJAP, TJBA, TJCE, TJDFT, TJES, TJGO, TJMA, TJMG, TJMS, TJMT, TJPA, TJPB, TJPE, TJPI, TJPR, TJRJ,
TJRN, TJRO, TJRR, TJRS, TJSC, TJSE, TJSP, TJTO. Em alguns (TJRN, TJRJ, TJSE, TJPA, TJSC) o download automático foi
testado e não está disponível; o Garimpo explica o motivo e leva ao link. TJRJ, TJSE, TJPA e TJSC trazem também a data da conferência (STJ e STF também:
ver [Limites conhecidos](#limites-conhecidos)). No TJTO, o portal entrega o acórdão em
HTML: o `obter_inteiro_teor` o traz como texto, que se lê e confere pelo id (`ler_inteiro_teor`, `conferir_citacao`).
No TJGO, o texto vem da consulta pública do processo no Projudi, só do julgamento exato que a busca achou (veja
[TJGO](#tjgo)).

</details>

**Fontes de apoio:**

- **DataJud** e **DJEN**, pelo número CNJ do processo: julgamentos registrados e comunicações. O DataJud traz só
  metadados e não cobre o STF. O DJEN pode mostrar um trecho saneado da ementa, rotulado como texto da intimação,
  quando o tipo do documento e o texto atendem aos critérios; o saneamento não garante detectar nomes livres.
- **Portal do STF**, para consultar ao vivo a situação e a tese de temas e súmulas.
- **TCU**: acórdãos dos arquivos anuais de dados abertos do tribunal, baixados por você (veja [TCU](#tcu-acórdãos-por-arquivos-anuais)).
- **normas.leg.br**, para o texto literal de dispositivos do CPC, do CC e da CF (veja a ferramenta `texto_de_lei`).

A lista exata, com os limites de cada um, sai da ferramenta `listar_tribunais`.

## Comece em 1 minuto

Com o **Node.js 22.13 ou mais novo** instalado, no Claude Code:

```bash
claude mcp add garimpo -- npx -y garimpo-mcp
```

No Antigravity CLI (`agy`):

```bash
agy mcp add garimpo -- npx -y garimpo-mcp
```

No Codex CLI (`codex`):

```bash
codex mcp add garimpo -- npx -y garimpo-mcp
```

Confira com `agy mcp list` ou `codex mcp list`. Reinicie o Claude (ou abra uma nova sessão do `agy` ou do `codex`) e peça, por exemplo: *"Use o Garimpo para buscar no STJ acórdãos sobre responsabilidade civil do
Estado por omissão."* Claude Desktop, instalação pelo código-fonte e pasta dos PDFs: veja [Instalação](#instalação).

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `busca_direta` | Uma busca num tribunal: acórdãos (até 100) e, em lista separada, precedentes qualificados (temas, súmulas). Filtros opcionais: período, relator, órgão, classe (no TRF2, no TRF4 e na TNU ainda não funcionam: a ferramenta recusa e explica; eles devolvem até 10 por busca). Só nos TRTs: `somenteEmentas` (pesquisa só nas ementas), `ordenacao` (`relevancia` ou `recentes`), `precedentes: true` (acrescenta, em lista própria, súmulas, OJs e incidentes como IRDR e IAC, com o tipo e a situação como a fonte rotula) e `decisoes` (`monocraticas` ou `sentencas`: lista de até 10 só com metadados, sem texto, que não são acórdãos nem precedente do art. 927; não combina com filtros nem com as outras opções). No campo `cabecalhoDeCobertura`, uma linha diz se o site devolveu o número pedido de registros (pode haver mais: aumente o limite ou use a busca ampla) ou menos (a base não tem mais para este texto e os filtros; no STF, que devolve poucos por busca, pode haver mais). A mesma busca repetida em até 24 h pode voltar da memória como **busca guardada**, com o campo `buscaGuardada` dizendo quando foi feita no site; `renovar: true` busca de novo no site (veja [Memória](#memória)) |
| `busca_ampla` | Várias formulações da mesma tese em um ou mais tribunais (até 20 formulações e 5 tribunais), juntadas numa lista única de acórdãos: **sem repetidos** (o mesmo acórdão achado por buscas diferentes, ou guardado em dois registros na base do site, vira um acórdão só); ordenada pela **aderência** (palavras de alguma formulação presentes na ementa), depois por quantas formulações acharam cada acórdão e pela melhor posição na busca de origem; com **vagas por tribunal** (cada tribunal pedido que tenha acórdão na faixa mais alta de aderência tem até 3 vagas garantidas na lista). **Agrupamento em série** (`agrupar`, padrão sim): acórdãos de mesmo tribunal, órgão e relator com a ementa inteira idêntica saem numa linha só, com `mesmaEmenta` (contagem, período e ids dos demais); `agrupar: false` lista cada um. Em `tribunais`, o valor `"trt"` vale pelos 24 TRTs (veja [TRTs pelo Falcão](#trts-pelo-falcão)). Saída compacta, 50 acórdãos por padrão (até 200): número, tribunal, data, órgão, **trecho** da ementa onde a tese aparece, link. Em lista própria, até 10 **precedentes qualificados** (temas, súmulas) que o site devolveu, sem repetidos. No campo `cabecalhoDeCobertura`: por tribunal, buscas feitas, vazias, com erro e não feitas (recusa no meio), acórdãos achados e mostrados (tribunal em que nenhuma busca deu resposta aparece "com erro" ou "não pesquisado", nunca "0 achados"); as formulações que não trouxeram nenhum acórdão em nenhum tribunal; e, quando a lista foi cortada pelo máximo, "mostrando X de Y". Se nenhuma busca deu resposta (recusa ou outro erro), a ferramenta responde com **erro** e o motivo de cada busca, nunca com lista vazia. Cada busca (formulação × tribunal) repetida em até 24 h pode voltar da memória como **busca guardada**, e ampliar a busca com formulações novas só busca no site as novas; no cabeçalho, o tribunal com busca guardada traz `guardadas` (quantas vieram da memória), `feitasAgora` e `maisAntiga` (data e hora local da busca guardada mais antiga). `renovar: true` busca tudo de novo no site (veja [Memória](#memória)). **Ordem** opcional (`ordem`): `aderencia` (padrão) ou `data`, que mostra os mesmos acórdãos, já escolhidos e cortados pelo máximo pela aderência, do julgamento mais antigo ao mais recente, para ver mudança de entendimento (sem data vai ao fim, com aviso; nenhuma chamada a mais). **Filtros locais** opcionais, sem nenhuma chamada a mais ao site (veja [Filtros locais](#filtros-locais-da-busca-ampla)) |
| `obter_ementa` | Ementa de um acórdão, como veio do site (com `avisoDeEmenta` quando ela parece cortada pelo próprio site: heurística, o texto não é mexido), já devolvido por uma busca nas últimas 24 h, em qualquer janela do Garimpo, pelo id, sem nova busca no site (com `GARIMPO_SEM_MEMORIA=1`, só na janela que fez a busca); diz quando o acórdão foi obtido do site (veja [Memória](#memória)) |
| `obter_inteiro_teor` | Baixa o PDF oficial do portal do tribunal (TJMG, TJMS, TJRR, TJSP, TSE; no TRF2, TRF4, TNU, TJDFT, TJGO, TJPI, TJPR e TJTO traz o texto do portal, sem PDF e sem recibo) e devolve o caminho do arquivo e o sha256. Ao lado do PDF grava o recibo de origem (`.recibo.txt`: link oficial, data e hora, sha256; declaração do Garimpo, não certidão). Recusa PDF acima de 50 MB e nunca deixa arquivo pela metade. Já devolve a **1ª parte** do texto, com o mesmo cabeçalho do `ler_inteiro_teor` e a chamada pronta para a parte seguinte. Se, num caso extremo (pasta ou link muito longos), a 1ª parte não couber no teto junto com os dados do download, vem um aviso e a chamada pronta para lê-la com o `ler_inteiro_teor`. Com `texto: false`, devolve só o caminho, o recibo e o total de páginas do PDF, sem extrair o texto (para baixar vários e ler depois, economizando tokens). Antes de baixar, procura **só na pasta de destino** um PDF do mesmo acórdão já baixado pelo Garimpo, pelo recibo de origem (mesmo tribunal e id, ou o mesmo link da busca; nunca só pelo número do processo): com o PDF intacto (mesmo sha256 do recibo), responde na hora, sem nenhuma chamada, dizendo de quando é o download (`jaEstavaNaPasta`); com várias versões válidas, usa a de download mais recente e preserva as outras. Isso vale mesmo depois das 24 h da memória, pedindo pelo id do download ou pelo link (pelo id de outra cópia equivalente do mesmo acórdão, só dentro das 24 h). Não há como forçar novo download: para outra cópia do tribunal, mova o PDF e o recibo para fora da pasta de destino (sem apagar). Se o PDF salvo não puder ser lido ou contado, o download continua valendo e vem o motivo ("total de páginas não disponível" ou o erro de leitura), nunca um número inventado. STJ (o robots.txt de `processo.stj.jus.br` veda o acesso automatizado ao host inteiro), STF e demais: devolve o link, explica como obter no navegador e ensina a ler o PDF baixado: passar o caminho do arquivo ao `ler_inteiro_teor`. Acórdão que veio da busca sem link nenhum: pede o link, uma vez, à rota de link do JurisprudênciaIA (exceto TST; só aceita https em domínio .jus.br) e diz que veio de lá; sem link também ali, diz como achar o acórdão pelo número CNJ no portal de jurisprudência do tribunal |
| `ler_inteiro_teor` | Lê, pelo caminho do arquivo, o PDF que o `obter_inteiro_teor` baixou, ou um PDF que você baixou à mão em qualquer pasta, e devolve uma **parte** do texto (cerca de 8 mil tokens estimados, feita de páginas do PDF inteiras; página grande demais vem em segmentos, com a continuação indicada). Cada parte traz o mesmo cabeçalho: tribunal, número, data, link oficial, sha256, id, nome do arquivo, origem e "páginas X–Y de N (parte P de T)" (páginas do PDF, não folhas dos autos), com "não informado" no que faltar, e a chamada pronta para a parte seguinte. Origem **conferida** só quando o recibo de origem ao lado do PDF é reconhecido, registra download pelo Garimpo e tem o mesmo sha256 do arquivo; senão, **não conferida**, com o motivo (sem recibo, recibo de formato desconhecido, PDF alterado depois do download). Página sem texto extraível é avisada ("pode ser escaneada"; não há OCR); PDF que o extrator não consegue ler é erro de leitura. PDF sem recibo é **inteiro teor trazido pelo usuário**: origem declarada, não conferida, nunca chamado de oficial. Só aceita arquivo PDF de até 50 MB (não aceita URL nem pasta, e não procura arquivos sozinho). Para esse PDF, se quiser, informe o id que veio na busca, ou tribunal + número: o cabeçalho é preenchido como **vínculo declarado pelo usuário** (com a memória do Garimpo, sem nova chamada à rede) e diz se o número do processo aparece no texto (encontrado / não encontrado / não verificável), só como informação. Não grava, não copia e não chama a rede |
| `conferir_citacao` | Confere, por regra fixa e sem IA, se cada citação (até 20 por chamada; 5 palavras ou mais, até 3 mil caracteres) está literalmente na ementa do acórdão, pelo id que veio na busca (ementa guardada na memória do Garimpo). Vereditos: **encontrado literalmente** (só diferença de espaço, quebra de linha, espaço não separável, forma Unicode dos acentos ou aspas/apóstrofos tipográficos, avisadas); **encontrado com supressão indicada** (cortes marcados com `(...)` ou `[...]`, pedaços de 5 palavras ou mais, na ordem); **difere só em maiúsculas/pontuação** (não é literal; vem o texto exato da fonte); **não encontrado** (com a passagem parecida copiada da fonte, quando 80% ou mais das palavras estão na mesma ordem, rotulada como diferente da citação); **não verificável** (acórdão fora da memória — refaça a busca — ou sem ementa). Hífen, meia-risca e travessão nunca são iguais. Reticências soltas (e o corte escrito com a reticência de um caractere só, `(…)`) são texto, salvo `reticenciasComoCorte`. Item da lista sem `citacao` ou `id`, e citação curta ou longa demais, recebem resultado próprio com a frase que ensina a corrigir, sem derrubar as outras. A posição vem como a frase da ementa que contém a citação (até 10 ocorrências, com o total); passagem entre aspas ganha o aviso de que pode ser de outro autor. Com `caminho` (o PDF do `obter_inteiro_teor` ou um trazido pelo usuário), confere também no inteiro teor: a posição vem como página do PDF, parte e segmento, com a origem do PDF (no PDF trazido, declarada pelo usuário, não conferida; o `id` junto é só vínculo declarado) e a seção do acórdão pelo título de seção sozinho na linha (EMENTA, ACÓRDÃO, RELATÓRIO, VOTO, VOTO-VISTA, VOTO VENCIDO, VOTO VOGAL, CERTIDÃO), ou "não identificada"; no relatório e no voto vencido, aviso forte. O Garimpo nunca diz de quem é a passagem, e a falta de sinal não prova que ela é do tribunal. Achar o texto não autentica a fonte. Não grava e não chama a rede |
| `consultar_precedente` | Precedente pelo número (tipo obrigatório: a numeração de cada tipo é separada), **STJ** (tema repetitivo ou IAC) responde direto pela tabela de precedentes do pacote, sem consultar o portal (o robots.txt do STJ veda o acesso automatizado): situação na fonte literal, tese firmada, questão submetida, órgão julgador e processo paradigma, dizendo "tabela de <data>; consulta automática ao portal não realizada: o robots.txt do portal veda o acesso automatizado, e o Garimpo respeita". **STF** (repercussão geral, súmula ou súmula vinculante) é **consultado ao vivo no portal**, na hora da pergunta, com memória de 24 h: situação do tema e tese, ou a marca de situação da lista de súmulas e o enunciado, com o endereço; a resposta diz "consultado no portal do STF em <data e hora>". Se o portal do STF não responder, a resposta vem da tabela do STF do pacote, dizendo "tabela de <data>, o portal do STF não respondeu" e o motivo (veja [Precedentes ao vivo](#precedentes-ao-vivo)). Sempre com enquadramento no art. 927 |
| `julgamentos_do_processo` | Pelo número CNJ (com ou sem máscara; o tribunal sai do número, ou informe `tribunal`, ex.: `stj` para o processo que subiu), os **julgamentos registrados** do processo no **DataJud**, a base pública de metadados do CNJ (sem texto de decisão e sem nome de parte): só registros de 2º grau ou de tribunal superior (os de 1º grau são contados), só movimentos de resultado de julgamento da Tabela Processual Unificada e, à parte, a juntada de documento com complemento "Acórdão". Cada linha traz a data do **lançamento no DataJud** (não a da sessão), código, nome e órgão; cada registro, a última atualização no DataJud. Ao lado, os acórdãos do mesmo número que uma busca pelo número no JurisprudênciaIA devolve, com o id; em `ladoALado`, os totais das duas fontes e, só com as duas respostas utilizáveis e sem corte, a comparação de embargos de declaração com embargos de declaração e o que conferir no portal do tribunal (o movimento de tipo não verificado, ou a diferença de embargos). **Nunca afirma que um acórdão falta.** Cada fonte vem com o seu estado (ok, vazia, erro, recusa, pausa, não consultada): "o DataJud não devolveu este processo" não prova que ele não exista. O DataJud não cobre o STF. Consulta repetida em 24 h volta da memória. Uso sob o [termo de uso da API Pública do CNJ](https://formularios.cnj.jus.br/wp-content/uploads/2023/11/Termos-de-uso-api-publica-V1.2.pdf) (fins legais e não comerciais): a consulta sai do computador de quem usa o Garimpo, e as obrigações do termo são de quem usa a API; a chave pública vem no Garimpo e pode ser trocada pela variável `GARIMPO_DATAJUD_CHAVE`. Com `incluir_djen` (padrão; `false` responde mais rápido), também as **comunicações do processo no DJEN** (uma página, até 100; "lista cortada" quando há mais): data de disponibilização, tipo de comunicação e de documento, órgão, classe e link, sem campos de parte ou advogado. Quando o tipo do documento e o texto atendem aos critérios, mostra um trecho saneado da ementa, rotulado como texto da intimação, não o acórdão oficial; o saneamento não garante detectar nomes livres. Na dúvida, o trecho é "não verificado". São comunicações do processo, não um inventário de acórdãos. Se o DJEN pedir para esperar mais de 1 minuto, a resposta vem na hora com o que as outras fontes trouxeram e o instante em que se pode tentar de novo (estado `pausa`, que não é recusa). Fontes e limites: [`docs/fontes.md`](docs/fontes.md) |
| `listar_tribunais` | Para cada tribunal: a fonte (JurisprudênciaIA, Falcão, e-Proc do TRF2, e-Proc do TRF4 ou e-Proc da TNU), busca, precedentes qualificados, teto de resultados por busca e se o inteiro teor é baixado, só linkado, texto do portal do tribunal ou, nos TRTs, texto integral do repositório oficial (sem PDF). A mesma tabela, com os limites do Falcão, sai no recurso `garimpo://tribunais` |
| `diagnostico_dos_freios` | "Por que parou?": sem chamar fonte nenhuma, lê o estado de proteção guardado no computador e diz, fonte por fonte, se ela está pausada por recusa e até quando, se está em pausa preventiva (com o restante que a fonte informou) e o que aconteceu nas últimas 24 h (pedidos de espera, recusas, chamada de prova recusada ou aceita, com o nome da ferramenta; nunca o termo de busca nem o número de processo). Aponta **indício de recusa sistemática** (2 ou mais recusas finais em 24 h, uma delas na chamada de prova, sem nenhuma chamada aceita no meio, ou, com a fonte ainda pausada, a chamada de prova já recusada desde a última aceita, sem limite de tempo: esperar provavelmente não resolve) ou diz que parece rajada (a pausa costuma passar). Avisa a rede parada e quando esta janela não conseguiu gravar uma recusa no estado. O limiar do indício ainda não foi ajustado com uso real |
| `conferir_acordao_citado` | Confere o número, o tribunal e, se informados, a data de julgamento e o órgão de um acórdão que você já tem citado. Com o `id` de uma busca e o acórdão na memória, não chama o site; sem `id`, faz uma busca direta pelo número. Estados: **confirmado**, **dados em conflito** (cada divergência vem com o que foi informado e o que está no registro) e **não verificado** (a busca não trouxe o número: isso **não quer dizer** que o acórdão não existe). Número com mais de um acórdão (recurso e embargos) lista os outros. Compara só com a base do JurisprudênciaIA; não vale para TRT. Confira no portal do tribunal antes de citar |
| `panorama_da_amostra` | Conta, por tribunal, por ano de julgamento e por órgão julgador, os acórdãos que uma busca já trouxe (informe de 1 a 200 ids, como vieram na busca; o acórdão tem de estar na memória de 24 h). Não chama o site. É contagem da **amostra** da busca, não estatística do tribunal: o aviso vem em toda resposta. Sem data ou órgão, vai em "sem data" ou "sem órgão informado"; id fora da memória vem em `foraDaMemoria` |
| `texto_de_lei` | **Legislação, fora da jurisprudência:** o texto **literal** de UM dispositivo (artigo, parágrafo, inciso ou alínea; ex.: `art. 85, § 2º, inciso I`) do diploma pedido pela sigla (hoje `CPC`, `CC` e `CF`; o CDC ainda não foi provado), como a página oficial [normas.leg.br](https://normas.leg.br) (Congresso Nacional e Senado Federal; licença CC BY 4.0) o mostra, com a URL oficial, a data de obtenção e o aviso fixo "texto conforme a página oficial em <data>; o Garimpo não afirma vigência". As redações do dispositivo vêm todas (`versoesNaFonte`), mesmo quando há só uma, da mais antiga para a mais recente, com as marcas dela (lei alteradora, nota, período, `NotInForce`...): o Garimpo **não conclui qual vale, não afirma vigência, não reconstitui alteração e não liga artigo a precedente**. Dispositivo sem texto na fonte: "não verificado"; dois dispositivos com a mesma identificação: "identificação necessária"; diploma desconhecido: erro com a lista. A norma inteira vem numa resposta (o CPC passa de 4 MB): uma chamada por consulta, 1 s entre chamadas; a repetida volta da memória, com a data da obtenção original. Fonte e limites: [`docs/fontes.md`](docs/fontes.md) |
| `baixar_anos_tcu` | **TCU.** Sem argumentos, lista os anos de acórdãos que o TCU publica em dados abertos, com o tamanho de cada arquivo (300 a 500 MB nos anos recentes; o acervo inteiro tem cerca de 7,6 GB) e quais já estão baixados. Com `anos`, só **avisa** (tamanho por ano e no total, pasta de destino; nada é baixado). Com `anos` e `confirmar: true`, baixa um ano por vez direto do TCU, pelo cliente único com os freios, retomável se cair, com hash e data no recibo. Ano já baixado não é baixado de novo; `renovar: true` pergunta ao TCU se o arquivo mudou e mantém a cópia antiga se falhar. Nunca baixa o acervo sozinho |
| `pesquisar_acordaos_tcu` | **TCU.** Pesquisa, no seu computador e sem rede, os acórdãos dos anos já baixados: por palavras (todas devem aparecer; frase entre aspas vale inteira), com filtros de anos, tipo, colegiado e relator. Devolve chave, número, ano, data da sessão, colegiado, relator, tipo, situação, **sumário** (o resumo do TCU: sumário, não ementa), trechos e link oficial para conferência, dos mais recentes aos mais antigos. Acórdão invalidado e sigiloso não entram (a resposta diz quantos). **A pesquisa lê os arquivos inteiros: na medição de 2025, levou de 7 a 19 s por pesquisa**; pesquisar vários anos soma esse custo. Baixe poucos. Toda resposta traz a data da base de cada ano, os anos percorridos, o tempo gasto e o aviso de que o texto oficial cita nomes de pessoas e o Garimpo não os retira |
| `ler_acordao_tcu` | **TCU.** Lê, do arquivo anual já baixado (sem rede), uma parte de um acórdão: `acordao`, `relatorio`, `voto`, `decisao` ou `sumario`, em partes numeradas. Relatório e voto só existem no tipo ACÓRDÃO; o acórdão de relação traz só o texto. Acórdão invalidado ou sigiloso não mostra texto (relatório, voto ou sumário classificados como sigilosos pelo TCU são reconhecidos e avisados). Interessados e advogados do arquivo não são lidos |

As respostas de `busca_direta`, `busca_ampla` e `obter_ementa` trazem, no campo `avisoNaturezaJuridica`, a linha
"Resultado de busca em base não oficial. Confira o acórdão na fonte oficial do tribunal antes de citar; a ementa não
substitui o inteiro teor." Nos TRTs, o aviso é o do Falcão: "Resultado obtido do repositório oficial da Justiça do
Trabalho (Falcão) por cliente não oficial (Garimpo); confira no portal do tribunal antes de citar."; na busca ampla
com as duas fontes, vêm os dois, cada um com a sua (a oficialidade do Falcão não se estende ao JurisprudênciaIA).

### Roteiro de pesquisa

O Garimpo traz um roteiro pronto, o prompt `pesquisar_tese`, que diz à IA como pesquisar uma tese do começo ao fim. Ele
não afirma jurisprudência: só vale o que as ferramentas devolvem.

- **Estratégia antes dos resultados:** a IA mostra a questão central e as formulações de busca que vai usar.
- **Pergunta sobre súmula ou tema** tem resposta própria, em ordem fixa (S1 a S5): o texto e de onde veio; a situação
  como a fonte informa, com data, ou "não verificado"; a força pelo art. 927 do CPC; a aplicação pelos tribunais
  (mencionar não é aplicar); e o desgaste.
- **Desgaste do entendimento em três caixas:** "a fonte indica" (literal, com data e origem), "indício" (algo no
  material que sugere mudança, com o trecho e a frase "não prova superação") e "não verificado". "Vigente" e
  "superado" só aparecem dentro de citação literal da fonte.
- **"Onde a pesquisa está fraca":** formulações sem acórdão, tribunais com erro ou não pesquisados, lista cortada e
  buscas vindas da memória, tirado só do que a busca devolveu.
- **Privacidade:** a busca é formulada com a tese em abstrato, sem nome de parte nem dado do caso.

### TRTs pelo Falcão

- **Busca direta** (`trt1` a `trt24`), sem `decisoes`: acórdãos; `limite` padrão 10, máximo 30 (3 páginas do Falcão). Cada
  acórdão traz o rótulo "Falcão — repositório oficial de jurisprudência da Justiça do Trabalho (Res. CSJT 401/2024)",
  número, classe, relator, turma, **julgado em** (`dataJulgamento`) e **juntado em** (`dataJuntada`, que não é data
  de publicação; a publicação não é informada pela fonte). Acórdão sem ementa aparece como "sem ementa no Falcão",
  sem trecho inventado. O cabeçalho de cobertura separa o total que o Falcão informa ("10.000 ou mais" no teto da
  contagem dele) de quantos vieram e quantos são mostrados. Nomes de partes nunca vão a listas, cabeçalhos nem à busca
  guardada.
- **Busca ampla:** cada TRT conta como tribunal (até 5; o valor `"trt"` em `tribunais` vale pelos 24 TRTs e conta como um só dos 5), 1 página (10) por formulação × TRT, com teto de **5 páginas
  do Falcão por chamada**, usadas primeiro na 1ª formulação de cada TRT pedido, na ordem dada; o que não couber sai
  no cabeçalho como `foraDoTeto` (repita a chamada para executar o que faltou: o já feito volta da memória). Cobrir os 24 TRTs com uma página por formulação exige 24 chamadas por formulação, dentro do
  teto diário de 50 chamadas: o `cabecalhoDeCobertura.agrupadorTrt` diz, em números, o que esta chamada fez e o que ficou
  para repetir.
- **Opções da busca direta só dos TRTs:** `somenteEmentas` (pesquisa só nas ementas), `ordenacao` (`relevancia` ou `recentes`),
  `precedentes: true` (acrescenta, em lista própria, súmulas, OJs e incidentes como IRDR e IAC da coleção de
  precedentes do Falcão: 1 chamada a mais, até 10 itens, com o tipo e a situação como a fonte rotula, ou "não
  verificado") e `decisoes` (veja abaixo).
- **Decisões monocráticas e sentenças:** `decisoes: "monocraticas"` ou `"sentencas"` traz, em vez de acórdãos, a 1ª
  página (até 10) da coleção correspondente do Falcão, **só metadados e nunca o texto**, em lista própria. Não são
  acórdãos nem precedentes do art. 927 do CPC, e a resposta diz isso. Não combina com filtros nem com as outras
  opções; não há busca guardada (repetir chama o Falcão de novo e conta no teto diário). Provado só no TRT2.
- **Texto integral:** vem na própria busca e fica na memória do Garimpo por 24 h (o Falcão não tem busca por id).
  `ler_inteiro_teor` com o `id` (sem caminho) o devolve em partes por tamanho, convertido de HTML (não é PDF, sem
  recibo de origem); `conferir_citacao` com o `id` confere na ementa e no texto integral, dizendo em qual achou;
  `obter_inteiro_teor` explica que não há PDF. Fora da memória, refaça a busca (pode não trazer o mesmo acórdão).
- **Ainda não:** filtros `de`, `ate`, `relator`, `orgao` e `classe` nos TRTs (erro que ensina, sem chamada), TST pelo
  Falcão. Termos de uso do Falcão lidos e registrados em
  [`docs/fonte-falcao.md`](docs/fonte-falcao.md).

Tribunal inválido e data fora do formato recebem uma frase em português que diz como corrigir: as siglas válidas;
"use AAAA-MM-DD". Na `busca_ampla`, `formulacoes` e `tribunais` aceitam lista, texto
de lista JSON (`"[\"a\", \"b\"]"`) ou texto solto, que vale como **um** item só: o texto nunca é partido por
vírgula, para que uma formulação como "art. 37, § 6º" chegue inteira.

### TRF4

`busca_direta` com `tribunal: "trf4"` usa a busca oficial do módulo de jurisprudência do e-Proc do TRF4, aberta, sem
login nem captcha ([ADR-0024](docs/adr/0024-trf4-busca-oficial-do-eproc-e-texto-do-portal.md)).

- **Busca:** ementa inteira, data de julgamento e de publicação; **10 resultados por busca** (limite acima disso vale
  10, com aviso). São 2 chamadas por busca (formulário e resultado). Filtros de período, relator, órgão e classe,
  `somenteEmentas: true`, `precedentes: true` e `ordenacao` diferente de `relevancia` ainda não funcionam no TRF4: o Garimpo
  recusa e explica, sem chamar o site. Os valores neutros `false` e `relevancia` mantêm a busca padrão nas ementas,
  na ordem do portal; não significam ordenação por relevância confirmada.
- **Inteiro teor:** `obter_inteiro_teor` traz o acórdão (relatório, voto, ementa) como **texto do portal do
  tribunal**: é HTML com assinatura eletrônica, não PDF, e sem recibo. O Garimpo não confere a assinatura. O texto
  fica na memória por 24 h e se lê e se confere pelo id (`ler_inteiro_teor`, `conferir_citacao`).
- **Link de acompanhamento do processo:** só é mostrado, nunca aberto pelo Garimpo, porque o `robots.txt` do tribunal
  veda esse caminho.
- **Não verificado:** o termo de uso do TRF4 não fala de acesso automatizado (sem vedação não é autorização); a
  velocidade em relação ao STJ pelo JurisprudênciaIA não foi medida. Detalhes em [`docs/fontes.md`](docs/fontes.md).

### TNU

`busca_direta` com `tribunal: "tnu"` usa o mesmo módulo de jurisprudência do e-Proc, hospedado pelo CJF
(`eproctnu-jur.cjf.jus.br`), aberto, sem login nem captcha ([ADR-0027](docs/adr/0027-tnu-pelo-eproc-do-cjf.md)).
Valem as mesmas regras do TRF4: 10 acórdãos por busca, só ementa, filtros recusados com explicação, texto do portal
como inteiro teor (HTML, sem PDF e sem recibo). Diferenças: a lista da TNU não traz órgão julgador nem link de
acompanhamento do processo, e precedentes qualificados da TNU não são pesquisados (lista vazia por isso). Na prova de
2026-10-19 havia julgados de 30/09/2026. **Não verificado:** o termo de uso desse host (sem vedação achada não é
autorização; risco aceito pelo mantenedor) e a velocidade.

### TRF2

`busca_direta` com `tribunal: "trf2"` usa o mesmo módulo de jurisprudência do e-Proc, no próprio TRF2
(`eproc.trf2.jus.br`), aberto, sem login nem captcha ([ADR-0028](docs/adr/0028-trf2-pelo-eproc-do-tribunal.md)).
Valem as mesmas regras do TRF4: 10 acórdãos por busca, só ementa, com órgão julgador, filtros recusados com explicação,
texto do portal como inteiro teor (HTML assinado, sem PDF e sem recibo). O link de consulta do processo só é mostrado,
nunca aberto pelo Garimpo. Precedentes qualificados do TRF2 não são pesquisados (lista vazia por isso). Na prova de
2026-10-19 havia julgados de 27/08/2026. **Termo de uso:** a Resolução TRF2-RSP-2022/00032 (art. 13, § 1º) proíbe robôs
nos portais do tribunal sem autorização expressa; o TRF2 entra por decisão do mantenedor de que essa proibição não
alcança o sistema de consulta de jurisprudência. Não há autorização expressa do TRF2.

### TJGO

A busca do TJGO segue vindo do JurisprudênciaIA. O link do acórdão abre a página pública do processo no Projudi, e o
`obter_inteiro_teor` traz por ela o texto do acórdão: o arquivo «Ementa» e o «Relatório e Voto» do julgamento, como
texto do portal do tribunal (HTML, sem PDF e sem recibo; o Garimpo não confere a assinatura)
([ADR-0029](docs/adr/0029-tjgo-inteiro-teor-pela-pagina-do-processo-no-projudi.md)). O caminho é público e não passa
pela verificação anti-robô, que fica só no formulário de busca do portal, que o Garimpo não usa (decisão do mantenedor;
não há autorização do TJGO). **Só o julgado exato:** um processo pode ter vários acórdãos (apelação, embargos de
declaração, agravo interno); o Garimpo casa a data e a hora do «julgado em» da ementa com uma única movimentação de
julgamento, confere que a ementa desse julgamento é o arquivo que a busca apontou e que o texto traz a ementa da busca.
Arquivos assinados (`.p7s`) são lidos pelo documento de dentro do envelope; o Garimpo não confere a assinatura.
Se algo não bate (sem hora na ementa, dois julgamentos no mesmo instante, processo em segredo, arquivo bloqueado,
assinatura sem documento embutido, erro do Projudi), não baixa e diz o motivo, com o link do processo. São até 6
chamadas por acórdão, uma por vez, com os freios de sempre. Na verificação de 2026-10-22, 21 de 27 acórdãos vieram,
todos o julgamento certo; os outros 6 trouxeram o motivo.

### TJPR

A busca do TJPR segue vindo do JurisprudênciaIA. O link do acórdão abre a página pública dele no portal de
jurisprudência do tribunal, que já traz a íntegra; o `obter_inteiro_teor` lê esse bloco e o guarda como texto do portal
do tribunal (HTML, sem PDF e sem recibo; o tribunal avisa que é transcrição, com as imagens suprimidas)
([ADR-0030](docs/adr/0030-tjpr-inteiro-teor-pela-pagina-do-acordao.md)). Uma chamada por acórdão, com os freios de
sempre. Só guarda o texto do documento do link, com o mesmo número de processo da busca e esse número escrito dentro da
íntegra: o portal às vezes mostra na página certa a íntegra de outro acórdão (cerca de 1 em 3 chamadas na conferência
de 2026-10-29), e aí o Garimpo não guarda nada e diz o motivo. Acórdão em segredo de justiça não tem texto guardado. O `robots.txt` do portal não veda a jurisprudência; não há autorização do TJPR (não pedida).

### TCU: acórdãos por arquivos anuais

O TCU publica, em dados abertos, um arquivo por ano com os acórdãos completos. O Garimpo não leva esses dados no
pacote nem os repassa: **você escolhe os anos, o Garimpo avisa o tamanho e o tempo e só baixa com a sua confirmação**,
direto do TCU para o seu computador ([ADR-0025](docs/adr/0025-tcu-arquivos-anuais-baixados-pelo-usuario.md)).

1. `baixar_anos_tcu` sem argumentos lista os anos e os tamanhos (300 a 500 MB por ano nos anos recentes; o acervo
   inteiro tem cerca de 7,6 GB). Com `anos`, só avisa. Com `anos` e `confirmar: true`, baixa um ano por vez.
2. `pesquisar_acordaos_tcu` pesquisa os anos baixados, sem rede. **A pesquisa varre o arquivo de cada ano**, o que
   levou de 7 a 19 s por pesquisa na medição do arquivo de 2025. Pesquisar vários anos soma esse custo: baixe poucos
   anos. Não há índice nesta versão.
3. `ler_acordao_tcu` lê uma parte do acórdão.

O campo do TCU é **sumário**, nunca "ementa". Cada resposta traz a data da base e a atribuição ao TCU. Acórdão
invalidado ou sigiloso não entra como texto. Interessados e advogados do arquivo nunca são lidos; o relatório e o voto
podem citar nomes de pessoas, e a pesquisa avisa que o Garimpo não os retira. O conjunto não declara licença aberta:
valem os termos do Portal do TCU (uso comercial vedado sem permissão).

### Agrupamento em série

Na `busca_ampla`, acórdãos distintos que têm o **mesmo tribunal, órgão e relator e a ementa inteira idêntica** (só
espaços e quebras de linha são ignorados) saem numa linha só, com `mesmaEmenta`: contagem, período e ids dos demais,
que seguem acessíveis. Nunca agrupa ementa parecida, ausente ou cortada, nem acórdãos de órgãos ou relatores
diferentes. O rótulo é "mesma ementa", não "mesma tese". Vem ligado; `agrupar: false` lista cada acórdão
([ADR-0023](docs/adr/0023-agrupar-decisoes-em-serie-na-lista.md)). O agrupamento não muda os acórdãos escolhidos
nem a contagem; se os dados dos grupos ultrapassarem o teto da resposta, a lista fica individual.

### Âmbito do precedente

O enquadramento no art. 927 do CPC informa o âmbito nacional nos casos classificados do STF e do STJ: é o alcance
do órgão que decidiu, sem afirmar aplicação ao caso. Para IRDR de outro tribunal, informa o tribunal de origem
(incluindo os juizados da região), sob a condição de que o incidente tenha fixado tese; o Garimpo não confirma essa
condição. Sem regra para o caso, o âmbito fica ausente, nunca presumido.

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

O `consultar_precedente` busca o precedente do STF **no portal do tribunal, na hora da pergunta, do seu
computador** ([ADR-0020](docs/adr/0020-precedentes-qualificados-ao-vivo-tabela-como-plano-b.md)):

- **STJ: sem consulta ao portal.** O `robots.txt` de `processo.stj.jus.br` (lido em 2026-10-13) veda o host inteiro
  a programas, e o Garimpo respeita: tema repetitivo e IAC saem direto da tabela do pacote, com a data dela, o
  aviso de idade e a frase "consulta automática ao portal não realizada: o robots.txt do portal veda o acesso
  automatizado, e o Garimpo respeita". Para a situação do
  dia, confira no portal do STJ pelo navegador.
- **STF:** repercussão geral pela ficha do tema e pela página com a tese (2 chamadas); súmula e súmula vinculante pela
  lista do tipo e pela página da súmula (2 chamadas; 1 enquanto a lista estiver na memória). O portal do STF recusa
  (HTTP 403) quem se identifica como o Garimpo; por decisão do dono, ali o Garimpo se apresenta como navegador.
- **Freios:** tudo passa pelo mesmo cliente das outras fontes (no máximo 2 chamadas simultâneas no total, em 429/503
  espera e tenta uma vez, recusa final pausa o serviço em todas as janelas), com serviço próprio no disjuntor
  (`stf-precedentes`) e prazo de 30 s por chamada. O resultado fica 24 h na memória.
- **Plano B (STF):** se o portal recusar, estiver fora, pausado ou devolver uma página que o Garimpo não reconhece, a
  resposta vem da tabela do STF do pacote, com "tabela de <data>, o portal do STF não respondeu" e o motivo.
- **Listas de qualificados das buscas** continuam pela tabela: conferir cada item ao vivo custaria dezenas de chamadas
  por busca. Para o dado do dia do STF, use o `consultar_precedente` no precedente que importa; no STJ, confira
  manualmente no portal, pois a ferramenta usa a tabela datada.

### Tabela de precedentes do STJ

O pacote leva uma **fotografia datada** dos temas repetitivos e dos IAC do STJ, tirada do conjunto
[Precedentes qualificados](https://dadosabertos.web.stj.jus.br/dataset/precedentes-qualificados) do Portal de Dados
Abertos do STJ (`dados/tabela-precedentes-stj.json`). É dela que vêm a resposta do `consultar_precedente` para o STJ e, nas listas
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

`busca_direta`, `busca_ampla`, `obter_ementa`, `ler_inteiro_teor`, `conferir_citacao`, `consultar_precedente`, `julgamentos_do_processo`, `listar_tribunais`, `diagnostico_dos_freios`, `conferir_acordao_citado`, `panorama_da_amostra`, `texto_de_lei`, `pesquisar_acordaos_tcu` e `ler_acordao_tcu` são declaradas ao cliente como
ferramentas que só leem (as buscas de jurisprudência, o `consultar_precedente`, o `conferir_acordao_citado`, o `julgamentos_do_processo` e o `texto_de_lei`, como ferramentas que consultam serviço externo); `obter_inteiro_teor` e `baixar_anos_tcu` não, porque gravam
arquivos no disco. Cabe a cada cliente decidir se usa essa marca para dispensar o pedido de permissão.

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
- no TJDFT, lê também o saldo de chamadas que a própria API do tribunal informa e, na reserva, pausa em todas as
  janelas ([`docs/fontes.md`](docs/fontes.md));
- depois de uma **recusa final** (a nova tentativa recusada de novo, 403, desafio anti-robô ou pedido de espera
  acima de 30 s), **pausa o serviço** em todas as janelas (abaixo);
- identifica-se com um User-Agent honesto (`Garimpo/<versão> …`). **Exceções: o Falcão (CSJT), o portal do STF e o
  portal de jurisprudência do TJTO** recusam programas que não se apresentam como navegador (HTTP 403); por isso o
  Garimpo usa nesses três, **e só neles**, um User-Agent de navegador fixo por versão (no Falcão, com `Origin`/`Referer`
  do próprio site), sempre dentro destes freios; no Falcão, com 1 s entre chamadas em todas as janelas. Termos do
  Falcão lidos e registrados em [`docs/fonte-falcao.md`](docs/fonte-falcao.md); o uso no STF é decisão do dono
  ([ADR-0020](docs/adr/0020-precedentes-qualificados-ao-vivo-tabela-como-plano-b.md)), assim como o uso no TJTO
  ([ADR-0021](docs/adr/0021-tjto-ua-de-navegador-e-texto-do-portal.md));

Os termos de uso do site preveem limites por IP e bloqueio em caso de uso abusivo. Use com moderação.

O Garimpo consulta decisões de julgamentos públicos (CF, art. 93, IX) e textos de decisões judiciais, que não são
objeto de proteção como direitos autorais (Lei 9.610/98, art. 8º, IV); só consulta fontes abertas ao público e
respeita os limites de cada uma. Textos literais, conferidos em 23/10/2026:

- CF, art. 93, IX (normas.leg.br; redação da EC 45/2004): "todos os julgamentos dos órgãos do Poder Judiciário serão
  públicos, e fundamentadas todas as decisões, sob pena de nulidade, podendo a lei limitar a presença, em determinados
  atos, às próprias partes e a seus advogados, ou somente a estes, em casos nos quais a preservação do direito à
  intimidade do interessado no sigilo não prejudique o interesse público à informação;"
- Lei 9.610/98, art. 8º, IV (camara.leg.br, publicação original e texto atualizado): "Art. 8º Não são objeto de
  proteção como direitos autorais de que trata esta Lei: [...] IV - os textos de tratados ou convenções, leis,
  decretos, regulamentos, decisões judiciais e demais atos oficiais;"

**Atualize e reinicie todas as janelas.** Janelas com versão do Garimpo anterior a esta não participam da proteção
compartilhada (vagas, pausa do TSE e pausas por recusa): com uma delas aberta, o total pode passar de 2 e uma
pausa pode ser ignorada. A proteção também não alcança outras pessoas, máquinas
ou programas que usem o mesmo IP.

O estado com os limites próprios usa o formato de proteção versão 3: janelas que só entendem a versão 2 param a
rede e pedem atualização. Os contadores não zeram se o relógio recuar; aguardam o fim da janela ou do dia guardado.

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
- Para saber o que está pausado, até quando e se a recusa parece sistemática, use o `diagnostico_dos_freios`: ele
  só lê o estado guardado e não faz nenhuma chamada.

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
`node --version` (no Windows, abra o Terminal pelo menu Iniciar e digite o comando); se aparecer uma versão mais antiga (por exemplo, `v20.x`), instale a versão LTS atual em
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

No Windows, o arquivo fica em `%APPDATA%\Claude\claude_desktop_config.json`, mas a pasta pode mudar conforme a
instalação: chegue a ele pelo botão Editar configuração (Edit config, com a interface em inglês). O botão não abre um
editor: abre a pasta no Explorador de Arquivos, com o arquivo já selecionado. Abra-o com um editor de texto.

O arquivo pode já ter outras configurações (o próprio Claude grava nele). Não apague nada: acrescente o bloco
`garimpo` dentro de `mcpServers` (crie `mcpServers` se não houver).

Depois de salvar, feche o Claude de verdade: clique com o botão direito no ícone do Claude perto do relógio (às vezes
atrás da seta ^) e escolha Sair (Exit). Fechar no X não basta: o Claude continua aberto na bandeja. Abra-o de novo e
confira em Configurações → Desenvolvedor (Settings → Developer): o `garimpo` aparece como "Running" (rótulo visto com
a interface em inglês).

No Windows, se o Claude Desktop não achar o `npx`, use `"command": "cmd"` e
`"args": ["/c", "npx", "-y", "garimpo-mcp"]`.

### Antigravity (CLI `agy`)

Testado no Windows com `agy` 1.3.3. Não testado no app/IDE do Antigravity.

```bash
agy mcp add garimpo -- npx -y garimpo-mcp
```

Para conferir, rode `agy mcp list` (deve aparecer `garimpo stdio enabled npx -y garimpo-mcp`) ou digite `/mcp` dentro do `agy`.

Para definir a pasta dos PDFs (`GARIMPO_PASTA`), as flags vêm **antes** do nome:

```bash
agy mcp add -e GARIMPO_PASTA=C:\caminho\dos\pdfs garimpo -- npx -y garimpo-mcp
```

O `agy` pede autorização a cada ferramenta. Para liberar só as do Garimpo, veja
[Sem o pedido de permissão a cada consulta](#sem-o-pedido-de-permissão-a-cada-consulta)
([documentação](https://antigravity.google/docs/permissions?tab=cli)).

Configuração manual, opcional: em `%USERPROFILE%\.gemini\config\mcp_config.json`
([documentação](https://antigravity.google/docs/cli/mcp.md)):

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

### Codex (CLI `codex`)

Testado no Windows com `codex-cli` 0.161.0-alpha.1.

```bash
codex mcp add garimpo -- npx -y garimpo-mcp
```

Para conferir, rode `codex mcp list` (deve aparecer `garimpo` como `enabled`).

Para definir a pasta dos PDFs (`GARIMPO_PASTA`), use `--env` antes do nome:

```bash
codex mcp add --env GARIMPO_PASTA=C:\caminho\dos\pdfs garimpo -- npx -y garimpo-mcp
```

Se o primeiro início estourar o tempo (o `npx` baixa o pacote na primeira vez), aumente o prazo em
`~/.codex/config.toml`
([código](https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs)):

```toml
[mcp_servers.garimpo]
command = "npx"
args = ["-y", "garimpo-mcp"]
startup_timeout_sec = 60
```

O `codex` pede aprovação a cada ferramenta. Para liberar só as do Garimpo, veja
[Sem o pedido de permissão a cada consulta](#sem-o-pedido-de-permissão-a-cada-consulta).

### Sem o pedido de permissão a cada consulta

Por padrão, cada ferramenta do Garimpo pede autorização na primeira vez. Para liberar **só o Garimpo** de uma vez, sem
desligar as permissões do resto, coloque a regra no arquivo do seu programa:

| Programa | Arquivo | O que colocar |
|---|---|---|
| Antigravity CLI (`agy`) | `~/.gemini/antigravity-cli/settings.json` | `{ "permissions": { "allow": ["mcp(garimpo/*)"] } }` |
| Claude Code | `~/.claude/settings.json` | `{ "permissions": { "allow": ["mcp__garimpo"] } }`. Pelo próprio Claude Code: comando `/permissions`, aba Allow, "Add a new rule", `mcp__garimpo` |
| Codex CLI | `~/.codex/config.toml` | na seção `[mcp_servers.garimpo]`, a linha `default_tools_approval_mode = "approve"` |

No Windows, `~` é a sua pasta de usuário (`%USERPROFILE%`). `garimpo` é o nome com que você cadastrou o servidor
(o mesmo de `agy mcp list` e `codex mcp list`); se usou outro, troque. Se o arquivo já tiver a lista `allow`, apenas
acrescente o item a ela.

Não use os modos que desligam todas as permissões (`--dangerously-skip-permissions` e similares): eles liberam também
comandos e escrita em arquivos, não só o Garimpo.

Testado no Windows com `agy` 1.3.3, Claude Code 2.1.296 e `codex-cli` 0.161.0-alpha.1.

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
- **TJBA:** a base do site traz cópias do mesmo acórdão com datas diferentes; viram um resultado só, pelo documento
  do portal no link. A data mostrada é a da cópia que ficou.
- **TJGO:** dados completos, mas com cerca de 2 meses de defasagem.
- **TJPR:** na amostra de 2026-10-29, a base do site ia de cerca de 2020 até o 1º semestre de 2026 nas Câmaras e até
  o fim de 2025 nas Turmas Recursais ([estudo](docs/estudos/2026-10-29-tjpr-cobertura.md)). Cópias do mesmo acórdão
  na base viram um resultado só, pelo número do documento no link do portal.
- Mesma busca repetida traz o mesmo conjunto em **ordem variável** (o site reordena por IA).
- **Busca ampla:** aderência mede proximidade de texto com a formulação, não relevância jurídica. A nota de
  relevância do site não entra na ordem: o site só reranqueia os primeiros de cada busca e dá aos demais uma nota
  de outra escala. Para caber numa resposta, a saída mostra um trecho de ~120 caracteres de cada ementa, onde mais
  palavras da formulação mais aderente aparecem juntas (sem nenhuma, o começo da ementa, sem o rótulo "Ementa:"),
  e 200 do texto de cada precedente qualificado; a ementa inteira sai por `obter_ementa`. A lista de
  precedentes qualificados só traz o que o site devolve: há teses com tema conhecido em que ela vem vazia.
- **Inteiro teor:** STF (proteção anti-robô) e os demais tribunais (exceto TJMG, TJMS, TJRR, TJSP,
  TSE e, como texto do portal, TRF2, TRF4, TNU, TJDFT, TJGO, TJPI e TJTO) não são baixados automaticamente: o Garimpo devolve o link e explica como obter no navegador. No STJ, o `robots.txt` de `processo.stj.jus.br` veda o acesso automatizado ao host inteiro (D-18); PDFs do STJ já baixados com recibo continuam relidos da pasta. Baixado o PDF, passe o caminho do
  arquivo ao `ler_inteiro_teor` para ler o texto (origem declarada, não conferida).
- **TSE:** downloads seguidos esperam 10 s entre si, contados da última saída de qualquer janela do Garimpo (o
  portal recusa chamadas em sequência).
- Tribunais cobertos (59): STF, STJ, TST, TSE, STM e os 27 TJs, inclusive TJDFT e TJTO, pelo JurisprudênciaIA; os 24
  TRTs pelo Falcão; o TRF2, o TRF4 e a TNU pelo e-Proc. O TCU entra à parte, por arquivos que você baixa. Não há os outros TRFs nem
  outros tribunais de contas.
- **Fora do Garimpo por ora:** TRF6 (o termo de uso veda robôs sem autorização expressa), TRF3 e TRF5 (não
  achamos rota pública de jurisprudência), TRF1 (a base antiga do CJF derrubou a conexão; a TNU entrou pelo e-Proc dela) e o Banco Nacional de
  Precedentes do CNJ (a API é só para tribunais credenciados; a consulta pública é só no navegador).
- **Só link, com o motivo na resposta:** STJ e TJSE (o `robots.txt` veda o acesso automatizado), TJRJ (o termo de uso veda robôs
  e coleta automática), TJSC e STF (o portal respondeu com página de bloqueio ou proteção anti-robô), TJPA (o
  endereço levou só à casca do aplicativo, sem o acórdão). Nesses casos, a resposta traz a data da conferência; o Garimpo não
  troca de identidade nem contorna. No TST, a resposta informa que a prova foi inconclusiva e que o link veio
  encurtado, fora do portal do tribunal.
- **Avisos de "quem disse"** (órgão do fecho x órgão do registro) estão construídos e **desligados**: faltam a validação
  cega por dois juristas e o segundo avaliador.
- **Índice de dispositivo legal pelos Espelhos de Acórdãos do STJ** (artigo → acórdãos): não é entregue nesta versão.
- **TCU:** a medição do arquivo de 2025 levou de 7 a 19 s por pesquisa; pesquisar vários anos soma esse custo
  (veja [TCU](#tcu-acórdãos-por-arquivos-anuais)).
- **Texto de lei:** só CPC, CC e CF; o CDC ainda não foi provado. O Garimpo não afirma vigência.
- **Falcão (TRTs):** sem login, no máximo 200 documentos por busca na fonte; o Garimpo para antes do limite de pedidos
  do Falcão (**freio preventivo**: pausa de 15 min em todas as janelas, com a hora para tentar de novo), porque passar
  dele bloqueia o IP por horas. Além disso, o Garimpo tem um **teto diário próprio** de 50 chamadas ao Falcão por dia
  de Brasília, somadas em todas as janelas: no teto, pára até a meia-noite mesmo que o Falcão diga que ainda há saldo
  (número inicial conservador, sem prova). Os freios reduzem esse risco, sem garanti-lo: outros usos do mesmo IP não
  são vistos pelo Garimpo.
- **Fontes que não informam o restante** (precedentes do STF e TSE; o STJ tem orçamento definido, mas o portal dele não
  é mais consultado): limite próprio de 30 chamadas por janela
  de 5 min, somado em todas as janelas; cada recusa alarga a janela e 20 chamadas aceitas seguidas a afrouxam. No
  limite a chamada não sai até o fim da janela (não é recusa); o `diagnostico_dos_freios` explica.

## Histórico de versões

Todas as versões, da mais nova para a mais antiga, estão no [`CHANGELOG.md`](CHANGELOG.md).

## Problemas e sugestões

O repositório tem formulários de problema e sugestão no GitHub, sem campo para dado de processo. Não coloque nome de
parte, número de processo nem dado do caso. A linha de chamado nos erros inesperados fica desligada até o repositório ser público.

## Desenvolvimento

```bash
npm test          # testes sem internet, sobre respostas gravadas
```

Os testes não acessam a internet nem o site ou os tribunais: rodam sobre respostas gravadas e, para a
concorrência, sobre um servidor local controlado. Os de disputa entre janelas abrem processos Node reais que chamam
um servidor falso na própria máquina (`127.0.0.1`), com pasta de dados temporária.

## Licença

Código sob a licença MIT ([`LICENSE`](LICENSE)). Os dados da tabela de precedentes do STJ seguem a licença declarada
pela fonte (veja [Tabela de precedentes do STJ](#tabela-de-precedentes-do-stj)).
