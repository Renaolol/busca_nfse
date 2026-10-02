ALTER TYPE "NfeDocumentoOrigem" ADD VALUE IF NOT EXISTS 'sef_sc_nfce';

CREATE TABLE "nfce_sc_sync_controle" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "cnpj_consulta" VARCHAR(14) NOT NULL,
    "certificado_id" UUID,
    "ambiente" "NfeAmbiente" NOT NULL,
    "ind_ator" INTEGER NOT NULL DEFAULT 3,
    "ultimo_nsu_consultado" BIGINT NOT NULL DEFAULT 0,
    "status" "NfeSyncStatus" NOT NULL DEFAULT 'ativo',
    "ultima_execucao" TIMESTAMP(3),
    "proxima_execucao" TIMESTAMP(3),
    "ultima_mensagem" TEXT,
    "total_documentos_baixados" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nfce_sc_sync_controle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nfce_sc_sync_controle_cliente_cnpj_ambiente_key"
ON "nfce_sc_sync_controle"("cliente_id", "cnpj_consulta", "ambiente");

ALTER TABLE "nfce_sc_sync_controle"
ADD CONSTRAINT "nfce_sc_sync_controle_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nfce_sc_sync_controle"
ADD CONSTRAINT "nfce_sc_sync_controle_estabelecimento_id_fkey"
FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nfce_sc_sync_controle"
ADD CONSTRAINT "nfce_sc_sync_controle_certificado_id_fkey"
FOREIGN KEY ("certificado_id") REFERENCES "certificados"("id") ON DELETE SET NULL ON UPDATE CASCADE;
