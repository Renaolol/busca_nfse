# Cadastro de clientes

O cadastro de clientes aceita pessoa fisica e pessoa juridica. No formulario, a caixa de selecao alinhada ao campo de identificacao alterna entre CPF e CNPJ e ajusta a quantidade de digitos aceita.

- CPF: 11 digitos numericos.
- CNPJ: 14 digitos numericos.
- `POST /clientes` e `PATCH /clientes/:id` recebem o identificador no campo `cnpj` por compatibilidade com o contrato atual. O valor pode ter 11 digitos (CPF) ou 14 digitos (CNPJ); pontuacao nao deve ser enviada pela API.
- O identificador e armazenado sem pontuacao no campo `cnpj` do cliente e do estabelecimento principal. A coluna existente comporta ambos os tamanhos, portanto esta mudanca nao altera o schema do banco.
- O OpenAPI descreve os dois formatos no DTO e na operacao de criacao de clientes.
