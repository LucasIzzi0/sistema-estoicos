import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

/** Prefijo de todas las claves de BullMQ en Redis. */
export const QUEUE_PREFIX = 'estoicos';

export const QUEUES = {
  /** Mantenimiento y monitoreo (salud, limpieza). Concurrencia global 1. */
  system: 'system',
  /** Envío de notificaciones (se usa desde la Fase 3). */
  notifications: 'notifications',
  /** Webhooks y sincronización de Mercado Pago (Fase 5). */
  payments: 'payments',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);

export const SYSTEM_JOBS = {
  healthMonitor: 'health-monitor',
  housekeeping: 'housekeeping',
} as const;

export const NOTIFICATION_JOBS = {
  /** Enviar una notificación (data: { id }). */
  send: 'send',
  /** Barrido: re-encola las pendientes que ya tocan. */
  dispatch: 'dispatch',
  /** Recordatorios de turno (24 h y 2 h antes). */
  reminders: 'reminders',
  /** Pedido de reseña en Google, unas horas después del servicio. */
  reviews: 'reviews',
  /** Reactivación del cliente que hace rato no viene. */
  reactivation: 'reactivation',
} as const;

export const LOYALTY_JOBS = {
  /** Vencimiento diario de puntos (FIFO, idempotente). */
  expirePoints: 'expire-points',
} as const;

/**
 * Id del job de envío: incluye el número de intento, así dos procesos que encolan la misma
 * notificación a la vez generan UN solo job, y un reintento posterior no choca con el anterior.
 */
export function notificationJobId(notificationId: string, attempts: number): string {
  return `notification-${notificationId}-${attempts}`;
}

export const PAYMENT_JOBS = {
  /** Procesar un webhook ya recibido y firmado (data: { eventId }). */
  webhook: 'webhook',
  /** Consultar una orden Point sin noticias (data: { orderId }). */
  syncOrder: 'sync-order',
  /** Barrido: órdenes pendientes y webhooks trabados. */
  sweep: 'sweep',
  /** Sincronización periódica de pagos de la cuenta. */
  syncPayments: 'sync-payments',
  /** Liberar turnos cuya seña venció. */
  releaseHolds: 'release-holds',
} as const;

/** Un job por evento: si el mismo webhook se encola dos veces, BullMQ lo unifica. */
export function webhookJobId(eventId: string, attempts: number): string {
  return `mp-webhook-${eventId}-${attempts}`;
}

export interface ScheduleDefinition {
  queue: QueueName;
  /** ID FIJO: registrar el scheduler en cada arranque no lo duplica. */
  schedulerId: string;
  repeat: { every: number } | { pattern: string; tz: string };
  jobName: string;
}

const TZ = 'America/Argentina/Buenos_Aires';

export const SCHEDULES: ScheduleDefinition[] = [
  {
    queue: QUEUES.system,
    schedulerId: 'system:health-monitor',
    repeat: { every: 60_000 },
    jobName: SYSTEM_JOBS.healthMonitor,
  },
  {
    queue: QUEUES.system,
    schedulerId: 'system:housekeeping',
    repeat: { pattern: '30 4 * * *', tz: TZ },
    jobName: SYSTEM_JOBS.housekeeping,
  },
  {
    queue: QUEUES.notifications,
    schedulerId: 'notifications:dispatch',
    repeat: { every: 60_000 },
    jobName: NOTIFICATION_JOBS.dispatch,
  },
  {
    queue: QUEUES.notifications,
    schedulerId: 'notifications:reminders',
    repeat: { every: 300_000 },
    jobName: NOTIFICATION_JOBS.reminders,
  },
  {
    queue: QUEUES.notifications,
    schedulerId: 'notifications:reviews',
    repeat: { every: 900_000 },
    jobName: NOTIFICATION_JOBS.reviews,
  },
  {
    queue: QUEUES.notifications,
    schedulerId: 'notifications:reactivation',
    repeat: { pattern: '0 11 * * *', tz: TZ },
    jobName: NOTIFICATION_JOBS.reactivation,
  },
  {
    queue: QUEUES.system,
    schedulerId: 'system:expire-points',
    repeat: { pattern: '30 3 * * *', tz: TZ },
    jobName: LOYALTY_JOBS.expirePoints,
  },
  {
    queue: QUEUES.payments,
    schedulerId: 'payments:sweep',
    repeat: { every: 120_000 },
    jobName: PAYMENT_JOBS.sweep,
  },
  {
    queue: QUEUES.payments,
    schedulerId: 'payments:sync-payments',
    repeat: { every: 600_000 },
    jobName: PAYMENT_JOBS.syncPayments,
  },
  {
    queue: QUEUES.payments,
    schedulerId: 'payments:release-holds',
    repeat: { every: 60_000 },
    jobName: PAYMENT_JOBS.releaseHolds,
  },
];

/**
 * Conexión a Redis.
 * - worker: reintenta indefinidamente (BullMQ exige maxRetriesPerRequest: null).
 * - producer (API): falla rápido para no colgar un pedido HTTP si Redis no responde.
 * `family: 0` resuelve IPv4 e IPv6, necesario en la red privada de Railway.
 */
export function createRedisConnection(url: string, role: 'worker' | 'producer'): Redis {
  return new Redis(url, {
    family: 0,
    maxRetriesPerRequest: role === 'worker' ? null : 2,
    enableOfflineQueue: role === 'worker',
    lazyConnect: false,
  });
}

export function createQueue(name: QueueName, connection: Redis): Queue {
  return new Queue(name, { connection, prefix: QUEUE_PREFIX });
}

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export async function getQueueCounts(queue: Queue): Promise<QueueCounts> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  return {
    name: queue.name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
  };
}

export { Queue, Redis, Worker, type Job };
