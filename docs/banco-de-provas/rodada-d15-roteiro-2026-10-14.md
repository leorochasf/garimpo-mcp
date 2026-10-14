# Banco de provas — rodada da revisão do roteiro (D-15, D-02; G-66, G-67, G-68)

Rodada **ao vivo**, feita em 2026-10-14 (das 14h08min30s às 14h12min16s, UTC), uma só vez, sozinha, pelo cliente único do
Garimpo (ramo `b20-regua`), contra a busca direta do JurisprudênciaIA. Plano fixado antes de rodar em
`tests/fixtures/banco-de-provas/rodada-d15.json` (5 teses × 4 formulações; N = topo 10; limite 100; teto 24).

> **Leia antes dos números.**
> 1. **Amostra pequena:** 5 teses, **1 tribunal cada** (STJ; TSE na 18), **1 busca por formulação**. Uma tese pesa muito
>    na soma (ver 3).
> 2. **Gabarito provisório:** o da rodada 2 (pré-marcação por IA mais marcas do dono da lista curta). Pela D-15, **não se
>    anuncia melhora jurídica** com ele.
> 3. **Precisão quase sem base:** dos 1.995 acórdãos devolvidos, só **362 (18%)** têm marca no gabarito; o resto é "sem
>    julgamento" e fica fora da conta. Em 3 das 5 teses (1, 18, 20) quase não há irrelevante marcado, e a precisão sai
>    100% por falta de julgamento, não por mérito.
> 4. **Cobertura** = relevantes **distintos** achados ÷ relevantes **distintos** conhecidos do gabarito no tribunal. Por
>    contar números distintos, os conhecidos são 18 (tese 1) e 86 (tese 18), não os 20 e 92 da rodada de 2026-10-10,
>    que contou linhas.

## O que foi chamado

| Item | Valor |
|---|---|
| Host | `www.jurisprudenciaia.com.br`, só `POST /api/tribunais/<stj\|tse>/search` (nenhum outro host, nenhum tribunal, nenhuma fonte pausada ou vedada) |
| Chamadas ao site | **20** (teto 24; as 4 de folga não foram usadas) |
| Status | 20 × **200**; 429 / 503 / 504 / 403: **0**; nenhuma nova tentativa; disjuntor fechado |
| Espaçamento | 1 chamada por vez, 10 s entre uma e outra; tempo de resposta de 1,1 s a 5,8 s |
| Duração | 3 min 46 s (o plano previa 4 a 6 min) |
| Antes de rodar | estado de proteção lido sem erro e serviço não pausado; nenhum outro pane fazia rede |

As gravações cruas (corpo enviado, status, tempo, resposta) ficam em `banco-de-provas-resultados/b20-d15/` (fora do git:
as ementas trazem nomes de partes). A apuração sai, sem rede, de `resultados.json` dessa pasta e do gabarito da rodada 2.

## 1. Por tese e formulação

Formato: devolvidos · relevantes distintos (cobertura) · irrelevantes · precisão (relevantes ÷ julgados) · relevantes no topo 10.

| Tese | Conhecidos | Técnica · assunto | Técnica · conclusão | Leiga · assunto | Leiga · conclusão |
|---|---|---|---|---|---|
| 1 Dolo específico (STJ) | 18 | 99 · 4 (22%) · 0 · 100% · 2 | 100 · 3 (17%) · 0 · 100% · 1 | 100 · 1 (6%) · 0 · 100% · 0 | 99 · 1 (6%) · 0 · 100% · 1 |
| 10 Dano ambiental (STJ) | 11 | 100 · 10 (91%) · 16 · 38% · 6 | 100 · 11 (100%) · 17 · 39% · 7 | 100 · 3 (27%) · 4 · 43% · 2 | 100 · 3 (27%) · 5 · 38% · 2 |
| 17 ITBI (STJ) | 25 | 100 · 25 (100%) · 11 · 70% · 9 | 100 · 25 (100%) · 9 · 74% · 9 | 100 · 4 (16%) · 1 · 80% · 3 | 99 · 4 (16%) · 1 · 80% · 1 |
| 18 Cota de gênero (TSE) | 86 | 99 · 33 (38%) · 0 · 100% · 2 | 100 · 47 (55%) · 0 · 100% · 9 | 99 · 34 (40%) · 0 · 100% · 6 | 100 · 22 (26%) · 0 · 100% · 5 |
| 20 Negativação (STJ) | 62 | 100 · 28 (45%) · 1 · 97% · 3 | 100 · 14 (23%) · 0 · 100% · 2 | 100 · 4 (6%) · 0 · 100% · 0 | 100 · 1 (2%) · 0 · 100% · 0 |

"Dúvida" do gabarito: 2 na técnica · conclusão da 18 e 1 na leiga · conclusão da 18; fica fora da precisão, como "sem
julgamento".

**Assunto e conclusão trazem conjuntos diferentes.** Juntando as duas formulações da mesma linguagem (relevantes
distintos da união): técnica 1 → 7 (4 e 3, nenhum em comum), 18 → 57 (33 e 47), 20 → 35 (28 e 14); leiga 17 → 6, 18 → 39,
20 → 5. Nas outras (técnica 10 e 17; leiga 1 e 10) uma formulação contém a outra ou as duas acham os mesmos.

## 2. Régua D-02 (paradigmas obrigatórios)

- Nenhum dos 20 obrigatórios oficiais de `paradigmas-oficiais.json` é tema destas 5 teses (como o plano já dizia): por
  tese e formulação, **0 aplicáveis**, logo 0 "não indexado", 0 "não recuperado", 0 "fora do topo 10". Nenhum dos 20
  apareceu por acaso nas 20 listas.
- Como não-regressão, a régua roda sem rede sobre as gravações (`tests/bancoDeProvas.test.ts`): **20 no topo, 0 fora,
  0 não recuperados**, igual a antes. Esta rodada não mexeu em ordem nem em código de busca.

## 3. Critério de adoção (fixado antes, D-15)

Sugerida × alternativa, somadas as 5 teses; passa se cobertura maior sem precisão menor (ou precisão maior sem cobertura
menor) **e** nenhuma tese isolada piora nas duas.

| G-66 "pelo assunto" × "pela conclusão" | Cobertura (assunto × conclusão) | Precisão (assunto × conclusão) | Tese que piora nas duas | Resultado |
|---|---|---|---|---|
| Técnica | 100/202 = **49,5%** × 100/202 = **49,5%** | 103/131 = **78,6%** × 108/134 = **80,6%** | 10 | **não passa** |
| Leiga | 46/202 = **22,8%** × 31/202 = **15,3%** | 50/55 = **90,9%** × 33/39 = **84,6%** | nenhuma | passa |
| As duas linguagens | 146/404 = **36,1%** × 131/404 = **32,4%** | 153/186 = **82,3%** × 141/173 = **81,5%** | nenhuma | passa |

Relevantes no topo 10 (somados): assunto 33 (técnica 22, leiga 11) × conclusão 37 (técnica 28, leiga 9).

Leitura, com a amostra declarada (5 teses, 1 tribunal cada, 1 busca por formulação):

- **"Formular pelo assunto" passa na soma das duas linguagens e na leiga; não passa na técnica.** O ganho da leiga vem
  quase todo da tese 18 (34 × 22 relevantes); na técnica, assunto e conclusão empatam em cobertura e a conclusão vai
  melhor na 18 (47 × 33) e pior na 20 (14 × 28).
- **"Nunca pela conclusão" (a forma forte da G-66) não passa:** na técnica a conclusão não perde cobertura e tem
  precisão um pouco maior, e a união das duas acha mais que qualquer uma sozinha em 6 dos 10 pares.
- **"Grupos curtos de 2 a 4 termos" e "colher vocabulário do melhor resultado"** (resto da G-66) **não foram medidos**:
  não passam por falta de dado.
- **G-67 (cascata relator → órgão → tribunal)** não teve chamada: o critério não se aplica e nada passa por esta rodada.
- **G-68 (léxico)** não teve chamada: nenhuma entrada foi medida; nada passa por esta rodada.
- As diferenças de precisão vêm de poucos julgados (ver o aviso 3); nada aqui afirma melhora jurídica.

### Texto recomendado (não aplicado; o roteiro segue intocado)

Só a forma fraca da G-66 tem apoio. Em `src/roteiro.ts`, passo 1 do `pesquisar_tese`, depois de
"…efeito pretendido + situação de fato)." e antes de "Não invente…", acrescentar:

> Inclua formulações que descrevam o assunto ou o fato (o instituto e a situação), e não só a conclusão que se quer ver
> confirmada.

Nada para G-67 e G-68. A mudança, se aprovada, segue o que a D-15 pede: junto do ADR-0014, com o teste de padrões e leitura
humana do texto inteiro.

## 4. O que esta rodada **não** prova

- Não prova precisão (82% de "sem julgamento") nem melhora jurídica (gabarito provisório).
- Não mede a busca ampla com 3 a 6 formulações e vários tribunais; cada formulação teve 1 busca em 1 tribunal.
- Não generaliza: 5 teses; uma delas (18) decide boa parte da soma.
- As formulações foram escritas por agente, não pelo dono, e não reproduzem um usuário real.
