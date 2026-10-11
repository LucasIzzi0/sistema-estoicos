import {
  cancelByToken,
  confirmByToken,
  getNotificationSettings,
  listNotifications,
  unsubscribeByToken,
  updateNotificationSettings,
  updateNotificationType,
} from '@estoicos/core';
import {
  appointmentActionQuery,
  appointmentActionResultSchema,
  appointmentIdParams,
  notificationLogItemSchema,
  notificationLogQuery,
  notificationSettingsSchema,
  notificationTypeParams,
  okSchema,
  unsubscribeQuery,
  updateNotificationSettingsBody,
  updateNotificationTypeBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

/**
 * Notificaciones: configuración, registro de envíos y las acciones que el cliente hace desde
 * el recordatorio (confirmar, cancelar, darse de baja) **sin iniciar sesión**: alcanza con el
 * token firmado de ese turno, que no da acceso a ninguna otra cosa.
 */
export const notificationRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const settings = { policy: { kind: 'staff', permission: 'notifications:settings' } } as const;

  app.get(
    '/v1/notifications/settings',
    { config: settings, schema: { response: { 200: notificationSettingsSchema } } },
    async (request) => getNotificationSettings(deps, request.staff!),
  );
  app.patch(
    '/v1/notifications/settings',
    {
      config: settings,
      schema: { body: updateNotificationSettingsBody, response: { 200: notificationSettingsSchema } },
    },
    async (request) => updateNotificationSettings(deps, request.staff!, request.body, request.meta),
  );
  app.patch(
    '/v1/notifications/types/:type',
    {
      config: settings,
      schema: {
        params: notificationTypeParams,
        body: updateNotificationTypeBody,
        response: { 200: notificationSettingsSchema },
      },
    },
    async (request) => updateNotificationType(deps, request.staff!, request.params.type, request.body),
  );
  app.get(
    '/v1/notifications',
    {
      config: settings,
      schema: { querystring: notificationLogQuery, response: { 200: z.array(notificationLogItemSchema) } },
    },
    async (request) => listNotifications(deps, request.staff!, request.query),
  );

  // --- Acciones del cliente desde el recordatorio (sin login) ---
  const publicAction = {
    policy: { kind: 'public' },
    rateLimit: { max: 30, timeWindow: '1 hour' },
  } as const;

  app.post(
    '/v1/public/appointments/:appointmentId/confirm',
    {
      config: publicAction,
      schema: {
        params: appointmentIdParams,
        querystring: appointmentActionQuery,
        response: { 200: appointmentActionResultSchema },
      },
    },
    async (request) =>
      confirmByToken(deps, { appointmentId: request.params.appointmentId, token: request.query.t }),
  );
  app.post(
    '/v1/public/appointments/:appointmentId/cancel',
    {
      config: publicAction,
      schema: {
        params: appointmentIdParams,
        querystring: appointmentActionQuery,
        response: { 200: z.object({ alreadyCanceled: z.boolean() }) },
      },
    },
    async (request) =>
      cancelByToken(deps, { appointmentId: request.params.appointmentId, token: request.query.t }),
  );
  app.post(
    '/v1/public/unsubscribe',
    {
      config: publicAction,
      schema: { querystring: unsubscribeQuery, response: { 200: okSchema, 404: okSchema } },
    },
    async (request, reply) => {
      const done = await unsubscribeByToken(deps, request.query.c, request.query.t);
      // La respuesta es la misma haya o no cliente: no se revela quién está registrado.
      return reply.code(done ? 200 : 404).send({ ok: true as const });
    },
  );
};
