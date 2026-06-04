# NFSe API Adapter

A integracao oficial deve ser encapsulada em `src/integrations/nfse-adn`.

## Interface alvo

- `getDFeByNsu(...)`: retorna o XML principal em `xml` para compatibilidade e, quando a API responder lote, retorna todos os itens em `documents`.
- `getEventosByChave(...)`

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
- `NFSE_ADN_TIMEOUT_MS` (padrao: `30000`)
- `NFSE_ADN_REJECT_UNAUTHORIZED` (padrao: `true`)
