-- AlterTable
ALTER TABLE "auditoria_usuario" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "certificados" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "cliente_estabelecimentos" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "clientes" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "nfse_documentos" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "nfse_eventos" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "nfse_sync_controle" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "nfse_sync_logs" ALTER COLUMN "id" DROP DEFAULT;
