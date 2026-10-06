# Estabelecimentos

O formulário `Clientes > Estabelecimentos > Adicionar estabelecimento` aceita o CEP e permite consultar o endereço e o código IBGE do município antes de salvar.

- `GET /estabelecimentos/cep/:cep` recebe o CEP com oito dígitos (com ou sem pontuação) e retorna `cep`, `logradouro`, `bairro`, `municipioNome`, `municipioCodigoIbge` e `uf`. A consulta é encaminhada pelo adapter ViaCEP.
- `POST /clientes/:clienteId/estabelecimentos` cadastra o estabelecimento. Um CNPJ já cadastrado para o mesmo cliente retorna `409 Conflict`; cliente inexistente retorna `404 Not Found`.
- `GET /clientes/:clienteId/estabelecimentos` lista estabelecimentos do cliente.
- `PATCH /estabelecimentos/:id?clienteId=<uuid>` atualiza o estabelecimento dentro do escopo do cliente.
