# Plano de captura de eventos fiscais

## Objetivo

Criar uma trilha de captura de eventos para documentos ja salvos no app, cobrindo todos os modelos fiscais operados pelo projeto, sem quebrar:

- deduplicacao por `ambiente + chave_acesso`;
- isolamento por `clienteId`;
- independencia entre cursores de documentos e cursores de eventos;
- regra de nao reiniciar NSU por troca de certificado.

## Estado atual

### NFS-e

- Ja existe persistencia propria para eventos em `nfse_eventos`.
- O parser de NFS-e ja reconhece XMLs de evento nacional e vincula pela `chNFSe`.
- O adapter ADN ja possui consulta por chave em `/NFSe/{chave}/Eventos`.
- Ainda nao existe rotina operacional para consultar eventos das NFS-e ja salvas.

### NF-e

- Existe pipeline de documento principal via distribuicao DF-e e importacao manual.
- Ainda nao existe tabela de eventos, parser de eventos nem rotina de sincronizacao por chave/documento salvo.

### CT-e

- O modulo `cte` ainda reaproveita `nfe_documentos` como armazenamento.
- Ainda nao existe estrutura de eventos nem adapter dedicado para captura de eventos de transporte.

## Principios do desenho

1. Evento e um complemento do documento, nao substitui o cursor incremental da nota.
2. Backfill de eventos nao altera `ultimo_nsu_consultado` de NFS-e nem de NF-e.
3. Toda consulta de evento deve ser idempotente e segura para reexecucao.
4. A deduplicacao do evento deve considerar ao menos:
   - `ambiente`
   - `chave_acesso`
   - `tipo_evento`
   - `data_evento`
   - `hash_xml`
5. Integracoes externas continuam encapsuladas em adapters.

## Fases

### Fase 1 - NFS-e manual por demanda

Entregar um endpoint/manual operation para consultar eventos das NFS-e ja armazenadas:

- filtro por `clienteId`, `estabelecimentoId`, `ambiente`, `chaveAcesso`;
- opcao de priorizar apenas notas sem eventos;
- consulta ao ADN por chave usando o certificado do estabelecimento da nota;
- reaproveitamento do pipeline atual de importacao de XML de evento;
- sem alterar schema nem NSU.

Resultado esperado:

- primeira entrega operacional;
- baixo risco;
- reuso do parser e da tabela `nfse_eventos` ja existentes.

### Fase 2 - NFS-e automatica

Adicionar rotina recorrente para NFS-e:

- job idempotente;
- controle de tentativas e backoff;
- marca de ultima consulta de eventos por documento ou tabela de controle dedicada;
- monitoramento e logs operacionais separados dos logs de NSU.

### Fase 3 - Infra comum para NF-e

Adicionar base estrutural para eventos de NF-e:

- migration Prisma para `nfe_eventos`;
- parser para `procEventoNFe` e eventos relacionados;
- vinculacao ao `nfe_documentos`;
- endpoint manual de sincronizacao de eventos por documentos salvos.

### Fase 4 - CT-e

Fechar antes a decisao estrutural:

- manter CT-e compartilhando `nfe_documentos`, com tabela de eventos ligada ao documento compartilhado;
ou
- separar CT-e em storage/schema proprio e entao criar `cte_eventos`.

Sem essa decisao, a implementacao de eventos de CT-e tende a nascer inconsistente.

## Recorte inicial implementado

Nesta etapa do projeto vamos iniciar pela Fase 1:

- documentacao do plano;
- endpoint manual de sincronizacao de eventos de NFS-e;
- testes da normalizacao/importacao;
- atualizacao de README/OpenAPI.

## Fora do escopo desta etapa

- novo schema para NF-e;
- sincronizacao automatica de eventos em background;
- tela dedicada no frontend;
- captura de eventos de CT-e.
