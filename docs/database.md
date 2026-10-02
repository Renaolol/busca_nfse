# Database

O schema inicial usa Prisma + PostgreSQL com as tabelas:

- `clientes`
- `cliente_estabelecimentos`
- `certificados`
- `nfse_sync_controle`
- `nfse_documentos`
- `nfse_eventos`
- `nfse_sync_logs`
- `nfe_sync_controle`
- `nfe_documentos`
- `auditoria_usuario`
- `simples_nacional_importacoes`
- `simples_nacional_empresas`

Regras principais:

- Deduplicacao por `UNIQUE (ambiente, chave_acesso)` em documentos.
- Controle NSU por contexto (`cliente/cnpj/ambiente`) com `UNIQUE (cliente_id, cnpj_consulta, ambiente)` em `nfse_sync_controle`.
- Controle NSU independente para NF-e em `nfe_sync_controle`.
- Controle NSU proprio da distribuicao SEF/SC em `nfce_sc_sync_controle`; essa sequencia nao compartilha NSU com a distribuicao nacional.
- Historico de certificados e vinculo de substituicao.
- `certificados.cliente_id` e opcional para permitir controle de certificados avulsos.
- `certificados.anotacoes` guarda observacoes internas sobre origem, renovacao e uso operacional.
- Cadastro do responsavel interno em `clientes.responsavel_interno`.
- A elegibilidade do cliente para NF-e e controlada pela coluna `clientes.nfe_habilitado`.
- Dados fiscais do estabelecimento principal em `cliente_estabelecimentos`, incluindo inscricao municipal e municipio.
- Eventos de NFS-e sao vinculados em `nfse_eventos.nfse_documento_id` pela chave da NFS-e referenciada no XML (`chNFSe`).
- Evento de cancelamento (`e101101`) atualiza a nota relacionada com `status = cancelada` e `data_cancelamento`.
- A tabela de empresas do Simples Nacional fica em `simples_nacional_empresas`, com chave primaria `cnpj_base` (raiz de 8 caracteres do CNPJ, valendo para matriz e filiais) e colunas enxutas para suportar a base nacional da Receita (dezenas de milhoes de linhas). `simples_nacional_importacoes` guarda o arquivo, o status (`processando`, `concluida`, `erro`), o progresso (`linhas_processadas`, atualizado periodicamente junto com `updated_at`), os totais e a amostra de linhas ignoradas. Uma nova importacao apaga e regrava `simples_nacional_empresas` dentro de uma unica transacao: leituras continuam vendo a tabela anterior ate o commit, e um erro desfaz tudo. Depois do commit a importacao executa `ANALYZE simples_nacional_empresas`.
- A busca por nome usa o indice GIN parcial `simples_nacional_empresas_razao_social_busca_idx` sobre `simples_nacional_nome_tsvector(razao_social)` (funcao SQL imutavel: `to_tsvector('simple')` sem acentos e em minusculas), criado em SQL na migration `20260930190000_simples_nacional_busca_nome`. O Prisma nao representa esse indice e nao o remove (`migrate diff` sai vazio); nao apague em migrations futuras. A consulta desliga `enable_seqscan` na propria transacao, porque para termos raros o planejador preferiria varrer a tabela inteira.
