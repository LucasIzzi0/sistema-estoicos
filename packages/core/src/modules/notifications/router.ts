import type { NotificationChannel, NotificationType, Tx } from '@estoicos/db';

/**
 * Router de canales (docs/fase-0/01-arquitectura.md §10). Decide por dónde sale cada mensaje:
 *
 *  1. **Preferencia** del cliente (por defecto WhatsApp).
 *  2. **Consentimiento** vigente para ese canal y alcance (transaccional o marketing).
 *  3. **Disponibilidad:** WhatsApp activado, plantilla aprobada cargada, el número no marcado
 *     como "sin WhatsApp"; el email no rebotado.
 *  4. **Franja sin marketing** (21 a 9 h por defecto): solo afecta reactivación y reseñas.
 *
 * Es una función pura: se testea sin base ni red.
 */
export type Scope = 'TRANSACTIONAL' | 'MARKETING';

/** Qué alcance tiene cada tipo de mensaje. */
export const NOTIFICATION_SCOPE: Record<NotificationType, Scope | 'ACCESS'> = {
  LOGIN_CODE: 'ACCESS',
  STAFF_INVITATION: 'ACCESS',
  STAFF_PASSWORD_RESET: 'ACCESS',
  STAFF_SECOND_FACTOR: 'ACCESS',
  BOOKING_CONFIRMATION: 'TRANSACTIONAL',
  BOOKING_REMINDER: 'TRANSACTIONAL',
  BOOKING_RESCHEDULED: 'TRANSACTIONAL',
  BOOKING_CANCELLATION: 'TRANSACTIONAL',
  DEPOSIT_PAYMENT_LINK: 'TRANSACTIONAL',
  DEPOSIT_REFUNDED: 'TRANSACTIONAL',
  POINTS_CREDITED: 'TRANSACTIONAL',
  REWARD_AVAILABLE: 'TRANSACTIONAL',
  REACTIVATION: 'MARKETING',
  REVIEW_REQUEST: 'MARKETING',
};

export interface RecipientState {
  email: string | null;
  phone: string | null;
  preferredChannel: NotificationChannel;
  emailBouncedAt: Date | null;
  whatsappUnreachableAt: Date | null;
  /** Consentimientos vigentes: canal + alcance. */
  consents: { channel: NotificationChannel; scope: Scope; granted: boolean }[];
}

export interface ChannelAvailability {
  whatsappEnabled: boolean;
  /** Nombre de la plantilla aprobada para este tipo (null = no hay, va por email). */
  whatsappTemplate: string | null;
  /** Franja sin marketing, en minutos desde las 00:00 hora local. */
  quiet: { startMinute: number; endMinute: number };
  /** Minuto del día local en el que se quiere enviar. */
  nowMinute: number;
}

export type RouteDecision =
  { send: true; channel: NotificationChannel; templateName: string | null } | { send: false; reason: string };

function hasConsent(recipient: RecipientState, channel: NotificationChannel, scope: Scope): boolean {
  return recipient.consents.some((c) => c.channel === channel && c.scope === scope && c.granted);
}

/** ¿Estamos dentro de la franja sin mensajes de marketing? (puede cruzar la medianoche) */
export function inQuietHours(quiet: { startMinute: number; endMinute: number }, nowMinute: number): boolean {
  if (quiet.startMinute === quiet.endMinute) return false;
  return quiet.startMinute < quiet.endMinute
    ? nowMinute >= quiet.startMinute && nowMinute < quiet.endMinute
    : nowMinute >= quiet.startMinute || nowMinute < quiet.endMinute;
}

/** Por dónde sale este mensaje (o por qué no sale). */
export function chooseChannel(
  type: NotificationType,
  recipient: RecipientState,
  availability: ChannelAvailability,
): RouteDecision {
  const scope = NOTIFICATION_SCOPE[type];

  // Los mensajes de acceso (código de login) van siempre por email: es la llave de entrada.
  if (scope === 'ACCESS') {
    if (!recipient.email) return { send: false, reason: 'Sin email' };
    return { send: true, channel: 'EMAIL', templateName: null };
  }

  if (scope === 'MARKETING' && inQuietHours(availability.quiet, availability.nowMinute)) {
    return { send: false, reason: 'Franja sin mensajes de marketing' };
  }

  const whatsappUsable =
    availability.whatsappEnabled &&
    !!availability.whatsappTemplate &&
    !!recipient.phone &&
    !recipient.whatsappUnreachableAt &&
    hasConsent(recipient, 'WHATSAPP', scope);
  const emailUsable = !!recipient.email && !recipient.emailBouncedAt && hasConsent(recipient, 'EMAIL', scope);

  const order: NotificationChannel[] =
    recipient.preferredChannel === 'EMAIL' ? ['EMAIL', 'WHATSAPP'] : ['WHATSAPP', 'EMAIL'];
  for (const channel of order) {
    if (channel === 'WHATSAPP' && whatsappUsable) {
      return { send: true, channel: 'WHATSAPP', templateName: availability.whatsappTemplate };
    }
    if (channel === 'EMAIL' && emailUsable) return { send: true, channel: 'EMAIL', templateName: null };
  }

  // Nada disponible: se explica por qué, y queda registrado en el historial del cliente.
  if (!recipient.phone && !recipient.email) return { send: false, reason: 'Sin email ni celular' };
  const wantsAny = hasConsent(recipient, 'EMAIL', scope) || hasConsent(recipient, 'WHATSAPP', scope);
  if (!wantsAny) {
    return {
      send: false,
      reason: scope === 'MARKETING' ? 'No acepta promociones' : 'No acepta avisos de turnos',
    };
  }
  if (recipient.emailBouncedAt && !whatsappUsable) return { send: false, reason: 'El email rebotó' };
  return { send: false, reason: 'No hay canal disponible' };
}

/**
 * Cuando WhatsApp falla, el mensaje se rehace por email (si se puede). Devuelve null si no
 * hay a dónde caer.
 */
export function fallbackChannel(
  type: NotificationType,
  recipient: RecipientState,
): { channel: 'EMAIL' } | null {
  const scope = NOTIFICATION_SCOPE[type];
  if (scope === 'ACCESS') return recipient.email ? { channel: 'EMAIL' } : null;
  const usable =
    !!recipient.email && !recipient.emailBouncedAt && hasConsent(recipient, 'EMAIL', scope as Scope);
  return usable ? { channel: 'EMAIL' } : null;
}

/** Datos del destinatario tal como los necesita el router. */
export async function loadRecipient(tx: Tx, customerId: string): Promise<RecipientState | null> {
  const customer = await tx.customer.findUnique({ where: { id: customerId }, include: { consents: true } });
  if (!customer || customer.anonymizedAt) return null;
  return {
    email: customer.email,
    phone: customer.phone,
    preferredChannel: customer.preferredChannel,
    emailBouncedAt: customer.emailBouncedAt,
    whatsappUnreachableAt: customer.whatsappUnreachableAt,
    consents: customer.consents.map((c) => ({ channel: c.channel, scope: c.scope, granted: c.granted })),
  };
}
