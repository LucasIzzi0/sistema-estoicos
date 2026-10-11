import {
  cancelAppointment,
  changeAppointmentStatus,
  createStaffAppointment,
  createWalkIn,
  getAgenda,
  getAppointmentDetail,
  getStaffAvailability,
  updateAppointment,
} from '@estoicos/core';
import {
  agendaQuery,
  agendaSchema,
  appointmentDetailSchema,
  appointmentIdParams,
  appointmentStatusBody,
  availabilityQuery,
  availabilitySchema,
  branchIdParams,
  cancelAppointmentBody,
  createAppointmentBody,
  updateAppointmentBody,
  walkInBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppContext } from '../app';

/** Agenda del panel: dueño, encargado y recepción, siempre dentro de sus sucursales. */
export const agendaRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const read = { policy: { kind: 'staff', permission: 'agenda:read', branchParam: 'branchId' } } as const;
  const manageBranch = {
    policy: { kind: 'staff', permission: 'appointments:manage', branchParam: 'branchId' },
  } as const;
  const manage = { policy: { kind: 'staff', permission: 'appointments:manage' } } as const;
  const detail = { 200: appointmentDetailSchema };

  app.get(
    '/v1/branches/:branchId/agenda',
    {
      config: read,
      schema: { params: branchIdParams, querystring: agendaQuery, response: { 200: agendaSchema } },
    },
    async (request) => getAgenda(deps, request.staff!, request.params.branchId, request.query),
  );
  app.get(
    '/v1/branches/:branchId/availability',
    {
      config: read,
      schema: {
        params: branchIdParams,
        querystring: availabilityQuery,
        response: { 200: availabilitySchema },
      },
    },
    async (request) => getStaffAvailability(deps, request.staff!, request.params.branchId, request.query),
  );
  app.post(
    '/v1/branches/:branchId/appointments',
    {
      config: manageBranch,
      schema: {
        params: branchIdParams,
        body: createAppointmentBody,
        response: { 201: appointmentDetailSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await createStaffAppointment(deps, request.staff!, request.params.branchId, request.body)),
  );
  app.post(
    '/v1/branches/:branchId/walk-ins',
    {
      config: manageBranch,
      schema: { params: branchIdParams, body: walkInBody, response: { 201: appointmentDetailSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await createWalkIn(deps, request.staff!, request.params.branchId, request.body)),
  );

  app.get(
    '/v1/appointments/:appointmentId',
    {
      config: { policy: { kind: 'staff', permission: 'agenda:read' } },
      schema: { params: appointmentIdParams, response: detail },
    },
    async (request) => getAppointmentDetail(deps, request.staff!, request.params.appointmentId),
  );
  app.patch(
    '/v1/appointments/:appointmentId',
    {
      config: manage,
      schema: { params: appointmentIdParams, body: updateAppointmentBody, response: detail },
    },
    async (request) => updateAppointment(deps, request.staff!, request.params.appointmentId, request.body),
  );
  app.post(
    '/v1/appointments/:appointmentId/status',
    {
      config: manage,
      schema: { params: appointmentIdParams, body: appointmentStatusBody, response: detail },
    },
    async (request) =>
      changeAppointmentStatus(deps, request.staff!, request.params.appointmentId, request.body, request.meta),
  );
  app.post(
    '/v1/appointments/:appointmentId/cancel',
    {
      config: manage,
      schema: { params: appointmentIdParams, body: cancelAppointmentBody, response: detail },
    },
    async (request) => cancelAppointment(deps, request.staff!, request.params.appointmentId, request.body),
  );
};
