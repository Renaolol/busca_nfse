# Sync Flow

## Estrategia

- Controle incremental por NSU (`ultimo_nsu_consultado`).
- Contexto por `cliente/cnpj/ambiente` (chave unica de controle por esse trio).
- Adapter ADN isolado.
- Deduplicacao por chave de acesso.
- Ciclo automatico em background para controles `ativo`.
- Backoff para erros temporarios de API sem avancar NSU.
- Suporte a modo diario (`somente_novas`) com agendamento de 24h apos detectar ausencia de novos documentos.

## Teste manual de um NSU

- Endpoint temporario: `POST /sync/testar-nsu`.
- Recebe `clienteId`, `estabelecimentoId` e `nsu`.
- Valida certificado ativo/nao vencido e consulta apenas esse NSU na API ADN.
- Retorna payload bruto e metadados, sem persistir NFS-e no banco.
- Usa `NFSE_ADN_CLIENT_MODE` para escolher entre mock e integracao real.
- A consulta de logs (`GET /sync/logs`) exige `clienteId` (UUID valido) para retornar apenas o escopo do cliente informado.

## Jobs implementados

- `sync_nfse_adn`
- `verificar_certificados`
- `gerar_danfse_pendente`
- `reprocessar_erros`
- `limpar_temporarios`

Todos os jobs sao idempotentes e podem ser executados repetidamente sem efeitos colaterais acumulativos indevidos.
Os jobs podem ser disparados manualmente pelos scripts `npm run job:*` para operacao e troubleshooting.

## Regras de avancar NSU

- Retorno com documento valido: avanca NSU e salva NFS-e.
- Ao salvar documento via sync, o sistema tambem gera o DANFSE (`.pdf`) e persiste `danfse_path`.
- Retorno sem documento definitivo (ex.: 404 sem lote): avanca NSU.
- Erro temporario de API (ex.: 429, timeout, 5xx): **nao avanca NSU** e agenda nova tentativa.

## Modos de inicio de sync

- `historico` (padrao): cria/reativa controles no modo `historico_desde_nsu_1`.
- `diario`: cria/reativa controles no modo `somente_novas`.
  - Se nao houver documentos novos no ciclo, agenda proxima execucao para `SYNC_DAILY_INTERVAL_MS`.
  - Se houver documentos, segue buscando ate o limite `SYNC_DAILY_MAX_NSU_PER_RUN` por ciclo.
