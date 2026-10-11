import {
  acceptInvitation,
  confirmPasswordReset,
  getInvitation,
  getStaffMe,
  loadStaffPrincipal,
  loginStaff,
  requestPasswordReset,
  resolveSession,
  revokeSessionByToken,
  verifyStaffSecondFactor,
} from '@estoicos/core';
import {
  acceptInvitationBody,
  invitationInfoSchema,
  invitationTokenParams,
  okSchema,
  passwordResetConfirmBody,
  passwordResetRequestBody,
  STAFF_AUTH,
  staffLoginBody,
  staffLoginResponse,
  staffMeSchema,
  staffSecondFactorBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';
import { clearSessionCookie, setSessionCookie } from './cookies';

export const staffAuthRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps, config } = ctx;
  const cookieName = config.cookieNames.staff;

  async function meFromToken(token: string) {
    const session = await resolveSession(deps.db, token, 'STAFF', STAFF_AUTH.sessionDays, deps.now());
    const principal = session ? await loadStaffPrincipal(deps.db, session) : null;
    return principal ? getStaffMe(deps.db, principal) : null;
  }

  app.post(
    '/v1/auth/staff/login',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 20, timeWindow: '15 minutes' } },
      schema: { body: staffLoginBody, response: { 200: staffLoginResponse } },
    },
    async (request, reply) => {
      const result = await loginStaff(deps, {
        organization: await ctx.getOrganization(),
        email: request.body.email,
        password: request.body.password,
        meta: request.meta,
      });
      setSessionCookie(reply, config, cookieName, result.token, STAFF_AUTH.sessionDays);
      return {
        requiresSecondFactor: result.requiresSecondFactor,
        me: result.requiresSecondFactor ? null : await meFromToken(result.token),
      };
    },
  );

  app.post(
    '/v1/auth/staff/second-factor',
    {
      config: {
        policy: { kind: 'staff', allowPendingSecondFactor: true },
        rateLimit: { max: 30, timeWindow: '1 hour' },
      },
      schema: { body: staffSecondFactorBody, response: { 200: staffMeSchema } },
    },
    async (request) => {
      await verifyStaffSecondFactor(deps, request.staff!, request.body.code);
      return getStaffMe(deps.db, { ...request.staff!, secondFactorPending: false });
    },
  );

  app.post(
    '/v1/auth/staff/logout',
    { config: { policy: { kind: 'public' } }, schema: { response: { 200: okSchema } } },
    async (request, reply) => {
      const token = request.cookies[cookieName];
      if (token) await revokeSessionByToken(deps.db, token, deps.now());
      clearSessionCookie(reply, config, cookieName);
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/me/staff',
    { config: { policy: { kind: 'staff' } }, schema: { response: { 200: staffMeSchema } } },
    async (request) => getStaffMe(deps.db, request.staff!),
  );

  app.post(
    '/v1/auth/staff/password-reset/request',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { body: passwordResetRequestBody, response: { 202: z.object({ message: z.string() }) } },
    },
    async (request, reply) => {
      await requestPasswordReset(deps, {
        organization: await ctx.getOrganization(),
        email: request.body.email,
        meta: request.meta,
      });
      return reply
        .code(202)
        .send({ message: 'Si el email está registrado, te enviamos un link para cambiar la contraseña.' });
    },
  );

  app.post(
    '/v1/auth/staff/password-reset/confirm',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { body: passwordResetConfirmBody, response: { 200: okSchema } },
    },
    async (request) => {
      await confirmPasswordReset(deps, { ...request.body, meta: request.meta });
      return { ok: true as const };
    },
  );

  app.get(
    '/v1/auth/staff/invitations/:token',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: { params: invitationTokenParams, response: { 200: invitationInfoSchema } },
    },
    async (request) => {
      const { email, name, organizationName, role } = await getInvitation(deps, request.params.token);
      return { email, name, organizationName, role };
    },
  );

  app.post(
    '/v1/auth/staff/invitations/accept',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: { body: acceptInvitationBody, response: { 200: staffMeSchema } },
    },
    async (request, reply) => {
      const { token } = await acceptInvitation(deps, { ...request.body, meta: request.meta });
      setSessionCookie(reply, config, cookieName, token, STAFF_AUTH.sessionDays);
      const me = await meFromToken(token);
      if (!me) throw new Error('No se pudo abrir la sesión después de aceptar la invitación');
      return me;
    },
  );
};
