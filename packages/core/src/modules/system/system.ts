import type { AlertSeverity, Db, Prisma, SystemAlertKind } from '@estoicos/db';
import type { SystemAlertDto, SystemHealth } from '@estoicos/shared';
import { requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps } from '../../deps';
import { Errors, isUniqueViolation } from '../../errors';

/** Sin latido por más de este tiempo, el worker se considera caído. */
export const WORKER_DOWN_AFTER_SECONDS = 120;

// ---------------------------------------------------------------------------
// Latido del worker
// ---------------------------------------------------------------------------

export async function recordHeartbeat(
  db: Db,
  input: { instanceId: string; version?: string; startedAt: Date; now: Date },
): Promise<void> {
  await db.workerHeartbeat.upsert({
    where: { id: input.instanceId },
    create: {
      id: input.instanceId,
      version: input.version ?? null,
      startedAt: input.startedAt,
      lastBeatAt: input.now,
    },
    update: { lastBeatAt: input.now, stoppedAt: null },
  });
}

export async function markWorkerStopped(db: Db, instanceId: string, now: Date): Promise<void> {
  await db.workerHeartbeat.updateMany({ where: { id: instanceId }, data: { stoppedAt: now } });
}

export async function getWorkerStatus(db: Db, now: Date): Promise<SystemHealth['worker']> {
  const latest = await db.workerHeartbeat.findFirst({ orderBy: { lastBeatAt: 'desc' } });
  if (!latest) return { status: 'unknown', lastBeatAt: null, ageSeconds: null };
  const ageSeconds = Math.round((now.getTime() - latest.lastBeatAt.getTime()) / 1000);
  return {
    status: ageSeconds > WORKER_DOWN_AFTER_SECONDS ? 'down' : 'ok',
    lastBeatAt: latest.lastBeatAt.toISOString(),
    ageSeconds,
  };
}

// ---------------------------------------------------------------------------
// Alertas (una sola ABIERTA por dedupeKey: índice parcial en la base)
// ---------------------------------------------------------------------------

export interface AlertInput {
  organizationId?: string | null;
  kind: SystemAlertKind;
  severity: AlertSeverity;
  dedupeKey: string;
  message: string;
  details?: Prisma.InputJsonValue;
}

/** Abre una alerta o, si ya está abierta, actualiza su último avistaje y el contador. */
export async function raiseAlert(db: Db, input: AlertInput, now: Date): Promise<void> {
  const bump = async () =>
    db.systemAlert.updateMany({
      where: { dedupeKey: input.dedupeKey, resolvedAt: null },
      data: {
        lastSeenAt: now,
        occurrences: { increment: 1 },
        message: input.message,
        severity: input.severity,
        details: input.details,
      },
    });
  if ((await bump()).count > 0) return;
  try {
    await db.systemAlert.create({
      data: {
        organizationId: input.organizationId ?? null,
        kind: input.kind,
        severity: input.severity,
        dedupeKey: input.dedupeKey,
        message: input.message,
        details: input.details,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await bump();
  }
}

/** Cierra la alerta abierta con esa clave (el problema se resolvió). */
export async function resolveAlert(db: Db, dedupeKey: string, now: Date): Promise<boolean> {
  const result = await db.systemAlert.updateMany({
    where: { dedupeKey, resolvedAt: null },
    data: { resolvedAt: now },
  });
  return result.count > 0;
}

export async function listOpenAlerts(db: Db, organizationId: string): Promise<SystemAlertDto[]> {
  const alerts = await db.systemAlert.findMany({
    where: { resolvedAt: null, OR: [{ organizationId: null }, { organizationId }] },
    orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
    take: 50,
  });
  return alerts.map((a) => ({
    id: a.id,
    kind: a.kind,
    severity: a.severity,
    message: a.message,
    firstSeenAt: a.firstSeenAt.toISOString(),
    lastSeenAt: a.lastSeenAt.toISOString(),
    occurrences: a.occurrences,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
  }));
}

export async function acknowledgeAlert(
  deps: CoreDeps,
  principal: StaffPrincipal,
  alertId: string,
): Promise<void> {
  requirePermission(principal, 'system:alerts:ack');
  const result = await deps.db.systemAlert.updateMany({
    where: {
      id: alertId,
      resolvedAt: null,
      OR: [{ organizationId: null }, { organizationId: principal.organizationId }],
    },
    data: { acknowledgedAt: deps.now(), acknowledgedById: principal.userId },
  });
  if (result.count === 0) throw Errors.notFound('La alerta ya no está abierta.');
}

/**
 * Estado del sistema para el dashboard. La API evalúa el latido del worker al servir el
 * pedido (un worker caído no puede avisar que está caído) y deja la alerta registrada.
 */
export async function getSystemHealth(
  deps: CoreDeps,
  principal: StaffPrincipal,
  queues: SystemHealth['queues'],
): Promise<SystemHealth> {
  requirePermission(principal, 'system:health');
  const now = deps.now();
  const worker = await getWorkerStatus(deps.db, now);
  if (worker.status === 'down') {
    await raiseAlert(
      deps.db,
      {
        kind: 'WORKER_DOWN',
        severity: 'CRITICAL',
        dedupeKey: 'worker-down',
        message: `El worker no da señales hace ${Math.round((worker.ageSeconds ?? 0) / 60)} minutos: no se están enviando avisos ni procesando pagos.`,
      },
      now,
    );
  } else if (worker.status === 'ok') {
    await resolveAlert(deps.db, 'worker-down', now);
  }
  return { worker, queues, alerts: await listOpenAlerts(deps.db, principal.organizationId) };
}

// ---------------------------------------------------------------------------
// Monitor de colas (lo corre el worker cada minuto)
// ---------------------------------------------------------------------------

export interface QueueObservation {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  /** Antigüedad del job en espera más viejo (segundos). */
  oldestWaitingSeconds: number | null;
  /** Mayor tiempo que lleva un job activo (segundos). */
  longestActiveSeconds: number | null;
  /** Fallas en los últimos 15 minutos. */
  recentFailures: number;
}

export async function evaluateQueues(
  db: Db,
  observations: QueueObservation[],
  thresholds: { stuckMinutes: number; failuresPer15Min: number },
  now: Date,
): Promise<void> {
  const limit = thresholds.stuckMinutes * 60;
  for (const q of observations) {
    const backlogKey = `queue-backlog:${q.name}`;
    if (q.oldestWaitingSeconds !== null && q.oldestWaitingSeconds > limit) {
      await raiseAlert(
        db,
        {
          kind: 'QUEUE_BACKLOG',
          severity: 'WARNING',
          dedupeKey: backlogKey,
          message: `La cola "${q.name}" tiene trabajos esperando hace más de ${thresholds.stuckMinutes} minutos (${q.waiting} en espera).`,
          details: { waiting: q.waiting, oldestWaitingSeconds: q.oldestWaitingSeconds },
        },
        now,
      );
    } else {
      await resolveAlert(db, backlogKey, now);
    }

    const stuckKey = `job-stuck:${q.name}`;
    if (q.longestActiveSeconds !== null && q.longestActiveSeconds > limit) {
      await raiseAlert(
        db,
        {
          kind: 'JOB_STUCK',
          severity: 'WARNING',
          dedupeKey: stuckKey,
          message: `Un trabajo de la cola "${q.name}" lleva más de ${thresholds.stuckMinutes} minutos en curso.`,
          details: { longestActiveSeconds: q.longestActiveSeconds },
        },
        now,
      );
    } else {
      await resolveAlert(db, stuckKey, now);
    }

    const failKey = `job-failures:${q.name}`;
    if (q.recentFailures >= thresholds.failuresPer15Min) {
      await raiseAlert(
        db,
        {
          kind: 'JOB_FAILURES',
          severity: 'WARNING',
          dedupeKey: failKey,
          message: `La cola "${q.name}" tuvo ${q.recentFailures} fallas en los últimos 15 minutos.`,
          details: { recentFailures: q.recentFailures },
        },
        now,
      );
    } else {
      await resolveAlert(db, failKey, now);
    }
  }
}

// ---------------------------------------------------------------------------
// Limpieza diaria
// ---------------------------------------------------------------------------

export async function runHousekeeping(db: Db, now: Date): Promise<Record<string, number>> {
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  const [authCodes, sessions, idempotencyKeys, heartbeats, jobRuns] = await Promise.all([
    db.authCode.deleteMany({ where: { expiresAt: { lt: daysAgo(7) } } }),
    db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: daysAgo(7) } }, { revokedAt: { lt: daysAgo(7) } }] },
    }),
    db.apiIdempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.workerHeartbeat.deleteMany({ where: { lastBeatAt: { lt: daysAgo(7) } } }),
    db.jobRun.deleteMany({ where: { startedAt: { lt: daysAgo(90) } } }),
  ]);
  return {
    authCodes: authCodes.count,
    sessions: sessions.count,
    idempotencyKeys: idempotencyKeys.count,
    heartbeats: heartbeats.count,
    jobRuns: jobRuns.count,
  };
}

/** Registra una ejecución de un job programado (historial visible para diagnóstico). */
export async function trackJobRun<T extends Record<string, unknown> | void>(
  db: Db,
  input: { jobName: string; schedulerId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const run = await db.jobRun.create({
    data: { jobName: input.jobName, schedulerId: input.schedulerId ?? null, status: 'RUNNING' },
  });
  try {
    const result = await fn();
    await db.jobRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        stats: (result ?? undefined) as Prisma.InputJsonValue,
      },
    });
    return result;
  } catch (error) {
    await db.jobRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), error: String(error).slice(0, 2000) },
    });
    throw error;
  }
}
