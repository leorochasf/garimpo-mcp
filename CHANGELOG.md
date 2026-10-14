# Changelog

## 1.0 (RASCUNHO: não publicada; versão do package.json segue 0.5.0)

Marcadores `[PENDENTE: ...]` indicam o que ainda não entrou no `main`; tire-os (ou apague a linha) quando entrar.

### Novidades

Mais tribunais com o texto do acórdão
- TJDFT: o texto do acórdão vem pela API pública do tribunal, rotulado "texto do portal do tribunal".
- TJMS: o PDF do acórdão é baixado pelo portal oficial (eSAJ), com recibo.
- TJRR: o PDF é baixado, com recibo. TJPI: o texto vem do portal do tribunal.
- TJPA, TJRJ, TJSE, TJSC e STF seguem "só link", mas agora o Garimpo diz o motivo real e a data em que ele foi conferido.
- [PENDENTE: TRF4]
- [PENDENTE: TCU]

TRTs (Justiça do Trabalho)
- Precedentes dos TRTs (súmulas, OJs e incidentes como IRDR e IAC) sob pedido, com `precedentes: true` na `busca_direta`. Cada item traz o tipo e a situação como a fonte rotula, com a data, ou "não verificado".
- Filtros novos nos TRTs: pesquisar só nas ementas e escolher a ordenação.
- [PENDENTE: TRTs na busca ampla]

Respostas melhores
- Nova ferramenta `conferir_acordao_citado`: confere número, tribunal, data e órgão de um acórdão que você já tem citado. Diz "confirmado" ou aponta o que não bate.
- Nova ferramenta `panorama_da_amostra`: conta por tribunal, ano e órgão os acórdãos que uma busca já trouxe, sem nova chamada ao site. É contagem da amostra, não estatística do tribunal.
- Âmbito do precedente: o enquadramento no art. 927 do CPC diz se o precedente vale em todo o país, no tribunal de origem ou nos juizados.
- Agrupamento em série na busca ampla: acórdãos do mesmo tribunal, órgão e relator com a mesma ementa saem numa linha só, com a contagem, o período e os demais ids. Vem ligado; `agrupar: false` mostra cada acórdão.
- DJEN: a comunicação de acórdão mostra um trecho da ementa, com dados pessoais retirados, só quando dois sinais confirmam que é uma ementa; com dúvida, "não verificado".
- Frase de privacidade nas instruções e no roteiro: "formule a busca com a tese em abstrato, sem nome de parte nem dado do caso".

Freios novos (proteção do seu IP)
- Limite próprio por janela de tempo para as fontes que não informam quanto resta (precedentes do STF e do STJ, TSE).
- Teto diário próprio de 50 chamadas por dia para a Justiça do Trabalho, mesmo quando o Falcão diz que ainda há saldo.
- No TJDFT, o freio também lê o saldo informado pela API do tribunal.
- Estado de proteção corrompido ou ilegível para a rede em vez de seguir adivinhando.
- Menos operações de disco por chamada ao Falcão (de 33 para 26 por chamada). [PENDENTE: medição de velocidade]

Para quem mantém ou quer ajudar
- Formulários de problema e sugestão no GitHub, sem campo para dado de processo, e verificação automática (tipos, testes sem rede e build). A linha de chamado nos erros inesperados fica desligada até a publicação.
- [PENDENTE: legislação]

### Mudanças importantes

STJ
- Temas repetitivos e IAC do STJ respondem só pela tabela datada que acompanha o pacote. O Garimpo não consulta mais o portal do STJ, e a resposta diz "tabela de <data>; consulta automática ao portal não realizada por restrição de acesso".
- O inteiro teor do STJ é só link para conferir no navegador. O `robots.txt` do STJ, lido em 13/10/2026, veda o acesso automatizado ao site inteiro, e o Garimpo respeita. PDF do STJ já baixado com recibo, ou trazido por você, continua podendo ser lido com `ler_inteiro_teor`.
- STF segue consultado ao vivo, sem mudança.

Motivo do "só link"
- Onde o Garimpo tem prova própria, a resposta diz por que o tribunal é só link e a data da prova (TJRJ, TJSE, TJPA, TJSC, STF e STJ). Onde não há prova, o texto antigo ("ainda não testou") fica como estava.

### Limites conhecidos

- Tribunais que bloqueiam o acesso automatizado por termo de uso ou `robots.txt` (STJ, TJRJ, TJSE; no TJSC e no STF o portal respondeu com página de bloqueio ou desafio) ficam só com o link. O Garimpo não troca de identidade nem contorna.
- Os avisos de "quem disse" (órgão do fecho x órgão do registro) continuam **desligados**: faltam a validação cega por dois juristas e o segundo avaliador.
- "Perto de" (filtro "não pode conter X perto de Y"): a medição não mostrou ganho e o filtro não foi feito.
- O índice de dispositivo legal pelos Espelhos de Acórdãos do STJ (artigo → acórdãos) tem gerador e leitor prontos, mas o índice não é entregue no pacote desta versão.
- Súmulas do STJ, escolha do texto integral do TST, Jurisprudência em Teses, registros do chat do JurisprudênciaIA e situação de superação ficaram para depois.
- TJRJ (PDF) e TJSE (HTML) ainda não são baixados.
- A exportação de repercussão geral do STF por download é um modo opcional do script do mantenedor, não uma função da ferramenta.

## 0.5.0

TJTO
- O inteiro teor do TJTO agora vem como "texto do portal do tribunal": o Garimpo lê a página do acórdão no portal oficial e entrega o texto (sem PDF e sem recibo). O Garimpo se identifica como navegador só no portal do TJTO, por decisão do dono do projeto ([ADR-0021](docs/adr/0021-tjto-ua-de-navegador-e-texto-do-portal.md)).
- Página de erro ou de verificação anti-robô não passa como acórdão. Se o portal recusar, o Garimpo para e avisa.

TJGO
- Aviso de que o link do Projudi não abre fora da sessão do tribunal, com o caminho público da pesquisa (ConsultaJurisprudencia) e o número CNJ do resultado, na busca, no `obter_ementa` e na `busca_ampla`.

README
- Nova seção para liberar só as ferramentas do Garimpo, sem pedido de permissão a cada consulta (Antigravity CLI, Claude Code e Codex).
- Instalação no Antigravity CLI e no Codex CLI, nome Garimpo-Jurídico e tabela de abrangência atualizada (TJTO deixa de ser "só link").
## 0.4.0

Freios e transparência
- Página de bloqueio disfarçada de resposta normal e erro de parser (`HPE_*`) agora contam como recusa e acionam a pausa.
- Marca de pausa legível por máquina nas respostas (tipo, `liberadoEm`, `esperaSegundos`).
- Nova ferramenta `diagnostico_dos_freios` ("por que parou?"): lê o estado de proteção, sem chamar fonte nenhuma, e diz o que está pausado, até quando e se a recusa parece sistemática.
- Ordem fixa da lista de ferramentas e dicas de idempotência.

Leitura de PDF e HTML
- Leitura de PDF mais honesta: carimbo de origem, PDF misto (texto e imagem) e tetos declarados.
- Aviso quando o texto vindo de HTML traz trechos marcados como ocultos.

TRTs (Justiça do Trabalho)
- Quatro filtros nos TRTs, texto integral igual à ementa tratado e paginação do Falcão com conferências.

Busca
- Formulações com teto de 300 caracteres e espaços juntados.
- `busca_ampla` com `ordem: "data"`, estimativa de chamadas e tempo, motivo de falha por tribunal e teto de 25 mil caracteres sobre o texto final.
- Campos que faltam por acórdão (órgão, data, link) e aviso quando relator ou órgão não retorna resultado.
- Ressalva sobre a grafia da formulação.

DataJud
- Cliente mais defensivo diante de respostas inesperadas.

Precedentes e banco de provas
- Tabela de precedentes com trava de gravação e relatório de mudanças entre versões.
- Banco de provas: régua sem rede, 20 paradigmas das tabelas oficiais, teses em versão leiga e medição cega.

Conferência de citação
- Avisos de "quem disse" (órgão do fecho x órgão do registro e posição no julgado) construídos e **desligados** por padrão.

## 0.3.4

Versão anterior; veja o histórico do git.
