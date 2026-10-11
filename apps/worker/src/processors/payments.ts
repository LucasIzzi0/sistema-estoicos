import {
  activeMpAccounts,
  findExpiredDepositHolds,
  findStalePointOrders,
  findStuckWebhookEvents,
  processWebhookEvent,
  raiseAlert,
  releaseUnpaidHold,
  syncAccountPayments,
  syncPointOrder,
  trackJobRun,
  type CoreDeps,
} from '@estoicos/core';
import { PAYMENT_JOBS, webhookJobId, type Job, type Queue } from '@estoicos/queue';

/**
 * Cola "payments" (Fase 5). Todo es idempotente y nunca confía en el contenido del webhook:
 * le pregunta a Mercado Pago el estado real. Las redes de seguridad (barrido de órdenes sin
 * noticias y sincronización de pagos) están en docs/fase-0/01-arquitectura.md §9.5.
 */
export function createPaymentsProcessor(deps: { core: CoreDeps; queue: Queue }) {
  const { core } = deps;

  return async (job: Job) => {
    switch (job.name) {
      case PAYMENT_JOBS.webhook:
        return processWebhookEvent(core, String((job.data as { eventId: string }).eventId));

      case PAYMENT_JOBS.syncOrder:
        return syncPointOrder(core, String((job.data as { orderId: string }).orderId));

      case PAYMENT_JOBS.sweep:
        return trackJobRun(
          core.db,
          { jobName: `payments:${job.name}`, schedulerId: job.repeatJobKey ?? undefined },
          async () => {
            // 1. Webhooks que quedaron sin procesar (el encolado falló o el worker se cayó).
            const stuck = await findStuckWebhookEvents(core, 2 * 60_000);
            if (stuck.length) {
              await deps.queue.addBulk(
                stuck.map((e) => ({
                  name: PAYMENT_JOBS.webhook,
                  data: { eventId: e.id },
                  opts: { jobId: webhookJobId(e.id, e.attempts), removeOnComplete: 500, removeOnFail: 1000 },
                })),
              );
            }
            // 2. Órdenes Point pendientes sin noticias: se les pregunta a MP.
            const orders = await findStalePointOrders(core, 2 * 60_000);
            let resolved = 0;
            for (const order of orders) {
              try {
                await syncPointOrder(core, order.id);
                resolved += 1;
              } catch (error) {
                core.log.warn({ orderId: order.id, err: String(error) }, 'No se pudo consultar una orden');
              }
            }
            // 3. Una orden que lleva mucho sin resolverse se avisa en el panel.
            const veryOld = orders.filter((o) => core.now().getTime() - o.createdAt.getTime() > 30 * 60_000);
            if (veryOld.length) {
              await raiseAlert(
                core.db,
                {
                  kind: 'MP_ORDER_UNRESOLVED',
                  severity: 'WARNING',
                  dedupeKey: 'mp-order-unresolved',
                  message: `Hay ${veryOld.length} cobro(s) con Point sin resolver hace más de 30 minutos.`,
                  details: { orderIds: veryOld.map((o) => o.id) },
                },
                core.now(),
              );
            }
            return { webhooks: stuck.length, orders: resolved };
          },
        );

      case PAYMENT_JOBS.syncPayments:
        return trackJobRun(
          core.db,
          { jobName: `payments:${job.name}`, schedulerId: job.repeatJobKey ?? undefined },
          async () => {
            let fetched = 0;
            for (const account of await activeMpAccounts(core)) {
              try {
                const result = await syncAccountPayments(core, account.id);
                fetched += result.fetched;
              } catch (error) {
                core.log.error(
                  { accountId: account.id, err: String(error) },
                  'Falló la sincronización de pagos',
                );
                await raiseAlert(
                  core.db,
                  {
                    kind: 'MP_SYNC_FAILING',
                    severity: 'WARNING',
                    dedupeKey: `mp-sync:${account.id}`,
                    message: 'No se pudieron sincronizar los pagos de Mercado Pago.',
                    details: { error: String(error).slice(0, 300) },
                  },
                  core.now(),
                );
              }
            }
            return { fetched };
          },
        );

      case PAYMENT_JOBS.releaseHolds:
        return trackJobRun(
          core.db,
          { jobName: `payments:${job.name}`, schedulerId: job.repeatJobKey ?? undefined },
          async () => {
            let released = 0;
            for (const appointment of await findExpiredDepositHolds(core)) {
              if (await releaseUnpaidHold(core, appointment.id)) released += 1;
            }
            return { released };
          },
        );

      default:
        throw new Error(`Job desconocido en la cola payments: ${job.name}`);
    }
  };
}
