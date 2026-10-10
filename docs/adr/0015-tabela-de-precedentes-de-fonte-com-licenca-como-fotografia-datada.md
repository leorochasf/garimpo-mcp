# Tabela de precedentes só de fonte com licença expressa, como fotografia datada no pacote

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-09 — sujeito a revisão do dono._

O Garimpo leva dentro do pacote uma **tabela de precedentes** com os temas repetitivos e os IAC do STJ, gerada do
conjunto "Precedentes qualificados" do Portal de Dados Abertos do STJ, cuja página declara a licença "Creative
Commons Atribuição" (versão não indicada na página; conferido em 2026-10-09). A tabela é uma fotografia: traz a
data da coleta, a data de atualização informada pela página do conjunto (texto literal, ou "não informada"), a URL
e o sha256 de cada arquivo, e a atribuição, que acompanha README, a tabela e toda resposta que a usa. A licença dos
dados é distinta da licença MIT do código. Tese e questão submetida são copiadas da fonte (só CRLF → LF e espaço nas
pontas); nada é escrito à mão. A **situação na fonte** é só informativa: nunca vira vigência nem muda o inciso do
art. 927. Fotografia com mais de 90 dias sai com aviso fixo.

A tabela é gerada por um script do mantenedor, com os freios do Garimpo (identificação do próprio Garimpo, só URLs
de download do conjunto, 10 s entre chamadas como pede o robots.txt, uma nova tentativa em 429/503, parada em
recusa, desafio anti-robô ou cabeçalho de CSV diferente do esperado, sem substituir a fotografia anterior).

STF (repercussão geral, súmulas, súmulas vinculantes) e súmulas do STJ ficam fora: não há termo de uso ou licença do
tribunal (só a Lei 9.610/98, art. 8º, IV, e a proteção de compilação não foi verificada), as súmulas não têm formato
legível por máquina, e o STF recusa (403) cliente que se identifica como o Garimpo. Incluí-los é decisão do dono.

**Decisão do dono sobre o STF (2026-10-09; o dono aprovou a recomendação do ticket 04 do B8):** (a) as teses de
repercussão geral entram por exportação manual do mantenedor no navegador, a cada versão; (b) súmulas e súmulas
vinculantes entram lidas das telas HTML pelo mantenedor; ambas com fundamento declarado no art. 8º, IV, da Lei
9.610/98. (c) Ler o STF com User-Agent de navegador fica para o bloco do STF (4º da ordem do dono), sem decisão agora.
A implementação de (a) e (b) é o ticket 06 do B8, que começa pelo que falta verificar. Súmulas do STJ seguem fora.

## Opções consideradas

- Download no computador do usuário: rejeitado agora; a licença permite redistribuir, e a fotografia cumpre a consulta
  sem rede sem pôr o IP do usuário em jogo. Atualização local fica para ticket próprio, se a defasagem atrapalhar.
- STF apoiado só no art. 8º, IV: não decidido pelo delegado; foi ao dono, que o aprovou em 2026-10-09 (exportação
  manual de RG e leitura das telas de súmulas e SV pelo mantenedor; ver acima).
- Ler o STF com user-agent de navegador: não decidido pelo delegado; o dono, em 2026-10-09, deixou para o bloco do STF
  (4º da ordem do dono), sem decisão agora. A regra 3 do CLAUDE.md (alterada pelo dono em 2026-10-08) permite
  contornar bloqueio e trocar o User-Agent, com a meta de máxima cobertura sem ban de IP.
- Agrupar situações em "vigente / não vigente": rejeitado; seria deduzir vigência.
- Incluir Controvérsia, SIRDR e PUIL do mesmo CSV: rejeitado agora; não são o que o art. 927, III, usa (Controvérsia
  e SIRDR confundem quem lê; PUIL pode entrar depois sem mudar o formato).
