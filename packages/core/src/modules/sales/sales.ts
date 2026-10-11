import type { Prisma, Tx } from '@estoicos/db';
import {
  addSaleItemBody,
  createSaleBody,
  instantToLocal,
  paySaleBody,
  saleListQuery,
  setSaleCustomerBody,
  updateSaleItemBody,
  voidSaleBody,
  type AddSaleItemBody,
  type PaySaleBody,
  type SaleDetail,
  type SaleListItem,
  type UpdateSaleItemBody,
  type VoidSaleBody,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreConfig, CoreDeps, RequestMeta } from '../../deps';
import { DomainError, Errors, isUniqueViolation } from '../../errors';
import { localDayRange } from '../../time';
import { writeAudit } from '../audit/audit';
import { earnPointsForSale, reversePointsForSale } from '../loyalty/points';
import { commissionBaseForRedeemedLine } from '../loyalty/calc';
import { commissionAmount, commissionRateBps, lineTotal, paymentsProblem, saleTotals } from './calc';

/**
 * Ventas (Fase 4). Una venta ABIERTA se arma (líneas, descuentos) y se cobra en un solo paso.
 * Al quedar PAGADA — punto único de consistencia (D9) — en UNA transacción se generan las
 * comisiones, se acreditan los puntos, se descuenta el stock, el turno pasa a "Atendido" y se
 * actualiza la última visita del cliente.
 */

const saleInclude = {
  customer: { select: { firstName: true, lastName: true, email: true } },
  createdBy: { select: { name: true } },
  items: {
    include: { barber: { select: { displayName: true } } },
    orderBy: { createdAt: 'asc' },
  },
  payments: {
    include: { receivedBy: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.SaleInclude;
type SaleRow = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

function customerName(c: SaleRow['customer']) {
  if (!c) return null;
  return `${c.firstName} ${c.lastName}`.trim() || c.email || 'Cliente';
}

function toDetail(s: SaleRow, stockWarnings: SaleDetail['stockWarnings'] = []): SaleDetail {
  return {
    id: s.id,
    number: s.number,
    branchId: s.branchId,
    status: s.status,
    customerId: s.customerId,
    customerName: customerName(s.customer),
    appointmentId: s.appointmentId,
    subtotalCents: Number(s.subtotalCents),
    discountCents: Number(s.discountCents),
    totalCents: Number(s.totalCents),
    paidCents: Number(s.paidCents),
    refundedCents: Number(s.refundedCents),
    remainingCents: s.status === 'OPEN' ? Number(s.totalCents - s.paidCents) : 0,
    notes: s.notes,
    items: s.items.map((i) => ({
      id: i.id,
      type: i.type,
      serviceId: i.serviceId,
      productId: i.productId,
      barberId: i.barberId,
      barberName: i.barber?.displayName ?? null,
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: Number(i.unitPriceCents),
      discountCents: Number(i.discountCents),
      totalCents: Number(i.totalCents),
      discountReason: i.discountReason,
      fromAppointment: !!i.appointmentServiceId,
    })),
    payments: s.payments.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amountCents: Number(p.amountCents),
      refundedCents: Number(p.refundedCents),
      reference: p.reference,
      receivedByName: p.receivedBy?.name ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    createdAt: s.createdAt.toISOString(),
    createdByName: s.createdBy.name,
    paidAt: s.paidAt?.toISOString() ?? null,
    voidedAt: s.voidedAt?.toISOString() ?? null,
    voidReason: s.voidReason,
    stockWarnings,
  };
}

async function loadSale(deps: CoreDeps, p: StaffPrincipal, saleId: string) {
  const sale = await deps.db.sale.findFirst({
    where: { id: saleId, organizationId: p.organizationId },
    include: saleInclude,
  });
  if (!sale) throw Errors.notFound('No encontramos esa venta.');
  requireBranchAccess(p, sale.branchId);
  return sale;
}

export async function getSale(deps: CoreDeps, p: StaffPrincipal, saleId: string): Promise<SaleDetail> {
  requirePermission(p, 'sales:charge');
  return toDetail(await loadSale(deps, p, saleId));
}

export async function listSales(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawQuery: z.input<typeof saleListQuery>,
): Promise<SaleListItem[]> {
  requirePermission(p, 'sales:charge');
  requireBranchAccess(p, branchId);
  const query = saleListQuery.parse(rawQuery);
  const branch = await deps.db.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { timezone: true },
  });
  // Qué tramo se mira: un rango si lo pidieron, si no el día indicado (por defecto, hoy).
  const desde = query.from ?? query.date ?? instantToLocal(deps.now(), branch.timezone).date;
  const hasta = query.to ?? query.from ?? query.date ?? desde;
  const range = localDayRange(desde, hasta, branch.timezone)!;
  // Buscar por número de venta o por nombre del cliente. Con búsqueda, la fecha no limita:
  // el que busca la venta #37 no se acuerda de qué día fue.
  const numero = query.q && /^#?\d+$/.test(query.q) ? Number(query.q.replace('#', '')) : null;
  const texto = query.q && numero === null ? query.q : null;
  const enElTramo = [
    { createdAt: { gte: range.startsAt, lt: range.endsAt } },
    { paidAt: { gte: range.startsAt, lt: range.endsAt } },
    // Las abiertas se arrastran: son las que hay que resolver.
    { status: 'OPEN' as const },
  ];
  const rows = await deps.db.sale.findMany({
    where: {
      branchId,
      ...(query.status ? { status: query.status } : {}),
      ...(numero !== null ? { number: numero } : {}),
      ...(texto
        ? {
            customer: {
              OR: [
                { firstName: { contains: texto, mode: 'insensitive' as const } },
                { lastName: { contains: texto, mode: 'insensitive' as const } },
                { email: { contains: texto, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
      ...(query.q ? {} : { OR: enElTramo }),
    },
    include: {
      customer: { select: { firstName: true, lastName: true, email: true } },
      items: { select: { description: true, quantity: true } },
      payments: {
        where: { status: { in: ['APPROVED', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
        select: { method: true },
      },
    },
    orderBy: { number: 'desc' },
    take: 200,
  });
  return rows.map((s) => ({
    id: s.id,
    number: s.number,
    status: s.status,
    customerName: s.customer
      ? `${s.customer.firstName} ${s.customer.lastName}`.trim() || s.customer.email
      : null,
    summary:
      s.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.description}` : i.description)).join(', ') ||
      'Sin ítems',
    totalCents: Number(s.totalCents),
    paidCents: Number(s.paidCents),
    methods: [...new Set(s.payments.map((x) => x.method))],
    createdAt: s.createdAt.toISOString(),
    paidAt: s.paidAt?.toISOString() ?? null,
  }));
}

/** Número legible por sucursal ("Venta #123"), en la misma transacción que la venta. */
async function nextSaleNumber(tx: Tx, branchId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO sequence_counters (key, value, updated_at) VALUES (${`sale:${branchId}`}, 1, now())
    ON CONFLICT (key) DO UPDATE SET value = sequence_counters.value + 1, updated_at = now()
    RETURNING value`;
  return rows[0]!.value;
}

/** Bloquea la venta hasta el fin de la transacción (serializa cobros, líneas y anulaciones). */
export async function lockSale(tx: Tx, saleId: string) {
  await tx.$queryRaw`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
  return tx.sale.findUniqueOrThrow({ where: { id: saleId } });
}

async function recalcTotals(tx: Tx, saleId: string) {
  const items = await tx.saleItem.findMany({ where: { saleId } });
  const totals = saleTotals(items);
  await tx.sale.update({ where: { id: saleId }, data: totals });
}

/**
 * "Cerrar servicio": crea la venta desde el turno con los servicios al PRECIO RESERVADO (P20).
 * Si el turno ya tiene su venta, devuelve esa (dos clics no crean dos ventas).
 */
export async function openSaleFromAppointment(
  deps: CoreDeps,
  p: StaffPrincipal,
  appointmentId: string,
): Promise<SaleDetail> {
  requirePermission(p, 'sales:charge');
  const appointment = await deps.db.appointment.findFirst({
    where: { id: appointmentId, organizationId: p.organizationId },
    include: {
      sale: { select: { id: true } },
      services: { include: { service: { select: { name: true } } }, orderBy: { position: 'asc' } },
    },
  });
  if (!appointment) throw Errors.notFound('No encontramos ese turno.');
  requireBranchAccess(p, appointment.branchId);
  if (appointment.sale) return getSale(deps, p, appointment.sale.id);
  if (!['BOOKED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(appointment.status)) {
    throw Errors.conflict('Este turno no se puede cobrar (está cancelado o el cliente no vino).');
  }

  try {
    const saleId = await deps.db.$transaction(async (tx) => {
      const lines = appointment.services.map((s) => ({
        type: 'SERVICE' as const,
        serviceId: s.serviceId,
        barberId: appointment.barberId,
        appointmentServiceId: s.id,
        description: s.service.name,
        quantity: 1,
        unitPriceCents: s.priceCents,
        discountCents: 0n,
        totalCents: s.priceCents,
      }));
      const sale = await tx.sale.create({
        data: {
          organizationId: p.organizationId,
          branchId: appointment.branchId,
          number: await nextSaleNumber(tx, appointment.branchId),
          customerId: appointment.customerId,
          appointmentId: appointment.id,
          createdById: p.userId,
          ...saleTotals(lines),
          items: { create: lines },
        },
      });
      return sale.id;
    });
    return getSale(deps, p, saleId);
  } catch (error) {
    // Dos pedidos a la vez: el segundo choca con el UNIQUE del turno y devuelve la misma venta.
    if (isUniqueViolation(error)) {
      const existing = await deps.db.sale.findUniqueOrThrow({ where: { appointmentId } });
      return getSale(deps, p, existing.id);
    }
    throw error;
  }
}

/** Venta de mostrador (productos, un servicio sin turno). */
export async function createCounterSale(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawBody: z.input<typeof createSaleBody>,
): Promise<SaleDetail> {
  requirePermission(p, 'sales:charge');
  requireBranchAccess(p, branchId);
  const body = createSaleBody.parse(rawBody);
  if (body.customerId) await requireCustomer(deps, p, body.customerId);
  const saleId = await deps.db.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        organizationId: p.organizationId,
        branchId,
        number: await nextSaleNumber(tx, branchId),
        customerId: body.customerId ?? null,
        createdById: p.userId,
      },
    });
    return sale.id;
  });
  return getSale(deps, p, saleId);
}

async function requireCustomer(deps: CoreDeps, p: StaffPrincipal, customerId: string) {
  const found = await deps.db.customer.findFirst({
    where: { id: customerId, organizationId: p.organizationId, anonymizedAt: null, mergedIntoId: null },
    select: { id: true },
  });
  if (!found) throw Errors.invalid('No encontramos ese cliente.');
}

async function requireBarberInBranch(tx: Tx, organizationId: string, branchId: string, barberId: string) {
  const barber = await tx.barber.findFirst({
    where: { id: barberId, organizationId, branches: { some: { branchId } } },
    select: { id: true },
  });
  if (!barber) throw Errors.invalid('Ese barbero no trabaja en esta sucursal.');
}

function assertOpen(sale: { status: string }) {
  if (sale.status !== 'OPEN') {
    throw Errors.conflict(sale.status === 'PAID' ? 'La venta ya está cobrada.' : 'La venta está anulada.');
  }
}

export async function setSaleCustomer(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
  rawBody: z.input<typeof setSaleCustomerBody>,
): Promise<SaleDetail> {
  requirePermission(p, 'sales:charge');
  const current = await loadSale(deps, p, saleId);
  const body = setSaleCustomerBody.parse(rawBody);
  if (body.customerId) await requireCustomer(deps, p, body.customerId);
  await deps.db.$transaction(async (tx) => {
    assertOpen(await lockSale(tx, saleId));
    await tx.sale.update({ where: { id: current.id }, data: { customerId: body.customerId } });
  });
  return getSale(deps, p, saleId);
}

export async function addSaleItem(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
  rawBody: AddSaleItemBody,
): Promise<SaleDetail> {
  requirePermission(p, 'sales:charge');
  const current = await loadSale(deps, p, saleId);
  const body = addSaleItemBody.parse(rawBody);
  const branchId = current.branchId;

  await deps.db.$transaction(async (tx) => {
    assertOpen(await lockSale(tx, saleId));
    if (body.type === 'PRODUCT') {
      const product = await tx.product.findFirst({
        where: {
          id: body.productId,
          organizationId: p.organizationId,
          active: true,
          archivedAt: null,
          branchProducts: { some: { branchId, active: true } },
        },
        include: { branchProducts: { where: { branchId } } },
      });
      if (!product) throw Errors.invalid('Ese producto no se vende en esta sucursal.');
      if (body.barberId) await requireBarberInBranch(tx, p.organizationId, branchId, body.barberId);
      const price = product.branchProducts[0]?.priceCentsOverride ?? product.basePriceCents;
      // El mismo producto (mismo vendedor, sin descuento) suma cantidad en la misma línea.
      const same = await tx.saleItem.findFirst({
        where: {
          saleId,
          type: 'PRODUCT',
          productId: product.id,
          barberId: body.barberId ?? null,
          discountCents: 0,
          unitPriceCents: price,
        },
      });
      if (same) {
        const quantity = same.quantity + body.quantity;
        await tx.saleItem.update({
          where: { id: same.id },
          data: { quantity, totalCents: lineTotal({ ...same, quantity }) },
        });
      } else {
        await tx.saleItem.create({
          data: {
            saleId,
            type: 'PRODUCT',
            productId: product.id,
            barberId: body.barberId ?? null,
            description: product.name,
            quantity: body.quantity,
            unitPriceCents: price,
            totalCents: price * BigInt(body.quantity),
          },
        });
      }
    } else if (body.type === 'SERVICE') {
      const service = await tx.service.findFirst({
        where: {
          id: body.serviceId,
          organizationId: p.organizationId,
          active: true,
          archivedAt: null,
          branchServices: { some: { branchId, active: true } },
        },
        include: { branchServices: { where: { branchId } } },
      });
      if (!service) throw Errors.invalid('Ese servicio no se ofrece en esta sucursal.');
      await requireBarberInBranch(tx, p.organizationId, branchId, body.barberId);
      const price = service.branchServices[0]?.priceCentsOverride ?? service.basePriceCents;
      await tx.saleItem.create({
        data: {
          saleId,
          type: 'SERVICE',
          serviceId: service.id,
          barberId: body.barberId,
          description: service.name,
          unitPriceCents: price,
          totalCents: price,
        },
      });
    } else {
      await requireBarberInBranch(tx, p.organizationId, branchId, body.barberId);
      const amount = BigInt(body.amountCents);
      await tx.saleItem.create({
        data: {
          saleId,
          type: 'TIP',
          barberId: body.barberId,
          description: 'Propina',
          unitPriceCents: amount,
          totalCents: amount,
        },
      });
    }
    await recalcTotals(tx, saleId);
  });
  return getSale(deps, p, saleId);
}

/**
 * Cantidad, vendedor, precio o descuento de una línea. Cambiar el precio o descontar es solo
 * del dueño o el encargado (P12) y queda auditado con el motivo.
 */
export async function updateSaleItem(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
  itemId: string,
  rawBody: UpdateSaleItemBody,
  meta: RequestMeta,
): Promise<SaleDetail> {
  requirePermission(p, 'sales:charge');
  const current = await loadSale(deps, p, saleId);
  const body = updateSaleItemBody.parse(rawBody);

  await deps.db.$transaction(async (tx) => {
    assertOpen(await lockSale(tx, saleId));
    const item = await tx.saleItem.findFirst({ where: { id: itemId, saleId } });
    if (!item) throw Errors.notFound('No encontramos esa línea.');

    const next = {
      quantity: body.quantity ?? item.quantity,
      unitPriceCents: body.unitPriceCents !== undefined ? BigInt(body.unitPriceCents) : item.unitPriceCents,
      discountCents: body.discountCents !== undefined ? BigInt(body.discountCents) : item.discountCents,
    };
    if (item.type !== 'PRODUCT' && next.quantity !== 1) {
      throw Errors.invalid('Los servicios y las propinas van de a uno.');
    }
    const priceChanged = next.unitPriceCents !== item.unitPriceCents && item.type !== 'TIP';
    const discountChanged = next.discountCents !== item.discountCents;
    if (priceChanged || discountChanged) requirePermission(p, 'sales:discount');
    if (next.discountCents > BigInt(next.quantity) * next.unitPriceCents) {
      throw Errors.invalid('El descuento no puede superar el precio.');
    }
    const reason = body.discountReason ?? null;
    if ((priceChanged || (discountChanged && next.discountCents > 0n)) && !reason) {
      throw Errors.invalid('Contá el motivo del descuento o del cambio de precio.');
    }
    if (body.barberId !== undefined) {
      if (item.type !== 'PRODUCT' && !body.barberId) throw Errors.invalid('Elegí el barbero.');
      if (body.barberId) await requireBarberInBranch(tx, p.organizationId, current.branchId, body.barberId);
    }

    await tx.saleItem.update({
      where: { id: item.id },
      data: {
        ...next,
        totalCents: lineTotal(next),
        ...(discountChanged || priceChanged ? { discountReason: reason } : {}),
        ...(body.barberId !== undefined ? { barberId: body.barberId } : {}),
      },
    });
    await recalcTotals(tx, saleId);

    if (priceChanged || discountChanged) {
      await writeAudit(tx, {
        organizationId: p.organizationId,
        branchId: current.branchId,
        actor: { type: 'STAFF', userId: p.userId },
        action: priceChanged ? 'SALE_PRICE_OVERRIDDEN' : 'SALE_DISCOUNT_APPLIED',
        entityType: 'Sale',
        entityId: saleId,
        summary: `Venta #${current.number}: ${item.description}`,
        before: { unitPriceCents: Number(item.unitPriceCents), discountCents: Number(item.discountCents) },
        after: { unitPriceCents: Number(next.unitPriceCents), discountCents: Number(next.discountCents) },
        reason: reason ?? undefined,
        meta,
      });
    }
  });
  return getSale(deps, p, saleId);
}

export async function removeSaleItem(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
  itemId: string,
): Promise<SaleDetail> {
  requirePermission(p, 'sales:charge');
  await loadSale(deps, p, saleId);
  await deps.db.$transaction(async (tx) => {
    assertOpen(await lockSale(tx, saleId));
    const deleted = await tx.saleItem.deleteMany({ where: { id: itemId, saleId } });
    if (deleted.count === 0) throw Errors.notFound('No encontramos esa línea.');
    await recalcTotals(tx, saleId);
  });
  return getSale(deps, p, saleId);
}

/** Caja abierta de la sucursal (P25: no se cobra sin abrir la caja). */
export async function requireOpenCashSession(tx: Tx, organizationId: string, branchId: string) {
  const settings = await tx.organizationSettings.findUnique({ where: { organizationId } });
  const session = await tx.cashSession.findFirst({ where: { branchId, status: 'OPEN' } });
  if (!session && (settings?.requireOpenCashSession ?? true)) {
    throw new DomainError('CASH_CLOSED', 'Abrí la caja para poder cobrar.', 409);
  }
  return session;
}

/**
 * Cobrar: pagos que suman exactamente lo que falta, y la venta queda PAGADA con todos sus
 * efectos en la MISMA transacción (todo o nada).
 */
export async function paySale(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
  rawBody: PaySaleBody,
): Promise<SaleDetail> {
  requirePermission(p, 'sales:charge');
  const current = await loadSale(deps, p, saleId);
  const body = paySaleBody.parse(rawBody);
  const now = deps.now();

  const warnings = await deps.db.$transaction(
    async (tx) => {
      const sale = await lockSale(tx, saleId);
      assertOpen(sale);
      const itemCount = await tx.saleItem.count({ where: { saleId } });
      if (itemCount === 0) throw Errors.invalid('La venta no tiene nada para cobrar.');
      const problem = paymentsProblem(
        sale.totalCents - sale.paidCents,
        body.payments.map((x) => BigInt(x.amountCents)),
      );
      if (problem) throw Errors.invalid(problem);
      const session = await requireOpenCashSession(tx, p.organizationId, sale.branchId);

      for (const payment of body.payments) {
        await tx.payment.create({
          data: {
            organizationId: p.organizationId,
            branchId: sale.branchId,
            purpose: 'SALE',
            method: payment.method,
            status: 'APPROVED',
            amountCents: BigInt(payment.amountCents),
            saleId,
            customerId: sale.customerId,
            cashSessionId: session?.id ?? null,
            reference: payment.reference,
            receivedById: p.userId,
            approvedAt: now,
          },
        });
      }
      return settleSaleIfCovered(tx, { saleId, userId: p.userId, now, config: deps.config });
    },
    { maxWait: 5_000, timeout: 20_000 },
  );

  return toDetail(await loadSale(deps, p, current.id), warnings);
}

/**
 * Suma los cobros aprobados y, si cubren el total, cierra la venta. Lo usan el cobro en el
 * local y el cobro con Point (que se aprueba después, cuando avisa Mercado Pago).
 * Se llama con la venta ya bloqueada.
 */
export async function settleSaleIfCovered(
  tx: Tx,
  input: { saleId: string; userId: string; now: Date; config?: CoreConfig },
): Promise<SaleDetail['stockWarnings']> {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: input.saleId } });
  const approved = await tx.payment.aggregate({
    where: { saleId: input.saleId, status: 'APPROVED' },
    _sum: { amountCents: true },
  });
  const paid = approved._sum.amountCents ?? 0n;
  if (paid !== sale.paidCents)
    await tx.sale.update({ where: { id: input.saleId }, data: { paidCents: paid } });
  if (sale.status !== 'OPEN' || sale.totalCents < 0n || paid < sale.totalCents) return [];
  // Una venta en $0 (todo pagado con puntos) se cierra sin cobros, pero nunca una venta vacía.
  if (sale.totalCents === 0n && (await tx.saleItem.count({ where: { saleId: input.saleId } })) === 0) return [];
  return finalizeSale(tx, input);
}

/**
 * Punto único de consistencia (D9). Se llama con la venta bloqueada y ya cubierta por los cobros.
 * Idempotente por claves únicas: una comisión por línea ("earn:<línea>").
 */
async function finalizeSale(
  tx: Tx,
  input: { saleId: string; userId: string; now: Date; config?: CoreConfig },
): Promise<SaleDetail['stockWarnings']> {
  const { saleId, now } = input;
  const sale = await tx.sale.update({
    where: { id: saleId },
    data: { status: 'PAID', paidAt: now },
    include: {
      items: {
        include: {
          barber: true,
          service: { select: { commissionBpsOverride: true } },
          product: { select: { commissionBpsOverride: true, trackStock: true, name: true } },
        },
      },
      appointment: { select: { id: true, status: true } },
    },
  });

  // 1. Turno → Atendido.
  if (sale.appointment && ['BOOKED', 'CONFIRMED', 'IN_PROGRESS'].includes(sale.appointment.status)) {
    await tx.appointment.update({
      where: { id: sale.appointment.id },
      data: { status: 'COMPLETED', completedAt: now },
    });
    await tx.appointmentEvent.create({
      data: {
        appointmentId: sale.appointment.id,
        type: 'STATUS_CHANGED',
        fromStatus: sale.appointment.status,
        toStatus: 'COMPLETED',
        actorType: 'STAFF',
        actorUserId: input.userId,
        note: `Cobrado (venta #${sale.number})`,
      },
    });
  }

  // 2. Comisiones por línea. Si la línea se pagó con puntos, la comisión va sobre el precio sin
  // el descuento del canje (P27): el barbero no pierde plata porque el cliente usó su premio.
  const commissionSettings = await tx.organizationSettings.findUnique({
    where: { organizationId: sale.organizationId },
    select: { rewardCommissionBase: true },
  });
  const redeemed = new Map(
    (await tx.rewardRedemption.findMany({ where: { saleId, status: 'APPLIED' } }))
      .filter((r) => r.saleItemId)
      .map((r) => [r.saleItemId!, r.discountCents]),
  );
  for (const item of sale.items) {
    if (!item.barber) continue;
    const barberService =
      item.type === 'SERVICE' && item.serviceId
        ? await tx.barberService.findUnique({
            where: { barberId_serviceId: { barberId: item.barber.id, serviceId: item.serviceId } },
            select: { commissionBpsOverride: true },
          })
        : null;
    const rateBps = commissionRateBps({
      itemType: item.type,
      barber: item.barber,
      barberServiceBps: barberService?.commissionBpsOverride,
      serviceBps: item.service?.commissionBpsOverride,
      productBps: item.product?.commissionBpsOverride,
    });
    if (rateBps === 0) continue;
    const rewardDiscount = redeemed.get(item.id);
    const baseCents = rewardDiscount
      ? commissionBaseForRedeemedLine(commissionSettings?.rewardCommissionBase ?? 'LIST_PRICE', {
          grossCents: item.totalCents + rewardDiscount,
          chargedCents: item.totalCents,
        })
      : item.totalCents;
    await tx.commissionEntry.create({
      data: {
        organizationId: sale.organizationId,
        branchId: sale.branchId,
        barberId: item.barber.id,
        saleId,
        saleItemId: item.id,
        kind: 'EARNED',
        itemType: item.type,
        baseCents,
        rateBps,
        amountCents: commissionAmount(baseCents, rateBps),
        occurredAt: now,
        idempotencyKey: `earn:${item.id}`,
      },
    });
  }

  // 3. Stock: movimiento inmutable + saldo actualizado con UPDATE atómico (ventas simultáneas).
  const settings = await tx.organizationSettings.findUnique({
    where: { organizationId: sale.organizationId },
  });
  const warnings: SaleDetail['stockWarnings'] = [];
  for (const item of sale.items) {
    if (item.type !== 'PRODUCT' || !item.productId || !item.product?.trackStock) continue;
    const balance = await changeStock(tx, sale.branchId, item.productId, -item.quantity);
    if (balance.stockOnHand < 0 && settings && !settings.allowNegativeStock) {
      throw Errors.conflict(`No hay stock suficiente de ${item.product.name}.`);
    }
    await tx.stockMovement.create({
      data: {
        organizationId: sale.organizationId,
        branchId: sale.branchId,
        productId: item.productId,
        type: 'SALE',
        quantity: -item.quantity,
        balanceAfter: balance.stockOnHand,
        saleItemId: item.id,
        createdById: input.userId,
      },
    });
    if (balance.stockOnHand < 0 || (balance.minStock !== null && balance.stockOnHand <= balance.minStock)) {
      warnings.push({ productName: item.product.name, stockOnHand: balance.stockOnHand });
    }
  }

  // 4. Puntos del programa de fidelidad.
  await earnPointsForSale(tx, { saleId, now, config: input.config });

  // 5. Primera y última visita del cliente.
  if (sale.customerId) {
    await tx.customer.updateMany({
      where: { id: sale.customerId, firstVisitAt: null },
      data: { firstVisitAt: now },
    });
    await tx.customer.update({ where: { id: sale.customerId }, data: { lastVisitAt: now } });
  }
  return warnings;
}

/** Suma o resta stock en una sucursal de forma atómica. Devuelve el saldo nuevo. */
export async function changeStock(tx: Tx, branchId: string, productId: string, delta: number) {
  const rows = await tx.$queryRaw<{ stock_on_hand: number; min_stock: number | null }[]>`
    INSERT INTO branch_products (branch_id, product_id, stock_on_hand, active, updated_at)
    VALUES (${branchId}::uuid, ${productId}::uuid, ${delta}, true, now())
    ON CONFLICT (branch_id, product_id)
    DO UPDATE SET stock_on_hand = branch_products.stock_on_hand + ${delta}, updated_at = now()
    RETURNING stock_on_hand, min_stock`;
  return { stockOnHand: rows[0]!.stock_on_hand, minStock: rows[0]!.min_stock };
}

/**
 * Anular (solo dueño o encargado). Una venta cobrada se revierte con registros nuevos, nunca
 * borrando: reintegro de cada cobro (el efectivo sale de la caja abierta), reversa de cada
 * comisión y devolución del stock. El turno queda "Atendido": para volver a cobrarlo se hace
 * una venta de mostrador.
 */
export async function voidSale(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
  rawBody: VoidSaleBody,
  meta: RequestMeta,
): Promise<SaleDetail> {
  requirePermission(p, 'sales:void');
  const current = await loadSale(deps, p, saleId);
  const body = voidSaleBody.parse(rawBody);
  const now = deps.now();

  await deps.db.$transaction(
    async (tx) => {
      const sale = await lockSale(tx, saleId);
      if (sale.status === 'VOIDED') throw Errors.conflict('La venta ya está anulada.');

      if (sale.status === 'PAID') {
        const payments = await tx.payment.findMany({ where: { saleId, status: 'APPROVED' } });
        const session = await tx.cashSession.findFirst({
          where: { branchId: sale.branchId, status: 'OPEN' },
        });
        if (payments.some((x) => x.method === 'CASH') && !session) {
          throw new DomainError(
            'CASH_CLOSED',
            'Abrí la caja: el efectivo se devuelve desde la caja del día.',
            409,
          );
        }
        for (const payment of payments) {
          await tx.refund.create({
            data: {
              paymentId: payment.id,
              amountCents: payment.amountCents,
              destination: 'ORIGINAL_METHOD',
              status: 'APPROVED',
              reason: body.reason,
              cashSessionId: session?.id ?? null,
              createdById: p.userId,
              processedAt: now,
            },
          });
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'REFUNDED', refundedCents: payment.amountCents },
          });
        }

        const entries = await tx.commissionEntry.findMany({
          where: { saleId, kind: 'EARNED', reversals: { none: {} } },
        });
        for (const entry of entries) {
          await tx.commissionEntry.create({
            data: {
              organizationId: entry.organizationId,
              branchId: entry.branchId,
              barberId: entry.barberId,
              saleId,
              saleItemId: entry.saleItemId,
              kind: 'REVERSAL',
              itemType: entry.itemType,
              baseCents: -entry.baseCents,
              rateBps: entry.rateBps,
              amountCents: -entry.amountCents,
              occurredAt: now,
              reversesEntryId: entry.id,
              reason: `Venta #${sale.number} anulada`,
              createdById: p.userId,
              idempotencyKey: `reversal:${entry.id}`,
            },
          });
        }

        // Los puntos ganados se revierten y los canjeados se devuelven al cliente.
        await reversePointsForSale(tx, { saleId, now });

        const movements = await tx.stockMovement.findMany({ where: { saleItem: { saleId }, type: 'SALE' } });
        for (const m of movements) {
          const balance = await changeStock(tx, m.branchId, m.productId, -m.quantity);
          await tx.stockMovement.create({
            data: {
              organizationId: m.organizationId,
              branchId: m.branchId,
              productId: m.productId,
              type: 'SALE_VOID',
              quantity: -m.quantity,
              balanceAfter: balance.stockOnHand,
              saleItemId: m.saleItemId,
              reason: body.reason,
              createdById: p.userId,
            },
          });
        }
      }

      await tx.sale.update({
        where: { id: saleId },
        data: {
          status: 'VOIDED',
          voidedAt: now,
          voidedById: p.userId,
          voidReason: body.reason,
          ...(sale.status === 'PAID' ? { refundedCents: sale.paidCents } : {}),
        },
      });
      await writeAudit(tx, {
        organizationId: p.organizationId,
        branchId: sale.branchId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'SALE_VOIDED',
        entityType: 'Sale',
        entityId: saleId,
        summary: `Venta #${sale.number} anulada (${sale.status === 'PAID' ? 'estaba cobrada' : 'estaba abierta'})`,
        before: {
          status: sale.status,
          totalCents: Number(sale.totalCents),
          paidCents: Number(sale.paidCents),
        },
        reason: body.reason,
        meta,
      });
    },
    { maxWait: 5_000, timeout: 20_000 },
  );
  return toDetail(await loadSale(deps, p, current.id));
}
