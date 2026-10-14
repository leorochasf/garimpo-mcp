# Fonte: Falcão (CSJT) — termos de uso e regras de acesso

Registro exigido pelo ADR-0017 ("termos de uso (ou a falta deles) e as regras de acesso [...] lidos e registrados em
`docs/`, com data e link") antes de o Falcão entrar no código (B12, ticket 01). Consulta feita em **2026-10-09**.
Formato da rota e resultado da prova ao vivo: [`banco-de-provas/b12-prova-ao-vivo.md`](banco-de-provas/b12-prova-ao-vivo.md).

## O que é a fonte

Res. CSJT n. 401/2024, art. 1º: "O Sistema de busca de jurisprudência, denominado Falcão, constitui repositório
oficial de jurisprudência dos órgãos da Justiça do Trabalho de primeiro e segundo graus [...]". Endereço:
https://jurisprudencia.jt.jus.br/ (fonte: https://juslaboris.tst.jus.br/handle/20.500.12178/242856, lida em
2026-10-09 na entrevista do B12).

## Coleção `precedentes` (I-26, prova de 2026-10-14)

A mesma rota pública de pesquisa aceita `colecao=precedentes`. A prova já registrada pelo executor fez duas
chamadas pelo Cliente único, ambas HTTP 200: uma no TRT3 (IRDR de origem BNP) e uma no TST (IRR de origem BNP e
súmula de origem TST). O Garimpo continua buscando o TST pelo JurisprudênciaIA. Este registro não é uma nova
consulta à fonte.

Na `busca_direta` de um TRT, `precedentes:true` pede uma página adicional de até 10 itens do mesmo tribunal, só
com o texto da busca. Filtros, `somenteEmentas` e ordenação continuam restritos aos acórdãos. A chamada passa
pelo mesmo Cliente e consome o mesmo teto diário. Sem a opção, o comportamento anterior continua.

A origem BNP traz `categoria`, `numero`, `situacao.descricao`, `dataSituacao`, `questao`, `tese` e
`processosParadigma`; a súmula observada traz `tipo: SUMULA` e `conteudoDecisao`. Questão submetida ou conteúdo
de decisão de um incidente não é tese. A situação é literal, acompanhada da data quando informada; sem data,
a ausência é declarada, e sem situação o resultado diz "não verificado". Não prova vigência ou aplicabilidade.
Nenhum desses itens recebe inciso do art. 927 pela regra atual do ADR-0007; o âmbito do IRDR é condicional.

Não foram observados ao vivo súmula, OJ nem IAC de TRT. Cobertura por TRT, frescor, filtros e paginação da
coleção não foram verificados. A fixture dos testes é sintética e declara essas limitações.

## Termos de uso

**Onde:** o rodapé da versão do sistema em produção em 2026-10-09 (**2.15.3**) tem um só item de termos,
"Privacidade e Termos de Uso", que abre a página
[https://jurisprudencia.jt.jus.br/jurisprudencia-nacional/sobre/privacidade](https://jurisprudencia.jt.jus.br/jurisprudencia-nacional/sobre/privacidade)
(aplicação de página única; o texto vem no módulo `399.a962c78f16c46e7d.js` do próprio site). Não há, nessa versão,
item separado "Termo de responsabilidade" no rodapé (o manual do TRT9 o citava; versão anterior, **não verificado**).

**Texto literal** (a seção "Controle de Acessos Automatizados (Bots)" está inteira; nas demais, omissões marcadas com [...]; a grafia
"Juriprudência" e "extritamente" é da fonte):

> **Privacidade** — "O Sistema de Pesquisa de Juriprudência garante a privacidade dos dados dos seus usuários como
> também da base de dados utilizada nas consultas."
>
> **Anonimização dos dados** — [...] "Os dados utilizados para a pesquisa são pseudonimizados, ou seja, a pesquisa utiliza
> uma base de dados onde as informações pessoais foram removidas. Dessa forma, mesmo que alguém realize a pesquisa com
> o nome de uma pessoa, tal pesquisa não levará em consideração informações pessoais."
>
> **Localização** — "O Sistema de Pesquisa de Juriprudência solicita ao usuário o compartilhamento de sua localização
> para fins estatísticos.
> Dados como Latitude e Longitude são armazenados e, consequentemente, é possível obter informações sobre a Cidade,
> Estado e País."
>
> **Cookies** — "Usamos cookies neste site para melhorar a sua experiência de usuário.
> Os cookies são utilizados extritamente para melhoria da experiência de navegação e não possuem a
> possibilidade de associação direta, ou indireta, a um indivíduo. Geramos um código aleatório para distinguir as
> requisições dos usuários."
>
> **Controle de Acessos Automatizados (Bots)** — "O excesso de requisições, embora parte desse tráfego possa ter
> finalidade legítima, impacta diretamente a estabilidade, o desempenho e a disponibilidade dos serviços oferecidos
> aos usuários.
> Diante desse cenário, este tribunal entende que possui a responsabilidade de adotar medidas de monitoramento,
> controle e bloqueio de acessos considerados abusivos ou excessivos, especialmente quando tais acessos possam
> comprometer a segurança, a integridade das informações ou a experiência dos demais usuários da plataforma.
> Entre as medidas que poderão ser aplicadas, destacam-se:
> Limitação de quantidade de requisições por origem;
> Bloqueio temporário ou definitivo de IPs e agentes automatizados;
> Implementação de mecanismos de validação e proteção contra acessos não humanos;
> Monitoramento contínuo de padrões de tráfego considerados anormais;
> Aplicação de regras de segurança para preservar a disponibilidade do ambiente.
> Essas ações têm como objetivo garantir a continuidade, segurança e qualidade dos serviços disponibilizados pela
> plataforma, preservando o uso adequado e equilibrado dos recursos tecnológicos."

(As seções "Anonimização" e "Cookies" também citam a LGPD, art. 5º, XI, e art. 13, § 4º; omitidas aqui por serem
transcrição da lei, não regra do sistema.)

## Leitura (não é parecer)

- **Não há proibição expressa** de acesso automatizado nem de reuso do conteúdo. O texto reconhece que parte do
  tráfego automatizado "possa ter finalidade legítima" e reserva ao tribunal medidas contra acessos "considerados
  abusivos ou excessivos": limite por origem, bloqueio temporário ou definitivo de IPs e de agentes automatizados,
  "mecanismos de validação e proteção contra acessos não humanos".
- Logo, pela política do dono (contorno e UA de navegador permitidos; parar só diante de proibição expressa), o
  ticket 01 **não** vai a "pendente do dono", e os tickets 02+ ficam destravados.
- **Ponto para o dono saber** (não bloqueia): o 403 ao User-Agent honesto é um desses "mecanismos [...] contra
  acessos não humanos", e o UA de navegador do B12 passa por ele. O risco que os termos anunciam é **bloqueio**
  (temporário ou definitivo) por excesso — daí o freio preventivo, o intervalo de 1 s e os tetos do spec.
- Nada nos termos sobre licença de reuso do conteúdo; o texto das decisões é ato oficial público. Sem afirmação além
  disso (**não verificado**).

## Como o Garimpo se identifica no Falcão

O Falcão recusa programas que não se apresentam como navegador (HTTP 403 ao User-Agent honesto do Garimpo, 2026-10-09).
Pela política do dono (ADR-0018), o Garimpo usa ali, **e só ali**, um User-Agent de navegador fixo por versão
(`UA_NAVEGADOR` em `src/cliente.ts`), com `Origin`/`Referer` do próprio site e `Accept` JSON; o JurisprudênciaIA e
os portais dos tribunais continuam recebendo o User-Agent honesto (`Garimpo/<versão> …`). Tudo passa pelo Cliente
único, com os freios da regra 3, mais: 1 s entre chamadas ao Falcão em todas as janelas; espera pedida em
`x-rate-limit-retry-after-seconds` acima de 30 s = recusa final, sem nova tentativa, com pausa de pelo menos o prazo
pedido; 403 do firewall (HTML) e 403 do sistema (JSON com `userMessage`) = recusa final, e a `userMessage` vai ao
usuário como texto externo limpo (sem HTML, endereços, e-mails, números longos nem códigos que possam ser segredo).

## Regras de acesso observadas (2026-10-09)

- Sem User-Agent de navegador: HTTP 403 (WAF/CloudFront), já na página inicial e na API.
- API da pesquisa sem login: até 200 documentos por busca (manual do TRT9); `size` 10.
- Cabeçalho `x-rate-limit-remaining` só nas respostas da API (não nas páginas e arquivos do site). Comportamento
  medido na prova ao vivo: ver [`banco-de-provas/b12-prova-ao-vivo.md`](banco-de-provas/b12-prova-ao-vivo.md).
- 429 (bloqueio por horas, segundo o juscraper, MIT) **não** foi provocado nem observado.
- Por isso o Garimpo tem também um teto diário próprio (50 chamadas por dia de Brasília, todas as janelas somadas,
  mesmo com restante informado alto; ADR-0018, adendo B16). O número é conservador e **não** foi medido.

## Decisões monocráticas e sentenças (I-29, prova de 2026-10-14)

A mesma rota de pesquisa aceita `colecao=decisoesmonocraticas` e `colecao=sentencas`. A `busca_direta` de um TRT as
oferece só pela opção `decisoes`, com metadados e sem texto; formato, prova e limites em
[`fontes.md`](fontes.md#falcão-decisões-monocráticas-e-sentenças-dos-trts-i-29--g-38). Chamadas dessa opção contam no mesmo
teto diário.

## PDF com QR-code (I-28 / G-30): rota não encontrada

Em 2026-10-14 a rota do PDF não foi provada: nenhuma chamada foi gasta nela. Registro de terceiro (prc_jur_crawler, sem
licença; lido como referência, nada copiado) afirma que, varridos os 18 pedaços do aplicativo do site, os únicos
endereços `no-auth` são `/pesquisa`, `/pesquisa/filtros` e `/autocompletar`, sem endereço por documento; o PDF do manual
pode ser montado no navegador ou exigir login. **Não verificado pelo Garimpo.** Sem rota pública conhecida, o texto do
Falcão continua "texto integral do repositório oficial", sem PDF.

