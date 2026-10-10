# 2º teste lado a lado: Garimpo × jurisprudenciaia-mcp (2026-10-10)

Conclusão genérica do segundo teste com as duas ferramentas rodando de verdade, agora com a qualidade julgada.
**Qualidade julgada por júri de 3 IAs (GPT Sol, Grok, Claude no desempate) com o critério do dono, não pelo dono.**
Plano (gravado antes da primeira chamada), scripts, respostas brutas, votos, veredito consolidado e relatório completo
ficam fora do git, em `banco-de-provas-resultados/vs-bruno-2/`. 1º teste: [`vs-jurisprudenciaia-mcp.md`](vs-jurisprudenciaia-mcp.md).

**Como:** Garimpo do commit `c639d4e` × o jurisprudenciaia-mcp de terceiros, usado como caixa-preta, só pela interface
MCP (o código dele não foi aberto, regra 1). As mesmas 11 teses, formulações, tribunais e pedidos do 1º teste (Garimpo:
uma `busca_ampla` por tese; o outro: uma `buscar_precedentes` por formulação, 3 por tese). Tudo em série, nunca as duas
ferramentas juntas, ordem alternada por tese, tempo de parede medido por script sem o tempo do modelo. Nenhuma recusa,
cota ou erro em nenhum lado. Pasta de dados temporária; a pasta real do Garimpo ficou igual.

**Júri:** a união dos acórdãos das duas ferramentas (754, sem repetidos) foi a um pool cego — sem dizer de qual
ferramenta veio cada um, ordem embaralhada com semente fixa — mais 84 controles negativos (acórdão real de outra tese,
apresentado sob a tese errada, ~10% do pool). Pergunta por acórdão: "serve para fundamentar a tese?" — S (a razão de
decidir afirma ou aplica a tese), P (sustenta só uma parte, ou com ressalva relevante), N (não serve). GPT Sol e Grok
julgaram tudo; onde divergiram, Claude desempatou (maioria dos três); três letras diferentes = sem maioria, contado em
dois limites (pessimista N | otimista S). Precisão estrita = S / entregues; ampla = (S+P) / entregues.

## Resultados

| Eixo | Garimpo | jurisprudenciaia-mcp | Quem ganha |
|---|---|---|---|
| Velocidade por tese (média / mediana) | 9,4 s / 9,1 s | 50,6 s / 49,8 s (3 chamadas) | Garimpo, em 11 de 11 teses |
| Uma chamada só | 9,4 s (a tese inteira) | 16,9 s (de 12 a 23 s) | Garimpo |
| Acórdãos entregues por tese | 50 | 26,5 | Garimpo |
| Precisão ampla (S+P), média das teses | 92,3% \| 93,3% | 92,4% \| 94,5% | empate |
| Precisão estrita (só S), média das teses | 57,7% \| 58,6% | 56,2% \| 58,3% | empate |
| Precisão nos 10 primeiros (ampla / estrita) | 97,3% / 62,7% | 97,3% / 63,4% | empate |
| Relevantes (S+P) entregues, 11 teses | 506 \| 511 | 268 \| 274 | Garimpo |
| Relevantes só de uma / das duas | 424 só Garimpo | 186 só o outro | 82 das duas |
| Cobertura relativa (relevantes / união dos relevantes) | 74,0% \| 73,6% | 38,1% \| 38,4% | Garimpo, em 11 de 11 teses |

- **Velocidade:** igual ao 1º teste (9,0 s × 48,9 s; os dois ~3–4% mais lentos agora). A tese inteira no Garimpo sai
  antes de uma única chamada do outro.
- **Precisão:** empate. Das listas entregues, ~92–94% servem nas duas, e os 10 primeiros acertam igual. A estrita
  também empata, mas é a medida mais frágil: os jurados divergem muito entre S e P.
- **Cobertura:** o Garimpo entrega quase o dobro com a mesma precisão, então traz ~1,9× os relevantes. O outro ainda
  traz ~27% dos relevantes que o Garimpo não entrega — espaço de melhora no corte de 50 e na ordem; não foi medido se a
  busca do Garimpo os acha além do corte.

## O júri

- **Controles negativos: 84 de 84 julgados N** (pelos dois jurados principais, sem desempate). O júri recusa acórdão
  de outro assunto, então a medida vale.
- Concordância GPT Sol × Grok: exata 71% do pool (kappa 0,48); serve × não serve (S+P × N) 96%. Desempate em 242 de
  838 linhas (29%), quase todas na fronteira S × P; sem maioria em 11 (1,3%).
- O outro não informa órgão julgador em campo próprio, o que podia denunciar a origem no pool cego. Conferido: nos
  acórdãos só do Garimpo, o júri aprovou na mesma proporção com e sem órgão (91% × 93%) — sem sinal de viés.

## O 1º teste, fechado

O 1º teste tinha deixado a precisão em faixa por causa de 181 acórdãos sem marca. O mesmo júri julgou os 181 (83 S,
64 P, 29 N, 5 sem maioria); as marcas antigas ficaram como estavam e o veredito entrou só nos 181:

| | Antes (pessimista \| otimista) | Agora, ampla (S+P) | Agora, estrita (só S nos 181) |
|---|---|---|---|
| Garimpo, precisão nos 10 | 96,4% \| 97,3% | 97,3% | 96,4% |
| Garimpo, precisão nos 50 | 85,5% \| 96,4% | 94,4% \| 94,5% | 88,5% \| 88,7% |
| jurisprudenciaia-mcp, precisão nos 10 | 64,3% \| 100% | 99,1% | 88,9% |
| jurisprudenciaia-mcp, precisão na lista | 58,6% \| 98,3% | 91,4% \| 92,6% | 78,9% \| 80,1% |

A faixa larga do outro no 1º teste era falta de marca, não erro: com o júri, a precisão ampla das duas fica alta e
próxima, como neste 2º teste. O Garimpo continua entregando o dobro de relevantes (519 × 259–263).

## Limites

- Qualidade julgada por júri de 3 IAs (GPT Sol, Grok, Claude no desempate) com o critério do dono, não pelo dono. O
  júri é firme em serve × não serve e instável em S × P (kappa 0,33 nos acórdãos reais).
- Em duas teses o júri quase não deu S a nenhuma das ferramentas (leu o enunciado como composto): ali a estrita mede a
  tese, não a ferramenta.
- Cobertura relativa mede contra a união do que as duas trouxeram, não contra tudo o que existe.
- Uma rodada só, num horário só; o pedido ao outro foi de 3 chamadas por tese e não inclui o tempo do modelo.
