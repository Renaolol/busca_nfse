# Database

O schema inicial usa Prisma + PostgreSQL com as tabelas:

- `clientes`
- `cliente_estabelecimentos`
- `certificados`
- `nfse_sync_controle`
- `nfse_documentos`
- `nfse_eventos`
- `nfse_sync_logs`
- `auditoria_usuario`

Regras principais:

- Deduplicacao por `UNIQUE (ambiente, chave_acesso)` em documentos.
- Controle NSU por contexto (`cliente/cnpj/ambiente`).
- Historico de certificados e vinculo de substituicao.
