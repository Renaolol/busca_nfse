# NF-e Distribuicao

Para a integracao separada de NF-e modelo 55 pela SEF/SC, consulte [docs/nfe-sc.md](nfe-sc.md). A NFC-e SC modelo 65 continua em [docs/nfce-sc.md](nfce-sc.md).

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
- `POST /nfe/sync/rodar-sefaz-cpf`
- `POST /nfe/sync/download-por-chave/preview`
- `POST /nfe/sync/download-por-chave/preview-global`
- `POST /nfe/sync/download-por-chave/executar`
- `POST /nfe/sync/download-por-chave/executar-global`
- `POST /nfe/sync/consultar-nsu`
- `POST /nfe/sync/consultar-chave`
- `GET /nfe/:id/manifestacoes?clienteId=...` (admin)
- `POST /nfe/:id/manifestacoes` (admin; evento somente com autorização expressa)
- `GET /nfe/sync/diagnostico-sefaz/status` (admin)
- `POST /nfe/sync/diagnostico-sefaz/iniciar` (admin)
- `POST /nfe/sync/diagnostico-sefaz/consultar` (admin)
- `POST /nfe/sync/diagnostico-sefaz/encerrar` (admin)
- `POST /clientes/:id/nfe/ativar`
- `POST /clientes/:id/nfe/pausar`

## Observacoes

- NF-e e NFS-e mantem controles de NSU independentes.
- A deduplicacao de NF-e ocorre por `ambiente + chave_acesso`.
- `NFE_DISTRIBUICAO_CLIENT_MODE=real` usa por padrao:
- Sem essa variavel definida exatamente como `real`, o modulo seleciona o cliente mock. O `.env.example` vem com `mock`, e o instalador do servico Windows nao injeta a variavel; confirme o valor efetivo no processo do NotaSync em producao antes de interpretar uma consulta como retorno da SEFAZ.
- producao: `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`
- homologacao: `https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`
- As URLs acima seguem a relacao oficial de servicos web do portal da NF-e e podem ser sobrescritas por env var.
- O fluxo atual implementa `distNSU`, `consNSU` e `consChNFe`.
- O modo temporario `Diagnostico manual SEFAZ` e exclusivo para administradores, dura 30 minutos e exige `NFE_DISTRIBUICAO_CLIENT_MODE=real`. Seleciona um controle e certificado ativo vinculado, suspende temporariamente as consultas automaticas para o mesmo ator/ambiente e oferece uma chamada manual `distNSU` ou `consChNFe`. `distNSU` usa o cursor existente, persiste os documentos e so o avanca depois de processar todos sem perda; `consChNFe` nao altera o cursor e so persiste se solicitado. O diagnostico mostra HTTP, `cStat`/`xMotivo`, `ultNSU`/`maxNSU`, schemas, contagens, `processingResult` (`concluido`, `sem_documentos`, `aguardando_sefaz` ou `falha`) e etapa de falha sem gravar chave, CPF/CNPJ ou XML nos logs.
- As excecoes do modo manual se limitam a bloqueios internos incrementais de sem-avanco/recuperacao historica. Elas nao ignoram `cStat 137` no proprio `distNSU`, `cStat 656`, a cota de 20 consultas pontuais por ator/hora, falhas de certificado ou outros bloqueios oficiais. O `cStat 137` de `distNSU` pausa apenas novas chamadas incrementais; nao e aplicado a `consNSU`/`consChNFe`, que sao consultas pontuais distintas. `cStat 656` continua bloqueando todas as operacoes para aquele ator durante uma hora.
- As respostas de sincronizacao incremental incluem `sefazDiagnostics` por chamada `distNSU`: modo real/mock efetivo, ambiente, HTTP, `cStat`/`xMotivo`, `ultNSU`/`maxNSU`, `docZip` recebidos, schemas, itens descompactados, descartados, tentados/processados e falhas. O log estruturado nao inclui CPF/CNPJ, certificado, chave, XML nem resposta bruta; CPFs/CNPJs que eventualmente aparecam em `xMotivo` sao mascarados. `documentsFiltered=0` porque o fluxo incremental nao descarta por periodo ou destinatario; `docZipDiscarded` identifica item sem schema ou com payload invalido e `failureStage` separa resposta, descompactacao e persistencia.
- Consultas por estabelecimento aceitam CPF (11 digitos) ou CNPJ (14 digitos). O adapter oficial envia CPF como `<CPF>` no pedido DF-e e CNPJ como `<CNPJ>`.
- Quando `NFE_SYNC_SOURCE_MODE=dominio` ou `dominio_chave`, os estabelecimentos cadastrados por CPF continuam pela distribuicao oficial da SEFAZ; estabelecimentos cadastrados por CNPJ seguem a origem Dominio configurada.
- `POST /nfe/sync/rodar-sefaz-cpf` consulta controles CPF usando a distribuicao oficial DF-e e certificado ativo vinculado ao produtor. Sem datas, continua do `ultimo_nsu_consultado` salvo via `distNSU`. Com datas, executa uma recuperacao pontual via `consNSU` a partir do maior NSU conhecido, filtra a data localmente e preserva o cursor incremental. A SEFAZ nao oferece filtro por periodo nessa API: a NT 2014.002 recomenda `distNSU` para consumir sequencialmente o conjunto de documentos, e `consNSU` para consultar um NSU pontual. A recuperacao por periodo e uma varredura limitada, nao uma garantia de que todo o historico do intervalo sera retornado; ela cobre apenas documentos ainda disponiveis (ate 90 dias) e no maximo 10.000 NSUs conhecidos. Cada ciclo consulta ate 15 NSUs; o limite oficial publicado para consultas `consNSU`/`consChNFe` e 20 por hora. O cursor e o certificado escolhidos ficam salvos e o ciclo automatico retoma a varredura depois da pausa, se auto-sync ou a busca noturna estiver habilitada. A resposta `cpfDiagnostics` diferencia consulta concluida, parcial, aguardando SEFAZ, falha e sem documentos e informa metodo, cStat/xMotivo, periodo, quantidades retornadas/importadas, resumos, eventos, documentos fora do periodo e proximo NSU. Eventos de NF-e recebidos durante a varredura sao importados pelo mesmo fluxo de eventos da distribuicao e mantidos para consistencia, mesmo quando a data do evento e diferente da data de emissao filtrada. `cStat 656` pausa consultas do ator por uma hora; `cStat 137` da distribuicao incremental tambem exige esperar uma hora antes da proxima chamada `distNSU`. A consulta nao acessa o SAT/SC.
- `GET /nfe` aceita CPF ou CNPJ em `cnpjConsulta` para filtrar documentos emitidos ou recebidos pelo produtor.
- A listagem normal de `GET /nfe` retorna somente `xmlCompletoDisponivel=true`; `somenteResumos=true` e a selecao explicita para ver `resNFe`, e `somenteXmlCompleto=false` inclui ambos. Resumo continua como pendente, nao conta como XML completo e pode ser complementado/substituido quando o XML integral chegar.
- Ocultar resumos da listagem nao solicita nem libera o XML. O documento completo continua sujeito ao servico, ao papel do interessado, a manifestacao quando aplicavel, a janela de disponibilidade e a autorizacao SEFAZ.
- O modulo `cte` implementa consulta manual por chave via `CteConsultaV4` e tentativa de captura de eventos retornados pelo autorizador.
- As rotas manuais permitem testar o ambiente real e recuperar documentos pontuais sem depender do ciclo incremental.
- Na tela `XMLs NF-e`, a acao `Baixar NF-e por chave` aceita chaves informadas diretamente e consulta cada uma por `consChNFe`, sem depender da listagem da Dominio. A resposta identifica quando a SEFAZ devolve apenas um resumo, sem XML completo. A consulta nao modifica o cursor NSU.
- A importacao via Dominio consulta `bethadba.EFATENDIMENTO_NFE_CATALOGO` e prioriza XMLs em `bethadba.EFATENDIMENTO_NFE_XML_V2`, usando `bethadba.EFATENDIMENTO_NFE_XML` como fallback. O vinculo local e feito pelo CNPJ de `bethadba.geempre.cgce_emp` e, quando o cliente tiver `codigoEmpresaDominio`, tambem por `EFATENDIMENTO_NFE_CATALOGO.CODI_EMP`.
- `POST /nfe/importar-dominio` aceita filtros por `chavesAcesso` e `catalogoIds`, permitindo reimportacao pontual a partir do painel operacional.
- `POST /nfe/dominio/xml` devolve o XML bruto de um `catalogoId` da Dominio para visualizacao interna mesmo quando a persistencia falhou por chave ausente.
- O adapter real da Dominio fica desacoplado em `src/integrations/dominio-nfe` e usa `pyodbc` via script Python para evitar acoplamento de driver nativo ao build Node.
- Quando `NFE_SYNC_SOURCE_MODE=dominio`, as rotas operacionais usam a base Dominio para controles com CNPJ. Controles com CPF continuam inicializando e consultando NSU na SEFAZ.
- Mesmo em `NFE_SYNC_SOURCE_MODE=dominio`, o operador pode usar o fluxo manual `POST /nfe/sync/download-por-chave/preview` + `POST /nfe/sync/download-por-chave/executar` para baixar notas faltantes por chave sem trocar o modo principal.
- Nesse fluxo manual, o backend pagina todo o catalogo da Dominio desde `2026-01-02`, ignora o cursor incremental salvo e preserva `ultimo_nsu_consultado`/`max_nsu` ao concluir a execucao.
- O mesmo fluxo manual aceita `dataEmissaoInicio` opcional no body para retroagir a busca, por exemplo `2026-01-01` quando o catalogo da empresa tiver notas no primeiro dia do ano.
- Quando `NFE_SYNC_SOURCE_MODE=dominio_chave`, essas mesmas rotas passam a ler a `EFATENDIMENTO_NFE_CATALOGO` incrementalmente e consultar cada NF-e por `consChNFe`, usando o certificado ja cadastrado do estabelecimento correspondente.
- Nesse modo, o catalogo da Dominio e filtrado para considerar apenas notas com emissao a partir de `2026-01-02`, isto e, com data maior que `2026-01-01`.
- Nesse modo, `nfe_sync_controle.ultimo_nsu_consultado` passa a guardar o ultimo `EFATENDIMENTO_NFE_CATALOGO.ID` importado com sucesso para cada `cliente/cnpj/ambiente`.
- Nesse modo, a leitura por chave da Dominio ocorre apenas nas execucoes manuais/esporadicas para controles com CNPJ; controles com CPF continuam consultando NSU pela SEFAZ no ciclo automatico.
- Nesse modo, o painel manual usa `POST /nfe/sync/download-por-chave/preview` e `POST /nfe/sync/download-por-chave/preview-global` para abrir um overlay de auditoria com as chaves pendentes antes do download oficial.
- O uso por chave (`consChNFe`) e uma trilha auxiliar/esporadica e tambem esta sujeito a janela de disponibilidade de 90 dias da distribuicao NF-e. Esse prazo e distinto do prazo de 90 dias para registrar manifestacao conclusiva, vigente desde 01/06/2026; nenhum dos dois deve ser tratado como promessa de recuperacao historica ilimitada.
- XMLs da Dominio com assinatura ABRASF/NFS-e sao redirecionados para `NfseService.importXml`, preservando a deduplicacao do armazenamento de servicos por `ambiente + chave_acesso`.
- XMLs da Dominio com raiz `Baixas` sao descartados na importacao, porque representam baixa financeira sem XML fiscal util para os modulos de NF-e/NFS-e.
- XMLs de CT-e (`cteProc`, `CTe`, `resCTe`, `eventoCTe`, `procEventoCTe`, modelo `57`) continuam bloqueados no modulo de NF-e. Quando vierem da Dominio, o importador os roteia para o modulo dedicado de CT-e para nao contaminar `nfe_documentos` e manter eventos/documentos de transporte no storage compartilhado correto.
- O endpoint `POST /nfe/importar-dominio` devolve `resumoImportacao` com a composicao dos XMLs persistidos (`nfeDocumentos`, `nfeEventos`, `cteDocumentos`, `cteEventos`, `nfseDocumentos`, `outrosDocumentos`). Esse resumo existe para diferenciar o total bruto importado da contagem de documentos principais exibida nos cards do dashboard.
- No modo `dominio_chave`, chaves de CT-e do catalogo passam a ser processadas automaticamente pelo backend, mas a consulta oficial e a persistencia continuam sendo feitas pelo modulo dedicado de CT-e para manter a separacao operacional entre NF-e e CT-e.
- O modulo `cte` nao persiste mais resumos invalidos de rejeicao (`retConsSitCTe_v4.00` com `Rejeicao`) como documento util e tambem os oculta das listagens `XMLs CT-e`.
- O painel da ultima importacao em `Buscas NF-e` pode abrir o XML bruto do catalogo e reimportar um item isolado ou todos os `catalogoIds` retornados na execucao manual.
- O script `npm run nfe:separar-cte -- --apply` varre `nfe_documentos`, classifica os XMLs salvos e marca CT-es ja persistidos em `schemaDoc`, permitindo que o modulo de NF-e os exclua das listagens e do dashboard sem migration adicional.
- O modulo `cte` reaproveita `nfe_documentos` como armazenamento, mas expoe consulta separada para documentos de transporte, incluindo `GET /cte`, `GET /cte/:id`, `GET /cte/:id/xml`, `GET /cte/dashboard-stats`, `POST /cte/consultar-chave` e `POST /cte/eventos/sincronizar`.
- Na tela `XMLs CT-e`, cada documento com XML completo ou resumo armazenado pode ser selecionado individualmente ou junto com todos os documentos visiveis; `Baixar XMLs selecionados` gera um ZIP por `POST /cte/download-lote`, mantendo o escopo do cliente.
- `GET /nfe` aceita o filtro opcional `modelo` (por exemplo, `55` para NF-e e `65` para NFC-e); os painéis `XMLs NF-e` e `Leitor XML 3.0` usam `modelo=55` para manter NFC-e fora dessas consultas.
- O leitor DIFAL identifica a aliquota interestadual de 4% pelo XML da NF-e, priorizando `ICMSUFDest/pICMSInter` e usando `ICMS/pICMS` como alternativa. Quando usa `pICMSInter`, tambem usa a base `ICMSUFDest/vBCUFDest` quando informada.
- `GET /nfe` e `GET /cte` agora aceitam `page` e `pageSize` (padrao `100`, maximo `200`) e retornam `{ items, total, page, pageSize, totalPages }`, permitindo paginacao real no painel de armazenados.
- Quando `CTE_CONSULTA_CLIENT_MODE=real`, o cliente SOAP de CT-e aplica fallback automatico de namespace, SOAPAction, versao SOAP e formato de `cteDadosMsg` para reduzir rejeicoes tecnicas de consulta por chave. Se ainda retornar `cStat 243`, a resposta deve ser tratada como falha da requisicao ao autorizador, nao como XML de CT-e valido.

## Manifestações e disponibilidade do XML

A tela de NF-e não exibe painel, histórico nem ações de manifestação ou consulta pontual de XML. O worker de recuperação automática de XML foi removido. Os endpoints administrativos de manifestação permanecem disponíveis para chamadas explícitas da API e não são acionados pela busca manual SEF/SC.

A listagem normal `XMLs NF-e` mostra somente documentos com XML completo. Resumos `resNFe` ficam identificados como pendentes e podem ser consultados pela opção explícita de resumos; não são contados como XML completo nem transformados em XML fiscal. A interface não consegue fazer a SEFAZ fornecer um XML que o serviço não liberou: a obtenção continua sujeita ao serviço e à autorização aplicáveis.
## Operacao recomendada

- A distribuicao DF-e deve ter um consumidor coordenado por interessado (CPF/CNPJ) e ambiente.
- Se outro ERP, robo fiscal ou integrador tambem estiver consumindo a mesma trilha de NSU do cliente, a captura concorrente pode gerar divergencia operacional entre sistemas.
- Para esses casos, desabilite a NF-e do cliente no proprio cadastro (`nfe_habilitado=false`) e mantenha apenas um consumidor ativo para aquele interessado.
- O painel `Buscas NF-e` mostra somente clientes habilitados para NF-e; a tela `Clientes` e o ponto de controle dessa flag.

## Interface manual e resumos

A tela `Buscas NF-e` mantém os painéis de rotina, filtros, status, controles e consultas manuais existentes. Foram removidos da interface o painel separado de busca SEF/SC, os controles de automação de Ciência/recuperação de XML e a lista de documentos pendentes mostrados nesses controles. A integração SEF/SC permanece disponível pelos endpoints administrativos documentados em [docs/nfe-sc.md](nfe-sc.md). O worker de recuperação automática está desligado; não há envio automático de manifestação nem consulta automática de XML completo. Os dados e registros já persistidos permanecem no banco.

A busca SEF/SC usa um cursor próprio, exige confirmação administrativa de que o vínculo do contabilista foi verificado na SEF/SC e depende da autorização que a SEF/SC valida em cada chamada. No modo padrão `mock`, nenhuma requisição real é enviada e nenhum certificado real é usado. Consulte [docs/nfe-sc.md](nfe-sc.md) para configuração e regras oficiais.

`resNFe` continua identificado como resumo pendente, não é contado como XML completo e não é transformado em XML fiscal. Separar ou ocultar um resumo na interface não faz a SEFAZ disponibilizar o XML completo; o acesso continua sujeito ao serviço e à autorização aplicáveis.

## Diagnostico cruzado com o SAT/SC

Uma nota visivel no SAT/SC nao prova que o mesmo arquivo XML sera entregue pelo Ambiente Nacional. O SAT e uma plataforma estadual com consultas fiscais locais; o relatorio estadual `NFe / NFCe - Consulta` pode consolidar documentos de ambos os modelos. O modulo NotaSync `XMLs NF-e` lista NF-e modelo 55; NFC-e modelo 65 e NFP-e/documentos de outros modelos nao devem ser contados como falha de importacao de NF-e modelo 55. O parser nacional interpreta o elemento `<CPF>` de `resNFe` como identificador do emitente, mantendo zeros a esquerda, assim como o XML completo.

Para auditar um caso real sem gravar dados pessoais nos logs, o operador deve anotar em ambiente protegido: CPF e IE do produtor; chave, modelo, emissao e papel (emitente/destinatario); status e disponibilidade exibidos no SAT; ambiente e certificado usados; retorno bruto da distribuicao (cStat, xMotivo, ultNSU, maxNSU e schema/NSU de cada `docZip`); e o resultado da importacao. Compartilhe com suporte apenas CPF mascarado e chave parcialmente mascarada. Confirme que o certificado e-CPF/e-CNPJ esta ativo e vinculado ao CPF consultado. Se a nota aparece no SAT mas nao em `distNSU`/`consNSU`, a investigacao deve ir para a SEF/SC; nao se deve assumir que o login do SAT possa ser substituido por uma API nacional ou por uma automacao do portal.

## Referencias oficiais

- Portal NF-e - NT 2014.002 v.1.40 (distribuicao DF-e; publicada em 03/07/2026): `https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=P0U3lU1Fe40%3D`
- Portal NF-e - MOC 7.0: `https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=LrBx7WT9PuA%3D`
- Portal NF-e - NT 2018.001 (emitente pessoa fisica com IE e certificado e-CPF): `https://www.nfe.fazenda.gov.br/POrtal/exibirArquivo.aspx?conteudo=PSVK9st3J8U%3D`
- Portal NF-e - NT 2020.001 v.1.60 (manifestacao do destinatario, incluindo CPF; prazo atualizado em 2026): `https://www.nfe.fazenda.gov.br/Portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=%2BWTd7iuD21s%3D`
- Portal NF-e - Web Services, incluindo Recepcao de Eventos do Ambiente Nacional: `https://www.nfe.fazenda.gov.br/PORTAL/WebServices.aspx?AspxAutoDetectCookieSupport=1`
- Portal NF-e - NT 2014.002 Web Service de Distribuicao de DF-e: `https://www.nfe.fazenda.gov.br/PORTAl/exibirArquivo.aspx?conteudo=C/xkRclIh74%3D`
- Portal NF-e - FAQ de consulta na internet: `https://www.nfe.fazenda.gov.br/Portal/perguntasFrequentes.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=auR4yGlWmRY%3D`
- Portal NF-e - Informe de manifestacao do destinatario em 90 dias (publicado em 27/05/2026, vigente a partir de 01/06/2026): `https://www.nfe.fazenda.gov.br/portal/informe.aspx?AspxAutoDetectCookieSupport=1&Informe=f9R6A+5SmSE%3D&ehCTG=false`
- Portal CT-e - FAQ de consulta na internet: `https://www.cte.fazenda.gov.br/portal/perguntasFrequentes.aspx?tipoConteudo=HC%2Fiuy94%2FRk%3D`
- SEF/SC - NFP-e e SAT para produtor primario: `https://www.sef.sc.gov.br/servicos/emitir-nfp-e-nota-fiscal-de-produtor-eletronica`
- SEF/SC - Consulta de notas em que o CPF consta como destinatario: `https://www.sef.sc.gov.br/noticias/fazenda-disponibiliza-ferramenta-que-permite-consultar-notas-fiscais-emitidas-com-cpf`
- SEF/SC - Nota Fiscal Facil para produtor primario: `https://www.sef.sc.gov.br/saiba-mais/nff-nota-fiscal-facil-produtor-primario`

