DROP INDEX "nfe_xml_recuperacoes_nfe_documento_id_key";

CREATE UNIQUE INDEX "nfe_xml_recuperacoes_documento_cliente_estabelecimento_key"
    ON "nfe_xml_recuperacoes"("nfe_documento_id", "cliente_id", "estabelecimento_id");
