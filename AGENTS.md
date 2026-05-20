# AGENTS.md

## Contexto

Este projeto coleta NFS-e Nacional via API oficial ADN usando NSU por cliente/CNPJ/ambiente.

## Regras criticas

- Nao alterar schema sem migration Prisma.
- Nao salvar certificado ou senha sem criptografia.
- Nao consultar API oficial em testes unitarios.
- Usar mocks para ADN.
- Deduplicar NFS-e por `ambiente + chave_acesso`.
- Nao reiniciar NSU ao trocar certificado.
- Atualizar OpenAPI e docs em toda mudanca de API.

## Comandos obrigatorios antes de finalizar

```bash
npm run lint
npm run test
npm run test:e2e
npm run build
```

## Padroes

- Cada modulo NestJS deve ter controller, service, DTOs e testes.
- Integracoes externas devem ser encapsuladas em adapters.
- Jobs devem ser idempotentes.
