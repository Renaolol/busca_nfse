-- CreateEnum
CREATE TYPE "Ambiente" AS ENUM ('producao', 'producao_restrita');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('historico_desde_nsu_1', 'historico_a_partir_de_nsu', 'somente_novas');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('ativo', 'pausado', 'erro_certificado', 'erro_autorizacao', 'erro_api', 'finalizado_historico');

-- CreateEnum
CREATE TYPE "DocumentoOrigem" AS ENUM ('adn_nsu', 'importacao_xml', 'consulta_chave', 'consulta_dps');

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "clientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "razao_social" VARCHAR(255) NOT NULL,
    "nome_fantasia" VARCHAR(255),
    "cnpj" VARCHAR(14) NOT NULL,
    "email_responsavel" VARCHAR(255),
    "telefone" VARCHAR(30),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cliente_estabelecimentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cliente_id" UUID NOT NULL,
    "cnpj" VARCHAR(14) NOT NULL,
    "razao_social" VARCHAR(255),
    "inscricao_municipal" VARCHAR(50),
    "municipio_codigo_ibge" VARCHAR(7),
    "municipio_nome" VARCHAR(120),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cliente_estabelecimentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "certificados" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID,
    "nome" VARCHAR(255) NOT NULL,
    "cnpj_titular" VARCHAR(14) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'A1',
    "arquivo_criptografado_path" TEXT NOT NULL,
    "senha_criptografada" TEXT NOT NULL,
    "validade_inicio" TIMESTAMP(3),
    "validade_fim" TIMESTAMP(3),
    "thumbprint" VARCHAR(255),
    "serial_number" VARCHAR(255),
    "emissor" TEXT,
    "subject" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "substituido_por_certificado_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "certificados_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nfse_sync_controle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "cnpj_consulta" VARCHAR(14) NOT NULL,
    "ambiente" "Ambiente" NOT NULL,
    "ultimo_nsu_consultado" BIGINT NOT NULL DEFAULT 0,
    "ultimo_nsu_com_documento" BIGINT NOT NULL DEFAULT 0,
    "nsu_inicial" BIGINT NOT NULL DEFAULT 1,
    "modo_sync" "SyncMode",
    "status" "SyncStatus" DEFAULT 'ativo',
    "ultima_execucao" TIMESTAMP(3),
    "proxima_execucao" TIMESTAMP(3),
    "ultima_mensagem" TEXT,
    "total_documentos_baixados" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nfse_sync_controle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nfse_documentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "ambiente" "Ambiente" NOT NULL,
    "nsu" BIGINT,
    "chave_acesso" VARCHAR(100) NOT NULL,
    "numero_nfse" VARCHAR(50),
    "serie" VARCHAR(50),
    "data_emissao" TIMESTAMP(3),
    "competencia" DATE,
    "data_cancelamento" TIMESTAMP(3),
    "status" VARCHAR(50),
    "cnpj_prestador" VARCHAR(14),
    "razao_social_prestador" VARCHAR(255),
    "cnpj_tomador" VARCHAR(14),
    "razao_social_tomador" VARCHAR(255),
    "municipio_prestacao_codigo" VARCHAR(7),
    "municipio_prestacao_nome" VARCHAR(120),
    "valor_servico" DECIMAL(15,2),
    "valor_deducoes" DECIMAL(15,2),
    "valor_iss" DECIMAL(15,2),
    "aliquota_iss" DECIMAL(8,4),
    "codigo_servico_nacional" VARCHAR(50),
    "item_lista_servico" VARCHAR(50),
    "descricao_servico" TEXT,
    "xml_path" TEXT,
    "danfse_path" TEXT,
    "hash_xml" VARCHAR(128),
    "origem" "DocumentoOrigem",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nfse_documentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nfse_eventos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nfse_documento_id" UUID NOT NULL,
    "chave_acesso" VARCHAR(100) NOT NULL,
    "tipo_evento" VARCHAR(100),
    "data_evento" TIMESTAMP(3),
    "descricao" TEXT,
    "xml_path" TEXT,
    "hash_xml" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nfse_eventos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nfse_sync_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cliente_id" UUID NOT NULL,
    "controle_sync_id" UUID,
    "certificado_id" UUID,
    "ambiente" "Ambiente",
    "nsu_consultado" BIGINT,
    "status" VARCHAR(50),
    "mensagem" TEXT,
    "request_id" VARCHAR(255),
    "http_status" INTEGER,
    "tempo_resposta_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nfse_sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auditoria_usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID,
    "cliente_id" UUID,
    "acao" VARCHAR(100) NOT NULL,
    "entidade" VARCHAR(100) NOT NULL,
    "entidade_id" UUID,
    "ip" VARCHAR(100),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auditoria_usuario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clientes_cnpj_key" ON "clientes"("cnpj");
CREATE UNIQUE INDEX "cliente_estabelecimentos_cliente_id_cnpj_key" ON "cliente_estabelecimentos"("cliente_id", "cnpj");
CREATE UNIQUE INDEX "nfse_sync_controle_cnpj_consulta_ambiente_key" ON "nfse_sync_controle"("cnpj_consulta", "ambiente");
CREATE UNIQUE INDEX "nfse_documentos_ambiente_chave_acesso_key" ON "nfse_documentos"("ambiente", "chave_acesso");
CREATE UNIQUE INDEX "nfse_documentos_cliente_id_ambiente_nsu_key" ON "nfse_documentos"("cliente_id", "ambiente", "nsu");
CREATE UNIQUE INDEX "nfse_eventos_chave_tipo_data_hash_key" ON "nfse_eventos"("chave_acesso", "tipo_evento", "data_evento", "hash_xml");

ALTER TABLE "cliente_estabelecimentos" ADD CONSTRAINT "cliente_estabelecimentos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "certificados" ADD CONSTRAINT "certificados_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "certificados" ADD CONSTRAINT "certificados_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nfse_sync_controle" ADD CONSTRAINT "nfse_sync_controle_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfse_sync_controle" ADD CONSTRAINT "nfse_sync_controle_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfse_documentos" ADD CONSTRAINT "nfse_documentos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfse_documentos" ADD CONSTRAINT "nfse_documentos_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfse_eventos" ADD CONSTRAINT "nfse_eventos_nfse_documento_id_fkey" FOREIGN KEY ("nfse_documento_id") REFERENCES "nfse_documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfse_sync_logs" ADD CONSTRAINT "nfse_sync_logs_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfse_sync_logs" ADD CONSTRAINT "nfse_sync_logs_controle_sync_id_fkey" FOREIGN KEY ("controle_sync_id") REFERENCES "nfse_sync_controle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nfse_sync_logs" ADD CONSTRAINT "nfse_sync_logs_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificados"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auditoria_usuario" ADD CONSTRAINT "auditoria_usuario_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
