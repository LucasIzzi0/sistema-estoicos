import { z } from 'zod';
import { PRICE_ROUNDINGS } from '../pricing';
import { bpsSchema, centsSchema, optionalText } from './common';

// ---------------------------------------------------------------------------
// Categorías (servicios y productos usan la misma forma)
// ---------------------------------------------------------------------------

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  active: z.boolean(),
});
export type Category = z.infer<typeof categorySchema>;

export const categoryBody = z.object({
  name: z.string().trim().min(1, { error: 'Poné un nombre' }).max(60),
  sortOrder: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
});

export const categoryIdParams = z.object({ categoryId: z.uuid() });

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------

export const DEPOSIT_MODES = ['NONE', 'FIXED', 'PERCENT'] as const;

export const serviceBranchSchema = z.object({
  branchId: z.string(),
  /** Si se ofrece en esa sucursal. */
  offered: z.boolean(),
  /** Precio propio de la sucursal (null = usa el precio base). */
  priceCentsOverride: z.number().nullable(),
});

export const serviceSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  durationMin: z.number(),
  basePriceCents: z.number(),
  active: z.boolean(),
  onlineBookable: z.boolean(),
  pointsOverride: z.number().nullable(),
  commissionBpsOverride: z.number().nullable(),
  depositMode: z.enum(DEPOSIT_MODES),
  depositFixedCents: z.number().nullable(),
  depositPercentBps: z.number().nullable(),
  sortOrder: z.number(),
  archived: z.boolean(),
  branches: z.array(serviceBranchSchema),
});
export type ServiceDto = z.infer<typeof serviceSchema>;

const serviceFields = {
  name: z.string().trim().min(1, { error: 'Poné un nombre' }).max(80),
  description: optionalText(300),
  categoryId: z.uuid().nullable(),
  durationMin: z
    .number()
    .int()
    .min(5, { error: 'La duración mínima es de 5 minutos' })
    .max(600, { error: 'La duración máxima es de 10 horas' })
    .refine((v) => v % 5 === 0, { error: 'La duración va de 5 en 5 minutos' }),
  basePriceCents: centsSchema,
  active: z.boolean(),
  onlineBookable: z.boolean(),
  pointsOverride: z.number().int().min(0).max(100_000).nullable(),
  commissionBpsOverride: bpsSchema.nullable(),
  depositMode: z.enum(DEPOSIT_MODES),
  depositFixedCents: centsSchema.nullable(),
  depositPercentBps: bpsSchema.nullable(),
  sortOrder: z.number().int().min(0).max(999),
};

/** La seña es fija o porcentual, nunca las dos (la base también lo exige). */
export function depositProblem(v: {
  depositMode: (typeof DEPOSIT_MODES)[number];
  depositFixedCents: number | null;
  depositPercentBps: number | null;
}): string | null {
  if (v.depositMode === 'NONE') return null;
  if (v.depositMode === 'FIXED' && !(v.depositFixedCents && v.depositFixedCents > 0)) {
    return 'Indicá el monto de la seña';
  }
  if (v.depositMode === 'PERCENT' && !(v.depositPercentBps && v.depositPercentBps > 0)) {
    return 'Indicá el porcentaje de la seña';
  }
  return null;
}

export const createServiceBody = z
  .object({
    ...serviceFields,
    description: serviceFields.description,
    active: serviceFields.active.default(true),
    onlineBookable: serviceFields.onlineBookable.default(true),
    pointsOverride: serviceFields.pointsOverride.default(null),
    commissionBpsOverride: serviceFields.commissionBpsOverride.default(null),
    depositMode: serviceFields.depositMode.default('NONE'),
    depositFixedCents: serviceFields.depositFixedCents.default(null),
    depositPercentBps: serviceFields.depositPercentBps.default(null),
    sortOrder: serviceFields.sortOrder.default(0),
  })
  .superRefine((v, ctx) => {
    const problem = depositProblem(v);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['depositMode'] });
  });
export type CreateServiceBody = z.input<typeof createServiceBody>;

export const updateServiceBody = z.object({ ...serviceFields, archived: z.boolean() }).partial();
export type UpdateServiceBody = z.input<typeof updateServiceBody>;

export const serviceIdParams = z.object({ serviceId: z.uuid() });

export const branchServiceParams = z.object({ branchId: z.uuid(), serviceId: z.uuid() });

export const setBranchServiceBody = z.object({
  offered: z.boolean(),
  priceCentsOverride: centsSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Aumento masivo de precios (servicios o productos)
// ---------------------------------------------------------------------------

export const bulkPriceBody = z.object({
  /** 1000 = +10 %; −500 = −5 %. */
  percentBps: z
    .number()
    .int()
    .min(-5_000, { error: 'La baja máxima es del 50 %' })
    .max(20_000, { error: 'El aumento máximo es del 200 %' })
    .refine((v) => v !== 0, { error: 'Indicá un porcentaje distinto de cero' }),
  roundToCents: z
    .number()
    .int()
    .refine((v) => (PRICE_ROUNDINGS as readonly number[]).includes(v), { error: 'Redondeo inválido' }),
  /** Vacío = todos los activos. */
  ids: z.array(z.uuid()).default([]),
  /** También los precios propios de cada sucursal. */
  includeBranchPrices: z.boolean().default(true),
});
export type BulkPriceBody = z.input<typeof bulkPriceBody>;

export const bulkPriceResult = z.object({
  updated: z.number(),
  changes: z.array(z.object({ id: z.string(), name: z.string(), before: z.number(), after: z.number() })),
});
export type BulkPriceResult = z.infer<typeof bulkPriceResult>;

// ---------------------------------------------------------------------------
// Productos (el stock por sucursal llega en la Fase 4)
// ---------------------------------------------------------------------------

export const productBranchSchema = z.object({
  branchId: z.string(),
  offered: z.boolean(),
  priceCentsOverride: z.number().nullable(),
});

export const productSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  basePriceCents: z.number(),
  costCents: z.number().nullable(),
  trackStock: z.boolean(),
  active: z.boolean(),
  pointsOverride: z.number().nullable(),
  commissionBpsOverride: z.number().nullable(),
  archived: z.boolean(),
  branches: z.array(productBranchSchema),
});
export type ProductDto = z.infer<typeof productSchema>;

const productFields = {
  name: z.string().trim().min(1, { error: 'Poné un nombre' }).max(80),
  description: optionalText(300),
  categoryId: z.uuid().nullable(),
  sku: optionalText(40),
  barcode: optionalText(40),
  basePriceCents: centsSchema,
  costCents: centsSchema.nullable(),
  trackStock: z.boolean(),
  active: z.boolean(),
  pointsOverride: z.number().int().min(0).max(100_000).nullable(),
  commissionBpsOverride: bpsSchema.nullable(),
};

export const createProductBody = z.object({
  ...productFields,
  costCents: productFields.costCents.default(null),
  trackStock: productFields.trackStock.default(true),
  active: productFields.active.default(true),
  pointsOverride: productFields.pointsOverride.default(null),
  commissionBpsOverride: productFields.commissionBpsOverride.default(null),
});
export type CreateProductBody = z.input<typeof createProductBody>;

export const updateProductBody = z.object({ ...productFields, archived: z.boolean() }).partial();
export type UpdateProductBody = z.input<typeof updateProductBody>;

export const productIdParams = z.object({ productId: z.uuid() });
export const branchProductParams = z.object({ branchId: z.uuid(), productId: z.uuid() });

export const setBranchProductBody = z.object({
  offered: z.boolean(),
  priceCentsOverride: centsSchema.nullable(),
});
