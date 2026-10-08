# Sem OCR: página sem texto extraível vira aviso, não texto adivinhado

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

Quando uma página do PDF não tem texto extraível, o Garimpo avisa ("sem texto extraível; pode ser escaneada")
por página e, se for o PDF inteiro, no topo da resposta. Não faz OCR (ler texto de imagem). Motivo: o OCR exige
programa pesado (ex.: Tesseract), é lento e erra em texto jurídico, e para quem vai citar, um texto com erro é
pior que nenhum. Uma falha na extração é erro de leitura explícito, com o PDF e o recibo preservados, nunca
"PDF sem conteúdo".

## Opções consideradas

- OCR embutido: rejeitado pelo esforço, pela lentidão e pelos erros. Uma proposta futura precisa de medição
  própria no banco de provas.
