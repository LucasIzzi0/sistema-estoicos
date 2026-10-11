import type { PaymentMethod, Prisma } from '@estoicos/db';
import {
  cashMovementBody,
  cashSessionListQuery,
  closeCashBody,
  MANUAL_PAYMENT_METHODS,
  openCashBody,
  PAYMENT_METHOD_LABELS,
  todayIn,
  voidReasonBody,
  type CashMovementBody,
  type CashSessionDto,
  type CashSessionListItem,
  type CloseCashBody,
  type OpenCashBody,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { DomainError, Errors, isUniqueViolation } from '../../errors';
import { writeAudit } from '../audit/audit';
import { expectedByMethod } from '../sales/calc';

/**
 * Caja diaria por sucursal (P10). Recepción la abre y cobra; el cierre con arqueo, los aportes
 * y los retiros son del dueño o el encargado (decisión del 25/09/2026). Una sola caja abierta
 * por sucursal (índice único parcial en la base).
 */
const sessionInclude = {
  openedBy: { select: { name: true } },
  closedBy: { select: { name: true } },
  counts: true,
  movements: { include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
  expenses: { include: { category: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.CashSessionInclude;
type SessionRow = Prisma.CashSessionGetPayload<{ include: typeof sessionInclude }>;

type Totals = CashSessionDto['totals'];

/** Esperado por medio: cobros − reintegros − egresos (+ aportes − retiros en efectivo). */
async function computeTotals(
  deps: CoreDeps,
  s: SessionRow,
): Promise<{ totals: Totals; salesCount: number; salesTotal: bigint }> {
  const [payments, refunds] = await Promise.all([
    deps.db.payment.findMany({
      where: { cashSessionId: s.id, status: { in: ['APPROVED', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
      select: { method: true, amountCents: true, saleId: true },
    }),
    deps.db.refund.findMany({
      where: { cashSessionId: s.id, status: 'APPROVED' },
      select: { amountCents: true, payment: { select: { method: true } } },
    }),
  ]);
  const methods = new Set<PaymentMethod>([...MANUAL_PAYMENT_METHODS, ...payments.map((x) => x.method)]);
  const sum = <T>(rows: T[], pick: (r: T) => bigint) => rows.reduce((a, r) => a + pick(r), 0n);

  const totals: Totals = [...methods].map((method) => {
    const flows = {
      method,
      sales: sum(
        payments.filter((x) => x.method === method),
        (x) => x.amountCents,
      ),
      refunds: sum(
        refunds.filter((x) => x.payment.method === method),
        (x) => x.amountCents,
      ),
      expenses: sum(
        s.expenses.filter((e) => e.method === method && !e.voidedAt),
        (e) => e.amountCents,
      ),
      movements: sum(
        s.movements.filter((m) => m.method === method && !m.voidedAt),
        (m) => (m.type === 'CONTRIBUTION' ? m.amountCents : -m.amountCents),
      ),
    };
    return {
      method,
      salesCents: Number(flows.sales),
      refundsCents: Number(flows.refunds),
      expensesCents: Number(flows.expenses),
      movementsCents: Number(flows.movements),
      expectedCents: Number(expectedByMethod(s.openingCashCents, flows)),
    };
  });
  return {
    totals,
    salesCount: new Set(payments.map((x) => x.saleId).filter(Boolean)).size,
    salesTotal: sum(payments, (x) => x.amountCents) - sum(refunds, (x) => x.amountCents),
  };
}

async function toDto(deps: CoreDeps, s: SessionRow): Promise<CashSessionDto> {
  const [{ totals, salesCount, salesTotal }, openSalesCount] = await Promise.all([
    computeTotals(deps, s),
    deps.db.sale.count({ where: { branchId: s.branchId, status: 'OPEN' } }),
  ]);
  return {
    id: s.id,
    branchId: s.branchId,
    businessDate: s.businessDate.toISOString().slice(0, 10),
    status: s.status,
    openingCashCents: Number(s.openingCashCents),
    openingNote: s.openingNote,
    openedAt: s.openedAt.toISOString(),
    openedByName: s.openedBy.name,
    closedAt: s.closedAt?.toISOString() ?? null,
    closedByName: s.closedBy?.name ?? null,
    closingNote: s.closingNote,
    totals,
    salesCount,
    salesTotalCents: Number(salesTotal),
    openSalesCount,
    movements: s.movements.map((m) => ({
      id: m.id,
      type: m.type,
      amountCents: Number(m.amountCents),
      description: m.description,
      createdAt: m.createdAt.toISOString(),
      createdByName: m.createdBy.name,
      voided: !!m.voidedAt,
    })),
    expenses: s.expenses.map((e) => ({
      id: e.id,
      categoryName: e.category.name,
      amountCents: Number(e.amountCents),
      description: e.description,
      createdAt: e.createdAt.toISOString(),
      voided: !!e.voidedAt,
    })),
    counts: s.counts.map((c) => ({
      method: c.method,
      expectedCents: Number(c.expectedCents),
      countedCents: Number(c.countedCents),
      differenceCents: Number(c.differenceCents),
      note: c.note,
    })),
  };
}

async function loadSession(deps: CoreDeps, p: StaffPrincipal, sessionId: string) {
  const s = await deps.db.cashSession.findFirst({
    where: { id: sessionId, organizationId: p.organizationId },
    include: sessionInclude,
  });
  if (!s) throw Errors.notFound('No encontramos esa caja.');
  requireBranchAccess(p, s.branchId);
  return s;
}

/** La caja abierta de la sucursal (o null). */
export async function getCurrentCashSession(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
): Promise<CashSessionDto | null> {
  requirePermission(p, 'cash:open');
  requireBranchAccess(p, branchId);
  const s = await deps.db.cashSession.findFirst({
    where: { branchId, status: 'OPEN' },
    include: sessionInclude,
  });
  return s ? toDto(deps, s) : null;
}

export async function getCashSession(deps: CoreDeps, p: StaffPrincipal, sessionId: string) {
  requirePermission(p, 'cash:open');
  return toDto(deps, await loadSession(deps, p, sessionId));
}

export async function listCashSessions(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawQuery: z.input<typeof cashSessionListQuery>,
): Promise<CashSessionListItem[]> {
  requirePermission(p, 'cash:close');
  requireBranchAccess(p, branchId);
  const query = cashSessionListQuery.parse(rawQuery);
  const rows = await deps.db.cashSession.findMany({
    where: { branchId, ...(query.from ? { businessDate: { gte: new Date(query.from) } } : {}) },
    include: sessionInclude,
    orderBy: { openedAt: 'desc' },
    take: query.limit,
  });
  return Promise.all(
    rows.map(async (s) => {
      const { salesTotal } = await computeTotals(deps, s);
      return {
        id: s.id,
        businessDate: s.businessDate.toISOString().slice(0, 10),
        status: s.status,
        openedByName: s.openedBy.name,
        closedByName: s.closedBy?.name ?? null,
        salesTotalCents: Number(salesTotal),
        differenceCents:
          s.status === 'CLOSED' ? Number(s.counts.reduce((a, c) => a + c.differenceCents, 0n)) : null,
      };
    }),
  );
}

export async function openCashSession(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawBody: OpenCashBody,
  meta: RequestMeta,
): Promise<CashSessionDto> {
  requirePermission(p, 'cash:open');
  requireBranchAccess(p, branchId);
  const body = openCashBody.parse(rawBody);
  const branch = await deps.db.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { timezone: true },
  });
  try {
    const id = await deps.db.$transaction(async (tx) => {
      const s = await tx.cashSession.create({
        data: {
          organizationId: p.organizationId,
          branchId,
          businessDate: new Date(todayIn(branch.timezone, deps.now())),
          openingCashCents: BigInt(body.openingCashCents),
          openingNote: body.note,
          openedById: p.userId,
          openedAt: deps.now(),
        },
      });
      await writeAudit(tx, {
        organizationId: p.organizationId,
        branchId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'CASH_SESSION_OPENED',
        entityType: 'CashSession',
        entityId: s.id,
        summary: `Caja abierta con ${PAYMENT_METHOD_LABELS.CASH.toLowerCase()} inicial`,
        after: { openingCashCents: body.openingCashCents },
        meta,
      });
      return s.id;
    });
    return toDto(deps, await loadSession(deps, p, id));
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict('Ya hay una caja abierta en esta sucursal.');
    throw error;
  }
}

async function loadOpenForAdmin(deps: CoreDeps, p: StaffPrincipal, sessionId: string) {
  requirePermission(p, 'cash:close');
  const s = await loadSession(deps, p, sessionId);
  if (s.status !== 'OPEN') throw Errors.conflict('Esta caja ya está cerrada.');
  return s;
}

/** Aporte (cambio extra) o retiro de efectivo. No afectan el resultado del mes. */
export async function addCashMovement(
  deps: CoreDeps,
  p: StaffPrincipal,
  sessionId: string,
  rawBody: CashMovementBody,
): Promise<CashSessionDto> {
  const s = await loadOpenForAdmin(deps, p, sessionId);
  const body = cashMovementBody.parse(rawBody);
  await deps.db.cashMovement.create({
    data: {
      cashSessionId: s.id,
      type: body.type,
      amountCents: BigInt(body.amountCents),
      description: body.description,
      createdById: p.userId,
      createdAt: deps.now(),
    },
  });
  return toDto(deps, await loadSession(deps, p, sessionId));
}

export async function voidCashMovement(
  deps: CoreDeps,
  p: StaffPrincipal,
  sessionId: string,
  movementId: string,
  rawBody: z.input<typeof voidReasonBody>,
  meta: RequestMeta,
): Promise<CashSessionDto> {
  const s = await loadOpenForAdmin(deps, p, sessionId);
  const body = voidReasonBody.parse(rawBody);
  await deps.db.$transaction(async (tx) => {
    const updated = await tx.cashMovement.updateMany({
      where: { id: movementId, cashSessionId: s.id, voidedAt: null },
      data: { voidedAt: deps.now(), voidedById: p.userId, voidReason: body.reason },
    });
    if (updated.count === 0) throw Errors.notFound('No encontramos ese movimiento.');
    await writeAudit(tx, {
      organizationId: p.organizationId,
      branchId: s.branchId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'CASH_MOVEMENT_VOIDED',
      entityType: 'CashMovement',
      entityId: movementId,
      reason: body.reason,
      meta,
    });
  });
  return toDto(deps, await loadSession(deps, p, sessionId));
}

/**
 * Cierre con arqueo: por cada medio se guarda esperado, contado y diferencia. Hay que contar
 * todos los medios que tuvieron movimiento (y siempre el efectivo).
 */
export async function closeCashSession(
  deps: CoreDeps,
  p: StaffPrincipal,
  sessionId: string,
  rawBody: CloseCashBody,
  meta: RequestMeta,
): Promise<CashSessionDto> {
  const s = await loadOpenForAdmin(deps, p, sessionId);
  const body = closeCashBody.parse(rawBody);
  const { totals } = await computeTotals(deps, s);
  const provided = new Map(body.counts.map((c) => [c.method as PaymentMethod, c]));

  const toCount = totals.filter(
    (t) => t.method === 'CASH' || t.expectedCents !== 0 || provided.has(t.method),
  );
  const missing = toCount.filter((t) => !provided.has(t.method));
  if (missing.length) {
    throw Errors.invalid(`Contá también: ${missing.map((m) => PAYMENT_METHOD_LABELS[m.method]).join(', ')}.`);
  }

  await deps.db.$transaction(async (tx) => {
    const closed = await tx.cashSession.updateMany({
      where: { id: s.id, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: deps.now(), closedById: p.userId, closingNote: body.note },
    });
    if (closed.count === 0) throw Errors.conflict('Esta caja ya está cerrada.');
    const counts = toCount.map((t) => {
      const counted = BigInt(provided.get(t.method)!.countedCents);
      const expected = BigInt(t.expectedCents);
      return {
        cashSessionId: s.id,
        method: t.method,
        expectedCents: expected,
        countedCents: counted,
        differenceCents: counted - expected,
        note: provided.get(t.method)!.note,
      };
    });
    await tx.cashCount.createMany({ data: counts });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      branchId: s.branchId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'CASH_SESSION_CLOSED',
      entityType: 'CashSession',
      entityId: s.id,
      summary: `Cierre de caja del ${s.businessDate.toISOString().slice(0, 10)}`,
      after: counts.map((c) => ({
        method: c.method,
        expectedCents: Number(c.expectedCents),
        countedCents: Number(c.countedCents),
        differenceCents: Number(c.differenceCents),
      })),
      meta,
    });
  });
  return toDto(deps, await loadSession(deps, p, sessionId));
}

/** Para los egresos pagados con plata de la caja. */
export async function openSessionOrFail(deps: CoreDeps, branchId: string) {
  const s = await deps.db.cashSession.findFirst({ where: { branchId, status: 'OPEN' } });
  if (!s) throw new DomainError('CASH_CLOSED', 'No hay una caja abierta en esa sucursal.', 409);
  return s;
}
