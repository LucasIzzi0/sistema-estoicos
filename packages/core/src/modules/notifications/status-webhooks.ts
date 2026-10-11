import type { Prisma } from '@estoicos/db';
import { verifyMetaSignature } from '@estoicos/integrations';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CoreDeps } from '../../deps';
import { isUniqueViolation } from '../../errors';
import { stopMarketing } from './outbox';

/**
 * Webhooks de estado de los envíos: WhatsApp (Meta) y email (Resend). Sirven para saber si el
 * mensaje llegó, si rebotó o si el cliente pidió no recibir más. Igual que con Mercado Pago:
 * **firma siempre**, idempotencia por evento y respuesta rápida.
 */
export type StatusWebhookResult =
  | { outcome: 'INVALID_SIGNATURE' }
  | { outcome: 'DUPLICATE' }
  | { outcome: 'IGNORED'; reason: string }
  | { outcome: 'PROCESSED'; detail: string };

// ---------------------------------------------------------------------------
// WhatsApp (Meta)
// ---------------------------------------------------------------------------

const META_STATUS: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/** Respuestas que el cliente escribe para darse de baja. */
const OPT_OUT_WORDS = ['baja', 'stop', 'basta', 'no molestar', 'cancelar suscripcion'];

export async function receiveWhatsAppWebhook(
  deps: CoreDeps,
  input: { rawBody: string; body: Record<string, unknown>; signature: string | undefined; appSecret: string },
): Promise<StatusWebhookResult> {
  if (!verifyMetaSignature({ rawBody: input.rawBody, header: input.signature, appSecret: input.appSecret })) {
    return { outcome: 'INVALID_SIGNATURE' };
  }

  const entries = (input.body.entry ?? []) as {
    id?: string;
    changes?: { value?: Record<string, unknown>; field?: string }[];
  }[];
  let handled = 0;
  const details: string[] = [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = (change.value ?? {}) as {
        statuses?: { id: string; status: string; timestamp?: string; errors?: { code?: number }[] }[];
        messages?: {
          from?: string;
          text?: { body?: string };
          button?: { payload?: string };
          type?: string;
        }[];
        contacts?: { wa_id?: string; user_id?: string }[];
        metadata?: { phone_number_id?: string };
      };

      // 1. Estados de nuestros envíos (entregado, leído, fallido).
      for (const status of value.statuses ?? []) {
        const mapped = META_STATUS[status.status];
        if (!mapped) continue;
        const key = `wa-status:${status.id}:${status.status}`;
        const fresh = await recordEvent(deps, 'WHATSAPP', key, input.body, status.id);
        if (!fresh) continue;
        await applyDeliveryStatus(deps, status.id, mapped, status.errors?.[0]?.code);
        handled += 1;
        details.push(`${status.status}`);
      }

      // 2. Mensajes entrantes: botones del recordatorio y pedidos de baja.
      for (const message of value.messages ?? []) {
        const from = message.from;
        const text = (message.text?.body ?? '').trim().toLowerCase();
        const payload = message.button?.payload ?? '';
        if (!from) continue;
        const key = `wa-msg:${from}:${payload || text}:${Date.now()}`;

        if (OPT_OUT_WORDS.some((w) => text === w || text.startsWith(`${w} `))) {
          const customer = await findCustomerByPhone(deps, from);
          if (customer) {
            await recordEvent(deps, 'WHATSAPP', key, input.body, from);
            await stopMarketing(deps, customer.id, 'WHATSAPP_REPLY');
            handled += 1;
            details.push('baja de marketing');
          }
        }
      }
    }
  }

  if (handled === 0) return { outcome: 'IGNORED', reason: 'sin novedades que aplicar' };
  return { outcome: 'PROCESSED', detail: details.join(', ') };
}

async function findCustomerByPhone(deps: CoreDeps, waId: string) {
  // Meta manda el número sin "+"; puede venir con o sin el 9 argentino.
  const digits = waId.replace(/\D/g, '');
  const tail = digits.slice(-8);
  return deps.db.customer.findFirst({
    where: { OR: [{ phone: `+${digits}` }, { phone: { endsWith: tail } }, { whatsappUserId: waId }] },
    select: { id: true },
  });
}

/** Aplica el estado que informa Meta sobre un mensaje nuestro. */
async function applyDeliveryStatus(
  deps: CoreDeps,
  providerMessageId: string,
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
  errorCode?: number,
): Promise<void> {
  const now = deps.now();
  const notification = await deps.db.notification.findFirst({ where: { providerMessageId } });
  if (!notification) return;

  await deps.db.notification.update({
    where: { id: notification.id },
    data: {
      status,
      ...(status === 'DELIVERED' ? { deliveredAt: now } : {}),
      ...(status === 'READ' ? { readAt: now, deliveredAt: notification.deliveredAt ?? now } : {}),
      ...(status === 'FAILED'
        ? { failedAt: now, lastError: `Meta error ${errorCode ?? 'desconocido'}` }
        : {}),
    },
  });

  if (status === 'FAILED' && notification.customerId) {
    // 131026: el número no tiene WhatsApp. 131050: frenó los mensajes de marketing.
    if (errorCode === 131026 || errorCode === 131047) {
      await deps.db.customer.update({
        where: { id: notification.customerId },
        data: { whatsappUnreachableAt: now },
      });
    }
    if (errorCode === 131050) await stopMarketing(deps, notification.customerId, 'WHATSAPP_REPLY');
  }
}

// ---------------------------------------------------------------------------
// Resend (email)
// ---------------------------------------------------------------------------

/** Firma Svix de Resend: `v1,<base64>` sobre "<id>.<timestamp>.<cuerpo>". */
export function verifySvixSignature(input: {
  id: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
  header: string | undefined;
  secret: string;
}): boolean {
  if (!input.id || !input.timestamp || !input.header) return false;
  const key = Buffer.from(input.secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${input.id}.${input.timestamp}.${input.rawBody}`)
    .digest('base64');
  // El header puede traer varias firmas separadas por espacio ("v1,xxx v1,yyy").
  return input.header.split(' ').some((part) => {
    const value = part.startsWith('v1,') ? part.slice(3) : part;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(value, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const RESEND_STATUS: Record<string, 'SENT' | 'DELIVERED' | 'FAILED'> = {
  'email.sent': 'SENT',
  'email.delivered': 'DELIVERED',
  'email.bounced': 'FAILED',
  'email.complained': 'FAILED',
  'email.delivery_delayed': 'SENT',
};

export async function receiveResendWebhook(
  deps: CoreDeps,
  input: {
    rawBody: string;
    body: Record<string, unknown>;
    svixId: string | undefined;
    svixTimestamp: string | undefined;
    svixSignature: string | undefined;
    secret: string;
  },
): Promise<StatusWebhookResult> {
  const valid = verifySvixSignature({
    id: input.svixId,
    timestamp: input.svixTimestamp,
    rawBody: input.rawBody,
    header: input.svixSignature,
    secret: input.secret,
  });
  if (!valid) return { outcome: 'INVALID_SIGNATURE' };

  const type = String(input.body.type ?? '');
  const data = (input.body.data ?? {}) as { email_id?: string; tags?: Record<string, string> };
  const status = RESEND_STATUS[type];
  if (!status) return { outcome: 'IGNORED', reason: `tipo no usado: ${type}` };

  const fresh = await recordEvent(
    deps,
    'RESEND',
    `resend:${input.svixId}`,
    input.body,
    data.email_id ?? null,
  );
  if (!fresh) return { outcome: 'DUPLICATE' };

  const notification = data.tags?.notification_id
    ? await deps.db.notification.findUnique({ where: { id: data.tags.notification_id } })
    : await deps.db.notification.findFirst({ where: { providerMessageId: data.email_id ?? '' } });
  if (!notification) return { outcome: 'IGNORED', reason: 'no es un envío nuestro' };

  const now = deps.now();
  await deps.db.notification.update({
    where: { id: notification.id },
    data: {
      status,
      ...(status === 'DELIVERED' ? { deliveredAt: now } : {}),
      ...(status === 'FAILED' ? { failedAt: now, lastError: type } : {}),
    },
  });

  // Rebote permanente o denuncia de spam: no se le vuelve a escribir a ese email.
  if ((type === 'email.bounced' || type === 'email.complained') && notification.customerId) {
    await deps.db.customer.update({ where: { id: notification.customerId }, data: { emailBouncedAt: now } });
    if (type === 'email.complained') await stopMarketing(deps, notification.customerId, 'EMAIL_LINK');
  }
  return { outcome: 'PROCESSED', detail: type };
}

/** Registra el evento para no procesarlo dos veces. Devuelve false si ya estaba. */
async function recordEvent(
  deps: CoreDeps,
  provider: 'WHATSAPP' | 'RESEND',
  eventKey: string,
  payload: unknown,
  resourceId: string | null,
): Promise<boolean> {
  try {
    await deps.db.webhookEvent.create({
      data: {
        provider,
        eventKey,
        resourceId,
        payload: payload as Prisma.InputJsonValue,
        status: 'PROCESSED',
        processedAt: deps.now(),
      },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
