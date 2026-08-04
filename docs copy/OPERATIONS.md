# Operacao e Manutencao

## Execucao local
```bash
streamlit run App.py
```

## Verificacao rapida apos alteracoes
1. Abrir pagina principal e buscar NF-e por periodo curto.
2. Abrir `pages/Ctes.py` e validar retorno de CT-e.
3. Abrir `pages/Nfse.py` com upload manual de XML.
4. Abrir `pages/Mono.py` e validar consulta ODBC.

## Validacao especifica de NFSe (registros 1000 a 3300)
1. Gerar arquivo em `Entrada` com XML que tenha ISS retido.
2. Confirmar no `1020` a existencia do ISS destacado com codigo de imposto `3` apenas quando `Iss RET` for `Retido`.
3. Gerar arquivo em `Servico` sem retencoes federais e validar `3300` com primeiro lancamento em credito `412` e segundo lancamento em debito total `5`.
4. Gerar arquivo em `Servico` com retencoes federais e validar `3300` com debitos em `31`, `41`, `40`, `724` e complemento em `5`.
5. Validar CFPS no `3030`: `9101` para mesmo municipio, `9102` para municipio diferente na mesma UF e `9103` para UF diferente.

## Troubleshooting
- Falha HTTP SIEG:
  - Verificar conectividade.
  - Conferir credenciais do modo ativo (`legacy` ou `jwt`).
- Nenhum XML retornado:
  - Revisar CNPJ e intervalo de datas.
  - Confirmar se o tipo de XML (`XmlType`) corresponde ao esperado.
- Erro ODBC:
  - Confirmar DSN `ContabilPBI` e credenciais.

## Boas praticas operacionais
- Nao versionar credenciais.
- Sempre registrar mudancas em `docs/CHANGELOG.md`.
- Aplicar rollout de integracao externa de forma gradual.
