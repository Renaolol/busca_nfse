-- CreateEnum
CREATE TYPE "DocumentoConferenciaTipo" AS ENUM ('nfse', 'nfe', 'cte');

-- CreateTable
CREATE TABLE "documento_conferencias" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "cliente_id" UUID,
    "tipo_documento" "DocumentoConferenciaTipo" NOT NULL,
    "documento_id" UUID NOT NULL,
    "conferido" BOOLEAN NOT NULL DEFAULT true,
    "conferido_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documento_conferencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documento_conferencias_usuario_tipo_documento_key" ON "documento_conferencias"("usuario_id", "tipo_documento", "documento_id");

-- CreateIndex
CREATE INDEX "documento_conferencias_usuario_tipo_conferido_idx" ON "documento_conferencias"("usuario_id", "tipo_documento", "conferido");

-- CreateIndex
CREATE INDEX "documento_conferencias_cliente_tipo_idx" ON "documento_conferencias"("cliente_id", "tipo_documento");

-- AddForeignKey
ALTER TABLE "documento_conferencias" ADD CONSTRAINT "documento_conferencias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_conferencias" ADD CONSTRAINT "documento_conferencias_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
