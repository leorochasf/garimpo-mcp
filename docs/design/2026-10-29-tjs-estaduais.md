# Desenho — os 27 tribunais estaduais com todas as ferramentas (1.2)

Aprovado pelo dono em 2026-10-29, depois de duas rodadas de grilling. Entra na 1.2. Fatos de partida: matriz ao vivo
dos 27 TJs feita pelo time (fora do repositório) e o estudo do TJPR (`docs/estudos/2026-10-29-tjpr-cobertura.md`,
ADR-0030). Vocabulário: `CONTEXT.md` (*situação do tribunal*, *janela de cobertura*, *texto da base*).

## Meta

Cada TJ termina **completo** ou **só link** com motivo provado e datado (ver *situação do tribunal*). Some a
explicação genérica «ainda não testou».

## Decisões do dono

1. Situação do tribunal: **completo** ou **só link**.
2. Proibição expressa (termo de uso, `robots.txt`) ou barreira (captcha, WAF, desafio, login): não se contorna. Procura-se
   um caminho alternativo público e legítimo do mesmo tribunal, como o do TJGO (ADR-0029). Sem caminho, o tribunal fica
   só link; prepara-se uma minuta de pedido de autorização e a lista de onde enviá-la, e o dono decide se envia.
3. Portal que só responde a quem se apresenta como navegador, **sem nenhuma** barreira: segue o precedente do TJTO
   (ADR-0021), caso a caso.
4. Pesquisa oficial do TJ pública e sem barreira: mede-se contra a base do JurisprudênciaIA naquele TJ. Se for melhor
   (critério abaixo), **substitui** a base nesse TJ; se não, **complementa**. Cada caso é uma ADR (altera a regra da
   *fonte principal*, ADR-0017).
5. TJES e TJMA: o *texto da base* que vem embutido no lugar do link é usado, com rótulo de não oficial. Caminho oficial,
   se achado, prevalece.
6. TJBA: quando o campo de ementa traz a decisão inteira, a lista mostra só a ementa.
7. ADR de cada tribunal: decidida pelo coordenador com o revisor Codex pelo critério dos itens 2 e 3; o dono lê todas
   antes de publicar; caso fora do critério vai ao dono.

## Critério «a pesquisa oficial é melhor»

Num TJ, a pesquisa oficial substitui a base só se cumprir os três ao mesmo tempo, medidos no banco de provas e na
medição de velocidade:

- revocação igual ou maior que a da base;
- precisão igual ou maior;
- cobre os meses recentes que a base não cobre e é no máximo 2× mais lenta por busca.

## Peças

1. **Só endereço web vira link.** `data:`, `gs://` e qualquer link que não seja `https` em host do tribunal deixam de
   ser mostrados crus (hoje uma busca de 3 acórdãos do TJES passa de 400 mil caracteres).
2. **Molde «página com íntegra»** e **registro de portais**: o caminho do TJPR vira peça comum, com as guardas ligadas
   por padrão (número do processo dentro da íntegra, segredo de justiça, documento trocado, sem número CNJ = recusa).
   Cada TJ novo declara só os seus dados; o rótulo da fonte vem do registro, nunca de outro tribunal.
3. **Um ticket por tribunal** com caminho provado: primeiro TJBA (texto em HTML aberto) e TJCE (PDF direto no eSAJ);
   depois os que a investigação destravar.
4. **Texto da base** (TJES, TJMA): lido por partes e conferível, com rótulo.
5. **Ementa limpa** (TJBA).
6. **Junção de cópias** do mesmo acórdão (TJRS, TJBA e outras que a amostra mostrar), como no TJPR.
7. **Janela de cobertura** de cada TJ, no `listar_tribunais` e no cabeçalho de cobertura da busca.
8. **Teste pesquisa oficial × base** nos TJs com pesquisa oficial aberta.
9. **Minuta de autorização** e destinatários, só para os TJs sem caminho alternativo.

## Fluxo de cada peça

Pesquisa ao vivo (um painel de rede só) → ADR pelo critério → implementação com TDD, sem rede → code-review → revisor
Codex até limpo → prova ao vivo curta → junção na `integracao-1.2`.

## Erros e segurança

Barreira encontrada = parar e dizer o motivo. Os freios da regra 3 valem para cada host novo. Nenhum dado de processo
real entra no repositório.

## Prova

Testes sem rede sobre respostas gravadas e saneadas; teste ao vivo opcional por tribunal; banco de provas para o item 8;
medição de velocidade da 1.2 contra a 1.1.2 antes de fechar a versão.
