# Garimpo 1.0: mais fontes, leitura do acórdão e freios para proteger o seu IP

## Versão longa (LinkedIn / blog)

### Garimpo 1.0: mais fontes, leitura do acórdão e freios para proteger o seu IP

O Garimpo (pacote `garimpo-mcp`) é um servidor MCP local que permite à sua IA pesquisar jurisprudência brasileira em fontes públicas e baixar o inteiro teor oficial dos tribunais. A versão 1.0, de 14/10/2026, amplia as fontes e os tribunais com texto do acórdão, passa a mostrar a estratégia de pesquisa antes dos resultados, trata súmulas e temas com mais cuidado e reforça os freios de uso responsável dos sites.

**Novas fontes**

- TRF4: a busca vem da busca oficial do tribunal, com a ementa inteira, e o acórdão pode ser lido como "texto do portal do tribunal". Os filtros de período, relator, órgão e classe ainda não funcionam no TRF4, e a ferramenta avisa.
- TRF2 e TNU (na versão 1.1.0 do npm): a busca vem da busca oficial do e-Proc de cada um, com a ementa inteira e 10 acórdãos por busca, e o acórdão pode ser lido como "texto do portal do tribunal" (HTML, sem PDF e sem recibo; o Garimpo não confere a assinatura eletrônica). Na TNU, a lista não traz o órgão julgador, e os precedentes qualificados dela não são pesquisados (a resposta avisa que a lista vem vazia). No TRF2 também não há precedentes qualificados, e os filtros de período, relator, órgão e classe não funcionam. O TRF2 entra por decisão do dono do Garimpo de que a proibição de robôs da Resolução TRF2-RSP-2022/00032 não alcança o sistema de consulta de jurisprudência; não há autorização expressa do TRF2. Na TNU, o termo de uso do host não foi achado: o risco foi aceito pelo dono e segue "não verificado".
- TCU: acórdãos do Tribunal de Contas da União pelos arquivos anuais de dados abertos do próprio tribunal. Você escolhe os anos; antes de baixar, o Garimpo informa tamanho, tempo e pasta, e só baixa com a sua confirmação. A pesquisa roda no seu computador.
- Legislação: nova ferramenta `texto_de_lei`, com o texto literal de um dispositivo do CPC, do CC e da CF, tirado do portal oficial normas.leg.br, com URL, data e o aviso de que o Garimpo não afirma vigência. O CDC ainda não está disponível.
- TRTs: precedentes (súmulas, OJs, IRDR e IAC) sob pedido, busca ampla pelos 24 TRTs de uma vez e, só como metadados, decisões monocráticas e sentenças.

**Leitura do acórdão**

- TJDFT: o texto vem pela API pública do tribunal.
- TJMS e TJRR: o PDF é baixado pelo portal oficial, com recibo. No TJPI, o texto vem do portal do tribunal.
- Onde o inteiro teor continua só link (TJPA, TJRJ, TJSE, TJSC, STF e STJ), o Garimpo agora diz o motivo e a data em que ele foi conferido.

**Súmulas e temas: texto, situação e desgaste**

Perguntas sobre súmula ou tema têm resposta em ordem fixa: o texto e de onde veio, a situação (como a fonte informa, com data, ou "não verificado"), a força pelo art. 927 do CPC e a aplicação pelos tribunais. O possível desgaste do entendimento vem separado em três caixas: "a fonte indica", "indício" (que, expressamente, não prova superação) e "não verificado". "Vigente" e "superado" só aparecem dentro de citação literal da fonte.

**Respostas mais confiáveis**

- Estratégia antes dos resultados: a IA mostra a questão central e as formulações de busca que vai usar.
- Nova seção "onde a pesquisa está fraca": formulações sem acórdão, tribunais com erro ou não pesquisados, listas cortadas.
- `conferir_acordao_citado`: confere número, tribunal, data e órgão de um acórdão que você já tem citado. Diz "confirmado", aponta o que não bate ou diz "não verificado". Não prova que um acórdão não existe.
- `panorama_da_amostra`: conta por tribunal, ano e órgão o que a busca já trouxe. É contagem da amostra, não estatística do tribunal.
- Acórdãos em série (mesmo tribunal, órgão, relator e ementa) saem agrupados em uma linha.

**Mais segurança no uso dos sites**

O Garimpo respeita `robots.txt` e termos de uso e não troca de identidade nem contorna bloqueios. Na 1.0 há limites próprios por janela de tempo para fontes que não informam quanto resta, teto diário de 50 chamadas para a Justiça do Trabalho e leitura do saldo informado pelo TJDFT. Se o estado de proteção estiver ilegível, a rede para em vez de seguir adivinhando. Em consequência dessa postura, o STJ passa a ser só link: o `robots.txt` do portal veda o acesso automatizado e o Garimpo não consulta mais esse portal. Temas repetitivos e IAC do STJ respondem pela tabela datada que acompanha o pacote.

**Velocidade mantida**

Medido sem rede, em duas rodadas de 30, a 1.0 ficou igual à 0.5.0 nas operações medidas; só o início do servidor mostrou tendência de cerca de 0,1 s, dentro do ruído. O TCU é mais lento (de 7 a 19 segundos por pesquisa no arquivo de 2025), então convém baixar poucos anos.

**Limites que você precisa conhecer**

Sem texto do acórdão, só link: TST, TJPA, STF e os tribunais ainda não testados. Ficam fora por ora: TRF3, TRF5, TRF6 e o Banco Nacional de Precedentes do CNJ. No TRF4, a velocidade em relação ao STJ pelo JurisprudênciaIA não foi medida; no TRF2 e na TNU há só uma medida isolada do TRF2, sem comparação com outras fontes.

**Como instalar**

Com Node.js instalado, em um cliente com suporte a MCP, por exemplo:

`claude mcp add garimpo -- npx -y garimpo-mcp`

O pacote está no npm: https://www.npmjs.com/package/garimpo-mcp

**Avisos**

- O Garimpo é um cliente não oficial: não é afiliado ao JurisprudênciaIA, à JAI nem a nenhum tribunal.
- Os resultados são primeira camada de pesquisa e devem ser conferidos na fonte oficial antes de qualquer uso em peça ou parecer.
- Formule a busca com a tese em abstrato, sem nome de parte nem dado do caso.
- Licença MIT.

---

## Versão média (LinkedIn / Instagram / Facebook)

**Garimpo 1.0: mais fontes, leitura do acórdão e freios que protegem o seu IP**

O Garimpo (`garimpo-mcp`) é um servidor MCP local que permite à sua IA pesquisar jurisprudência brasileira em fontes públicas e baixar o inteiro teor oficial dos tribunais. A versão 1.0 saiu em 14/10/2026.

- Novas fontes: TRF4 (ementa inteira da busca oficial), TRF2 e TNU (mesma busca oficial do e-Proc; na versão 1.1.0 do npm; a TNU sem órgão julgador na lista) e TCU (você escolhe os anos; o Garimpo informa tamanho e tempo e só baixa com a sua confirmação).
- Nova ferramenta `texto_de_lei`: texto literal de dispositivo do CPC, do CC e da CF, do portal oficial normas.leg.br, sem afirmar vigência.
- Mais tribunais com o texto do acórdão: TJDFT, TJMS, TJRR e TJPI.
- Súmulas e temas com texto, situação e desgaste, este em três caixas: "a fonte indica", "indício" e "não verificado".
- A IA mostra a estratégia de busca antes dos resultados e aponta "onde a pesquisa está fraca" (formulações sem acórdão, tribunais com erro).
- `conferir_acordao_citado` confere número, tribunal, data e órgão de um acórdão que você já tem citado.
- Freios de uso responsável: o STJ virou só link, por respeito ao `robots.txt` do portal. Velocidade mantida em relação à 0.5.0.

Limites: TST, TJPA, STF, STJ e outros seguem só com link; TRF2 e TNU trazem o texto do portal sem PDF, sem precedentes qualificados; o TCU é mais lento (7 a 19 segundos por pesquisa).

Instalar (com Node.js): `claude mcp add garimpo -- npx -y garimpo-mcp`
https://www.npmjs.com/package/garimpo-mcp

Cliente não oficial, não afiliado ao JurisprudênciaIA, à JAI nem aos tribunais. Confira na fonte oficial. Licença MIT.

---

## Versão curta (X / Threads / WhatsApp)

Garimpo 1.0 no npm: servidor MCP gratuito (MIT) para a sua IA pesquisar jurisprudência e ler o inteiro teor oficial. Novo: TRF4, TCU, TRF2 e TNU (estes dois na versão 1.1.0), texto literal de artigos (CPC, CC, CF), mais tribunais com o acórdão, súmulas com texto, situação e desgaste, e freios que protegem o seu IP. STJ e alguns tribunais seguem só link. Cliente não oficial; confira na fonte oficial. npx -y garimpo-mcp
