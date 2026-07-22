CREATE TABLE "alert_resolutions" (
    "id" UUID NOT NULL,
    "alert_id" VARCHAR(255) NOT NULL,
    "cliente_id" UUID,
    "origem" VARCHAR(100),
    "titulo" VARCHAR(255),
    "fingerprint" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_resolutions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "alert_resolutions_alert_id_key" ON "alert_resolutions"("alert_id");

ALTER TABLE "alert_resolutions"
ADD CONSTRAINT "alert_resolutions_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
