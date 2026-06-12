# Certificate Management

## Diretrizes

- Certificado A1 (`.pfx`/`.p12`) armazenado somente criptografado.
- Senha armazenada separadamente e criptografada.
- Certificado vencido/invalido bloqueia sincronizacao.
- Substituicao nao reinicia NSU.

## Estado atual

- Servico de criptografia AES-256-GCM local.
- Persistencia de binario criptografado em storage local (`storage/certificados/...`).
- Validade, thumbprint, serial, issuer e subject sao extraidos automaticamente do `.pfx/.p12` no cadastro.
- Edicao via `PATCH /certificados/:id` permite atualizar apelido, CNPJ titular, vinculo com cliente/estabelecimento, anotacoes e opcionalmente substituir arquivo/senha.
- Quando a edicao envia novo arquivo, a senha e obrigatoria; arquivo e senha continuam sendo persistidos somente criptografados.
- Quando a edicao envia apenas nova senha, a API valida a senha contra o PFX armazenado e atualiza metadados sem retornar segredo.
- Certificados podem ser cadastrados vinculados a um cliente ou como avulsos para controle interno.
- Cada certificado possui `anotacoes` para registrar origem, renovacao, uso futuro ou pendencias operacionais.
- Operacoes por ID de certificado vinculado exigem escopo por `clienteId` (query string, UUID valido).
- Operacoes por ID de certificado avulso devem omitir `clienteId`.
- Download via `GET /certificados/:id/download` retorna o `.pfx` original em Base64, descriptografado somente em memoria.
- A senha do certificado nunca e retornada no download.
- Exclusao via API permitida apenas para certificados inativos (`DELETE /certificados/:id?clienteId=...` para vinculados ou `DELETE /certificados/:id` para avulsos).
- Pronto para evolucao para S3/MinIO.

## Rotas principais

- `POST /clientes/:clienteId/certificados`: cadastra certificado vinculado ao cliente.
- `POST /certificados`: cadastra certificado avulso; `clienteId` no body e opcional.
- `GET /certificados`: lista todos os certificados, incluindo avulsos. Aceita `?clienteId=...` como filtro.
- `PATCH /certificados/:id`: edita dados do certificado; use `?clienteId=...` quando o certificado atual estiver vinculado.
- `PATCH /certificados/:id/anotacoes`: atualiza anotacoes.
- `POST /certificados/:id/desvincular`: remove vinculo com cliente e deixa o certificado inativo.
- `GET /certificados/:id/download`: baixa o arquivo do certificado.
