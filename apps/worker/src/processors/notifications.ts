import {
  dueReactivations,
  dueReminders,
  dueReviewRequests,
  findDueNotifications,
  queueReactivation,
  queueReminder,
  queueReviewRequest,
  sendNotification,
  trackJobRun,
  type CoreDeps,
} from '@estoicos/core';
import { NOTIFICATION_JOBS, notificationJobId, type Job, type Queue } from '@estoicos/queue';

/**
 * Cola "notifications":
 * - send: envía UNA notificación (el paso PENDING → SENDING es atómico, así que un job repetido no duplica).
 * - dispatch (cada 1 min): re-encola las pendientes que ya tocan, incluidos los reintentos con espera.
 */
/** Encola el envío de cada notificación recién creada. */
async function enqueue(queue: Queue, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await queue.addBulk(
    ids.map((id) => ({
      name: NOTIFICATION_JOBS.send,
      data: { id },
      opts: { jobId: notificationJobId(id, 0), removeOnComplete: 500, removeOnFail: 1000 },
    })),
  );
}

export function createNotificationProcessor(deps: { core: CoreDeps; queue: Queue }) {
  return async (job: Job) => {
    switch (job.name) {
      case NOTIFICATION_JOBS.send:
        return sendNotification(deps.core, String((job.data as { id: string }).id));
      case NOTIFICATION_JOBS.dispatch:
        return trackJobRun(
          deps.core.db,
          { jobName: `notifications:${job.name}`, schedulerId: job.repeatJobKey ?? undefined },
          async () => {
            const due = await findDueNotifications(deps.core);
            if (due.length) {
              await deps.queue.addBulk(
                due.map((n) => ({
                  name: NOTIFICATION_JOBS.send,
                  data: { id: n.id },
                  opts: {
                    jobId: notificationJobId(n.id, n.attempts),
                    removeOnComplete: 500,
                    removeOnFail: 1000,
                  },
                })),
              );
            }
            return { enqueued: due.length };
          },
        );
      case NOTIFICATION_JOBS.reminders:
        return trackJobRun(
          deps.core.db,
          { jobName: `notifications:${job.name}`, schedulerId: job.repeatJobKey ?? undefined },
          async () => {
            const due = await dueReminders(deps.core);
            const ids: string[] = [];
            for (const item of due) {
              const id = await queueReminder(deps.core, item);
              if (id) ids.push(id);
            }
            await enqueue(deps.queue, ids);
            return { recordatorios: ids.length };
          },
        );

      case NOTIFICATION_JOBS.reviews:
        return trackJobRun(
          deps.core.db,
          { jobName: `notifications:${job.name}`, schedulerId: job.repeatJobKey ?? undefined },
          async () => {
            const ids: string[] = [];
            for (const sale of await dueReviewRequests(deps.core)) {
              const id = await queueReviewRequest(deps.core, sale.id);
              if (id) ids.push(id);
            }
            await enqueue(deps.queue, ids);
            return { reseñas: ids.length };
          },
        );

      case NOTIFICATION_JOBS.reactivation:
        return trackJobRun(
          deps.core.db,
          { jobName: `notifications:${job.name}`, schedulerId: job.repeatJobKey ?? undefined },
          async () => {
            const ids: string[] = [];
            for (const customer of await dueReactivations(deps.core)) {
              const id = await queueReactivation(deps.core, customer.id);
              if (id) ids.push(id);
            }
            await enqueue(deps.queue, ids);
            return { reactivaciones: ids.length };
          },
        );

      default:
        throw new Error(`Job desconocido en la cola notifications: ${job.name}`);
    }
  };
}
