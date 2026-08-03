CREATE TABLE "compare_sped_historicos" (
    "id" UUID NOT NULL,
    "cliente_id" UUID,
    "client_name" VARCHAR(255) NOT NULL,
    "client_cnpj" VARCHAR(14),
    "competence" VARCHAR(20),
    "source_file_name" TEXT NOT NULL,
    "output_format" VARCHAR(10) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compare_sped_historicos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "compare_sped_historicos_cliente_id_generated_at_idx" ON "compare_sped_historicos"("cliente_id", "generated_at");
CREATE INDEX "compare_sped_historicos_created_at_idx" ON "compare_sped_historicos"("created_at");

ALTER TABLE "compare_sped_historicos"
ADD CONSTRAINT "compare_sped_historicos_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
