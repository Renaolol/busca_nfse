ALTER TABLE "nfse_documentos"
ADD COLUMN "ignorar_numeracao_validacao" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "ignorar_numeracao_observacao" TEXT;
