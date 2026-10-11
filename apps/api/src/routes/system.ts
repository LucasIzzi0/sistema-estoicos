import { acknowledgeAlert, getSystemHealth } from '@estoicos/core';
import { getQueueCounts } from '@estoicos/queue';
import { alertIdParams, okSchema, systemHealthSchema } from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../app';

export const systemRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;

  /** Estado del sistema para el widget del dashboard (worker, colas y alertas abiertas). */
  app.get(
    '/v1/system/health',
    {
      config: { policy: { kind: 'staff', permission: 'system:health' } },
      schema: { response: { 200: systemHealthSchema } },
    },
    async (request) => {
      const queues = await Promise.all(ctx.queues.map((q) => getQueueCounts(q))).catch(() => []);
      return getSystemHealth(deps, request.staff!, queues);
    },
  );

  app.post(
    '/v1/system/alerts/:alertId/ack',
    {
      config: { policy: { kind: 'staff', permission: 'system:alerts:ack' } },
      schema: { params: alertIdParams, response: { 200: okSchema } },
    },
    async (request) => {
      await acknowledgeAlert(deps, request.staff!, request.params.alertId);
      return { ok: true as const };
    },
  );
};
