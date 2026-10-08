# O recibo de origem é o índice do PDF já baixado; nada de índice separado

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

Antes de baixar, o `obter_inteiro_teor` procura, só na pasta de destino, um recibo de origem (ADR-0005) de download
pelo Garimpo do mesmo tribunal e id do acórdão (ou do mesmo link da busca, se inequívoco). Reaproveita sem nenhuma
chamada só com o PDF válido e o sha256 igual ao do recibo; com várias versões, a de download mais recente. Número do
processo sozinho nunca basta, e o reuso não depende da memória de 24 h. Motivo: uma só fonte da verdade sobre a
origem, sem segundo registro que possa divergir do recibo.

## Opções consideradas

- Arquivo de índice "id → arquivo" separado: rejeitado por ora; seria uma segunda fonte da verdade. Só volta, como
  acelerador subordinado ao recibo, se a medição mostrar lentidão em pasta grande.
- Procurar o PDF em outras pastas do usuário: rejeitado.
- Opção de forçar novo download: rejeitada (nada especulativo); para outra cópia, o usuário move PDF e recibo para
  fora da pasta de destino, sem apagar prova.
