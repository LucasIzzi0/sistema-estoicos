import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CoreDeps } from '@estoicos/core';
import { createDb, type Db } from '@estoicos/db';
import { seed } from '@estoicos/db/seed';
import { createEncryptor, FakeMercadoPago, FakeWhatsApp, MemoryMailer } from '@estoicos/integrations';
import { ALL_QUEUES, createQueue, createRedisConnection, type Queue, type Redis } from '@estoicos/queue';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

export const INTERNAL_SECRET = 'secreto-interno-de-tests-1234567890';

/**
 * El catálogo real de la barbería, en centavos (lo mismo que carga el seed). Los tests lo usan
 * desde acá: si mañana cambian los precios, se tocan en un solo lugar.
 */
export const PRECIO = {
  corte: 2_500_000,
  barba: 1_500_000,
  corteYBarba: 2_800_000,
  toallaCaliente: 3_500_000,
  ceraMate: 1_200_000,
} as const;
/** Cómo se llama la sucursal en el seed. */
export const SUCURSAL = 'Sucursal Principal Freire';
/** Cuántos servicios activos tiene el catálogo del seed. */
export const SERVICIOS_ACTIVOS = 5;
export const ADMIN_EMAIL = 'dueno@estoicos.test';
export const PASSWORD = 'contraseña-de-tests-2026';

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  redis: Redis;
  queues: Queue[];
  mailer: MemoryMailer;
  mp: FakeMercadoPago;
  wa: FakeWhatsApp;
  deps: CoreDeps;
  clock: { now: Date; advanceMinutes(minutes: number): void };
  ids: { organizationId: string; branchId: string; ownerId: string; barberIds: string[] };
  inject(options: InjectOptions & { cookie?: string }): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const databaseUrl = process.env.DATABASE_URL_TEST!;
  const redisUrl = process.env.REDIS_URL_TEST!;
  const config = loadConfig({
    ...process.env,
    APP_ENV: 'test',
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    INTERNAL_API_SECRET: INTERNAL_SECRET,
    CLOUDFLARE_ORIGIN_SECRET: '',
    // Secretos de los webhooks de estado (WhatsApp y Resend) para los tests.
    WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-de-prueba',
    RESEND_WEBHOOK_SECRET: 'whsec_' + Buffer.from('clave-de-resend').toString('base64'),
    APP_PUBLIC_URL: 'http://localhost:3000',
  });

  const db = createDb(databaseUrl);
  const redis = createRedisConnection(redisUrl, 'producer');
  const queues = ALL_QUEUES.map((name) => createQueue(name, redis));
  const mailer = new MemoryMailer();
  const encryptor = createEncryptor(config.env.DATA_ENCRYPTION_KEY, config.env.DATA_ENCRYPTION_KEY_PREVIOUS);
  const clock = {
    now: new Date(),
    advanceMinutes(minutes: number) {
      this.now = new Date(this.now.getTime() + minutes * 60_000);
    },
  };
  const silent = { info() {}, warn() {}, error() {} };
  // Mercado Pago simulado con la terminal virtual de pruebas, ya en modo PDV.
  const mp = new FakeMercadoPago({
    now: () => clock.now,
    terminals: [
      { id: 'NEWLAND_N950__SBX0000001', mode: 'PDV' },
      { id: 'NEWLAND_N950__SBX0000002', mode: 'STANDALONE' },
    ],
  });
  const wa = new FakeWhatsApp();
  const deps: CoreDeps = {
    db,
    mailer,
    encryptor,
    mercadoPago: () => mp,
    whatsapp: wa,
    config: { authCodeSecret: config.env.AUTH_CODE_SECRET, appPublicUrl: config.env.APP_PUBLIC_URL },
    log: silent,
    now: () => clock.now,
  };

  await resetDatabase(db);
  await redis.flushdb();
  const ids = await seed(db, { adminEmail: ADMIN_EMAIL, adminPassword: PASSWORD });

  const app = await buildApp({ deps, config, redis, queues });
  await app.ready();

  return {
    app,
    db,
    redis,
    queues,
    mailer,
    mp,
    wa,
    deps,
    clock,
    ids,
    inject: ({ cookie, headers, ...options }) =>
      app.inject({
        ...options,
        headers: { 'x-internal-secret': INTERNAL_SECRET, ...(cookie ? { cookie } : {}), ...headers },
      }),
    async close() {
      await app.close();
      await Promise.allSettled(queues.map((q) => q.close()));
      await redis.quit();
      await db.$disconnect();
    },
  };
}

/** Vacía todas las tablas (TRUNCATE no dispara los triggers de solo inserción). */
export async function resetDatabase(db: Db) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Extrae "nombre=valor" del Set-Cookie para reenviarlo en el próximo pedido. */
export function sessionCookie(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.value);
  if (!cookie)
    throw new Error(
      `La respuesta no trajo cookie de sesión (status ${response.statusCode}): ${response.body}`,
    );
  return `${cookie.name}=${cookie.value}`;
}

export function codeFromEmail(mailer: MemoryMailer): string {
  const text = mailer.last()?.text ?? '';
  const match = text.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`No hay código en el último email: ${text}`);
  return match[1]!;
}

export function linkTokenFromEmail(mailer: MemoryMailer): string {
  const text = mailer.last()?.text ?? '';
  const match = text.match(/(?:token=|invitacion\/)([A-Za-z0-9_%-]+)/);
  if (!match) throw new Error(`No hay link en el último email: ${text}`);
  return decodeURIComponent(match[1]!);
}

export async function loginStaff(ctx: TestContext, email: string, password = PASSWORD): Promise<string> {
  const response = await ctx.inject({
    method: 'POST',
    url: '/v1/auth/staff/login',
    payload: { email, password },
  });
  if (response.statusCode !== 200) throw new Error(`Login falló (${response.statusCode}): ${response.body}`);
  return sessionCookie(response);
}

/** Invita a alguien (como el dueño) y acepta la invitación: devuelve su cookie de sesión. */
export async function inviteAndAccept(
  ctx: TestContext,
  ownerCookie: string,
  input: {
    email: string;
    name?: string;
    role: 'ADMIN' | 'RECEPTION';
    branchIds: string[];
    allBranches?: boolean;
  },
  password = 'contraseña-del-invitado',
): Promise<string> {
  const invited = await ctx.inject({
    method: 'POST',
    url: '/v1/staff/invitations',
    cookie: ownerCookie,
    payload: { name: input.name ?? 'Invitado', allBranches: false, ...input },
  });
  if (invited.statusCode !== 201)
    throw new Error(`Invitación falló (${invited.statusCode}): ${invited.body}`);
  const accepted = await ctx.inject({
    method: 'POST',
    url: '/v1/auth/staff/invitations/accept',
    payload: { token: linkTokenFromEmail(ctx.mailer), password },
  });
  return sessionCookie(accepted);
}
