CREATE TYPE "NfeAmbiente" AS ENUM ('producao', 'homologacao');
CREATE TYPE "NfeSyncStatus" AS ENUM ('ativo', 'pausado', 'erro_certificado', 'erro_autorizacao', 'erro_api');
CREATE TYPE "NfeDocumentoOrigem" AS ENUM ('distribuicao_nsu', 'importacao_xml');
CREATE TYPE "NfeTipoRelacao" AS ENUM ('emitida', 'recebida');

CREATE TABLE "nfe_sync_controle" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "cnpj_consulta" VARCHAR(14) NOT NULL,
    "ambiente" "NfeAmbiente" NOT NULL,
    "ultimo_nsu_consultado" BIGINT NOT NULL DEFAULT 0,
    "ultimo_nsu_distribuido" BIGINT NOT NULL DEFAULT 0,
    "max_nsu" BIGINT NOT NULL DEFAULT 0,
    "status" "NfeSyncStatus" NOT NULL DEFAULT 'ativo',
    "ultima_execucao" TIMESTAMP(3),
    "ultima_mensagem" TEXT,
    "total_documentos_baixados" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfe_sync_controle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nfe_documentos" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "ambiente" "NfeAmbiente" NOT NULL,
    "nsu" BIGINT,
    "chave_acesso" VARCHAR(44) NOT NULL,
    "numero_nfe" VARCHAR(20),
    "serie" VARCHAR(20),
    "modelo" VARCHAR(4),
    "data_emissao" TIMESTAMP(3),
    "data_autorizacao" TIMESTAMP(3),
    "status" VARCHAR(50),
    "tipo_relacao" "NfeTipoRelacao",
    "schema_doc" VARCHAR(120),
    "resumo_disponivel" BOOLEAN NOT NULL DEFAULT false,
    "xml_completo_disponivel" BOOLEAN NOT NULL DEFAULT false,
    "cnpj_emitente" VARCHAR(14),
    "razao_social_emitente" VARCHAR(255),
    "cnpj_destinatario" VARCHAR(14),
    "razao_social_destinatario" VARCHAR(255),
    "valor_total" DECIMAL(15,2),
    "xml_resumo_path" TEXT,
    "xml_completo_path" TEXT,
    "hash_resumo" VARCHAR(128),
    "hash_xml_completo" VARCHAR(128),
    "origem" "NfeDocumentoOrigem",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfe_documentos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nfe_sync_controle_cliente_id_cnpj_consulta_ambiente_key" ON "nfe_sync_controle"("cliente_id", "cnpj_consulta", "ambiente");
CREATE UNIQUE INDEX "nfe_documentos_ambiente_chave_acesso_key" ON "nfe_documentos"("ambiente", "chave_acesso");
CREATE UNIQUE INDEX "nfe_documentos_cliente_id_ambiente_nsu_key" ON "nfe_documentos"("cliente_id", "ambiente", "nsu");

ALTER TABLE "nfe_sync_controle"
ADD CONSTRAINT "nfe_sync_controle_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nfe_sync_controle"
ADD CONSTRAINT "nfe_sync_controle_estabelecimento_id_fkey"
FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nfe_documentos"
ADD CONSTRAINT "nfe_documentos_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nfe_documentos"
ADD CONSTRAINT "nfe_documentos_estabelecimento_id_fkey"
FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
