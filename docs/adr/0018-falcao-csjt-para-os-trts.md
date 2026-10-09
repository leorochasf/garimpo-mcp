# Falcão (CSJT) para os TRTs: UA de navegador só nessa fonte, freio preventivo e texto integral sem PDF

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

Escopo: os 24 TRTs, só a coleção de acórdãos do Falcão, o repositório oficial de jurisprudência da Justiça do
Trabalho (Res. CSJT 401/2024). O TST continua pela busca direta do JurisprudênciaIA, a fonte principal. O Falcão
recusa programa que não se apresenta como navegador (403 ao User-Agent do Garimpo, 2026-10-09); por isso o Garimpo
usa um User-Agent de navegador fixo por versão, com `Origin`/`Referer` do próprio site, **só nessa fonte**, pelo
`Cliente` único e dentro dos freios da regra 3. O 429 do Falcão equivale a IP bloqueado por horas: a espera pedida
no cabeçalho próprio é lida, e acima de 30 s é recusa final, sem nova tentativa; os dois tipos de 403 também são
recusa final. Para não chegar ao 429 existe o **freio preventivo**: quando o cabeçalho de restante chega à reserva
(10), a fonte pausa em todas as janelas; além disso, 1 s entre chamadas, teto de 5 páginas por ferramenta e no
máximo 30 por busca direta. O texto do acórdão vem na própria busca (não há rota pública por id) e é o **texto
integral do repositório oficial**, não o inteiro teor oficial (PDF com recibo): fica na memória por 24 h com os
nomes que o texto original traz, por fidelidade à fonte na leitura e na conferência literal; nomes nunca vão a
listas, cabeçalhos nem à busca guardada. Isso é decisão de produto, não afirmação de conformidade com a LGPD.
Motivo: os TRTs não estão na base do JurisprudênciaIA, e o Falcão é a fonte oficial que os cobre com texto integral.

## Opções consideradas

- Não usar o Falcão: rejeitada; os TRTs ficariam sem cobertura.
- UA de navegador em todas as fontes: rejeitada como padrão; cada fonte usa o que exige, e as que aceitam o
  User-Agent do Garimpo continuam com ele. Não é proibição: pela política do dono (regra 3), outra fonte pode se
  apresentar como navegador quando exigir, por decisão própria registrada.
- Só reagir depois do 429: rejeitada; no Falcão o 429 já é o bloqueio do IP por horas.

## Consequências

- A fonte só entra no código depois que os termos do Falcão forem lidos e registrados em `docs/` (ADR-0017). Se
  proibirem uso automatizado ou reuso, o trabalho para e vai ao dono.
- Ficam `a-triar`: TST pelo Falcão; precedentes dos TRTs (súmulas, OJs, IRDR/IAC regionais); PDF com QR-code do
  Falcão; agrupador "trt" na busca ampla; paginação além de 200 (exige login).
- O freio preventivo reduz o risco de bloqueio, sem garanti-lo: outros usos do mesmo IP não são vistos pelo Garimpo.
- O termo "HTTP comum" (ADR-0016) fica como recorte técnico do B11, não como proibição geral.
