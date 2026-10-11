import { z } from 'zod';
import { APPOINTMENT_STATUSES } from './appointments';
import { dateSchema } from './common';
import { PAYMENT_METHODS } from './sales';

/**
 * Dashboard y reportes (Fase 8). Todo se mira por sucursal y por rango de fechas; los montos
 * viajan en centavos enteros, como en el resto del sistema.
 */

const methodAmount = z.object({ method: z.enum(PAYMENT_METHODS), amountCents: z.number() });

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const dashboardQuery = z.object({ branchId: z.uuid().optional() });

export const dashboardSchema = z.object({
  /** Día que se está mostrando, en la zona horaria del local. */
  date: z.string(),
  branchId: z.string().nullable(),
  /** La plata del día. */
  today: z.object({
    incomeCents: z.number(),
    byMethod: z.array(methodAmount),
    salesCount: z.number(),
    averageTicketCents: z.number(),
    /** Efectivo que debería haber en la caja ahora (null si no hay caja abierta). */
    cashOnHandCents: z.number().nullable(),
  }),
  week: z.object({ incomeCents: z.number(), salesCount: z.number() }),
  month: z.object({
    incomeCents: z.number(),
    salesCount: z.number(),
    /** Mismo tramo del mes pasado, para comparar peras con peras. */
    previousCents: z.number(),
  }),
  /** Los turnos del día. */
  appointments: z.object({
    total: z.number(),
    byStatus: z.array(z.object({ status: z.enum(APPOINTMENT_STATUSES), count: z.number() })),
    next: z.array(
      z.object({
        id: z.string(),
        startsAt: z.string(),
        customerName: z.string(),
        barberName: z.string(),
        services: z.array(z.string()),
        status: z.enum(APPOINTMENT_STATUSES),
      }),
    ),
  }),
  barbers: z.array(
    z.object({
      barberId: z.string(),
      name: z.string(),
      appointments: z.number(),
      bookedMinutes: z.number(),
      availableMinutes: z.number(),
      /** Ocupación en puntos básicos: 6000 = 60 %. */
      occupancyBps: z.number(),
    }),
  ),
  /** Clientes nuevos vs. de siempre, en el mes. */
  customers: z.object({ newOnes: z.number(), returning: z.number() }),
  alerts: z.object({
    lowStock: z.array(
      z.object({
        productId: z.string(),
        name: z.string(),
        stockOnHand: z.number(),
        minStock: z.number(),
      }),
    ),
    /** Cobros de Mercado Pago que no se pudieron atar a ninguna venta. */
    unmatchedPayments: z.number(),
    /** Ventas abiertas de días anteriores: quedaron sin cobrar. */
    staleOpenSales: z.number(),
    /** Cajas de días anteriores sin cerrar. */
    openCashSessions: z.number(),
    /** Mensajes que fallaron en los últimos 7 días. */
    failedNotifications: z.number(),
    /** El worker no da señales de vida. */
    workerDown: z.boolean(),
  }),
});
export type DashboardDto = z.infer<typeof dashboardSchema>;

// ---------------------------------------------------------------------------
// Reportes por rango
// ---------------------------------------------------------------------------

export const reportQuery = z
  .object({ from: dateSchema, to: dateSchema, branchId: z.uuid().optional() })
  .refine((v) => v.from <= v.to, { error: 'La fecha de inicio va antes que la de fin', path: ['from'] });
export type ReportQuery = z.input<typeof reportQuery>;

const namedAmount = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number(),
  amountCents: z.number(),
});

export const reportSchema = z.object({
  from: z.string(),
  to: z.string(),
  branchId: z.string().nullable(),
  sales: z.object({
    count: z.number(),
    /** Suma de las líneas antes de descuentos. */
    grossCents: z.number(),
    discountsCents: z.number(),
    /** Lo efectivamente cobrado (menos reintegros). */
    incomeCents: z.number(),
    averageTicketCents: z.number(),
    byMethod: z.array(methodAmount),
    byDay: z.array(z.object({ date: z.string(), amountCents: z.number(), count: z.number() })),
  }),
  services: z.array(namedAmount),
  products: z.array(namedAmount),
  barbers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      appointments: z.number(),
      services: z.number(),
      revenueCents: z.number(),
      commissionCents: z.number(),
      tipsCents: z.number(),
      noShows: z.number(),
    }),
  ),
  result: z.object({
    incomeCents: z.number(),
    expensesCents: z.number(),
    commissionsCents: z.number(),
    productCostCents: z.number(),
    resultCents: z.number(),
    expensesByCategory: z.array(z.object({ name: z.string(), amountCents: z.number() })),
  }),
  customers: z.object({ newOnes: z.number(), returning: z.number(), served: z.number() }),
  loyalty: z.object({
    pointsEarned: z.number(),
    pointsRedeemed: z.number(),
    pointsExpired: z.number(),
    /** Lo que costó en plata lo que se regaló por puntos. */
    rewardCostCents: z.number(),
    rewards: z.array(z.object({ name: z.string(), count: z.number(), pointsSpent: z.number() })),
  }),
});
export type ReportDto = z.infer<typeof reportSchema>;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const EXPORT_KINDS = ['ventas', 'comisiones', 'egresos', 'clientes', 'puntos'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  ventas: 'Ventas cobradas',
  comisiones: 'Comisiones por barbero',
  egresos: 'Egresos',
  clientes: 'Clientes',
  puntos: 'Movimientos de puntos',
};

export const EXPORT_KIND_HINTS: Record<ExportKind, string> = {
  ventas: 'Una fila por venta: fecha, cliente, qué se llevó, medios de pago y total.',
  comisiones: 'Una fila por comisión generada, con la venta y el barbero.',
  egresos: 'Una fila por gasto, con su categoría y quién lo cargó.',
  clientes: 'Datos de contacto, visitas y puntos. Incluye datos personales: cuidalo.',
  puntos: 'Cada movimiento de puntos: qué sumó, qué canjeó y qué se venció.',
};

export const exportParams = z.object({ kind: z.enum(EXPORT_KINDS) });
