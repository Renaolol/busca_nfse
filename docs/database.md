# Database

O schema inicial usa Prisma + PostgreSQL com as tabelas:

- `clientes`
- `cliente_estabelecimentos`
- `certificados`
- `nfse_sync_controle`
- `nfse_documentos`
- `nfse_eventos`
- `nfse_sync_logs`
- `nfe_sync_controle`
- `nfe_documentos`
- `auditoria_usuario`
- `simples_nacional_importacoes`
- `simples_nacional_empresas`

Regras principais:

- Deduplicacao por `UNIQUE (ambiente, chave_acesso)` em documentos.
- Controle NSU por contexto (`cliente/cnpj/ambiente`) com `UNIQUE (cliente_id, cnpj_consulta, ambiente)` em `nfse_sync_controle`.
- Controle NSU independente para NF-e em `nfe_sync_controle`.
- Historico de certificados e vinculo de substituicao.
- `certificados.cliente_id` e opcional para permitir controle de certificados avulsos.
- `certificados.anotacoes` guarda observacoes internas sobre origem, renovacao e uso operacional.
- Cadastro do responsavel interno em `clientes.responsavel_interno`.
- A elegibilidade do cliente para NF-e e controlada pela coluna `clientes.nfe_habilitado`.
- Dados fiscais do estabelecimento principal em `cliente_estabelecimentos`, incluindo inscricao municipal e municipio.
- Eventos de NFS-e sao vinculados em `nfse_eventos.nfse_documento_id` pela chave da NFS-e referenciada no XML (`chNFSe`).
- Evento de cancelamento (`e101101`) atualiza a nota relacionada com `status = cancelada` e `data_cancelamento`.
- A tabela de empresas do Simples Nacional fica em `simples_nacional_empresas`, com `UNIQUE (cnpj_base)` (raiz de 8 caracteres do CNPJ, valendo para matriz e filiais). Cada empresa aponta para a importacao de origem em `simples_nacional_importacoes` (arquivo, totais e usuario). Uma nova importacao remove a anterior (cascade) e grava a nova lista na mesma transacao.
