CREATE TABLE "nfe_automacao_configuracoes" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "ambiente" "NfeAmbiente" NOT NULL,
    "ciencia_automatica" BOOLEAN NOT NULL DEFAULT false,
    "recuperacao_xml_automatica" BOOLEAN NOT NULL DEFAULT false,
    "autorizacao_ativa" BOOLEAN NOT NULL DEFAULT false,
    "usuario_autorizou_id" UUID,
    "autorizada_em" TIMESTAMP(3),
    "versao_termo" VARCHAR(40),
    "revogada_por_id" UUID,
    "revogada_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfe_automacao_configuracoes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nfe_automacao_auditorias" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "configuracao_id" UUID NOT NULL,
    "usuario_id" UUID,
    "acao" VARCHAR(30) NOT NULL,
    "ciencia_automatica" BOOLEAN NOT NULL,
    "recuperacao_xml" BOOLEAN NOT NULL,
    "autorizacao_ativa" BOOLEAN NOT NULL,
    "versao_termo" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfe_automacao_auditorias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nfe_xml_recuperacoes" (
    "id" UUID NOT NULL,
    "nfe_documento_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "configuracao_id" UUID NOT NULL,
    "ambiente" "NfeAmbiente" NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'aguardando_ciencia',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proxima_tentativa_em" TIMESTAMP(3),
    "ultima_tentativa_em" TIMESTAMP(3),
    "lease_id" UUID,
    "lease_ate" TIMESTAMP(3),
    "c_stat" VARCHAR(3),
    "x_motivo" VARCHAR(255),
    "resultado_consulta" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfe_xml_recuperacoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nfe_automacao_config_cliente_estab_ambiente_key"
    ON "nfe_automacao_configuracoes"("cliente_id", "estabelecimento_id", "ambiente");
CREATE INDEX "nfe_automacao_config_ativa_idx"
    ON "nfe_automacao_configuracoes"("cliente_id", "autorizacao_ativa", "ciencia_automatica");
CREATE INDEX "nfe_automacao_auditoria_scope_created_idx"
    ON "nfe_automacao_auditorias"("cliente_id", "estabelecimento_id", "created_at");
CREATE UNIQUE INDEX "nfe_xml_recuperacoes_nfe_documento_id_key"
    ON "nfe_xml_recuperacoes"("nfe_documento_id");
CREATE INDEX "nfe_xml_recuperacao_pendentes_idx"
    ON "nfe_xml_recuperacoes"("cliente_id", "estabelecimento_id", "status", "proxima_tentativa_em");
CREATE INDEX "nfe_xml_recuperacao_lease_idx"
    ON "nfe_xml_recuperacoes"("lease_ate");

CREATE UNIQUE INDEX "nfe_manifestacoes_ciencia_unica_ativa_idx"
    ON "nfe_manifestacoes"("nfe_documento_id", "tipo_evento")
    WHERE "tipo_evento" = '210210'
      AND "status" IN ('enviando', 'resultado_indeterminado', 'registrada', 'registrada_sem_vinculo');

ALTER TABLE "nfe_automacao_configuracoes"
    ADD CONSTRAINT "nfe_automacao_configuracoes_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_automacao_configuracoes"
    ADD CONSTRAINT "nfe_automacao_configuracoes_estabelecimento_id_fkey"
    FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_automacao_configuracoes"
    ADD CONSTRAINT "nfe_automacao_configuracoes_usuario_autorizou_id_fkey"
    FOREIGN KEY ("usuario_autorizou_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nfe_automacao_configuracoes"
    ADD CONSTRAINT "nfe_automacao_configuracoes_revogada_por_id_fkey"
    FOREIGN KEY ("revogada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "nfe_automacao_auditorias"
    ADD CONSTRAINT "nfe_automacao_auditorias_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_automacao_auditorias"
    ADD CONSTRAINT "nfe_automacao_auditorias_estabelecimento_id_fkey"
    FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_automacao_auditorias"
    ADD CONSTRAINT "nfe_automacao_auditorias_configuracao_id_fkey"
    FOREIGN KEY ("configuracao_id") REFERENCES "nfe_automacao_configuracoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_automacao_auditorias"
    ADD CONSTRAINT "nfe_automacao_auditorias_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "nfe_xml_recuperacoes"
    ADD CONSTRAINT "nfe_xml_recuperacoes_nfe_documento_id_fkey"
    FOREIGN KEY ("nfe_documento_id") REFERENCES "nfe_documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_xml_recuperacoes"
    ADD CONSTRAINT "nfe_xml_recuperacoes_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_xml_recuperacoes"
    ADD CONSTRAINT "nfe_xml_recuperacoes_estabelecimento_id_fkey"
    FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_xml_recuperacoes"
    ADD CONSTRAINT "nfe_xml_recuperacoes_configuracao_id_fkey"
    FOREIGN KEY ("configuracao_id") REFERENCES "nfe_automacao_configuracoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
