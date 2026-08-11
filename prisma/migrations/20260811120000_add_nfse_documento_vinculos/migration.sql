-- CreateEnum
CREATE TYPE "NfseDocumentoVinculoPapel" AS ENUM ('emissao', 'tomada');

-- CreateTable
CREATE TABLE "nfse_documento_vinculos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nfse_documento_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "estabelecimento_id" UUID,
    "papel" "NfseDocumentoVinculoPapel" NOT NULL,
    "ambiente" "Ambiente" NOT NULL,
    "nsu" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "nfse_documento_vinculos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nfse_documento_vinculos_documento_papel_key" ON "nfse_documento_vinculos"("nfse_documento_id", "papel");

-- CreateIndex
CREATE INDEX "nfse_documento_vinculos_cliente_id_idx" ON "nfse_documento_vinculos"("cliente_id");

-- AddForeignKey
ALTER TABLE "nfse_documento_vinculos" ADD CONSTRAINT "nfse_documento_vinculos_nfse_documento_id_fkey" FOREIGN KEY ("nfse_documento_id") REFERENCES "nfse_documentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfse_documento_vinculos" ADD CONSTRAINT "nfse_documento_vinculos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfse_documento_vinculos" ADD CONSTRAINT "nfse_documento_vinculos_estabelecimento_id_fkey" FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: papel = 'emissao' a partir de cnpj_prestador.
-- Para cada nota ja existente cujo CNPJ do prestador bate com um estabelecimento cadastrado,
-- cria o vinculo de emissao. Prioriza o proprio estabelecimento de custodia do documento
-- (d.estabelecimento_id) e, na falta, outro estabelecimento do mesmo cliente de custodia,
-- e so entao qualquer outro cliente cadastrado com esse CNPJ.
WITH candidatos_emissao AS (
    SELECT
        d."id" AS documento_id,
        ce."cliente_id" AS cliente_id,
        ce."id" AS estabelecimento_id,
        d."ambiente" AS ambiente,
        CASE
            WHEN ce."id" = d."estabelecimento_id" AND d."cnpj_prestador" IS DISTINCT FROM d."cnpj_tomador"
                THEN d."nsu"
            ELSE NULL
        END AS nsu,
        ROW_NUMBER() OVER (
            PARTITION BY d."id"
            ORDER BY
                (ce."id" = d."estabelecimento_id") DESC,
                (ce."cliente_id" = d."cliente_id") DESC,
                ce."id"
        ) AS rn
    FROM "nfse_documentos" d
    JOIN "cliente_estabelecimentos" ce ON ce."cnpj" = d."cnpj_prestador"
    WHERE d."cnpj_prestador" IS NOT NULL
)
INSERT INTO "nfse_documento_vinculos"
    ("id", "nfse_documento_id", "cliente_id", "estabelecimento_id", "papel", "ambiente", "nsu", "created_at", "updated_at")
SELECT gen_random_uuid(), documento_id, cliente_id, estabelecimento_id, 'emissao', ambiente, nsu, now(), now()
FROM candidatos_emissao
WHERE rn = 1
ON CONFLICT ("nfse_documento_id", "papel") DO NOTHING;

-- Backfill: papel = 'tomada' a partir de cnpj_tomador, mesma logica de priorizacao acima.
WITH candidatos_tomada AS (
    SELECT
        d."id" AS documento_id,
        ce."cliente_id" AS cliente_id,
        ce."id" AS estabelecimento_id,
        d."ambiente" AS ambiente,
        CASE
            WHEN ce."id" = d."estabelecimento_id" AND d."cnpj_prestador" IS DISTINCT FROM d."cnpj_tomador"
                THEN d."nsu"
            ELSE NULL
        END AS nsu,
        ROW_NUMBER() OVER (
            PARTITION BY d."id"
            ORDER BY
                (ce."id" = d."estabelecimento_id") DESC,
                (ce."cliente_id" = d."cliente_id") DESC,
                ce."id"
        ) AS rn
    FROM "nfse_documentos" d
    JOIN "cliente_estabelecimentos" ce ON ce."cnpj" = d."cnpj_tomador"
    WHERE d."cnpj_tomador" IS NOT NULL
)
INSERT INTO "nfse_documento_vinculos"
    ("id", "nfse_documento_id", "cliente_id", "estabelecimento_id", "papel", "ambiente", "nsu", "created_at", "updated_at")
SELECT gen_random_uuid(), documento_id, cliente_id, estabelecimento_id, 'tomada', ambiente, nsu, now(), now()
FROM candidatos_tomada
WHERE rn = 1
ON CONFLICT ("nfse_documento_id", "papel") DO NOTHING;

-- CreateIndex (criado apos o backfill para nao colidir durante a carga; a unicidade por
-- cliente/ambiente/nsu so pode ser violada se o proprio nfse_documentos ja violasse a
-- constraint equivalente que sempre existiu la, o que nao deveria acontecer).
CREATE UNIQUE INDEX "nfse_documento_vinculos_cliente_ambiente_nsu_key" ON "nfse_documento_vinculos"("cliente_id", "ambiente", "nsu");
