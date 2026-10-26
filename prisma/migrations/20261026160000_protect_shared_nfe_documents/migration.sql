ALTER TABLE "nfe_documentos"
    DROP CONSTRAINT "nfe_documentos_cliente_id_fkey",
    ADD CONSTRAINT "nfe_documentos_cliente_id_fkey"
    FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "nfe_documentos"
    DROP CONSTRAINT "nfe_documentos_estabelecimento_id_fkey",
    ADD CONSTRAINT "nfe_documentos_estabelecimento_id_fkey"
    FOREIGN KEY ("estabelecimento_id") REFERENCES "cliente_estabelecimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
