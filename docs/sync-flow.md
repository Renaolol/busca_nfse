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
- O botao `Recuperar NSUs passados` permite selecionar um cliente especifico ou todos os clientes. Ele chama `POST /sync/reprocessar-nsus-passados` para varrer do NSU 1 ate o `ultimo_nsu_consultado`, pular documentos fiscais existentes e baixar apenas lacunas ainda ausentes no app.
- Os botoes `Pausar` e `Retomar` atuam no mesmo fluxo continuo e atualizam o estado dos controles do cliente.
- A interface diferencia `Busca habilitada` (cliente elegivel para rotinas) de `Executando agora` (consulta em andamento no monitor).
- O endpoint `GET /sync/scheduler-status` informa se o ciclo automatico e a busca noturna estao ligados, rodando, quais horarios noturnos estao ativos e qual a proxima execucao noturna.
- O endpoint `GET /nfse/dashboard-stats` retorna os totais agregados de NFS-e e XMLs armazenados por cliente para o dashboard, sem depender do limite da listagem `GET /nfse`.
- O endpoint `PUT /sync/scheduler-settings` permite ativar/desativar a rotina noturna global e selecionar os horarios ativos entre `18:00`, `20:00`, `22:00`, `00:00`, `02:00`, `04:00` e `06:00`.
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
- Retorno ADN em lote (`lote=true`): salva todos os XMLs retornados, registra cada documento/evento e avanca o controle ate o maior NSU informado no lote.
- Ao salvar documento via sync, o sistema tambem gera o DANFSE (`.pdf`) e persiste `danfse_path`.
- Retorno sem documento definitivo (ex.: 404 sem lote): avanca NSU.
- Erro temporario de API (ex.: 429, timeout, 5xx): **nao avanca NSU** e agenda nova tentativa.
- Recuperacao de NSUs passados: nao altera `ultimo_nsu_consultado`; atualiza apenas contadores, logs e `ultimo_nsu_com_documento` quando encontra documento fiscal ausente.

## Modos de inicio de sync

- `historico` (padrao): cria/reativa controles no modo `historico_desde_nsu_1`.
- `diario`: cria/reativa controles no modo `somente_novas`.
  - Se nao houver documentos novos no ciclo, agenda proxima execucao para `SYNC_DAILY_INTERVAL_MS`.
  - Se houver documentos e `SYNC_DAILY_STOP_ON_FIRST_DOCUMENT=true`, encerra o ciclo apos o primeiro documento e agenda nova tentativa curta (`SYNC_DAILY_SUCCESS_COOLDOWN_MS`) para reduzir `HTTP 429`.
  - Se `SYNC_DAILY_STOP_ON_FIRST_DOCUMENT=false` (padrao atual), segue buscando ate o limite `SYNC_DAILY_MAX_NSU_PER_RUN` por ciclo.
  - Quando o lote termina no limite com documentos encontrados, agenda uma nova tentativa curta usando `SYNC_DAILY_SUCCESS_COOLDOWN_MS` antes de continuar do ultimo NSU salvo.

## Busca noturna global

- A busca noturna roda em background quando `SYNC_NIGHTLY_SWEEP_ENABLED=true`.
- Os horarios podem ser controlados pela API/painel ou pela variavel `SYNC_NIGHTLY_SWEEP_SLOTS` (lista separada por virgula).
- Na ausencia de slots configurados, o sistema usa o horario legado definido por:
  - `SYNC_NIGHTLY_SWEEP_HOUR`
  - `SYNC_NIGHTLY_SWEEP_MINUTE`
- O fuso segue controlado por:
  - `SYNC_NIGHTLY_SWEEP_TIMEZONE_OFFSET_MINUTES`
- A cada execucao noturna, o sistema:
  - percorre todos os clientes cadastrados,
  - ativa/reativa controles de sync para todos os estabelecimentos ativos em modo `somente_novas`,
  - preserva o `ultimo_nsu_consultado` dos controles existentes,
  - cria controles novos partindo do ultimo NSU encontrado localmente (ou `0` se nao houver historico).
- Depois da ativacao, dispara um ciclo imediato de sincronizacao para comecar a busca incremental sem esperar o proximo intervalo.
- O fluxo evita execucao duplicada para a mesma combinacao de data local + horario configurado.
