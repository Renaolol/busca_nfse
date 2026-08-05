# App Coletor de NFS-e Nacional e NF-e

Backend para sincronizar, armazenar e consultar NFS-e Nacional usando a API oficial do ADN por NSU e estruturar a captura de NF-e de mercadorias.

## Objetivo do projeto

Centralizar a captura de NFS-e Nacional por cliente, usando consulta incremental por NSU na API oficial ADN, com trilha operacional para cadastro, sincronizacao, armazenamento, consulta e download de documentos fiscais, e manter uma base separada para NF-e de compra e venda com reaproveitamento dos certificados digitais ja cadastrados.

## Resultado final esperado

1. Onboarding completo de cliente, estabelecimento e certificado A1 com dados sensiveis protegidos.
2. Sincronizacao historica e diaria por NSU, com controles por `cliente/cnpj/ambiente` e sem pulo de NSU em erros temporarios.
3. Base fiscal consolidada, deduplicada por `ambiente + chave_acesso`, com XML e DANFSE/XML armazenados.
4. API interna e painel operacional com acesso direto na rede interna, escopo por cliente nos endpoints e operacoes de status/logs/pesquisa/download.
5. Jobs idempotentes para manutencao continua (validacao de certificado, reprocessamento e limpeza tecnica).

## Stack

- NestJS + TypeScript
- PostgreSQL + Prisma
- BullMQ + Redis
- S3 compativel (MinIO no desenvolvimento)

## Como rodar localmente

1. Copie `.env.example` para `.env` e ajuste valores.
2. Suba tudo com Docker (infra + API):

```bash
npm run docker:up
```

3. Abra:

```text
http://localhost:3000/app
```

Se precisar da documentacao Swagger localmente, habilite `ENABLE_SWAGGER=true` e abra:

```text
http://localhost:3000/api/docs
```

Para desenvolvimento local usando adapter fake da ADN:

```bash
NFSE_ADN_CLIENT_MODE=mock
ENABLE_SWAGGER=true
```

## Deploy em Windows Server

Para rodar como servico Windows e acessar pela rede interna com hostname, consulte:

- `docs/windows-service.md`

## Documentacao recomendada

- `docs/architecture.md`
- `docs/sync-flow.md`
- `docs/nfe-distribuicao.md`
- `docs/troubleshooting.md`
- `docs/operational-review-2026-07.md`

## Downloads de PDF fiscal

- NFS-e: o backend continua usando o gerador interno de DANFSE.
- NF-e: o endpoint `GET /nfe/:id/danfe?clienteId=...` gera o DANFE a partir do XML completo armazenado usando `@nfewizard/danfe`.
- CT-e: ainda nao ha geracao de DACTE neste projeto. Na versao `1.0.3` do `@nfewizard/danfe`, publicada antes de 21 de julho de 2026, o pacote instalado nao exporta gerador funcional de CT-e apesar da descricao citar DACTE.

## Desenvolvimento sem container da API

1. Suba apenas a infraestrutura:

```bash
docker compose up -d postgres redis minio minio-init
```

2. Instale dependencias:

```bash
npm install
```

3. Gere client Prisma e aplique migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Inicie aplicacao:

```bash
npm run dev
```

## Variaveis de ambiente

Veja `.env.example`.

- `REQUEST_BODY_LIMIT`: limite de payload para requests JSON/urlencoded (recomendado `10mb` para upload Base64 de certificado).
- `STORAGE_ROOT_PATH`: raiz do storage local (padrao `storage`; em Docker usa `/app/storage`).
- `NFSE_ADN_CLIENT_MODE`: `real` (recomendado/obrigatorio em producao) ou `mock` (somente desenvolvimento).
- `NFSE_API_BASE_URL_PRODUCAO` e `NFSE_API_BASE_URL_RESTRITA`: hosts do ADN.
- `NFSE_ADN_PATH_PREFIX`: prefixo da API (padrao `contribuintes`).
- `NFSE_EMISSOR_PUBLICO_API_BASE_URL_PRODUCAO` e `NFSE_EMISSOR_PUBLICO_API_BASE_URL_RESTRITA`: hosts do Emissor Publico usados para recuperar NFS-e por chave.
- `NFSE_EMISSOR_PUBLICO_PATH_PREFIX`: prefixo do Emissor Publico (padrao `SefinNacional`).
- `NFE_DISTRIBUICAO_CLIENT_MODE`: `mock` ou `real` para ativar o adapter da distribuicao NF-e.
- `NFE_DISTRIBUICAO_URL_PRODUCAO` e `NFE_DISTRIBUICAO_URL_HOMOLOGACAO`: URLs do `NFeDistribuicaoDFe` do Ambiente Nacional publicadas no portal da NF-e.
- `NFE_DISTRIBUICAO_TIMEOUT_MS`: timeout das chamadas SOAP de distribuicao NF-e.
- `NFE_DISTRIBUICAO_REJECT_UNAUTHORIZED`: controle de validacao TLS do endpoint NF-e.
- `CTE_CONSULTA_CLIENT_MODE`: `mock` ou `real` para ativar o adapter de consulta CT-e por chave.
- `CTE_CONSULTA_URL_PRODUCAO` e `CTE_CONSULTA_URL_HOMOLOGACAO`: endpoint SOAP do `CteConsultaV4` usado pelo backend. Em producao, se a URL fixa responder `cStat 410` para a UF da chave consultada, o cliente tenta automaticamente o endpoint padrao mapeado por `cUF`.
- `CTE_CONSULTA_LAYOUT_VERSION`: versao do layout SOAP/XML de consulta CT-e (padrao `4.00`).
- `CTE_CONSULTA_TIMEOUT_MS`: timeout das chamadas SOAP de consulta CT-e.
- `CTE_CONSULTA_REJECT_UNAUTHORIZED`: controle de validacao TLS do endpoint CT-e.
- `NFE_SYNC_SOURCE_MODE`: `distribuicao`, `dominio` (usa XML da Dominio) ou `dominio_chave` (usa `EFATENDIMENTO_NFE_CATALOGO` e consulta `consChNFe` por chave).
- `DOMINIO_NFE_SOURCE_MODE`: `mock` ou `real` para ativar o adapter da Dominio.
- `DOMINIO_ODBC_CONNECTION_STRING`: string ODBC da Dominio.
- `DOMINIO_PYTHON_BIN`: binario Python usado pelo exportador da Dominio.
- `NFE_DOMINIO_IMPORT_LIMIT_PER_RUN`: quantidade maxima de registros lidos por controle em cada execucao da Dominio.
- `NFE_SYNC_AUTO_RUN_ENABLED`: habilita ciclo automatico de NF-e em background (padrao `true`).
- `NFE_SYNC_AUTO_RUN_INTERVAL_MS`: intervalo entre ciclos automaticos de NF-e (padrao `300000`).
- `NFE_SYNC_AUTO_RUN_STARTUP_DELAY_MS`: atraso inicial apos boot para primeiro ciclo de NF-e (padrao `15000`).
- `NFE_SYNC_NIGHTLY_SWEEP_ENABLED`: habilita busca noturna automatica de NF-e (padrao `true`).
- `NFE_SYNC_NIGHTLY_SWEEP_SLOTS`: lista de horarios noturnos separados por virgula para NF-e.
- `NFE_SYNC_NIGHTLY_SWEEP_HOUR` e `NFE_SYNC_NIGHTLY_SWEEP_MINUTE`: horario legado de NF-e quando nao houver slots configurados.
- `NFE_SYNC_NIGHTLY_SWEEP_TIMEZONE_OFFSET_MINUTES`: offset de fuso do agendamento noturno de NF-e (padrao `-180`, UTC-3).
- `NFE_SYNC_NIGHTLY_SWEEP_CHECK_INTERVAL_MS`: intervalo de verificacao do agendamento noturno de NF-e (padrao `60000`).
- `ENABLE_SWAGGER`: habilita docs em `/api/docs` (`false` recomendado em producao).
- `SYNC_AUTO_RUN_ENABLED`: habilita ciclo automatico de sync em background (padrao `true`).
- `SYNC_AUTO_RUN_INTERVAL_MS`: intervalo entre ciclos automaticos (padrao `30000`).
- `SYNC_AUTO_RUN_STARTUP_DELAY_MS`: atraso inicial apos boot para primeiro ciclo automatico (padrao `3000`).
- `SYNC_EVENTS_AUTO_RUN_ENABLED`: habilita a rotina automatica de consulta de eventos para NFS-e ja salvas (padrao `true`).
- `SYNC_EVENTS_AUTO_RUN_PER_CONTROL_LIMIT`: quantidade maxima de NFS-e por controle/empresa em cada ciclo automatico de eventos (padrao `2`).
- `SYNC_EVENTS_AUTO_RUN_CANDIDATE_WINDOW`: janela de documentos por controle considerada para a rotina automatica de eventos (padrao `25`).
- `SYNC_EVENTS_AUTO_RUN_NO_EVENT_COOLDOWN_MS`: espera antes de tentar novamente uma NFS-e que ainda nao retornou eventos (padrao `86400000` = 24h).
- `SYNC_EVENTS_AUTO_RUN_WITH_EVENT_COOLDOWN_MS`: espera antes de reconsultar automaticamente uma NFS-e que ja possui eventos, para capturar mudancas posteriores como cancelamento (padrao `43200000` = 12h).
- `SYNC_EVENTS_AUTO_RUN_FAILURE_COOLDOWN_MS`: espera apos falha de API na rotina automatica de eventos (padrao `1800000` = 30min).
- `SYNC_EVENTS_AUTO_RUN_CERTIFICATE_COOLDOWN_MS`: espera apos falha de certificado na rotina automatica de eventos (padrao `21600000` = 6h).
- `SYNC_API_RETRY_DELAY_MS`: espera antes de tentar novamente quando ocorrer erro temporario de API (ex.: HTTP 429) (padrao `120000`).
- `SYNC_API_RETRY_JITTER_MS`: jitter adicional aleatorio aplicado ao retry de rate limit (padrao `60000`).
- `SYNC_DAILY_INTERVAL_MS`: intervalo da rotina diaria quando o controle esta no modo `somente_novas` (padrao `86400000` = 24h).
- `SYNC_DAILY_MAX_NSU_PER_RUN`: quantidade maxima de NSUs processados por ciclo para controles no modo diario (padrao `10`).
- `SYNC_DAILY_STOP_ON_FIRST_DOCUMENT`: quando `true`, no modo diario encerra o ciclo apos sincronizar 1 documento e agenda a proxima tentativa; por padrao fica `false` para buscar mais XMLs por lote.
- `SYNC_DAILY_SUCCESS_COOLDOWN_MS`: espera minima entre lotes diarios apos sucesso de documento (padrao `120000`).
- `SYNC_ADN_REQUEST_INTERVAL_MS`: intervalo minimo entre chamadas ao ADN (padrao `5000`).
- `SYNC_ADN_RATE_LIMIT_COOLDOWN_MS`: cooldown global apos `HTTP 429` (padrao `300000`).
- `SYNC_NIGHTLY_SWEEP_ENABLED`: habilita busca noturna automatica para todos os clientes cadastrados (padrao `true`).
- `SYNC_NIGHTLY_SWEEP_SLOTS`: lista de horarios noturnos separados por virgula (ex.: `18:00,20:00,22:00,00:00,02:00,04:00,06:00`). Pode ser sobrescrita pelo painel.
- `SYNC_NIGHTLY_SWEEP_HOUR`: hora da execucao noturna legada (0-23, padrao `2`) quando nao houver slots configurados.
- `SYNC_NIGHTLY_SWEEP_MINUTE`: minuto da execucao noturna legado (0-59, padrao `0`) quando nao houver slots configurados.
- `SYNC_NIGHTLY_SWEEP_TIMEZONE_OFFSET_MINUTES`: offset de fuso em minutos para agendamento noturno (padrao `-180`, UTC-3).
- `SYNC_NIGHTLY_SWEEP_CHECK_INTERVAL_MS`: intervalo de verificacao do agendamento noturno (padrao `60000`).
- `CERT_MASTER_KEY`: obrigatoria e deve ser configurada com segredo proprio (a API recusa iniciar com valor placeholder `CHANGE_ME...`).

### Regras de bootstrap em producao

- `NODE_ENV=production` exige:
  - `NFSE_ADN_CLIENT_MODE=real`
  - `NFSE_ADN_REJECT_UNAUTHORIZED=true`
- `DATABASE_URL`, `STORAGE_ROOT_PATH` e `CERT_MASTER_KEY` sao obrigatorias em qualquer ambiente.
- Em falha de carregamento da API, o frontend nao cai para dados mockados.

## Acesso interno

- O app esta configurado para uso interno e nao exige login por usuario/senha.
- Todos os endpoints ficam acessiveis na rede interna onde a API estiver publicada.
- O isolamento de contexto continua sendo feito por `clienteId` nos endpoints que exigem escopo (ex.: certificados vinculados, `/nfse/:id/*`, `/sync/logs`).
- Operacoes de escrita (`POST/PATCH/DELETE`) continuam gerando trilha de auditoria automatica em `auditoria_usuario` (acao, entidade, cliente, ip e user-agent).

## Comandos principais

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run test:e2e
npm run prisma:migrate
npm run prisma:generate
npm run docker:up
npm run docker:down
npm run sync:run-once
npm run job:verificar-certificados
npm run job:gerar-danfse-pendente
npm run job:reprocessar-erros
npm run job:limpar-temporarios
```

## Sincronizacao manual

O endpoint `POST /sync/rodar-agora` dispara uma execucao manual do ciclo de sincronizacao.
Para teste real, defina `NFSE_ADN_CLIENT_MODE=real` e use certificado A1 valido no cadastro.
Para consultar logs de sync por cliente, use `GET /sync/logs?clienteId=UUID`.
Para consultar o status do agendador, use `GET /sync/scheduler-status`.
Para consultar os totais reais do dashboard sem depender da listagem limitada de NFS-e, use `GET /nfse/dashboard-stats`.
Para recuperar lacunas de notas ja passadas pelo controle de NSU, use `POST /sync/reprocessar-nsus-passados`. Informe `clienteId` no body para limitar a recuperacao a um cliente especifico. A rotina varre do NSU 1 ate `ultimo_nsu_consultado`, pula NSUs com documento fiscal ja salvo, consulta apenas lacunas e nao altera `ultimo_nsu_consultado`.

### Iniciar sync com modo

Endpoint: `POST /clientes/:clienteId/sync/iniciar`

Body opcional:

```json
{
  "modo": "historico"
}
```

Valores aceitos:

- `historico`: sincroniza a partir do NSU 1 (comportamento padrao).
- `diario`: usa modo `somente_novas`, com agendamento diario apos encontrar que nao ha novos documentos.

## Sincronizacao automatica

- Ao iniciar/retomar sync, os controles ficam `ativo` e entram no ciclo automatico em background.
- O ciclo automatico consulta apenas controles ativos e respeita `proximaExecucao` quando houver backoff.
- No painel, `Busca habilitada` significa que o cliente pode entrar nas rotinas elegiveis; `Executando agora` aparece separadamente no monitor quando ha consulta em andamento.
- Em erro temporario da API (ex.: `HTTP 429`, timeout, `5xx`), o sistema **nao avanca o NSU** para evitar pulo de documentos.
- Nesses casos, a proxima tentativa e agendada com base em `SYNC_API_RETRY_DELAY_MS`.
- Quando o ADN responde em lote (`lote=true`), todos os XMLs do retorno sao salvos e o controle avanca ate o maior NSU do lote.
- No modo diario, por padrao o ciclo processa ate `SYNC_DAILY_MAX_NSU_PER_RUN` NSUs por lote. Se todos os NSUs consultados tiverem documento, agenda nova execucao curta (`SYNC_DAILY_SUCCESS_COOLDOWN_MS`) antes de continuar.
- A busca noturna (`SYNC_NIGHTLY_SWEEP_*`) ativa modo diario para todos os clientes cadastrados e dispara varredura incremental a partir do ultimo NSU salvo.
- O painel permite ligar/desligar a rotina e marcar individualmente os horarios `18:00`, `20:00`, `22:00`, `00:00`, `02:00`, `04:00` e `06:00`.

## Sincronizacao de NF-e

- `POST /nfe/sync/ativar`: habilita a busca de NF-e para um cliente sem informar estabelecimento, CNPJ de consulta ou NSU manualmente. O backend resolve os estabelecimentos ativos do cliente, consulta o `maxNSU` atual de cada CNPJ e grava esse valor como base para buscar apenas as proximas NF-e.
- `POST /nfe/sync/ativar-todos`: executa o mesmo processo em lote para todos os clientes ativos.
- `POST /nfe/sync/pausar`: pausa os controles de NF-e do cliente informado.
- `POST /nfe/sync/rodar-agora`: executa a distribuicao apenas para um cliente especifico.
- `POST /nfe/sync/rodar-agora-geral`: executa a distribuicao para todos os controles ativos de NF-e.
- `GET /nfe/sync/status?clienteId=UUID`: lista os controles de NF-e do cliente.
- `GET /nfe/sync/scheduler-status`: mostra o status do ciclo automatico e da busca noturna de NF-e.
- `PUT /nfe/sync/scheduler-settings`: atualiza a configuracao da busca noturna de NF-e.
- `GET /alertas`: lista alertas persistidos do backend. No momento inclui os alertas de `CT-e` com evento de `desacordo`, com resolucao persistida em banco.
- `GET /alertas/resolucoes`: lista resolucoes persistidas para alertas genericos do painel, como auditoria, certificado e falhas operacionais.
- `PUT /alertas/resolucoes/:alertId`: marca ou reabre um alerta generico, persistindo a resolucao em banco por `alertId` e `fingerprint`.
- `POST /clientes/:id/nfe/ativar`: habilita o cliente para as rotinas de NF-e.
- `POST /clientes/:id/nfe/pausar`: desabilita o cliente para as rotinas de NF-e e pausa controles existentes.

### Comportamento operacional da NF-e

- O modo operacional recomendado da NF-e nao tenta reconstruir historico remoto por data.
- Na primeira ativacao, cada controle e criado a partir do `maxNSU` atual retornado pela distribuicao DF-e.
- Isso evita varrer todo o historico antigo do contribuinte e faz a base seguir apenas com futuras entradas e saidas.
- Controles ja existentes sao apenas reativados, sem resetar o NSU salvo.
- A elegibilidade do cliente para NF-e agora e controlada por `clientes.nfe_habilitado`, separada do status geral do cliente.
- Cliente com NF-e desabilitada nao aparece no painel de `Buscas NF-e`, nao entra na ativacao em lote e nao participa do ciclo automatico/global.
- O ciclo automatico de NF-e usa `NFE_SYNC_AUTO_RUN_*`.
- O ciclo automatico de NFS-e pode tambem consultar eventos das notas salvas usando `SYNC_EVENTS_AUTO_RUN_*`, sem alterar `ultimo_nsu_consultado`.
- A busca noturna de NF-e usa `NFE_SYNC_NIGHTLY_SWEEP_*` e, a cada slot configurado, garante controles ativos para clientes elegiveis antes de rodar a distribuicao incremental ou a consulta por chave baseada na Dominio, conforme `NFE_SYNC_SOURCE_MODE`.
- Se outro ERP/robo tambem consome `NFeDistribuicaoDFe` para o mesmo interessado/CNPJ, a recomendacao operacional e deixar apenas um consumidor ativo por cliente. Use `nfe_habilitado=false` quando o cliente ja possui outro capturador em producao.

## Importacao de XML

Use `POST /nfse/importar-xml` para carregar XMLs legados de NFS-e ou XMLs de evento.
Use `POST /nfse/recuperar-por-chave` para recuperar XMLs faltantes que estejam disponiveis no Portal Nacional/Emissor Publico. O endpoint recebe `clienteId`, `cnpjConsulta`, `ambiente` e a lista `chavesAcesso`; para cada chave, o backend consulta a API oficial e importa o XML retornado.
Use `POST /sync/reprocessar-nsus-passados/execucao` com `clienteId`, `cnpjConsulta`, `ambiente` e `lacunas` para auditar apenas os NSUs mais provaveis de uma lacuna de numeracao detectada na listagem. O backend usa os XMLs ja armazenados para inferir as faixas de NSU vizinhas e tenta recuperar os documentos faltantes por NSU, sem depender de consulta automatica por DPS.
Notas aplicam deduplicacao por `ambiente + chave_acesso` e geram/salvam o DANFSE em PDF.
Eventos sao vinculados pela chave da NFS-e referenciada (`chNFSe`) e salvos em `nfse_eventos`; evento de cancelamento (`e101101`) marca a nota relacionada como `cancelada`, preenche `data_cancelamento` e forca regeneracao futura do DANFSE.

## Download de XML e DANFSE

- `GET /nfse/:id/xml`: retorna XML da nota com `fileName`, `contentType` e `contentBase64`.
- `GET /nfse/:id/danfse`: retorna DANFSE em PDF com `fileName`, `contentType` e `contentBase64`.
- `POST /nfse/download-lote`: gera um arquivo ZIP em Base64 para baixar XML/DANFSE em lote. Quando houver eventos de NFS-e vinculados e o lote incluir XMLs, os XMLs de evento tambem entram no ZIP.
- `POST /nfse/reprocessar-xmls`: reprocessa XMLs ja salvos para preencher campos faltantes e (opcionalmente) regenerar DANFSE.
- `POST /nfse/reprocessar-danfses`: reprocessa DANFSEs salvas para atualizar PDFs legados ou ausentes para o modelo atual.
- `GET /nfe/:id/xml`: retorna XML da NF-e com `fileName`, `contentType` e `contentBase64`.
- `GET /nfe/:id/danfe`: retorna DANFE em PDF com `fileName`, `contentType` e `contentBase64`.
- `POST /nfe/download-lote`: gera um arquivo ZIP em Base64 para baixar XML/DANFE em lote, com `tipoArquivo=ambos|xml|danfe`.
- `POST /nfse/eventos/sincronizar`: consulta manualmente os eventos das NFS-e ja armazenadas, usando a chave de acesso da nota e o certificado do estabelecimento, sem alterar NSU. O import aceita tanto XMLs de evento retornados pelo ADN quanto eventos estruturados em JSON. Quando o ADN responder sem documentos para a chave consultada (por exemplo `E2240` / `NENHUM_DOCUMENTO_LOCALIZADO`), a auditoria trata o caso como `sem_eventos`; o status `nao_localizado_endpoint_eventos` fica reservado para `HTTP 404` anomalo do endpoint.
- `GET /nfse`, `GET /nfse/separadas` e `GET /nfse/:id` retornam tambem `eventos` vinculados a cada nota.
- Os endpoints `GET /nfse/:id`, `GET /nfse/:id/xml` e `GET /nfse/:id/danfse` exigem `?clienteId=...` para garantir escopo de acesso por cliente.
- Os endpoints `GET /nfe/:id`, `GET /nfe/:id/xml` e `GET /nfe/:id/danfe` exigem `?clienteId=...` para garantir escopo de acesso por cliente.
- `clienteId` deve ser UUID valido.

Exemplo de body para sincronizacao manual de eventos:

```json
{
  "clienteId": "550e8400-e29b-41d4-a716-446655440000",
  "documentoIds": [
    "550e8400-e29b-41d4-a716-446655440010",
    "550e8400-e29b-41d4-a716-446655440011"
  ],
  "somenteSemEventos": true,
  "limit": 2
}
```

Quando o DANFSE nao existir para uma nota ja salva, ele e gerado automaticamente a partir do XML no primeiro download.
Na tela `Configuracoes > Manutencao`, a acao `Reprocessar DANFSEs` chama `POST /nfse/reprocessar-danfses` para atualizar os PDFs antigos em lote.

Exemplo de body para lote:

```json
{
  "ids": [
    "550e8400-e29b-41d4-a716-446655440010",
    "550e8400-e29b-41d4-a716-446655440011"
  ],
  "tipoArquivo": "ambos",
  "clienteId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## NF-e de compra e venda

- A base de NF-e reaproveita `cliente`, `estabelecimento`, `certificado` e `storage` ja existentes.
- O fluxo de NF-e e separado do fluxo de NFS-e: usa modulo proprio, parser proprio, tabelas proprias e adapter proprio de distribuicao.
- O adapter `real` agora envia SOAP 1.2 com mTLS para o `NFeDistribuicaoDFe` do Ambiente Nacional.
- Os endpoints padrao de producao e homologacao seguem a relacao oficial de servicos web publicada no portal da NF-e e podem ser sobrescritos por variavel de ambiente.

Rotas principais:

- `GET /nfe`
- `GET /nfe/:id`
- `GET /nfe/:id/xml`
- `GET /nfe/dashboard-stats`
- `GET /cte`
- `GET /cte/:id`
- `GET /cte/:id/xml`
- `GET /cte/dashboard-stats`
- `POST /cte/consultar-chave`
- `POST /cte/eventos/sincronizar`
- `GET /nfe/sync/status?clienteId=...`
- `POST /nfe/importar-dominio`
- `POST /nfe/dominio/xml`
- `POST /nfe/importar-xml`
- `POST /nfe/sync/iniciar`
- `POST /nfe/sync/pausar`
- `POST /nfe/sync/rodar-agora`
- `POST /nfe/sync/download-por-chave/preview`
- `POST /nfe/sync/download-por-chave/executar`
- `POST /nfe/sync/consultar-nsu`
- `POST /nfe/sync/consultar-chave`

Observacoes:

- `POST /nfe/sync/iniciar` cria ou reativa controles de busca por `cliente/cnpj/ambiente` sem misturar NSU de NFS-e.
- `POST /nfe/sync/rodar-agora` executa a distribuicao manual e persiste os documentos retornados.
- `POST /nfe/sync/download-por-chave/preview` monta a fila manual de chaves pendentes da Dominio para o overlay operacional antes de disparar o download real.
- `POST /nfe/sync/download-por-chave/executar` executa o download oficial por chave usando o catalogo da Dominio sem alterar a rotina principal configurada em `NFE_SYNC_SOURCE_MODE`.
- `POST /nfe/sync/consultar-nsu` consulta um NSU pontual via `consNSU`, com opcao de persistir o documento retornado.
- `POST /nfe/sync/consultar-chave` consulta uma NF-e especifica via `consChNFe`, com opcao de persistir o retorno.
- `POST /cte/consultar-chave` consulta um CT-e especifico via `CteConsultaV4`, persiste o resumo/XML retornado e tenta aproveitar eventos quando o autorizador devolver `procEventoCTe`.
- `POST /cte/eventos/sincronizar` reconsulta CT-es ja armazenados por chave de acesso para tentar importar eventos vinculados no mesmo storage compartilhado.
- A deduplicacao de NF-e tambem ocorre por `ambiente + chave_acesso`.
- `POST /nfe/importar-dominio` consulta a base da Dominio via ODBC, relaciona `bethadba.geempre.cgce_emp` com `cliente_estabelecimentos.cnpj` e reaproveita o mesmo pipeline de persistencia/deduplicacao do endpoint manual. O exportador prioriza `bethadba.EFATENDIMENTO_NFE_XML_V2` e usa `bethadba.EFATENDIMENTO_NFE_XML` como fallback quando necessario.
- `POST /nfe/importar-dominio` tambem aceita `catalogoIds` para reimportacao pontual de XMLs ja localizados pela Dominio.
- `POST /nfe/dominio/xml` retorna o XML bruto de um `catalogoId` da Dominio para visualizacao interna sem depender de persistencia previa.
- O ambiente salvo da NF-e passa a ser inferido do XML fiscal: `tpAmb=2` grava `homologacao`; qualquer outro valor, inclusive ausencia de `tpAmb`, grava `producao`.
- XMLs de `CT-e` (modelo `57`, como `cteProc`, `CTe`, `resCTe`, `eventoCTe` e `procEventoCTe`) continuam bloqueados no pipeline de persistencia de NF-e, mas, no fluxo da Dominio, passam a ser roteados automaticamente para o modulo dedicado de CT-e para armazenamento separado.
- A resposta de `POST /nfe/importar-dominio` inclui `resumoImportacao`, separando o total bruto por `NF-e`, `CT-e`, `NFS-e` e eventos. Esse total bruto nao deve ser comparado diretamente com os cards do dashboard de `NF-e no banco` e `CT-e no banco`, porque esses cards contam apenas documentos principais.
- Rejeicoes antigas de CT-e salvas como `retConsSitCTe_v4.00` com status contendo `Rejeicao` deixam de aparecer nas listagens e indicadores de `XMLs CT-e`.

### Importacao de NF-e via Dominio

- Configure `DOMINIO_NFE_SOURCE_MODE=real` para habilitar o adapter real.
- Configure `NFE_SYNC_SOURCE_MODE=dominio` se quiser que as rotinas do painel `Buscas NF-e` (`Ligar`, `Ligar todos` e `Rodar agora`) passem a importar XMLs diretamente da base da Dominio.
- Configure `NFE_SYNC_SOURCE_MODE=dominio_chave` se quiser que essas mesmas rotinas leiam a `EFATENDIMENTO_NFE_CATALOGO`, identifiquem o cliente pelo CNPJ e consultem a NF-e por `consChNFe` usando o certificado ja cadastrado, sem consumir `distNSU`.
- Configure `DOMINIO_ODBC_CONNECTION_STRING` com a string ODBC completa da Dominio, por exemplo: `DSN=ContabilPBI;UID=PBI;PWD=Pbi`.
- Opcionalmente configure `DOMINIO_PYTHON_BIN` quando o executavel Python nao estiver disponivel como `python`.
- Opcionalmente configure `NFE_DOMINIO_IMPORT_LIMIT_PER_RUN` para limitar quantos registros por controle sao lidos em cada execucao automatica/manual do painel.
- O importador usa o script `scripts/dominio_nfe_export.py`, que depende de `pyodbc` no host onde a API estiver rodando.
- A vinculacao com o cliente local ocorre por CNPJ do estabelecimento ativo; nao foi necessario adicionar coluna de codigo da empresa da Dominio no schema.
- Quando `NFE_SYNC_SOURCE_MODE=dominio`, o backend reaproveita `nfe_sync_controle` como cursor incremental usando `EFATENDIMENTO_NFE_CATALOGO.ID`, evitando reler o historico inteiro a cada execucao.
- Mesmo quando `NFE_SYNC_SOURCE_MODE=dominio`, o painel passa a expor o botao manual `Download por chave`, que usa `POST /nfe/sync/download-por-chave/preview` e `POST /nfe/sync/download-por-chave/executar` como fluxo complementar para consultar documentos faltantes no gov por chave de acesso.
- Esse fluxo manual faz uma varredura retroativa desde `2026-01-02` (data maior que `2026-01-01`), ignorando temporariamente o cursor salvo em `nfe_sync_controle` e sem sobrescrever esse cursor ao finalizar a execucao.
- Quando `NFE_SYNC_SOURCE_MODE=dominio_chave`, o backend tambem reaproveita `nfe_sync_controle` como cursor incremental usando `EFATENDIMENTO_NFE_CATALOGO.ID`, mas faz o download oficial por `consChNFe` para cada chave nova encontrada.
- Nesse modo, a leitura do catalogo da Dominio considera apenas notas com emissao a partir de `2026-01-02`, o que equivale a buscar somente documentos com data maior que `2026-01-01`.
- Nesse modo, a consulta por chave da Dominio fica restrita a execucao manual/esporadica; os ciclos automaticos e a busca noturna nao disparam esse processamento.
- Nesse modo, o frontend usa `POST /nfe/sync/download-por-chave/preview` e `POST /nfe/sync/download-por-chave/preview-global` para abrir o overlay manual com a lista de chaves pendentes antes do download oficial.
- Operacionalmente, esse fluxo por chave deve ser tratado como apoio esporadico e nao como trilha principal de captura. Em 17/07/2026, o prazo oficial encontrado para consulta completa na internet e de 180 dias para NF-e e CT-e; no caso de NF-e, a manifestacao conclusiva do destinatario passou para 90 dias a partir de 01/06/2026. Na pratica, chaves antigas tendem a retornar falhas definitivas como `cStat 632`.
- Se o XML retornado pela Dominio for ABRASF/NFS-e em vez de NF-e, o backend redireciona a importacao para o modulo de NFS-e e reaproveita a deduplicacao por `ambiente + chave_acesso` desse armazenamento.
- XMLs da Dominio com raiz `Baixas` sao ignorados automaticamente, pois representam baixa financeira e nao documento fiscal armazenavel.
- Se o XML retornado pela Dominio for `CT-e` ou evento de `CT-e`, o backend redireciona a persistencia para o modulo dedicado de transporte e preserva a separacao operacional entre `XMLs NF-e` e `XMLs CT-e`.
- Quando `NFE_SYNC_SOURCE_MODE=dominio_chave`, chaves de CT-e do catalogo tambem entram no processamento automatico/manual, mas a consulta oficial e a persistencia continuam sendo delegadas ao modulo dedicado de CT-e, mantendo as listagens separadas.
- O painel da ultima importacao consegue abrir o XML bruto do catalogo e disparar reimportacao pontual ou em lote usando esses `catalogoIds`.
- Para revisar e corrigir o ambiente (`producao`/`homologacao`) das NF-e ja salvas com base no `tpAmb` do XML, rode `npm run nfe:reclassificar-ambiente` para gerar um relatorio em `.tmp/nfe-environment-reclassification` e `npm run nfe:reclassificar-ambiente -- --apply` para aplicar as atualizacoes sem tocar documentos com conflito de `ambiente + chave_acesso`. Use `--clienteId=UUID` para limitar a uma empresa.
- Para revisar documentos de transporte que ja foram gravados em `nfe_documentos`, rode `npm run nfe:separar-cte` para gerar um relatorio em `.tmp/nfe-cte-separation` e `npm run nfe:separar-cte -- --apply` para marcar os CT-es detectados em `schemaDoc`, permitindo que o modulo de NF-e deixe de exibi-los nas listagens e indicadores.
- O frontend agora expõe um menu dedicado `XMLs CT-e`, paralelo a `XMLs NFS-e` e `XMLs NF-e`, com filtros, visualizacao do XML e download por cliente.
- `GET /nfe` aceita filtros por `cnpjEmitente`, `cnpjDestinatario`, `cnpjConsulta`, `tipoRelacao`, periodo, status e `somenteXmlCompleto`.
- `GET /cte` aceita filtros por `cnpjEmitente`, `cnpjDestinatario`, `cnpjConsulta`, `tipoRelacao`, numero, chave, ambiente, periodo, status e `somenteXmlCompleto`.
- `GET /nfse`, `GET /nfe` e `GET /cte` aceitam `page` e `pageSize` (padrao `100`, maximo `200`) e retornam `{ items, total, page, pageSize, totalPages }`.
- `GET /nfse` e `GET /cte` tambem aceitam `all=true` para retornar todos os registros que casam com o filtro de uma vez so, ignorando `page`/`pageSize` com limite de seguranca de 10000 itens por chamada.
- `GET /nfe` tambem aceita `all=true` para retornar todos os registros que casam com o filtro de uma vez so, ignorando `page`/`pageSize` sem aplicar limite de seguranca.
- Quando `NFE_DISTRIBUICAO_CLIENT_MODE=real`, o sistema consulta `distNSU`, `consNSU` e `consChNFe`, descompacta `docZip` e armazena resumos `resNFe` e XMLs completos retornados pelo Ambiente Nacional.
- Quando `CTE_CONSULTA_CLIENT_MODE=real`, o sistema usa o endpoint configurado de `CteConsultaV4` para consultar CT-e por chave com o certificado ativo do estabelecimento e pode persistir `retConsSitCTe`, `cteProc`, `CTe`, `procEventoCTe` e `eventoCTe` quando retornados pelo autorizador.
- O cliente real de CT-e aplica fallback automatico de SOAPAction, versao SOAP, namespace e formato do payload quando o autorizador rejeita a requisicao tecnica. Mesmo assim, retorno `cStat 243` continua significando rejeicao da mensagem enviada, nao XML fiscal valido.

## Guia de layout do DANFSE

- Consulte `docs/danfse-pdf-guide.md` para:
  - arquitetura do renderer PDF,
  - regras de layout e colunas,
  - ajustes visuais com base no padrao oficial,
  - procedimento de regeneracao em lote.

## Consulta por relacao (emitidas/tomadas)

- Lista geral com filtro: `GET /nfse?cnpjConsulta=12345678000100&tipoRelacao=emitidas`
- Retorno separado por grupos: `GET /nfse/separadas?cnpjConsulta=12345678000100`
- Quando `GET /nfse` recebe `tipoRelacao=emitidas` com `cnpjConsulta` e sem filtros adicionais que truncam a sequencia, a resposta inclui `validacaoNumeracao`, indicando se houve numeracao pulada e quais faixas ficaram ausentes.

## Frontend de testes

Com a API rodando, abra:

- `http://localhost:3000/app`

Esse frontend permite testar onboarding de cliente/certificado, controle de sync e pesquisa de NFS-e.
O layout agora inclui menus dedicados para armazenamento por documento fiscal:

- `Clientes`: cadastro/edicao, certificados e contexto ativo.
- `XMLs NFS-e`: filtros, listagem e download em lote (ZIP XML/DANFSE) das linhas selecionadas.
- `Buscas NF-e`: execucao e acompanhamento da importacao de NF-e.
- `XMLs NF-e`: armazenamento, consulta e download em lote (ZIP XML/DANFE) dos documentos selecionados.
- `XMLs CT-e`: armazenamento e consulta de documentos de transporte.
- `Auditoria`: consulta de trilha operacional por `cliente_id` e `acao`.
Use a lista suspensa de clientes para selecionar o contexto ativo; ao selecionar, as notas do cliente sao carregadas automaticamente.
Ao abrir/selecionar cliente, a listagem inicia com competencia do mes anterior ao atual.
No cabecalho da aba `Notas`, use o switcher `Emitidas/Recebidas` para alternar rapidamente a relacao consultada.
Edicao de dados e certificados fica disponivel via botoes \"Editar dados\" e \"Editar certificados\".
Ao criar cliente, o backend ja cria automaticamente o estabelecimento principal com o mesmo CNPJ, inscricao municipal e municipio informados.
O campo `responsavelInterno` fica salvo no cadastro do cliente para acompanhamento operacional interno.
No cadastro de certificado, a API extrai automaticamente validade, thumbprint, serial, emissor e subject do arquivo `.pfx/.p12`.
Certificados podem ser cadastrados sem cliente vinculado por `POST /certificados`, para controle interno da plataforma.
Certificados podem ser editados por `PATCH /certificados/:id`, incluindo apelido, CNPJ titular, vinculo, anotacoes e substituicao opcional de arquivo/senha.
Ao editar com novo arquivo, informe tambem a senha; arquivo e senha continuam criptografados e os metadados sao extraidos novamente.
Certificados aceitam `anotacoes` no cadastro, em `PATCH /certificados/:id` e em `PATCH /certificados/:id/anotacoes`.
Certificados podem ser baixados por `GET /certificados/:id/download`; a API descriptografa o PFX somente em memoria e nao retorna a senha nessa rota.
A senha cadastrada pode ser consultada por `POST /certificados/:id/senha`; a API descriptografa somente em memoria e aplica o mesmo escopo por `clienteId`.
Certificados inativos podem ser excluidos por `DELETE /certificados/:id` (ativos exigem desativacao ou desvinculo antes).
Nos endpoints por `id` de certificado vinculado (`GET/POST/PATCH/DELETE /certificados/:id...`), informe `?clienteId=...` para validar escopo.
  - `clienteId` deve ser UUID valido.
  - Certificados avulsos devem ser acessados sem `clienteId`.
Tambem permite consultar por CNPJ base e alternar entre NFS-e emitidas e recebidas.
Na tabela de resultados, os botoes `XML` e `DANFSE` fazem download direto dos arquivos.
Na tela `XMLs Armazenados`, a listagem inicia vazia; selecione empresa e periodo de emissao e clique em `Buscar XMLs` para consultar os documentos no banco. Depois da consulta, `Exportar listagem` gera um CSV da listagem atual.
Na tela `Clientes`, a coluna `Busca NF-e`, o checkbox do detalhe do cliente e o modal `Editar cliente` controlam a flag operacional `nfe_habilitado`.
As operacoes por ID em certificado vinculado e NFS-e usam `clienteId` como escopo (query string) para evitar acesso cruzado entre clientes; certificados avulsos omitem esse parametro.
Quando houver pendencias (sem certificado, sem sync ou sem notas), o painel exibe mensagens explicativas.

## Jobs avulsos (operacao)

- `npm run sync:run-once`: executa 1 ciclo de sincronizacao ADN.
- `npm run job:verificar-certificados`: desativa certificados vencidos e ajusta status de controles.
- `npm run job:gerar-danfse-pendente`: reprocessa XMLs incompletos e regenera DANFSE.
  - Parametros opcionais: `JOB_CLIENTE_ID` (UUID) e `JOB_LIMIT` (inteiro > 0).
- `npm run job:reprocessar-erros`: reativa controles em `erro_api` prontos para nova tentativa.
- `npm run job:limpar-temporarios`: remove pastas temporarias antigas (`nfse-cert-*`, `nfse-mtls-*`).
  - Parametro opcional: `JOB_OLDER_THAN_HOURS` (inteiro > 0, padrao `1`).

## Links oficiais NFS-e

- Portal Nacional: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
- Manual ADN: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf
- Manual Emissor Publico API: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf
