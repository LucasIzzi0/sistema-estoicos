import { z } from 'zod';

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  QUEUE_STUCK_THRESHOLD_MINUTES: z.coerce.number().int().min(1).default(10),
  WORKER_HEALTH_PORT: z.coerce.number().int().default(8081),
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
  DATA_ENCRYPTION_KEY: z.string().min(40),
  DATA_ENCRYPTION_KEY_PREVIOUS: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  /** Solo desarrollo: WhatsApp simulado. */
  WHATSAPP_SIMULATED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  /** Solo desarrollo: Mercado Pago simulado. */
  MP_SIMULATED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  // Emails (los mismos valores que la API).
  APP_PUBLIC_URL: z.url().default('http://localhost:3000'),
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  EMAIL_FROM: z.string().min(3).default('Estoicos <turnos@localhost>'),
  EMAIL_REPLY_TO: z
    .string()
    .optional()
    .transform((v) => v || undefined),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadWorkerConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  // En Railway el chequeo de salud usa $PORT.
  const parsed = envSchema.safeParse({ WORKER_HEALTH_PORT: source.PORT, ...source });
  if (parsed.success && parsed.data.APP_ENV === 'production' && !parsed.data.RESEND_API_KEY) {
    throw new Error('Configuración inválida del worker:\n  - RESEND_API_KEY: obligatorio en producción');
  }
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida del worker:\n${problems}`);
  }
  return parsed.data;
}
