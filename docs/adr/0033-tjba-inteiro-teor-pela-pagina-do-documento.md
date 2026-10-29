# TJBA: inteiro teor pela página pública do documento, no molde «página com íntegra»

_Proposto pelo Claude em 2026-10-29 (ticket 04 da frente dos tribunais estaduais), a partir da matriz ao vivo dos TJs e
das gravações do cartão Rede do mesmo dia. Primeiro tribunal real no molde do ADR-0032. Caso avaliado pelo critério do
caminho legítimo sem proteção a vencer (ADR-0029, ADR-0030). Número provisório: renumerar na junção se colidir._

O TJBA tinha busca pelo JurisprudênciaIA e inteiro teor «só link» («ainda não testou»). O link que vem da busca
(`https://jurisprudenciaws.tjba.jus.br/inteiroTeor/<uuid>`) abre, sem login nem verificação anti-robô, uma página HTML
que é o próprio documento da decisão.

## O que foi lido e provado (2026-10-29)

- `robots.txt` do host `jurisprudenciaws.tjba.jus.br`: HTTP 404 (erro em JSON) — nenhuma regra publicada. Termo de uso do
  portal: **não procurado** (sem vedação encontrada não equivale a autorização).
- Duas páginas gravadas pelo cartão Rede, uma chamada cada, com pausa de pelo menos 6 s: uma de Turma Recursal (HTTP 200,
  `text/html` sem charset, 17 KB, ~3,9 mil caracteres de texto: cabeçalho do tribunal, processo, partes, ementa,
  relatório, voto e assinatura) e uma de Câmara Cível (200, `text/html`, 132 KB com 4 imagens `data:` embutidas, ~14,8
  mil caracteres: cabeçalho, processo, partes e advogados, ementa, acórdão, relatório, voto e fecho). A da Câmara não tem
  `<html>`/`<body>`; os acentos vêm em UTF-8 ou em entidades HTML.
- Nas duas, o número do processo está no cabeçalho do documento («PROCESSO Nº <CNJ>» na Turma; «Processo: APELAÇÃO
  CÍVEL n. <CNJ>» na Câmara) e é o da busca. **Nenhuma das duas tem campo de segredo de justiça.**
- As gravações usaram o User-Agent «Mozilla/5.0»; com o UA honesto do Garimpo, **não verificado** até a prova ao vivo.

## Decisões

- **Inteiro teor do TJBA = texto do portal do tribunal**, pelo molde «página com íntegra» (ADR-0032): um GET na página
  do link, pelo Cliente único (freios da regra 3, disjuntor do serviço `tjba`), UA honesto, redirecionamento não seguido.
  Só `https` em `jurisprudenciaws.tjba.jus.br`, caminho exato `/inteiroTeor/<uuid>` (só os dígitos hexadecimais do uuid
  em maiúsculas) — a mesma regra da junção das cópias do TJBA.
- **A íntegra é o documento inteiro**: o corpo da página (ou a página toda, sem `<body>`), desde que traga o cabeçalho
  «Tribunal de Justiça do Estado da Bahia»; página de aviso ou erro do portal não o tem. As imagens embutidas não viram
  texto.
- **Processo da página**: o primeiro número CNJ do TJBA (segmento 8.05) que vem logo depois da palavra «processo» no
  texto do documento; tem de ser o da busca (molde: 20 algarismos, comparados sem máscara).
- **Segredo de justiça: exceção justificada na declaração** (decisão do dono em 2026-10-29), porque a página não tem o
  campo: «a página do TJBA é só o documento da decisão, sem campo de segredo de justiça (gravações de 2026-10-29, Turma
  Recursal e Câmara Cível); o processo da página continua conferido com o da busca». As demais guardas do molde ficam
  ligadas. **Não verificado:** se o portal publica acórdão sigiloso e, se publica, como o marcaria.
- **Rótulo**: «portal de jurisprudência do TJBA (jurisprudenciaws.tjba.jus.br)»; natureza «texto do portal do tribunal
  (TJBA), convertido de HTML pelo Garimpo: não é PDF e não tem recibo de origem».

## Alternativas consideradas

- Deixar o TJBA «só link» até achar fonte para o segredo de justiça: perde o tribunal inteiro por uma guarda que a
  página não tem como satisfazer.
- Conferir o nível de sigilo do processo pelo DataJud antes de guardar o texto: mais uma chamada por acórdão e outra
  fonte no caminho do inteiro teor; não adotada agora.

## Consequências

- `tjba` passa a `inteiroTeor: "portal"` em `src/tribunais.ts`: o TJBA sai da lista dos «só link» e o
  `listar_tribunais` passa a dizer texto do portal; `obter_inteiro_teor`, `ler_inteiro_teor` e `conferir_citacao`
  funcionam pelo id.
- Como o número do processo vem do próprio documento, a guarda «número dentro da íntegra» passa sempre no TJBA; o que
  protege contra documento trocado é o processo do documento ser o da busca.
- **Não verificado:** termo de uso do portal; se o portal publica acórdão em segredo de justiça (e como o marcaria); se
  ele troca o documento como o do TJPR; o comportamento com o UA honesto do Garimpo; limite de ritmo do host; outras
  classes e órgãos além dos dois gravados.
