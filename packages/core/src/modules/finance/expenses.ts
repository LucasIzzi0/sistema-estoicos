import type { Prisma } from '@estoicos/db';
import {
  addDays,
  createExpenseBody,
  DEFAULT_TIMEZONE,
  expenseCategoryBody,
  expenseListQuery,
  monthlyResultQuery,
  voidReasonBody,
  type CreateExpenseBody,
  type ExpenseCategoryDto,
  type ExpenseDto,
  type MonthlyResult,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors, isUniqueViolation } from '../../errors';
import { localDayRange } from '../../time';
import { writeAudit } from '../audit/audit';
import { openSessionOrFail } from '../cash/cash';

/**
 * Egresos (con o sin caja) y resultado del mes. Los gastos generales (sin sucursal, ej. un
 * contador) solo los ve y carga el dueño; el encargado, los de sus sucursales.
 */
export async function listExpenseCategories(
  deps: CoreDeps,
  p: StaffPrincipal,
): Promise<ExpenseCategoryDto[]> {
  requirePermission(p, 'expenses:manage');
  return deps.db.expenseCategory.findMany({
    where: { organizationId: p.organizationId },
    select: { id: true, name: true, systemKey: true, active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createExpenseCategory(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: z.input<typeof expenseCategoryBody>,
): Promise<ExpenseCategoryDto[]> {
  requirePermission(p, 'expenses:manage');
  const body = expenseCategoryBody.parse(rawBody);
  try {
    await deps.db.expenseCategory.create({
      data: { organizationId: p.organizationId, name: body.name, sortOrder: 50 },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict('Ya hay una categoría con ese nombre.');
    throw error;
  }
  return listExpenseCategories(deps, p);
}

const expenseInclude = {
  branch: { select: { name: true } },
  category: { select: { name: true } },
  createdBy: { select: { name: true } },
} as const satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

function toDto(e: ExpenseRow): ExpenseDto {
  return {
    id: e.id,
    branchId: e.branchId,
    branchName: e.branch?.name ?? null,
    categoryId: e.categoryId,
    categoryName: e.category.name,
    amountCents: Number(e.amountCents),
    method: e.method,
    occurredOn: e.occurredOn.toISOString().slice(0, 10),
    description: e.description,
    supplier: e.supplier,
    fromCashSession: !!e.cashSessionId,
    createdByName: e.createdBy.name,
    voidedAt: e.voidedAt?.toISOString() ?? null,
    voidReason: e.voidReason,
  };
}

function requireScope(p: StaffPrincipal, branchId: string | null) {
  if (branchId) requireBranchAccess(p, branchId);
  else if (p.accessLevel !== 'OWNER') throw Errors.forbidden('Los gastos generales los carga el dueño.');
}

export async function createExpense(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: CreateExpenseBody,
): Promise<ExpenseDto> {
  requirePermission(p, 'expenses:manage');
  const body = createExpenseBody.parse(rawBody);
  requireScope(p, body.branchId);
  const category = await deps.db.expenseCategory.findFirst({
    where: { id: body.categoryId, organizationId: p.organizationId, active: true },
  });
  if (!category) throw Errors.invalid('Elegí una categoría válida.');
  if (category.systemKey) {
    throw Errors.invalid('Las comisiones se pagan desde la liquidación de cada barbero.');
  }
  const session = body.fromCashSession ? await openSessionOrFail(deps, body.branchId!) : null;
  const e = await deps.db.expense.create({
    data: {
      organizationId: p.organizationId,
      branchId: body.branchId,
      categoryId: category.id,
      amountCents: BigInt(body.amountCents),
      method: body.method,
      occurredOn: new Date(body.occurredOn),
      description: body.description,
      supplier: body.supplier,
      cashSessionId: session?.id ?? null,
      createdById: p.userId,
    },
    include: expenseInclude,
  });
  return toDto(e);
}

function monthRange(month: string) {
  const first = `${month}-01`;
  const last = addDays(addDays(first, 32).slice(0, 8) + '01', -1);
  return { first, last };
}

function branchScope(p: StaffPrincipal, branchId: string | undefined) {
  if (branchId) {
    requireBranchAccess(p, branchId);
    return { branchId };
  }
  // Sin filtro: el dueño ve todo (también lo general); el encargado, solo sus sucursales.
  return p.accessLevel === 'OWNER' ? {} : { branchId: { in: p.branchIds } };
}

export async function listExpenses(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawQuery: z.input<typeof expenseListQuery>,
): Promise<ExpenseDto[]> {
  requirePermission(p, 'expenses:manage');
  const query = expenseListQuery.parse(rawQuery);
  const { first, last } = monthRange(query.month);
  const rows = await deps.db.expense.findMany({
    where: {
      organizationId: p.organizationId,
      ...branchScope(p, query.branchId),
      occurredOn: { gte: new Date(first), lte: new Date(last) },
    },
    include: expenseInclude,
    orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toDto);
}

export async function voidExpense(
  deps: CoreDeps,
  p: StaffPrincipal,
  expenseId: string,
  rawBody: z.input<typeof voidReasonBody>,
  meta: RequestMeta,
): Promise<ExpenseDto> {
  requirePermission(p, 'expenses:manage');
  const body = voidReasonBody.parse(rawBody);
  const e = await deps.db.expense.findFirst({
    where: { id: expenseId, organizationId: p.organizationId },
    include: { cashSession: { select: { status: true } } },
  });
  if (!e) throw Errors.notFound('No encontramos ese egreso.');
  requireScope(p, e.branchId);
  if (e.voidedAt) throw Errors.conflict('El egreso ya está anulado.');
  if (e.commissionSettlementId) throw Errors.conflict('Es el pago de una liquidación: anulá la liquidación.');
  if (e.cashSession?.status === 'CLOSED') {
    throw Errors.conflict('Salió de una caja que ya se cerró: no se puede anular.');
  }
  await deps.db.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: e.id },
      data: { voidedAt: deps.now(), voidedById: p.userId, voidReason: body.reason },
    });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      branchId: e.branchId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'EXPENSE_VOIDED',
      entityType: 'Expense',
      entityId: e.id,
      summary: `${e.description} (${Number(e.amountCents) / 100})`,
      reason: body.reason,
      meta,
    });
  });
  const updated = await deps.db.expense.findUniqueOrThrow({ where: { id: e.id }, include: expenseInclude });
  return toDto(updated);
}

/**
 * Resultado del mes (criterio de caja): lo cobrado − reintegros − egresos. Las comisiones
 * pagadas ya están dentro de los egresos; las generadas y todavía no pagadas se muestran aparte.
 */
export async function getMonthlyResult(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawQuery: z.input<typeof monthlyResultQuery>,
): Promise<MonthlyResult> {
  requirePermission(p, 'reports:view');
  const query = monthlyResultQuery.parse(rawQuery);
  const scope = branchScope(p, query.branchId);
  const { first, last } = monthRange(query.month);
  const range = localDayRange(first, last, DEFAULT_TIMEZONE)!;
  const inRange = { gte: range.startsAt, lt: range.endsAt };

  const [payments, refunds, items, expenses, commissions] = await Promise.all([
    deps.db.payment.findMany({
      where: { organizationId: p.organizationId, ...scope, purpose: 'SALE', approvedAt: inRange },
      select: { method: true, amountCents: true, saleId: true },
    }),
    deps.db.refund.findMany({
      where: {
        status: 'APPROVED',
        processedAt: inRange,
        payment: { organizationId: p.organizationId, ...scope },
      },
      select: { amountCents: true, payment: { select: { method: true } } },
    }),
    deps.db.saleItem.findMany({
      where: { sale: { organizationId: p.organizationId, ...scope, status: 'PAID', paidAt: inRange } },
      select: { type: true, totalCents: true, quantity: true, product: { select: { costCents: true } } },
    }),
    deps.db.expense.findMany({
      where: {
        organizationId: p.organizationId,
        ...scope,
        voidedAt: null,
        occurredOn: { gte: new Date(first), lte: new Date(last) },
      },
      select: { amountCents: true, category: { select: { name: true } } },
    }),
    deps.db.commissionEntry.findMany({
      where: { organizationId: p.organizationId, ...scope, occurredAt: inRange },
      select: {
        amountCents: true,
        settlementItem: { select: { settlement: { select: { status: true } } } },
      },
    }),
  ]);

  const byMethod = new Map<string, bigint>();
  for (const x of payments) byMethod.set(x.method, (byMethod.get(x.method) ?? 0n) + x.amountCents);
  for (const r of refunds)
    byMethod.set(r.payment.method, (byMethod.get(r.payment.method) ?? 0n) - r.amountCents);
  const income = [...byMethod.values()].reduce((a, b) => a + b, 0n);

  const byCategory = new Map<string, bigint>();
  for (const e of expenses)
    byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? 0n) + e.amountCents);
  const expensesTotal = [...byCategory.values()].reduce((a, b) => a + b, 0n);

  const typeSum = (t: string) => items.filter((i) => i.type === t).reduce((a, i) => a + i.totalCents, 0n);
  const accrued = commissions.reduce((a, c) => a + c.amountCents, 0n);
  const unpaid = commissions
    .filter((c) => c.settlementItem?.settlement.status !== 'PAID')
    .reduce((a, c) => a + c.amountCents, 0n);

  return {
    month: query.month,
    branchId: query.branchId ?? null,
    salesCount: new Set(payments.map((x) => x.saleId)).size,
    incomeCents: Number(income),
    incomeByMethod: [...byMethod.entries()]
      .map(([method, amount]) => ({
        method: method as MonthlyResult['incomeByMethod'][number]['method'],
        amountCents: Number(amount),
      }))
      .sort((a, b) => b.amountCents - a.amountCents),
    incomeByType: {
      services: Number(typeSum('SERVICE')),
      products: Number(typeSum('PRODUCT')),
      tips: Number(typeSum('TIP')),
    },
    expensesCents: Number(expensesTotal),
    expensesByCategory: [...byCategory.entries()]
      .map(([categoryName, amount]) => ({ categoryName, amountCents: Number(amount) }))
      .sort((a, b) => b.amountCents - a.amountCents),
    resultCents: Number(income - expensesTotal),
    commissionsAccruedCents: Number(accrued),
    commissionsUnpaidCents: Number(unpaid),
    productCostCents: Number(
      items
        .filter((i) => i.type === 'PRODUCT' && i.product?.costCents)
        .reduce((a, i) => a + BigInt(i.quantity) * i.product!.costCents!, 0n),
    ),
  };
}
