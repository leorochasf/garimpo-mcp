Garimpo-Jurídico: a sua IA pesquisa jurisprudência e confere a citação antes de ela ir para a peça ⛏️

O Garimpo (pacote garimpo-mcp) é um servidor MCP local. Ele dá à IA que você já usa (Claude, Codex, Antigravity) ferramentas para pesquisar jurisprudência brasileira em fontes públicas e baixar o inteiro teor oficial dos tribunais. Tudo roda no seu computador, sem conta e sem cadastro.

O que ele faz:
• Busca ampla: até 20 formulações da mesma tese em até 5 tribunais, numa lista única, sem repetidos (STF, STJ, TST, TSE, STM, TRF4, os 27 TJs e os 24 TRTs).
• Busca direta, com precedentes qualificados em lista própria e enquadramento no art. 927 do CPC.
• Ementa e inteiro teor lidos por partes, com origem e recibo quando o PDF é baixado do portal do tribunal.
• Conferência de citação: diz se o trecho está literalmente na ementa ou no inteiro teor, com página e seção.
• Conferência do acórdão que você já tem citado: número, tribunal, data e órgão.
• Acompanhamento do processo pelo número CNJ (DataJud e DJEN).
• Súmulas e temas: texto, situação como a fonte informa e o possível desgaste do entendimento, separado em "a fonte indica", "indício" e "não verificado".
• Fontes extras: TRF4, acórdãos do TCU (você escolhe os anos) e texto literal de artigo do CPC, do CC e da CF.
• Roteiro de pesquisa: a IA mostra a estratégia antes dos resultados e aponta "onde a pesquisa está fraca".
• Memória local de 24 h das buscas e freios de uso responsável.

Princípios: não afirma jurisprudência sem fonte devolvida; o que não confere vira "não verificado"; citação é literal ou não é citação. Respeita robots.txt e termos de uso e não contorna bloqueio.

Limites: em alguns tribunais (como STJ, STF e TST) o inteiro teor é só link. Não substitui a leitura do acórdão nem o juízo de quem assina a peça.

Instalar (com Node.js 22.13 ou mais novo):
claude mcp add garimpo -- npx -y garimpo-mcp
https://www.npmjs.com/package/garimpo-mcp

Cliente não oficial: não é afiliado ao JurisprudênciaIA, à JAI nem aos tribunais. Confira sempre na fonte oficial. Gratuito, licença MIT.
