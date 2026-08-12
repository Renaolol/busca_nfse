# Security

## Requisitos

- Segredos via variaveis de ambiente.
- Nenhum segredo hardcoded.
- Criptografia de certificado e senha.
- Sem logging de XML completo ou senha.
- Acesso da aplicacao restrito a rede interna do escritorio.
- Controle de acesso por cliente com validacao de escopo (`clienteId`) quando o recurso esta vinculado a cliente.
- Usuarios internos autenticam por `username + senha` com hash via `scrypt`; senha nunca e salva em texto puro.
- Sessoes autenticadas usam `access token` JWT e `refresh token` persistido no banco.
- Login, logout, falhas de autenticacao, renovacao de sessao e acessos negados geram trilha em `eventos_acesso`.
- Tempo logado e calculado por sessao em `sessoes_usuario` a partir de `login_at`, `last_seen_at`, `logout_at`, `expires_at` e `revoked_at`.
- `CERT_MASTER_KEY` obrigatoria no bootstrap (valor placeholder `CHANGE_ME...` nao e aceito).
- `JWT_SECRET` obrigatoria no bootstrap.
- Em `NODE_ENV=production`, o bootstrap exige `NFSE_ADN_CLIENT_MODE=real`.
- Em `NODE_ENV=production`, `NFSE_ADN_REJECT_UNAUTHORIZED=false` e bloqueado.
- O primeiro administrador pode ser criado automaticamente com `AUTH_SEED_ADMIN_USERNAME` e `AUTH_SEED_ADMIN_PASSWORD`.
- Endpoints por `id` de certificado vinculado exigem `clienteId` (UUID) para validacao de escopo; certificados avulsos omitem `clienteId`.
- Download de certificado descriptografa o arquivo apenas em memoria e nao retorna senha.
- Consulta de senha via `POST /certificados/:id/senha` descriptografa a senha apenas em memoria e exige o mesmo escopo do certificado.
- Anotacoes de certificado nao devem receber senha, chave privada ou segredos operacionais.
- Endpoint `GET /sync/logs` exige `clienteId` (UUID) para isolamento de logs por cliente.
- `POST /nfse/download-lote` respeita escopo por `clienteId`.
- Rotas de escrita (`POST/PATCH/DELETE`) geram auditoria automatica (`auditoria_usuario`) com acao, entidade, escopo de cliente, IP e user-agent.
- `ENABLE_SWAGGER=false` e recomendado em producao.

## Variaveis sensiveis

- `DATABASE_URL`
- `JWT_SECRET`
- `REDIS_URL`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `CERT_MASTER_KEY`
- `AUTH_SEED_ADMIN_PASSWORD`
