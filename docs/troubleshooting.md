# Troubleshooting

## Falha de conexao no banco

- Verificar `docker compose ps`.
- Conferir `DATABASE_URL`.

## MinIO indisponivel

- Verificar servicos `minio` e `minio-init`.
- Conferir `S3_ENDPOINT` e credenciais.

## Erro na sincronizacao

- Verificar status em `nfse_sync_controle`.
- Consultar `nfse_sync_logs`.
- Para `GET /sync/logs`, informar `clienteId` valido (UUID) na query string.
- Validar certificado ativo e validade.
- Se o objetivo for teste real, confirmar `NFSE_ADN_CLIENT_MODE=real`.
- Conferir `NFSE_API_BASE_URL_RESTRITA`/`NFSE_API_BASE_URL_PRODUCAO` e conectividade HTTPS mTLS.
- Se aparecer `HTTP 429`, reduzir frequencia de consulta e ajustar:
  - `SYNC_AUTO_RUN_INTERVAL_MS`
  - `SYNC_API_RETRY_DELAY_MS`
- Em `429/timeout/5xx`, o sistema nao avanca NSU (evita pulo de documento) e agenda nova tentativa.

## Erro de escopo (`clienteId`)

- Em endpoints por `id` (`/certificados/:id...`, `/nfse/:id...`, `/sync/logs`), `clienteId` e obrigatorio.
- O valor de `clienteId` precisa ser UUID valido; caso contrario a API retorna `400`.
- Se o `clienteId` nao corresponder ao dono do recurso, a API responde como nao encontrado (`404`) para evitar vazamento de contexto.
- Para token `role=cliente`, `clienteId` informado no request precisa coincidir com o `clienteId` do token; caso contrario a API responde `403`.

## Erro de autenticacao/autorizacao

- `401 Token Bearer obrigatorio`: enviar header `Authorization: Bearer <token>`.
- `401 Credenciais invalidas`: validar `POST /auth/login` e credenciais configuradas em `AUTH_USERS_JSON`.
- `401 Token expirado`: gerar novo token via login.
- `403 Perfil sem permissao`: endpoint exige `role=admin` (ex.: `POST /sync/rodar-agora`).
- `403 Rota nao disponivel para usuario de cliente`: endpoint sem escopo de cliente para esse perfil.

## Erro ao cadastrar certificado

- Conferir se o arquivo enviado e `.pfx` ou `.p12`.
- Conferir senha do certificado.
- O backend extrai a validade automaticamente; se falhar, o cadastro e recusado.
- Se ocorrer `413 Payload Too Large`, aumentar `REQUEST_BODY_LIMIT` (ex.: `10mb`).
- Se aparecer erro de OpenSSL ausente, instalar OpenSSL no ambiente onde a API esta rodando.

## Erro ao iniciar a API

- Se a API falhar no bootstrap com mensagem sobre `CERT_MASTER_KEY`, configure valor seguro em `.env`.
- Se a API falhar no bootstrap com mensagem sobre `JWT_SECRET`, configure valor seguro em `.env`.
- Se a API falhar com mensagem sobre `AUTH_USERS_JSON`, configure um array JSON valido com usuarios.
- Se `AUTH_USERS_JSON` usar `userId`, o valor precisa ser UUID valido.
- Valores placeholder iniciando com `CHANGE_ME` sao recusados por seguranca.
