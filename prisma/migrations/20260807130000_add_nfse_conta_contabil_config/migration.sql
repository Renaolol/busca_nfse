CREATE TABLE "nfse_conta_contabil_config" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "codigo_servico" VARCHAR(50) NOT NULL,
    "conta_contabil" VARCHAR(50) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfse_conta_contabil_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nfse_conta_contabil_config_cliente_id_codigo_servico_key"
ON "nfse_conta_contabil_config"("cliente_id", "codigo_servico");

ALTER TABLE "nfse_conta_contabil_config"
ADD CONSTRAINT "nfse_conta_contabil_config_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
