# Sync Flow

## Estrategia

- Controle incremental por NSU (`ultimo_nsu_consultado`).
- Contexto por `cliente/cnpj/ambiente`.
- Adapter ADN isolado.
- Deduplicacao por chave de acesso.
- Ciclo automatico em background para controles `ativo`.
- Backoff para erros temporarios de API sem avancar NSU.

## Teste manual de um NSU

- Endpoint temporario: `POST /sync/testar-nsu`.
- Recebe `clienteId`, `estabelecimentoId` e `nsu`.
- Valida certificado ativo/nao vencido e consulta apenas esse NSU na API ADN.
- Retorna payload bruto e metadados, sem persistir NFS-e no banco.
- Usa `NFSE_ADN_CLIENT_MODE` para escolher entre mock e integracao real.

## Jobs previstos

- `sync_nfse_adn`
- `verificar_certificados`
- `gerar_danfse_pendente`
- `reprocessar_erros`
- `limpar_temporarios`

## Regras de avancar NSU

- Retorno com documento valido: avanca NSU e salva NFS-e.
- Ao salvar documento via sync, o sistema tambem gera o DANFSE (`.pdf`) e persiste `danfse_path`.
- Retorno sem documento definitivo (ex.: 404 sem lote): avanca NSU.
- Erro temporario de API (ex.: 429, timeout, 5xx): **nao avanca NSU** e agenda nova tentativa.
