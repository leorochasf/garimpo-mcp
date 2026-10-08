# O recibo ao lado do PDF é a fonte da origem; a leitura não grava nada

_Decidido pelo GPT Sol (gpt-6.1-sol, medium), delegado do dono, em 2026-10-08 — sujeito a revisão do dono._

A leitura do inteiro teor como texto é sempre pelo caminho do arquivo. Ela não grava, não copia e não chama a
rede. Os dados do cabeçalho vêm do recibo de origem gravado ao lado do PDF no download. O PDF só é tratado como
de origem conferida se o recibo tiver formato reconhecido, registrar download pelo Garimpo e trouxer o mesmo
sha256 do arquivo atual. Em qualquer outro caso (sem recibo, recibo inválido, sha256 diferente, PDF trazido pelo
usuário), a origem é não conferida, com aviso específico, e os dados antigos aparecem no máximo como vínculo
declarado. Motivo: a memória da busca some entre sessões, e o índice de PDFs (V2) só vem no bloco B3; o recibo
basta e impede que um PDF alterado ou de terceiro passe por oficial. A ferramenta continua "só leitura" e não
espalha arquivos na pasta do usuário.

## Opções consideradas

- Copiar o PDF trazido para a pasta do Garimpo e gravar recibo "origem declarada": rejeitada, porque a cópia
  ganharia aparência de recibo de download e a ferramenta deixaria de ser só leitura.
- Gravar recibo ao lado do arquivo do usuário, onde quer que ele esteja: rejeitada, porque espalha arquivos pela
  pasta do usuário.
- Esperar o índice de PDFs do B3: rejeitada, porque prende o B2 a outro bloco sem ganho.
