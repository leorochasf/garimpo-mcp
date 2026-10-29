# TJPR: a cobertura do Garimpo é total? (2026-10-29)

Estudo de viabilidade, sem implementação. Pedido do dono: "adicionar o TJPR e mapear se a cobertura é total". O TJPR
já está no Garimpo desde o início (busca pelo JurisprudênciaIA; inteiro teor «só link», com a explicação genérica
«ainda não testou»). Este estudo mede as duas pontas: o que a base do JurisprudênciaIA tem do TJPR e o que o portal
do tribunal entrega. Números de processo, nomes e ementas da amostra ficam fora deste documento (regra 2).

## Método

- **Amostra oficial:** pesquisa pública de jurisprudência do TJPR (`portal.tjpr.jus.br/jurisprudencia`), termo
  «dano moral», só ementa, um dia de julgamento por período. Chamadas uma por vez, 5 s de pausa.
- **Conferência na base:** cada acórdão da amostra buscado pelo número CNJ na `busca_direta` do Garimpo (freios
  valendo). Controle: um acórdão sabidamente na base volta em 1º pelo número.
- **Portal:** `robots.txt` e a página de um acórdão (Câmara e Turma Recursal), lidos por HTTP comum.

## Base do JurisprudênciaIA (busca)

| Julgamento | Câmaras cíveis | Turmas Recursais |
| --- | --- | --- |
| jun/2018 | não conferido (número antigo, sem CNJ; a busca pelo número estourou o tempo) | ausente (1/1) |
| jun/2022 | presente (1/1) | presente (1/1) |
| jun/2025 | presente (1/1) | presente (1/1) |
| set/2025 | presente (1/1) | presente (1/1) |
| out/2025 | presente (1/1) | presente (1/1) |
| dez/2025 | não amostrado | ausente (1/1) |
| mar/2026 | presente (1/1), lote novo sem órgão nem classe | ausente (1/1) |
| jul/2026 | ausente (2/2) | não conferido |
| set/2026 | ausente (2/2) | não conferido |

Leitura (amostra pequena: indica, não prova):

1. **Início por volta de 2020.** Duas buscas por temas do CPC/1973 (embargos pelo art. 535; agravo retido, extinto
   em 2016) só trouxeram julgamentos de 2020 em diante; o mais antigo visto foi de fev/2020.
2. **Fim das Câmaras entre mar e jul/2026**; hoje (out/2026) a defasagem é de pelo menos 3 meses.
3. **Turmas Recursais param antes, entre out e dez/2025.**
4. **Registros duplicados em massa.** O mesmo acórdão aparece duas vezes, de dois lotes: um com órgão, classe e
   link com o número do processo; outro, de id alto, com ementa iniciada por «Ementa:», rodapé de citação
   «(TJPR – AC …, julg.: …, public.: …)», às vezes sem órgão e classe, e link terminado em `/Acórdão`. Em duas buscas
   de 10, os 10 eram 5 acórdãos. A junção de equivalentes do Garimpo (`src/equivalencia.ts`) não junta esses pares,
   porque compara a ementa e o rodapé muda; o número no link oficial (`/jurisprudencia/j/<n>/`) é o mesmo nas duas
   cópias.
5. **Campo trocado:** num registro, o relator veio com texto da ementa («…evantes citados: CPC/2015…») e sem órgão.
6. **Filtro de data no TJPR estourou o tempo** nas 3 tentativas (de/ate), com e sem texto específico.
7. Busca pelo número CNJ funciona (controle em 1º lugar).

## Portal do TJPR (inteiro teor)

- `robots.txt` (lido em 2026-10-29): `User-agent: *` e só `Disallow: /tjpr-assinador/`. A jurisprudência fica
  liberada. A página de resultado traz `<meta name="robots" content="nofollow">` (pede a buscadores que não sigam
  links; não veda a leitura).
- O link que vem da busca (`portal.tjpr.jus.br/jurisprudencia/j/<n>/Acórdão-…`) responde 200, HTML, sem login nem
  verificação anti-robô, e **traz a íntegra na própria página** (bloco oculto «Íntegra do Acórdão», aberto por
  clique), com o aviso do tribunal: «O texto abaixo representa a transcrição de Acórdão. Eventuais imagens serão
  suprimidas.» Câmara: ~33 mil caracteres, relatório, voto e dispositivo. Turma Recursal: ~8 mil, com dispositivo,
  composição e data. Rodapé da página: «Não vale como certidão ou intimação.»
- A pesquisa pública respondeu sem barreira, mas devolveu **HTTP 502 duas vezes** em ~12 chamadas; depois de 90 s,
  a nova tentativa passou.
- Termo de uso do portal: não procurado neste estudo (não verificado).
- **Achado da implementação (mesmo dia):** em chamadas repetidas, o portal às vezes devolve a página certa com a íntegra
  de **outro** acórdão (4 de 11 chamadas); a guarda está na ADR-0030.

## Resposta

**A cobertura não é total.** Busca: base de ~2020 até o 1º semestre de 2026 nas Câmaras, até o fim de 2025 nas
Turmas Recursais, com cópias duplicadas que gastam metade das vagas de cada busca. Inteiro teor: hoje só link,
mas o portal entrega o texto completo por HTTP comum, como TJPI e TJDFT (modo `portal`).

## O que daria para fazer

1. **Inteiro teor pelo portal (modo `portal`)**: ler o bloco «Íntegra do Acórdão» da página do link, só em
   `https` em `portal.tjpr.jus.br`, conferir o número do processo na página, rótulo «texto do portal do tribunal
   (TJPR)», sem PDF nem recibo. Precisa de ADR (critério de acesso legítimo, caso a caso) e de freio próprio, dados
   os 502.
2. **Juntar as cópias do TJPR** pelo número do documento no link oficial (mesmo tribunal + mesmo `<n>`), regra
   que não depende da ementa.
3. **Dizer a cobertura** em `src/tribunais.ts` / `listar_tribunais`: período aproximado e defasagem.
4. **Fora do alcance do Garimpo hoje**: o que falta na base (antes de 2020, depois de 2026/1, Turmas Recursais
   recentes). Cobrir isso seria uma busca direta na pesquisa oficial do TJPR (como e-Proc do TRF4), decisão maior.

## Fontes

- Pesquisa pública e páginas de acórdão do TJPR, `robots.txt` do portal (2026-10-29).
- `busca_direta` do Garimpo no TJPR, 17 chamadas (2026-10-29).
