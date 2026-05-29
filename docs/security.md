# Security

## Requisitos

- Segredos via variaveis de ambiente.
- Nenhum segredo hardcoded.
- Criptografia de certificado e senha.
- Sem logging de XML completo ou senha.
- Controle de acesso por cliente.
- `CERT_MASTER_KEY` obrigatoria no bootstrap (valor placeholder `CHANGE_ME...` nao e aceito).
- Endpoints por `id` de certificado/NFS-e exigem `clienteId` (UUID) para validacao de escopo.
- Endpoint `GET /sync/logs` exige `clienteId` (UUID) para isolamento de logs por cliente.

## Variaveis sensiveis

- `DATABASE_URL`
- `REDIS_URL`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `CERT_MASTER_KEY`
- `JWT_SECRET`
