import {
  createBarber,
  createTimeOff,
  deleteTimeOff,
  getBarber,
  listBarbers,
  setBarberSchedule,
  setBarberServices,
  updateBarber,
} from '@estoicos/core';
import {
  barberDetailSchema,
  barberIdParams,
  barberSummarySchema,
  createBarberBody,
  createTimeOffBody,
  setBarberScheduleBody,
  setBarberServicesBody,
  timeOffIdParams,
  updateBarberBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

export const barberRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const read = { policy: { kind: 'staff', permission: 'barbers:read' } } as const;
  const manage = { policy: { kind: 'staff', permission: 'barbers:manage' } } as const;
  const detail = { 200: barberDetailSchema };

  app.get(
    '/v1/barbers',
    {
      config: read,
      schema: {
        querystring: z.object({ includeInactive: z.coerce.boolean().default(false) }),
        response: { 200: z.array(barberSummarySchema) },
      },
    },
    async (request) => listBarbers(deps, request.staff!, request.query),
  );
  app.post(
    '/v1/barbers',
    { config: manage, schema: { body: createBarberBody, response: { 201: barberDetailSchema } } },
    async (request, reply) =>
      reply.code(201).send(await createBarber(deps, request.staff!, request.body, request.meta)),
  );
  app.get(
    '/v1/barbers/:barberId',
    { config: read, schema: { params: barberIdParams, response: detail } },
    async (request) => getBarber(deps, request.staff!, request.params.barberId),
  );
  app.patch(
    '/v1/barbers/:barberId',
    { config: manage, schema: { params: barberIdParams, body: updateBarberBody, response: detail } },
    async (request) =>
      updateBarber(deps, request.staff!, request.params.barberId, request.body, request.meta),
  );
  app.put(
    '/v1/barbers/:barberId/services',
    { config: manage, schema: { params: barberIdParams, body: setBarberServicesBody, response: detail } },
    async (request) =>
      setBarberServices(deps, request.staff!, request.params.barberId, request.body, request.meta),
  );
  app.put(
    '/v1/barbers/:barberId/schedule',
    { config: manage, schema: { params: barberIdParams, body: setBarberScheduleBody, response: detail } },
    async (request) => setBarberSchedule(deps, request.staff!, request.params.barberId, request.body),
  );
  app.post(
    '/v1/barbers/:barberId/time-offs',
    {
      config: manage,
      schema: { params: barberIdParams, body: createTimeOffBody, response: { 201: barberDetailSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await createTimeOff(deps, request.staff!, request.params.barberId, request.body)),
  );
  app.delete(
    '/v1/barbers/:barberId/time-offs/:timeOffId',
    { config: manage, schema: { params: timeOffIdParams, response: detail } },
    async (request) => deleteTimeOff(deps, request.staff!, request.params.barberId, request.params.timeOffId),
  );
};
