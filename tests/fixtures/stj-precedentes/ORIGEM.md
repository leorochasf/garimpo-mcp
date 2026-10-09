# Gravação de referência — conjunto "Precedentes qualificados" do STJ

Trechos **reais e literais** (registros inteiros, bytes como vieram, inclusive o CRLF) dos arquivos baixados do
Portal de Dados Abertos do STJ pelo cliente do Garimpo (`scripts/gerarTabela.ts`), em 2026-10-09:

| Trecho | Arquivo completo | Coletado em (UTC) | sha256 do arquivo completo |
|---|---|---|---|
| `temas-trecho.csv` | https://dadosabertos.web.stj.jus.br/dataset/4238da2f-c07b-4c1a-b345-4402accacdcf/resource/df29da13-7d6b-41ba-ad96-cd1a5bbd191c/download/temas.csv (2.588.746 bytes) | 2026-10-09T12:22:35.742Z | `98f1506ec8f02c4e849e968c9550268a947e32e2e7a10f188385add5cf31fd16` |
| `processos-trecho.csv` | https://dadosabertos.web.stj.jus.br/dataset/4238da2f-c07b-4c1a-b345-4402accacdcf/resource/7ed21202-0049-4fcb-aa7c-48d810d3c499/download/processos.csv (1.137.166 bytes) | 2026-10-09T12:22:47.212Z | `a6571a38162d57555c6abb5414bc5b27ebb865a3920d8a1888bf27c1f335b67d` |
| `pagina-trecho.html` | https://dadosabertos.web.stj.jus.br/dataset/precedentes-qualificados (40.671 bytes; trecho = seção "Licença" e linha "Última Atualização") | 2026-10-09T12:22:25.614Z | `bbf09b6b2500e9eaa0a14b7a0a2e64ebe29c6389d24f43fe08ca859dc7aa4f0e` |

Registros escolhidos (cabeçalho + estes `sequencialPrecedente`, nos dois CSV):

- 263 — Tema 1 e 1608 — IAC 1: mesmo número, tipos diferentes;
- 1640 — Tema 978: `Afetado`, sem tese firmada;
- 314 — Tema 56: `Cancelado`; 3582 — IAC 14: `Cancelado`, linha repetida na fonte;
- 383 — Tema 126: `Revisado`;
- 280 — Tema 18: linha repetida na fonte (duas vezes igual);
- 276 — Tema 14: `sumulaOriginada` preenchida;
- 1601 — Controvérsia 1: tipo que não entra na tabela.

Licença dos dados: "Creative Commons Atribuição", conforme a página do conjunto em 2026-10-09 (versão não indicada).
