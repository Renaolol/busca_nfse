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
- Validar certificado ativo e validade.
- Se o objetivo for teste real, confirmar `NFSE_ADN_CLIENT_MODE=real`.
- Conferir `NFSE_API_BASE_URL_RESTRITA`/`NFSE_API_BASE_URL_PRODUCAO` e conectividade HTTPS mTLS.
- Se aparecer `HTTP 429`, reduzir frequencia de consulta e ajustar:
  - `SYNC_AUTO_RUN_INTERVAL_MS`
  - `SYNC_API_RETRY_DELAY_MS`
- Em `429/timeout/5xx`, o sistema nao avanca NSU (evita pulo de documento) e agenda nova tentativa.

## Erro ao cadastrar certificado

- Conferir se o arquivo enviado e `.pfx` ou `.p12`.
- Conferir senha do certificado.
- O backend extrai a validade automaticamente; se falhar, o cadastro e recusado.
- Se ocorrer `413 Payload Too Large`, aumentar `REQUEST_BODY_LIMIT` (ex.: `10mb`).
- Se aparecer erro de OpenSSL ausente, instalar OpenSSL no ambiente onde a API esta rodando.
