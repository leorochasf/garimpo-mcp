# TJTO: UA de navegador no portal de jurisprudência e texto do portal do tribunal

_Decidido pelo dono em 2026-10-11 (DQ-03, OK expresso: "dá meu ok no dq-03")._

O portal de jurisprudência do TJTO (`jurisprudencia.tjto.jus.br`) recusa (403) quem se identifica como o Garimpo:
prova B11 de 2026-10-09, no `viewFileDoc.php` e no `consulta.php`
([`b11-prova-ao-vivo.md`](../banco-de-provas/b11-prova-ao-vivo.md)). O dono autorizou o Garimpo a se apresentar com
o User-Agent de navegador fixo por versão **só nesse host**, a terceira fonte da lista por fonte, depois do Falcão
(ADR-0018) e do portal do STF (ADR-0020). Mesmo cuidado do STF: consulta simples, um acórdão por pedido do usuário, no
ritmo de pessoa, pelo cliente único e com todos os freios da regra 3 (no máximo 2 chamadas simultâneas no total;
429/503 com espera e uma nova tentativa; recusa final abre o disjuntor do TJTO em todas as janelas). Recusa = para e
avisa; o Garimpo não resolve captcha nem desafio anti-robô, não usa proxy nem login.

Prova de 2026-10-11 (2 GETs, pelo cliente do Garimpo, disjuntor do TJTO fechado antes e depois): o `viewFileDoc.php`
que o JurisprudênciaIA devolve respondeu **302** para `documento.php`, e o `documento.php` respondeu **200** com
**HTML** (ISO-8859-1, ~174 KB): o acórdão do eproc inteiro (acórdão com ementa, relatório e voto, extrato de ata),
não PDF. Por isso o `obter_inteiro_teor` do TJTO não baixa arquivo nem grava recibo: traz o HTML (as mesmas 2
chamadas), converte para texto pela regra fixa do Falcão e guarda na memória pelo id do acórdão, como **texto do
portal do tribunal** (DQ-06, `CONTEXT.md`). O `ler_inteiro_teor` e o `conferir_citacao` o leem pelo id, com o rótulo
do portal; texto já na memória não gera nova chamada. Nunca é chamado de inteiro teor oficial (que é o PDF).

## Opções consideradas

- Manter o TJTO só com link: rejeitada pelo dono; o portal entrega o acórdão a quem se apresenta como navegador.
- Gravar o HTML (ou o texto) em arquivo com recibo, como o PDF: rejeitada agora; o recibo de origem é do PDF
  (ADR-0005, ADR-0011) e o leitor de arquivos só lê PDF. O texto na memória reaproveita o caminho do Falcão.

## Consequências

- `IDENTIFICACAO_POR_HOST` (cliente) ganha o host do TJTO; os demais hosts do TJTO, se surgirem, seguem com o UA
  honesto até nova decisão.
- O texto do portal vale 24 h na memória; depois, o `obter_inteiro_teor` pelo id o traz de novo, enquanto o acórdão
  estiver na memória da busca.
- Se o portal voltar a recusar, o disjuntor do TJTO abre e o usuário recebe o aviso; o teste é refazer a prova curta.
