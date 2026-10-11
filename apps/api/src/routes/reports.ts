import { exportCsv, getDashboard, getReport } from '@estoicos/core';
import {
  dashboardQuery,
  dashboardSchema,
  exportParams,
  reportQuery,
  reportSchema,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../app';

/**
 * Dashboard, reportes y export (Fase 8). Ver números exige `reports:view`; bajar planillas,
 * `reports:export`, que solo tiene el dueño. Cada export queda auditado.
 */
export const reportRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;

  app.get(
    '/v1/dashboard',
    {
      config: { policy: { kind: 'staff', permission: 'dashboard:view' } },
      schema: { querystring: dashboardQuery, response: { 200: dashboardSchema } },
    },
    async (request) => getDashboard(deps, request.staff!, request.query),
  );

  app.get(
    '/v1/reports',
    {
      config: { policy: { kind: 'staff', permission: 'reports:view' } },
      schema: { querystring: reportQuery, response: { 200: reportSchema } },
    },
    async (request) => getReport(deps, request.staff!, request.query),
  );

  app.get(
    '/v1/reports/export/:kind',
    {
      config: { policy: { kind: 'staff', permission: 'reports:export' } },
      schema: { params: exportParams, querystring: reportQuery },
    },
    async (request, reply) => {
      const { fileName, csv } = await exportCsv(
        deps,
        request.staff!,
        request.params.kind,
        request.query,
        request.meta,
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .send(csv);
    },
  );
};
