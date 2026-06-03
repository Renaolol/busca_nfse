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
- Controle NSU por contexto (`cliente/cnpj/ambiente`) com `UNIQUE (cliente_id, cnpj_consulta, ambiente)` em `nfse_sync_controle`.
- Historico de certificados e vinculo de substituicao.
- Cadastro do responsavel interno em `clientes.responsavel_interno`.
- Dados fiscais do estabelecimento principal em `cliente_estabelecimentos`, incluindo inscricao municipal e municipio.
