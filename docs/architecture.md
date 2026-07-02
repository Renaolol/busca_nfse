# Architecture

## Objetivo do sistema

Coletar NFS-e Nacional na API oficial ADN por NSU, por contexto de `cliente/cnpj/ambiente`, e disponibilizar uma camada operacional segura para consulta fiscal e download de documentos, com base separada para NF-e de mercadorias.

## Resultado final esperado

1. Entrada segura de dados de cliente e certificado (com criptografia de credenciais).
2. Sincronizacao continua e confiavel das notas, sem perda por avancos indevidos de NSU.
3. Persistencia deduplicada dos documentos fiscais e seus artefatos (XML/DANFSE).
4. Exposicao de API e interface operacional para uso interno, com escopo de cliente nos endpoints necessarios.
5. Rotinas idempotentes de manutencao para preservar qualidade e disponibilidade da base.

## Visao geral

A aplicacao segue arquitetura backend-first:

1. Adapter da API oficial NFS-e/ADN
2. Adapter de distribuicao NF-e desacoplado do fluxo de servicos
3. Worker/servicos de sincronizacao por NSU
4. Persistencia em PostgreSQL
5. Armazenamento de XML/PDF via provider de storage (implementacao local no MVP)
6. API interna com validacoes de escopo por `clienteId` nos endpoints multi-tenant
7. Frontend operacional interno servido pela propria API em `frontend/app.js`

## Regras de elegibilidade operacional

- `clientes.ativo` controla a elegibilidade geral do cliente no sistema.
- `clientes.nfe_habilitado` controla especificamente a participacao do cliente nas rotinas de NF-e.
- NFS-e e NF-e compartilham cadastro de cliente, estabelecimento e certificado, mas possuem filas, controles e politica operacional independentes.
- Quando `nfe_habilitado=false`, o cliente deixa de participar de:
  - ativacao automatica/global de NF-e,
  - ciclo automatico/global de distribuicao NF-e,
  - painel operacional `Buscas NF-e`.

## Modulos

- `clients`
- `establishments`
- `certificates`
- `sync`
- `nfse`
- `nfe`
- `audit`
- `storage`
- `jobs`
- `health`

## Pontos arquiteturais que merecem atencao

- O frontend atual e funcional, mas esta concentrado majoritariamente em um unico arquivo (`frontend/app.js`), o que aumenta risco de regressao em manutencoes visuais e operacionais.
- O dominio de NFS-e possui trilha de logs de sincronizacao mais madura do que o dominio de NF-e; hoje o troubleshooting de NF-e depende mais do estado dos controles e dos logs gerais da aplicacao.
