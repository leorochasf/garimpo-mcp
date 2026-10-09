# Referência — API interna do JurisprudênciaIA e inteiro teor dos tribunais

Mapeada de forma independente em 2026-10-07, lendo o código público do site e testando chamadas.
Não há API documentada: tudo aqui pode mudar sem aviso. Conferir antes de confiar.

## Condições de uso do site

- **Termos de uso** (abril/2026): serviço "gratuito e público"; limites por endereço IP; "scraping automatizado
  em volume, contorno de limites ou impacto ao serviço podem resultar em bloqueio temporário ou permanente".
- **robots.txt:** `Disallow: /api/`. É o pedido do operador para robôs evitarem as rotas internas.
- Daí as travas obrigatórias do Garimpo (CLAUDE.md, regra 3) e o pedido de autorização antes de publicar.

## Busca direta

`POST https://www.jurisprudenciaia.com.br/api/tribunais/{tribunal}/search`
Cabeçalhos usados no teste: `Content-Type: application/json`, `Origin` e `Referer` do próprio site.
Sem login, sem chave, sem cookie.

Tribunais: `stf stj tst tse stm tjac tjal tjam tjap tjba tjce tjdft tjes tjgo tjma tjmg tjms tjmt tjpa tjpb
tjpe tjpi tjpr tjrj tjrn tjro tjrr tjrs tjsc tjse tjsp tjto`: STF, STJ, TST, TSE, STM e os 27 TJs (26 estados e o
DF), 32 no total. Não há TRFs, TCU nem tribunais de contas. O TJTO faltou no mapeamento de 2026-10-07; a busca
dele foi conferida ao vivo em 2026-10-09 (resposta 200, acórdãos do TJTO em `results`, mesmo corpo dos outros TJs).

Corpo:

```json
{"query": "texto", "limit": 100, "vector_mode": "auto",
 "from": "AAAA-MM-DD", "to": "AAAA-MM-DD", "relator": "...", "orgao": "...", "classe": "..."}
```

`from`, `to`, `relator`, `orgao`, `classe` são opcionais. Extras por tribunal (o site os envia):

- STJ: `sumulas_limit, repetitivos_limit, iacs_limit, puil_limit, qualified_strict: true`
- STF: `include_rg: true, rg_only: false, rg_limit, rg_score_threshold: 0.45, sumulas_limit, sumulas_vinc_limit, qualified_strict: true`
- TST: `include_sumulas, sumulas_limit, include_irrs, irrs_limit, include_ojs, ojs_limit, qualified_strict: true`

**`limit` medido:** STJ e TJGO aceitam até **100** (pedir 200 devolve 100 no TJGO). **O STF devolve poucos
acórdãos por busca, qualquer que seja o `limit`**: de 2 a 7 na gravação de 2026-10-08 (o "no máximo 4" medido
antes não se confirmou). Subir o `limit` de 10 para 100, com o mesmo número de chamadas, foi o que mais
aumentou a cobertura nos testes.

Resposta — onde estão os acórdãos (atenção, varia):
- `reranked_results` quando o reranqueamento rodou (pode faltar);
- senão `results` (STJ, TJs) **ou `juris` (STF)**.

Precedentes qualificados em listas próprias: `repetitivos`, `sumulas`, `sumulas_vinc`, `rg` / `rg_results`,
`puil`, `iacs`, e no TST `irrs`/`ojs`.

**`reranked_results` mistura tudo** (conferido em 2026-10-07): traz acórdãos **e** precedentes qualificados
numa lista só, cada item com `__kind` (`juris`, `sumula`, `repetitivo`, `puil`, `iac`, `rg`, `sv`) e
`original_bucket` (a lista de origem: `results`, `juris`, `sumulas`, `rg`…). Ler essa lista como "acórdãos"
faz súmula virar acórdão. O Garimpo usa dela só a ordem e o `rerank_score` dos itens cujo `original_bucket` é
`results`/`juris`. Vem junto um objeto `rerank` (`applied`, `candidateCount`, `fallbackUsed`…).

**O site só reranqueia os 20 primeiros de cada busca** (gravação de 2026-10-08: `rerank.rerankedCandidateCount: 20`
em todas as buscas fora do STF, de ~100 candidatos). Esses 20 vêm com `rerank_score`, de 0 a 1; os demais vêm só com
`score`, noutra escala (dezenas), que também muda de uma formulação ou tribunal para outro. As duas notas não se
comparam entre si, nem notas de buscas diferentes: por isso a busca ampla não ordena pela nota do site, e sim pela
posição na busca de origem (que já põe os reranqueados na frente).
Sem os extras do tribunal (`*_limit`, `qualified_strict`), o STJ devolve ~50 súmulas e ~50 repetitivos por busca,
pouco pertinentes; com eles, poucos e próximos da busca.

STF, campos próprios do acórdão: `sigla_classe` ("RE"), `numero_processo` só com o número (ex.: "123456"),
`link_consulta`, e, quando ligado a tema, `numero_tema`, `rg_descricao_tese`, `url_tema`, `url_acordao`.
Item de `rg`: `numero_tema`, `descricao_tese`, `sigla_classe`, `numero_processo`, `url_tema`.

TJPA, campo próprio do acórdão: `link_processo`, o link oficial de consulta no portal do tribunal
(`https://jurisprudencia.tjpa.jus.br/#/documento/<n>`, página de aplicativo JavaScript, sem PDF direto); veio em 23 de
23 registros na consulta de 2026-10-09, sem `link_pdf`. O Garimpo o lê como link de consulta. Não verificado em
outros tribunais.

Campos de um acórdão: `id`, `texto_ementa` (ementa inteira, 3–5 mil caracteres típicos), `numero_processo`,
`numero_processo_cnj`, `classe_processual`, `relator`, `orgao_julgador`, `data_julgamento`,
`data_publicacao_extraida`, `link_pdf`, `score`, `rerank_score`, `__kind`.
Campos de tema/súmula: `numero` ou `numero_tema`, `tese_firmada` ou `enunciado`, `link`, `link_acordao`,
`numero_processo_paradigma`, `orgao_julgador`.

Qualidade observada (amostra de ~300 itens):
- STJ: ~90% dos `numero_processo` sem a classe (ex.: "1.234.567/SP") e `classe_processual` nulo.
- STF: ~44% sem link; algumas ementas vazias.
- TJGO: completo (CNJ, classe, câmara), mas ~2 meses de defasagem.
- Mesmo conjunto a cada repetição, **ordem variável** (reranqueamento por IA).
- Número de tema é por tribunal: "Tema 1199" no STJ é outro assunto que o Tema 1199 do STF.
- Busca pelo número do processo (STJ ou CNJ do TJGO) traz o próprio acórdão em 1º.

Desempenho: mediana ~1 s, pico ~7 s; 100/100 buscas OK numa bateria; 59 buscas em ~33 s com até 4
simultâneas sem recusa. Um 503 isolado em ~400 chamadas. O teto real **não** foi procurado.

## Outras rotas do site (não usadas no desenho inicial)

| Rota | Uso |
|---|---|
| `GET /api/jurisprudencia-link?tribunal=&id=` | devolve `{"link": ...}` — o mesmo link oficial (400 no TST) |
| `POST /api/tribunais/{trib}/similar` `{texto, excludeId}` | acórdãos semelhantes; 422 = tribunal sem suporte |
| `GET /api/tribunais/{tjmsp,tjmrs,tjrn}/integra/{id}` | íntegra (url ou base64) desses tribunais |
| `POST /api/extrair-temas` `{texto}` | extrai temas de um texto |
| `POST /api/chat-jurisprudencia/session` + `POST /api/chat-jurisprudencia` | modo IA conversacional (stream SSE, ~16 s). O texto gerado **não é fonte**. Fora do escopo do Garimpo |

## Inteiro teor oficial, por tribunal

| Tribunal | `link_pdf` do site | Caminho que funcionou | Garimpo |
|---|---|---|---|
| **STJ** | `scon.stj.jus.br/SCON/GetInteiroTeorDoAcordao?...` → 403 (Cloudflare "managed"; nem navegador disfarçado passa) | Revista Eletrônica, com cookie de sessão, em 3 passos (abaixo) — PDF oficial, HTTP puro, <1 s | baixa |
| **STF** | `portal.stf.jus.br/jurisprudencia/obterInteiroTeor.asp?idDocumento=` → 202 (desafio AWS WAF, exige JavaScript) | só com navegador headless (redireciona para `redir.stf.jus.br/paginadorpub/...`, PDF) | link + explicação |
| **TJGO** | `projudi.tjgo.jus.br/ConsultaJurisprudencia?PaginaAtual=239&Id_Arquivo=` → "Sem Permissão (nº 239)" | nenhum automático: a pesquisa exige reCAPTCHA e o download só vale na sessão dela | link + explicação (pesquisar pelo CNJ no portal) |
| **TJMG** | `www5.tjmg.jus.br/jurisprudencia/relatorioEspelhoAcordao.do?inteiroTeor=true&...` | PDF direto | baixa |
| **TSE** | `sjur-servicos.tse.jus.br/sjur-servicos/rest/download/pdf/{id}` | PDF direto, mas **embrulhado num envelope multipart** (`--fronteira`, cabeçalhos `form-data`, PDF, `--fronteira--`) mesmo com `content-type: application/pdf` — é preciso desembrulhar. Em chamadas seguidas devolve "Excesso de requisições" (HTTP 200): recusou com 3 s e 8 s de intervalo, aceitou com 10 s (2026-10-07) | baixa, com pausa de 10 s |
| TJSP, TST, TJDFT | página de login/JavaScript | não investigado | link |
| TJTO | `jurisprudencia.tjto.jus.br/viewFileDoc.php?uuid=...` (visto em 2026-10-09) | download não testado | link (padrão; não verificado) |

**STJ em 3 passos** (mesma sessão de cookies; `num_registro` e `dt_publicacao` saem do `link_pdf`), conferido em 2026-10-07:
1. `GET https://processo.stj.jus.br/processo/revista/inteiroteor/?num_registro={reg}&dt_publicacao={DD/MM/AAAA}`
   — a página (ISO-8859-1) lista documentos em `AbreDocumento('...')`; o **1º** é o inteiro teor, os seguintes são
   peças (ementa/acórdão, relatório e voto, certidão). Há **dois formatos** de caminho:
   - julgamento eletrônico (recentes): `/processo/julgamento/eletronico/documento/mediado/?documento_tipo=integra&documento_sequencial={seq}&registro_numero={reg}&peticao_numero=&publicacao_data={AAAAMMDD}`;
   - revista (antigos, ex. 2012): `/processo/revista/documento/mediado/?componente=ITA&sequencial={seq}&num_registro={reg}&data={AAAAMMDD}`.
2. `GET` desse caminho `mediado` (com `Referer` da página do passo 1) → HTML com um `<iframe src=...>` que aponta o PDF:
   - eletrônico: `https://processo.stj.jus.br/processo/julgamento/eletronico/documento/?documento_tipo=integra&...`;
   - revista: `https://www.stj.jus.br/websecstj/cgi/revista/REJ.exe/ITA?seq={seq}&tipo=0&nreg={reg}&...&formato=PDF&salvar=false`.
3. `GET` do `src` do iframe (com `Referer` do passo 2) → `application/pdf`.
Sem o cookie da sessão o passo 3 devolve um HTML de 28 bytes. O Garimpo segue o iframe (vale para os dois formatos).
