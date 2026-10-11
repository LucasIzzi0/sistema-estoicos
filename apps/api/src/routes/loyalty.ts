import {
  adjustPoints,
  archiveReward,
  getCustomerPoints,
  getLoyaltySettings,
  listRewards,
  myPoints,
  redeemReward,
  saleLoyalty,
  saveReward,
  undoRedemption,
  updateLoyaltySettings,
} from '@estoicos/core';
import {
  adjustPointsBody,
  customerIdParams,
  customerPointsSchema,
  loyaltySettingsSchema,
  myPointsSchema,
  redeemRewardBody,
  redemptionIdParams,
  rewardBody,
  rewardIdParams,
  rewardSchema,
  saleIdParams,
  saleLoyaltySchema,
  updateLoyaltySettingsBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

/** Puntos y recompensas: reglas, catálogo, saldo del cliente y canje en el cobro. */
export const loyaltyRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const adjust = { policy: { kind: 'staff', permission: 'loyalty:adjust' } } as const;
  const settings = { policy: { kind: 'staff', permission: 'loyalty:settings' } } as const;
  const charge = { policy: { kind: 'staff', permission: 'sales:charge' } } as const;
  const rewardList = { 200: z.array(rewardSchema) };
  const saleLoyaltyResponse = { 200: saleLoyaltySchema };

  // --- Reglas y catálogo ---
  app.get(
    '/v1/loyalty/settings',
    { config: adjust, schema: { response: { 200: loyaltySettingsSchema } } },
    async (request) => getLoyaltySettings(deps, request.staff!),
  );
  app.patch(
    '/v1/loyalty/settings',
    { config: settings, schema: { body: updateLoyaltySettingsBody, response: { 200: loyaltySettingsSchema } } },
    async (request) => updateLoyaltySettings(deps, request.staff!, request.body, request.meta),
  );
  app.get('/v1/rewards', { config: adjust, schema: { response: rewardList } }, async (request) =>
    listRewards(deps, request.staff!),
  );
  app.post(
    '/v1/rewards',
    { config: settings, schema: { body: rewardBody, response: { 201: z.array(rewardSchema) } } },
    async (request, reply) => reply.code(201).send(await saveReward(deps, request.staff!, null, request.body)),
  );
  app.patch(
    '/v1/rewards/:rewardId',
    { config: settings, schema: { params: rewardIdParams, body: rewardBody, response: rewardList } },
    async (request) => saveReward(deps, request.staff!, request.params.rewardId, request.body),
  );
  app.post(
    '/v1/rewards/:rewardId/archive',
    { config: settings, schema: { params: rewardIdParams, response: rewardList } },
    async (request) => archiveReward(deps, request.staff!, request.params.rewardId),
  );

  // --- Saldo del cliente ---
  app.get(
    '/v1/customers/:customerId/points',
    {
      config: { policy: { kind: 'staff', permission: 'customers:read' } },
      schema: { params: customerIdParams, response: { 200: customerPointsSchema } },
    },
    async (request) => getCustomerPoints(deps, request.staff!, request.params.customerId),
  );
  app.post(
    '/v1/customers/:customerId/points/adjust',
    { config: adjust, schema: { params: customerIdParams, body: adjustPointsBody, response: { 200: customerPointsSchema } } },
    async (request) => adjustPoints(deps, request.staff!, request.params.customerId, request.body, request.meta),
  );

  // --- Canje en el cobro ---
  app.get(
    '/v1/sales/:saleId/loyalty',
    { config: charge, schema: { params: saleIdParams, response: saleLoyaltyResponse } },
    async (request) => saleLoyalty(deps, request.staff!, request.params.saleId),
  );
  app.post(
    '/v1/sales/:saleId/loyalty/redeem',
    { config: charge, schema: { params: saleIdParams, body: redeemRewardBody, response: saleLoyaltyResponse } },
    async (request) => redeemReward(deps, request.staff!, request.params.saleId, request.body),
  );
  app.delete(
    '/v1/sales/:saleId/loyalty/:redemptionId',
    { config: charge, schema: { params: redemptionIdParams, response: saleLoyaltyResponse } },
    async (request) => undoRedemption(deps, request.staff!, request.params.saleId, request.params.redemptionId),
  );

  // --- Portal del cliente ---
  app.get(
    '/v1/me/points',
    { config: { policy: { kind: 'customer' } }, schema: { response: { 200: myPointsSchema } } },
    async (request) => myPoints(deps, request.customer!),
  );
};
