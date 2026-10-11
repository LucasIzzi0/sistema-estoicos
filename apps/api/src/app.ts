import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { getOrganizationBySlug, type CoreDeps, type OrganizationRef } from '@estoicos/core';
import { PAYMENT_JOBS, QUEUES, webhookJobId, type Queue, type Redis } from '@estoicos/queue';
import type { FakeMercadoPago } from '@estoicos/integrations';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { ApiConfig } from './config';
import { errorsPlugin } from './plugins/errors';
import { policyPlugin } from './plugins/policy';
import { securityPlugin } from './plugins/security';
import { agendaRoutes } from './routes/agenda';
import { customerAuthRoutes } from './routes/auth-customer';
import { staffAuthRoutes } from './routes/auth-staff';
import { barberRoutes } from './routes/barbers';
import { bookingRoutes } from './routes/booking';
import { branchRoutes } from './routes/branches';
import { catalogRoutes } from './routes/catalog';
import { cashRoutes } from './routes/cash';
import { customerRoutes } from './routes/customers';
import { devToolsRoutes } from './routes/dev-tools';
import { financeRoutes } from './routes/finance';
import { healthRoutes } from './routes/health';
import { loyaltyRoutes } from './routes/loyalty';
import { reportRoutes } from './routes/reports';
import { mercadoPagoRoutes } from './routes/mercadopago';
import { notificationRoutes } from './routes/notifications';
import { saleRoutes } from './routes/sales';
import { staffRoutes } from './routes/staff';
import { systemRoutes } from './routes/system';
import { webhookRoutes } from './routes/webhooks';

export interface AppContext {
  deps: CoreDeps;
  config: ApiConfig;
  redis: Redis;
  queues: Queue[];
  /** Organización de la v1 (DEFAULT_ORGANIZATION_SLUG), cacheada tras la primera consulta. */
  getOrganization: () => Promise<OrganizationRef>;
  /** Manda un webhook ya validado a la cola (el worker le pregunta a MP el estado real). */
  enqueueWebhook: (eventId: string) => Promise<void>;
}

export interface BuildAppInput {
  deps: CoreDeps;
  /** Mercado Pago simulado: habilita las rutas de prueba (nunca en producción). */
  fakeMercadoPago?: FakeMercadoPago;
  config: ApiConfig;
  redis: Redis;
  queues: Queue[];
  logger?: boolean | object;
}

export async function buildApp(input: BuildAppInput): Promise<FastifyInstance> {
  const { deps, config, redis, queues } = input;
  const app = Fastify({
    logger: input.logger ?? false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
  }).withTypeProvider<ZodTypeProvider>();

  // Los webhooks firmados se validan sobre el cuerpo CRUDO: se guarda al parsear el JSON.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    (request as { rawBody?: string }).rawBody = typeof body === 'string' ? body : body.toString('utf8');
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  let orgPromise: Promise<OrganizationRef> | null = null;
  const getOrganization = () => {
    orgPromise ??= getOrganizationBySlug(deps.db, config.env.DEFAULT_ORGANIZATION_SLUG).catch((error) => {
      orgPromise = null;
      throw error;
    });
    return orgPromise;
  };
  const enqueueWebhook = async (eventId: string) => {
    const queue = queues.find((q) => q.name === QUEUES.payments);
    if (!queue) return;
    await queue.add(
      PAYMENT_JOBS.webhook,
      { eventId },
      { jobId: webhookJobId(eventId, 0), removeOnComplete: 500, removeOnFail: 1000 },
    );
  };
  const ctx: AppContext = { deps, config, redis, queues, getOrganization, enqueueWebhook };

  await app.register(errorsPlugin);
  await app.register(securityPlugin, { config });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false, global: true });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'estoicos:rl:',
    keyGenerator: (request) => request.meta?.ip ?? request.ip,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      message: `Hiciste demasiados pedidos. Probá de nuevo en ${Math.max(1, Math.ceil(context.ttl / 60_000))} min.`,
    }),
  });
  await app.register(policyPlugin, { deps, config });

  if (!config.isProduction) {
    await app.register(swagger, {
      openapi: { info: { title: 'Estoicos API', version: '1' } },
      transform: jsonSchemaTransform,
    });
    app.get(
      '/v1/openapi.json',
      { config: { policy: { kind: 'public' } }, schema: { hide: true } },
      async () => app.swagger(),
    );
  }

  await app.register(healthRoutes, { ctx });
  await app.register(customerAuthRoutes, { ctx });
  await app.register(staffAuthRoutes, { ctx });
  await app.register(branchRoutes, { ctx });
  await app.register(staffRoutes, { ctx });
  await app.register(systemRoutes, { ctx });
  await app.register(catalogRoutes, { ctx });
  await app.register(barberRoutes, { ctx });
  await app.register(customerRoutes, { ctx });
  await app.register(agendaRoutes, { ctx });
  await app.register(bookingRoutes, { ctx });
  await app.register(saleRoutes, { ctx });
  await app.register(cashRoutes, { ctx });
  await app.register(financeRoutes, { ctx });
  await app.register(mercadoPagoRoutes, { ctx });
  await app.register(loyaltyRoutes, { ctx });
  await app.register(reportRoutes, { ctx });
  await app.register(notificationRoutes, { ctx });
  await app.register(webhookRoutes, { ctx });
  // Rutas de prueba (Point simulado y adelanto de notificaciones): jamás en producción.
  if (input.fakeMercadoPago && !config.isProduction) {
    await app.register(devToolsRoutes, { ctx, fake: input.fakeMercadoPago });
  }

  return app;
}
