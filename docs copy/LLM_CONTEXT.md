# LLM Context - LeitorXML

Este documento resume o contexto tecnico minimo para um LLM atuar com seguranca neste repositorio.

## Objetivo do sistema
Aplicacao Streamlit para leitura e consolidacao de XMLs fiscais:
- NF-e de entrada
- CT-e emitidos
- NFSe padrao nacional
- Consulta complementar em banco Dominio (ODBC)

## Fluxos principais
1. Usuario escolhe empresa e periodo na UI Streamlit.
2. App baixa XMLs via API SIEG ou recebe upload manual.
3. XMLs sao parseados em `dependencies.py`.
4. Dados viram `DataFrame` e sao exibidos com metricas.

## Arquivos criticos
- `App.py`: fluxo principal NF-e.
- `pages/Ctes.py`: fluxo CT-e.
- `pages/Nfse.py`: fluxo NFSe e geracao de registros de importacao.
- `pages/Mono.py`: consulta ICMS monofasico no Dominio.
- `dependencies.py`: integracoes externas, parse XML, utilitarios.

## Integracoes externas
- API SIEG: `POST /api/v1/baixar-xmls` para XMLs e `POST /api/v1/baixar-eventos` para eventos vinculados por chave.
- PostgreSQL: lista empresas/clientes.
- ODBC Dominio (`DSN=ContabilPBI`): consultas fiscais e dados auxiliares.

## Convencoes de implementacao
- Funcoes de API devem ficar centralizadas em `dependencies.py`.
- Alteracoes em parsing devem preservar nomes de colunas usados nas paginas Streamlit.
- Evitar quebrar interfaces publicas das funcoes chamadas pelas paginas.

## Regras NFSe (registros Dominio)
- Registro de impostos destacados: `1020` para `Entrada` e `3020` para `Servico`.
- ISS destacado (codigo imposto `3`) em `3020`: gerar quando houver valor de ISS na nota.
- ISS destacado (codigo imposto `3`) em `1020`: gerar somente quando `Iss RET` estiver como `Retido`.
- Registro `3030` em `Servico` usa CFPS (nao CFOP).
- Regra CFPS `9101`: mesmo municipio entre emitente e destinatario.
- Regra CFPS `9102`: municipio diferente, mesma UF.
- Regra CFPS `9103`: UF diferente.
- Registro `3300` em `Servico`: primeiro lancamento deve ser credito em `412`.
- Registro `3300` em `Servico` sem retencoes federais: debito total em `5`.
- Registro `3300` em `Servico` com retencoes federais: debitos em `31` (IRRF), `41` (PIS), `40` (COFINS), `724` (CSOC/CSLL) e debito residual em `5`.
- Contrato atual do `parse_nfse` inclui, ao final da tupla, municipio do emitente, UF do destinatario e municipio do destinatario.

## Riscos conhecidos
- Dependencia forte de estrutura XML e namespaces.
- Dependencia de conectividade externa (SIEG, ODBC, PostgreSQL).
- `pages/Nfse.py` possui logica extensa na camada de interface (alto acoplamento).

## Checklist antes de alterar
1. Validar impacto em `App.py` e `pages/*` para nomes de colunas.
2. Confirmar credenciais/variaveis de ambiente necessarias.
3. Validar regras de geracao NFSe (`1020`, `3020`, `3030`, `3300`) com XMLs de cenarios diferentes.
4. Atualizar `docs/CHANGELOG.md` e, se houver mudanca de contrato, `docs/API_SIEG_MIGRATION.md`.
