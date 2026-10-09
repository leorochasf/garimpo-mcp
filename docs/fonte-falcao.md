# Fonte: Falcão (CSJT) — termos de uso e regras de acesso

Registro exigido pelo ADR-0017 ("termos de uso (ou a falta deles) e as regras de acesso [...] lidos e registrados em
`docs/`, com data e link") antes de o Falcão entrar no código (B12, ticket 01). Consulta feita em **2026-10-09**.
Formato da rota e resultado da prova ao vivo: [`banco-de-provas/b12-prova-ao-vivo.md`](banco-de-provas/b12-prova-ao-vivo.md).

## O que é a fonte

Res. CSJT n. 401/2024, art. 1º: "O Sistema de busca de jurisprudência, denominado Falcão, constitui repositório
oficial de jurisprudência dos órgãos da Justiça do Trabalho de primeiro e segundo graus [...]". Endereço:
https://jurisprudencia.jt.jus.br/ (fonte: https://juslaboris.tst.jus.br/handle/20.500.12178/242856, lida em
2026-10-09 na entrevista do B12).

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

## Regras de acesso observadas (2026-10-09)

- Sem User-Agent de navegador: HTTP 403 (WAF/CloudFront), já na página inicial e na API.
- API da pesquisa sem login: até 200 documentos por busca (manual do TRT9); `size` 10.
- Cabeçalho `x-rate-limit-remaining` só nas respostas da API (não nas páginas e arquivos do site). Comportamento
  medido na prova ao vivo: ver [`banco-de-provas/b12-prova-ao-vivo.md`](banco-de-provas/b12-prova-ao-vivo.md).
- 429 (bloqueio por horas, segundo o juscraper, MIT) **não** foi provocado nem observado.
