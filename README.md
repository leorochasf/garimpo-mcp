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
| `busca_direta` | Uma busca num tribunal: acórdãos (até 100) e, em lista separada, precedentes qualificados (temas, súmulas). Filtros opcionais: período, relator, órgão, classe |
| `listar_tribunais` | Para cada tribunal: busca, precedentes qualificados, teto de resultados por busca e se o inteiro teor é baixado ou só linkado |

## Uso responsável (travas embutidas)

Toda chamada ao site passa por um cliente único que:

- faz **no máximo 2 chamadas simultâneas**;
- em recusa temporária (HTTP 429 ou 503), **espera e tenta uma única vez**; se recusar de novo, **para** e avisa;
- trata 403 e desafios anti-robô (Cloudflare, AWS WAF, reCAPTCHA) como recusa: **nunca contorna**, devolve o
  link para abrir no navegador;
- identifica-se com um User-Agent honesto (`Garimpo/<versão> …`).

Os termos de uso do site preveem limites por IP e bloqueio em caso de uso abusivo. Use com moderação.

## Instalação

Requer Node.js 18 ou mais novo.

```bash
git clone <endereço-do-repositório> garimpo-mcp
cd garimpo-mcp
npm install
npm run build
```

### Claude Code

```bash
claude mcp add garimpo -- node /caminho/para/garimpo-mcp/dist/index.js
```

### Claude Desktop

No arquivo `claude_desktop_config.json` (Configurações → Desenvolvedor → Editar configuração):

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

Reinicie o Claude e peça, por exemplo: *"Use o Garimpo para buscar no STJ acórdãos sobre responsabilidade
civil do Estado por omissão."*

## Limites conhecidos

- **STF:** no máximo 4 acórdãos por busca, qualquer que seja o limite pedido.
- **STJ:** a maioria dos números de processo vem sem a classe (ex.: `1.234.567/SP`).
- **TJGO:** dados completos, mas com cerca de 2 meses de defasagem.
- Mesma busca repetida traz o mesmo conjunto em **ordem variável** (o site reordena por IA).
- Não há TRFs, TCU nem tribunais de contas.

## Desenvolvimento

```bash
npm test          # testes sem rede, sobre respostas gravadas
```
