# Só endereço do tribunal vira link

_Proposto pelo Claude em 2026-10-29 (ticket 01 da frente dos tribunais estaduais), a partir do desenho aprovado pelo
dono no mesmo dia (`docs/design/2026-10-29-tjs-estaduais.md`, peça 1). Frase ao usuário aprovada pelo coordenador
(regra D12)._

A matriz ao vivo dos TJs (fora do repositório) mostrou que o JurisprudênciaIA às vezes manda, no campo do link, algo
que não abre como página: no TJES e no TJMA, um `data:text/html;base64,…` de 15 a 294 KB com o HTML do acórdão; no
TJPB, um `gs://…` de armazenamento em nuvem. O Garimpo repassava o valor cru: uma busca de 3 acórdãos do TJES passava
de 400 mil caracteres, e o `obter_inteiro_teor` mandava «abrir no navegador» um endereço que não abre.

## Decisão

- **Na busca**, só vira `link` (ou `linkConsulta`) um endereço `https` num domínio `.jus.br` — a mesma regra que já valia
  para o link pedido à rota de link do site (agora uma função só, `ehEnderecoDoTribunal`, em `src/busca.ts`).
- O que não passa sai do campo e o acórdão ganha `avisoDeLink`: «O JurisprudênciaIA mandou, no lugar do link, um
  endereço que não é página do tribunal (<detalhe>); o Garimpo não o mostra.», com <detalhe> «endereço do tipo data:»,
  «endereço do tipo gs:», «endereço em <domínio>» ou «endereço ilegível». **Nunca o endereço inteiro.**
- **No `obter_inteiro_teor`**, o link que não é endereço web (`data:`, `gs:`…), venha ele do pedido ou da memória de
  antes desta regra, cai no caminho «sem link» de sempre (rota de link do site, depois o número no portal), com o
  mesmo aviso no lugar de «O JurisprudênciaIA não trouxe link»; nos tribunais que baixam PDF, «<aviso> Não há de onde
  baixar.». `http` e host estranho continuam indo às guardas de cada tribunal, que recusam com erro, como antes.

## Relação com o ADR-0016

Ajusta, sem contradizer: o ADR-0016 diz que, diante da cópia em base64 ou de endereço fora do portal, «nada é baixado e
o usuário recebe o link com o motivo». Para `data:` e `gs://` não há link que o usuário possa abrir; ele recebe só o
motivo. Nada passa a ser baixado.

## Consequências

- TJES, TJMA e TJPB passam a ter resposta de tamanho normal e nenhum link impossível. No TJES e no TJMA, o texto que
  vinha no `data:` deixa de chegar ao usuário até o ticket do *texto da base* (peça 4 do desenho), que o tratará com
  rótulo próprio.
- Link `http://` em `.jus.br` vindo da base também deixa de sair na busca (vira aviso «endereço do tipo http:»).
  **Não verificado** quantos tribunais a base manda assim; nenhum foi visto na matriz nem em `docs/api-jurisprudenciaia.md`.
- Busca guardada na memória antes desta versão continua com o valor antigo até vencer (24 h); o `obter_inteiro_teor`
  já a trata pela regra do link web.
- Links de precedentes qualificados (`Qualificado.link`) ficam fora desta regra: nenhum caso visto.
