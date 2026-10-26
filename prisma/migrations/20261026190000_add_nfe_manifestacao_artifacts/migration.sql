ALTER TABLE "nfe_manifestacoes"
    ADD COLUMN "cpf_cnpj_destinatario" VARCHAR(14),
    ADD COLUMN "c_stat_lote" VARCHAR(3),
    ADD COLUMN "x_motivo_lote" TEXT,
    ADD COLUMN "http_status" INTEGER,
    ADD COLUMN "xml_evento_assinado_path" TEXT,
    ADD COLUMN "xml_retorno_path" TEXT;
