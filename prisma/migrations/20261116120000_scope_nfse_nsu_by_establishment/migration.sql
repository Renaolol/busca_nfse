DROP INDEX IF EXISTS "nfse_documentos_cliente_id_ambiente_nsu_key";
CREATE UNIQUE INDEX "nfse_docs_cli_amb_est_nsu_key"
  ON "nfse_documentos"("cliente_id", "ambiente", "estabelecimento_id", "nsu");

DROP INDEX IF EXISTS "nfse_documento_vinculos_cliente_ambiente_nsu_key";
CREATE UNIQUE INDEX "nfse_doc_vinc_cli_amb_est_nsu_key"
  ON "nfse_documento_vinculos"("cliente_id", "ambiente", "estabelecimento_id", "nsu");
