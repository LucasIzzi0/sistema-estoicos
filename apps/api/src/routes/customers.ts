import {
  addCustomerNote,
  createCustomer,
  deleteCustomerNote,
  mergeCustomers,
  getCustomerDetail,
  searchCustomers,
  updateCustomer,
  updateCustomerNote,
} from '@estoicos/core';
import {
  createCustomerBody,
  customerDetailSchema,
  customerIdParams,
  customerListItemSchema,
  customerNoteBody,
  customerSearchQuery,
  mergeCustomerBody,
  noteIdParams,
  updateCustomerBody,
  updateNoteBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

export const customerRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const detail = { 200: customerDetailSchema };
  const update = { policy: { kind: 'staff', permission: 'customers:update' } } as const;

  app.get(
    '/v1/customers',
    {
      config: { policy: { kind: 'staff', permission: 'customers:read' } },
      schema: { querystring: customerSearchQuery, response: { 200: z.array(customerListItemSchema) } },
    },
    async (request) => searchCustomers(deps, request.staff!, request.query),
  );
  app.post(
    '/v1/customers',
    {
      config: { policy: { kind: 'staff', permission: 'customers:create' } },
      schema: { body: createCustomerBody, response: { 201: customerDetailSchema } },
    },
    async (request, reply) =>
      reply.code(201).send(await createCustomer(deps, request.staff!, request.body, request.meta)),
  );
  app.get(
    '/v1/customers/:customerId',
    {
      config: { policy: { kind: 'staff', permission: 'customers:read' } },
      schema: { params: customerIdParams, response: detail },
    },
    async (request) => getCustomerDetail(deps, request.staff!, request.params.customerId),
  );
  app.patch(
    '/v1/customers/:customerId',
    { config: update, schema: { params: customerIdParams, body: updateCustomerBody, response: detail } },
    async (request) =>
      updateCustomer(deps, request.staff!, request.params.customerId, request.body, request.meta),
  );
  app.post(
    '/v1/customers/:customerId/merge',
    {
      config: { policy: { kind: 'staff', permission: 'customers:merge' } },
      schema: { params: customerIdParams, body: mergeCustomerBody, response: detail },
    },
    async (request) =>
      mergeCustomers(deps, request.staff!, request.params.customerId, request.body, request.meta),
  );
  app.post(
    '/v1/customers/:customerId/notes',
    {
      config: update,
      schema: { params: customerIdParams, body: customerNoteBody, response: { 201: customerDetailSchema } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await addCustomerNote(deps, request.staff!, request.params.customerId, request.body)),
  );
  app.patch(
    '/v1/customers/:customerId/notes/:noteId',
    { config: update, schema: { params: noteIdParams, body: updateNoteBody, response: detail } },
    async (request) =>
      updateCustomerNote(
        deps,
        request.staff!,
        request.params.customerId,
        request.params.noteId,
        request.body,
      ),
  );
  app.delete(
    '/v1/customers/:customerId/notes/:noteId',
    { config: update, schema: { params: noteIdParams, response: detail } },
    async (request) =>
      deleteCustomerNote(deps, request.staff!, request.params.customerId, request.params.noteId),
  );
};
