-- Fase 4: las propinas quedan para la casa (P22). Todavía no hay datos reales: se pasan a 0 los barberos
-- que tenían el valor anterior por defecto (100 %).
-- AlterTable
ALTER TABLE "barbers" ALTER COLUMN "tip_commission_bps" SET DEFAULT 0;


UPDATE "barbers" SET "tip_commission_bps" = 0 WHERE "tip_commission_bps" = 10000;
