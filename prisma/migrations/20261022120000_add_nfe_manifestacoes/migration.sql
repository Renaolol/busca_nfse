CREATE TABLE "nfe_manifestacoes" (
    "id" UUID NOT NULL,
    "nfe_documento_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID NOT NULL,
    "certificado_id" UUID,
    "usuario_id" UUID,
    "request_id" UUID NOT NULL,
    "tipo_evento" VARCHAR(6) NOT NULL,
    "n_seq_evento" INTEGER NOT NULL,
    "ambiente" "NfeAmbiente" NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "c_stat" VARCHAR(3),
    "x_motivo" TEXT,
    "n_prot" VARCHAR(15),
    "justificativa" VARCHAR(255),
    "autorizacao_expressa_em" TIMESTAMP(3) NOT NULL,
    "enviado_em" TIMESTAMP(3),
    "processado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfe_manifestacoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nfe_manifestacoes_request_id_key" ON "nfe_manifestacoes"("request_id");
CREATE INDEX "nfe_manifestacoes_documento_created_idx" ON "nfe_manifestacoes"("nfe_documento_id", "created_at");
CREATE INDEX "nfe_manifestacoes_scope_created_idx" ON "nfe_manifestacoes"("cliente_id", "estabelecimento_id", "created_at");
CREATE UNIQUE INDEX "nfe_manifestacoes_one_inflight_event_idx"
    ON "nfe_manifestacoes"("nfe_documento_id", "tipo_evento")
    WHERE "status" IN ('enviando', 'resultado_indeterminado');

ALTER TABLE "nfe_manifestacoes"
    ADD CONSTRAINT "nfe_manifestacoes_nfe_documento_id_fkey"
    FOREIGN KEY ("nfe_documento_id") REFERENCES "nfe_documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_manifestacoes"
    ADD CONSTRAINT "nfe_manifestacoes_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_manifestacoes"
    ADD CONSTRAINT "nfe_manifestacoes_estabelecimento_id_fkey"
    FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nfe_manifestacoes"
    ADD CONSTRAINT "nfe_manifestacoes_certificado_id_fkey"
    FOREIGN KEY ("certificado_id") REFERENCES "certificados"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nfe_manifestacoes"
    ADD CONSTRAINT "nfe_manifestacoes_usuario_id_fkey"
    FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- resNFe does not contain a recipient element. Earlier NotaSync builds could
-- persist a recipient summary without its relationship, hiding it from the
-- received-by-CPF/CNPJ filter. The summary was stored under the queried
-- establishment; repair only unclassified summaries whose issuer differs.
UPDATE "nfe_documentos" AS n
SET "tipo_relacao" = 'recebida',
    "cnpj_destinatario" = e."cnpj"
FROM "cliente_estabelecimentos" AS e
WHERE n."estabelecimento_id" = e."id"
  AND n."cliente_id" = e."cliente_id"
  AND n."resumo_disponivel" = TRUE
  AND n."tipo_relacao" IS NULL
  AND n."cnpj_destinatario" IS NULL
  AND n."cnpj_emitente" IS DISTINCT FROM e."cnpj"
  AND n."schema_doc" ILIKE 'resNFe%';
