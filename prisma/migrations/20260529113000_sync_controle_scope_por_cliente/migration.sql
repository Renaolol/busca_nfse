DROP INDEX IF EXISTS "nfse_sync_controle_cnpj_consulta_ambiente_key";

CREATE UNIQUE INDEX "nfse_sync_controle_cliente_id_cnpj_consulta_ambiente_key"
ON "nfse_sync_controle"("cliente_id", "cnpj_consulta", "ambiente");
