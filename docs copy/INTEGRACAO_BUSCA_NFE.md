# Integracao do LeitorXML no Busca NFe

## Objetivo
Este documento descreve como transferir o comportamento atual do aplicativo `LeitorXML` para dentro do aplicativo `Busca NFe`, mantendo as mesmas rotinas de leitura, conciliacao e analise de XML, mas exibindo tudo dentro de uma area interna do sistema destino.

O foco nao e criar uma segunda aplicacao paralela. A ideia e reaproveitar a logica existente e transformar o leitor em um componente embutido, como:
- um campo/area dentro de uma pagina existente
- um painel lateral
- uma aba
- um formulario com resultado abaixo
- um modal ou drawer, se o Busca NFe suportar esse padrao

## Situacao atual
Hoje o projeto esta organizado como um app Streamlit independente:
- `App.py` concentra a tela principal de NF-e de entrada.
- `pages/Ctes.py`, `pages/Nfse.py` e `pages/Mono.py` cobrem os demais fluxos.
- `dependencies.py` centraliza a maior parte da logica reutilizavel:
  - chamadas a API SIEG
  - parse de XML
  - formatacao de valores
  - consultas auxiliares
  - geracao de registros para exportacao

Isso significa que o app ja tem uma separacao parcial entre interface e regra de negocio, mas ainda esta acoplado ao Streamlit em varios pontos.

## O que deve ser reaproveitado
As rotinas abaixo sao as candidatas naturais para migracao para dentro do Busca NFe:

- `get_xml_sieg(cnpj, data_inicial, data_final)`
- `get_xml_nfe_eventos(cnpj, data_inicial, data_final, chaves_xml=None, tipo_evento=None)`
- `processa_xml(xml)`
- `processa_evento_nfe_b64(xml_b64)`
- `get_clientes()`
- `formata_valor(valor)`
- `get_xml_ctes(cnpj, data_inicial, data_final)`
- `get_xml_ctes_eventos(cnpj, data_inicial, data_final, tipo_evento=None)`
- `processa_ctes(ctes)`
- `parse_nfse(xml, nome_arquivo="")`
- `cria_registro_1000`, `cria_registro_1020`, `cria_registro_3000`, `cria_registro_3020`, `cria_registro_3300`

Na pratica, a maior parte da migracao deve aproveitar `dependencies.py` como camada de dominio. O que muda e a forma de apresentar e disparar essas rotinas dentro do Busca NFe.

## O que nao deve ser levado do jeito atual
Alguns trechos do app atual foram feitos para a tela Streamlit, entao nao e recomendado copiar sem ajuste:

- `st.set_page_config`
- `st.title`, `st.divider`, `st.columns`, `st.metric`, `st.dataframe`, `st.data_editor`
- leituras de `st.file_uploader`, `st.checkbox`, `st.radio` e `st.selectbox` diretamente no corpo da pagina
- logica extensa de montagem de tabelas dentro do arquivo de interface

Esses trechos devem virar uma camada de apresentacao do Busca NFe, consumindo funcoes de negocio separadas.

## Proposta de integracao

### Cenario recomendado
Se o Busca NFe tambem for Streamlit, a integracao mais simples e segura e:
1. Criar um modulo reutilizavel de leitor.
2. Expor funcoes puras que recebem parametros e retornam `DataFrame`, listas ou dicionarios.
3. Importar essas funcoes dentro da pagina/campo do Busca NFe.
4. Renderizar os resultados dentro de um `container`, `expander`, `tab` ou area equivalente.

### Exemplo de organizacao
Uma divisao saudavel seria:
- `core/` ou `services/`
  - acesso a SIEG
  - parsing XML
  - regras de negocio
- `ui/` ou `components/`
  - widgets e exibicao
- `pages/` do Busca NFe
  - apenas orquestracao da tela

## Fluxo funcional desejado
O fluxo no Busca NFe deve seguir esta ordem:
1. Usuario escolhe empresa ou CNPJ.
2. Usuario informa periodo.
3. Usuario escolhe a origem do XML:
   - API SIEG
   - upload manual
4. O sistema busca ou recebe os XMLs.
5. O parser extrai os dados fiscais.
6. O sistema exibe:
   - lista de notas
   - eventos vinculados
   - status de cancelamento
   - totais e metricas
   - filtros por CST, CFOP, eventos ou outros criterios
7. Quando aplicavel, o sistema gera registros de exportacao ou consolida informacoes para o restante do fluxo do Busca NFe.

## Requisitos para manter as mesmas funcoes
Para o comportamento ser equivalente ao app atual, o Busca NFe precisa suportar:

- selecao de cliente ou CNPJ
- intervalo de datas
- upload manual de XML
- consulta via API SIEG
- leitura de eventos vinculados por chave
- exibicao tabular com filtros
- calculo de totais e indicadores
- tratamento de XML cancelado
- feedback de erro por arquivo

## Regras de negocio que precisam ser preservadas

### NF-e de entrada
- Baixa XMLs por CNPJ e periodo.
- Processa cada XML e extrai produtos e tributacao.
- Busca eventos vinculados pelas chaves extraidas.
- Marca notas canceladas mesmo quando o evento nao vier completo.
- Exibe valores como total da nota, ICMS, ICMS ST retido e ICMS monofasico.

### CT-e
- Baixa XMLs por CNPJ e periodo.
- Processa CT-e e consolida valores.
- Vincula eventos ao documento principal.

### NFSe
- Suporta XML no padrao nacional e ABRASF.
- Extrai valores de servico, ISS, retencoes e dados de emitente/destinatario.
- Gera registros de exportacao com regras de negocio ja existentes.

## Estrategia tecnica recomendada

### Fase 1: isolar a logica
Criar funcoes que retornem dados estruturados sem depender da interface:
- buscar XMLs
- processar XMLs
- consolidar eventos
- gerar tabelas finais

### Fase 2: criar um componente reutilizavel
Transformar a tela atual em um bloco reaproveitavel, por exemplo:
- `render_leitor_xml(cnpj, data_inicial, data_final, source, modo)`

Esse bloco deve apenas renderizar e chamar a logica isolada.

### Fase 3: encaixar no Busca NFe
No app destino, criar uma area especifica:
- `aba XML`
- `secao Importacao`
- `campo Leitor XML`

Ali o usuario executa as mesmas operacoes sem sair do fluxo principal do Busca NFe.

## Contrato minimo de entrada e saida

### Entradas
- `cnpj`
- `data_inicial`
- `data_final`
- `fonte_xml` (`API SIEG` ou `Upload manual`)
- `tipo_documento` (`NF-e`, `CT-e`, `NFSe`)
- parametros adicionais da SIEG, se houver

### Saidas
- lista de registros processados
- `DataFrame` consolidado
- lista de eventos vinculados
- metricas calculadas
- lista de arquivos com erro
- registros de exportacao, quando aplicavel

## Pontos de atencao na integracao

- O codigo atual assume Streamlit em varios pontos, entao a migracao nao deve ser feita por copia e cola.
- Nomes de colunas devem permanecer consistentes para nao quebrar filtros e exportacoes.
- XMLs diferentes podem ter namespaces e estruturas diferentes; o parser precisa continuar tolerante.
- A API SIEG pode devolver formatos diferentes conforme autenticacao e tipo de resposta.
- Se o Busca NFe ja tem seus proprios filtros ou telas, e importante nao duplicar a mesma funcionalidade em dois lugares.

## Sugestao de arquitetura para o Busca NFe

### Camada de dominio
Responsavel por:
- parse de XML
- regras fiscais
- consolidacao de eventos
- calculos

### Camada de integracao
Responsavel por:
- chamada a API SIEG
- leitura de arquivo local
- acesso a banco, se houver

### Camada de interface
Responsavel por:
- widgets
- botoes
- campos
- tabelas
- mensagens de erro e sucesso

## Critério de sucesso
A integracao pode ser considerada completa quando o Busca NFe conseguir:
- executar as mesmas consultas atuais
- mostrar os mesmos resultados principais
- processar XML via upload ou API
- exibir tudo dentro da propria interface, em uma area interna
- manter a logica fiscal sem perda de comportamento

## Entregas sugeridas
1. Criar um modulo reutilizavel de processamento.
2. Refatorar a interface atual para chamar esse modulo.
3. Inserir o leitor no Busca NFe como componente interno.
4. Validar NF-e, CT-e e NFSe com arquivos reais.
5. Revisar mensagens de erro e alinhamento visual.

## Observacao final
Se o Busca NFe nao for Streamlit, a mesma ideia continua valida, mas a parte de interface precisa ser adaptada ao framework do app destino. Nesse caso, o melhor caminho ainda e manter a logica de `dependencies.py` reutilizavel e criar uma camada de adaptacao especifica para a tecnologia do Busca NFe.
