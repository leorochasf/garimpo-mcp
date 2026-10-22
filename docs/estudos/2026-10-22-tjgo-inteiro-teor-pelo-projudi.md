# TJGO: o Garimpo pode baixar o inteiro teor pela página do processo no Projudi? (2026-10-22)

Estudo de viabilidade, sem implementação. Pedido do dono depois da troca do link do TJGO para a página pública do
processo (commit `4bca673`). Chamadas ao TJGO feitas uma por vez, com pausa, sobre um processo de exemplo que uma
busca genérica do Garimpo («dano moral negativação indevida», TJGO) devolveu. O número do processo, nomes e o
endereço assinado ficam fora deste documento (regra 2 do `CLAUDE.md`).

## Veredito

**Tecnicamente viável; inviável pelas regras atuais do Garimpo.** Os arquivos do acórdão abrem sem login, em HTML,
e dá para achar o arquivo certo pela data do julgamento. Mas o formulário oficial de consulta pública do Projudi exige
a verificação anti-robô (Cloudflare Turnstile), e o caminho que funciona chega ao processo **sem passar por ela**.
Baixar por esse caminho é contornar a verificação, o que o Garimpo não faz (mesma linha da decisão de 2026-10-11 sobre
a pesquisa de jurisprudência do TJGO, `TICKETS/vigia/tjgo-caminho-publico-2026-10-11.md`). Seguir adiante depende de
decisão do dono, como no TRF2 (ADR-0028), e mais pesada que a do TRF2: lá a dúvida era o alcance de um termo de uso;
aqui há uma barreira técnica posta pelo próprio tribunal no caminho oficial.

**Decisão do dono (2026-10-22):** seguir; baixar pela consulta pública do processo no Projudi. Registro e regras em
[ADR-0029](../adr/0029-tjgo-inteiro-teor-pela-pagina-do-processo-no-projudi.md).

## O que foi visto (2026-10-22)

| # | Chamada | Resultado |
|---|---|---|
| 1 | `GET /robots.txt` | **404** (página de erro do TJGO): sem regras publicadas |
| 2 | `GET /BuscaProcesso?PaginaAtual=2&ProcessoNumero=<CNJ>` | **200**, HTML ISO-8859-1, ~200 KB, título «Dados Processo»: dados, campo «Segredo de Justiça: Não» e a lista de movimentações; sem login, sem verificação anti-robô; o servidor cria sessão (`JSESSIONID`) |
| 3 | `GET /js/buscarArquivos.js` (script público) | **200**: a lista de arquivos de uma movimentação vem de `MovimentacaoArquivo?AJAX=ajax&PaginaAtual=8&Id_Movimentacao=<id>`; o arquivo abre em `BuscaProcesso?PaginaAtual=6&Id_MovimentacaoArquivo=<id>&hash=<hash>&id_proc=<id_proc>` |
| 4 | Lista de arquivos da movimentação do julgamento (com o cookie da chamada 2, como o navegador) | **200**, JSON, 733 bytes: dois arquivos, «Ementa» (`ementa.html`, tipo 124) e «Relatório e Voto» (`relatorio_voto_acordao.html`, tipo 125), ambos `AcessoArquivo: 1` (público), `valido: true`; o visitante sem login veio com `AcessoUsuario: 2` |
| 5 | Arquivo «Relatório e Voto» (com `id_proc=undefined`, que é o que o navegador manda: a página pública não tem o campo) | **302** para um endereço **assinado e temporário** do armazenamento do próprio TJGO (`projudi-2025-prd.s3.tjgo.jus.br/...`, com `Expires` e `Signature`) |
| 6 | Esse endereço assinado | **200**, `text/html`, 48 KB (≈ 9,3 mil caracteres de texto): relatório, voto e «ACORDAM», «datado e assinado digitalmente», com o número do processo; HTML, não PDF |
| 7 | `GET /` (página inicial do Projudi) | **200**: nenhum link de termo de uso ou política de privacidade; o menu «Pública processual» aponta para `BuscaProcesso?PaginaAtual=4&TipoConsultaProcesso=24` |
| 8 | `GET /BuscaProcesso?PaginaAtual=4&TipoConsultaProcesso=24` | **200**, título «Busca de Processo»: o formulário carrega `challenges.cloudflare.com/turnstile/v0/api.js`, guarda o token em `g-recaptcha-response` e só libera o botão de busca depois do desafio; comentário no HTML: «utilize o RecaptchaService para validar do lado do servidor» |

## As cinco perguntas

1. **Lista de movimentações e arquivos sem login?** Sim. A página do processo lista as movimentações; os arquivos da
   movimentação do julgamento abriram sem login e sem verificação anti-robô, em HTML (chamadas 4 a 6). O download passa
   por um redirecionamento para endereço assinado e temporário; o Garimpo teria de seguir esse redirecionamento (hoje o
   cliente não segue redirecionamento em outras fontes, ADR-0024).
2. **Dá para achar o julgado certo?** Sim, com boa confiança. A movimentação «Julgamento -> Com Resolução do Mérito
   -> …» trouxe data **e hora** iguais às do «julgado em DD/MM/AAAA HH:MM:SS» que encerra a ementa vinda do
   JurisprudênciaIA; o tipo do arquivo («Relatório e Voto», 125; «Ementa», 124) separa o acórdão dos outros
   documentos. Em processo com vários julgamentos (embargos, agravo interno) a data e a hora distinguem. Observação não
   verificada: o `Id_Arquivo` do link do site e o id do arquivo de relatório/voto no armazenamento diferem por 1 no
   exemplo; pode ser que o link do site aponte para o arquivo da ementa.
3. **Segredo de justiça e documentos restritos?** Não testado (exigiria um número real de processo sigiloso). O que se
   viu: a página mostra o campo «Segredo de Justiça»; cada arquivo tem nível de acesso (1 público, 2 normal, 3 a 7
   visível só a advogados, delegacia, MP, cartório ou magistrado, 8 a 10 bloqueado) e o script público mostra «Arquivo
   Bloqueado» quando o nível do usuário é menor que o do arquivo. Um guia de terceiro diz que processo sigiloso não
   aparece na consulta pública: **não verificado**.
4. **Termos de uso e robots.txt?** `robots.txt` do Projudi: 404, sem regras. Termo de uso: **nenhum achado** (página
   inicial sem link; duas buscas na web sem resultado). O que existe contra o acesso automatizado é técnico: o
   Turnstile no formulário oficial (chamada 8). Contexto, de fonte secundária: em 2020 o TJGO atribuiu instabilidades do
   Projudi à «grande quantidade de acessos automatizados, muitos feitos por meio de robôs» (Rota Jurídica, 2020-10-06,
   que diz reproduzir informação do site do TJGO; o comunicado original não foi aberto).
5. **Como é hoje e o que acrescentaria?** Hoje o Garimpo **não baixa** o inteiro teor do TJGO: o `obter_inteiro_teor`
   devolve o link e a explicação (`EXPLICA_TJGO`, modo `link`). O caminho pelo Projudi daria o texto de relatório, voto
   e acórdão do TJGO, cujos acórdãos já vêm completos na busca do JurisprudênciaIA.

## Esboço, se o dono decidir seguir

- Rótulo «texto do portal do tribunal (TJGO)», como TRF4/TJPI, sem PDF e sem recibo; o Garimpo não confere assinatura.
- Pelo cliente único (freios da regra 3), 4 chamadas por acórdão: página do processo → lista de arquivos da
  movimentação de julgamento casada por data e hora → arquivo «Relatório e Voto» → redirecionamento assinado.
- Sem casamento seguro (data/hora ausente, mais de um julgamento no mesmo instante, arquivo bloqueado ou processo em
  segredo): não baixa, devolve o link e diz o motivo.
- Antes de tudo, a decisão do dono sobre a verificação anti-robô do formulário oficial, registrada em ADR. Alternativa
  que não a contorna: pedir autorização ao TJGO (não pedida).

## Limites

- Uma amostra (um processo cível de 2.º grau, um julgamento), numa data. Não prova o tribunal inteiro.
- O link curto `PaginaAtual=2&ProcessoNumero=` não passa pelo Turnstile hoje; o TJGO pode fechá-lo a qualquer momento,
  o que também afetaria o link que o Garimpo passou a mostrar.

## Fontes

- Projudi TJGO, chamadas 1 a 8 acima (2026-10-22).
- Rota Jurídica, 2020-10-06: https://www.rotajuridica.com.br/?p=87937 (secundária).
- `TICKETS/vigia/tjgo-caminho-publico-2026-10-11.md`; `docs/adr/0028-trf2-pelo-eproc-do-tribunal.md`;
  `src/tribunais.ts` (`EXPLICA_TJGO`).
