import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('::'),
  DEFAULT_ORGANIZATION_SLUG: z.string().min(1),
  APP_PUBLIC_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  AUTH_CODE_SECRET: z.string().min(32, { error: 'AUTH_CODE_SECRET debe tener al menos 32 caracteres' }),
  DATA_ENCRYPTION_KEY: z.string().min(40),
  DATA_ENCRYPTION_KEY_PREVIOUS: optional,
  /** Solo desarrollo: usa un Mercado Pago simulado en lugar del real. */
  MP_SIMULATED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  INTERNAL_API_SECRET: optional,
  CLOUDFLARE_ORIGIN_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().min(3),
  EMAIL_REPLY_TO: optional,
  /** Firma de los webhooks de Resend (estado de los emails). */
  RESEND_WEBHOOK_SECRET: optional,
  // --- WhatsApp Cloud API (Fase 6). Sin esto, todo sale por email. ---
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_ACCESS_TOKEN: optional,
  /** App Secret de Meta: firma de los webhooks. */
  WHATSAPP_APP_SECRET: optional,
  /** Token que Meta usa una sola vez para verificar la URL del webhook. */
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: optional,
  /** Solo desarrollo: WhatsApp simulado. */
  WHATSAPP_SIMULATED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof envSchema>;

export interface ApiConfig {
  env: Env;
  isProduction: boolean;
  /** Cookies con prefijo __Host- y Secure fuera de desarrollo. */
  secureCookies: boolean;
  cookieNames: { staff: string; customer: string };
  appOrigin: string;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida de la API:\n${problems}`);
  }
  const env = parsed.data;
  const isProduction = env.APP_ENV === 'production' || env.APP_ENV === 'staging';
  if (isProduction) {
    const missing = (['INTERNAL_API_SECRET', 'CLOUDFLARE_ORIGIN_SECRET'] as const).filter((k) => !env[k]);
    if (missing.length)
      throw new Error(`Faltan variables obligatorias en ${env.APP_ENV}: ${missing.join(', ')}`);
  }
  const secureCookies = isProduction;
  return {
    env,
    isProduction,
    secureCookies,
    cookieNames: secureCookies
      ? { staff: '__Host-est_staff', customer: '__Host-est_client' }
      : { staff: 'est_staff', customer: 'est_client' },
    appOrigin: new URL(env.APP_PUBLIC_URL).origin,
  };
}
