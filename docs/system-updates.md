# Atualizacoes do sistema

Administradores registram mudancas em `Configuracoes > Atualizacoes`. Cada registro tem titulo, descricao, autor e data de criacao. O dashboard oferece acesso a tela de relatorios, disponivel aos usuarios autenticados.

## Relatorios diarios

- A API gera um relatorio diariamente a partir das 17h30 no fuso `America/Sao_Paulo`.
- O relatorio inclui os registros cadastrados desde a meia-noite local ate o inicio do dia seguinte.
- A lista e uma copia do momento da geracao; registros publicados depois das 17h30 entram no relatorio do dia seguinte.
- Uma chave unica pela data e um `upsert` tornam a geracao idempotente, inclusive se mais de uma instancia da rotina executar ao mesmo tempo.
- A rotina verifica o horario a cada minuto e faz uma tentativa imediata ao iniciar a API para cobrir reinicializacoes depois das 17h30.

## API

### `GET /atualizacoes/relatorios`

Disponivel para `admin` e `comum`. Retorna ate 120 relatorios em ordem decrescente de data.

### `GET /atualizacoes/relatorios/:id/pdf`

Disponivel para `admin` e `comum`. Gera o PDF profissional a partir da copia salva do relatorio e retorna `fileName`, `contentType` e `contentBase64` para download.

### `GET /atualizacoes/registros`

Restrito a `admin`. Retorna ate 200 registros publicados, do mais recente ao mais antigo.

### `POST /atualizacoes/registros`

Restrito a `admin`. Body:

```json
{
  "titulo": "Novo relatorio",
  "descricao": "Foi disponibilizada uma nova tela no sistema."
}
```

`titulo` aceita de 3 a 160 caracteres; `descricao`, de 3 a 10.000 caracteres.
