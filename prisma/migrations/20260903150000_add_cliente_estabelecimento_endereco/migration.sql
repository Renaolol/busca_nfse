ALTER TABLE "cliente_estabelecimentos"
ADD COLUMN "logradouro" VARCHAR(255),
ADD COLUMN "bairro" VARCHAR(120),
ADD COLUMN "cep" VARCHAR(20),
ADD COLUMN "uf" VARCHAR(2);
