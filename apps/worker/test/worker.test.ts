import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from '@estoicos/db';
import { createEncryptor, MemoryMailer } from '@estoicos/integrations';
import {
  createQueue,
  createRedisConnection,
  QUEUES,
  type Queue,
  type QueueName,
  type Redis,
} from '@estoicos/queue';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNotificationProcessor } from '../src/processors/notifications';
import { createSystemProcessor, observeQueue } from '../src/processors/system';
import { registerSchedulers } from '../src/schedulers';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

let db: Db;
let redis: Redis;
let queues: Map<QueueName, Queue>;

beforeAll(async () => {
  db = createDb(process.env.DATABASE_URL_TEST!);
  redis = createRedisConnection(process.env.REDIS_URL_TEST!, 'worker');
  await redis.flushdb();
  await db.systemAlert.deleteMany();
  await db.jobRun.deleteMany();
  queues = new Map(Object.values(QUEUES).map((name) => [name, createQueue(name, redis)]));
});

afterAll(async () => {
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  await redis.quit();
  await db.$disconnect();
});

describe('jobs programados', () => {
  it('registrar los schedulers dos veces no los duplica (IDs fijos)', async () => {
    await registerSchedulers(queues);
    await registerSchedulers(queues);
    const system = queues.get(QUEUES.system)!;
    const schedulers = await system.getJobSchedulers();
    expect(schedulers.map((s) => s.key).sort()).toEqual([
      'system:expire-points',
      'system:health-monitor',
      'system:housekeeping',
    ]);
    const notifications = await queues.get(QUEUES.notifications)!.getJobSchedulers();
    expect(notifications.map((s) => s.key).sort()).toEqual([
      'notifications:dispatch',
      'notifications:reactivation',
      'notifications:reminders',
      'notifications:reviews',
    ]);
    const payments = await queues.get(QUEUES.payments)!.getJobSchedulers();
    expect(payments.map((s) => s.key).sort()).toEqual([
      'payments:release-holds',
      'payments:sweep',
      'payments:sync-payments',
    ]);
  });
});

describe('monitor de colas', () => {
  it('detecta un trabajo esperando hace más de N minutos y abre la alerta', async () => {
    const notifications = queues.get(QUEUES.notifications)!;
    await notifications.add('prueba', { x: 1 });

    const now = new Date(Date.now() + 20 * 60_000);
    const observation = await observeQueue(notifications, now);
    // También está el primer "dispatch" del scheduler de notificaciones.
    expect(observation.waiting).toBeGreaterThanOrEqual(1);
    expect(observation.oldestWaitingSeconds).toBeGreaterThanOrEqual(19 * 60);

    const processor = createSystemProcessor({
      db,
      queues: [...queues.values()],
      stuckMinutes: 10,
      now: () => now,
    });
    await processor({ name: 'health-monitor', repeatJobKey: 'system:health-monitor' } as never);

    const alert = await db.systemAlert.findFirst({
      where: { dedupeKey: 'queue-backlog:notifications', resolvedAt: null },
    });
    expect(alert?.kind).toBe('QUEUE_BACKLOG');
    const run = await db.jobRun.findFirst({ where: { jobName: 'health-monitor' } });
    expect(run?.status).toBe('SUCCEEDED');
  });
});

describe('notificaciones', () => {
  it('el despachador encola cada pendiente UNA vez y el envío la marca como enviada', async () => {
    const org = await db.organization.create({
      data: { name: 'Org de prueba', slug: `worker-${Date.now()}` },
    });
    const notification = await db.notification.create({
      data: {
        organizationId: org.id,
        type: 'BOOKING_CANCELLATION',
        channel: 'EMAIL',
        recipient: 'cliente@example.com',
        dedupeKey: `test:${org.id}`,
        payload: {
          orgName: 'Estoicos',
          customerFirstName: 'Ana',
          branchName: 'Principal',
          branchAddress: null,
          barberName: 'Juan',
          services: ['Corte'],
          startsAt: '2026-10-13T13:00:00.000Z',
          endsAt: '2026-10-13T13:40:00.000Z',
          timezone: 'America/Argentina/Buenos_Aires',
          totalCents: 1500000,
          manageUrl: 'http://localhost:3000/mi-cuenta/turnos',
          bookingUrl: 'http://localhost:3000/reservar/principal',
        },
      },
    });
    const queue = queues.get(QUEUES.notifications)!;
    const mailer = new MemoryMailer();
    const processor = createNotificationProcessor({
      core: {
        db,
        mailer,
        encryptor: createEncryptor(Buffer.alloc(32, 7).toString('base64')),
        config: { authCodeSecret: '', appPublicUrl: 'http://localhost:3000' },
        log: { info() {}, warn() {}, error() {} },
        now: () => new Date(),
      },
      queue,
    });

    // Dos barridos seguidos (o dos workers durante un deploy) no duplican el job.
    await processor({ name: 'dispatch', repeatJobKey: 'notifications:dispatch' } as never);
    await processor({ name: 'dispatch', repeatJobKey: 'notifications:dispatch' } as never);
    const jobs = (await queue.getJobs(['waiting'])).filter((j) => j.data?.id === notification.id);
    expect(jobs.map((j) => j.id)).toEqual([`notification-${notification.id}-0`]);

    expect(await processor({ name: 'send', data: { id: notification.id } } as never)).toBe('SENT');
    expect(await processor({ name: 'send', data: { id: notification.id } } as never)).toBe('NOOP');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last()!.subject).toContain('Turno cancelado');
    const saved = await db.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(saved).toMatchObject({ status: 'SENT', attempts: 1 });
    await db.notification.delete({ where: { id: notification.id } });
  });
});
