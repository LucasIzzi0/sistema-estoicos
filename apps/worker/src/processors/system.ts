import {
  customersWithExpiredPoints,
  evaluateQueues,
  expirePointsFor,
  runHousekeeping,
  trackJobRun,
  type CoreDeps,
  type QueueObservation,
} from '@estoicos/core';
import type { Db } from '@estoicos/db';
import { LOYALTY_JOBS, SYSTEM_JOBS, type Job, type Queue } from '@estoicos/queue';

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/** Mira el estado real de una cola: cuánto espera el job más viejo, cuánto lleva el activo más largo, fallas recientes. */
export async function observeQueue(queue: Queue, now: Date): Promise<QueueObservation> {
  const [counts, oldestWaiting, active, failed] = await Promise.all([
    queue.getJobCounts('waiting', 'active', 'failed'),
    queue.getJobs(['waiting'], 0, 0, true),
    queue.getJobs(['active'], 0, 49, true),
    queue.getJobs(['failed'], 0, 99, false),
  ]);
  const seconds = (ms: number) => Math.max(0, Math.round((now.getTime() - ms) / 1000));
  const oldest = oldestWaiting[0];
  const activeStarts = active
    .map((j) => j.processedOn ?? j.timestamp)
    .filter((t): t is number => typeof t === 'number');
  return {
    name: queue.name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    failed: counts.failed ?? 0,
    oldestWaitingSeconds: oldest ? seconds(oldest.timestamp) : null,
    longestActiveSeconds: activeStarts.length ? seconds(Math.min(...activeStarts)) : null,
    recentFailures: failed.filter((j) => (j.finishedOn ?? 0) > now.getTime() - FIFTEEN_MINUTES_MS).length,
  };
}

export interface SystemProcessorDeps {
  db: Db;
  /** Para los jobs que necesitan el core completo (vencimiento de puntos). */
  core?: CoreDeps;
  queues: Queue[];
  stuckMinutes: number;
  now: () => Date;
}

/** Procesa los jobs de la cola "system": monitor de salud y limpieza. */
export function createSystemProcessor(deps: SystemProcessorDeps) {
  return async (job: Job) => {
    switch (job.name) {
      case SYSTEM_JOBS.healthMonitor:
        return trackJobRun(
          deps.db,
          { jobName: job.name, schedulerId: job.repeatJobKey ?? undefined },
          async () => {
            const now = deps.now();
            const observations = await Promise.all(deps.queues.map((q) => observeQueue(q, now)));
            await evaluateQueues(
              deps.db,
              observations,
              { stuckMinutes: deps.stuckMinutes, failuresPer15Min: 5 },
              now,
            );
            return { queues: observations.length };
          },
        );
      case SYSTEM_JOBS.housekeeping:
        return trackJobRun(deps.db, { jobName: job.name, schedulerId: job.repeatJobKey ?? undefined }, () =>
          runHousekeeping(deps.db, deps.now()),
        );
      case LOYALTY_JOBS.expirePoints:
        return trackJobRun(
          deps.db,
          { jobName: job.name, schedulerId: job.repeatJobKey ?? undefined },
          async () => {
            if (!deps.core) return { expired: 0, clientes: 0 };
            const now = deps.now();
            const customers = await customersWithExpiredPoints(deps.core, now);
            let expired = 0;
            let affected = 0;
            for (const customerId of customers) {
              const result = await expirePointsFor(deps.core, customerId, now);
              if (result.expired > 0) {
                expired += result.expired;
                affected += 1;
              }
            }
            return { expired, clientes: affected };
          },
        );

      default:
        throw new Error(`Job desconocido en la cola system: ${job.name}`);
    }
  };
}
