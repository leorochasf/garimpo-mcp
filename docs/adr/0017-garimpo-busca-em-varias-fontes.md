# Garimpo busca em várias fontes

_Decidido pelo dono em 2026-10-09 ("sim, o garimpo vai passar a buscar em outras fontes")._

O Garimpo deixa de ser só cliente da busca direta do JurisprudênciaIA e passa a consultar outras **fontes**
públicas de jurisprudência e de dados processuais (Justiça do Trabalho pelo CSJT, base do CNJ por DataJud e DJEN,
TCU, busca oficial do STF e, por último, portais dos TJs). O JurisprudênciaIA continua sendo a **fonte principal**
dos tribunais que ele cobre; as outras fontes entram onde ele não chega (tribunal fora da base, acórdão que falta,
ementa cortada, inteiro teor que não baixa). Motivo: a meta é o máximo de cobertura do inteiro teor, e parte dos
tribunais e dos acórdãos só existe fora da base do site (`TICKETS/perguntas/alem-do-jurisprudenciaia.md`).

Condições que valem para toda fonte:

- **Cliente único e freios da regra 3 somados.** Toda chamada, a qualquer fonte, passa pelo `Cliente`; as 2 vagas,
  a nova tentativa única e o disjuntor valem no total de todas as fontes e de todas as janelas do Garimpo do usuário.
- **Termos de uso antes de entrar.** Nenhuma fonte entra no código sem que seus termos de uso (ou a falta deles) e
  as regras de acesso tenham sido lidos e registrados em `docs/`, com data e link.
- **LGPD.** Dados do DataJud e do DJEN saem sem nome de parte.
- **Rótulo de origem.** Toda resposta diz de que fonte veio cada acórdão ou texto; texto do DJEN sai rotulado como
  texto da intimação, não como acórdão oficial.

## Consequências

- Muda a frase de abertura do `CLAUDE.md`; "Cliente não oficial" continua valendo para cada fonte.
- A regra 1 continua proibindo o MCP de terceiros sem licença da mesma API. Repositórios com licença (ex.: juscraper,
  MIT) podem ser lidos como referência de técnica, sem copiar código, com a licença registrada.
- A ordem de entrada das fontes e os blocos de trabalho estão em `docs/melhorias-2026-10-08.md`, seção 6.
- Fecha a decisão do bloco D3.
