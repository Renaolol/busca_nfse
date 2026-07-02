# Revisao Operacional e Evolutiva - 2026-07

## Resumo executivo

O app ja cobre bem o fluxo principal de captura e consulta de NFS-e e possui uma base funcional de NF-e com distribuicao incremental, mas ha diferencas importantes de maturidade entre os dois dominios.

Os maiores pontos de atencao hoje estao em:

1. governanca operacional da NF-e por cliente,
2. observabilidade mais fraca do fluxo NF-e quando comparado ao fluxo NFS-e,
3. risco de regressao no frontend por concentracao excessiva de logica em `frontend/app.js`,
4. dependencias operacionais externas, principalmente banco/migrations e concorrencia com outros consumidores de DF-e.

## Pontos fortes atuais

- Separacao correta entre os dominios de NFS-e e NF-e no backend.
- Reaproveitamento seguro de cliente, estabelecimento, certificado e storage.
- Regras conservadoras de NSU para NFS-e, evitando avancos indevidos em erro temporario.
- Cobertura automatizada relevante no backend, incluindo integracoes e cenarios de sync.
- Painel operacional suficiente para onboarding, consulta, download e execucao manual.

## Pontos de atencao imediata

### 1. Conflito de consumidores externos na NF-e

- A distribuicao DF-e deve ser tratada como trilha operacional coordenada por interessado/CNPJ.
- Se outro ERP ou integrador tambem consume a mesma distribuicao, pode haver divergencia pratica entre sistemas.
- Mitigacao atual: `clientes.nfe_habilitado` permite excluir clientes especificos da rotina NF-e deste app.

### 2. Maturidade desigual entre NFS-e e NF-e

- NFS-e possui trilha de sync mais completa (`nfse_sync_logs`, logs por NSU, reprocessamento de lacunas).
- NF-e ainda depende mais do estado do controle e dos logs gerais da aplicacao.
- Consequencia: troubleshooting de NF-e tende a ser mais manual.

### 3. Frontend operacional muito concentrado

- O frontend atual entrega valor, mas a maior parte da logica esta em um unico arquivo.
- Isso aumenta custo de manutencao, chance de regressao visual e dificuldade para testes automatizados de interface.

### 4. Configuracoes visuais ainda nao persistidas no backend

- Alguns campos do painel existem como apoio visual/operacional, mas nao representam configuracao persistida de dominio.
- Antes de ampliar esses campos, vale decidir se eles serao:
  - removidos da UI,
  - mantidos apenas como informacao,
  - ou promovidos a configuracao real de backend com schema proprio.

### 5. Upgrade operacional depende de migration aplicada

- A aplicacao exige disciplina de deploy para schema Prisma.
- Quando uma migration nao e aplicada, o frontend e a API podem aparentar inconsistencias de comportamento.

## Evolucoes recomendadas

### Prioridade alta

- Criar trilha de logs propria para NF-e, equivalente ao que ja existe em NFS-e.
- Adicionar indicadores no painel para diferenciar:
  - cliente sem NF-e habilitada,
  - cliente habilitado sem controle criado,
  - cliente com controle em erro,
  - cliente com captura ativa.
- Expor no painel um check de precondicoes operacionais:
  - banco acessivel,
  - migrations pendentes,
  - storage acessivel,
  - scheduler ligado.

### Prioridade media

- Modularizar o frontend em arquivos menores por pagina/domino.
- Introduzir testes de interface para fluxos criticos:
  - cadastro/edicao de cliente,
  - habilitar/desabilitar NF-e,
  - busca e download de XML,
  - painel de controles NF-e.
- Persistir de forma explicita as configuracoes operacionais que hoje estao apenas no painel, caso elas realmente façam parte do produto.

### Prioridade baixa

- Criar uma tela de governanca operacional por dominio fiscal:
  - clientes com NFS-e habilitada,
  - clientes com NF-e habilitada,
  - clientes com conflito externo conhecido.
- Gerar relatorios de adesao por cliente:
  - capturador principal de NF-e,
  - responsavel interno,
  - ultimo sucesso,
  - ultimo erro.

## Recomendacao de produto

Tratar `nfe_habilitado` como decisao operacional de cadastro, nao como simples status tecnico.

Na pratica:

- `Clientes` e a tela de governanca.
- `Buscas NF-e` e a tela de operacao somente dos clientes realmente habilitados.
- Sempre que um cliente tiver outro consumidor oficial/legado em producao, este app deve ficar desabilitado para NF-e ate a consolidacao da estrategia do cliente.

## Documentos relacionados

- `README.md`
- `docs/architecture.md`
- `docs/sync-flow.md`
- `docs/nfe-distribuicao.md`
- `docs/troubleshooting.md`
- `docs/database.md`
