# B11: download por HTTP comum; ponteiro de terceiro só para PDF no portal oficial

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

Escopo do bloco B11: o Garimpo tenta obter o inteiro teor oficial de um tribunal por HTTP comum: pedidos com a
identificação do próprio Garimpo, cookies que o próprio portal entrega na mesma sessão e leitura estática dos links
do HTML, tudo pelo `Cliente` (freios da regra 3), só em https nos endereços oficiais e com cada redirecionamento
conferido. Neste bloco não se executa JavaScript, não se faz login, não se resolve captcha, não se troca o
User-Agent por um de navegador nem se usa proxy: o bloco mede o que sai só com HTTP comum. A rota de íntegra do
JurisprudênciaIA (TJRN) serve apenas de ponteiro: se indicar um PDF https no domínio oficial do tribunal, o Garimpo
baixa de lá; se entregar só a cópia em base64 ou um endereço fora do portal, nada é baixado e o usuário recebe o link
com o motivo. Motivo: o glossário só chama de oficial o PDF vindo do portal, e o bloco quer medir primeiro a
cobertura que o caminho mais simples já dá.

## Consequências

- O recorte "HTTP comum" é escopo do B11, não proibição geral. A regra 3 do CLAUDE.md (alterada pelo dono em
  2026-10-08) permite contornar bloqueio e trocar o User-Agent, com a meta de máxima cobertura sem ban de IP;
  navegador, troca de User-Agent e outros caminhos ficam para o D2.
- Aceitar a cópia do site como uma categoria separada (nunca chamada de oficial) é decisão do dono, fora do B11.
- O uso contínuo da rota de íntegra depende de o dono confirmar que o combinado com a JAI cobre essa rota.
