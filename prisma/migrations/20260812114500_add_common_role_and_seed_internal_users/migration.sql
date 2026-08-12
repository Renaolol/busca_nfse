CREATE TYPE "UsuarioRole_new" AS ENUM ('admin', 'comum', 'cliente');

ALTER TABLE "usuarios"
ALTER COLUMN "role" TYPE "UsuarioRole_new"
USING ("role"::text::"UsuarioRole_new");

DROP TYPE "UsuarioRole";

ALTER TYPE "UsuarioRole_new" RENAME TO "UsuarioRole";

INSERT INTO "usuarios" (
  "id",
  "username",
  "nome",
  "password_hash",
  "role",
  "cliente_id",
  "ativo",
  "password_changed_at",
  "created_at",
  "updated_at"
)
VALUES
  (gen_random_uuid(), 'renan', 'Renan', 'scrypt$IWn3LmHHXj0/8MApaHo2xg==$PCNpyKP4y06Xs8X8+TuwF6JDiDg051izZ0QQgpBA4BKSYAir0WdpCNuFMK80JmXqWtNilV2+Og5CUFcWs/IsTQ==', 'admin', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'giovana', 'Giovana', 'scrypt$kdzNm2QTR3BWdcVJYhIXag==$aPOL1U38yA7xO7Q1QTaFJyIcInSDZoW/W9V1dC72RAo3YmbTv+xb8TasaXJY3t68T2IPVzDa+qg8PG2b2A/5PA==', 'admin', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'josi', 'Josi', 'scrypt$B9zrGlvnQbyBST5JmmAQDw==$iCvh0r+YnRUhDtjcoH4UsunnlIpWRbCPgJVC1oa+q4cZXrVsz2J+lDPg/4QJlk9YCQnQpWlxMj9Ut4Zeojhumw==', 'admin', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'dani', 'Dani', 'scrypt$Pv7ntJ2tEASQ7EiBnl36Wg==$Xy0W4UhDAE91r5SizfD4Lrs3SZmVM1VwOZkNuTPU24470yMaWu9tCeJaOhMmcT/KqlJ1BYqoOKlYBLOboZ2SqQ==', 'admin', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'vera', 'Vera', 'scrypt$CxCZEsbghG52mhPb6+yVPw==$yAtHBLIC5KUhy3g0ebQnge3nOX/8onurv0iA69zndxqXp6yqNBk+80f1kTe1D6a7mdJZhyFTeBGmwTAUVMZbpg==', 'admin', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'leticia', 'Leticia', 'scrypt$3heEHI7vlhrwnbD6oht6zw==$coGXAnqb8q/iDqSUfwUO1Y9Tp8YBWLuTBjZlZIWnyb1trtyFHpz+uBEtfh6pPIiyT2Wc5wvYzbW7EID/hXahFQ==', 'comum', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'djeuriston', 'Djeuriston', 'scrypt$4vpqBe3S+I0w9c0FkzeApA==$7sB5gcqrKOB5bbHVHulxNi/Tc7FlJcZ6qjGMb3BLmHvuBizBp1yFsnuXOoS1LTogJ9Aa2igJhG1M4USBJ8lVRg==', 'comum', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'nathalia', 'Nathalia', 'scrypt$OzvVzWV5nHLs/PUmC0824g==$bzNKHg2QvJaSWSf2h7tFcsaE/xegwjWRqGIAvvOBDu7oQj+R26WRUuG6xLXrx1d82t7BBhGT1JFqy5diRfMixQ==', 'comum', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'andre', 'André', 'scrypt$yTabbaMvJcdTWsRY5HVxcw==$Hy1bwRgPiA4U0gMRGFro16ud8Zd2JBm6OAWQjnDuJSfTE0A5J9gYnkphXlOohb7bOquqLSYBd9uy8CvXxI5d9w==', 'comum', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'mister', 'Mister', 'scrypt$FQgmY0pv/3paGro6Fu11fw==$Vs5dUZb64Ur2LgMCLaAaRjbsH3JjqblahR4qnjD4sL08FP2M0mS7w7bZR3px7Jdv6z0461NK8QaTqXglRaWZnA==', 'comum', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'lucas', 'Lucas', 'scrypt$4+qkoZTciSDYDnvJkPBcqQ==$I79X3Y0swcJcPRkdNxkjHpzoHHKOqpu4gPr/LViRgO+2gmA54+7Rx4BPEAejPEpBW2++/faumg00/8JgU4jvDA==', 'admin', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'gabi', 'Gabi', 'scrypt$aKAwcgQSqY85W5jkyuTn1g==$rdygtREWGMbFSd1REqpWCiFUlGDgyzGVyIp3ql4xjvEDNSxrTdcOevh667BOsyvu9kuCnCLbF1wq6Er3mh7T8A==', 'comum', NULL, true, now(), now(), now()),
  (gen_random_uuid(), 'ana', 'Ana', 'scrypt$WF+QnmzHkjYECZR059TVSQ==$qx3eS0pdutn5m5YiPMttGBNPdVQGKiyH229bKyFpC3brL0n6Kt4qIianQ5QT2BFF5FKvz13cdV5dxKE7UMUz+Q==', 'comum', NULL, true, now(), now(), now())
ON CONFLICT ("username") DO UPDATE
SET
  "nome" = EXCLUDED."nome",
  "password_hash" = EXCLUDED."password_hash",
  "role" = EXCLUDED."role",
  "cliente_id" = EXCLUDED."cliente_id",
  "ativo" = EXCLUDED."ativo",
  "password_changed_at" = EXCLUDED."password_changed_at",
  "updated_at" = now();
