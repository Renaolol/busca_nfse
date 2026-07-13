CREATE TABLE "nfe_eventos" (
    "id" UUID NOT NULL,
    "nfe_documento_id" UUID NOT NULL,
    "chave_acesso" VARCHAR(44) NOT NULL,
    "tipo_evento" VARCHAR(100),
    "data_evento" TIMESTAMP(3),
    "descricao" TEXT,
    "schema_doc" VARCHAR(120),
    "xml_path" TEXT,
    "hash_xml" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfe_eventos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nfe_eventos_documento_tipo_data_hash_key"
ON "nfe_eventos"("nfe_documento_id", "tipo_evento", "data_evento", "hash_xml");

ALTER TABLE "nfe_eventos"
ADD CONSTRAINT "nfe_eventos_nfe_documento_id_fkey"
FOREIGN KEY ("nfe_documento_id") REFERENCES "nfe_documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
