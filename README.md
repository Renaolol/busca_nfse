# App Coletor de NFS-e Nacional por NSU

Backend para sincronizar, armazenar e consultar NFS-e Nacional usando a API oficial do ADN por NSU.

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
```

## Sincronizacao manual

O endpoint `POST /sync/rodar-agora` dispara uma execucao manual do ciclo de sincronizacao (por padrao com adapter mock).
Para teste pontual da API ADN, use o endpoint temporario `POST /sync/testar-nsu` com `clienteId`, `estabelecimentoId` e `nsu`.
Para teste real, defina `NFSE_ADN_CLIENT_MODE=real` e use certificado A1 valido no cadastro.

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
- `POST /nfse/reprocessar-xmls`: reprocessa XMLs ja salvos para preencher campos faltantes e (opcionalmente) regenerar DANFSE.

Quando o DANFSE nao existir para uma nota ja salva, ele e gerado automaticamente a partir do XML no primeiro download.

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
Use a lista suspensa de clientes para selecionar o contexto ativo; ao selecionar, as notas do cliente sao carregadas automaticamente.
Edicao de dados e certificados fica disponivel via botoes \"Editar dados\" e \"Editar certificados\".
Ao criar cliente, o backend ja cria automaticamente o estabelecimento principal com o mesmo CNPJ.
No cadastro de certificado, a API extrai automaticamente validade, thumbprint, serial, emissor e subject do arquivo `.pfx/.p12`.
Certificados inativos podem ser excluidos por `DELETE /certificados/:id` (ativos exigem desativacao antes).
Tambem permite consultar por CNPJ base e separar NFS-e em emitidas e tomadas.
Na tabela de resultados, os botoes `XML` e `DANFSE` fazem download direto dos arquivos.
No bloco de sincronizacao, o botao `Reprocessar XMLs` executa `POST /nfse/reprocessar-xmls` para backfill de campos e regeneracao das DANFSE.
Quando houver pendencias (sem certificado, sem sync ou sem notas), o painel exibe mensagens explicativas.

## Links oficiais NFS-e

- Portal Nacional: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
- Manual ADN: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf
- Manual Emissor Publico API: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf
