import { MercadoPagoError } from '@estoicos/integrations';
import type { CoreDeps } from '../../deps';
import { clearAccountError, markAccountError, mpClientFor } from './account';
import { syncPaymentById } from './mirror';
import { applyApprovedOrder, applyOrderUpdate, closeOrderAsFailed, mapOrderStatus } from './point';

/**
 * Procesamiento de lo que llega de Mercado Pago (worker). Regla de oro: **nunca se cree el
 * contenido del webhook**; siempre se le pregunta a MP el estado real y se aplican transiciones
 * idempotentes. Las claves únicas de la base son la segunda barrera contra duplicados.
 */
/** Procesa un evento de la bandeja de webhooks. Devuelve qué se hizo (para el log del job). */
export async function processWebhookEvent(deps: CoreDeps, eventId: string): Promise<string> {
  const claimed = await deps.db.webhookEvent.updateMany({
    where: { id: eventId, status: { in: ['RECEIVED', 'PROCESSING'] } },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return 'ya procesado';
  const event = await deps.db.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });

  try {
    let result: string;
    if ((event.topic ?? '').startsWith('order')) {
      result = await syncPointOrderByExternalId(deps, event.resourceId ?? '');
    } else {
      result = await syncPaymentById(deps, event.accountRef, event.resourceId ?? '', 'WEBHOOK');
    }
    await deps.db.webhookEvent.update({
      where: { id: eventId },
      data: { status: 'PROCESSED', processedAt: deps.now(), lastError: null },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.db.webhookEvent.update({
      where: { id: eventId },
      data: { status: 'FAILED', lastError: message.slice(0, 500) },
    });
    throw error;
  }
}

/** Le pregunta a MP cómo está la orden y la aplica. Idempotente. */
export async function syncPointOrder(deps: CoreDeps, orderId: string): Promise<string> {
  const order = await deps.db.mpOrder.findUnique({ where: { id: orderId } });
  if (!order) return 'orden inexistente';
  if (order.status !== 'PENDING') return `orden ya ${order.status}`;
  if (!order.externalId) {
    // Nunca llegó a Mercado Pago y ya venció: se libera la terminal.
    if (order.expiresAt && deps.now() > order.expiresAt) {
      await closeOrderAsFailed(deps, order.id, 'EXPIRED', 'expired', 'sin_enviar');
      return 'orden vencida sin enviar';
    }
    return 'orden sin id de Mercado Pago';
  }
  const account = await deps.db.mpAccount.findUniqueOrThrow({ where: { id: order.mpAccountId } });

  let remote;
  try {
    remote = await mpClientFor(deps, account).getOrder(order.externalId);
    await clearAccountError(deps, account);
  } catch (error) {
    const message = error instanceof MercadoPagoError ? error.message : String(error);
    if (error instanceof MercadoPagoError && error.invalidToken)
      await markAccountError(deps, account.id, message);
    throw error;
  }

  await applyOrderUpdate(deps, order.id, remote);
  if (mapOrderStatus(remote.status) === 'APPROVED') {
    await applyApprovedOrder(deps, order.id);
    // El pago espejo también se guarda, para que la conciliación lo dé por vinculado.
    const reference = remote.transactions?.payments?.[0]?.reference_id;
    if (reference)
      await syncPaymentById(deps, account.mpUserId, reference, 'ORDER_FETCH').catch(() => undefined);
    return 'cobro aprobado';
  }
  return `orden ${remote.status}`;
}

async function syncPointOrderByExternalId(deps: CoreDeps, externalId: string): Promise<string> {
  const order = await deps.db.mpOrder.findUnique({ where: { externalId } });
  if (!order) return 'orden desconocida (no es nuestra)';
  return syncPointOrder(deps, order.id);
}
