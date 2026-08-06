# NFSe API Adapter

As integracoes oficiais devem ser encapsuladas em adapters separados:

- `src/integrations/nfse-adn`: consulta por NSU e eventos no ADN.
- `src/integrations/nfse-emissor-publico`: recuperacao de NFS-e por chave no Emissor Publico.

## Interface alvo

- `getDFeByNsu(...)`: retorna o XML principal em `xml` para compatibilidade e, quando a API responder lote, retorna todos os itens em `documents`.
- `getEventosByChave(...)`
- `getNfseByChave(...)`
- `getNfseByDpsId(...)`: tentativa de recuperar a NFS-e final a partir do `Id` oficial da DPS inferido para lacunas de numeracao.

## Implementacoes

- `FakeNfseAdnClient`: resposta deterministica para desenvolvimento local.
- `RealNfseAdnClient`: chamada HTTPS mTLS ao ADN usando certificado A1 cadastrado e criptografado no sistema.

## Selecao por ambiente

- `NFSE_ADN_CLIENT_MODE=mock` usa o client fake.
- `NFSE_ADN_CLIENT_MODE=real` usa o client real.

## Variaveis de apoio do client real

- `NFSE_API_BASE_URL_PRODUCAO` (ex.: `https://adn.nfse.gov.br`)
- `NFSE_API_BASE_URL_RESTRITA` (ex.: `https://adn.producaorestrita.nfse.gov.br`)
- `NFSE_ADN_PATH_PREFIX` (padrao: `contribuintes`)
- `NFSE_EMISSOR_PUBLICO_API_BASE_URL_PRODUCAO` (ex.: `https://sefin.nfse.gov.br`)
- `NFSE_EMISSOR_PUBLICO_API_BASE_URL_RESTRITA` (ex.: `https://sefin.producaorestrita.nfse.gov.br`)
- `NFSE_EMISSOR_PUBLICO_PATH_PREFIX` (padrao: `SefinNacional`)
- `NFSE_ADN_TIMEOUT_MS` (padrao: `30000`)
- `NFSE_ADN_REJECT_UNAUTHORIZED` (padrao: `true`)

## Exportacao fiscal para Dominio

- O leitor fiscal de NFS-e expõe `POST /nfse/leitura-fiscal/exportar-dominio` para gerar o TXT no layout padrao do LeitorXML.
- O endpoint reutiliza a leitura fiscal do DANFSE e aplica a logica fiscal corrigida do projeto para ISS e retencoes federais.
- Quando a exportacao for enviada com `contas=PorFornecedor`, o backend consulta o banco Dominio via ODBC usando `DOMINIO_ODBC_CONNECTION_STRING` e o script `scripts/dominio_nfse_fornecedor_contas.py`.
