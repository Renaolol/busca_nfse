ALTER TABLE "nfse_documentos" ADD COLUMN "chave_substituida" VARCHAR(100);

CREATE INDEX "nfse_documentos_ambiente_chave_substituida_idx" ON "nfse_documentos"("ambiente", "chave_substituida");
