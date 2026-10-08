# Garimpo

Servidor MCP local (stdio) para pesquisar jurisprudência brasileira pela **busca direta** do
[JurisprudênciaIA](https://www.jurisprudenciaia.com.br) e baixar o **inteiro teor oficial** dos tribunais.
Devolve dados crus e verificáveis (ementa inteira, número, órgão, data, link oficial); quem interpreta é a IA
de quem usa.

> **Cliente não oficial.** O Garimpo não é afiliado ao JurisprudênciaIA nem à JAI. A API usada não é
> documentada e pode mudar sem aviso. Licença MIT.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `busca_direta` | Uma busca num tribunal: acórdãos (até 100) e, em lista separada, precedentes qualificados (temas, súmulas). Filtros opcionais: período, relator, órgão, classe. No campo `cabecalhoDeCobertura`, uma linha diz se o site devolveu o número pedido de registros (pode haver mais: aumente o limite ou use a busca ampla) ou menos (a base não tem mais para este texto e os filtros; no STF, que devolve poucos por busca, pode haver mais) |
| `busca_ampla` | Várias formulações da mesma tese em um ou mais tribunais (até 20 formulações e 5 tribunais), juntadas numa lista única de acórdãos: **sem repetidos** (o mesmo acórdão achado por buscas diferentes, ou guardado em dois registros na base do site, vira um acórdão só); ordenada pela **aderência** (palavras de alguma formulação presentes na ementa), depois por quantas formulações acharam cada acórdão e pela melhor posição na busca de origem; com **vagas por tribunal** (cada tribunal pedido que tenha acórdão na faixa mais alta de aderência tem até 3 vagas garantidas na lista). Saída compacta, 50 acórdãos por padrão (até 200): número, tribunal, data, órgão, **trecho** da ementa onde a tese aparece, link. Em lista própria, até 10 **precedentes qualificados** (temas, súmulas) que o site devolveu, sem repetidos. No campo `cabecalhoDeCobertura`: por tribunal, buscas feitas, vazias, com erro e não feitas (recusa no meio), acórdãos achados e mostrados (tribunal em que nenhuma busca deu resposta aparece "com erro" ou "não pesquisado", nunca "0 achados"); as formulações que não trouxeram nenhum acórdão em nenhum tribunal; e, quando a lista foi cortada pelo máximo, "mostrando X de Y". Se nenhuma busca deu resposta (recusa ou outro erro), a ferramenta responde com **erro** e o motivo de cada busca, nunca com lista vazia |
| `obter_ementa` | Ementa inteira de um acórdão já devolvido nesta sessão, pelo id, sem nova busca no site |
| `obter_inteiro_teor` | Baixa o PDF oficial do portal do tribunal (STJ, TJMG, TSE) e devolve o caminho do arquivo e o sha256. Ao lado do PDF grava o recibo de origem (`.recibo.txt`: link oficial, data e hora, sha256; declaração do Garimpo, não certidão). Recusa PDF acima de 50 MB e nunca deixa arquivo pela metade. Já devolve a **1ª parte** do texto, com o mesmo cabeçalho do `ler_inteiro_teor` e a chamada pronta para a parte seguinte. Se, num caso extremo (pasta ou link muito longos), a 1ª parte não couber no teto junto com os dados do download, vem um aviso e a chamada pronta para lê-la com o `ler_inteiro_teor`. Com `texto: false`, devolve só o caminho, o recibo e o total de páginas do PDF, sem extrair o texto (para baixar vários e ler depois, economizando tokens). Se o PDF salvo não puder ser lido ou contado, o download continua valendo e vem o motivo ("total de páginas não disponível" ou o erro de leitura), nunca um número inventado. STF, TJGO e demais: devolve o link e explica como obter no navegador |
| `ler_inteiro_teor` | Lê, pelo caminho do arquivo, o PDF que o `obter_inteiro_teor` baixou e devolve uma **parte** do texto (cerca de 8 mil tokens estimados, feita de páginas do PDF inteiras; página grande demais vem em segmentos, com a continuação indicada). Cada parte traz o mesmo cabeçalho: tribunal, número, data, link oficial, sha256, id, nome do arquivo, origem e "páginas X–Y de N (parte P de T)" (páginas do PDF, não folhas dos autos), com "não informado" no que faltar, e a chamada pronta para a parte seguinte. Origem **conferida** só quando o recibo de origem ao lado do PDF é reconhecido, registra download pelo Garimpo e tem o mesmo sha256 do arquivo; senão, **não conferida**, com o motivo (sem recibo, recibo de formato desconhecido, PDF alterado depois do download). Página sem texto extraível é avisada ("pode ser escaneada"; não há OCR); PDF que o extrator não consegue ler é erro de leitura. Não grava, não copia e não chama a rede |
| `listar_tribunais` | Para cada tribunal: busca, precedentes qualificados, teto de resultados por busca e se o inteiro teor é baixado ou só linkado |

As respostas de `busca_direta`, `busca_ampla` e `obter_ementa` trazem, no campo `avisoNaturezaJuridica`, a linha
"Resultado de busca em base não oficial. Confira o acórdão no link oficial do tribunal antes de citar; a ementa não
substitui o inteiro teor."

Tribunal inválido e data fora do formato recebem uma frase em português que diz como corrigir: as siglas válidas;
"use AAAA-MM-DD". Na `busca_ampla`, `formulacoes` e `tribunais` aceitam lista, texto
de lista JSON (`"[\"a\", \"b\"]"`) ou texto solto, que vale como **um** item só: o texto nunca é partido por
vírgula, para que uma formulação como "art. 37, § 6º" chegue inteira.

`busca_direta`, `busca_ampla`, `obter_ementa`, `ler_inteiro_teor` e `listar_tribunais` são declaradas ao cliente como
ferramentas que só leem (as duas buscas, como ferramentas que consultam serviço externo); `obter_inteiro_teor` não, porque grava
o PDF no disco. Cabe a cada cliente decidir se usa essa marca para dispensar o pedido de permissão.

## Uso responsável (travas embutidas)

Toda chamada ao site passa por um cliente único que:

- faz **no máximo 2 chamadas simultâneas no total** (JurisprudênciaIA e tribunais somados);
- em recusa temporária (HTTP 429 ou 503), **espera e tenta uma única vez**; se recusar de novo, **para** e avisa;
- trata 403 e desafios anti-robô (Cloudflare, AWS WAF, reCAPTCHA) como recusa: **nunca contorna**, devolve o
  link para abrir no navegador;
- identifica-se com um User-Agent honesto (`Garimpo/<versão> …`).

Os termos de uso do site preveem limites por IP e bloqueio em caso de uso abusivo. Use com moderação.

## Instalação

Requer **Node.js 22.13 ou mais novo** (o leitor de PDF, `pdfjs-dist`, exige essa versão). Confira com
`node --version`; se aparecer uma versão mais antiga (por exemplo, `v20.x`), instale a versão LTS atual em
[nodejs.org](https://nodejs.org/) (ou, se usa um gerenciador de versões, `nvm install --lts` / `fnm install --lts`)
e reinicie o cliente MCP.

### Pelo npm (recomendado)

Não precisa baixar nada: o `npx` busca o pacote [`garimpo-mcp`](https://www.npmjs.com/package/garimpo-mcp)
na primeira execução. Se preferir instalar de vez: `npm install -g garimpo-mcp` (o comando passa a ser
`garimpo-mcp`).

**Claude Code**

```bash
claude mcp add garimpo -- npx -y garimpo-mcp
```

**Claude Desktop** — no arquivo `claude_desktop_config.json` (Configurações → Desenvolvedor → Editar configuração):

```json
{
  "mcpServers": {
    "garimpo": {
      "command": "npx",
      "args": ["-y", "garimpo-mcp"]
    }
  }
}
```

No Windows, se o Claude Desktop não achar o `npx`, use `"command": "cmd"` e
`"args": ["/c", "npx", "-y", "garimpo-mcp"]`.

### Pelo código-fonte

```bash
git clone https://github.com/leorochasf/garimpo-mcp.git
cd garimpo-mcp
npm install
npm run build
```

**Claude Code**

```bash
claude mcp add garimpo -- node /caminho/para/garimpo-mcp/dist/index.js
```

**Claude Desktop**

```json
{
  "mcpServers": {
    "garimpo": {
      "command": "node",
      "args": ["/caminho/para/garimpo-mcp/dist/index.js"]
    }
  }
}
```

### Pasta dos PDFs

Os PDFs são salvos na pasta indicada no pedido; sem pasta, em `Garimpo/inteiro-teor` dentro da pasta do usuário
(ou na pasta da variável de ambiente `GARIMPO_PASTA`).

Reinicie o Claude e peça, por exemplo: *"Use o Garimpo para buscar no STJ acórdãos sobre responsabilidade
civil do Estado por omissão."*

## Limites conhecidos

- **STF:** poucos acórdãos por busca, qualquer que seja o limite pedido (de 2 a 7 na medição de 2026-10-08); na
  busca ampla, a cobertura do STF depende do número de formulações.
- **STJ:** a maioria dos números de processo vem sem a classe (ex.: `1.234.567/SP`).
- **TJGO:** dados completos, mas com cerca de 2 meses de defasagem.
- Mesma busca repetida traz o mesmo conjunto em **ordem variável** (o site reordena por IA).
- **Busca ampla:** aderência mede proximidade de texto com a formulação, não relevância jurídica. A nota de
  relevância do site não entra na ordem: o site só reranqueia os primeiros de cada busca e dá aos demais uma nota
  de outra escala. Para caber numa resposta, a saída mostra um trecho de ~120 caracteres de cada ementa, onde mais
  palavras da formulação mais aderente aparecem juntas (sem nenhuma, o começo da ementa, sem o rótulo "Ementa:"),
  e 200 do texto de cada precedente qualificado; a ementa inteira sai por `obter_ementa`. A lista de
  precedentes qualificados só traz o que o site devolve: há teses com tema conhecido em que ela vem vazia.
- **Inteiro teor:** STF (proteção anti-robô), TJGO (reCAPTCHA) e os demais tribunais não são baixados
  automaticamente: o Garimpo devolve o link e explica como obter no navegador.
- **TSE:** downloads seguidos esperam 10 s entre si (o portal recusa chamadas em sequência).
- Não há TRFs, TCU nem tribunais de contas.

## Desenvolvimento

```bash
npm test          # testes sem rede, sobre respostas gravadas
```
