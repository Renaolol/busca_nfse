# Changelog

## 2026-05-05
### Changed
- Atualizada a busca de eventos no modo `jwt` para o endpoint oficial `POST /api/v1/baixar-eventos`, vinculando eventos por `ChaveXml` de cada NF-e/CT-e.
- Ajustada a leitura de eventos para aceitar tanto XML em base64 (legado) quanto XML bruto/objeto JSON retornado pela API nova.
- Ajustado `App.py` para exibir indicador explicito de cancelamento na lista (`NF Cancelada?`) e reforcar a vinculacao do evento por chave no merge.
- Atualizados `README.md`, `docs/API_SIEG_MIGRATION.md` e `docs/LLM_CONTEXT.md` com o endpoint de eventos e nova variavel `sieg_baixar_eventos_path`.

## 2026-04-22
### Changed
- Atualizada integracao SIEG no `dependencies.py` para o contrato atual da API (`/api/v1/create-jwt` e `/api/v1/baixar-xmls`).
- Ajustado parsing do JWT para suportar retorno em string pura (alem de JSON objeto).
- Ajustados payloads para `TipoXml` e `BaixarEventos`, com compatibilidade retroativa para modo `legacy`.
- Ajustado processamento de resposta do `baixar-xmls` para `application/zip`, convertendo os XMLs para base64 internamente e preservando o fluxo atual do app.
- Atualizados `.env.example`, `README.md` e `docs/API_SIEG_MIGRATION.md` com endpoints e variaveis oficiais.

## 2026-04-20
### Changed
- Ajuste das regras de lancamento `3300` para NFSe de servico: primeiro credito na conta `412`, seguido de debitos.
- Em servico sem retencoes federais, geracao de debito total na conta `5`.
- Em servico com retencoes federais, geracao de debitos nas contas `31` (IRRF), `41` (PIS), `40` (COFINS) e `724` (CSOC/CSLL), com complemento no debito da conta `5`.
- Troca de CFOP por CFPS no registro `3030` para servico.
- Regra CFPS `9101`: mesmo municipio entre emitente e destinatario.
- Regra CFPS `9102`: municipios diferentes na mesma UF.
- Regra CFPS `9103`: UFs diferentes.
- Inclusao de ISS destacado com codigo de imposto `3` no registro `3020` (servico).
- Inclusao de ISS destacado com codigo de imposto `3` no registro `1020` somente quando o ISS estiver retido.

### Added
- Parse de NFSe com extracao explicita de municipio do emitente e UF/municipio do destinatario para suportar a regra de CFPS.

## 2026-03-31
### Added
- Documentacao tecnica para manutencao por LLM em `docs/LLM_CONTEXT.md`.
- Documento de arquitetura em `docs/ARCHITECTURE.md`.
- Guia de migracao da autenticacao SIEG em `docs/API_SIEG_MIGRATION.md`.
- Runbook operacional em `docs/OPERATIONS.md`.

### Changed
- Refatoracao das chamadas SIEG em `dependencies.py` para centralizar paginacao e parsing da resposta.
- Inclusao de suporte a dois modos de autenticacao (`legacy` e `jwt`) com variaveis de ambiente.
- Inclusao de cache de JWT em memoria para reduzir chamadas de autenticacao.

### Notes
- O modo `legacy` permanece como padrao para preservar compatibilidade.
- Migracao para `jwt` depende da definicao do endpoint oficial de emissao do token (`sieg_jwt_url`).
