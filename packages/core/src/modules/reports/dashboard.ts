import {
  addDays,
  DEFAULT_TIMEZONE,
  isoWeekday,
  todayIn,
  type DashboardDto,
  type PaymentMethod,
} from '@estoicos/shared';
import { requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps } from '../../deps';
import { localDayRange } from '../../time';
import { getWorkerStatus } from '../system/system';
import { averageTicketCents, occupancyBps, splitNewReturning } from './calc';
import { branchScope } from './scope';

/**
 * Dashboard (Fase 8): lo primero que se ve al entrar. El orden es el que sirve a la mañana:
 * la plata del día, los turnos de hoy, las alertas y recién al final la tendencia de clientes.
 * Todo se calcula en la zona horaria del local, no en la del servidor.
 */
export async function getDashboard(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawQuery: { branchId?: string },
): Promise<DashboardDto> {
  requirePermission(p, 'dashboard:view');
  const scope = branchScope(p, rawQuery.branchId);
  // Con una sola sucursal no hay nada que elegir: se asume esa, así el efectivo en caja y el
  // stock bajo se ven sin tener que filtrar a mano.
  const onlyBranch = p.branchIds.length === 1 ? (p.branchIds[0] ?? null) : null;
  const selectedBranchId = rawQuery.branchId ?? onlyBranch;
  const now = deps.now();
  const today = todayIn(DEFAULT_TIMEZONE, now);
  const day = localDayRange(today, today, DEFAULT_TIMEZONE)!;
  // Semana corrida: de lunes a hoy, como se mira el negocio.
  const weekStart = addDays(today, -(isoWeekday(today) - 1));
  const week = localDayRange(weekStart, today, DEFAULT_TIMEZONE)!;
  const monthStart = `${today.slice(0, 7)}-01`;
  const month = localDayRange(monthStart, today, DEFAULT_TIMEZONE)!;
  // Mismo tramo del mes pasado: comparar el mes entero contra 10 días sería mentirse.
  const previousStart = previousMonthStart(monthStart);
  const previousEnd = addDays(previousStart, dayOfMonth(today) - 1);
  const previous = localDayRange(previousStart, previousEnd, DEFAULT_TIMEZONE)!;

  const orgScope = { organizationId: p.organizationId, ...scope };
  const [income, appointments, barbers, schedules, timeOffs, stock, alerts] = await Promise.all([
    incomeFor(deps, orgScope, { day, week, month, previous }),
    deps.db.appointment.findMany({
      where: { ...orgScope, startsAt: { gte: day.startsAt, lt: day.endsAt } },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        barber: { select: { displayName: true } },
        services: { select: { service: { select: { name: true } } }, orderBy: { position: 'asc' } },
      },
      orderBy: { startsAt: 'asc' },
    }),
    deps.db.barber.findMany({
      where: { organizationId: p.organizationId, active: true },
      select: { id: true, displayName: true, branches: { where: { active: true }, select: { branchId: true } } },
      orderBy: { displayName: 'asc' },
    }),
    deps.db.barberSchedule.findMany({
      where: {
        weekday: isoWeekday(today),
        ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: new Date(today) } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: new Date(today) } }] },
        ],
      },
      select: { barberId: true, startMinute: true, endMinute: true },
    }),
    deps.db.barberTimeOff.findMany({
      where: { startsAt: { lt: day.endsAt }, endsAt: { gt: day.startsAt } },
      select: { barberId: true, startsAt: true, endsAt: true },
    }),
    lowStock(deps, p, selectedBranchId),
    openIssues(deps, p, orgScope, now, day),
  ]);

  const visitors = await deps.db.sale.findMany({
    where: {
      ...orgScope,
      status: 'PAID',
      paidAt: { gte: month.startsAt, lt: month.endsAt },
      customerId: { not: null },
    },
    select: { customerId: true, customer: { select: { firstVisitAt: true } } },
  });

  const branchIds = selectedBranchId ? [selectedBranchId] : null;
  const working = barbers.filter(
    (b) => !branchIds || b.branches.some((x) => branchIds.includes(x.branchId)),
  );

  return {
    date: today,
    branchId: selectedBranchId,
    today: {
      incomeCents: Number(income.day.total),
      byMethod: income.day.byMethod,
      salesCount: income.day.salesCount,
      averageTicketCents: Number(averageTicketCents(income.day.total, income.day.salesCount)),
      cashOnHandCents: await cashOnHand(deps, orgScope, selectedBranchId),
    },
    week: { incomeCents: Number(income.week.total), salesCount: income.week.salesCount },
    month: {
      incomeCents: Number(income.month.total),
      salesCount: income.month.salesCount,
      previousCents: Number(income.previous.total),
    },
    appointments: {
      total: appointments.length,
      byStatus: countBy(appointments.map((a) => a.status)).map(([status, count]) => ({
        status,
        count,
      })),
      next: appointments
        .filter((a) => a.endsAt > now && !['CANCELED', 'NO_SHOW'].includes(a.status))
        .slice(0, 6)
        .map((a) => ({
          id: a.id,
          startsAt: a.startsAt.toISOString(),
          customerName: a.customer
            ? `${a.customer.firstName} ${a.customer.lastName}`.trim()
            : 'Sin turno previo',
          barberName: a.barber.displayName,
          services: a.services.map((s) => s.service.name),
          status: a.status,
        })),
    },
    barbers: working.map((b) => {
      const mine = appointments.filter(
        (a) => a.barberId === b.id && !['CANCELED', 'NO_SHOW'].includes(a.status),
      );
      const booked = mine.reduce((total, a) => total + minutesBetween(a.startsAt, a.endsAt), 0);
      const scheduled = schedules
        .filter((s) => s.barberId === b.id)
        .reduce((total, s) => total + (s.endMinute - s.startMinute), 0);
      const off = timeOffs
        .filter((t) => t.barberId === b.id)
        .reduce(
          (total, t) =>
            total +
            minutesBetween(
              t.startsAt < day.startsAt ? day.startsAt : t.startsAt,
              t.endsAt > day.endsAt ? day.endsAt : t.endsAt,
            ),
          0,
        );
      const available = Math.max(scheduled - off, 0);
      return {
        barberId: b.id,
        name: b.displayName,
        appointments: mine.length,
        bookedMinutes: booked,
        availableMinutes: available,
        occupancyBps: occupancyBps(booked, available),
      };
    }),
    customers: splitNewReturning(
      visitors.map((v) => ({ customerId: v.customerId!, firstVisitAt: v.customer?.firstVisitAt ?? null })),
      month.startsAt,
      month.endsAt,
    ),
    alerts: { lowStock: stock, ...alerts },
  };
}

type Range = { startsAt: Date; endsAt: Date };
type OrgScope = { organizationId: string; branchId?: string | { in: string[] } };

/** Cobrado en cada rango, por medio de pago, descontando los reintegros. */
async function incomeFor<K extends string>(
  deps: CoreDeps,
  scope: OrgScope,
  ranges: Record<K, Range>,
): Promise<Record<K, Income>> {
  const entries = await Promise.all(
    (Object.entries(ranges) as [K, Range][]).map(async ([key, range]) => {
      const between = { gte: range.startsAt, lt: range.endsAt };
      const [payments, refunds, salesCount] = await Promise.all([
        deps.db.payment.findMany({
          where: { ...scope, purpose: 'SALE', status: 'APPROVED', approvedAt: between },
          select: { method: true, amountCents: true },
        }),
        deps.db.refund.findMany({
          where: { status: 'APPROVED', processedAt: between, payment: { ...scope } },
          select: { amountCents: true, payment: { select: { method: true } } },
        }),
        deps.db.sale.count({ where: { ...scope, status: 'PAID', paidAt: between } }),
      ]);
      const byMethod = new Map<PaymentMethod, bigint>();
      for (const x of payments)
        byMethod.set(x.method, (byMethod.get(x.method) ?? 0n) + x.amountCents);
      for (const r of refunds)
        byMethod.set(r.payment.method, (byMethod.get(r.payment.method) ?? 0n) - r.amountCents);
      const income: Income = {
        total: [...byMethod.values()].reduce((a, b) => a + b, 0n),
        byMethod: [...byMethod.entries()]
          .filter(([, amount]) => amount !== 0n)
          .map(([method, amount]) => ({ method, amountCents: Number(amount) }))
          .sort((a, b) => b.amountCents - a.amountCents),
        salesCount,
      };
      return [key, income] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<K, Income>;
}

type Income = {
  total: bigint;
  byMethod: { method: PaymentMethod; amountCents: number }[];
  salesCount: number;
};

/** Efectivo que debería haber en el cajón ahora mismo. Solo tiene sentido con una sucursal elegida. */
async function cashOnHand(deps: CoreDeps, scope: OrgScope, branchId: string | null) {
  if (!branchId) return null;
  const session = await deps.db.cashSession.findFirst({
    where: { organizationId: scope.organizationId, branchId, status: 'OPEN' },
    include: {
      movements: {
        where: { method: 'CASH', voidedAt: null },
        select: { type: true, amountCents: true },
      },
    },
  });
  if (!session) return null;
  const [cash, refunds, expenses] = await Promise.all([
    deps.db.payment.aggregate({
      where: { cashSessionId: session.id, method: 'CASH', status: 'APPROVED' },
      _sum: { amountCents: true },
    }),
    deps.db.refund.aggregate({
      where: { status: 'APPROVED', payment: { cashSessionId: session.id, method: 'CASH' } },
      _sum: { amountCents: true },
    }),
    deps.db.expense.aggregate({
      where: { cashSessionId: session.id, method: 'CASH', voidedAt: null },
      _sum: { amountCents: true },
    }),
  ]);
  // Mismo criterio que el cierre de caja: un aporte suma y un retiro resta.
  const movements = session.movements.reduce(
    (total, m) => total + (m.type === 'CONTRIBUTION' ? m.amountCents : -m.amountCents),
    0n,
  );
  return Number(
    session.openingCashCents +
      (cash._sum.amountCents ?? 0n) -
      (refunds._sum.amountCents ?? 0n) -
      (expenses._sum.amountCents ?? 0n) +
      movements,
  );
}

async function lowStock(deps: CoreDeps, p: StaffPrincipal, branchId: string | null) {
  const rows = await deps.db.branchProduct.findMany({
    where: {
      ...(branchId ? { branchId } : p.accessLevel === 'OWNER' ? {} : { branchId: { in: p.branchIds } }),
      active: true,
      minStock: { not: null },
      product: { organizationId: p.organizationId, trackStock: true, active: true, archivedAt: null },
    },
    select: {
      productId: true,
      stockOnHand: true,
      minStock: true,
      product: { select: { name: true } },
    },
    orderBy: { stockOnHand: 'asc' },
  });
  return rows
    .filter((r) => r.stockOnHand <= (r.minStock ?? 0))
    .slice(0, 10)
    .map((r) => ({
      productId: r.productId,
      name: r.product.name,
      stockOnHand: r.stockOnHand,
      minStock: r.minStock ?? 0,
    }));
}

/** Lo que hay que mirar hoy: cosas que quedaron colgadas y avisos del sistema. */
async function openIssues(deps: CoreDeps, p: StaffPrincipal, scope: OrgScope, now: Date, day: Range) {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [unmatchedPayments, staleOpenSales, openCashSessions, failedNotifications, worker] =
    await Promise.all([
      deps.db.mpPayment.count({
        where: { organizationId: p.organizationId, reconciliationStatus: 'UNASSIGNED' },
      }),
      deps.db.sale.count({ where: { ...scope, status: 'OPEN', createdAt: { lt: day.startsAt } } }),
      deps.db.cashSession.count({
        where: { ...scope, status: 'OPEN', openedAt: { lt: day.startsAt } },
      }),
      deps.db.notification.count({
        where: { organizationId: p.organizationId, status: 'FAILED', failedAt: { gte: weekAgo } },
      }),
      getWorkerStatus(deps.db, now),
    ]);
  return {
    unmatchedPayments,
    staleOpenSales,
    openCashSessions,
    failedNotifications,
    workerDown: worker.status === 'down',
  };
}

function countBy<T extends string>(values: T[]): [T, number][] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const minutesBetween = (a: Date, b: Date) => Math.max(Math.round((b.getTime() - a.getTime()) / 60_000), 0);
const dayOfMonth = (date: string) => Number(date.slice(8, 10));

function previousMonthStart(monthStart: string): string {
  const [year, month] = monthStart.split('-').map(Number) as [number, number];
  return month === 1
    ? `${year - 1}-12-01`
    : `${year}-${String(month - 1).padStart(2, '0')}-01`;
}
