ALTER TABLE "certificados"
ADD COLUMN "anotacoes" TEXT;

ALTER TABLE "certificados"
DROP CONSTRAINT "certificados_cliente_id_fkey";

ALTER TABLE "certificados"
ALTER COLUMN "cliente_id" DROP NOT NULL;

ALTER TABLE "certificados"
ADD CONSTRAINT "certificados_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
