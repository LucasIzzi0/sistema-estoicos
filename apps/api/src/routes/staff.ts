import { inviteStaff, listStaff, updateStaffMember } from '@estoicos/core';
import { inviteStaffBody, membershipIdParams, staffMemberSchema, updateStaffBody } from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

export const staffRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;

  app.get(
    '/v1/staff',
    {
      config: { policy: { kind: 'staff', permission: 'staff:read' } },
      schema: { response: { 200: z.array(staffMemberSchema) } },
    },
    async (request) => listStaff(deps, request.staff!),
  );

  app.post(
    '/v1/staff/invitations',
    {
      config: { policy: { kind: 'staff', permission: 'staff:invite' } },
      schema: { body: inviteStaffBody, response: { 201: staffMemberSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await inviteStaff(deps, request.staff!, request.body, request.meta)),
  );

  app.patch(
    '/v1/staff/:membershipId',
    {
      config: { policy: { kind: 'staff', permission: 'staff:update' } },
      schema: { params: membershipIdParams, body: updateStaffBody, response: { 200: staffMemberSchema } },
    },
    async (request) =>
      updateStaffMember(deps, request.staff!, request.params.membershipId, request.body, request.meta),
  );
};
