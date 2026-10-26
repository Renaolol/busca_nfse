CREATE TABLE "nfe_documento_vinculos" (
    "id" UUID NOT NULL,
    "nfe_documento_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "tipo_relacao" "NfeTipoRelacao",
    "nsu" BIGINT,
    "origem" "NfeDocumentoOrigem",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nfe_documento_vinculos_pkey" PRIMARY KEY ("id")
);

INSERT INTO "nfe_documento_vinculos" (
    "id", "nfe_documento_id", "cliente_id", "estabelecimento_id", "tipo_relacao", "nsu", "origem", "created_at", "updated_at"
)
SELECT
    gen_random_uuid(), "id", "cliente_id", "estabelecimento_id", "tipo_relacao", "nsu", "origem", "created_at", "updated_at"
FROM "nfe_documentos";

CREATE UNIQUE INDEX "nfe_documento_vinculos_documento_cliente_estabelecimento_key"
    ON "nfe_documento_vinculos"("nfe_documento_id", "cliente_id", "estabelecimento_id");
CREATE INDEX "nfe_documento_vinculos_cliente_estabelecimento_idx"
    ON "nfe_documento_vinculos"("cliente_id", "estabelecimento_id");

ALTER TABLE "nfe_documento_vinculos"
    ADD CONSTRAINT "nfe_documento_vinculos_nfe_documento_id_fkey"
    FOREIGN KEY ("nfe_documento_id") REFERENCES "nfe_documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "nfe_documento_vinculos_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "nfe_documento_vinculos_estabelecimento_id_fkey"
    FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
