import {
  DEFAULT_TIMEZONE,
  reportQuery,
  type PaymentMethod,
  type ReportDto,
  type ReportQuery,
} from '@estoicos/shared';
import { requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps } from '../../deps';
import { localDayRange } from '../../time';
import { averageTicketCents, daysBetween, splitNewReturning } from './calc';
import { branchScope } from './scope';

/**
 * Reporte por rango de fechas (Fase 8): qué se vendió, quién lo hizo, cuánto quedó y qué pasó
 * con los puntos. Un solo pedido trae todo, así la pantalla no parpadea de a pedazos.
 */
export async function getReport(deps: CoreDeps, p: StaffPrincipal, rawQuery: ReportQuery): Promise<ReportDto> {
  requirePermission(p, 'reports:view');
  const query = reportQuery.parse(rawQuery);
  const scope = branchScope(p, query.branchId);
  const range = localDayRange(query.from, query.to, DEFAULT_TIMEZONE)!;
  const between = { gte: range.startsAt, lt: range.endsAt };
  const orgScope = { organizationId: p.organizationId, ...scope };

  const [payments, refunds, sales, items, appointments, expenses, commissions, points, redemptions] =
    await Promise.all([
      deps.db.payment.findMany({
        where: { ...orgScope, purpose: 'SALE', status: 'APPROVED', approvedAt: between },
        select: { method: true, amountCents: true, approvedAt: true },
      }),
      deps.db.refund.findMany({
        where: { status: 'APPROVED', processedAt: between, payment: { ...orgScope } },
        select: { amountCents: true, processedAt: true, payment: { select: { method: true } } },
      }),
      deps.db.sale.findMany({
        where: { ...orgScope, status: 'PAID', paidAt: between },
        select: { id: true, paidAt: true, customerId: true, customer: { select: { firstVisitAt: true } } },
      }),
      deps.db.saleItem.findMany({
        where: { sale: { ...orgScope, status: 'PAID', paidAt: between } },
        select: {
          type: true,
          description: true,
          quantity: true,
          unitPriceCents: true,
          discountCents: true,
          totalCents: true,
          serviceId: true,
          productId: true,
          barberId: true,
          product: { select: { costCents: true } },
        },
      }),
      deps.db.appointment.findMany({
        where: { ...orgScope, startsAt: between },
        select: { barberId: true, status: true },
      }),
      deps.db.expense.findMany({
        where: {
          ...orgScope,
          voidedAt: null,
          occurredOn: { gte: new Date(query.from), lte: new Date(query.to) },
        },
        select: { amountCents: true, category: { select: { name: true } } },
      }),
      deps.db.commissionEntry.findMany({
        where: { ...orgScope, occurredAt: between },
        select: { amountCents: true, barberId: true },
      }),
      // Con una sucursal elegida quedan afuera los movimientos que no son de ninguna (un ajuste
      // manual o un vencimiento): no se le pueden cargar a un local en particular.
      deps.db.pointsEntry.findMany({
        where: { organizationId: p.organizationId, ...scope, createdAt: between },
        select: { type: true, points: true },
      }),
      deps.db.rewardRedemption.findMany({
        where: { organizationId: p.organizationId, ...scope, status: 'APPLIED', createdAt: between },
        select: { pointsSpent: true, discountCents: true, reward: { select: { name: true } } },
      }),
    ]);

  const barbers = await deps.db.barber.findMany({
    where: { organizationId: p.organizationId },
    select: { id: true, displayName: true },
  });
  const nameOf = new Map(barbers.map((b) => [b.id, b.displayName]));

  // --- Ventas ---
  const byMethod = new Map<PaymentMethod, bigint>();
  for (const x of payments) byMethod.set(x.method, (byMethod.get(x.method) ?? 0n) + x.amountCents);
  for (const r of refunds)
    byMethod.set(r.payment.method, (byMethod.get(r.payment.method) ?? 0n) - r.amountCents);
  const incomeCents = [...byMethod.values()].reduce((a, b) => a + b, 0n);

  const localDay = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(date);
  const perDay = new Map(daysBetween(query.from, query.to).map((d) => [d, { amount: 0n, count: 0 }]));
  for (const x of payments) {
    const day = perDay.get(localDay(x.approvedAt!));
    if (day) day.amount += x.amountCents;
  }
  for (const r of refunds) {
    const day = perDay.get(localDay(r.processedAt!));
    if (day) day.amount -= r.amountCents;
  }
  for (const s of sales) {
    const day = perDay.get(localDay(s.paidAt!));
    if (day) day.count += 1;
  }

  const grossCents = items.reduce((a, i) => a + BigInt(i.quantity) * i.unitPriceCents, 0n);
  const discountsCents = items.reduce((a, i) => a + i.discountCents, 0n);

  // --- Lo más vendido ---
  const ranked = (kind: 'SERVICE' | 'PRODUCT') => {
    const map = new Map<string, { id: string; name: string; quantity: number; amountCents: bigint }>();
    for (const i of items.filter((x) => x.type === kind)) {
      const id = (kind === 'SERVICE' ? i.serviceId : i.productId) ?? i.description;
      const row = map.get(id) ?? { id, name: i.description, quantity: 0, amountCents: 0n };
      row.quantity += i.quantity;
      row.amountCents += i.totalCents;
      map.set(id, row);
    }
    return [...map.values()]
      .sort((a, b) => Number(b.amountCents - a.amountCents))
      .slice(0, 15)
      .map((r) => ({ ...r, amountCents: Number(r.amountCents) }));
  };

  // --- Por barbero ---
  const barberIds = new Set([
    ...items.filter((i) => i.barberId).map((i) => i.barberId!),
    ...appointments.map((a) => a.barberId),
    ...commissions.map((c) => c.barberId),
  ]);
  const byBarber = [...barberIds]
    .map((id) => {
      const mine = items.filter((i) => i.barberId === id);
      return {
        id,
        name: nameOf.get(id) ?? 'Barbero dado de baja',
        appointments: appointments.filter((a) => a.barberId === id && a.status === 'COMPLETED').length,
        services: mine.filter((i) => i.type === 'SERVICE').reduce((a, i) => a + i.quantity, 0),
        revenueCents: Number(
          mine.filter((i) => i.type !== 'TIP').reduce((a, i) => a + i.totalCents, 0n),
        ),
        commissionCents: Number(
          commissions.filter((c) => c.barberId === id).reduce((a, c) => a + c.amountCents, 0n),
        ),
        tipsCents: Number(mine.filter((i) => i.type === 'TIP').reduce((a, i) => a + i.totalCents, 0n)),
        noShows: appointments.filter((a) => a.barberId === id && a.status === 'NO_SHOW').length,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);

  // --- Resultado ---
  const byCategory = new Map<string, bigint>();
  for (const e of expenses)
    byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? 0n) + e.amountCents);
  const expensesCents = [...byCategory.values()].reduce((a, b) => a + b, 0n);
  const commissionsCents = commissions.reduce((a, c) => a + c.amountCents, 0n);
  const productCostCents = items
    .filter((i) => i.type === 'PRODUCT' && i.product?.costCents)
    .reduce((a, i) => a + BigInt(i.quantity) * (i.product!.costCents ?? 0n), 0n);

  // --- Clientes y puntos ---
  const served = sales.filter((s) => s.customerId);
  const pointsOf = (type: string) =>
    points.filter((e) => e.type === type).reduce((a, e) => a + Math.abs(e.points), 0);
  const rewardCount = new Map<string, { count: number; pointsSpent: number }>();
  for (const r of redemptions) {
    const row = rewardCount.get(r.reward.name) ?? { count: 0, pointsSpent: 0 };
    row.count += 1;
    row.pointsSpent += r.pointsSpent;
    rewardCount.set(r.reward.name, row);
  }

  return {
    from: query.from,
    to: query.to,
    branchId: query.branchId ?? null,
    sales: {
      count: sales.length,
      grossCents: Number(grossCents),
      discountsCents: Number(discountsCents),
      incomeCents: Number(incomeCents),
      averageTicketCents: Number(averageTicketCents(incomeCents, sales.length)),
      byMethod: [...byMethod.entries()]
        .filter(([, amount]) => amount !== 0n)
        .map(([method, amount]) => ({ method, amountCents: Number(amount) }))
        .sort((a, b) => b.amountCents - a.amountCents),
      byDay: [...perDay.entries()].map(([date, d]) => ({
        date,
        amountCents: Number(d.amount),
        count: d.count,
      })),
    },
    services: ranked('SERVICE'),
    products: ranked('PRODUCT'),
    barbers: byBarber,
    result: {
      incomeCents: Number(incomeCents),
      expensesCents: Number(expensesCents),
      commissionsCents: Number(commissionsCents),
      productCostCents: Number(productCostCents),
      resultCents: Number(incomeCents - expensesCents - commissionsCents - productCostCents),
      expensesByCategory: [...byCategory.entries()]
        .map(([name, amount]) => ({ name, amountCents: Number(amount) }))
        .sort((a, b) => b.amountCents - a.amountCents),
    },
    customers: {
      ...splitNewReturning(
        served.map((s) => ({ customerId: s.customerId!, firstVisitAt: s.customer?.firstVisitAt ?? null })),
        range.startsAt,
        range.endsAt,
      ),
      served: new Set(served.map((s) => s.customerId)).size,
    },
    loyalty: {
      pointsEarned: pointsOf('EARN'),
      pointsRedeemed: pointsOf('REDEEM'),
      pointsExpired: pointsOf('EXPIRE'),
      rewardCostCents: Number(redemptions.reduce((a, r) => a + r.discountCents, 0n)),
      rewards: [...rewardCount.entries()]
        .map(([name, r]) => ({ name, ...r }))
        .sort((a, b) => b.count - a.count),
    },
  };
}
