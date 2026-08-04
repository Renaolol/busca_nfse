# Arquitetura

## Visao geral
O projeto segue uma arquitetura simples de app Streamlit com modulo utilitario central:
- Camada de apresentacao: `App.py` e `pages/*`.
- Camada de integracao e dominio: `dependencies.py`.

## Componentes
- UI Streamlit:
  - Entrada de filtros (empresa, periodo, origem dos XMLs).
  - Exibicao de tabelas e metricas.
- Integracao SIEG:
  - Busca paginada de XMLs/eventos por tipo.
  - Suporte a autenticacao legado (api_key) e modo JWT.
- Processamento XML:
  - Parsing de NF-e/CT-e/NFSe via `xml.etree.ElementTree`.
- Dados auxiliares:
  - PostgreSQL para clientes.
  - ODBC Dominio para consultas fiscais.

## Regras funcionais criticas (NFSe)
- `pages/Nfse.py` concentra a montagem dos registros Dominio (`1000` a `3300`) a partir da tupla retornada por `parse_nfse`.
- `dependencies.py` define o contrato de parsing usado na pagina de NFSe, incluindo municipio/UF para regra de CFPS.
- Em `Servico`, o `3030` deve usar CFPS (`9101`, `9102`, `9103`) conforme comparacao de municipio/UF entre emitente e destinatario.
- Em `Servico`, o `3300` deve iniciar com credito em `412` e depois distribuir debitos conforme retencoes.
- O ISS destacado (codigo `3`) e registrado em `3020`; em `1020`, somente quando houver ISS retido.

## Dependencias de runtime
- `streamlit`, `pandas`, `requests`, `python-dotenv`, `pyodbc`, `psycopg2-binary`.

## Fronteiras de responsabilidade
- `dependencies.py`:
  - Deve concentrar chamadas HTTP externas.
  - Deve encapsular parse e normalizacao de dados.
- `App.py` e `pages/*`:
  - Devem orquestrar fluxo da interface.
  - Nao devem duplicar regras de integracao.

## Dividas tecnicas relevantes
- Duplicacao historica de logica de paginacao da API (em reducao).
- Pouca separacao entre logica de negocio e UI em `pages/Nfse.py`.
- Ausencia de testes automatizados.
