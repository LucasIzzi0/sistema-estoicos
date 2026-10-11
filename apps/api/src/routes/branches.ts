import {
  createBranch,
  createClosure,
  deleteClosure,
  Errors,
  listBranchDetails,
  listClosures,
  updateBranch,
} from '@estoicos/core';
import {
  branchDetailSchema,
  branchIdParams,
  closureIdParams,
  closureSchema,
  createBranchBody,
  createClosureBody,
  updateBranchBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

export const branchRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;

  /** Sucursales a las que accede el usuario (selector del panel y configuración). */
  app.get(
    '/v1/branches',
    {
      config: { policy: { kind: 'staff', permission: 'branch:read' } },
      schema: { response: { 200: z.array(branchDetailSchema) } },
    },
    async (request) => listBranchDetails(deps, request.staff!),
  );

  app.get(
    '/v1/branches/:branchId',
    {
      config: { policy: { kind: 'staff', permission: 'branch:read', branchParam: 'branchId' } },
      schema: { params: branchIdParams, response: { 200: branchDetailSchema } },
    },
    async (request) => {
      const branch = (await listBranchDetails(deps, request.staff!)).find(
        (b) => b.id === request.params.branchId,
      );
      if (!branch) throw Errors.notFound('No encontramos esa sucursal.');
      return branch;
    },
  );

  app.post(
    '/v1/branches',
    {
      config: { policy: { kind: 'staff', permission: 'branches:manage' } },
      schema: { body: createBranchBody, response: { 201: branchDetailSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await createBranch(deps, request.staff!, request.body, request.meta)),
  );

  app.patch(
    '/v1/branches/:branchId',
    {
      config: { policy: { kind: 'staff', permission: 'branches:manage', branchParam: 'branchId' } },
      schema: { params: branchIdParams, body: updateBranchBody, response: { 200: branchDetailSchema } },
    },
    async (request) =>
      updateBranch(deps, request.staff!, request.params.branchId, request.body, request.meta),
  );

  // Cierres (feriados)
  app.get(
    '/v1/branches/:branchId/closures',
    {
      config: { policy: { kind: 'staff', permission: 'branch:read', branchParam: 'branchId' } },
      schema: { params: branchIdParams, response: { 200: z.array(closureSchema) } },
    },
    async (request) => listClosures(deps, request.staff!, request.params.branchId),
  );
  app.post(
    '/v1/branches/:branchId/closures',
    {
      config: { policy: { kind: 'staff', permission: 'closures:manage', branchParam: 'branchId' } },
      schema: { params: branchIdParams, body: createClosureBody, response: { 201: z.array(closureSchema) } },
    },
    async (request, reply) =>
      reply.code(201).send(await createClosure(deps, request.staff!, request.params.branchId, request.body)),
  );
  app.delete(
    '/v1/branches/:branchId/closures/:closureId',
    {
      config: { policy: { kind: 'staff', permission: 'closures:manage', branchParam: 'branchId' } },
      schema: { params: closureIdParams, response: { 200: z.array(closureSchema) } },
    },
    async (request) => deleteClosure(deps, request.staff!, request.params.branchId, request.params.closureId),
  );
};
