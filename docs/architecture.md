# Architecture

## Objetivo do sistema

Coletar NFS-e Nacional na API oficial ADN por NSU, por contexto de `cliente/cnpj/ambiente`, e disponibilizar uma camada operacional segura para consulta fiscal e download de documentos, com base separada para NF-e de mercadorias.

## Resultado final esperado

1. Entrada segura de dados de cliente e certificado (com criptografia de credenciais).
2. Sincronizacao continua e confiavel das notas, sem perda por avancos indevidos de NSU.
3. Persistencia deduplicada dos documentos fiscais e seus artefatos (XML/DANFSE).
4. Exposicao de API e interface operacional para uso interno, com escopo de cliente nos endpoints necessarios.
5. Rotinas idempotentes de manutencao para preservar qualidade e disponibilidade da base.

## Visao geral

A aplicacao segue arquitetura backend-first:

1. Adapter da API oficial NFS-e/ADN
2. Adapter de distribuicao NF-e desacoplado do fluxo de servicos
3. Worker/servicos de sincronizacao por NSU
4. Persistencia em PostgreSQL
5. Armazenamento de XML/PDF via provider de storage (implementacao local no MVP)
6. API interna com validacoes de escopo por `clienteId` nos endpoints multi-tenant
7. Frontend operacional interno servido pela propria API em `frontend/app.js`
8. Historicos operacionais persistidos em banco quando fazem sentido para analise futura, como comparacoes SPED

## Regras de elegibilidade operacional

- `clientes.ativo` controla a elegibilidade geral do cliente no sistema.
- `clientes.nfe_habilitado` controla especificamente a participacao do cliente nas rotinas de NF-e.
- NFS-e e NF-e compartilham cadastro de cliente, estabelecimento e certificado, mas possuem filas, controles e politica operacional independentes.
- Quando `nfe_habilitado=false`, o cliente deixa de participar de:
  - ativacao automatica/global de NF-e,
  - ciclo automatico/global de distribuicao NF-e,
  - painel operacional `Buscas NF-e`.

## Modulos

- `clients`
- `establishments`
- `certificates`
- `sync`
- `nfse`
- `compare-sped`
- `nfe`
- `simples-nacional`
- `audit`
- `storage`
- `jobs`
- `health`

## Persistencia de comparacoes SPED

- O frontend de `Compara SPED` envia cada resultado gerado para `POST /comparacoes-sped`.
- O backend salva o relatorio completo em `compare_sped_historicos` para permitir reabertura e download novamente mesmo apos atualizar a aba.
- A listagem de `GET /comparacoes-sped` devolve os ultimos itens persistidos e alimenta o bloco `Ultimas comparacoes` da interface.
- O frontend tambem espelha o historico em `localStorage` para manter a experiencia caso a API fique indisponivel temporariamente.

## Tabela de empresas do Simples Nacional

- A aba `Configuracoes > Empresas do Simples Nacional` compacta CSVs grandes em gzip no navegador (`CompressionStream`) e envia o arquivo bruto (XHR com progresso) para `POST /simples-nacional/importacoes`; o backend grava em `os.tmpdir()/nfse-simples-*`, responde `202` e processa em segundo plano. A tela acompanha por `GET /simples-nacional`.
- `SimplesNacionalPlanilhaParserService` le em streaming `.csv`/`.txt`, gzip e `.zip` (diretorio central lido diretamente e entrada descompactada com `zlib`, com suporte a ZIP64) e le `.xlsx` em memoria via `jszip`. Detecta o layout do arquivo Simples da Receita, colunas de CNPJ, razao social e opcao, e valida o digito verificador. Entrega as empresas em lotes.
- `SimplesNacionalService` regrava a tabela em uma unica transacao interativa (`createMany` com `skipDuplicates`), atualiza o progresso por batimento e marca como interrompida a importacao sem batimento recente (os jobs avulsos sobem o `AppModule`, por isso nao ha efeito colateral no startup). Expoe `consultarCnpj` e `filtrarBasesOptantes` para outros modulos.
- A busca da aba (`GET /simples-nacional/empresas?busca=`) consulta CNPJ/raiz pela chave primaria e nomes pelo indice GIN de texto completo (`$queryRaw`), sem contagem exata e com `statement_timeout` de 20 s.
- Em `Armazenados`, o frontend consulta em lote (`POST /simples-nacional/consultas`) as raizes dos emitentes listados e guarda o resultado em memoria ate a proxima importacao.

## Pontos arquiteturais que merecem atencao

- O frontend atual e funcional, mas esta concentrado majoritariamente em um unico arquivo (`frontend/app.js`), o que aumenta risco de regressao em manutencoes visuais e operacionais.
- O dominio de NFS-e possui trilha de logs de sincronizacao mais madura do que o dominio de NF-e; hoje o troubleshooting de NF-e depende mais do estado dos controles e dos logs gerais da aplicacao.
