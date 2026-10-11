import type { Prisma } from '@estoicos/db';
import {
  commissionSummaryQuery,
  createSettlementBody,
  DEFAULT_TIMEZONE,
  paySettlementBody,
  todayIn,
  voidReasonBody,
  type BarberCommissionSummary,
  type CommissionEntryDto,
  type CreateSettlementBody,
  type PaySettlementBody,
  type SettlementDto,
  type SettlementListItem,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import { canManageAcross } from '../../authz/scope';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors, isUniqueViolation } from '../../errors';
import { localToInstant } from '../../time';
import { writeAudit } from '../audit/audit';
import { openSessionOrFail } from '../cash/cash';

/**
 * Comisiones: se generan al cobrarse la venta (ledger inmutable) y se liquidan por período.
 * Una liquidación toma TODAS las comisiones sin liquidar hasta el fin del período (también
 * reversas de ventas anuladas). La base impide liquidar dos veces la misma comisión.
 * Los barberos no usan el sistema: reciben el resumen imprimible (decisión del 25/09/2026).
 */
function visibleBarbers(p: StaffPrincipal): Prisma.BarberWhereInput {
  return {
    organizationId: p.organizationId,
    ...(p.accessLevel === 'OWNER' ? {} : { branches: { some: { branchId: { in: p.branchIds } } } }),
  };
}

/** Fin del día local (exclusivo). */
function endOf(date: string) {
  return localToInstant(date, 24 * 60, DEFAULT_TIMEZONE);
}

const pending = (barberId: string, until: Date): Prisma.CommissionEntryWhereInput => ({
  barberId,
  occurredAt: { lt: until },
  settlementItem: null,
});

export async function commissionSummary(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawQuery: z.input<typeof commissionSummaryQuery>,
): Promise<BarberCommissionSummary[]> {
  requirePermission(p, 'commissions:read');
  const query = commissionSummaryQuery.parse(rawQuery);
  const until = endOf(query.until);
  const [barbers, settings] = await Promise.all([
    deps.db.barber.findMany({
      where: visibleBarbers(p),
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { displayName: 'asc' }],
    }),
    deps.db.organizationSettings.findUnique({ where: { organizationId: p.organizationId } }),
  ]);
  return Promise.all(
    barbers.map(async (b) => {
      const [agg, oldest, last] = await Promise.all([
        deps.db.commissionEntry.aggregate({
          where: pending(b.id, until),
          _sum: { amountCents: true },
          _count: { _all: true },
        }),
        deps.db.commissionEntry.findFirst({
          where: pending(b.id, until),
          orderBy: { occurredAt: 'asc' },
          select: { occurredAt: true },
        }),
        deps.db.commissionSettlement.findFirst({
          where: { barberId: b.id, status: { not: 'VOIDED' } },
          orderBy: { periodEnd: 'desc' },
          select: { periodEnd: true },
        }),
      ]);
      return {
        barberId: b.id,
        barberName: b.displayName,
        settlementPeriod: b.settlementPeriod ?? settings?.defaultSettlementPeriod ?? 'WEEKLY',
        pendingCents: Number(agg._sum.amountCents ?? 0n),
        entriesCount: agg._count._all,
        oldestPending: oldest?.occurredAt.toISOString() ?? null,
        lastSettlementEnd: last?.periodEnd.toISOString().slice(0, 10) ?? null,
      };
    }),
  );
}

const entryInclude = {
  saleItem: { select: { description: true } },
  sale: { select: { number: true } },
} as const satisfies Prisma.CommissionEntryInclude;
type EntryRow = Prisma.CommissionEntryGetPayload<{ include: typeof entryInclude }>;

function toEntry(e: EntryRow): CommissionEntryDto {
  return {
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    kind: e.kind,
    itemType: e.itemType,
    description:
      (e.kind === 'REVERSAL' ? 'Anulación: ' : '') + (e.saleItem?.description ?? e.reason ?? 'Ajuste'),
    saleNumber: e.sale?.number ?? null,
    baseCents: Number(e.baseCents),
    rateBps: e.rateBps,
    amountCents: Number(e.amountCents),
  };
}

async function loadBarber(deps: CoreDeps, p: StaffPrincipal, barberId: string) {
  const barber = await deps.db.barber.findFirst({
    where: { id: barberId, ...visibleBarbers(p) },
    include: { branches: { select: { branchId: true } } },
  });
  if (!barber) throw Errors.notFound('No encontramos ese barbero.');
  return barber;
}

export async function listPendingCommissions(
  deps: CoreDeps,
  p: StaffPrincipal,
  barberId: string,
  rawQuery: z.input<typeof commissionSummaryQuery>,
): Promise<CommissionEntryDto[]> {
  requirePermission(p, 'commissions:read');
  const query = commissionSummaryQuery.parse(rawQuery);
  await loadBarber(deps, p, barberId);
  const rows = await deps.db.commissionEntry.findMany({
    where: pending(barberId, endOf(query.until)),
    include: entryInclude,
    orderBy: { occurredAt: 'asc' },
  });
  return rows.map(toEntry);
}

const settlementInclude = {
  barber: { select: { displayName: true } },
  organization: { select: { name: true } },
  createdBy: { select: { name: true } },
  items: { include: { entry: { include: entryInclude } } },
} as const satisfies Prisma.CommissionSettlementInclude;
type SettlementRow = Prisma.CommissionSettlementGetPayload<{ include: typeof settlementInclude }>;

function toListItem(s: SettlementRow): SettlementListItem {
  return {
    id: s.id,
    barberId: s.barberId,
    barberName: s.barber.displayName,
    organizationName: s.organization.name,
    periodStart: s.periodStart.toISOString().slice(0, 10),
    periodEnd: s.periodEnd.toISOString().slice(0, 10),
    totalCents: Number(s.totalCents),
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    createdByName: s.createdBy.name,
    paidAt: s.paidAt?.toISOString() ?? null,
    paymentMethod: s.paymentMethod,
    voidReason: s.voidReason,
  };
}

function toSettlement(s: SettlementRow): SettlementDto {
  const entries = s.items.map((i) => i.entry).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const byType = (t: string) =>
    Number(entries.filter((e) => e.itemType === t).reduce((a, e) => a + e.amountCents, 0n));
  return {
    ...toListItem(s),
    byType: {
      services: byType('SERVICE'),
      products: byType('PRODUCT'),
      tips: byType('TIP'),
      adjustments: Number(entries.filter((e) => !e.itemType).reduce((a, e) => a + e.amountCents, 0n)),
    },
    entries: entries.map(toEntry),
  };
}

async function loadSettlement(deps: CoreDeps, p: StaffPrincipal, settlementId: string) {
  const s = await deps.db.commissionSettlement.findFirst({
    where: { id: settlementId, organizationId: p.organizationId, barber: visibleBarbers(p) },
    include: settlementInclude,
  });
  if (!s) throw Errors.notFound('No encontramos esa liquidación.');
  return s;
}

export async function getSettlement(deps: CoreDeps, p: StaffPrincipal, settlementId: string) {
  requirePermission(p, 'commissions:read');
  return toSettlement(await loadSettlement(deps, p, settlementId));
}

export async function listSettlements(
  deps: CoreDeps,
  p: StaffPrincipal,
  barberId?: string,
): Promise<SettlementListItem[]> {
  requirePermission(p, 'commissions:read');
  const rows = await deps.db.commissionSettlement.findMany({
    where: { organizationId: p.organizationId, barber: visibleBarbers(p), ...(barberId ? { barberId } : {}) },
    include: settlementInclude,
    orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    take: 50,
  });
  return rows.map(toListItem);
}

async function requireManageBarber(deps: CoreDeps, p: StaffPrincipal, barberId: string) {
  requirePermission(p, 'commissions:settle');
  const barber = await loadBarber(deps, p, barberId);
  if (
    !canManageAcross(
      p,
      barber.branches.map((b) => b.branchId),
    )
  ) {
    throw Errors.forbidden('Este barbero trabaja también en sucursales que no gestionás. Pedíselo al dueño.');
  }
  return barber;
}

export async function createSettlement(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: CreateSettlementBody,
): Promise<SettlementDto> {
  const body = createSettlementBody.parse(rawBody);
  const barber = await requireManageBarber(deps, p, body.barberId);
  const settings = await deps.db.organizationSettings.findUnique({
    where: { organizationId: p.organizationId },
  });
  try {
    const id = await deps.db.$transaction(async (tx) => {
      const entries = await tx.commissionEntry.findMany({
        where: pending(barber.id, endOf(body.periodEnd)),
        select: { id: true, amountCents: true },
      });
      if (!entries.length) throw Errors.invalid('No hay comisiones sin liquidar hasta esa fecha.');
      const s = await tx.commissionSettlement.create({
        data: {
          organizationId: p.organizationId,
          barberId: barber.id,
          periodType: barber.settlementPeriod ?? settings?.defaultSettlementPeriod ?? 'WEEKLY',
          periodStart: new Date(body.periodStart),
          periodEnd: new Date(body.periodEnd),
          totalCents: entries.reduce((a, e) => a + e.amountCents, 0n),
          createdById: p.userId,
          items: { create: entries.map((e) => ({ commissionEntryId: e.id })) },
        },
      });
      return s.id;
    });
    return getSettlement(deps, p, id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw Errors.conflict('Alguna de esas comisiones se liquidó mientras tanto. Actualizá la página.');
    }
    throw error;
  }
}

/** Marcar pagada: crea el egreso en "Comisiones" (y si salió de la caja, descuenta del esperado). */
export async function paySettlement(
  deps: CoreDeps,
  p: StaffPrincipal,
  settlementId: string,
  rawBody: PaySettlementBody,
  meta: RequestMeta,
): Promise<SettlementDto> {
  const s = await loadSettlement(deps, p, settlementId);
  await requireManageBarber(deps, p, s.barberId);
  const body = paySettlementBody.parse(rawBody);
  if (s.status !== 'DRAFT') throw Errors.conflict('Esta liquidación ya no está pendiente de pago.');
  if (s.totalCents <= 0n) throw Errors.invalid('El total no es positivo: no hay nada para pagar.');
  const cashBranch = body.fromCashSessionBranchId ?? null;
  if (cashBranch) requireBranchAccess(p, cashBranch);
  const session = cashBranch ? await openSessionOrFail(deps, cashBranch) : null;
  const category = await deps.db.expenseCategory.findFirst({
    where: { organizationId: p.organizationId, systemKey: 'COMMISSIONS' },
  });
  if (!category) throw Errors.conflict('Falta la categoría de egresos "Comisiones".');
  const now = deps.now();

  await deps.db.$transaction(async (tx) => {
    const updated = await tx.commissionSettlement.updateMany({
      where: { id: s.id, status: 'DRAFT' },
      data: { status: 'PAID', paidAt: now, paidById: p.userId, paymentMethod: body.method },
    });
    if (updated.count === 0) throw Errors.conflict('Esta liquidación ya no está pendiente de pago.');
    await tx.expense.create({
      data: {
        organizationId: p.organizationId,
        branchId: cashBranch ?? s.branchId,
        categoryId: category.id,
        amountCents: s.totalCents,
        method: body.method,
        occurredOn: new Date(todayIn(DEFAULT_TIMEZONE, now)),
        description: `Comisiones de ${s.barber.displayName} (${s.periodStart.toISOString().slice(0, 10)} al ${s.periodEnd.toISOString().slice(0, 10)})`,
        cashSessionId: session?.id ?? null,
        commissionSettlementId: s.id,
        createdById: p.userId,
      },
    });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      branchId: cashBranch,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'COMMISSION_SETTLEMENT_PAID',
      entityType: 'CommissionSettlement',
      entityId: s.id,
      summary: `Liquidación de ${s.barber.displayName} pagada`,
      after: { totalCents: Number(s.totalCents), method: body.method, fromCash: !!session },
      meta,
    });
  });
  return getSettlement(deps, p, settlementId);
}

/** Anular: sus comisiones vuelven a quedar pendientes y, si estaba pagada, se anula el egreso. */
export async function voidSettlement(
  deps: CoreDeps,
  p: StaffPrincipal,
  settlementId: string,
  rawBody: z.input<typeof voidReasonBody>,
  meta: RequestMeta,
): Promise<SettlementDto> {
  const s = await loadSettlement(deps, p, settlementId);
  await requireManageBarber(deps, p, s.barberId);
  const body = voidReasonBody.parse(rawBody);
  if (s.status === 'VOIDED') throw Errors.conflict('La liquidación ya está anulada.');
  const now = deps.now();
  await deps.db.$transaction(async (tx) => {
    await tx.commissionSettlementItem.deleteMany({ where: { settlementId: s.id } });
    await tx.commissionSettlement.update({
      where: { id: s.id },
      data: { status: 'VOIDED', voidedAt: now, voidedById: p.userId, voidReason: body.reason },
    });
    await tx.expense.updateMany({
      where: { commissionSettlementId: s.id, voidedAt: null },
      data: { voidedAt: now, voidedById: p.userId, voidReason: `Liquidación anulada: ${body.reason}` },
    });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'COMMISSION_SETTLEMENT_VOIDED',
      entityType: 'CommissionSettlement',
      entityId: s.id,
      summary: `Liquidación de ${s.barber.displayName} anulada (estaba ${s.status === 'PAID' ? 'pagada' : 'en borrador'})`,
      reason: body.reason,
      meta,
    });
  });
  return getSettlement(deps, p, settlementId);
}
