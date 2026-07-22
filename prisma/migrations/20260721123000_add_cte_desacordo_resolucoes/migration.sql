CREATE TABLE "cte_desacordo_resolucoes" (
    "id" UUID NOT NULL,
    "nfe_evento_id" UUID NOT NULL,
    "resolvido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cte_desacordo_resolucoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cte_desacordo_resolucoes_nfe_evento_id_key" ON "cte_desacordo_resolucoes"("nfe_evento_id");

ALTER TABLE "cte_desacordo_resolucoes"
ADD CONSTRAINT "cte_desacordo_resolucoes_nfe_evento_id_fkey"
FOREIGN KEY ("nfe_evento_id") REFERENCES "nfe_eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
