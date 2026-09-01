# Troubleshooting

## Falha de conexao no banco

- Verificar `docker compose ps`.
- Conferir `DATABASE_URL`.

## MinIO indisponivel

- Verificar servicos `minio` e `minio-init`.
- Conferir `S3_ENDPOINT` e credenciais.

## Erro na sincronizacao

- Verificar status em `nfse_sync_controle`.
- Consultar `nfse_sync_logs`.
- Para `GET /sync/logs`, informar `clienteId` valido (UUID) na query string.
- Validar certificado ativo e validade.
- Se o objetivo for teste real, confirmar `NFSE_ADN_CLIENT_MODE=real`.
- Conferir `NFSE_API_BASE_URL_RESTRITA`/`NFSE_API_BASE_URL_PRODUCAO` e conectividade HTTPS mTLS.
- Se aparecer `self-signed certificate in certificate chain`, a conexao TLS foi interceptada ou a cadeia CA retornada nao e confiavel para o servidor onde a API roda.
- Nesse caso, verificar proxy corporativo/inspecao HTTPS, cadeia de certificados intermediarios/raiz instalada no sistema operacional e qualquer balanceador na frente do endpoint ADN.
- Se aparecer `HTTP 429`, reduzir frequencia de consulta e ajustar:
  - `SYNC_AUTO_RUN_INTERVAL_MS`
  - `SYNC_API_RETRY_DELAY_MS`
  - `SYNC_API_RETRY_JITTER_MS`
  - `SYNC_DAILY_MAX_NSU_PER_RUN`
  - `SYNC_DAILY_STOP_ON_FIRST_DOCUMENT`
  - `SYNC_DAILY_SUCCESS_COOLDOWN_MS`
  - `SYNC_ADN_REQUEST_INTERVAL_MS`
  - `SYNC_ADN_RATE_LIMIT_COOLDOWN_MS`
- Em `429/timeout/5xx`, o sistema nao avanca NSU (evita pulo de documento) e agenda nova tentativa.
- Se a busca noturna nao estiver rodando, conferir:
  - `SYNC_NIGHTLY_SWEEP_ENABLED=true`
  - horarios salvos em `PUT /sync/scheduler-settings` ou a variavel `SYNC_NIGHTLY_SWEEP_SLOTS`
  - fallback legado: `SYNC_NIGHTLY_SWEEP_HOUR` / `SYNC_NIGHTLY_SWEEP_MINUTE`
  - `SYNC_NIGHTLY_SWEEP_TIMEZONE_OFFSET_MINUTES`
  - logs da aplicacao contendo `Busca noturna`.

## NF-e nao aparece no painel ou nao captura novas notas

- Confirmar se o cliente esta com `nfe_habilitado=true`.
  - A flag pode ser alterada em `Clientes` ou via `POST /clientes/:id/nfe/ativar` / `POST /clientes/:id/nfe/pausar`.
- Se o cliente estiver desabilitado para NF-e, ele nao aparece em `Buscas NF-e`, nao entra no lote `ativar-todos` e nao participa de `rodar-agora-geral`.
- Se houver outro ERP/robo consumindo `NFeDistribuicaoDFe` para o mesmo interessado/CNPJ, evitar consumidores concorrentes.
  - Recomendacao: manter apenas um capturador ativo por cliente.
  - Se necessario, deixar este app desabilitado para NF-e naquele cliente.
- Se o backend foi atualizado e a flag ainda nao existe no banco, aplicar migration antes de subir o servico:

```bash
npm run prisma:deploy
```

- Se `prisma:deploy` falhar com erro de conexao no PostgreSQL, subir/verificar o banco antes de reiniciar a API.

## Download por chave retorna muitas falhas definitivas

- Trate `Download por chave` como operacao manual/esporadica, nao como trilha principal de captura.
- Em 17/07/2026, os prazos oficiais consultados indicam:
  - NF-e: consulta completa na internet por 180 dias;
  - CT-e: consulta completa na internet por 180 dias;
  - NF-e: manifestacao conclusiva do destinatario em 90 dias desde 01/06/2026.
- Consequencia pratica:
  - `cStat 632` em NF-e normalmente indica documento fora da janela operacional de download;
  - repetir a mesma chave tende a gerar a mesma falha e pouco ganho operacional.
- Se a intencao for manter captura rotineira, prefira:
  - distribuicao incremental (`distNSU`) para NF-e;
  - importacao direta da Dominio quando o XML ja existe la;
  - execucao por chave apenas para casos pontuais e recentes.

## CT-e por chave retorna `cStat 243 Rejeicao: XML Mal Formado`

- `cStat 243` no CT-e significa rejeicao tecnica da mensagem enviada ao autorizador; nao e XML fiscal valido.
- O backend atual nao persiste mais esse retorno como documento util e a listagem `XMLs CT-e` oculta resumos antigos de rejeicao.
- O cliente real de CT-e ja tenta fallbacks de:
  - versao SOAP,
  - `SOAPAction`,
  - namespace do envelope,
  - formato do payload em `cteDadosMsg`.
- Se o erro continuar apos atualizar/reiniciar o backend que serve `dist/main.js`, o proximo passo recomendado e capturar logs tecnicos temporarios da variante SOAP usada na tentativa.

## CT-e por chave ou eventos retornam `cStat 410` ou `236`

- `cStat 410` em CT-e significa que a requisicao foi enviada para um WebService que nao atende a UF embutida na chave de acesso.
- Esse caso aparece com frequencia quando `CTE_CONSULTA_URL_PRODUCAO` foi fixada para uma UF/autorizador e o lote mistura chaves de outras UFs.
- O backend passou a refazer automaticamente a consulta no endpoint padrao resolvido pelo `cUF` da chave quando a URL fixa de producao devolve `410`.
- Alertas de `CT-e` com evento de `desacordo` agora sao lidos do backend via `GET /alertas` e a marcacao de resolvido fica persistida na tabela `cte_desacordo_resolucoes`.
- Alertas de `NFS-e` tomada com retencao tambem saem de `GET /alertas`; quando o XML indicar `ISS retido` ou retencoes federais (`IRRF`, `INSS`, `CSLL`, `PIS`, `COFINS`), o dashboard passa a exibir aviso com empresa, numero, emissor e resumo das retencoes. Esse recorte considera apenas notas com emissao a partir de `01/07/2026`.
- As demais resolucoes de alertas operacionais e de auditoria tambem passaram a ser persistidas em banco via `GET /alertas/resolucoes` e `PUT /alertas/resolucoes/:alertId`, na tabela `alert_resolutions`.
- `cStat 236` com mensagem sobre `Modelo diferente de 57 ou 67 ou 64` indica que a chave enviada ao fluxo de CT-e nao pertence a CT-e. O backend agora bloqueia essa consulta antes de chamar o autorizador.

## CT-e cancelado aparece sem XML de evento

- O `CteConsultaV4` informa o cancelamento homologado com `cStat 101`, mas alguns retornos nao incluem o XML `procEventoCTe`.
- Nessa situacao a auditoria da busca de eventos mostra `Cancelado`, atualiza a situacao armazenada do CT-e e esclarece que nenhum XML de evento foi retornado. O sistema nao cria XML de cancelamento artificialmente.

## Numero do CT-e diverge da chave de acesso

- A chave de acesso do CT-e contem a serie (posicoes 23-25) e o numero (posicoes 26-34). Ela e a fonte de identificacao usada pelo sistema.
- Se um registro legado exibir outro numero para a mesma chave, a listagem passa a apresentar os dados codificados na chave. Na proxima busca manual de eventos, o numero e a serie armazenados tambem sao corrigidos antes da consulta ao autorizador.

## CT-e subcontratado substitui o CT-e principal

- O XML de um CT-e subcontratado pode conter a chave do CT-e principal em `infCteSub/chCTe`. Essa chave e apenas uma referencia; a identidade do documento e o atributo `Id` de `infCte`.
- O importador prioriza o `Id` de `infCte`. Quando uma associacao antiga tiver sido gravada pela chave referenciada, a proxima busca manual de eventos recupera o CT-e subcontratado como documento proprio, preservando ambos na listagem.

## Erro de escopo (`clienteId`)

- Em endpoints por `id` de NFS-e e logs (`/nfse/:id...`, `/sync/logs`), `clienteId` e obrigatorio.
- Em endpoints por `id` de certificado, `clienteId` e obrigatorio apenas quando o certificado esta vinculado a cliente. Certificados avulsos devem omitir `clienteId`.
- O valor de `clienteId` precisa ser UUID valido; caso contrario a API retorna `400`.
- Se o `clienteId` nao corresponder ao dono do recurso, a API responde como nao encontrado (`404`) para evitar vazamento de contexto.

## Erro ao cadastrar certificado

- Conferir se o arquivo enviado e `.pfx` ou `.p12`.
- Conferir senha do certificado.
- O backend extrai a validade automaticamente; se falhar, o cadastro e recusado.
- Se ocorrer `413 Payload Too Large`, aumentar `REQUEST_BODY_LIMIT` (ex.: `10mb`).
- Se aparecer erro de OpenSSL ausente, instalar OpenSSL no ambiente onde a API esta rodando.

## Erro ao iniciar a API

- Se a API falhar no bootstrap com mensagem sobre `CERT_MASTER_KEY`, configure valor seguro em `.env`.
- Se estiver em `NODE_ENV=production`, confirme:
  - `NFSE_ADN_CLIENT_MODE=real`
  - `NFSE_ADN_REJECT_UNAUTHORIZED=true`
- Se `/api/docs` nao abrir, verificar `ENABLE_SWAGGER` (em producao, o recomendado e `false`).
- Valores placeholder iniciando com `CHANGE_ME` sao recusados por seguranca.
