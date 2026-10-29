ALTER TABLE "nfse_sync_controle"
ADD COLUMN "recuperacao_nsu_lease_id" VARCHAR(36),
ADD COLUMN "recuperacao_nsu_lease_ate" TIMESTAMP(3);

CREATE TABLE "nfse_nsu_recuperacoes" (
    "id" UUID NOT NULL,
    "controle_id" UUID NOT NULL,
    "nsu" BIGINT NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "tipo_documento" VARCHAR(16),
    "chave_acesso" VARCHAR(100),
    "payload_path" TEXT,
    "ultima_mensagem" TEXT,
    "ultima_tentativa" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfse_nsu_recuperacoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nfse_nsu_recuperacoes_controle_nsu_key"
ON "nfse_nsu_recuperacoes"("controle_id", "nsu");

CREATE INDEX "nfse_nsu_recuperacoes_controle_status_nsu_idx"
ON "nfse_nsu_recuperacoes"("controle_id", "status", "nsu");

ALTER TABLE "nfse_nsu_recuperacoes"
ADD CONSTRAINT "nfse_nsu_recuperacoes_controle_id_fkey"
FOREIGN KEY ("controle_id") REFERENCES "nfse_sync_controle"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "nfse_sync_logs_controle_nsu_criado_idx"
ON "nfse_sync_logs"("controle_sync_id", "nsu_consultado", "created_at");
