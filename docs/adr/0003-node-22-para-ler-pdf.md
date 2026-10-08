# Node 22.13 como mínimo, para ler o inteiro teor com o pdfjs-dist atual

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

Confirmado pelo dono em 2026-10-08.

Para entregar o inteiro teor como texto, o Garimpo extrai o texto do PDF com o `pdfjs-dist` (Apache-2.0) na
versão atual, que exige Node `>=22.13.0` (metadado do npm, `pdfjs-dist@6.4.299`). Por isso o mínimo do Garimpo
sobe de Node 20 para `>=22.13.0`, com instrução de atualização no README. Motivo: o Garimpo lê PDFs vindos da
internet, e travar o leitor numa versão sem correções é o risco maior; o Node 20 saiu do suporte em 2026-04-30
(https://github.com/nodejs/Release).

## Opções consideradas

- Manter Node 20 e travar o `pdfjs-dist` na 5.6 (última que aceita Node `>=20.19`): rejeitada, porque não recebe
  mais correções.
- Adiar a leitura como texto: rejeitada, porque é a maior lacuna de entrega.
- Trocar para o `unpdf`, que o Node 22 deixaria de barrar: fica fora do B2; só se a medição mostrar problema no
  `pdfjs-dist`. A comparação com Python (pypdf) é do bloco D1.
