-- CreateEnum
CREATE TYPE "SimplesNacionalImportacaoStatus" AS ENUM ('processando', 'concluida', 'erro');

-- DropForeignKey
ALTER TABLE "simples_nacional_empresas" DROP CONSTRAINT "simples_nacional_empresas_importacao_id_fkey";

-- DropIndex
DROP INDEX "simples_nacional_empresas_cnpj_base_key";

-- DropIndex
DROP INDEX "simples_nacional_empresas_importacao_id_idx";

-- AlterTable
-- Importacoes ja existentes foram gravadas de forma sincrona, entao entram como concluidas.
ALTER TABLE "simples_nacional_importacoes" ADD COLUMN     "coluna_cnpj" VARCHAR(255),
ADD COLUMN     "coluna_opcao" VARCHAR(255),
ADD COLUMN     "coluna_razao_social" VARCHAR(255),
ADD COLUMN     "concluido_em" TIMESTAMP(3),
ADD COLUMN     "layout" VARCHAR(30),
ADD COLUMN     "linhas_ignoradas" JSONB,
ADD COLUMN     "linhas_processadas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mensagem" TEXT,
ADD COLUMN     "status" "SimplesNacionalImportacaoStatus" NOT NULL DEFAULT 'concluida',
ADD COLUMN     "total_nao_optantes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "simples_nacional_importacoes"
SET "concluido_em" = "created_at", "linhas_processadas" = "total_linhas", "updated_at" = "created_at";

ALTER TABLE "simples_nacional_importacoes" ALTER COLUMN "status" SET DEFAULT 'processando';
ALTER TABLE "simples_nacional_importacoes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
-- A raiz do CNPJ passa a ser a chave primaria para suportar a base nacional (dezenas de milhoes de linhas).
ALTER TABLE "simples_nacional_empresas" DROP CONSTRAINT "simples_nacional_empresas_pkey",
DROP COLUMN "created_at",
DROP COLUMN "id",
DROP COLUMN "importacao_id",
ADD CONSTRAINT "simples_nacional_empresas_pkey" PRIMARY KEY ("cnpj_base");
