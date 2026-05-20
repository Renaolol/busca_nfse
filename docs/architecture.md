# Architecture

## Visao geral

A aplicacao segue arquitetura backend-first:

1. Adapter da API oficial NFS-e/ADN
2. Worker de sincronizacao por NSU
3. Persistencia em PostgreSQL
4. Armazenamento de XML/PDF em S3 (MinIO local)
5. API interna para consulta e download

## Modulos

- `clients`
- `establishments`
- `certificates`
- `sync`
- `nfse`
- `audit`
- `storage`
- `health`
