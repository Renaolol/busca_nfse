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
- `NFE_DISTRIBUICAO_CLIENT_MODE`: `mock` ou `real` para ativar o adapter da distribuicao NF-e.
- `NFE_DISTRIBUICAO_URL_PRODUCAO` e `NFE_DISTRIBUICAO_URL_HOMOLOGACAO`: URLs do `NFeDistribuicaoDFe` do Ambiente Nacional publicadas no portal da NF-e.
- `NFE_DISTRIBUICAO_TIMEOUT_MS`: timeout das chamadas SOAP de distribuicao NF-e.
- `NFE_DISTRIBUICAO_REJECT_UNAUTHORIZED`: controle de validacao TLS do endpoint NF-e.
- `ENABLE_SWAGGER`: habilita docs em `/api/docs` (`false` recomendado em producao).
- `SYNC_AUTO_RUN_ENABLED`: habilita ciclo automatico de sync em background (padrao `true`).
- `SYNC_AUTO_RUN_INTERVAL_MS`: intervalo entre ciclos automaticos (padrao `30000`).
- `SYNC_AUTO_RUN_STARTUP_DELAY_MS`: atraso inicial apos boot para primeiro ciclo automatico (padrao `3000`).
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

## Importacao de XML

Use `POST /nfse/importar-xml` para carregar XMLs legados de NFS-e ou XMLs de evento.
Notas aplicam deduplicacao por `ambiente + chave_acesso` e geram/salvam o DANFSE em PDF.
Eventos sao vinculados pela chave da NFS-e referenciada (`chNFSe`) e salvos em `nfse_eventos`; evento de cancelamento (`e101101`) marca a nota relacionada como `cancelada`, preenche `data_cancelamento` e forca regeneracao futura do DANFSE.

## Download de XML e DANFSE

- `GET /nfse/:id/xml`: retorna XML da nota com `fileName`, `contentType` e `contentBase64`.
- `GET /nfse/:id/danfse`: retorna DANFSE em PDF com `fileName`, `contentType` e `contentBase64`.
- `POST /nfse/download-lote`: gera um arquivo ZIP em Base64 para baixar XML/DANFSE em lote.
- `POST /nfse/reprocessar-xmls`: reprocessa XMLs ja salvos para preencher campos faltantes e (opcionalmente) regenerar DANFSE.
- `POST /nfse/reprocessar-danfses`: reprocessa DANFSEs salvas para atualizar PDFs legados ou ausentes para o modelo atual.
- `GET /nfse`, `GET /nfse/separadas` e `GET /nfse/:id` retornam tambem `eventos` vinculados a cada nota.
- Os endpoints `GET /nfse/:id`, `GET /nfse/:id/xml` e `GET /nfse/:id/danfse` exigem `?clienteId=...` para garantir escopo de acesso por cliente.
  - `clienteId` deve ser UUID valido.

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
- `GET /nfe/sync/status?clienteId=...`
- `POST /nfe/importar-xml`
- `POST /nfe/sync/iniciar`
- `POST /nfe/sync/pausar`
- `POST /nfe/sync/rodar-agora`

Observacoes:

- `POST /nfe/sync/iniciar` cria ou reativa controles de busca por `cliente/cnpj/ambiente` sem misturar NSU de NFS-e.
- `POST /nfe/sync/rodar-agora` executa a distribuicao manual e persiste os documentos retornados.
- A deduplicacao de NF-e tambem ocorre por `ambiente + chave_acesso`.
- `GET /nfe` aceita filtros por `cnpjEmitente`, `cnpjDestinatario`, `cnpjConsulta`, `tipoRelacao`, periodo, status e `somenteXmlCompleto`.
- Quando `NFE_DISTRIBUICAO_CLIENT_MODE=real`, o sistema consulta `distNSU`, descompacta `docZip` e armazena resumos `resNFe` e XMLs completos retornados pelo Ambiente Nacional.

## Guia de layout do DANFSE

- Consulte `docs/danfse-pdf-guide.md` para:
  - arquitetura do renderer PDF,
  - regras de layout e colunas,
  - ajustes visuais com base no padrao oficial,
  - procedimento de regeneracao em lote.

## Consulta por relacao (emitidas/tomadas)

- Lista geral com filtro: `GET /nfse?cnpjConsulta=12345678000100&tipoRelacao=emitidas`
- Retorno separado por grupos: `GET /nfse/separadas?cnpjConsulta=12345678000100`

## Frontend de testes

Com a API rodando, abra:

- `http://localhost:3000/app`

Esse frontend permite testar onboarding de cliente/certificado, controle de sync e pesquisa de NFS-e.
O layout esta separado em 4 menus:

- `Clientes`: cadastro/edicao, certificados e contexto ativo.
- `Notas`: filtros, listagem e download em lote (ZIP XML/DANFSE) das linhas selecionadas.
- `Busca API`: execucao continua da sincronizacao ate a ultima NSU, com pausa/retomada e destaque da ultima nota capturada.
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
