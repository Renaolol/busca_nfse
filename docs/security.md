# Security

## Requisitos

- Segredos via variaveis de ambiente.
- Nenhum segredo hardcoded.
- Criptografia de certificado e senha.
- Sem logging de XML completo ou senha.
- Autenticacao JWT em todas as rotas protegidas.
- Controle de acesso por cliente com validacao de escopo (`clienteId`).
- `CERT_MASTER_KEY` obrigatoria no bootstrap (valor placeholder `CHANGE_ME...` nao e aceito).
- `JWT_SECRET` obrigatoria no bootstrap (valor placeholder `CHANGE_ME...` nao e aceito).
- Endpoints por `id` de certificado/NFS-e exigem `clienteId` (UUID) para validacao de escopo.
- Endpoint `GET /sync/logs` exige `clienteId` (UUID) para isolamento de logs por cliente.
- Operacoes globais (`/sync/rodar-agora`) exigem `role=admin`.
- `POST /nfse/download-lote` respeita escopo por `clienteId` para tokens de cliente.
- Rotas de escrita (`POST/PATCH/DELETE`) geram auditoria automatica (`auditoria_usuario`) com acao, entidade, escopo de cliente, IP e user-agent.

## Variaveis sensiveis

- `DATABASE_URL`
- `REDIS_URL`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `CERT_MASTER_KEY`
- `JWT_SECRET`
- `AUTH_USERS_JSON`
