import { z } from 'zod';
import { centsSchema, dateSchema, optionalText } from './common';
import { PAYMENT_METHODS } from './sales';

// ---------------------------------------------------------------------------
// Egresos y resultado del mes
// ---------------------------------------------------------------------------

/** Medios con los que se paga un egreso (la base no acepta otros). */
export const EXPENSE_METHODS = ['CASH', 'TRANSFER', 'OTHER'] as const;
export const EXPENSE_METHOD_LABELS: Record<(typeof EXPENSE_METHODS)[number], string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
};

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Mes inválido' });

export const expenseCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  systemKey: z.string().nullable(),
  active: z.boolean(),
});
export type ExpenseCategoryDto = z.infer<typeof expenseCategorySchema>;

export const expenseCategoryBody = z.object({
  name: z.string().trim().min(2, { error: 'Poné un nombre' }).max(60),
});

export const createExpenseBody = z
  .object({
    /** null = gasto general (no de una sucursal). */
    branchId: z.uuid().nullable(),
    categoryId: z.uuid(),
    amountCents: centsSchema.refine((v) => v > 0, { error: 'El monto tiene que ser mayor a 0' }),
    method: z.enum(EXPENSE_METHODS),
    occurredOn: dateSchema,
    description: z.string().trim().min(2, { error: 'Contá qué se pagó' }).max(200),
    supplier: optionalText(100),
    /** Se pagó con la plata de la caja abierta: descuenta del esperado. */
    fromCashSession: z.boolean().default(false),
  })
  .refine((v) => !v.fromCashSession || (v.method === 'CASH' && v.branchId), {
    error: 'Solo un pago en efectivo de una sucursal puede salir de la caja',
    path: ['fromCashSession'],
  });
export type CreateExpenseBody = z.input<typeof createExpenseBody>;

export const expenseIdParams = z.object({ expenseId: z.uuid() });

export const expenseSchema = z.object({
  id: z.string(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
  categoryId: z.string(),
  categoryName: z.string(),
  amountCents: z.number(),
  method: z.enum(PAYMENT_METHODS),
  occurredOn: z.string(),
  description: z.string(),
  supplier: z.string().nullable(),
  fromCashSession: z.boolean(),
  createdByName: z.string(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
});
export type ExpenseDto = z.infer<typeof expenseSchema>;

export const expenseListQuery = z.object({
  month: monthSchema,
  branchId: z.uuid().optional(),
});

export const voidReasonBody = z.object({
  reason: z.string().trim().min(3, { error: 'Contá el motivo' }).max(300),
});

export const monthlyResultQuery = z.object({
  month: monthSchema,
  branchId: z.uuid().optional(),
});

export const monthlyResultSchema = z.object({
  month: z.string(),
  branchId: z.string().nullable(),
  salesCount: z.number(),
  /** Cobrado en ventas del mes (menos reintegros). */
  incomeCents: z.number(),
  incomeByMethod: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amountCents: z.number() })),
  incomeByType: z.object({ services: z.number(), products: z.number(), tips: z.number() }),
  expensesCents: z.number(),
  expensesByCategory: z.array(z.object({ categoryName: z.string(), amountCents: z.number() })),
  resultCents: z.number(),
  /** Comisiones generadas en el mes (pagadas o no): costo del mes aunque se paguen después. */
  commissionsAccruedCents: z.number(),
  /** De esas, las que todavía no se pagaron. */
  commissionsUnpaidCents: z.number(),
  /** Costo de los productos vendidos (si tienen costo cargado). */
  productCostCents: z.number(),
});
export type MonthlyResult = z.infer<typeof monthlyResultSchema>;

// ---------------------------------------------------------------------------
// Stock por sucursal
// ---------------------------------------------------------------------------

export const STOCK_MOVEMENT_LABELS: Record<string, string> = {
  INITIAL: 'Stock inicial',
  PURCHASE: 'Compra',
  SALE: 'Venta',
  SALE_VOID: 'Venta anulada',
  ADJUSTMENT_IN: 'Ajuste (+)',
  ADJUSTMENT_OUT: 'Ajuste (−)',
  INTERNAL_USE: 'Uso interno',
  TRANSFER_IN: 'Transferencia (entra)',
  TRANSFER_OUT: 'Transferencia (sale)',
};

export const STOCK_ADJUST_TYPES = ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'INTERNAL_USE'] as const;

export const stockItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  categoryName: z.string().nullable(),
  stockOnHand: z.number(),
  minStock: z.number().nullable(),
  low: z.boolean(),
  priceCents: z.number(),
  costCents: z.number().nullable(),
});
export type StockItem = z.infer<typeof stockItemSchema>;

export const stockPurchaseBody = z.object({
  quantity: z.number().int().min(1).max(100_000),
  /** Costo unitario de esta compra (actualiza el costo del producto). */
  unitCostCents: centsSchema.nullish(),
  note: optionalText(200),
});
export type StockPurchaseBody = z.input<typeof stockPurchaseBody>;

export const stockAdjustBody = z.object({
  type: z.enum(STOCK_ADJUST_TYPES),
  quantity: z.number().int().min(1).max(100_000),
  reason: z.string().trim().min(3, { error: 'Contá el motivo del ajuste' }).max(200),
});
export type StockAdjustBody = z.input<typeof stockAdjustBody>;

export const minStockBody = z.object({ minStock: z.number().int().min(0).max(100_000).nullable() });

export const stockMovementSchema = z.object({
  id: z.string(),
  type: z.string(),
  quantity: z.number(),
  balanceAfter: z.number(),
  reason: z.string().nullable(),
  saleNumber: z.number().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export type StockMovementDto = z.infer<typeof stockMovementSchema>;

// ---------------------------------------------------------------------------
// Comisiones y liquidaciones
// ---------------------------------------------------------------------------

export const SETTLEMENT_STATUS_LABELS = { DRAFT: 'Borrador', PAID: 'Pagada', VOIDED: 'Anulada' } as const;
export const SETTLEMENT_METHODS = ['CASH', 'TRANSFER', 'OTHER'] as const;

export const commissionSummaryQuery = z.object({ until: dateSchema });

export const barberCommissionSummarySchema = z.object({
  barberId: z.string(),
  barberName: z.string(),
  settlementPeriod: z.string(),
  /** Sin liquidar hasta la fecha pedida. */
  pendingCents: z.number(),
  entriesCount: z.number(),
  oldestPending: z.string().nullable(),
  lastSettlementEnd: z.string().nullable(),
});
export type BarberCommissionSummary = z.infer<typeof barberCommissionSummarySchema>;

export const commissionEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  kind: z.enum(['EARNED', 'REVERSAL', 'ADJUSTMENT']),
  itemType: z.enum(['SERVICE', 'PRODUCT', 'TIP']).nullable(),
  description: z.string(),
  saleNumber: z.number().nullable(),
  baseCents: z.number(),
  rateBps: z.number(),
  amountCents: z.number(),
});
export type CommissionEntryDto = z.infer<typeof commissionEntrySchema>;

export const createSettlementBody = z
  .object({ barberId: z.uuid(), periodStart: dateSchema, periodEnd: dateSchema })
  .refine((v) => v.periodEnd >= v.periodStart, { error: 'El fin tiene que ser posterior al inicio' });
export type CreateSettlementBody = z.input<typeof createSettlementBody>;

export const settlementIdParams = z.object({ settlementId: z.uuid() });

export const settlementSchema = z.object({
  id: z.string(),
  barberId: z.string(),
  barberName: z.string(),
  organizationName: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalCents: z.number(),
  status: z.enum(['DRAFT', 'PAID', 'VOIDED']),
  createdAt: z.string(),
  createdByName: z.string(),
  paidAt: z.string().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  voidReason: z.string().nullable(),
  byType: z.object({ services: z.number(), products: z.number(), tips: z.number(), adjustments: z.number() }),
  entries: z.array(commissionEntrySchema),
});
export type SettlementDto = z.infer<typeof settlementSchema>;

export const settlementListItemSchema = settlementSchema.omit({ entries: true, byType: true });
export type SettlementListItem = z.infer<typeof settlementListItemSchema>;

export const paySettlementBody = z
  .object({
    method: z.enum(SETTLEMENT_METHODS),
    /** Se pagó con plata de la caja abierta de esa sucursal. */
    fromCashSessionBranchId: z.uuid().nullish(),
  })
  .refine((v) => !v.fromCashSessionBranchId || v.method === 'CASH', {
    error: 'Solo un pago en efectivo puede salir de la caja',
  });
export type PaySettlementBody = z.input<typeof paySettlementBody>;
