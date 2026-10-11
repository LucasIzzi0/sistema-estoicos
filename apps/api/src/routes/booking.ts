import {
  bookAsCustomer,
  cancelMyAppointment,
  getPublicAvailability,
  getPublicBranch,
  getRescheduleAvailability,
  listPublicBranches,
  listMyAppointments,
  rescheduleMyAppointment,
} from '@estoicos/core';
import {
  appointmentIdParams,
  availabilityQuery,
  availabilitySchema,
  branchSlugParams,
  customerBookingBody,
  customerRescheduleBody,
  myAppointmentSchema,
  myAppointmentsSchema,
  publicBranchSchema,
  publicBranchSummarySchema,
  rescheduleAvailabilityQuery,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

/**
 * Reserva online. Ver sucursal y horarios es público (con rate limit por IP); reservar,
 * cancelar y reprogramar exigen la sesión del cliente (código por email).
 */
export const bookingRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const customer = { policy: { kind: 'customer' } } as const;

  app.get(
    '/v1/public/branches',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { response: { 200: z.array(publicBranchSummarySchema) } },
    },
    async () => listPublicBranches(deps, await ctx.getOrganization()),
  );
  app.get(
    '/v1/public/branches/:slug',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { params: branchSlugParams, response: { 200: publicBranchSchema } },
    },
    async (request) => getPublicBranch(deps, await ctx.getOrganization(), request.params.slug),
  );
  app.get(
    '/v1/public/branches/:slug/availability',
    {
      config: { policy: { kind: 'public' }, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: branchSlugParams,
        querystring: availabilityQuery,
        response: { 200: availabilitySchema },
      },
    },
    async (request) =>
      getPublicAvailability(deps, await ctx.getOrganization(), request.params.slug, request.query),
  );

  app.get(
    '/v1/me/appointments',
    { config: customer, schema: { response: { 200: myAppointmentsSchema } } },
    async (request) => listMyAppointments(deps, request.customer!),
  );
  app.post(
    '/v1/me/appointments',
    {
      config: { ...customer, rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: { body: customerBookingBody, response: { 201: myAppointmentSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await bookAsCustomer(deps, request.customer!, request.body)),
  );
  app.get(
    '/v1/me/appointments/:appointmentId/availability',
    {
      config: { ...customer, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: appointmentIdParams,
        querystring: rescheduleAvailabilityQuery,
        response: { 200: availabilitySchema },
      },
    },
    async (request) =>
      getRescheduleAvailability(deps, request.customer!, request.params.appointmentId, request.query),
  );
  app.post(
    '/v1/me/appointments/:appointmentId/cancel',
    { config: customer, schema: { params: appointmentIdParams, response: { 200: myAppointmentSchema } } },
    async (request) => cancelMyAppointment(deps, request.customer!, request.params.appointmentId),
  );
  app.post(
    '/v1/me/appointments/:appointmentId/reschedule',
    {
      config: { ...customer, rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        params: appointmentIdParams,
        body: customerRescheduleBody,
        response: { 200: myAppointmentSchema },
      },
    },
    async (request) =>
      rescheduleMyAppointment(deps, request.customer!, request.params.appointmentId, request.body),
  );
};
