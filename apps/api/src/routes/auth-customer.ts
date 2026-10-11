import {
  getCustomerMe,
  requestCustomerCode,
  revokeSessionByToken,
  updateCustomerProfile,
  verifyCustomerCode,
} from '@estoicos/core';
import {
  CUSTOMER_AUTH,
  customerMeSchema,
  customerProfileBody,
  customerRequestCodeBody,
  customerVerifyCodeBody,
  okSchema,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';
import { clearSessionCookie, setSessionCookie } from './cookies';

export const customerAuthRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps, config } = ctx;
  const cookieName = config.cookieNames.customer;

  app.post(
    '/v1/auth/customer/request-code',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        body: customerRequestCodeBody,
        response: { 202: z.object({ message: z.string() }) },
      },
    },
    async (request, reply) => {
      await requestCustomerCode(deps, {
        organization: await ctx.getOrganization(),
        email: request.body.email,
        meta: request.meta,
      });
      return reply.code(202).send({
        message: `Si el email es correcto, te llega un código de ${CUSTOMER_AUTH.codeLength} números. Vence en ${CUSTOMER_AUTH.codeTtlMinutes} minutos.`,
      });
    },
  );

  app.post(
    '/v1/auth/customer/verify-code',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: {
        body: customerVerifyCodeBody,
        response: { 200: z.object({ customer: customerMeSchema, isNew: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const result = await verifyCustomerCode(deps, {
        organization: await ctx.getOrganization(),
        email: request.body.email,
        code: request.body.code,
        meta: request.meta,
      });
      setSessionCookie(reply, config, cookieName, result.token, CUSTOMER_AUTH.sessionDays);
      return { customer: result.customer, isNew: result.isNew };
    },
  );

  app.post(
    '/v1/auth/customer/logout',
    { config: { policy: { kind: 'public' } }, schema: { response: { 200: okSchema } } },
    async (request, reply) => {
      const token = request.cookies[cookieName];
      if (token) await revokeSessionByToken(deps.db, token, deps.now());
      clearSessionCookie(reply, config, cookieName);
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/me/customer',
    { config: { policy: { kind: 'customer' } }, schema: { response: { 200: customerMeSchema } } },
    async (request) => getCustomerMe(deps, request.customer!.customerId),
  );

  app.put(
    '/v1/me/customer/profile',
    {
      config: { policy: { kind: 'customer' } },
      schema: { body: customerProfileBody, response: { 200: customerMeSchema } },
    },
    async (request) =>
      updateCustomerProfile(deps, {
        customerId: request.customer!.customerId,
        body: request.body,
        source: 'CUSTOMER_PORTAL',
        meta: request.meta,
      }),
  );
};
