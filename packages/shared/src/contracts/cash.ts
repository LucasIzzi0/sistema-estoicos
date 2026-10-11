import { z } from 'zod';
import { centsSchema, dateSchema, optionalText } from './common';
import { MANUAL_PAYMENT_METHODS, PAYMENT_METHODS } from './sales';

/**
 * Caja diaria por sucursal (P10): apertura con el efectivo inicial, aportes y retiros,
 * egresos pagados con plata de la caja y cierre con arqueo por medio de pago.
 */
export const CASH_MOVEMENT_TYPES = ['CONTRIBUTION', 'WITHDRAWAL'] as const;
export const CASH_MOVEMENT_LABELS: Record<(typeof CASH_MOVEMENT_TYPES)[number], string> = {
  CONTRIBUTION: 'Aporte',
  WITHDRAWAL: 'Retiro',
};

export const cashSessionIdParams = z.object({ sessionId: z.uuid() });

export const cashTotalsSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  salesCents: z.number(),
  refundsCents: z.number(),
  expensesCents: z.number(),
  movementsCents: z.number(),
  /** Lo que debería haber (efectivo: incluye el inicial). */
  expectedCents: z.number(),
});

export const cashSessionSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  businessDate: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  openingCashCents: z.number(),
  openingNote: z.string().nullable(),
  openedAt: z.string(),
  openedByName: z.string(),
  closedAt: z.string().nullable(),
  closedByName: z.string().nullable(),
  closingNote: z.string().nullable(),
  totals: z.array(cashTotalsSchema),
  salesCount: z.number(),
  salesTotalCents: z.number(),
  openSalesCount: z.number(),
  movements: z.array(
    z.object({
      id: z.string(),
      type: z.enum(CASH_MOVEMENT_TYPES),
      amountCents: z.number(),
      description: z.string(),
      createdAt: z.string(),
      createdByName: z.string(),
      voided: z.boolean(),
    }),
  ),
  expenses: z.array(
    z.object({
      id: z.string(),
      categoryName: z.string(),
      amountCents: z.number(),
      description: z.string(),
      createdAt: z.string(),
      voided: z.boolean(),
    }),
  ),
  counts: z.array(
    z.object({
      method: z.enum(PAYMENT_METHODS),
      expectedCents: z.number(),
      countedCents: z.number(),
      differenceCents: z.number(),
      note: z.string().nullable(),
    }),
  ),
});
export type CashSessionDto = z.infer<typeof cashSessionSchema>;

export const openCashBody = z.object({
  openingCashCents: centsSchema,
  note: optionalText(300),
});
export type OpenCashBody = z.input<typeof openCashBody>;

export const cashMovementBody = z.object({
  type: z.enum(CASH_MOVEMENT_TYPES),
  amountCents: centsSchema.refine((v) => v > 0, { error: 'El monto tiene que ser mayor a 0' }),
  description: z.string().trim().min(3, { error: 'Contá de qué es el movimiento' }).max(200),
});
export type CashMovementBody = z.input<typeof cashMovementBody>;

export const closeCashBody = z.object({
  counts: z
    .array(
      z.object({
        method: z.enum(MANUAL_PAYMENT_METHODS),
        countedCents: centsSchema,
        note: optionalText(200),
      }),
    )
    .min(1),
  note: optionalText(500),
});
export type CloseCashBody = z.input<typeof closeCashBody>;

export const cashSessionListQuery = z.object({
  from: dateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const cashSessionListItemSchema = z.object({
  id: z.string(),
  businessDate: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  openedByName: z.string(),
  closedByName: z.string().nullable(),
  salesTotalCents: z.number(),
  /** Diferencia total del arqueo (null si sigue abierta). */
  differenceCents: z.number().nullable(),
});
export type CashSessionListItem = z.infer<typeof cashSessionListItemSchema>;
