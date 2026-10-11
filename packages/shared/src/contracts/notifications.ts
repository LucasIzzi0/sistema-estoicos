import { z } from 'zod';
import { optionalText } from './common';

/**
 * Notificaciones (Fase 6): qué mensajes se mandan, por qué canal y con qué plantilla, más el
 * registro de envíos con su estado.
 */
export const NOTIFICATION_TYPES = [
  'LOGIN_CODE',
  'BOOKING_CONFIRMATION',
  'BOOKING_REMINDER',
  'BOOKING_RESCHEDULED',
  'BOOKING_CANCELLATION',
  'DEPOSIT_PAYMENT_LINK',
  'DEPOSIT_REFUNDED',
  'POINTS_CREDITED',
  'REWARD_AVAILABLE',
  'REACTIVATION',
  'REVIEW_REQUEST',
  'STAFF_INVITATION',
  'STAFF_PASSWORD_RESET',
  'STAFF_SECOND_FACTOR',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  LOGIN_CODE: 'Código para ingresar',
  BOOKING_CONFIRMATION: 'Turno reservado',
  BOOKING_REMINDER: 'Recordatorio del turno',
  BOOKING_RESCHEDULED: 'Turno cambiado de horario',
  BOOKING_CANCELLATION: 'Turno cancelado',
  DEPOSIT_PAYMENT_LINK: 'Link para pagar la seña',
  DEPOSIT_REFUNDED: 'Seña devuelta',
  POINTS_CREDITED: 'Puntos acreditados',
  REWARD_AVAILABLE: 'Tenés una recompensa',
  REACTIVATION: 'Hace rato que no venís',
  REVIEW_REQUEST: 'Pedido de reseña',
  STAFF_INVITATION: 'Invitación al sistema',
  STAFF_PASSWORD_RESET: 'Cambio de contraseña',
  STAFF_SECOND_FACTOR: 'Código de verificación',
};

/** Qué mensajes son de marketing (piden consentimiento aparte y respetan la franja horaria). */
export const MARKETING_TYPES: NotificationType[] = ['REACTIVATION', 'REVIEW_REQUEST'];
/** Mensajes de acceso: van siempre por email y no se pueden apagar. */
export const ACCESS_TYPES: NotificationType[] = [
  'LOGIN_CODE',
  'STAFF_INVITATION',
  'STAFF_PASSWORD_RESET',
  'STAFF_SECOND_FACTOR',
];

/** Variables que espera la plantilla de WhatsApp de cada tipo, en orden. */
export const TEMPLATE_VARIABLES: Partial<Record<NotificationType, string[]>> = {
  BOOKING_CONFIRMATION: ['Nombre', 'Cuándo', 'Servicios', 'Barbero', 'Sucursal'],
  BOOKING_RESCHEDULED: ['Nombre', 'Cuándo', 'Servicios', 'Barbero', 'Sucursal'],
  BOOKING_CANCELLATION: ['Nombre', 'Cuándo', 'Sucursal'],
  BOOKING_REMINDER: ['Nombre', 'Cuándo', 'Servicios', 'Barbero'],
  REVIEW_REQUEST: ['Nombre', 'Barbería'],
  POINTS_CREDITED: ['Nombre', 'Puntos que sumó', 'Saldo total'],
  REACTIVATION: ['Nombre', 'Semanas sin venir', 'Sucursal'],
};

export const notificationSettingSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  enabled: z.boolean(),
  whatsappTemplateName: z.string().nullable(),
  whatsappTemplateLanguage: z.string(),
});
export type NotificationSettingDto = z.infer<typeof notificationSettingSchema>;

export const notificationSettingsSchema = z.object({
  whatsappEnabled: z.boolean(),
  /** Minutos antes del turno en que se manda cada recordatorio. */
  reminderOffsetsMinutes: z.array(z.number().int()),
  marketingQuietStartMinute: z.number().int(),
  marketingQuietEndMinute: z.number().int(),
  reactivationAfterDays: z.number().int(),
  reviewRequestDelayMinutes: z.number().int(),
  types: z.array(notificationSettingSchema),
  /** WhatsApp configurado en el servidor (número y token). */
  whatsappConfigured: z.boolean(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const updateNotificationSettingsBody = z.object({
  whatsappEnabled: z.boolean().optional(),
  reminderOffsetsMinutes: z
    .array(z.number().int().min(5).max(10_080))
    .max(4, { error: 'Máximo 4 recordatorios' })
    .optional(),
  marketingQuietStartMinute: z.number().int().min(0).max(1439).optional(),
  marketingQuietEndMinute: z.number().int().min(0).max(1439).optional(),
  reactivationAfterDays: z.number().int().min(7).max(365).optional(),
  reviewRequestDelayMinutes: z.number().int().min(5).max(1440).optional(),
});
export type UpdateNotificationSettingsBody = z.input<typeof updateNotificationSettingsBody>;

export const updateNotificationTypeBody = z.object({
  enabled: z.boolean().optional(),
  whatsappTemplateName: optionalText(100),
  whatsappTemplateLanguage: z.string().trim().max(10).optional(),
});
export type UpdateNotificationTypeBody = z.input<typeof updateNotificationTypeBody>;

export const notificationTypeParams = z.object({ type: z.enum(NOTIFICATION_TYPES) });

// ---------------------------------------------------------------------------
// Registro de envíos
// ---------------------------------------------------------------------------

export const NOTIFICATION_STATUSES = [
  'PENDING',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SKIPPED',
  'CANCELED',
] as const;
export const NOTIFICATION_STATUS_LABELS: Record<(typeof NOTIFICATION_STATUSES)[number], string> = {
  PENDING: 'En cola',
  SENDING: 'Enviando',
  SENT: 'Enviado',
  DELIVERED: 'Entregado',
  READ: 'Leído',
  FAILED: 'Falló',
  SKIPPED: 'No se envió',
  CANCELED: 'Cancelado',
};

export const notificationLogItemSchema = z.object({
  id: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(['EMAIL', 'WHATSAPP']),
  status: z.enum(NOTIFICATION_STATUSES),
  recipient: z.string(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  scheduledFor: z.string(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  readAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  skippedReason: z.string().nullable(),
  attempts: z.number(),
  /** Este envío es el reemplazo por email de un WhatsApp que falló. */
  isFallback: z.boolean(),
});
export type NotificationLogItem = z.infer<typeof notificationLogItemSchema>;

export const notificationLogQuery = z.object({
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
  customerId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Acciones del cliente desde el recordatorio (sin login)
// ---------------------------------------------------------------------------

export const appointmentActionQuery = z.object({ t: z.string().trim().min(8).max(64) });

export const appointmentActionResultSchema = z.object({
  startsAt: z.string(),
  branchName: z.string(),
  barberName: z.string(),
});

export const unsubscribeQuery = z.object({ c: z.uuid(), t: z.string().trim().min(8).max(64) });
