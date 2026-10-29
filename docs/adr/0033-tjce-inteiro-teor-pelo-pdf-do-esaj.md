# TJCE: inteiro teor pelo PDF oficial do eSAJ

_Proposto pelo Claude em 2026-10-29, a partir da leitura do mesmo dia (matriz ao vivo dos TJs) e do desenho dos 27 tribunais estaduais. O número desta ADR é provisório: o Integrador confere a sequência ao juntar._

O TJCE tinha busca pelo JurisprudênciaIA e inteiro teor «só link», com a explicação genérica «ainda não testou». A leitura
de 2026-10-29 mostrou que o link que vem da busca (`esaj.tjce.jus.br/cjsg/getArquivo.do?cdAcordao=<n>&cdForo=0`) entrega o
PDF do acórdão por GET comum, sem login nem captcha. Caso avaliado pelo critério do caminho legítimo sem proteção a vencer
(o mesmo das ADR-0029 e ADR-0030).

## O que foi lido e provado (2026-10-29)

- `esaj.tjce.jus.br/robots.txt`: HTTP 404 (página de erro do servidor) → nenhuma regra publicada. Lido em chamada separada,
  antes do link.
- Link do acórdão (1 GET): HTTP 200, `application/pdf;charset=UTF-8`, `Content-Disposition: inline`, 716 192 bytes, PDF de
  5 páginas, sem login, captcha ou bloqueio.
- Contraste: o mesmo desenho de endereço pede captcha no TJAL, TJAM e TJAC; é configuração do eSAJ de cada tribunal.
- Conferido pelo Rede (2 acórdãos, PDFs de 5 e 19 páginas, HTTP 200, sem captcha nem login): o cabeçalho «Processo:» da
  primeira página é o número do registro da busca. O PDF de 19 páginas cita outros 6 CNJs no corpo.
- Prova ao vivo curta pelo cartão Rede: pendente.
- **Termos de uso (lidos pelo Rede em 2026-10-29, ~15:40):** a «Política de Privacidade para Navegação no Portal do TJCE»
  (`https://www.tjce.jus.br/lgpd/politica-de-navegacao-no-portal-do-tjce/`) não traz cláusula sobre robôs, crawlers, scraping
  ou coleta automatizada; a página da pesquisa eSAJ não traz termo. Limite do método: lido por ferramenta que resume, e
  «não encontrado» não prova inexistência de outro texto. Sem vedação encontrada ≠ autorização.
- Não verificado: limite de ritmo; redirecionamentos; que o PDF seja sempre o acórdão assinado inteiro.

## Decisões

- **Inteiro teor do TJCE = PDF oficial** (modo `baixa`, como TJMG, TJMS, TJRR, TSE): um GET no link da busca pelo Cliente
  único (freios da regra 3, disjuntor do serviço `tjce`), UA honesto. Só `https` em `esaj.tjce.jus.br`, caminho
  `/cjsg/getArquivo.do`, `cdAcordao` numérico. Redirecionamento validado host a host (até 5), como `baixarDireto`.
- **Reuso, não código novo de download**: `baixarDireto(cliente, link, "esaj.tjce.jus.br", "TJCE")`. É a mais estrita
  das opções (host exato); `baixarEsaj` (TJSP/TJMS) aceita subdomínios e supõe a volta pelo login, que o TJCE não faz.
- **PDF reconhecido**: começa por `%PDF`, até 50 MB. Recibo de origem (URL final, sha256, data), «já na pasta» e leitura
  pelo caminho vêm do modo `baixa`.
- **Guarda do documento certo (novo para PDF, só TJCE)**: depois de baixar, o Garimpo extrai o texto do PDF e confere o
  cabeçalho «Processo: <CNJ>» da PRIMEIRA página física (região antes de EMENTA, ACÓRDÃO, RELATÓRIO ou VOTO, nos primeiros 300 caracteres; primeira página sem texto = recusa; dois números diferentes no cabeçalho = recusa) com o número CNJ do processo do registro da busca (máscara
  ou só dígitos). **Não vale qualquer ocorrência do número no texto**: o PDF de 19 páginas observado cita outros 6 CNJs
  no corpo (precedentes). Cabeçalho ausente, diferente do registro, ou registro da busca sem número do processo: **nada é
  guardado** e a resposta diz «texto não verificado: o PDF não traz, no cabeçalho, o número do processo da busca». PDF sem
  camada de texto cai no mesmo caso. Mesma lógica da troca de íntegra do TJPR (ADR-0030), aplicada ao PDF.
  Observado em 29/10 nos 2 PDFs gravados (5 e 19 páginas): «Processo: <CNJ> – Apelação Cível» no começo, igual ao número
  do registro da busca; EMENTA, ACÓRDÃO, RELATÓRIO e VOTO presentes.
  Proposta, fora deste ADR: estender a guarda a TJMG, TJMS, TJRR e TSE muda comportamento existente; seria ticket próprio.
- **Rótulo**: PDF oficial do tribunal, com recibo; não é «texto do portal».
- **Tabela**: `inteiroTeor: "baixa"`, sem motivo de só link (`SEM_MOTIVO`); `listar_tribunais` e `garimpo://tribunais` passam
  a dizer «baixado pelo Garimpo».
- **Freios**: serviço `tjce` no disjuntor; 403, captcha ou desafio = recusa final, sem nova tentativa (o Cliente reconhece, só no TJCE, a instrução «digite o código da figura» do eSAJ como página de desafio, mesmo sem título); 429/503 seguem a
  regra geral (espera e UMA nova tentativa).
- **Cópia da base com a classe errada** (3 de 3: «Agravo Interno em Recurso Especial em Apelação Cível» onde a ementa diz
  «Apelação Cível»): problema de dados da base, não deste ADR; fica registrado para o ticket de ementa/classe.

## Alternativas consideradas

- Manter só link: deixa de entregar um PDF que o tribunal publica aberto.
- `baixarEsaj` (TJSP/TJMS): mais permissivo (subdomínios) e preparado para o login que o TJCE não pede.
- Aceitar qualquer ocorrência do número no texto: falha com PDFs que citam precedentes (visto: 6 outros CNJs).
- Aceitar o PDF sem conferir o número do processo: o portal e a base já entregaram documento trocado em outros tribunais;
  a conferência custa uma extração de texto local.
- Estender a conferência do número a todos os PDFs já existentes: maior, fora do escopo.

## Consequências

- O TJCE passa a «completo»: `obter_inteiro_teor` baixa e dá recibo; `ler_inteiro_teor` e `conferir_citacao` funcionam.
- Se o eSAJ do TJCE passar a pedir captcha ou bloquear, o serviço pausa em todas as janelas e o tribunal volta a «só link»
  com o motivo datado, sem contornar.
- Não há autorização do TJCE; o termo de uso lido (acima) não veda robô, o que não equivale a autorização.
