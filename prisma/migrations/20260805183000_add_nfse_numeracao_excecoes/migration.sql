CREATE TYPE "NfseNumeracaoExcecaoTipo" AS ENUM ('inutilizada', 'nao_existe');

CREATE TABLE "nfse_numeracao_excecoes" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "cnpj_consulta" VARCHAR(14) NOT NULL,
    "ambiente" "Ambiente" NOT NULL,
    "numero_nfse" INTEGER NOT NULL,
    "tipo" "NfseNumeracaoExcecaoTipo" NOT NULL,
    "observacao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfse_numeracao_excecoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nfse_numeracao_excecoes_cliente_cnpj_ambiente_numero_key"
ON "nfse_numeracao_excecoes"("cliente_id", "cnpj_consulta", "ambiente", "numero_nfse");

CREATE INDEX "nfse_numeracao_excecoes_cliente_cnpj_ambiente_idx"
ON "nfse_numeracao_excecoes"("cliente_id", "cnpj_consulta", "ambiente");

ALTER TABLE "nfse_numeracao_excecoes"
ADD CONSTRAINT "nfse_numeracao_excecoes_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
