import type { Prisma } from '@estoicos/db';
import { verifyWebhookSignature } from '@estoicos/integrations';
import type { CoreDeps } from '../../deps';
import { isUniqueViolation } from '../../errors';
import { mpWebhookSecret } from './account';

/**
 * Recepción de webhooks de Mercado Pago (docs/fase-0/01-arquitectura.md §9.4). Reglas:
 *  1. **Siempre** se valida la firma; si no valida → 401 y se cuenta para alertar.
 *  2. Idempotencia por `webhook_events(provider, event_key)`: repetido no se procesa dos veces.
 *  3. Se responde 200 al instante (MP da 22 s) y el trabajo real va a la cola.
 *  4. Nunca se cree el contenido: el worker le pregunta a MP el estado real.
 */
export interface MpWebhookInput {
  /** Cuerpo ya parseado. */
  body: Record<string, unknown>;
  /** `data.id` de la query string (es el que entra en el manifiesto firmado). */
  queryDataId?: string | undefined;
  signatureHeader?: string | undefined;
  requestId?: string | undefined;
}

export type MpWebhookResult =
  | { outcome: 'INVALID_SIGNATURE' }
  | { outcome: 'UNKNOWN_ACCOUNT' }
  | { outcome: 'DUPLICATE' }
  | { outcome: 'IGNORED'; reason: string }
  | { outcome: 'QUEUED'; eventId: string };

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
}

/**
 * Clave de idempotencia del evento:
 *  - órdenes: `order:<id>:v<version>` (la versión sube con cada cambio de la orden).
 *  - pagos: `payment:<id de notificación>` (si no viene, `payment:<id>:<action>`).
 */
export function webhookEventKey(input: {
  topic: string;
  resourceId: string;
  version?: string | undefined;
  notificationId?: string | undefined;
  action?: string | undefined;
}): string {
  if (input.topic.startsWith('order')) {
    return `order:${input.resourceId}:v${input.version ?? '1'}`;
  }
  if (input.notificationId) return `payment:${input.notificationId}`;
  return `payment:${input.resourceId}:${input.action ?? 'updated'}`;
}

export async function receiveMercadoPagoWebhook(
  deps: CoreDeps,
  input: MpWebhookInput,
): Promise<MpWebhookResult> {
  const body = input.body;
  const data = (body.data ?? {}) as Record<string, unknown>;
  const topic = asString(body.type) ?? asString(body.topic) ?? '';
  const action = asString(body.action);
  const resourceId = input.queryDataId ?? asString(data.id) ?? asString(body.id) ?? '';
  const userId = asString(body.user_id);

  // La cuenta se elige por el user_id del cuerpo. Usar ese dato antes de validar no es riesgo:
  // sin la clave secreta de esa cuenta no se puede fabricar una firma válida.
  const account = userId
    ? await deps.db.mpAccount.findUnique({ where: { mpUserId: userId } })
    : await deps.db.mpAccount.findFirst({ where: { status: 'ACTIVE' } });
  if (!account || account.status === 'DISCONNECTED') return { outcome: 'UNKNOWN_ACCOUNT' };

  const secret = mpWebhookSecret(deps, account);
  if (!secret) {
    deps.log.error({ accountId: account.id }, 'Webhook de Mercado Pago sin clave secreta configurada');
    return { outcome: 'INVALID_SIGNATURE' };
  }
  const valid = verifyWebhookSignature({
    signatureHeader: input.signatureHeader,
    requestId: input.requestId,
    dataId: resourceId || undefined,
    secret,
  });
  if (!valid) return { outcome: 'INVALID_SIGNATURE' };

  if (!resourceId) return { outcome: 'IGNORED', reason: 'sin id de recurso' };
  const known = topic.startsWith('order') || topic.startsWith('payment');
  if (!known) return { outcome: 'IGNORED', reason: `tópico no usado: ${topic || 'desconocido'}` };

  const eventKey = webhookEventKey({
    topic,
    resourceId,
    version: asString((body as { version?: unknown }).version) ?? asString(data.version),
    notificationId: asString(body.id),
    action,
  });

  try {
    const event = await deps.db.webhookEvent.create({
      data: {
        provider: 'MERCADOPAGO',
        eventKey,
        organizationId: account.organizationId,
        topic,
        action: action ?? null,
        resourceId,
        accountRef: account.mpUserId,
        payload: body as Prisma.InputJsonValue,
      },
    });
    return { outcome: 'QUEUED', eventId: event.id };
  } catch (error) {
    // UNIQUE(provider, event_key): el mismo aviso repetido no se procesa dos veces.
    if (isUniqueViolation(error)) return { outcome: 'DUPLICATE' };
    throw error;
  }
}

/** Eventos que quedaron trabados (el worker los reintenta cada 2 minutos). */
export async function findStuckWebhookEvents(deps: CoreDeps, olderThanMs: number, limit = 100) {
  const cutoff = new Date(deps.now().getTime() - olderThanMs);
  return deps.db.webhookEvent.findMany({
    where: {
      provider: 'MERCADOPAGO',
      OR: [
        { status: 'RECEIVED', receivedAt: { lt: cutoff } },
        { status: 'PROCESSING', receivedAt: { lt: cutoff } },
      ],
    },
    orderBy: { receivedAt: 'asc' },
    take: limit,
    select: { id: true, attempts: true },
  });
}
