# Janela de cobertura dos 27 TJs na base do JurisprudênciaIA (ticket 09)

Medição de 2026-10-29. Estimativa por amostra, sem filtro de data. Sem número de processo, sem nome de parte.

> **LIMITAÇÃO (decisão do dono, 2026-10-29): isto NÃO é a janela de cobertura da base.** É uma amostra de 2 a 10
> acórdãos por TJ, sem filtro de data (o filtro provoca HTTP 504 na base: TJPR 3 de 3, TJRS 1 de 1; houve 504 também
> sem filtro, no TJES e no TJRN). Mostra as datas que a busca trouxe, ordenadas por relevância; **não** o início nem o
> fim da base. Exemplo: o TJPR sai aqui com 2022 a 2023, mas o estudo cuidadoso do mesmo dia mediu cerca de 2020 a março
> de 2026. Por isso o resultado **não é mostrado ao usuário** (ticket 10 suspenso) e não deve ser citado como cobertura.

## Método e limites

- **Amostra:** para cada TJ, a `busca_direta` do Garimpo (que consulta a base do JurisprudênciaIA) com 1 ou 2 teses genéricas: «dano moral» e «fornecimento de medicamento». Limite de 3 a 10 por busca; uma chamada por vez; 5 s ou mais entre chamadas de rede, quando havia mais de uma do mesmo lado.
- **Leitura:** anotei a **data de julgamento mais antiga e a mais recente** entre os acórdãos que voltaram, mais o número de acórdãos da amostra (n).
- **Isto é estimativa, não medição da base.** A busca ordena por relevância, não por data. A data mais recente vista é só um **piso** da data mais recente que a base tem; a mais antiga vista é só um **teto** da mais antiga. Amostras de 2 a 10 acórdãos indicam, não provam (o estudo do TJPR de 2026-10-29 tinha o mesmo limite).
- **O filtro de data (`de`/`ate`) foi evitado de propósito:** provocou **HTTP 504** no JurisprudênciaIA no TJPR (3 de 3 tentativas, estudo de 2026-10-29) e no TJRS (1 de 1, em 2026-10-29). Não testei o filtro em nenhum outro TJ.
- **Dois TJs ficaram «não medido»:** TJES e TJRN tiveram **504 em buscas sem filtro de data**. No TJES a busca «dano moral» havia respondido antes, e a busca da 2ª tese deu 504; no TJRN as duas tentativas deram 504. Hipótese, **não confirmada**: no TJES a resposta é muito pesada (cerca de 450 mil caracteres para 3 acórdãos, por causa do campo `link` com o texto embutido) e pode estourar o tempo do site.
- A data usada é a de **julgamento** da fonte (`dataJulgamento`); em alguns TJs a de publicação vem vazia.

## Resultado por tribunal

| TJ | Mais antigo visto | Mais recente visto | n | Teses | Observação |
| --- | --- | --- | --- | --- | --- |
| TJAC | 2015-03-25 | 2025-04-12 | 6 | 2 | — |
| TJAL | 2014-11-26 | 2026-02-05 | 6 | 2 | — |
| TJAM | 2021-12-06 | 2024-11-13 | 6 | 2 | nada de 2025 em diante nas duas buscas |
| TJAP | 2011-02-22 | 2026-07-27 | 6 | 2 | tem acórdão de jul/2026 |
| TJBA | 2025-01-27 | 2026-04-28 | 10 | 2 | só 2025–2026 nas duas buscas |
| TJCE | 2024-05-29 | 2025-12-18 | 6 | 2 | só 2024–2025 |
| TJDFT | 2025-05-14 | 2025-12-10 | 3 | 1 | — |
| TJES | 2026-10-28 | 2026-10-28 | 3 | 1 | **não medido** (504); os 3 vistos são de ontem |
| TJGO | 2024-12-06 | 2025-06-26 | 3 | 1 | — |
| TJMA | 2023-04-17 | 2025-04-11 | 6 | 2 | — |
| TJMG | 2022-11-23 | 2023-07-03 | 3 | 1 | — |
| TJMS | 2021-07-30 | 2022-03-30 | 2 | 1 | — |
| TJMT | 2017-04-04 | 2026-08-04 | 6 | 2 | tem acórdão de ago/2026 |
| TJPA | 2012-10-16 | 2025-05-12 | 5 | 2 | — |
| TJPB | 2021-02-26 | 2026-03-04 | 5 | 2 | — |
| TJPE | 2020-02-12 | 2025-06-17 | 7 | 2 | — |
| TJPI | 2020-03-06 | 2020-05-05 | 3 | 1 | os 3 vistos são de 2020; recência **não verificada** |
| TJPR | 2022-06-02 | 2023-12-04 | 2 | 1 | o estudo do TJPR (2026-10-29) dá ~2020 a 1º semestre de 2026 nas Câmaras e até o fim de 2025 nas Turmas Recursais |
| TJRJ | 2020-07-21 | 2026-02-03 | 5 | 2 | — |
| TJRN | — | — | 0 | 0 | **não medido** (504 duas vezes) |
| TJRO | 2023-08-24 | 2026-03-06 | 6 | 2 | — |
| TJRR | 2017-08-04 | 2025-07-25 | 3 | 1 | — |
| TJRS | 2021-03-23 | 2025-02-27 | 8 | 2 | nada depois de fev/2025 nas duas buscas |
| TJSC | 2021-05-25 | 2025-04-03 | 5 | 2 | — |
| TJSE | 2009-07-06 | 2023-02-03 | 5 | 2 | nada depois de fev/2023 nas duas buscas |
| TJSP | 2023-02-17 | 2025-02-18 | 3 | 1 | — |
| TJTO | 2021-06-21 | 2026-07-29 | 3 | 1 | tem acórdão de jul/2026 |

## O que dá para dizer (e o que não dá)

1. **Com acórdão de 2026 visto:** TJAP (jul), TJBA (abr), TJES (out; não medido), TJMT (ago), TJPB (mar), TJRJ (fev), TJRO (mar), TJTO (jul), TJAL (fev). Nesses a base chega pelo menos até a data vista.
2. **Sem acórdão de 2026 na amostra:** TJAC, TJAM, TJCE, TJDFT, TJGO, TJMA, TJMG, TJMS, TJPA, TJPE, TJPI, TJPR, TJRR, TJRS, TJSC, TJSE, TJSP. Isso **não prova** que a base pare antes: com 2 a 8 acórdãos por relevância, a chance de não pegar nenhum de 2026 é alta mesmo se houver. O único caso com outra medição é o TJPR (estudo de 2026-10-29: Câmaras até o 1º semestre de 2026).
3. **Início da base:** os mais antigos vistos vão de 2009 (TJSE) a 2025 (TJBA, TJDFT). Isso mostra só que a base **tem** acórdão desde essas datas; o início real pode ser anterior. TJBA, TJCE e TJDFT só devolveram 2024–2025 nas buscas feitas.
4. **Não medido:** TJES e TJRN (504). Qualquer afirmação sobre eles precisa de nova tentativa mais tarde.
5. **Para medir de verdade a janela** seria preciso uma amostra grande por período (um dia de julgamento por período, como no estudo do TJPR) ou um filtro de data que funcione. Hoje o filtro não funciona no JurisprudênciaIA para este uso.

## Limites conhecidos para o README

- `busca_direta` com `de`/`ate` → **HTTP 504** no JurisprudênciaIA (TJPR 3/3, TJRS 1/1).
- Buscas sem filtro também deram 504 no TJES e no TJRN (2026-10-29), em tribunais cujas respostas são pesadas ou instáveis.
- O cabeçalho de cobertura às vezes diz «devolveu os N pedidos» e mostra menos acórdãos (TJRS, TJPB, TJMS, TJPR). A causa **não foi verificada** (hipótese: junção de cópias antes de mostrar).

## Fontes

- `busca_direta` do Garimpo 1.1.2, 2026-10-29, TJs listados acima (sem filtro de data), com os freios do Garimpo; pausas de 20 min depois de cada 504.
- Estudo do TJPR de 2026-10-29 (`docs/estudos/2026-10-29-tjpr-cobertura.md`) para o TJPR e para o registro do filtro de data.
- Notas por tribunal e números de processo ficam em `TICKETS/time-elyra/matriz-tjs.md` (fora do git).
