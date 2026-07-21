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
- `POST /cte/consultar-chave`
- `POST /cte/eventos/sincronizar`
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
- `POST /nfe/sync/download-por-chave/preview`
- `POST /nfe/sync/download-por-chave/preview-global`
- `POST /nfe/sync/download-por-chave/executar`
- `POST /nfe/sync/download-por-chave/executar-global`
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
- O modulo `cte` implementa consulta manual por chave via `CteConsultaV4` e tentativa de captura de eventos retornados pelo autorizador.
- As rotas manuais permitem testar o ambiente real e recuperar documentos pontuais sem depender do ciclo incremental.
- A importacao via Dominio consulta `bethadba.EFATENDIMENTO_NFE_CATALOGO` e prioriza XMLs em `bethadba.EFATENDIMENTO_NFE_XML_V2`, usando `bethadba.EFATENDIMENTO_NFE_XML` como fallback. O vinculo local continua sendo feito pelo CNPJ de `bethadba.geempre.cgce_emp`.
- `POST /nfe/importar-dominio` aceita filtros por `chavesAcesso` e `catalogoIds`, permitindo reimportacao pontual a partir do painel operacional.
- `POST /nfe/dominio/xml` devolve o XML bruto de um `catalogoId` da Dominio para visualizacao interna mesmo quando a persistencia falhou por chave ausente.
- O adapter real da Dominio fica desacoplado em `src/integrations/dominio-nfe` e usa `pyodbc` via script Python para evitar acoplamento de driver nativo ao build Node.
- Quando `NFE_SYNC_SOURCE_MODE=dominio`, as rotas operacionais `POST /nfe/sync/ativar`, `POST /nfe/sync/ativar-todos`, `POST /nfe/sync/rodar-agora` e `POST /nfe/sync/rodar-agora-geral` deixam de consultar NSU e passam a importar incrementalmente da base Dominio.
- Mesmo em `NFE_SYNC_SOURCE_MODE=dominio`, o operador pode usar o fluxo manual `POST /nfe/sync/download-por-chave/preview` + `POST /nfe/sync/download-por-chave/executar` para baixar notas faltantes por chave sem trocar o modo principal.
- Nesse fluxo manual, o backend pagina todo o catalogo da Dominio desde `2026-01-02`, ignora o cursor incremental salvo e preserva `ultimo_nsu_consultado`/`max_nsu` ao concluir a execucao.
- Quando `NFE_SYNC_SOURCE_MODE=dominio_chave`, essas mesmas rotas passam a ler a `EFATENDIMENTO_NFE_CATALOGO` incrementalmente e consultar cada NF-e por `consChNFe`, usando o certificado ja cadastrado do estabelecimento correspondente.
- Nesse modo, o catalogo da Dominio e filtrado para considerar apenas notas com emissao a partir de `2026-01-02`, isto e, com data maior que `2026-01-01`.
- Nesse modo, `nfe_sync_controle.ultimo_nsu_consultado` passa a guardar o ultimo `EFATENDIMENTO_NFE_CATALOGO.ID` importado com sucesso para cada `cliente/cnpj/ambiente`.
- Nesse modo, a leitura por chave da Dominio ocorre apenas nas execucoes manuais/esporadicas; o ciclo automatico e a busca noturna nao a disparam.
- Nesse modo, o painel manual usa `POST /nfe/sync/download-por-chave/preview` e `POST /nfe/sync/download-por-chave/preview-global` para abrir um overlay de auditoria com as chaves pendentes antes do download oficial.
- O uso por chave ficou documentado como trilha auxiliar/esporadica. Em 17/07/2026, os prazos oficiais consultados indicam 180 dias para consulta completa de NF-e e CT-e; no ecossistema NF-e, a manifestacao conclusiva do destinatario passou para 90 dias a partir de 01/06/2026. Portanto, chaves antigas frequentemente retornam falhas definitivas como `cStat 632` e nao devem ser tratadas como backlog ordinario.
- XMLs da Dominio com assinatura ABRASF/NFS-e sao redirecionados para `NfseService.importXml`, preservando a deduplicacao do armazenamento de servicos por `ambiente + chave_acesso`.
- XMLs da Dominio com raiz `Baixas` sao descartados na importacao, porque representam baixa financeira sem XML fiscal util para os modulos de NF-e/NFS-e.
- XMLs de CT-e (`cteProc`, `CTe`, `resCTe`, `eventoCTe`, `procEventoCTe`, modelo `57`) continuam bloqueados no modulo de NF-e. Quando vierem da Dominio, o importador os roteia para o modulo dedicado de CT-e para nao contaminar `nfe_documentos` e manter eventos/documentos de transporte no storage compartilhado correto.
- No modo `dominio_chave`, chaves de CT-e do catalogo passam a ser processadas automaticamente pelo backend, mas a consulta oficial e a persistencia continuam sendo feitas pelo modulo dedicado de CT-e para manter a separacao operacional entre NF-e e CT-e.
- O modulo `cte` nao persiste mais resumos invalidos de rejeicao (`retConsSitCTe_v4.00` com `Rejeicao`) como documento util e tambem os oculta das listagens `XMLs CT-e`.
- O painel da ultima importacao em `Buscas NF-e` pode abrir o XML bruto do catalogo e reimportar um item isolado ou todos os `catalogoIds` retornados na execucao manual.
- O script `npm run nfe:separar-cte -- --apply` varre `nfe_documentos`, classifica os XMLs salvos e marca CT-es ja persistidos em `schemaDoc`, permitindo que o modulo de NF-e os exclua das listagens e do dashboard sem migration adicional.
- O modulo `cte` reaproveita `nfe_documentos` como armazenamento, mas expoe consulta separada para documentos de transporte, incluindo `GET /cte`, `GET /cte/:id`, `GET /cte/:id/xml`, `GET /cte/dashboard-stats`, `POST /cte/consultar-chave` e `POST /cte/eventos/sincronizar`.
- `GET /nfe` e `GET /cte` agora aceitam `page` e `pageSize` (padrao `100`, maximo `200`) e retornam `{ items, total, page, pageSize, totalPages }`, permitindo paginacao real no painel de armazenados.
- Quando `CTE_CONSULTA_CLIENT_MODE=real`, o cliente SOAP de CT-e aplica fallback automatico de namespace, SOAPAction, versao SOAP e formato de `cteDadosMsg` para reduzir rejeicoes tecnicas de consulta por chave. Se ainda retornar `cStat 243`, a resposta deve ser tratada como falha da requisicao ao autorizador, nao como XML de CT-e valido.

## Operacao recomendada

- A distribuicao DF-e deve ter um consumidor coordenado por interessado/CNPJ.
- Se outro ERP, robo fiscal ou integrador tambem estiver consumindo a mesma trilha de NSU do cliente, a captura concorrente pode gerar divergencia operacional entre sistemas.
- Para esses casos, desabilite a NF-e do cliente no proprio cadastro (`nfe_habilitado=false`) e mantenha apenas um consumidor ativo para aquele interessado.
- O painel `Buscas NF-e` mostra somente clientes habilitados para NF-e; a tela `Clientes` e o ponto de controle dessa flag.

## Referencias oficiais

- Portal NF-e - MOC 7.0: `https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=LrBx7WT9PuA%3D`
- Portal NF-e - NT 2014.002 Web Service de Distribuicao de DF-e: `https://www.nfe.fazenda.gov.br/PORTAl/exibirArquivo.aspx?conteudo=C/xkRclIh74%3D`
- Portal NF-e - FAQ de consulta na internet: `https://www.nfe.fazenda.gov.br/Portal/perguntasFrequentes.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=auR4yGlWmRY%3D`
- Portal NF-e - Informe de manifestacao do destinatario em 90 dias (publicado em 27/05/2026, vigente a partir de 01/06/2026): `https://www.nfe.fazenda.gov.br/portal/informe.aspx?AspxAutoDetectCookieSupport=1&Informe=f9R6A+5SmSE%3D&ehCTG=false`
- Portal CT-e - FAQ de consulta na internet: `https://www.cte.fazenda.gov.br/portal/perguntasFrequentes.aspx?tipoConteudo=HC%2Fiuy94%2FRk%3D`
