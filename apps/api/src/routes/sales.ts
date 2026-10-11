import {
  addSaleItem,
  createCounterSale,
  getSale,
  listSales,
  openSaleFromAppointment,
  paySale,
  removeSaleItem,
  runIdempotent,
  setSaleCustomer,
  updateSaleItem,
  voidSale,
} from '@estoicos/core';
import {
  addSaleItemBody,
  appointmentIdParams,
  branchIdParams,
  createSaleBody,
  paySaleBody,
  saleDetailSchema,
  saleIdParams,
  saleItemParams,
  saleListItemSchema,
  saleListQuery,
  setSaleCustomerBody,
  updateSaleItemBody,
  voidSaleBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

/**
 * Ventas y cobros. Cobrar y anular aceptan el header Idempotency-Key: el mismo pedido repetido
 * (doble clic, reintento de red) devuelve la misma respuesta sin cobrar dos veces.
 */
export const saleRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const charge = { policy: { kind: 'staff', permission: 'sales:charge' } } as const;
  const detail = { 200: saleDetailSchema };
  const idempotencyKey = (headers: Record<string, unknown>) => {
    const value = headers['idempotency-key'];
    return typeof value === 'string' && value ? value : undefined;
  };

  app.get(
    '/v1/branches/:branchId/sales',
    {
      config: { policy: { kind: 'staff', permission: 'sales:charge', branchParam: 'branchId' } },
      schema: {
        params: branchIdParams,
        querystring: saleListQuery,
        response: { 200: z.array(saleListItemSchema) },
      },
    },
    async (request) => listSales(deps, request.staff!, request.params.branchId, request.query),
  );
  app.post(
    '/v1/branches/:branchId/sales',
    {
      config: { policy: { kind: 'staff', permission: 'sales:charge', branchParam: 'branchId' } },
      schema: { params: branchIdParams, body: createSaleBody, response: { 201: saleDetailSchema } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await createCounterSale(deps, request.staff!, request.params.branchId, request.body)),
  );
  app.post(
    '/v1/appointments/:appointmentId/sale',
    { config: charge, schema: { params: appointmentIdParams, response: detail } },
    async (request) => openSaleFromAppointment(deps, request.staff!, request.params.appointmentId),
  );
  app.get(
    '/v1/sales/:saleId',
    { config: charge, schema: { params: saleIdParams, response: detail } },
    async (request) => getSale(deps, request.staff!, request.params.saleId),
  );
  app.put(
    '/v1/sales/:saleId/customer',
    { config: charge, schema: { params: saleIdParams, body: setSaleCustomerBody, response: detail } },
    async (request) => setSaleCustomer(deps, request.staff!, request.params.saleId, request.body),
  );
  app.post(
    '/v1/sales/:saleId/items',
    { config: charge, schema: { params: saleIdParams, body: addSaleItemBody, response: detail } },
    async (request) => addSaleItem(deps, request.staff!, request.params.saleId, request.body),
  );
  app.patch(
    '/v1/sales/:saleId/items/:itemId',
    { config: charge, schema: { params: saleItemParams, body: updateSaleItemBody, response: detail } },
    async (request) =>
      updateSaleItem(
        deps,
        request.staff!,
        request.params.saleId,
        request.params.itemId,
        request.body,
        request.meta,
      ),
  );
  app.delete(
    '/v1/sales/:saleId/items/:itemId',
    { config: charge, schema: { params: saleItemParams, response: detail } },
    async (request) => removeSaleItem(deps, request.staff!, request.params.saleId, request.params.itemId),
  );
  app.post(
    '/v1/sales/:saleId/pay',
    {
      config: { ...charge, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: saleIdParams, body: paySaleBody, response: detail },
    },
    async (request) =>
      runIdempotent(
        deps.db,
        {
          scope: `staff:${request.staff!.userId}:POST /v1/sales/${request.params.saleId}/pay`,
          key: idempotencyKey(request.headers),
          request: request.body,
          now: deps.now(),
        },
        () => paySale(deps, request.staff!, request.params.saleId, request.body),
      ),
  );
  app.post(
    '/v1/sales/:saleId/void',
    {
      config: { policy: { kind: 'staff', permission: 'sales:void' } },
      schema: { params: saleIdParams, body: voidSaleBody, response: detail },
    },
    async (request) =>
      runIdempotent(
        deps.db,
        {
          scope: `staff:${request.staff!.userId}:POST /v1/sales/${request.params.saleId}/void`,
          key: idempotencyKey(request.headers),
          request: request.body,
          now: deps.now(),
        },
        () => voidSale(deps, request.staff!, request.params.saleId, request.body, request.meta),
      ),
  );
};
