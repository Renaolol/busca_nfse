CREATE TYPE "NfceScRecoveryStatus" AS ENUM ('processando', 'concluido', 'pausado', 'erro');

ALTER TABLE "nfce_sc_sync_controle"
ADD COLUMN "reprocessamento_nsu_inicial" BIGINT,
ADD COLUMN "reprocessamento_nsu_final" BIGINT,
ADD COLUMN "reprocessamento_nsu_atual" BIGINT,
ADD COLUMN "reprocessamento_status" "NfceScRecoveryStatus",
ADD COLUMN "reprocessamento_total_documentos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reprocessamento_mensagem" TEXT,
ADD COLUMN "reprocessamento_lease" TIMESTAMP(3);