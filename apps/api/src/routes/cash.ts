import {
  addCashMovement,
  closeCashSession,
  getCashSession,
  getCurrentCashSession,
  listCashSessions,
  openCashSession,
  voidCashMovement,
} from '@estoicos/core';
import {
  branchIdParams,
  cashMovementBody,
  cashSessionIdParams,
  cashSessionListItemSchema,
  cashSessionListQuery,
  cashSessionSchema,
  closeCashBody,
  openCashBody,
  voidReasonBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

/** Caja diaria: recepción abre; aportes, retiros y cierre con arqueo son del dueño o el encargado. */
export const cashRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const open = { policy: { kind: 'staff', permission: 'cash:open' } } as const;
  const close = { policy: { kind: 'staff', permission: 'cash:close' } } as const;
  const detail = { 200: cashSessionSchema };

  app.get(
    '/v1/branches/:branchId/cash/current',
    {
      config: { policy: { kind: 'staff', permission: 'cash:open', branchParam: 'branchId' } },
      schema: {
        params: branchIdParams,
        response: { 200: z.object({ session: cashSessionSchema.nullable() }) },
      },
    },
    async (request) => ({
      session: await getCurrentCashSession(deps, request.staff!, request.params.branchId),
    }),
  );
  app.post(
    '/v1/branches/:branchId/cash',
    {
      config: { policy: { kind: 'staff', permission: 'cash:open', branchParam: 'branchId' } },
      schema: { params: branchIdParams, body: openCashBody, response: { 201: cashSessionSchema } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await openCashSession(deps, request.staff!, request.params.branchId, request.body, request.meta),
        ),
  );
  app.get(
    '/v1/branches/:branchId/cash/sessions',
    {
      config: { policy: { kind: 'staff', permission: 'cash:close', branchParam: 'branchId' } },
      schema: {
        params: branchIdParams,
        querystring: cashSessionListQuery,
        response: { 200: z.array(cashSessionListItemSchema) },
      },
    },
    async (request) => listCashSessions(deps, request.staff!, request.params.branchId, request.query),
  );
  app.get(
    '/v1/cash/:sessionId',
    { config: open, schema: { params: cashSessionIdParams, response: detail } },
    async (request) => getCashSession(deps, request.staff!, request.params.sessionId),
  );
  app.post(
    '/v1/cash/:sessionId/movements',
    { config: close, schema: { params: cashSessionIdParams, body: cashMovementBody, response: detail } },
    async (request) => addCashMovement(deps, request.staff!, request.params.sessionId, request.body),
  );
  app.post(
    '/v1/cash/:sessionId/movements/:movementId/void',
    {
      config: close,
      schema: {
        params: cashSessionIdParams.extend({ movementId: z.uuid() }),
        body: voidReasonBody,
        response: detail,
      },
    },
    async (request) =>
      voidCashMovement(
        deps,
        request.staff!,
        request.params.sessionId,
        request.params.movementId,
        request.body,
        request.meta,
      ),
  );
  app.post(
    '/v1/cash/:sessionId/close',
    { config: close, schema: { params: cashSessionIdParams, body: closeCashBody, response: detail } },
    async (request) =>
      closeCashSession(deps, request.staff!, request.params.sessionId, request.body, request.meta),
  );
};
