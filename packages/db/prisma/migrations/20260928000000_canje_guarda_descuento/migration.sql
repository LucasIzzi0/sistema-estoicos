-- Fase 7: el canje guarda cuánto descontó. Deshacer un canje tiene que sacar exactamente ese monto:
-- recalcularlo sobre la línea ya rebajada devolvía de menos (un 20 % sobre el precio con descuento).
-- AlterTable
ALTER TABLE "reward_redemptions" ADD COLUMN "discount_cents" BIGINT NOT NULL DEFAULT 0;
