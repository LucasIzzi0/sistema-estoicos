import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CoreDeps } from '@estoicos/core';
import { createDb } from '@estoicos/db';
import {
  CloudApiWhatsApp,
  createEncryptor,
  EmailSendError,
  FakeMercadoPago,
  FakeWhatsApp,
  ResendMailer,
} from '@estoicos/integrations';
import {
  ALL_QUEUES,
  createQueue,
  createRedisConnection,
  NOTIFICATION_JOBS,
  notificationJobId,
  QUEUES,
} from '@estoicos/queue';
import { buildApp } from './app';
import { loadConfig } from './config';

// En desarrollo las variables vienen del .env de la raíz; en Railway, del entorno.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

const config = loadConfig();
const { env } = config;

const db = createDb(env.DATABASE_URL);
const redis = createRedisConnection(env.REDIS_URL, 'producer');
const queues = ALL_QUEUES.map((name) => createQueue(name, redis));
const mailer = env.RESEND_API_KEY
  ? new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM)
  : {
      name: 'unavailable',
      async send() {
        throw new EmailSendError('Envío de email desactivado: configurá RESEND_API_KEY para habilitarlo.', 503, false);
      },
    };

// Sin credenciales de Mercado Pago se usa el simulador (solo fuera de producción).
const simulatedMp = env.APP_ENV !== 'production' && env.MP_SIMULATED;
const fakeMp = simulatedMp
  ? new FakeMercadoPago({
      // Como en el local: una terminal en uso y la segunda de repuesto.
      terminals: [
        { id: 'NEWLAND_N950__SBX0000001', mode: 'PDV' },
        { id: 'NEWLAND_N950__SBX0000002', mode: 'STANDALONE' },
      ],
    })
  : null;

// WhatsApp: el real si están las credenciales de Meta; si no, el simulado (fuera de producción).
const whatsapp =
  env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN
    ? new CloudApiWhatsApp({
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
      })
    : env.APP_ENV !== 'production' && env.WHATSAPP_SIMULATED
      ? new FakeWhatsApp()
      : undefined;

const deps: CoreDeps = {
  db,
  mailer,
  encryptor: createEncryptor(env.DATA_ENCRYPTION_KEY, env.DATA_ENCRYPTION_KEY_PREVIOUS),
  ...(fakeMp ? { mercadoPago: () => fakeMp } : {}),
  ...(whatsapp ? { whatsapp } : {}),
  config: {
    authCodeSecret: env.AUTH_CODE_SECRET,
    appPublicUrl: env.APP_PUBLIC_URL,
    emailReplyTo: env.EMAIL_REPLY_TO,
  },
  log: console,
  now: () => new Date(),
  // Encola el envío apenas se crea la notificación (el despachador del worker es el respaldo).
  dispatchNotifications: async (ids) => {
    const queue = queues.find((q) => q.name === QUEUES.notifications)!;
    await queue.addBulk(
      ids.map((id) => ({
        name: NOTIFICATION_JOBS.send,
        data: { id },
        opts: { jobId: notificationJobId(id, 0), removeOnComplete: 500, removeOnFail: 1000 },
      })),
    );
  },
};

const app = await buildApp({
  deps,
  config,
  redis,
  queues,
  ...(fakeMp ? { fakeMercadoPago: fakeMp } : {}),
  logger: {
    level: env.LOG_LEVEL,
    // Nunca se loguean cookies, secretos ni firmas.
    redact: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-internal-secret"]',
      'req.headers["x-origin-auth"]',
      'req.headers["x-signature"]',
      'res.headers["set-cookie"]',
    ],
    ...(config.isProduction
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }),
  },
});
deps.log = app.log;

if (!env.RESEND_API_KEY) app.log.warn('RESEND_API_KEY vacío: los emails están desactivados.');

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Apagando la API');
  const timer = setTimeout(() => process.exit(1), 15_000).unref();
  try {
    await app.close();
    await Promise.allSettled([...queues.map((q) => q.close()), redis.quit(), db.$disconnect()]);
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: env.HOST });
