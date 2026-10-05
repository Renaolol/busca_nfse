# NFC-e de Santa Catarina

A distribuicao catarinense e uma origem separada de NF-e modelo 65, integrada em `src/integrations/nfce-sc` e operada em `/nfce-sc`. Os XMLs completos sao persistidos pelo armazenamento comum de NF-e, com origem `sef_sc_nfce` e deduplicacao por ambiente + chave de acesso. O NSU da SEF/SC fica em `nfce_sc_sync_controle` e nunca e gravado na coluna NSU da distribuicao nacional.

## Configuracao

Fluxo na tela `NFC-e SC`: selecione o cliente (por exemplo, Orestes), escolha um dos estabelecimentos daquele cliente, escolha o certificado contabilista vinculado ou a credencial interna da GCONT, defina o papel (para notas emitidas pelo Orestes, `Emitente`) e salve. Em seguida, use `Consultar agora`. A carga inicial parte do NSU zero, fica sujeita a janela de disponibilidade da SEF/SC e os arquivos aparecem na tabela `NFC-e armazenadas`.

O backend continua solicitando lotes enquanto a SEF/SC retornar 50 documentos, salvando cada lote e avancando o cursor antes da proxima solicitacao. Quando chegar um lote menor ou a resposta `117`, o controle volta para `ativo` e aguarda 12 horas antes da proxima consulta. A tela mostra `Consultando` e atualiza o progresso; o processo continua se o navegador for fechado. Se o servidor reiniciar, a consulta e retomada do ultimo NSU salvo depois que o lease de execucao expirar. O botao `Pausar` interrompe a sequencia ao concluir o lote em andamento. Um controle pausado pode ser retomado pelo botao `Retomar consulta`, a partir do NSU salvo.

- `GET /nfce-sc/controles?clienteId=<uuid>` lista os controles de um cliente.
- `GET /nfce-sc/controles/:id/diagnostico?clienteId=<uuid>` baixa um ZIP com `requisicao.xml`, `resposta.xml` e `capturado-em.txt` da ultima resposta SEF/SC `cStat=9999`. O botao `Baixar XML para SEF` aparece no controle depois dessa resposta. O adapter captura esses envelopes somente nesse erro; respostas normais e XMLs fiscais nao sao duplicados no diagnostico. O pacote fica disponivel ate uma futura resposta `9999` substituir o diagnostico anterior.
- `POST /nfce-sc/controles` cria/atualiza a configuracao do estabelecimento, certificado contabilista e papel consultado. A alteracao de certificado ou filtro preserva o cursor.
- `POST /nfce-sc/controles/:id/rodar-agora` inicia uma sincronizacao em segundo plano e responde `202 Accepted` com `accepted`, `started`, `status`, `ultimoNsu`, `totalDocumentosBaixados` e `mensagem`. `started=false` indica que ja havia uma sincronizacao em andamento. Consulte `GET /nfce-sc/controles?clienteId=...` para acompanhar `status=processando`, o NSU e a mensagem de progresso.
- `POST /nfce-sc/controles/:id/pausar` pausa o controle.
- A tela `NFC-e SC` permite configurar e acompanhar a distribuicao.

O servico aceita certificado e-CPF do contabilista ou e-CNPJ da empresa contabil com o CPF do contador responsavel no certificado. A SEF/SC faz a validacao do vinculo do contabilista ao CNPJ/CPF consultado. O projeto armazena certificado e senha usando os mesmos mecanismos criptografados das demais integracoes.

## Protocolo e limites

O cliente real usa o WSDL `https://dfe.sat.sef.sc.gov.br/nfce/ws/distribuicao/DistribuicaoNfceDownload.asmx?WSDL`, SOAP 1.1, TLS mutuo, operacao `nfceDownloadContab`, lote GZIP em Base64 e respostas limitadas a 50 itens. O servico esta publicado apenas para producao. A aplicacao aguarda 12 horas quando o sincronismo termina ou a SEF retorna `117`, e uma hora para `110`/`657`.

Use `NFCE_SC_CLIENT_MODE=mock` para desenvolvimento sem chamadas externas e `NFCE_SC_CLIENT_MODE=real` para ativar chamadas reais. Nunca configure real antes de confirmar que a SEF liberou o certificado para o contribuinte e que a conta esta autorizada no ambiente de testes/operacao.

O boletim revisado de agosto de 2026 documenta CNPJ e chave de acesso alfanumericos. Validadores e parsers atuais do NotaSync ainda precisam ser revisados para essa mudanca antes de habilitar clientes com CNPJ alfanumerico.

## Referencias oficiais

- [Pagina do servico NFC-e SEF/SC](https://www.sef.sc.gov.br/saiba-mais/web-service-para-download-de-nfce)
- [WSDL do servico](https://dfe.sat.sef.sc.gov.br/nfce/ws/distribuicao/DistribuicaoNfceDownload.asmx?WSDL)
- [Boletim tecnico SC-2026/003, revisao 1.00-1](https://www.sef.sc.gov.br/api/download?id=8609&mime=application/pdf&nomeArquivo=BT+2026-003+-+Servico+de+Distribuicao+de+Nota+Fiscal+de+Consumidor+Eletronica++-+v100-1.pdf)
