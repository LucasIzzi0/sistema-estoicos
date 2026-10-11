-- Fase 2: los barberos dejan de ser usuarios (decisión del 25/09/2026) y se agrega el rol RECEPTION.
-- Paso previo: desvincular y quitar las membresías de barbero existentes (sus perfiles Barber se conservan).
UPDATE "barbers" SET "membership_id" = NULL
  WHERE "membership_id" IN (SELECT "id" FROM "memberships" WHERE "role" = 'BARBER');
DELETE FROM "membership_branches"
  WHERE "membership_id" IN (SELECT "id" FROM "memberships" WHERE "role" = 'BARBER');
DELETE FROM "memberships" WHERE "role" = 'BARBER';

-- Búsqueda de clientes por trigramas (sin acentos ni mayúsculas: lo normaliza la aplicación).
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- AlterEnum
BEGIN;
CREATE TYPE "member_role_new" AS ENUM ('ADMIN', 'RECEPTION');
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "member_role_new" USING ("role"::text::"member_role_new");
ALTER TYPE "member_role" RENAME TO "member_role_old";
ALTER TYPE "member_role_new" RENAME TO "member_role";
DROP TYPE "public"."member_role_old";
COMMIT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "customers_search_trgm" ON "customers" USING GIN ("search_text" gin_trgm_ops);
