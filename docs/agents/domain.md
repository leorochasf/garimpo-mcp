# Documentos de domínio

Como as skills de engenharia consultam a documentação de domínio deste repositório.

## Antes de explorar, ler

- **`CONTEXT.md`** na raiz: o glossário do Garimpo (contexto único).
- **`docs/adr/`**: os ADRs que tocam a área em que se vai mexer.

Se algum não existir, **seguir em silêncio**. Não apontar a falta nem sugerir criar de antemão: o
`/domain-modeling` (via `/grill-with-docs`) cria esses arquivos quando um termo ou uma decisão se resolve.

## Estrutura

```
/
├── CONTEXT.md
├── docs/adr/
│   └── 0001-<slug>.md
└── src/
```

## Usar o vocabulário do glossário

Ao nomear um conceito do domínio (título de ticket, proposta, hipótese, nome de teste), usar o termo do
`CONTEXT.md`, nunca os sinônimos que ele manda evitar. Conceito que falta no glossário é sinal: ou a linguagem
está sendo inventada (repensar) ou há uma lacuna real (anotar para o `/domain-modeling`).

## Apontar conflito com ADR

Se a saída contradiz um ADR existente, dizer explicitamente em vez de passar por cima:

> _Contradiz o ADR-0003 (…), mas vale reabrir porque…_
