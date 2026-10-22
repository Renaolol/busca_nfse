ALTER TYPE "NfeDocumentoOrigem" ADD VALUE 'sef_sc_nfe';

CREATE TABLE "nfe_sc_sync_controle" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "cnpj_consulta" VARCHAR(14) NOT NULL,
    "certificado_id" UUID NOT NULL,
    "ambiente" "NfeAmbiente" NOT NULL,
    "ind_ator" INTEGER NOT NULL DEFAULT 3,
    "autorizacao_confirmada_em" TIMESTAMP(3) NOT NULL,
    "autorizacao_confirmada_por_id" UUID NOT NULL,
    "ultimo_nsu_consultado" BIGINT NOT NULL DEFAULT 0,
    "status" "NfeSyncStatus" NOT NULL DEFAULT 'ativo',
    "ultima_execucao" TIMESTAMP(3),
    "proxima_execucao" TIMESTAMP(3),
    "ultima_mensagem" TEXT,
    "total_documentos_baixados" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfe_sc_sync_controle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nfe_sc_documentos_distribuidos" (
    "id" UUID NOT NULL,
    "controle_id" UUID NOT NULL,
    "nfe_documento_id" UUID NOT NULL,
    "nsu" BIGINT NOT NULL,
    "schema_doc" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfe_sc_documentos_distribuidos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nfe_sc_sync_controle_cliente_cnpj_ambiente_key"
    ON "nfe_sc_sync_controle"("cliente_id", "cnpj_consulta", "ambiente");

CREATE UNIQUE INDEX "nfe_sc_documentos_distribuidos_controle_nsu_key"
    ON "nfe_sc_documentos_distribuidos"("controle_id", "nsu");

CREATE INDEX "nfe_sc_documentos_distribuidos_documento_idx"
    ON "nfe_sc_documentos_distribuidos"("nfe_documento_id");

ALTER TABLE "nfe_sc_sync_controle"
    ADD CONSTRAINT "nfe_sc_sync_controle_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "nfe_sc_sync_controle_estabelecimento_id_fkey"
    FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "nfe_sc_sync_controle_certificado_id_fkey"
    FOREIGN KEY ("certificado_id") REFERENCES "certificados"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "nfe_sc_sync_controle_autorizacao_confirmada_por_id_fkey"
    FOREIGN KEY ("autorizacao_confirmada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nfe_sc_documentos_distribuidos"
    ADD CONSTRAINT "nfe_sc_documentos_distribuidos_controle_id_fkey"
    FOREIGN KEY ("controle_id") REFERENCES "nfe_sc_sync_controle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "nfe_sc_documentos_distribuidos_nfe_documento_id_fkey"
    FOREIGN KEY ("nfe_documento_id") REFERENCES "nfe_documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
