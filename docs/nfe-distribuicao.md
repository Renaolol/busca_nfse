# NF-e Distribuicao

## Objetivo

Criar a base de captura de NF-e de compra e venda sem acoplar regras da SEFAZ ao fluxo existente de NFS-e.

## Escopo desta entrega

- Novas tabelas `nfe_sync_controle` e `nfe_documentos`.
- Novo modulo NestJS `nfe` com controller, service, DTOs e testes.
- Novo parser de XML para `resNFe` e `procNFe`.
- Novo adapter `nfe-distribuicao` com implementacao `mock` para desenvolvimento e testes.
- Implementacao `real` com SOAP 1.2, mTLS, leitura de `distNSU` e descompactacao de `docZip`.

## Reaproveitamento

- Certificados A1 ja cadastrados.
- Cliente e estabelecimento como escopo operacional.
- Storage local para XMLs.
- Prisma, Swagger e trilha de testes do projeto.

## Endpoints

- `GET /nfe`
- `GET /nfe/:id`
- `GET /nfe/:id/xml`
- `GET /nfe/dashboard-stats`
- `GET /cte`
- `GET /cte/:id`
- `GET /cte/:id/xml`
- `GET /cte/dashboard-stats`
- `GET /nfe/sync/status?clienteId=...`
- `POST /nfe/importar-dominio`
- `POST /nfe/dominio/xml`
- `POST /nfe/importar-xml`
- `POST /nfe/sync/iniciar`
- `POST /nfe/sync/ativar`
- `POST /nfe/sync/ativar-todos`
- `POST /nfe/sync/pausar`
- `POST /nfe/sync/rodar-agora`
- `POST /nfe/sync/rodar-agora-geral`
- `POST /nfe/sync/consultar-nsu`
- `POST /nfe/sync/consultar-chave`
- `POST /clientes/:id/nfe/ativar`
- `POST /clientes/:id/nfe/pausar`

## Observacoes

- NF-e e NFS-e mantem controles de NSU independentes.
- A deduplicacao de NF-e ocorre por `ambiente + chave_acesso`.
- `NFE_DISTRIBUICAO_CLIENT_MODE=real` usa por padrao:
- producao: `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`
- homologacao: `https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`
- As URLs acima seguem a relacao oficial de servicos web do portal da NF-e e podem ser sobrescritas por env var.
- O fluxo atual implementa `distNSU`, `consNSU` e `consChNFe`.
- As rotas manuais permitem testar o ambiente real e recuperar documentos pontuais sem depender do ciclo incremental.
- A importacao via Dominio consulta `bethadba.EFATENDIMENTO_NFE_CATALOGO` e prioriza XMLs em `bethadba.EFATENDIMENTO_NFE_XML_V2`, usando `bethadba.EFATENDIMENTO_NFE_XML` como fallback. O vinculo local continua sendo feito pelo CNPJ de `bethadba.geempre.cgce_emp`.
- `POST /nfe/importar-dominio` aceita filtros por `chavesAcesso` e `catalogoIds`, permitindo reimportacao pontual a partir do painel operacional.
- `POST /nfe/dominio/xml` devolve o XML bruto de um `catalogoId` da Dominio para visualizacao interna mesmo quando a persistencia falhou por chave ausente.
- O adapter real da Dominio fica desacoplado em `src/integrations/dominio-nfe` e usa `pyodbc` via script Python para evitar acoplamento de driver nativo ao build Node.
- Quando `NFE_SYNC_SOURCE_MODE=dominio`, as rotas operacionais `POST /nfe/sync/ativar`, `POST /nfe/sync/ativar-todos`, `POST /nfe/sync/rodar-agora` e `POST /nfe/sync/rodar-agora-geral` deixam de consultar NSU e passam a importar incrementalmente da base Dominio.
- Quando `NFE_SYNC_SOURCE_MODE=dominio_chave`, essas mesmas rotas passam a ler a `EFATENDIMENTO_NFE_CATALOGO` incrementalmente e consultar cada NF-e por `consChNFe`, usando o certificado ja cadastrado do estabelecimento correspondente.
- Nesse modo, o catalogo da Dominio e filtrado para considerar apenas notas com emissao a partir de `2026-01-02`, isto e, com data maior que `2026-01-01`.
- Nesse modo, `nfe_sync_controle.ultimo_nsu_consultado` passa a guardar o ultimo `EFATENDIMENTO_NFE_CATALOGO.ID` importado com sucesso para cada `cliente/cnpj/ambiente`.
- XMLs da Dominio com assinatura ABRASF/NFS-e sao redirecionados para `NfseService.importXml`, preservando a deduplicacao do armazenamento de servicos por `ambiente + chave_acesso`.
- XMLs da Dominio com raiz `Baixas` sao descartados na importacao, porque representam baixa financeira sem XML fiscal util para os modulos de NF-e/NFS-e.
- XMLs de CT-e (`cteProc`, `CTe`, `resCTe`, modelo `57`) sao bloqueados no modulo de NF-e. Quando vierem da Dominio, o importador os ignora explicitamente para nao contaminar `nfe_documentos`.
- No modo `dominio_chave`, chaves de CT-e tambem sao ignoradas, porque o fluxo oficial validado para CT-e nao oferece consulta equivalente por chave.
- O painel da ultima importacao em `Buscas NF-e` pode abrir o XML bruto do catalogo e reimportar um item isolado ou todos os `catalogoIds` retornados na execucao manual.
- O script `npm run nfe:separar-cte -- --apply` varre `nfe_documentos`, classifica os XMLs salvos e marca CT-es ja persistidos em `schemaDoc`, permitindo que o modulo de NF-e os exclua das listagens e do dashboard sem migration adicional.
- O modulo `cte` reaproveita `nfe_documentos` como armazenamento, mas expoe consulta separada para documentos de transporte, incluindo `GET /cte`, `GET /cte/:id`, `GET /cte/:id/xml` e `GET /cte/dashboard-stats`.
- `GET /nfe` e `GET /cte` agora aceitam `page` e `pageSize` (padrao `100`, maximo `200`) e retornam `{ items, total, page, pageSize, totalPages }`, permitindo paginacao real no painel de armazenados.

## Operacao recomendada

- A distribuicao DF-e deve ter um consumidor coordenado por interessado/CNPJ.
- Se outro ERP, robo fiscal ou integrador tambem estiver consumindo a mesma trilha de NSU do cliente, a captura concorrente pode gerar divergencia operacional entre sistemas.
- Para esses casos, desabilite a NF-e do cliente no proprio cadastro (`nfe_habilitado=false`) e mantenha apenas um consumidor ativo para aquele interessado.
- O painel `Buscas NF-e` mostra somente clientes habilitados para NF-e; a tela `Clientes` e o ponto de controle dessa flag.

## Referencias oficiais

- Portal NF-e - MOC 7.0: `https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=LrBx7WT9PuA%3D`
- Portal NF-e - NT 2014.002 Web Service de Distribuicao de DF-e: `https://www.nfe.fazenda.gov.br/PORTAl/exibirArquivo.aspx?conteudo=C/xkRclIh74%3D`
