# NF-e Distribuicao

## Objetivo

Criar a base de captura de NF-e de compra e venda sem acoplar regras da SEFAZ ao fluxo existente de NFS-e.

## Escopo desta entrega

- Novas tabelas `nfe_sync_controle` e `nfe_documentos`.
- Novo modulo NestJS `nfe` com controller, service, DTOs e testes.
- Novo parser de XML para `resNFe` e `procNFe`.
- Novo adapter `nfe-distribuicao` com implementacao `mock` para desenvolvimento e testes.
- Implementacao `real` com SOAP 1.2, mTLS, leitura de `distNSU` e descompactacao de `docZip`.

## Reaproveitamento

- Certificados A1 ja cadastrados.
- Cliente e estabelecimento como escopo operacional.
- Storage local para XMLs.
- Prisma, Swagger e trilha de testes do projeto.

## Endpoints

- `GET /nfe`
- `GET /nfe/:id`
- `GET /nfe/:id/xml`
- `GET /nfe/dashboard-stats`
- `GET /nfe/sync/status?clienteId=...`
- `POST /nfe/importar-xml`
- `POST /nfe/sync/iniciar`
- `POST /nfe/sync/pausar`
- `POST /nfe/sync/rodar-agora`
- `POST /nfe/sync/consultar-nsu`
- `POST /nfe/sync/consultar-chave`

## Observacoes

- NF-e e NFS-e mantem controles de NSU independentes.
- A deduplicacao de NF-e ocorre por `ambiente + chave_acesso`.
- `NFE_DISTRIBUICAO_CLIENT_MODE=real` usa por padrao:
- producao: `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`
- homologacao: `https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`
- As URLs acima seguem a relacao oficial de servicos web do portal da NF-e e podem ser sobrescritas por env var.
- O fluxo atual implementa `distNSU`, `consNSU` e `consChNFe`.
- As rotas manuais permitem testar o ambiente real e recuperar documentos pontuais sem depender do ciclo incremental.
