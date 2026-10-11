import {
  assignMpPayment,
  cancelPointOrder,
  chargeSaleWithPoint,
  connectMpAccount,
  disconnectMpAccount,
  getMpAccount,
  getPointOrder,
  listMpInbox,
  listPaymentRefunds,
  listSaleOrders,
  listTerminals,
  refundPayment,
  runIdempotent,
  setTerminalPdvMode,
  syncTerminals,
  updateTerminal,
} from '@estoicos/core';
import {
  assignPaymentBody,
  chargeWithPointBody,
  connectMpBody,
  mpAccountSchema,
  mpInboxItemSchema,
  mpInboxQuery,
  mpOrderIdParams,
  mpOrderSchema,
  mpPaymentIdParams,
  mpPaymentSchema,
  mpTerminalSchema,
  okSchema,
  paymentIdParams,
  refundPaymentBody,
  refundSchema,
  saleIdParams,
  terminalIdParams,
  updateTerminalBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

/** Cuenta, terminales, cobro con Point, conciliación y reintegros. */
export const mercadoPagoRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const connect = { policy: { kind: 'staff', permission: 'mercadopago:connect' } } as const;
  const reconcile = { policy: { kind: 'staff', permission: 'mercadopago:reconcile' } } as const;
  const charge = { policy: { kind: 'staff', permission: 'sales:charge' } } as const;
  const terminalList = { 200: z.array(mpTerminalSchema) };

  // --- Cuenta ---
  app.get(
    '/v1/mercadopago/account',
    { config: reconcile, schema: { response: { 200: z.object({ account: mpAccountSchema.nullable() }) } } },
    async (request) => ({ account: await getMpAccount(deps, request.staff!) }),
  );
  app.post(
    '/v1/mercadopago/account',
    { config: connect, schema: { body: connectMpBody, response: { 201: mpAccountSchema } } },
    async (request, reply) =>
      reply.code(201).send(await connectMpAccount(deps, request.staff!, request.body, request.meta)),
  );
  app.delete(
    '/v1/mercadopago/account',
    { config: connect, schema: { response: { 200: okSchema } } },
    async (request) => disconnectMpAccount(deps, request.staff!, request.meta),
  );

  // --- Terminales ---
  app.get(
    '/v1/mercadopago/terminals',
    { config: reconcile, schema: { response: terminalList } },
    async (request) => listTerminals(deps, request.staff!),
  );
  app.post(
    '/v1/mercadopago/terminals/sync',
    { config: connect, schema: { response: terminalList } },
    async (request) => syncTerminals(deps, request.staff!),
  );
  app.patch(
    '/v1/mercadopago/terminals/:terminalId',
    {
      config: connect,
      schema: { params: terminalIdParams, body: updateTerminalBody, response: terminalList },
    },
    async (request) =>
      updateTerminal(deps, request.staff!, request.params.terminalId, request.body, request.meta),
  );
  app.post(
    '/v1/mercadopago/terminals/:terminalId/mode',
    {
      config: connect,
      schema: {
        params: terminalIdParams,
        body: z.object({ mode: z.enum(['PDV', 'STANDALONE']) }),
        response: terminalList,
      },
    },
    async (request) => setTerminalPdvMode(deps, request.staff!, request.params.terminalId, request.body.mode),
  );

  // --- Cobro con Point ---
  app.get(
    '/v1/sales/:saleId/point-orders',
    { config: charge, schema: { params: saleIdParams, response: { 200: z.array(mpOrderSchema) } } },
    async (request) => listSaleOrders(deps, request.staff!, request.params.saleId),
  );
  app.post(
    '/v1/sales/:saleId/point-orders',
    {
      config: { ...charge, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: saleIdParams, body: chargeWithPointBody, response: { 201: mpOrderSchema } },
    },
    async (request, reply) => {
      const key = request.headers['idempotency-key'];
      const order = await runIdempotent(
        deps.db,
        {
          scope: `staff:${request.staff!.userId}:POST /v1/sales/${request.params.saleId}/point-orders`,
          key: typeof key === 'string' && key ? key : undefined,
          request: request.body,
          now: deps.now(),
        },
        () => chargeSaleWithPoint(deps, request.staff!, request.params.saleId, request.body),
      );
      return reply.code(201).send(order);
    },
  );
  app.get(
    '/v1/point-orders/:orderId',
    {
      config: { ...charge, rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: { params: mpOrderIdParams, response: { 200: mpOrderSchema } },
    },
    async (request) => getPointOrder(deps, request.staff!, request.params.orderId),
  );
  app.post(
    '/v1/point-orders/:orderId/cancel',
    { config: charge, schema: { params: mpOrderIdParams, response: { 200: mpOrderSchema } } },
    async (request) => cancelPointOrder(deps, request.staff!, request.params.orderId),
  );

  // --- Conciliación ---
  app.get(
    '/v1/mercadopago/payments',
    {
      config: reconcile,
      schema: { querystring: mpInboxQuery, response: { 200: z.array(mpInboxItemSchema) } },
    },
    async (request) => listMpInbox(deps, request.staff!, request.query),
  );
  app.post(
    '/v1/mercadopago/payments/:mpPaymentId/assign',
    {
      config: reconcile,
      schema: { params: mpPaymentIdParams, body: assignPaymentBody, response: { 200: mpPaymentSchema } },
    },
    async (request) =>
      assignMpPayment(deps, request.staff!, request.params.mpPaymentId, request.body, request.meta),
  );

  // --- Reintegros (solo el dueño) ---
  app.get(
    '/v1/payments/:paymentId/refunds',
    { config: charge, schema: { params: paymentIdParams, response: { 200: z.array(refundSchema) } } },
    async (request) => listPaymentRefunds(deps, request.staff!, request.params.paymentId),
  );
  app.post(
    '/v1/payments/:paymentId/refunds',
    {
      config: { policy: { kind: 'staff', permission: 'payments:refund' } },
      schema: { params: paymentIdParams, body: refundPaymentBody, response: { 201: refundSchema } },
    },
    async (request, reply) => {
      const key = request.headers['idempotency-key'];
      const refund = await runIdempotent(
        deps.db,
        {
          scope: `staff:${request.staff!.userId}:POST /v1/payments/${request.params.paymentId}/refunds`,
          key: typeof key === 'string' && key ? key : undefined,
          request: request.body,
          now: deps.now(),
        },
        () => refundPayment(deps, request.staff!, request.params.paymentId, request.body, request.meta),
      );
      return reply.code(201).send(refund);
    },
  );
};
