-- Fase 3: fusión de clientes duplicados.
-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "merged_at" TIMESTAMPTZ(3),
ADD COLUMN     "merged_into_id" UUID;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Un cliente no se fusiona en sí mismo.
ALTER TABLE "customers" ADD CONSTRAINT "customers_merge_not_self" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");
