CREATE TABLE "sistema_atualizacoes" (
    "id" UUID NOT NULL,
    "titulo" VARCHAR(160) NOT NULL,
    "descricao" TEXT NOT NULL,
    "autor_id" UUID,
    "autor_nome" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sistema_atualizacoes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "relatorios_atualizacao_diarios" (
    "id" UUID NOT NULL,
    "data_referencia" DATE NOT NULL,
    "gerado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registros" JSONB NOT NULL,

    CONSTRAINT "relatorios_atualizacao_diarios_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sistema_atualizacoes_created_at_idx" ON "sistema_atualizacoes"("created_at");

CREATE UNIQUE INDEX "relatorios_atualizacao_diarios_data_referencia_key" ON "relatorios_atualizacao_diarios"("data_referencia");

ALTER TABLE "sistema_atualizacoes" ADD CONSTRAINT "sistema_atualizacoes_autor_id_fkey"
    FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
