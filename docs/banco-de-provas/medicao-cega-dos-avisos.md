# Medição cega e dupla dos avisos de conferência (G-75)

Os avisos dos tickets 08 e 09 nascem **desligados** porque adivinham: leem o texto do acórdão e deduzem quem disse a
frase ou qual órgão julgou. Um aviso que adivinha pode cair muito quando alguém confere às cegas (um autor viu 100%
virar 43%). Este protocolo mede cada aviso antes de ligá-lo. **Ele não liga nada**: o limiar é do dono (ticket 10, DQ-23).

Vocabulário: [`CONTEXT.md`](../../CONTEXT.md) — *sinal de outro autor* (indício, nunca autoria), *Banco de provas*, *Gabarito*.
Aqui o gabarito de cada aviso é o rótulo que **dois rotuladores humanos** dão sozinhos; não é pré-marcação de IA.

## O que se mede

Seis avisos, um interruptor cada: `negacao`, `alegacaoDaParte`, `ementaTranscrita`, `divergencia`,
`raciocinioHipotetico` (ticket 08) e `orgaoDoFecho` (ticket 09). Para cada um, três números:

| Número | Pergunta | Conta |
|---|---|---|
| **Acerto quando avisa** | Dos casos em que o programa avisou, quantos eram verdade? | avisou e é verdade ÷ avisou |
| **Alcance** | Dos casos que eram verdade, quantos o programa pegou? | avisou e é verdade ÷ é verdade |
| **Falso aviso em frase limpa** | Das frases em que o aviso não vale, quantas ele marcou à toa? | avisou e não é verdade ÷ não é verdade |

"É verdade" vem só do rótulo dos humanos. Os três números saem **separados por conjunto** (ajuste e validação) e **todos
os avisos são publicados, também os de taxa ruim**: aviso reprovado fica desligado e documentado com o número.

## A amostra que o dono monta

Uma pasta **fora do repositório** (por exemplo na pasta de documentos; nunca dentro do projeto, nunca em
OneDrive/Google Drive), porque PDF real e citação de caso real não entram no git (regra 2). Conteúdo:

- os PDFs de inteiro teor já baixados (ou texto de outro formato convertido em PDF);
- `amostra.json`, com um item por PDF:

```json
{ "itens": [
  { "id": "a01", "pdf": "a01.pdf",
    "citacao": "a passagem do acórdão que se quer conferir (5 palavras ou mais)",
    "tribunal": "trt1", "orgaoDoRegistro": "3ª Câmara Cível" }
] }
```

`citacao` testa os cinco avisos de passagem; `tribunal` (sigla do Garimpo) com `orgaoDoRegistro` (como veio na busca)
testa o aviso do órgão. Um item pode ter os dois. O `id` é um código sem sentido ("a01"), nunca parte do texto.

**O que tem de haver na amostra** — proposta do protocolo, a confirmar pelo dono, **não verificada**:

- por aviso, casos em que ele **deveria** valer e casos de **frase limpa** (texto parecido em que não vale: "sustenta"
  na fundamentação do relator, "divergência" em acórdão unânime, "não" que nega outra coisa). Só frases limpas
  respondem "avisa à toa", só casos positivos respondem "alcance": sem os dois, o número fica "sem base";
- de cada tribunal em que o aviso será usado (STJ, TJMG, TJSP, TSE, TRTs): a transferência entre tribunais é justamente
  o que não se sabe;
- pelo menos algumas dezenas de casos por aviso e por conjunto, ordem de grandeza **a decidir** — com poucos casos o
  número balança e o relatório mostra a contagem ao lado da porcentagem.

## Passo a passo

1. **Montar.** Com `amostra.json` pronto:

   ```
   npx vite-node scripts/rodarMedirAvisos.ts montar <pasta>
   ```

   Divide a amostra em **ajuste** e **validação** de forma fixa (pelo conteúdo do PDF; repetir dá a mesma divisão) e cria
   dois formulários em branco, `rotulos-a.json` e `rotulos-b.json`, sem sobrescrever os já preenchidos.
2. **Rotular, cada um sozinho.** O rotulador A recebe a pasta com `rotulos-a.json` e o rotulador B, com `rotulos-b.json`
   (cada um apaga o formulário do outro da cópia que recebe). Eles **não conversam sobre os casos** e **não veem o que o
   programa disse** — o programa nunca roda antes dos dois terminarem, e `amostra.json` não traz nenhum resultado dele.
   Para cada item e cada aviso do formulário, `true` ou `false`:

   | Aviso | O rotulador responde `true` quando… |
   |---|---|
   | `negacao` | a passagem aparece negada: um "não", "nem", "nunca" ou "jamais" logo antes inverte o sentido |
   | `alegacaoDaParte` | a passagem é o que a parte alega ou sustenta, não o que o tribunal decide |
   | `ementaTranscrita` | a passagem é ementa ou trecho de **outro** julgado, transcrito |
   | `divergencia` | a passagem é de voto divergente ou vencido |
   | `raciocinioHipotetico` | a passagem é raciocínio hipotético ("ainda que assim não fosse…") |
   | `orgaoDoFecho` | o órgão que o fecho do acórdão diz que julgou é **diferente** do órgão do registro |

   Nenhum campo pode ficar em branco (`null`): o script recusa formulário incompleto.
3. **Desempatar.** Rodando `medir`, os itens em que A e B discordam ficam **sem consenso** e fora dos três números (a
   concordância os conta). Para incluí-los, uma terceira pessoa — ou o dono — rotula só esses itens em `desempate.json`,
   no mesmo formato (`{"rotulos":{"a01":{"negacao":true}}}`), também sem ver o programa.
4. **Medir.**

   ```
   npx vite-node scripts/rodarMedirAvisos.ts medir <pasta>
   ```

   Roda cada aviso **sozinho ligado** sobre cada PDF (o resto da conferência fica como hoje), compara com o consenso e
   imprime, por aviso e conjunto: os três números como contagens, a concordância dos dois rotuladores (iguais e kappa de
   Cohen) e o hash de 12 caracteres dos PDFs de cada falso aviso e de cada caso perdido. **Nunca imprime** citação,
   órgão, nem trecho de PDF. Sem rede.
5. **Ajustar num conjunto, validar no outro.** Qualquer retoque de fórmula ou de janela de um aviso (nos tickets 08/09)
   olha só os números do **ajuste**; o número que vale para decidir é o da **validação**, em casos que o retoque nunca
   viu. Retocou depois de ver a validação? A validação virou ajuste: monte uma amostra nova.
6. **Registrar.** O dono (ticket 10) cola o relatório em `docs/banco-de-provas/`, **só contagens e hashes**.

## Quando o resultado não vale

- Os formulários são idênticos → o script recusa (dois rotuladores independentes não copiam um do outro).
- Concordância baixa entre os rotuladores → o aviso está mal definido, não é o programa que está ruim: reescreva a
  pergunta da tabela acima antes de medir de novo. Corte de kappa: **a decidir pelo dono**.
- Citação que o programa não acha no PDF → fica fora dos avisos de passagem e é contada à parte no relatório.

## Decisão que fica para o dono (ticket 10, DQ-23)

Pergunta: **para cada aviso, qual o limiar mínimo para ligar?**

Recomendação já registrada no ticket 10, a confirmar: ligar só o aviso com **acerto quando avisa ≥ 90%** e **falso aviso
em frase limpa ≤ 5%**, na **validação**; os demais ficam desligados, com a taxa ruim publicada. O alcance também pesa,
mas um aviso de alcance baixo e acerto alto ainda ajuda (avisa pouco, avisa certo): decidir se há piso de alcance.

| Aviso | Acerto quando avisa | Alcance | Falso aviso em frase limpa | Concordância (kappa) | Limiar do dono | Ligar? |
|---|---|---|---|---|---|---|
| `negacao` | — | — | — | — | — | — |
| `alegacaoDaParte` | — | — | — | — | — | — |
| `ementaTranscrita` | — | — | — | — | — | — |
| `divergencia` | — | — | — | — | — | — |
| `raciocinioHipotetico` | — | — | — | — | — | — |
| `orgaoDoFecho` | — | — | — | — | — | — |

## Não verificado

- Os kappa e porcentagens do autor de origem (transcrição ~91%, divergência ~77%, alegação 71–90%, negação ~68%,
  obiter ~86%) vêm de outro projeto e de outros PDFs; nada aqui mede ainda os PDFs reais do Garimpo.
- Os tamanhos de amostra e o corte de kappa acima são propostas do protocolo, não valores medidos nem decididos.
- O script foi testado só com PDFs sintéticos (`tests/pdfSintetico.ts`).
