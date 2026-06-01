# Sync Flow

## Estrategia

- Controle incremental por NSU (`ultimo_nsu_consultado`).
- Contexto por `cliente/cnpj/ambiente` (chave unica de controle por esse trio).
- Adapter ADN isolado.
- Deduplicacao por chave de acesso.
- Ciclo automatico em background para controles `ativo`.
- Backoff para erros temporarios de API sem avancar NSU.
- Suporte a modo diario (`somente_novas`) com agendamento de 24h apos detectar ausencia de novos documentos.

## Operacao no painel

- O menu `Busca API` dispara ciclos continuos de `POST /sync/rodar-agora` ate detectar fim da fila (status `sem_documento`).
- Os botoes `Pausar` e `Retomar` atuam no mesmo fluxo continuo e atualizam o estado dos controles do cliente.
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
  - Se houver documentos e `SYNC_DAILY_STOP_ON_FIRST_DOCUMENT=true`, encerra o ciclo apos o primeiro documento e agenda nova tentativa curta (`SYNC_DAILY_SUCCESS_COOLDOWN_MS`) para reduzir `HTTP 429`.
  - Se `SYNC_DAILY_STOP_ON_FIRST_DOCUMENT=false`, segue buscando ate o limite `SYNC_DAILY_MAX_NSU_PER_RUN` por ciclo.

## Busca noturna global

- A busca noturna roda em background quando `SYNC_NIGHTLY_SWEEP_ENABLED=true`.
- O horario e controlado por:
  - `SYNC_NIGHTLY_SWEEP_HOUR`
  - `SYNC_NIGHTLY_SWEEP_MINUTE`
  - `SYNC_NIGHTLY_SWEEP_TIMEZONE_OFFSET_MINUTES`
- A cada execucao noturna, o sistema:
  - percorre todos os clientes cadastrados,
  - ativa/reativa controles de sync para todos os estabelecimentos ativos em modo `somente_novas`,
  - preserva o `ultimo_nsu_consultado` dos controles existentes,
  - cria controles novos partindo do ultimo NSU encontrado localmente (ou `0` se nao houver historico).
- Depois da ativacao, dispara um ciclo imediato de sincronizacao para comecar a busca incremental sem esperar o proximo intervalo.
- O fluxo evita execucao duplicada no mesmo dia (`yyyy-mm-dd` no fuso configurado).
