# Molde «página com íntegra» e registro de portais

_Proposto pelo Claude em 2026-10-29 (ticket 03 da frente dos tribunais estaduais), a partir do desenho aprovado pelo
dono no mesmo dia (`docs/design/2026-10-29-tjs-estaduais.md`, peça 2) e das decisões do coordenador sobre as guardas
(Q2: número do processo dentro da íntegra ligado por padrão; Q3: sem número CNJ na busca, recusa)._

Até a 1.1.2, cada tribunal com «texto do portal do tribunal» ganhou um módulo próprio (`tjpi.ts`, `tjpr.ts`…) com as
mesmas peças repetidas e guardas diferentes: o TJPI não lia segredo de justiça, o TJTO não conferia o processo da busca,
só o TJPR procurava o número do processo dentro da íntegra (a guarda contra o portal que troca o documento, ADR-0030).
Ligar um tribunal novo exigia ramos em quatro arquivos, e o rótulo da leitura caía no do TJTO quando se esquecia um.

## Decisão

- **Uma peça comum** (`src/paginaComIntegra.ts`) para o portal que entrega a íntegra numa página HTML pública, um GET
  por documento. As guardas ficam nela, **ligadas por padrão**, e cada uma, quando barra, não guarda texto e diz o motivo:
  sem número CNJ na busca (recusa sem chamar o portal), link fora do https/host/caminho declarados (nada é chamado),
  redirecionamento (não seguido), resposta que não é HTML ou grande demais, página sem a íntegra, página sem o número do
  processo, página de outro processo (comparado só pelos algarismos), segredo de justiça, texto útil curto demais e
  íntegra que não traz o número do próprio processo.
- **Número CNJ utilizável** é o que tem os 20 algarismos, com ou sem máscara, na busca e na página; texto no lugar do
  número («não informado») ou número incompleto conta como ausente, e dois ausentes nunca se confirmam um ao outro.
- **Segredo de justiça**: com a guarda ligada, só é guardada a página que diz expressamente que **não** há segredo. Campo
  ausente ou valor que não seja «Sim»/«Não» dá o motivo «a página não informa se o acórdão está em segredo de justiça, e o
  Garimpo só guarda o texto quando ela diz que não está» — sem afirmar que há segredo.
- **Um registro de portais**: cada tribunal declara só os seus dados — sigla, host, caminho do link, onde estão na
  página o processo, o segredo de justiça e a íntegra, e o rótulo da fonte. O `obter_inteiro_teor` consulta o registro
  **antes** dos caminhos antigos; a leitura e a conferência tiram dele o rótulo e a natureza do texto («texto do portal do
  tribunal (TJXX), convertido de HTML pelo Garimpo: não é PDF e não tem recibo de origem»), nunca de outro tribunal.
- **Desligar exige justificar.** Só duas guardas podem ser desligadas, cada uma com a justificativa (prova do portal) na
  própria declaração: o segredo de justiça (página sem o campo) e o número do processo dentro da íntegra. O registro
  recusa a declaração sem justificativa. As demais não se desligam.

## Consequências

- TJPI, TJPR, TJTO, TJDFT e TJGO **ficam como estão** (a suíte deles é a rede de proteção). Migrá-los para o molde é
  ticket à parte, se o coordenador quiser.
- Tribunal novo no molde: a declaração no registro, a fixture saneada da página e os testes pelas guardas; e a linha do
  tribunal em `src/tribunais.ts` passa a `inteiroTeor: "portal"` (senão o `listar_tribunais` continua dizendo «só link»).
- Acórdão em segredo de justiça não tem texto guardado (a página é pedida de novo a cada `obter_inteiro_teor`); no TJPR,
  o texto vazio com o motivo fica guardado. Diferença aceita: o molde não guarda nada que uma guarda barrou.
- **Não verificado:** se cada portal novo troca o documento como o do TJPR; o charset de cada um (o molde usa o do
  cabeçalho, depois o `<meta>`, depois o padrão do host).
