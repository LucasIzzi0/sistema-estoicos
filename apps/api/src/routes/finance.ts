import {
  adjustStock,
  commissionSummary,
  createExpense,
  createExpenseCategory,
  createSettlement,
  getMonthlyResult,
  getSettlement,
  listExpenseCategories,
  listExpenses,
  listPendingCommissions,
  listSettlements,
  listStock,
  listStockMovements,
  paySettlement,
  recordStockPurchase,
  setMinStock,
  voidExpense,
  voidSettlement,
} from '@estoicos/core';
import {
  barberCommissionSummarySchema,
  barberIdParams,
  branchIdParams,
  branchProductParams,
  commissionEntrySchema,
  commissionSummaryQuery,
  createExpenseBody,
  createSettlementBody,
  expenseCategoryBody,
  expenseCategorySchema,
  expenseIdParams,
  expenseListQuery,
  expenseSchema,
  minStockBody,
  monthlyResultQuery,
  monthlyResultSchema,
  paySettlementBody,
  settlementIdParams,
  settlementListItemSchema,
  settlementSchema,
  stockAdjustBody,
  stockItemSchema,
  stockMovementSchema,
  stockPurchaseBody,
  voidReasonBody,
} from '@estoicos/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

/** Egresos, resultado del mes, stock y comisiones. */
export const financeRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps } = ctx;
  const expenses = { policy: { kind: 'staff', permission: 'expenses:manage' } } as const;

  // --- Egresos ---
  app.get(
    '/v1/expense-categories',
    { config: expenses, schema: { response: { 200: z.array(expenseCategorySchema) } } },
    async (request) => listExpenseCategories(deps, request.staff!),
  );
  app.post(
    '/v1/expense-categories',
    {
      config: expenses,
      schema: { body: expenseCategoryBody, response: { 201: z.array(expenseCategorySchema) } },
    },
    async (request, reply) =>
      reply.code(201).send(await createExpenseCategory(deps, request.staff!, request.body)),
  );
  app.get(
    '/v1/expenses',
    {
      config: expenses,
      schema: { querystring: expenseListQuery, response: { 200: z.array(expenseSchema) } },
    },
    async (request) => listExpenses(deps, request.staff!, request.query),
  );
  app.post(
    '/v1/expenses',
    { config: expenses, schema: { body: createExpenseBody, response: { 201: expenseSchema } } },
    async (request, reply) => reply.code(201).send(await createExpense(deps, request.staff!, request.body)),
  );
  app.post(
    '/v1/expenses/:expenseId/void',
    {
      config: expenses,
      schema: { params: expenseIdParams, body: voidReasonBody, response: { 200: expenseSchema } },
    },
    async (request) =>
      voidExpense(deps, request.staff!, request.params.expenseId, request.body, request.meta),
  );
  app.get(
    '/v1/reports/monthly',
    {
      config: { policy: { kind: 'staff', permission: 'reports:view' } },
      schema: { querystring: monthlyResultQuery, response: { 200: monthlyResultSchema } },
    },
    async (request) => getMonthlyResult(deps, request.staff!, request.query),
  );

  // --- Stock por sucursal ---
  const stockRead = {
    policy: { kind: 'staff', permission: 'catalog:read', branchParam: 'branchId' },
  } as const;
  const stockAdjust = {
    policy: { kind: 'staff', permission: 'stock:adjust', branchParam: 'branchId' },
  } as const;
  const stockList = { 200: z.array(stockItemSchema) };
  app.get(
    '/v1/branches/:branchId/stock',
    { config: stockRead, schema: { params: branchIdParams, response: stockList } },
    async (request) => listStock(deps, request.staff!, request.params.branchId),
  );
  app.post(
    '/v1/branches/:branchId/stock/:productId/purchases',
    {
      config: stockAdjust,
      schema: { params: branchProductParams, body: stockPurchaseBody, response: stockList },
    },
    async (request) =>
      recordStockPurchase(
        deps,
        request.staff!,
        request.params.branchId,
        request.params.productId,
        request.body,
        request.meta,
      ),
  );
  app.post(
    '/v1/branches/:branchId/stock/:productId/adjustments',
    {
      config: stockAdjust,
      schema: { params: branchProductParams, body: stockAdjustBody, response: stockList },
    },
    async (request) =>
      adjustStock(
        deps,
        request.staff!,
        request.params.branchId,
        request.params.productId,
        request.body,
        request.meta,
      ),
  );
  app.put(
    '/v1/branches/:branchId/stock/:productId/min',
    { config: stockAdjust, schema: { params: branchProductParams, body: minStockBody, response: stockList } },
    async (request) =>
      setMinStock(deps, request.staff!, request.params.branchId, request.params.productId, request.body),
  );
  app.get(
    '/v1/branches/:branchId/stock/:productId/movements',
    {
      config: stockRead,
      schema: { params: branchProductParams, response: { 200: z.array(stockMovementSchema) } },
    },
    async (request) =>
      listStockMovements(deps, request.staff!, request.params.branchId, request.params.productId),
  );

  // --- Comisiones ---
  const commRead = { policy: { kind: 'staff', permission: 'commissions:read' } } as const;
  const commSettle = { policy: { kind: 'staff', permission: 'commissions:settle' } } as const;
  const settlementDetail = { 200: settlementSchema };
  app.get(
    '/v1/commissions/summary',
    {
      config: commRead,
      schema: {
        querystring: commissionSummaryQuery,
        response: { 200: z.array(barberCommissionSummarySchema) },
      },
    },
    async (request) => commissionSummary(deps, request.staff!, request.query),
  );
  app.get(
    '/v1/barbers/:barberId/commissions/pending',
    {
      config: commRead,
      schema: {
        params: barberIdParams,
        querystring: commissionSummaryQuery,
        response: { 200: z.array(commissionEntrySchema) },
      },
    },
    async (request) => listPendingCommissions(deps, request.staff!, request.params.barberId, request.query),
  );
  app.get(
    '/v1/settlements',
    {
      config: commRead,
      schema: {
        querystring: z.object({ barberId: z.uuid().optional() }),
        response: { 200: z.array(settlementListItemSchema) },
      },
    },
    async (request) => listSettlements(deps, request.staff!, request.query.barberId),
  );
  app.post(
    '/v1/settlements',
    { config: commSettle, schema: { body: createSettlementBody, response: { 201: settlementSchema } } },
    async (request, reply) =>
      reply.code(201).send(await createSettlement(deps, request.staff!, request.body)),
  );
  app.get(
    '/v1/settlements/:settlementId',
    { config: commRead, schema: { params: settlementIdParams, response: settlementDetail } },
    async (request) => getSettlement(deps, request.staff!, request.params.settlementId),
  );
  app.post(
    '/v1/settlements/:settlementId/pay',
    {
      config: commSettle,
      schema: { params: settlementIdParams, body: paySettlementBody, response: settlementDetail },
    },
    async (request) =>
      paySettlement(deps, request.staff!, request.params.settlementId, request.body, request.meta),
  );
  app.post(
    '/v1/settlements/:settlementId/void',
    {
      config: commSettle,
      schema: { params: settlementIdParams, body: voidReasonBody, response: settlementDetail },
    },
    async (request) =>
      voidSettlement(deps, request.staff!, request.params.settlementId, request.body, request.meta),
  );
};
