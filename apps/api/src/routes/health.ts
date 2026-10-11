import { getWorkerStatus } from '@estoicos/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

export const healthRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  /** Liveness: para el chequeo de Railway durante el deploy. */
  app.get(
    '/health',
    {
      config: { policy: { kind: 'public' }, rateLimit: false },
      schema: { response: { 200: z.object({ status: z.literal('ok') }) } },
    },
    async () => ({ status: 'ok' as const }),
  );

  /** Estado profundo: base, Redis y latido del worker. Lo consulta el monitor externo. */
  app.get(
    '/health/deep',
    {
      config: { policy: { kind: 'public' } },
      schema: {
        response: {
          200: z.object({
            status: z.enum(['ok', 'degraded']),
            database: z.boolean(),
            redis: z.boolean(),
            worker: z.string(),
          }),
          503: z.object({
            status: z.literal('down'),
            database: z.boolean(),
            redis: z.boolean(),
            worker: z.string(),
          }),
        },
      },
    },
    async (_request, reply) => {
      const database = await ctx.deps.db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
      const redis = await ctx.redis
        .ping()
        .then((r) => r === 'PONG')
        .catch(() => false);
      const worker = database ? (await getWorkerStatus(ctx.deps.db, ctx.deps.now())).status : 'unknown';
      if (!database || !redis)
        return reply.code(503).send({ status: 'down' as const, database, redis, worker });
      return { status: worker === 'ok' ? ('ok' as const) : ('degraded' as const), database, redis, worker };
    },
  );
};
