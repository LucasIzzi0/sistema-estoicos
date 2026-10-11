import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { markWorkerStopped, recordHeartbeat, type CoreDeps } from '@estoicos/core';
import { createDb } from '@estoicos/db';
import {
  CloudApiWhatsApp,
  ConsoleMailer,
  createEncryptor,
  FakeMercadoPago,
  FakeWhatsApp,
  ResendMailer,
} from '@estoicos/integrations';
import {
  createQueue,
  createRedisConnection,
  QUEUE_PREFIX,
  QUEUES,
  Worker,
  type Queue,
  type QueueName,
} from '@estoicos/queue';
import pino from 'pino';
import { loadWorkerConfig } from './config';
import { createNotificationProcessor } from './processors/notifications';
import { createPaymentsProcessor } from './processors/payments';
import { createSystemProcessor } from './processors/system';
import { registerSchedulers } from './schedulers';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

const config = loadWorkerConfig();
const isDev = config.APP_ENV === 'development';
const log = pino({
  level: config.LOG_LEVEL,
  ...(isDev
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
    : {}),
});

const instanceId = `${hostname()}:${process.pid}`;
const startedAt = new Date();
const db = createDb(config.DATABASE_URL);
const connection = createRedisConnection(config.REDIS_URL, 'worker');
const queues = new Map<QueueName, Queue>(
  Object.values(QUEUES).map((name) => [name, createQueue(name, connection)]),
);

// Sin credenciales de Mercado Pago se usa el simulador (nunca en producción).
const fakeMp =
  config.APP_ENV !== 'production' && config.MP_SIMULATED
    ? new FakeMercadoPago({
        // Como en el local: una terminal en uso y la segunda de repuesto.
        terminals: [
          { id: 'NEWLAND_N950__SBX0000001', mode: 'PDV' },
          { id: 'NEWLAND_N950__SBX0000002', mode: 'STANDALONE' },
        ],
      })
    : null;

// Dependencias compartidas por las colas "notifications" y "payments".
// WhatsApp: el real si están las credenciales de Meta; si no, el simulado (fuera de producción).
const whatsapp =
  config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_ACCESS_TOKEN
    ? new CloudApiWhatsApp({
        phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: config.WHATSAPP_ACCESS_TOKEN,
      })
    : config.APP_ENV !== 'production' && config.WHATSAPP_SIMULATED
      ? new FakeWhatsApp()
      : undefined;

const core: CoreDeps = {
  db,
  mailer: config.RESEND_API_KEY
    ? new ResendMailer(config.RESEND_API_KEY, config.EMAIL_FROM)
    : new ConsoleMailer(),
  encryptor: createEncryptor(config.DATA_ENCRYPTION_KEY, config.DATA_ENCRYPTION_KEY_PREVIOUS),
  ...(fakeMp ? { mercadoPago: () => fakeMp } : {}),
  ...(whatsapp ? { whatsapp } : {}),
  config: { authCodeSecret: '', appPublicUrl: config.APP_PUBLIC_URL, emailReplyTo: config.EMAIL_REPLY_TO },
  log,
  now: () => new Date(),
};
// Cola "system": concurrencia GLOBAL 1 (aunque durante un deploy convivan dos workers).
const systemQueue = queues.get(QUEUES.system)!;
await systemQueue.setGlobalConcurrency(1);

const systemWorker = new Worker(
  QUEUES.system,
  createSystemProcessor({
    db,
    core,
    queues: [...queues.values()],
    stuckMinutes: config.QUEUE_STUCK_THRESHOLD_MINUTES,
    now: () => new Date(),
  }),
  { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
);
systemWorker.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'Job fallido'));
systemWorker.on('error', (err) => log.error({ err: err.message }, 'Error del worker'));

if (!config.RESEND_API_KEY)
  log.warn('RESEND_API_KEY vacío: los emails se muestran en esta consola (solo desarrollo).');
const notificationWorker = new Worker(
  QUEUES.notifications,
  createNotificationProcessor({ core, queue: queues.get(QUEUES.notifications)! }),
  { connection, prefix: QUEUE_PREFIX, concurrency: config.WORKER_CONCURRENCY },
);
notificationWorker.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'Job fallido'));
notificationWorker.on('error', (err) => log.error({ err: err.message }, 'Error del worker'));

// Cola "payments": webhooks de Mercado Pago y redes de seguridad.
const paymentsWorker = new Worker(
  QUEUES.payments,
  createPaymentsProcessor({ core, queue: queues.get(QUEUES.payments)! }),
  { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
);
paymentsWorker.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'Job fallido'));
paymentsWorker.on('error', (err) => log.error({ err: err.message }, 'Error del worker'));

const schedulers = await registerSchedulers(queues);
log.info({ schedulers, instanceId }, 'Jobs programados registrados');

// Latido cada 30 s: si se corta, la API muestra "worker caído" en el dashboard.
const beat = async () => {
  try {
    await recordHeartbeat(db, {
      instanceId,
      version: config.RAILWAY_GIT_COMMIT_SHA,
      startedAt,
      now: new Date(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'No se pudo registrar el latido');
  }
};
await beat();
const heartbeatTimer = setInterval(beat, 30_000);

// Endpoint de salud para el chequeo de Railway durante el deploy.
const healthServer = createServer((req, res) => {
  const ok =
    req.url === '/health' &&
    connection.status === 'ready' &&
    systemWorker.isRunning() &&
    notificationWorker.isRunning() &&
    paymentsWorker.isRunning();
  res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: ok ? 'ok' : 'down' }));
}).listen(config.WORKER_HEALTH_PORT);

log.info({ port: config.WORKER_HEALTH_PORT }, 'Worker listo');

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info({ signal }, 'Apagando el worker: termino los jobs en curso');
  clearInterval(heartbeatTimer);
  // BullMQ puede no resolver close() si Redis no responde: límite propio.
  const timer = setTimeout(() => process.exit(1), 25_000).unref();
  try {
    await Promise.all([systemWorker.close(), notificationWorker.close(), paymentsWorker.close()]);
    await markWorkerStopped(db, instanceId, new Date());
    await Promise.allSettled([
      ...[...queues.values()].map((q) => q.close()),
      connection.quit(),
      db.$disconnect(),
    ]);
    healthServer.close();
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
