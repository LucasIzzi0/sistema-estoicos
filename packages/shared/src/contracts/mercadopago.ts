import { z } from 'zod';
import { centsSchema, optionalText } from './common';

/**
 * Mercado Pago (Fase 5): vinculación de la cuenta, terminales Point, cobro con Point,
 * conciliación de pagos y reintegros. Los tokens NUNCA viajan al frontend.
 */
export const MP_ACCOUNT_STATUSES = ['ACTIVE', 'ERROR', 'DISCONNECTED'] as const;
export const MP_ACCOUNT_STATUS_LABELS: Record<(typeof MP_ACCOUNT_STATUSES)[number], string> = {
  ACTIVE: 'Vinculada',
  ERROR: 'Con problemas',
  DISCONNECTED: 'Desvinculada',
};

export const mpAccountSchema = z.object({
  id: z.string(),
  label: z.string(),
  mpUserId: z.string(),
  nickname: z.string().nullable(),
  /** false = credenciales de prueba (sandbox). */
  liveMode: z.boolean(),
  status: z.enum(MP_ACCOUNT_STATUSES),
  hasWebhookSecret: z.boolean(),
  connectedAt: z.string(),
  reconcileFrom: z.string(),
  paymentsSyncedUntil: z.string().nullable(),
  lastError: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  terminalCount: z.number(),
});
export type MpAccountDto = z.infer<typeof mpAccountSchema>;

export const connectMpBody = z.object({
  label: z
    .string()
    .trim()
    .min(2, { error: 'Poné un nombre para identificarla' })
    .max(60)
    .default('Cuenta principal'),
  /** Access Token de la aplicación de Mercado Pago. Se guarda cifrado. */
  accessToken: z.string().trim().min(20, { error: 'Pegá el Access Token completo' }).max(500),
  /** Clave secreta de webhooks (se configura en el panel de MP junto con la URL). */
  webhookSecret: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type ConnectMpBody = z.input<typeof connectMpBody>;

// ---------------------------------------------------------------------------
// Terminales Point
// ---------------------------------------------------------------------------

export const MP_TERMINAL_MODES = ['PDV', 'STANDALONE', 'UNDEFINED'] as const;
export const MP_TERMINAL_MODE_LABELS: Record<(typeof MP_TERMINAL_MODES)[number], string> = {
  PDV: 'Lista para cobrar',
  STANDALONE: 'Modo autónomo',
  UNDEFINED: 'Sin configurar',
};

export const mpTerminalSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  label: z.string().nullable(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
  operatingMode: z.enum(MP_TERMINAL_MODES),
  active: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  /** Tiene un cobro esperando en este momento. */
  busy: z.boolean(),
});
export type MpTerminalDto = z.infer<typeof mpTerminalSchema>;

export const terminalIdParams = z.object({ terminalId: z.uuid() });

export const updateTerminalBody = z.object({
  branchId: z.uuid().nullable().optional(),
  label: optionalText(60),
  active: z.boolean().optional(),
});
export type UpdateTerminalBody = z.input<typeof updateTerminalBody>;

// ---------------------------------------------------------------------------
// Cobro con Point
// ---------------------------------------------------------------------------

export const MP_ORDER_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELED',
  'EXPIRED',
  'REFUNDED',
] as const;
export type MpOrderStatus = (typeof MP_ORDER_STATUSES)[number];

export const MP_ORDER_STATUS_LABELS: Record<MpOrderStatus, string> = {
  PENDING: 'Esperando el pago',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  CANCELED: 'Cancelado',
  EXPIRED: 'Se venció',
  REFUNDED: 'Reintegrado',
};

/** Lo que ve quien cobra, según el estado crudo de la orden en Mercado Pago. */
export const MP_STAGE_LABELS: Record<string, string> = {
  created: 'Enviado al Point',
  at_terminal: 'El cliente está pagando',
  action_required: 'Revisá la terminal',
  processed: 'Aprobado',
  failed: 'Rechazado',
  canceled: 'Cancelado',
  expired: 'Se venció',
  refunded: 'Reintegrado',
};

export const mpOrderSchema = z.object({
  id: z.string(),
  saleId: z.string(),
  terminalId: z.string(),
  terminalLabel: z.string(),
  status: z.enum(MP_ORDER_STATUSES),
  mpStatus: z.string().nullable(),
  mpStatusDetail: z.string().nullable(),
  amountCents: z.number(),
  paidAmountCents: z.number().nullable(),
  expiresAt: z.string().nullable(),
  /** Solo se puede cancelar desde el sistema mientras no la tomó la terminal. */
  cancelable: z.boolean(),
  createdAt: z.string(),
});
export type MpOrderDto = z.infer<typeof mpOrderSchema>;

export const chargeWithPointBody = z.object({
  terminalId: z.uuid(),
  /** Monto a cobrar con Point (el resto se cobra con otros medios). */
  amountCents: centsSchema.refine((v) => v > 0, { error: 'El monto tiene que ser mayor a 0' }),
});
export type ChargeWithPointBody = z.input<typeof chargeWithPointBody>;

export const mpOrderIdParams = z.object({ orderId: z.uuid() });

// ---------------------------------------------------------------------------
// Conciliación: bandeja de pagos sin asignar
// ---------------------------------------------------------------------------

export const RECONCILIATION_STATUSES = [
  'AUTO_MATCHED',
  'UNASSIGNED',
  'MANUALLY_ASSIGNED',
  'OTHER_INCOME',
  'IGNORED',
  'NOT_APPLICABLE',
] as const;
export const RECONCILIATION_LABELS: Record<(typeof RECONCILIATION_STATUSES)[number], string> = {
  AUTO_MATCHED: 'Vinculado solo',
  UNASSIGNED: 'Sin asignar',
  MANUALLY_ASSIGNED: 'Asignado a mano',
  OTHER_INCOME: 'Otro ingreso',
  IGNORED: 'Ignorado',
  NOT_APPLICABLE: 'No aplica',
};

export const mpPaymentSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  status: z.string(),
  statusDetail: z.string().nullable(),
  amountCents: z.number(),
  feeCents: z.number().nullable(),
  netReceivedCents: z.number().nullable(),
  refundedCents: z.number(),
  paymentMethod: z.string().nullable(),
  description: z.string().nullable(),
  payerName: z.string().nullable(),
  externalReference: z.string().nullable(),
  branchId: z.string().nullable(),
  branchName: z.string().nullable(),
  dateCreated: z.string(),
  dateApproved: z.string().nullable(),
  reconciliationStatus: z.enum(RECONCILIATION_STATUSES),
  reconciliationNote: z.string().nullable(),
  /** Venta a la que quedó vinculado (si ya se asignó). */
  saleNumber: z.number().nullable(),
  saleId: z.string().nullable(),
});
export type MpPaymentDto = z.infer<typeof mpPaymentSchema>;

export const mpSuggestionSchema = z.object({
  kind: z.enum(['SALE', 'APPOINTMENT_DEPOSIT']),
  id: z.string(),
  label: z.string(),
  amountCents: z.number(),
  when: z.string(),
  /** Por qué se sugiere: mismo monto, misma hora, misma terminal… */
  reasons: z.array(z.string()),
});

export const mpInboxItemSchema = mpPaymentSchema.extend({
  suggestions: z.array(mpSuggestionSchema),
});
export type MpInboxItem = z.infer<typeof mpInboxItemSchema>;

export const mpInboxQuery = z.object({
  status: z.enum(RECONCILIATION_STATUSES).default('UNASSIGNED'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const mpPaymentIdParams = z.object({ mpPaymentId: z.uuid() });

export const assignPaymentBody = z.discriminatedUnion('target', [
  z.object({ target: z.literal('SALE'), saleId: z.uuid() }),
  z.object({ target: z.literal('APPOINTMENT_DEPOSIT'), appointmentId: z.uuid() }),
  z.object({ target: z.literal('CUSTOMER_CREDIT'), customerId: z.uuid() }),
  z.object({ target: z.literal('OTHER_INCOME'), description: z.string().trim().min(2).max(200) }),
  z.object({ target: z.literal('IGNORED'), reason: z.string().trim().min(2).max(200) }),
]);
export type AssignPaymentBody = z.input<typeof assignPaymentBody>;

// ---------------------------------------------------------------------------
// Reintegros (solo el dueño, decisión del 28/09/2026)
// ---------------------------------------------------------------------------

export const refundPaymentBody = z.object({
  /** Vacío = reintegro total. */
  amountCents: centsSchema.nullish(),
  reason: z.string().trim().min(3, { error: 'Contá el motivo del reintegro' }).max(300),
  /** A dónde va la plata: al medio original o a saldo a favor del cliente. */
  destination: z.enum(['ORIGINAL_METHOD', 'CUSTOMER_CREDIT']).default('ORIGINAL_METHOD'),
});
export type RefundPaymentBody = z.input<typeof refundPaymentBody>;

export const paymentIdParams = z.object({ paymentId: z.uuid() });

export const refundSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  amountCents: z.number(),
  destination: z.enum(['ORIGINAL_METHOD', 'CUSTOMER_CREDIT']),
  status: z.enum(['PENDING', 'APPROVED', 'FAILED']),
  reason: z.string(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
});
export type RefundDto = z.infer<typeof refundSchema>;
