# Migracao da API SIEG

## Contexto
A documentacao da SIEG descreve um modelo de autenticacao em dois niveis:
1. Integrador: gera o JWT em `POST /api/v1/create-jwt` com `X-Client-Id` e `X-Secret-Key`.
2. Cliente/base: para as rotas de documentos, usa `Authorization: Bearer {jwt}` + `X-OAuth-Token` **ou** `X-API-Key`.

Validade do JWT: 24 horas.

## Estado atual no codigo
- Implementado em `dependencies.py` suporte por `sieg_auth_mode`:
  - `legacy` (padrao): usa `api_key_sieg` em query string.
  - `jwt`: usa `create-jwt`, cache de JWT em memoria e headers de escopo por cliente.
- Endpoints padrao no modo `jwt`:
  - `POST https://api.sieg.com/api/v1/create-jwt`
  - `POST https://api.sieg.com/api/v1/baixar-xmls`
  - `POST https://api.sieg.com/api/v1/baixar-eventos`
- Resposta do `baixar-xmls` tratada como ZIP (`application/zip`) quando aplicavel e convertida internamente para base64 para manter compatibilidade com o app atual.
- No modo `jwt`, os eventos de cancelamento agora sao buscados por `ChaveXml` no endpoint oficial `baixar-eventos`, garantindo vinculo direto com cada NF-e/CT-e.

## Variaveis de ambiente
### Modo legado
- `api_key_sieg`

### Modo JWT
- `sieg_auth_mode=jwt`
- `sieg_api_base_url` (default: `https://api.sieg.com`)
- `sieg_baixar_xmls_path` (default: `/api/v1/baixar-xmls`)
- `sieg_baixar_eventos_path` (default: `/api/v1/baixar-eventos`)
- `sieg_jwt_url` (default: `https://api.sieg.com/api/v1/create-jwt`)
- `sieg_client_id`
- `sieg_secret_key`
- `sieg_oauth_token` ou `sieg_api_key_client`
- `sieg_require_client_scope` (default: `true`)
- `sieg_tipo_evento_cancelamento` (default: `110111`)

## Plano de rollout recomendado
1. Manter `legacy` em producao.
2. Validar `jwt` em homologacao com empresa piloto.
3. Confirmar comportamento das rotas NF-e, CT-e e NFSe.
4. Migrar gradualmente por ambiente.
5. Remover `legacy` somente apos estabilizacao.

## Pendencias
- Mapear codigos de erro mais comuns da SIEG para mensagens de erro mais amigaveis na UI.
- Avaliar migracao para extracao incremental por NSU nas rotas novas (`/api/v1/buscar-xmls/nsu`).
