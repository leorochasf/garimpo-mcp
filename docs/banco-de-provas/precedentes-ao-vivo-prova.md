# Precedentes qualificados ao vivo — prova curta (2026-10-09)

Fase 1 da decisão do dono de 2026-10-09 ("eu nao quero algo que fique desatualizado, pense diferente"; opção "(A)
Consulta ao vivo, na hora da pergunta"). Objetivo: achar a página pública de **um** precedente por número no STF e no
STJ e ver se ela traz situação e tese. **9 chamadas** no total, em série, com 5 s ou mais entre elas, sem
paralelismo, por `curl` fora do Garimpo (nenhum estado de proteção do usuário foi tocado). As respostas ficaram só na
pasta temporária da sessão e não entram no git. Trechos abaixo são literais (marcação HTML retirada).

Identificações usadas:

- **honesta**: `Garimpo/0.3.3 (cliente MCP local e nao oficial de pesquisa de jurisprudencia)` (a do cliente único);
- **navegador**: `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0` (o mesmo UA fixo
  do Falcão, ADR-0018) com `Accept-Language: pt-BR,pt;q=0.9`. Autorizado pelo dono para o STF em 2026-10-09
  (decisão (c) do ADR-0015).

## Chamadas

| # | Hora (UTC, 2026-10-10) | Tribunal | Rota | Identificação | HTTP | Tamanho |
|---|---|---|---|---|---|---|
| 1 | 02:36:05 | STF | `portal.stf.jus.br/jurisprudenciaRepercussao/tema.asp?num=1046` | honesta | **403** (`Server: awselb/2.0`) | 118 B |
| 2 | 02:36:10 | STF | a mesma | navegador | **200** | 61 KB |
| 3 | ~02:36:30 | STF | `…/jurisprudenciaRepercussao/verAndamentoProcesso.asp?incidente=5415427&numeroProcesso=1121633&classeProcesso=ARE&numeroTema=1046` | navegador | **200** | 582 KB |
| 4 | ~02:37 | STF | `…/verAndamentoProcesso.asp?numeroTema=1046` (sem incidente) | navegador | **400** | 11 B |
| 5 | ~02:37 | STF | `portal.stf.jus.br/jurisprudencia/sumariosumulas.asp?base=26` (lista das SV) | navegador | **200** | 62 KB |
| 6 | ~02:38 | STF | `…/sumariosumulas.asp?base=26&sumula=1216` (SV 10) | navegador | **200** | 123 KB |
| 7 | 02:39:05 | STJ | `processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?novaConsulta=true&tipo_pesquisa=T&cod_tema_inicial=1198&cod_tema_final=1198` | honesta | **200** (ISO-8859-1) | 60 KB |
| 8 | ~02:39:30 | STJ | a mesma com `tipo_pesquisa=IAC&cod_tema_inicial=1&cod_tema_final=1` | honesta | 200, mas devolveu o **Tema 1** (aba ativa `tipoPrecedenteT`): `IAC` não é o código | 63 KB |
| 9 | ~02:40 | STJ | a mesma com `tipo_pesquisa=I` | honesta | **200**, aba ativa `tipoPrecedenteI` (IAC 1) | 63 KB |

Nenhum 429/503 nem desafio anti-robô. O STF repetiu o 403 de sempre para a identificação honesta e aceitou o UA de
navegador.

## O que cada página traz

### STF — repercussão geral (2 chamadas)

- `tema.asp?num=N` traz número, título, descrição, leading case, ministro da manifestação, "Repercussão geral",
  "Data da Repercussão geral" e **"Situação"**, mas **não a tese**. Traz o link da página do tema:
  `verAndamentoProcesso.asp?incidente=…&numeroProcesso=…&classeProcesso=…&numeroTema=N`.
- `verAndamentoProcesso.asp` (com o incidente; sem ele, 400) traz `Tema N - <título>`, "Há Repercussão?", "Relator(a)",
  "Leading Case", "Descrição" e **"Tese"** (`<dt>Tese:</dt><dd>…</dd>`).
- Trechos literais (Tema 1046): Situação: "Trânsito em Julgado - 09/05/2023"; Tese: "São constitucionais os acordos e
  as convenções coletivos que, ao considerarem a adequação setorial negociada, pactuam limitações ou afastamentos de
  direitos trabalhistas, independentemente da explicitação especificada de vantagens compensatórias, desde que
  respeitados os direitos absolutamente indisponíveis."

### STF — súmula e súmula vinculante (2 chamadas; 1 com a lista na memória)

- A página da súmula usa um **código interno**, não o número (`sumula=1216` é a SV 10). O código sai da lista
  (`sumariosumulas.asp?base=30` para súmulas, `base=26` para SV), onde cada item é
  `<a href="sumariosumulas.asp?base=26&sumula=CÓDIGO">Súmula Vinculante N <em>(cance&#8203;lada)</em></a>`: a marca
  de situação fica entre parênteses no rótulo (com espaço de largura zero no meio da palavra).
- A página traz `<div class="titulo">Súmula Vinculante 10</div><div class="parCOM"><p>ENUNCIADO</p>`, seguido de
  "Precedente Representativo", "Teses de Repercussão Geral" e "Jurisprudência selecionada".
- Trecho literal (SV 10): "Viola a cláusula de reserva de plenário (CF, artigo 97) a decisão de órgão fracionário de
  tribunal que, embora não declare expressamente a inconstitucionalidade de lei ou ato normativo do Poder Público,
  afasta sua incidência, no todo ou em parte."

### STJ — tema repetitivo e IAC (1 chamada)

- Uma página só, com a identificação honesta, `tipo_pesquisa=T` (tema) ou `I` (IAC). A página traz o tipo e o
  número (`Tema Repetitivo <span …>1198</span>` e `copiarLinkTema('T','1198',…)`), **"Situação"**, "Órgão julgador",
  "Ramo do direito", "Questão submetida a julgamento", **"Tese Firmada"**, anotações e os processos (paradigma
  marcado como "Paradigma Principal"). Texto em ISO-8859-1.
- Trechos literais: Tema 1198 — Situação "Acórdão Publicado - RE Pendente", Órgão julgador "CORTE ESPECIAL", Tese
  Firmada "Constatados indícios de litigância abusiva, o juiz pode exigir, de modo fundamentado e com observância à
  razoabilidade do caso concreto, a emenda da petição inicial a fim de demonstrar o interesse de agir e a
  autenticidade da postulação, respeitadas as regras de distribuição do ônus da prova."; IAC 1 — Situação "Trânsito
  em Julgado".
- Cuidado: código de tipo errado não dá erro, devolve outro tipo (chamada 8). A leitura tem de conferir o tipo e o
  número no corpo antes de aceitar.

## Conclusão

A prova funcionou nos dois tribunais. Chamadas por pergunta: STJ 1; STF repercussão geral 2; STF súmula e SV 2 na
primeira vez e 1 enquanto a lista do tipo estiver na memória de 24 h. Segue para a Fase 2 (ADR-0020).
