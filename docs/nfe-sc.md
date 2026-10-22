# Distribuicao de NF-e modelo 55 pela SEF/SC

Esta integracao e separada da distribuicao nacional DF-e e do servico de NFC-e SC. O adapter fica em `src/integrations/nfe-sc`, o modulo NestJS em `src/modules/nfe-sc`, e o NSU e a relacao documento/NSU ficam nas tabelas `nfe_sc_sync_controle` e `nfe_sc_documentos_distribuidos`.

## Regras oficiais verificadas

O boletim tecnico vigente publicado pela SEF/SC e a versao 2.02-1, atualizada em 31/08/2026. Ele especifica o Web Service `NfeDownload`, metodo `nfeDownloadContab`, endpoint de producao `https://satnfe.sef.sc.gov.br/ws/distribuicao/nfedownloadV2.asmx`, SOAP com autenticacao mutua ICP-Brasil e TLS 1.2. O servico e publicado somente em producao.

O pedido envia CPF ou CNPJ consultado, `indXML=1`, `indAtor` (1 emitente, 2 destinatario, 3 emitente ou destinatario, 9 emitente e destinatario) e `ultNuNSU`. Para esta integracao o CPF e lido do estabelecimento cadastrado; nao e aceito um CPF arbitrario no corpo da API. O lote e compactado em GZIP, contem no maximo 50 documentos e pode trazer `nfeProc` ou `procEventoNFe`.

O controle SEF/SC e por interessado e ambiente. O primeiro pedido usa NSU zero. Lotes de 50 podem ser continuados imediatamente; respostas `cStat=117` ou `cStat=118` com menos de 50 documentos significam sincronismo completo no momento e pedem espera de 12 horas. Para `cStat=110` o manual pede uma hora; `cStat=657` e bloqueio por excesso de tentativas, entao o cliente espera 12 horas por seguranca. `cStat=632` indica solicitacao fora do periodo de disponibilidade: o cursor fica parado e nao ha nova tentativa automatica. O manual informa disponibilidade do mes atual e das duas referencias anteriores. A pagina de servico tambem publica limite de 8 requisicoes por segundo por IP e 40 simultaneas em producao; o NotaSync espaça os inicios das chamadas desta integracao por processo.

O requisitante precisa ser contabilista e estar vinculado ao CPF/CNPJ consultado. O e-CPF do contabilista ou e-CNPJ da empresa contabil com o CPF responsavel no certificado podem autenticar. A SEF/SC verifica esse vinculo e responde `cStat=8002` quando o requisitante nao e contabilista do alvo; `8001`/`8004` tambem indicam falta de vinculo entre alvo e NSU/chave. Erros de certificado incluem `280` a `286`. A confirmacao registrada no NotaSync e uma declaracao administrativa de que o vinculo foi verificado externamente; ela nao substitui a verificacao que a SEF/SC faz em cada consulta.

## Configuracao segura

- O modo padrao e mock. Use `NFE_SC_CLIENT_MODE=mock` para desenvolvimento/testes; o cliente real so e selecionado fora de `NODE_ENV=test` quando a variavel for exatamente `real`.
- A pagina `Buscas NF-e` oferece a busca manual SEF/SC de modelo 55. No modo mock, a interface informa que nao houve acesso a SEF/SC e nao usa o certificado escolhido.
- Configure pelo endpoint administrativo somente depois de confirmar, fora do NotaSync, que o titular do A1 contabilista tem vinculo com o produtor na SEF/SC. O servico retorna `8002` se a autorizacao nao estiver reconhecida.
- A configuracao aceita somente estabelecimento com CPF valido e certificado A1 ativo, nao vencido e vinculado ao cliente/estabelecimento. Trocar certificado preserva o cursor. O filtro `indAtor` fica imutavel depois do primeiro NSU para evitar pular documentos.
- A integracao nao envia manifestacao do destinatario e nao consulta certificado real durante a configuracao. O XML do certificado e a senha continuam usando o storage criptografado existente.
- Logs nao registram CPF/CNPJ, certificado, chave, XML ou resposta SOAP. Mensagens de status redigem identificadores que possam aparecer em `xMotivo`.

## Endpoints

Todos os endpoints sao administrativos e respeitam o escopo de `clienteId`.

- `GET /nfe-sc/status` informa somente `clientMode: mock|real`, sem dados de certificados.
- `GET /nfe-sc/controles?clienteId=<uuid>` lista o cursor, estado, certificado selecionado e a confirmacao administrativa.
- `POST /nfe-sc/controles` configura `{ clienteId, estabelecimentoId, certificadoId, ambiente: "producao", indAtor, autorizacaoContabilistaConfirmada: true }`. A confirmacao e obrigatoria.
- `POST /nfe-sc/controles/:id/rodar-agora` inicia a busca em segundo plano; `GET /nfe-sc/controles` mostra progresso e proxima tentativa.
- `POST /nfe-sc/controles/:id/pausar` pausa o controle sem alterar o ultimo NSU confirmado.
- `GET /nfe-sc/documentos?clienteId=<uuid>&page=1&pageSize=100` lista NF-e/eventos recebidos desta origem junto com o NSU SEF/SC, ordenados do NSU mais recente ao mais antigo. `pageSize` aceita até 1000 para consultar todo o histórico paginado.

O cursor so avanca depois que o documento e validado pelo parser, persistido pelo fluxo comum da NF-e e o par controle/NSU/documento e gravado. Falha entre essas etapas deixa o NSU atual intacto; a repeticao e idempotente por controle/NSU e a NF-e continua deduplicada por ambiente + chave de acesso. O NSU SEF/SC nao e gravado na coluna de NSU da distribuicao nacional.

## Diferenca das cinco consultas

1. **Distribuicao nacional DF-e (`distNSU`)**: lote incremental por CPF/CNPJ interessado, com cursor nacional e documentos/eventos que o Ambiente Nacional disponibiliza para aquele ator. Pode retornar `resNFe` em vez do XML completo.
2. **Consulta nacional pontual (`consNSU`/`consChNFe`)**: consulta de um NSU faltante ou de uma chave, sem alterar o cursor incremental. A resposta depende das regras e da disponibilidade do documento para o certificado/ator.
3. **Manifestacao do destinatario**: evento fiscal explicito. O XML completo pode ficar disponivel depois de evento aceito e consulta pontual posterior, mas o evento nao garante liberacao. O NotaSync nao manifesta automaticamente; Ciencia nao confirma recebimento nem deve ser enviada apenas para tentar obter XML.
4. **Distribuicao de NF-e modelo 55 SEF/SC**: servico estadual acima, voltado a contabilistas com vinculo reconhecido, janela propria e NSU proprio por interessado.
5. **Distribuicao NFC-e SC**: integracao existente em `src/integrations/nfce-sc` e `/nfce-sc`, para modelo 65, com outro endpoint, regras e cursor `nfce_sc_sync_controle`.

## Referencias oficiais

- [Pagina SEF/SC: Web service para Download de NFe](https://www.sef.sc.gov.br/saiba-mais/web-service-para-download-de-nfe)
- [Boletim tecnico SEF/SC v2.02-1 e schemas](https://www.sef.sc.gov.br/api/download?id=8611&mime=application%2Fx-zip-compressed&nomeArquivo=Boletim+Tecnico+com+a+Documenta%C3%A7%C3%A3o+do+Web+Service+-+Vers%C3%A3o+2.02-1.zip)
- [Pagina SEF/SC: Web service para Download de NFCe](https://www.sef.sc.gov.br/saiba-mais/web-service-para-download-de-nfce)
- [Pagina oficial de Notas Tecnicas NF-e, com NT 2014.002 v1.40](https://www.nfe.fazenda.gov.br/portal/consulta.aspx/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=04BIflQt1aY%3D)
- [NT 2014.002 v1.40 - arquivo oficial](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=uWO2d%2FgTuWg%3D)
