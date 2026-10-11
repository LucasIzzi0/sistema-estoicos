import { z } from 'zod';
import { bpsSchema, centsSchema, optionalText } from './common';

/** Puntos y recompensas (Fase 7). */
export const REWARD_TYPES = ['FREE_SERVICE', 'FREE_PRODUCT', 'FIXED_DISCOUNT', 'PERCENT_DISCOUNT'] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

export const REWARD_TYPE_LABELS: Record<RewardType, string> = {
  FREE_SERVICE: 'Un servicio gratis',
  FREE_PRODUCT: 'Un producto de regalo',
  FIXED_DISCOUNT: 'Descuento de un monto fijo',
  PERCENT_DISCOUNT: 'Descuento de un porcentaje',
};

export const POINTS_ENTRY_TYPES = ['EARN', 'REDEEM', 'EXPIRE', 'ADJUST', 'REVERSAL'] as const;
export const POINTS_ENTRY_LABELS: Record<(typeof POINTS_ENTRY_TYPES)[number], string> = {
  EARN: 'Sumó por una compra',
  REDEEM: 'Canjeó una recompensa',
  EXPIRE: 'Vencieron',
  ADJUST: 'Ajuste manual',
  REVERSAL: 'Devolución por anulación',
};

export const loyaltySettingsSchema = z.object({
  enabled: z.boolean(),
  /** X puntos cada $Y. */
  pointsPerStep: z.number().int(),
  spendStepCents: z.number().int(),
  expiryMonths: z.number().int().nullable(),
  earnOnProducts: z.boolean(),
  /** Base de la comisión cuando el servicio se pagó con puntos. */
  rewardCommissionBase: z.enum(['LIST_PRICE', 'CHARGED_AMOUNT']),
});
export type LoyaltySettings = z.infer<typeof loyaltySettingsSchema>;

export const updateLoyaltySettingsBody = z.object({
  enabled: z.boolean().optional(),
  pointsPerStep: z.number().int().min(1).max(1000).optional(),
  spendStepCents: centsSchema.refine((v) => v > 0, { error: 'Tiene que ser mayor a $0' }).optional(),
  expiryMonths: z.number().int().min(1).max(120).nullable().optional(),
  earnOnProducts: z.boolean().optional(),
  rewardCommissionBase: z.enum(['LIST_PRICE', 'CHARGED_AMOUNT']).optional(),
});
export type UpdateLoyaltySettingsBody = z.input<typeof updateLoyaltySettingsBody>;

export const rewardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(REWARD_TYPES),
  pointsCost: z.number(),
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
  productId: z.string().nullable(),
  productName: z.string().nullable(),
  discountFixedCents: z.number().nullable(),
  discountPercentBps: z.number().nullable(),
  active: z.boolean(),
  archived: z.boolean(),
  /** Cuántas veces se canjeó. */
  redemptions: z.number(),
});
export type RewardDto = z.infer<typeof rewardSchema>;

export const rewardBody = z
  .object({
    name: z.string().trim().min(2, { error: 'Poné un nombre' }).max(80),
    description: optionalText(200),
    type: z.enum(REWARD_TYPES),
    pointsCost: z.number().int().min(1, { error: 'Poné cuántos puntos cuesta' }).max(1_000_000),
    serviceId: z.uuid().nullish(),
    productId: z.uuid().nullish(),
    discountFixedCents: centsSchema.nullish(),
    discountPercentBps: bpsSchema.nullish(),
    active: z.boolean().default(true),
  })
  .refine((v) => v.type !== 'FREE_SERVICE' || !!v.serviceId, {
    error: 'Elegí qué servicio se regala',
    path: ['serviceId'],
  })
  .refine((v) => v.type !== 'FREE_PRODUCT' || !!v.productId, {
    error: 'Elegí qué producto se regala',
    path: ['productId'],
  })
  .refine((v) => v.type !== 'FIXED_DISCOUNT' || !!v.discountFixedCents, {
    error: 'Poné el monto del descuento',
    path: ['discountFixedCents'],
  })
  .refine((v) => v.type !== 'PERCENT_DISCOUNT' || !!v.discountPercentBps, {
    error: 'Poné el porcentaje del descuento',
    path: ['discountPercentBps'],
  });
export type RewardBody = z.input<typeof rewardBody>;

export const rewardIdParams = z.object({ rewardId: z.uuid() });

// ---------------------------------------------------------------------------
// Saldo y movimientos de un cliente
// ---------------------------------------------------------------------------

export const pointsEntrySchema = z.object({
  id: z.string(),
  type: z.enum(POINTS_ENTRY_TYPES),
  points: z.number(),
  reason: z.string().nullable(),
  saleNumber: z.number().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PointsEntryDto = z.infer<typeof pointsEntrySchema>;

export const customerPointsSchema = z.object({
  balance: z.number(),
  /** Puntos que vencen en los próximos 60 días. */
  expiringSoon: z.number(),
  expiringOn: z.string().nullable(),
  entries: z.array(pointsEntrySchema),
});
export type CustomerPoints = z.infer<typeof customerPointsSchema>;

/** Lo que ve el cliente en "Mis puntos". */
export const myPointsSchema = z.object({
  enabled: z.boolean(),
  balance: z.number(),
  expiringSoon: z.number(),
  expiringOn: z.string().nullable(),
  entries: z.array(pointsEntrySchema),
  rewards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      pointsCost: z.number(),
      /** Ya tiene puntos suficientes. */
      affordable: z.boolean(),
      missingPoints: z.number(),
    }),
  ),
});
export type MyPoints = z.infer<typeof myPointsSchema>;

export const adjustPointsBody = z.object({
  points: z
    .number()
    .int()
    .refine((v) => v !== 0, { error: 'Poné cuántos puntos sumar o restar' })
    .refine((v) => Math.abs(v) <= 100_000, { error: 'Ese ajuste es demasiado grande' }),
  reason: z.string().trim().min(3, { error: 'Contá el motivo del ajuste' }).max(200),
});
export type AdjustPointsBody = z.input<typeof adjustPointsBody>;

// ---------------------------------------------------------------------------
// Canje en el cobro
// ---------------------------------------------------------------------------

export const redeemRewardBody = z.object({
  rewardId: z.uuid(),
  /** Línea de la venta sobre la que se aplica (para regalos y descuentos por línea). */
  saleItemId: z.uuid().nullish(),
});
export type RedeemRewardBody = z.input<typeof redeemRewardBody>;

export const redemptionIdParams = z.object({ saleId: z.uuid(), redemptionId: z.uuid() });

/** Recompensas que este cliente puede canjear en esta venta. */
export const availableRewardSchema = z.object({
  id: z.string(),
  name: z.string(),
  pointsCost: z.number(),
  type: z.enum(REWARD_TYPES),
  /** Líneas de la venta a las que se puede aplicar. */
  applicableItemIds: z.array(z.string()),
  affordable: z.boolean(),
});

export const saleLoyaltySchema = z.object({
  customerId: z.string().nullable(),
  balance: z.number(),
  rewards: z.array(availableRewardSchema),
  redemptions: z.array(
    z.object({
      id: z.string(),
      rewardName: z.string(),
      pointsSpent: z.number(),
      saleItemId: z.string().nullable(),
    }),
  ),
});
export type SaleLoyalty = z.infer<typeof saleLoyaltySchema>;
