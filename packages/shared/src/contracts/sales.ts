import { z } from 'zod';
import { centsSchema, dateSchema, optionalText } from './common';

/**
 * Ventas y cobros (Fase 4). "Cerrar servicio" crea la venta desde el turno con el precio
 * reservado; también hay venta de mostrador. Se cobra en un solo paso (pagos divididos
 * incluidos) y la venta pasa a PAGADA: ahí se generan comisiones y se descuenta el stock.
 */
export const PAYMENT_METHODS = [
  'CASH',
  'TRANSFER',
  'MP_POINT',
  'MP_CHECKOUT',
  'MP_OTHER',
  'CUSTOMER_CREDIT',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Medios que se cargan a mano en la caja (decisión del 25/09/2026). */
export const MANUAL_PAYMENT_METHODS = ['CASH', 'TRANSFER', 'MP_POINT', 'OTHER'] as const;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  MP_POINT: 'Point Mercado Pago',
  MP_CHECKOUT: 'Mercado Pago online',
  MP_OTHER: 'Mercado Pago',
  CUSTOMER_CREDIT: 'Saldo a favor',
  OTHER: 'QR / otro posnet',
};

export const SALE_STATUSES = ['OPEN', 'PAID', 'VOIDED'] as const;
export const SALE_STATUS_LABELS: Record<(typeof SALE_STATUSES)[number], string> = {
  OPEN: 'Abierta',
  PAID: 'Cobrada',
  VOIDED: 'Anulada',
};

export const SALE_ITEM_TYPES = ['SERVICE', 'PRODUCT', 'TIP'] as const;
export const SALE_ITEM_TYPE_LABELS: Record<(typeof SALE_ITEM_TYPES)[number], string> = {
  SERVICE: 'Servicio',
  PRODUCT: 'Producto',
  TIP: 'Propina',
};

export const saleIdParams = z.object({ saleId: z.uuid() });
export const saleItemParams = z.object({ saleId: z.uuid(), itemId: z.uuid() });

export const saleItemSchema = z.object({
  id: z.string(),
  type: z.enum(SALE_ITEM_TYPES),
  serviceId: z.string().nullable(),
  productId: z.string().nullable(),
  barberId: z.string().nullable(),
  barberName: z.string().nullable(),
  description: z.string(),
  quantity: z.number(),
  unitPriceCents: z.number(),
  discountCents: z.number(),
  totalCents: z.number(),
  discountReason: z.string().nullable(),
  /** Viene del turno: el precio es el reservado. */
  fromAppointment: z.boolean(),
});
export type SaleItemDto = z.infer<typeof saleItemSchema>;

export const salePaymentSchema = z.object({
  id: z.string(),
  method: z.enum(PAYMENT_METHODS),
  status: z.string(),
  amountCents: z.number(),
  refundedCents: z.number(),
  reference: z.string().nullable(),
  receivedByName: z.string().nullable(),
  createdAt: z.string(),
});

export const saleDetailSchema = z.object({
  id: z.string(),
  number: z.number(),
  branchId: z.string(),
  status: z.enum(SALE_STATUSES),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  appointmentId: z.string().nullable(),
  subtotalCents: z.number(),
  discountCents: z.number(),
  totalCents: z.number(),
  paidCents: z.number(),
  refundedCents: z.number(),
  remainingCents: z.number(),
  notes: z.string().nullable(),
  items: z.array(saleItemSchema),
  payments: z.array(salePaymentSchema),
  createdAt: z.string(),
  createdByName: z.string(),
  paidAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  /** Productos que quedaron por debajo del mínimo (o en negativo) al cobrar. */
  stockWarnings: z.array(z.object({ productName: z.string(), stockOnHand: z.number() })),
});
export type SaleDetail = z.infer<typeof saleDetailSchema>;

export const saleListItemSchema = z.object({
  id: z.string(),
  number: z.number(),
  status: z.enum(SALE_STATUSES),
  customerName: z.string().nullable(),
  summary: z.string(),
  totalCents: z.number(),
  paidCents: z.number(),
  methods: z.array(z.enum(PAYMENT_METHODS)),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
});
export type SaleListItem = z.infer<typeof saleListItemSchema>;

export const saleListQuery = z.object({
  /** Un día puntual. Sin fechas ni búsqueda, se muestra el día de hoy. */
  date: dateSchema.optional(),
  /** Rango, para buscar una venta de la semana pasada. */
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  status: z.enum(SALE_STATUSES).optional(),
  /** Número de venta o nombre del cliente. */
  q: z.string().trim().max(60).optional(),
});
export type SaleListQuery = z.input<typeof saleListQuery>;

/** Venta de mostrador (sin turno). El cliente es opcional (P18). */
export const createSaleBody = z.object({ customerId: z.uuid().nullish() });

export const addSaleItemBody = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PRODUCT'),
    productId: z.uuid(),
    quantity: z.number().int().min(1).max(999).default(1),
    /** Quién lo vendió (comisión de productos). Opcional. */
    barberId: z.uuid().nullish(),
  }),
  z.object({ type: z.literal('SERVICE'), serviceId: z.uuid(), barberId: z.uuid() }),
  z.object({
    type: z.literal('TIP'),
    barberId: z.uuid(),
    amountCents: centsSchema.refine((v) => v > 0, { error: 'Ingresá el monto de la propina' }),
  }),
]);
export type AddSaleItemBody = z.input<typeof addSaleItemBody>;

/** Cambiar cantidad, precio o descuento de una línea. Precio y descuento: solo dueño/encargado. */
export const updateSaleItemBody = z.object({
  quantity: z.number().int().min(1).max(999).optional(),
  unitPriceCents: centsSchema.optional(),
  discountCents: centsSchema.optional(),
  discountReason: optionalText(200),
  barberId: z.uuid().nullish(),
});
export type UpdateSaleItemBody = z.input<typeof updateSaleItemBody>;

export const setSaleCustomerBody = z.object({ customerId: z.uuid().nullable() });

/**
 * Cobrar: uno o varios pagos que suman EXACTAMENTE lo que falta. Todo o nada: si algo falla,
 * no queda ningún pago registrado. El pedido lleva Idempotency-Key (doble clic seguro).
 */
export const paySaleBody = z.object({
  payments: z
    .array(
      z.object({
        method: z.enum(MANUAL_PAYMENT_METHODS),
        amountCents: centsSchema.refine((v) => v > 0, { error: 'El monto tiene que ser mayor a 0' }),
        reference: optionalText(80),
      }),
    )
    .max(4, { error: 'Máximo 4 medios de pago' }),
});
export type PaySaleBody = z.input<typeof paySaleBody>;

export const voidSaleBody = z.object({
  reason: z.string().trim().min(3, { error: 'Contá el motivo de la anulación' }).max(300),
});
export type VoidSaleBody = z.input<typeof voidSaleBody>;
