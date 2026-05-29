# Certificate Management

## Diretrizes

- Certificado A1 (`.pfx`/`.p12`) armazenado somente criptografado.
- Senha armazenada separadamente e criptografada.
- Certificado vencido/invalido bloqueia sincronizacao.
- Substituicao nao reinicia NSU.

## Estado atual

- Servico de criptografia AES-256-GCM local.
- Persistencia de binario criptografado em storage local (`storage/certificados/...`).
- Todas as rotas de certificado exigem `Authorization: Bearer <token>`.
- Validade, thumbprint, serial, issuer e subject sao extraidos automaticamente do `.pfx/.p12` no cadastro.
- Operacoes por ID de certificado exigem escopo por `clienteId` (query string, UUID valido).
- Exclusao via API permitida apenas para certificados inativos (`DELETE /certificados/:id?clienteId=...`).
- Pronto para evolucao para S3/MinIO.
