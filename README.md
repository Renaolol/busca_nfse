# App Coletor de NFS-e Nacional por NSU

Backend para sincronizar, armazenar e consultar NFS-e Nacional usando a API oficial do ADN por NSU.

## Objetivo do projeto

Centralizar a captura de NFS-e Nacional por cliente, usando consulta incremental por NSU na API oficial ADN, com trilha operacional para cadastro, sincronizacao, armazenamento, consulta e download de documentos fiscais.

## Resultado final esperado

1. Onboarding completo de cliente, estabelecimento e certificado A1 com dados sensiveis protegidos.
2. Sincronizacao historica e diaria por NSU, com controles por `cliente/cnpj/ambiente` e sem pulo de NSU em erros temporarios.
3. Base fiscal consolidada, deduplicada por `ambiente + chave_acesso`, com XML e DANFSE armazenados.
4. API interna e painel operacional com autenticacao JWT, escopo por cliente e operacoes de status/logs/pesquisa/download.
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
http://localhost:3000/api/docs
```

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
- `NFSE_ADN_CLIENT_MODE`: `mock` (padrao) ou `real`.
- `NFSE_API_BASE_URL_PRODUCAO` e `NFSE_API_BASE_URL_RESTRITA`: hosts do ADN.
- `NFSE_ADN_PATH_PREFIX`: prefixo da API (padrao `contribuintes`).
- `SYNC_AUTO_RUN_ENABLED`: habilita ciclo automatico de sync em background (padrao `true`).
- `SYNC_AUTO_RUN_INTERVAL_MS`: intervalo entre ciclos automaticos (padrao `30000`).
- `SYNC_AUTO_RUN_STARTUP_DELAY_MS`: atraso inicial apos boot para primeiro ciclo automatico (padrao `3000`).
- `SYNC_API_RETRY_DELAY_MS`: espera antes de tentar novamente quando ocorrer erro temporario de API (ex.: HTTP 429) (padrao `60000`).
- `SYNC_DAILY_INTERVAL_MS`: intervalo da rotina diaria quando o controle esta no modo `somente_novas` (padrao `86400000` = 24h).
- `SYNC_DAILY_MAX_NSU_PER_RUN`: quantidade maxima de NSUs processados por ciclo para controles no modo diario (padrao `50`).
- `CERT_MASTER_KEY`: obrigatoria e deve ser configurada com segredo proprio (a API recusa iniciar com valor placeholder `CHANGE_ME...`).
- `JWT_SECRET`: obrigatoria e deve ser configurada com segredo proprio (a API recusa iniciar com valor placeholder `CHANGE_ME...`).
- `JWT_EXPIRES_IN_SECONDS`: tempo de expiracao do token JWT em segundos (padrao `43200` = 12h).
- `AUTH_USERS_JSON`: array JSON com usuarios de acesso (`admin` e/ou `cliente`). `userId` (UUID) e opcional, mas recomendado para trilha de auditoria.

## Autenticacao e autorizacao

- Endpoint publico de login: `POST /auth/login`.
- Endpoints publicos sem token: `GET /health` e `POST /auth/login`.
- Todos os demais endpoints exigem `Authorization: Bearer <token>`.
- Para usuarios `role=cliente`, o backend valida automaticamente o escopo por `clienteId` (path/query/body) e bloqueia acesso cruzado.
- Operacoes administrativas globais (ex.: `POST /sync/rodar-agora`) exigem `role=admin`.
- Operacoes de escrita (`POST/PATCH/DELETE`) geram trilha de auditoria automatica em `auditoria_usuario` (acao, entidade, cliente, ip e user-agent).

Exemplo de `AUTH_USERS_JSON`:

```json
[
  {
    "userId": "00000000-0000-4000-8000-000000000001",
    "username": "admin",
    "password": "senha-forte-admin",
    "role": "admin"
  },
  {
    "userId": "00000000-0000-4000-8000-000000000002",
    "username": "cliente-acme",
    "password": "senha-forte-cliente",
    "role": "cliente",
    "clienteId": "550e8400-e29b-41d4-a716-446655440000"
  }
]
```

Exemplo de login:

```bash
curl -X POST http://localhost:3000/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"senha-forte-admin"}'
```

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

O endpoint `POST /sync/rodar-agora` dispara uma execucao manual do ciclo de sincronizacao (por padrao com adapter mock) e exige token `admin`.
Para teste pontual da API ADN, use o endpoint temporario `POST /sync/testar-nsu` com `clienteId`, `estabelecimentoId` e `nsu`.
Para teste real, defina `NFSE_ADN_CLIENT_MODE=real` e use certificado A1 valido no cadastro.
Para consultar logs de sync por cliente, use `GET /sync/logs?clienteId=UUID`.

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
- Em erro temporario da API (ex.: `HTTP 429`, timeout, `5xx`), o sistema **nao avanca o NSU** para evitar pulo de documentos.
- Nesses casos, a proxima tentativa e agendada com base em `SYNC_API_RETRY_DELAY_MS`.

## Importacao de XML

Use `POST /nfse/importar-xml` para carregar XMLs legados, aplicando deduplicacao por `ambiente + chave_acesso`.
No momento da importacao, o sistema tambem gera e salva o DANFSE em PDF.

## Download de XML e DANFSE

- `GET /nfse/:id/xml`: retorna XML da nota com `fileName`, `contentType` e `contentBase64`.
- `GET /nfse/:id/danfse`: retorna DANFSE em PDF com `fileName`, `contentType` e `contentBase64`.
- `POST /nfse/download-lote`: gera um arquivo ZIP em Base64 para baixar XML/DANFSE em lote.
- `POST /nfse/reprocessar-xmls`: reprocessa XMLs ja salvos para preencher campos faltantes e (opcionalmente) regenerar DANFSE.
- Os endpoints `GET /nfse/:id`, `GET /nfse/:id/xml` e `GET /nfse/:id/danfse` exigem `?clienteId=...` para garantir escopo de acesso por cliente.
  - `clienteId` deve ser UUID valido.
- Para token `role=cliente`, o valor de `clienteId` precisa ser o mesmo cliente do token.

Quando o DANFSE nao existir para uma nota ja salva, ele e gerado automaticamente a partir do XML no primeiro download.

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
Antes de operar, faca login no bloco superior (`Usuario`/`Senha`) para obter sessao JWT.
O layout esta separado em 3 menus:

- `Clientes`: cadastro/edicao, certificados e contexto ativo.
- `Notas`: filtros, listagem, separacao emitidas/tomadas e download em lote (XML/DANFSE) das linhas selecionadas.
- `Busca API`: operacoes de sync, logs, teste de NSU e escolha de modo `historico` ou `diario`.
Use a lista suspensa de clientes para selecionar o contexto ativo; ao selecionar, as notas do cliente sao carregadas automaticamente.
Edicao de dados e certificados fica disponivel via botoes \"Editar dados\" e \"Editar certificados\".
Ao criar cliente, o backend ja cria automaticamente o estabelecimento principal com o mesmo CNPJ.
No cadastro de certificado, a API extrai automaticamente validade, thumbprint, serial, emissor e subject do arquivo `.pfx/.p12`.
Certificados inativos podem ser excluidos por `DELETE /certificados/:id` (ativos exigem desativacao antes).
Nos endpoints por `id` de certificado (`GET/POST/DELETE /certificados/:id...`), informe `?clienteId=...` para validar escopo.
  - `clienteId` deve ser UUID valido.
Tambem permite consultar por CNPJ base e separar NFS-e em emitidas e tomadas.
Na tabela de resultados, os botoes `XML` e `DANFSE` fazem download direto dos arquivos.
As operacoes por ID em certificado e NFS-e usam `clienteId` como escopo (query string) para evitar acesso cruzado entre clientes.
No bloco de sincronizacao, o botao `Reprocessar XMLs` executa `POST /nfse/reprocessar-xmls` para backfill de campos e regeneracao das DANFSE.
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
