# Changelog

## 0.4.0

Freios e transparência
- Página de bloqueio disfarçada de resposta normal e erro de parser (`HPE_*`) agora contam como recusa e acionam a pausa.
- Marca de pausa legível por máquina nas respostas (tipo, `liberadoEm`, `esperaSegundos`).
- Nova ferramenta `diagnostico_dos_freios` ("por que parou?"): lê o estado de proteção, sem chamar fonte nenhuma, e diz o que está pausado, até quando e se a recusa parece sistemática.
- Ordem fixa da lista de ferramentas e dicas de idempotência.

Leitura de PDF e HTML
- Leitura de PDF mais honesta: carimbo de origem, PDF misto (texto e imagem) e tetos declarados.
- Aviso quando o texto vindo de HTML traz trechos marcados como ocultos.

TRTs (Justiça do Trabalho)
- Quatro filtros nos TRTs, texto integral igual à ementa tratado e paginação do Falcão com conferências.

Busca
- Formulações com teto de 300 caracteres e espaços juntados.
- `busca_ampla` com `ordem: "data"`, estimativa de chamadas e tempo, motivo de falha por tribunal e teto de 25 mil caracteres sobre o texto final.
- Campos que faltam por acórdão (órgão, data, link) e aviso quando relator ou órgão não retorna resultado.
- Ressalva sobre a grafia da formulação.

DataJud
- Cliente mais defensivo diante de respostas inesperadas.

Precedentes e banco de provas
- Tabela de precedentes com trava de gravação e relatório de mudanças entre versões.
- Banco de provas: régua sem rede, 20 paradigmas das tabelas oficiais, teses em versão leiga e medição cega.

Conferência de citação
- Avisos de "quem disse" (órgão do fecho x órgão do registro e posição no julgado) construídos e **desligados** por padrão.

## 0.3.4

Versão anterior; veja o histórico do git.
