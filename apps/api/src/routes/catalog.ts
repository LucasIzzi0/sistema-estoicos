import {
  bulkUpdatePrices,
  createProduct,
  createService,
  listCategories,
  listProducts,
  listServices,
  saveCategory,
  setBranchProduct,
  setBranchService,
  updateProduct,
  updateService,
} from '@estoicos/core';
import {
  branchProductParams,
  branchServiceParams,
  bulkPriceBody,
  bulkPriceResult,
  categoryBody,
  categoryIdParams,
  categorySchema,
  createProductBody,
  createServiceBody,
  productIdParams,
  productSchema,
  serviceIdParams,
  serviceSchema,
  setBranchProductBody,
  setBranchServiceBody,
  updateProductBody,
  updateServiceBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

const listQuery = z.object({ includeArchived: z.coerce.boolean().default(false) });

export const catalogRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const read = { policy: { kind: 'staff', permission: 'catalog:read' } } as const;
  const manage = { policy: { kind: 'staff', permission: 'catalog:manage' } } as const;
  const branchPrices = {
    policy: { kind: 'staff', permission: 'catalog:branch-prices', branchParam: 'branchId' },
  } as const;

  for (const kind of ['service', 'product'] as const) {
    const base = `/v1/${kind}-categories`;
    app.get(base, { config: read, schema: { response: { 200: z.array(categorySchema) } } }, async (request) =>
      listCategories(deps, request.staff!, kind),
    );
    app.post(
      base,
      { config: manage, schema: { body: categoryBody, response: { 201: categorySchema } } },
      async (request, reply) =>
        reply.code(201).send(await saveCategory(deps, request.staff!, kind, request.body)),
    );
    app.patch(
      `${base}/:categoryId`,
      {
        config: manage,
        schema: { params: categoryIdParams, body: categoryBody.partial(), response: { 200: categorySchema } },
      },
      async (request) => saveCategory(deps, request.staff!, kind, request.body, request.params.categoryId),
    );
  }

  // Servicios
  app.get(
    '/v1/services',
    { config: read, schema: { querystring: listQuery, response: { 200: z.array(serviceSchema) } } },
    async (request) => listServices(deps, request.staff!, request.query),
  );
  app.post(
    '/v1/services',
    { config: manage, schema: { body: createServiceBody, response: { 201: serviceSchema } } },
    async (request, reply) => reply.code(201).send(await createService(deps, request.staff!, request.body)),
  );
  app.patch(
    '/v1/services/:serviceId',
    {
      config: manage,
      schema: { params: serviceIdParams, body: updateServiceBody, response: { 200: serviceSchema } },
    },
    async (request) =>
      updateService(deps, request.staff!, request.params.serviceId, request.body, request.meta),
  );
  app.post(
    '/v1/services/bulk-price',
    { config: manage, schema: { body: bulkPriceBody, response: { 200: bulkPriceResult } } },
    async (request) => bulkUpdatePrices(deps, request.staff!, 'service', request.body, request.meta),
  );
  app.put(
    '/v1/branches/:branchId/services/:serviceId',
    {
      config: branchPrices,
      schema: { params: branchServiceParams, body: setBranchServiceBody, response: { 200: serviceSchema } },
    },
    async (request) =>
      setBranchService(
        deps,
        request.staff!,
        request.params.branchId,
        request.params.serviceId,
        request.body,
        request.meta,
      ),
  );

  // Productos
  app.get(
    '/v1/products',
    { config: read, schema: { querystring: listQuery, response: { 200: z.array(productSchema) } } },
    async (request) => listProducts(deps, request.staff!, request.query),
  );
  app.post(
    '/v1/products',
    { config: manage, schema: { body: createProductBody, response: { 201: productSchema } } },
    async (request, reply) => reply.code(201).send(await createProduct(deps, request.staff!, request.body)),
  );
  app.patch(
    '/v1/products/:productId',
    {
      config: manage,
      schema: { params: productIdParams, body: updateProductBody, response: { 200: productSchema } },
    },
    async (request) =>
      updateProduct(deps, request.staff!, request.params.productId, request.body, request.meta),
  );
  app.post(
    '/v1/products/bulk-price',
    { config: manage, schema: { body: bulkPriceBody, response: { 200: bulkPriceResult } } },
    async (request) => bulkUpdatePrices(deps, request.staff!, 'product', request.body, request.meta),
  );
  app.put(
    '/v1/branches/:branchId/products/:productId',
    {
      config: branchPrices,
      schema: { params: branchProductParams, body: setBranchProductBody, response: { 200: productSchema } },
    },
    async (request) =>
      setBranchProduct(
        deps,
        request.staff!,
        request.params.branchId,
        request.params.productId,
        request.body,
        request.meta,
      ),
  );
};
