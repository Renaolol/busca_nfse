# DANFSE PDF Guide

## Objetivo

Este documento define como o DANFSE em PDF e gerado no projeto, quais regras visuais devem ser preservadas e como ajustar layout sem quebrar o padrao.

Use este guia sempre que houver mudancas no renderer PDF.

## Arquivos principais

- `src/modules/nfse/nfse-danfse.service.ts`
- `src/modules/nfse/nfse.service.ts` (regeneracao/legado)

## Fluxo de geracao do DANFSE

1. Entrada:
- XML da NFS-e + fallback de metadados do banco.

2. Merge de dados:
- `generateFromXml(xml, fallback)` extrai dados do XML e aplica fallback para campos ausentes.

3. Montagem semantica:
- `buildDanfseLines()` converte dados para blocos textuais por secao.

4. Layout visual:
- `splitVisualBlocks()` separa cabecalho e secoes.
- `buildContentStreams()` desenha cabecalho, titulos e grade de campos.
- `parseSectionFields()` e `layoutSectionRows()` definem spans/colunas e quebra de linhas.

5. PDF final:
- `buildPdf()` monta objetos PDF e retorna `Buffer`.

## Estrutura visual esperada (padrao alvo)

Referencia visual: DANFSE oficial disponibilizada pelo governo.

Regras:

1. Evitar grade pesada:
- Nao desenhar linha para cada celula individual.
- Priorizar linha superior/inferior por secao e separacao por espaco.

2. Melhor uso de espaco:
- Titulos de secao compactos.
- Labels em fonte menor e valores em fonte maior.
- Campos longos com span maior (2+ colunas ou largura total).

3. Cabecalho equilibrado:
- Bloco de titulo + logo + area de metadados + QR code.
- Sem "amontoar" campos no topo.

4. Colunas por secao:
- `DADOS DE IDENTIFICACAO DA NFS-E`: 3 colunas.
- `INTERMEDIARIO DO SERVICO` e `INFORMACOES COMPLEMENTARES`: 1 coluna.
- `TOTAIS APROXIMADOS DOS TRIBUTOS`: 3 colunas.
- Demais secoes: 4 colunas.

## Spans importantes no parser

Em `parseSectionFields()`:

- Campos full width:
  - `Chave de Acesso da NFS-e`
  - `Consulta Publica`
  - `Descricao do Codigo de Tributacao`
  - `Descricao do Servico`
  - `Informacoes Complementares`
  - `Lei n 12.741/2012`

- Campos com span 2 (quando aplicavel):
  - `Nome / Nome Empresarial`
  - `Endereco`
  - `E-mail`
  - `Simples Nacional na Data de Competencia`
  - `Regime de Apuracao Tributaria pelo SN`
  - `Total das Retencoes (ISSQN / Federais)`
  - `Valor Liquido da NFS-e`
  - `Valor Liquido da NFS-e + IBS/CBS`

## Parametros de layout (estado atual)

Em `buildContentStreams()`:

- `titleBarHeight = 8.4`
- `sectionPadding = 3.4`
- `lineHeight = 7.3`
- `labelGap = 0.9`
- `cellTopPadding = 2.1`
- `cellBottomPadding = 2`

Tipografia:

- Titulo de secao: `/F2` tamanho `8.9`
- Label de campo: `/F2` tamanho `6.0`
- Valor de campo: `/F1` tamanho `8.1`

## Ajuste visual seguro (passo a passo)

1. Ajustar somente um grupo por vez:
- Tipografia (fontes/tamanhos)
- Espacamento (lineHeight/padding)
- Regras de span/colunas

2. Gerar PDF de comparacao local:
- Renderizar 1 DANFSE real com XML conhecido.
- Converter PDF para PNG (`pdftoppm`) para comparacao visual.

3. Comparar com referencia oficial:
- Uso de espaco em branco.
- Alinhamento de colunas.
- Quebra de linha em campos longos.
- Densidade da pagina.

4. Validar regressao:
- `npm run lint`
- `npm run test`
- `npm run test:e2e`
- `npm run build`

## Regeneracao de DANFSE (notas ja salvas)

Endpoint:

- `POST /nfse/reprocessar-xmls`
- `POST /nfse/reprocessar-danfses`

Payload recomendado (regenerar tudo para um cliente/estabelecimento):

```json
{
  "clienteId": "UUID",
  "estabelecimentoId": "UUID",
  "ambiente": "producao",
  "limit": 5000,
  "somenteIncompletos": false,
  "regenerarDanfse": true
}
```

Payload recomendado para atualizar apenas DANFSE legado ou ausente:

```json
{
  "clienteId": "UUID",
  "ambiente": "producao",
  "somenteLegadas": true,
  "lote": 100
}
```

A tela `Configuracoes > Manutencao` executa esse fluxo para atualizar PDFs antigos para o modelo atual.

## DANFSE legado

No download (`GET /nfse/:id/danfse`), o sistema detecta PDF legado e regenera automaticamente.

Regra atual:
- `NfseService.isLegacyDanfse(pdf)` considera legado quando nao encontra o marcador textual `DANFSE - pagina`.

## Checklist de aceite visual

1. Campos longos sem ficar "espremidos".
2. Colunas equilibradas em `Emitente`, `Tomador`, `Tributacao`.
3. Menos linhas internas, mais legibilidade.
4. Cabecalho proporcional ao padrao oficial.
5. Quebras de pagina sem cortar secoes.
