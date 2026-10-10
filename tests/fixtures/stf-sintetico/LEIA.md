# Gravações sintéticas do STF (testes do gerador da tabela do STF)

Arquivos **fictícios**, escritos à mão para os testes: nenhum tema, tese, súmula ou processo aqui é real. Imitam só a
forma dos arquivos que o mantenedor salva do portal do STF no navegador:

- `RepercussaoGeral.xls`: a exportação "Exportar Dados" da tela "Todos os temas" de repercussão geral, que é uma
  tabela HTML com cabeçalho do Excel; os cabeçalhos são os literais registrados em `TICKETS/b8-entrevista/fontes.md`
  (acesso 2026-10-09). A coluna "Há Repercussão" imita o defeito de acentuação duplamente codificada ("HÃ¡").
- `sumulas.html` e `sumulas-vinculantes.html`: a tela de súmulas (`sumariosumulas.asp?base=30` e `base=26`), com a
  forma `<div class="sumula-item"><a href="sumariosumulas.asp?base=..&sumula=..">Súmula N (marca)</a></div>`,
  conferida numa cópia arquivada da página (web.archive.org, 2023-03-29) em 2026-10-09.
- `sumulas/*.html`: a página de uma súmula, com `<div class="titulo">Súmula N</div><div class="parCOM">…</div>`,
  conferida numa cópia arquivada (web.archive.org, 2025-01-27) em 2026-10-09.
