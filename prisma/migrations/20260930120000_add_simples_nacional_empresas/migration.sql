-- CreateTable
CREATE TABLE "simples_nacional_importacoes" (
    "id" UUID NOT NULL,
    "nome_arquivo" VARCHAR(255) NOT NULL,
    "total_linhas" INTEGER NOT NULL DEFAULT 0,
    "total_empresas" INTEGER NOT NULL DEFAULT 0,
    "total_ignoradas" INTEGER NOT NULL DEFAULT 0,
    "total_duplicadas" INTEGER NOT NULL DEFAULT 0,
    "usuario_id" UUID,
    "usuario_nome" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simples_nacional_importacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simples_nacional_empresas" (
    "id" UUID NOT NULL,
    "importacao_id" UUID NOT NULL,
    "cnpj_base" VARCHAR(8) NOT NULL,
    "cnpj" VARCHAR(14),
    "razao_social" VARCHAR(255),
    "linha_origem" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simples_nacional_empresas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "simples_nacional_importacoes_created_at_idx" ON "simples_nacional_importacoes"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "simples_nacional_empresas_cnpj_base_key" ON "simples_nacional_empresas"("cnpj_base");

-- CreateIndex
CREATE INDEX "simples_nacional_empresas_importacao_id_idx" ON "simples_nacional_empresas"("importacao_id");

-- AddForeignKey
ALTER TABLE "simples_nacional_importacoes" ADD CONSTRAINT "simples_nacional_importacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simples_nacional_empresas" ADD CONSTRAINT "simples_nacional_empresas_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "simples_nacional_importacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
