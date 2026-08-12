-- CreateEnum
CREATE TYPE "UsuarioRole" AS ENUM ('admin', 'cliente');

-- CreateEnum
CREATE TYPE "EventoAcessoTipo" AS ENUM ('login_sucesso', 'login_falha', 'logout', 'token_renovado', 'sessao_expirada', 'acesso_negado');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(80) NOT NULL,
    "nome" VARCHAR(255),
    "password_hash" TEXT NOT NULL,
    "role" "UsuarioRole" NOT NULL,
    "cliente_id" UUID,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessoes_usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "login_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logout_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "ip" VARCHAR(100),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sessoes_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_acesso" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID,
    "sessao_id" UUID,
    "cliente_id" UUID,
    "username" VARCHAR(80),
    "tipo" "EventoAcessoTipo" NOT NULL,
    "detalhes" JSONB,
    "ip" VARCHAR(100),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eventos_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_key" ON "usuarios"("username");

-- CreateIndex
CREATE INDEX "usuarios_cliente_id_ativo_idx" ON "usuarios"("cliente_id", "ativo");

-- CreateIndex
CREATE INDEX "sessoes_usuario_usuario_id_revoked_at_idx" ON "sessoes_usuario"("usuario_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessoes_usuario_expires_at_idx" ON "sessoes_usuario"("expires_at");

-- CreateIndex
CREATE INDEX "eventos_acesso_created_at_idx" ON "eventos_acesso"("created_at");

-- CreateIndex
CREATE INDEX "eventos_acesso_tipo_created_at_idx" ON "eventos_acesso"("tipo", "created_at");

-- CreateIndex
CREATE INDEX "eventos_acesso_cliente_id_created_at_idx" ON "eventos_acesso"("cliente_id", "created_at");

-- AddForeignKey
ALTER TABLE "auditoria_usuario"
ADD CONSTRAINT "auditoria_usuario_usuario_id_fkey"
FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios"
ADD CONSTRAINT "usuarios_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_usuario"
ADD CONSTRAINT "sessoes_usuario_usuario_id_fkey"
FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_acesso"
ADD CONSTRAINT "eventos_acesso_usuario_id_fkey"
FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_acesso"
ADD CONSTRAINT "eventos_acesso_sessao_id_fkey"
FOREIGN KEY ("sessao_id") REFERENCES "sessoes_usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_acesso"
ADD CONSTRAINT "eventos_acesso_cliente_id_fkey"
FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
