# B11 — prova ao vivo do inteiro teor por HTTP comum (2026-10-09)

Conclusão genérica do ticket 01 do B11 (ADR-0016). Brutos, contagens e scripts ficam fora do git, em
`banco-de-provas-resultados/b11-prova/`; os PDFs, numa pasta temporária.

**Como:** programa descartável com o `Cliente` real e a pasta de proteção compartilhada real (mesmo freio e mesmo
disjuntor das outras janelas); só HTTP comum (User-Agent do Garimpo, cookies do próprio portal na mesma sessão,
leitura estática do HTML, cada redirecionamento conferido, só https no host oficial). Ordem TJRN → TJSP → TST →
TJDFT, pausa de 10 s, 1 busca genérica por tribunal (até 5 registros), primeiro registro com link (TJRN: com id).
TJTO entrou como acréscimo aprovado pelo piloto.

**Antes:** 3 tribunais baixam o inteiro teor oficial (STJ, TJMG, TSE). **Depois da prova:** continuam 3 — a prova
mede viabilidade, não habilita download. Um tribunal novo (TJSP) mostrou caminho viável por HTTP comum.

| Tribunal | Resultado | Chamadas | O que foi observado |
|---|---|---|---|
| TJRN | inconclusivo | 1 busca, 0 GET | a busca do site no TJRN respondeu 504 após ~61 s; sem registro, a rota de íntegra não foi chamada |
| TJSP | **funcionou** | 1 busca, 2 + 3 GETs | o link do PDF redireciona (302) para uma página de verificação de login cujo fallback anônimo traz o endereço seguinte como texto literal (`...&casChecked=true`); lido do HTML, sem executar JavaScript, ele devolve o PDF. Caminho completo: 3 GETs numa sessão. A 1ª passagem parou no 2º GET (o leitor do programa não procurava esse literal) e foi completada numa 2ª sessão, com o mesmo acórdão e o mesmo caminho |
| TST | inconclusivo | 1 busca, 0 GET | o link veio como encurtador da Justiça do Trabalho (`link.jt.jus.br`), fora do host do TST; não seguido |
| TJDFT | inconclusivo | 1 busca, 1 GET | HTTP 200 com página de aplicação web (só scripts), sem PDF nem link para ele no HTML estático; não demonstra login nem captcha |
| TJTO (extra) | recusa (403) | 1 busca, 1 GET | `viewFileDoc.php` respondeu 403; o disjuntor do TJTO abriu, como previsto |

Nenhum 429/503. Nenhuma recusa do JurisprudênciaIA. Total: 5 buscas e 7 GETs.

## B11 ampliado — testes de uma chamada (acréscimo do dono, 2026-10-09)

| Teste | HTTP | O que uma chamada mostra |
|---|---|---|
| TJTO, `consulta.php` | 403 | o mesmo bloqueio do `viewFileDoc.php`; disjuntor do TJTO aberto de novo |
| TJGO, `ConsultaJurisprudencia` | 200 | a página carrega o widget Cloudflare Turnstile, que grava o token num campo `g-recaptcha-response` do formulário (POST). Se o servidor valida o token **não** foi testado: exige uma 2ª chamada (o envio do formulário sem token) |
| TREs, `jurisprudencia-tres.tse.jus.br` | 200 | aplicação web (só scripts), sem captcha no HTML; a rota da busca não aparece no HTML estático |
| CJF, `unificada/index.xhtml` | 200 | o script do reCAPTCHA é **carregado**, mas o formulário estático não tem widget nem campo de token; se é exigido na busca não se decide com uma chamada |

Uma amostra prova aquele caminho naquela data, não a cobertura de todo o tribunal.
