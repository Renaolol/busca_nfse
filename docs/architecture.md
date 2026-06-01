# Architecture

## Objetivo do sistema

Coletar NFS-e Nacional na API oficial ADN por NSU, por contexto de `cliente/cnpj/ambiente`, e disponibilizar uma camada operacional segura para consulta fiscal e download de documentos.

## Resultado final esperado

1. Entrada segura de dados de cliente e certificado (com criptografia de credenciais).
2. Sincronizacao continua e confiavel das notas, sem perda por avancos indevidos de NSU.
3. Persistencia deduplicada dos documentos fiscais e seus artefatos (XML/DANFSE).
4. Exposicao de API e interface operacional para uso interno, com escopo de cliente nos endpoints necessarios.
5. Rotinas idempotentes de manutencao para preservar qualidade e disponibilidade da base.

## Visao geral

A aplicacao segue arquitetura backend-first:

1. Adapter da API oficial NFS-e/ADN
2. Worker de sincronizacao por NSU
3. Persistencia em PostgreSQL
4. Armazenamento de XML/PDF via provider de storage (implementacao local no MVP)
5. API interna com validacoes de escopo por `clienteId` nos endpoints multi-tenant

## Modulos

- `clients`
- `establishments`
- `certificates`
- `sync`
- `nfse`
- `audit`
- `storage`
- `jobs`
- `health`
