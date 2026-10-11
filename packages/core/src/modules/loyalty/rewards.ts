import { randomUUID } from 'node:crypto';
import type { Prisma } from '@estoicos/db';
import {
  adjustPointsBody,
  redeemRewardBody,
  rewardBody,
  updateLoyaltySettingsBody,
  type AdjustPointsBody,
  type CustomerPoints,
  type LoyaltySettings,
  type MyPoints,
  type RedeemRewardBody,
  type RewardBody,
  type RewardDto,
  type SaleLoyalty,
  type UpdateLoyaltySettingsBody,
} from '@estoicos/shared';
import { requirePermission, type CustomerPrincipal, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors } from '../../errors';
import { writeAudit } from '../audit/audit';
import { lockSale } from '../sales/sales';
import { rewardDiscountFor } from './calc';
import { loyaltyRule, pointsBalance } from './points';

/**
 * Catálogo de recompensas y canje en el cobro. El canje toma el lock del cliente para que dos
 * cobros simultáneos no gasten el mismo saldo, y deja la fila REDEEM en el ledger.
 */
const rewardInclude = {
  service: { select: { name: true } },
  product: { select: { name: true } },
  _count: { select: { redemptions: { where: { status: 'APPLIED' } } } },
} as const satisfies Prisma.RewardInclude;
type RewardRow = Prisma.RewardGetPayload<{ include: typeof rewardInclude }>;

function toDto(r: RewardRow): RewardDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    pointsCost: r.pointsCost,
    serviceId: r.serviceId,
    serviceName: r.service?.name ?? null,
    productId: r.productId,
    productName: r.product?.name ?? null,
    discountFixedCents: r.discountFixedCents === null ? null : Number(r.discountFixedCents),
    discountPercentBps: r.discountPercentBps,
    active: r.active,
    archived: !!r.archivedAt,
    redemptions: r._count.redemptions,
  };
}

export async function getLoyaltySettings(deps: CoreDeps, p: StaffPrincipal): Promise<LoyaltySettings> {
  requirePermission(p, 'loyalty:adjust');
  const s = await deps.db.organizationSettings.findUniqueOrThrow({ where: { organizationId: p.organizationId } });
  return {
    enabled: s.loyaltyEnabled,
    pointsPerStep: s.loyaltyPointsPerStep,
    spendStepCents: Number(s.loyaltySpendStepCents),
    expiryMonths: s.loyaltyPointsExpiryMonths,
    earnOnProducts: s.loyaltyEarnOnProducts,
    rewardCommissionBase: s.rewardCommissionBase,
  };
}

export async function updateLoyaltySettings(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: UpdateLoyaltySettingsBody,
  meta: RequestMeta,
): Promise<LoyaltySettings> {
  requirePermission(p, 'loyalty:settings');
  const body = updateLoyaltySettingsBody.parse(rawBody);
  const before = await getLoyaltySettings(deps, p);
  await deps.db.$transaction(async (tx) => {
    await tx.organizationSettings.update({
      where: { organizationId: p.organizationId },
      data: {
        ...(body.enabled !== undefined ? { loyaltyEnabled: body.enabled } : {}),
        ...(body.pointsPerStep !== undefined ? { loyaltyPointsPerStep: body.pointsPerStep } : {}),
        ...(body.spendStepCents !== undefined ? { loyaltySpendStepCents: BigInt(body.spendStepCents) } : {}),
        ...(body.expiryMonths !== undefined ? { loyaltyPointsExpiryMonths: body.expiryMonths } : {}),
        ...(body.earnOnProducts !== undefined ? { loyaltyEarnOnProducts: body.earnOnProducts } : {}),
        ...(body.rewardCommissionBase ? { rewardCommissionBase: body.rewardCommissionBase } : {}),
      },
    });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'SETTINGS_CHANGED',
      entityType: 'OrganizationSettings',
      entityId: p.organizationId,
      summary: 'Reglas del programa de puntos',
      before: before as unknown as Prisma.InputJsonValue,
      after: body as Prisma.InputJsonValue,
      meta,
    });
  });
  return getLoyaltySettings(deps, p);
}

export async function listRewards(deps: CoreDeps, p: StaffPrincipal): Promise<RewardDto[]> {
  requirePermission(p, 'loyalty:adjust');
  const rows = await deps.db.reward.findMany({
    where: { organizationId: p.organizationId },
    include: rewardInclude,
    orderBy: [{ archivedAt: 'asc' }, { sortOrder: 'asc' }, { pointsCost: 'asc' }],
  });
  return rows.map(toDto);
}

export async function saveReward(
  deps: CoreDeps,
  p: StaffPrincipal,
  rewardId: string | null,
  rawBody: RewardBody,
): Promise<RewardDto[]> {
  requirePermission(p, 'loyalty:settings');
  const body = rewardBody.parse(rawBody);
  const data = {
    name: body.name,
    description: body.description,
    type: body.type,
    pointsCost: body.pointsCost,
    serviceId: body.type === 'FREE_SERVICE' ? body.serviceId! : null,
    productId: body.type === 'FREE_PRODUCT' ? body.productId! : null,
    discountFixedCents: body.type === 'FIXED_DISCOUNT' ? BigInt(body.discountFixedCents!) : null,
    discountPercentBps: body.type === 'PERCENT_DISCOUNT' ? body.discountPercentBps! : null,
    active: body.active,
  };
  if (rewardId) {
    const found = await deps.db.reward.findFirst({ where: { id: rewardId, organizationId: p.organizationId } });
    if (!found) throw Errors.notFound('No encontramos esa recompensa.');
    await deps.db.reward.update({ where: { id: rewardId }, data });
  } else {
    await deps.db.reward.create({ data: { ...data, organizationId: p.organizationId } });
  }
  return listRewards(deps, p);
}

/** Las recompensas no se borran: se archivan (pueden tener canjes en el historial). */
export async function archiveReward(deps: CoreDeps, p: StaffPrincipal, rewardId: string): Promise<RewardDto[]> {
  requirePermission(p, 'loyalty:settings');
  const found = await deps.db.reward.findFirst({ where: { id: rewardId, organizationId: p.organizationId } });
  if (!found) throw Errors.notFound('No encontramos esa recompensa.');
  await deps.db.reward.update({
    where: { id: rewardId },
    data: { archivedAt: found.archivedAt ? null : deps.now(), active: !!found.archivedAt },
  });
  return listRewards(deps, p);
}

// ---------------------------------------------------------------------------
// Saldo del cliente
// ---------------------------------------------------------------------------

const EXPIRY_WARNING_DAYS = 60;

export async function customerPoints(deps: CoreDeps, customerId: string): Promise<CustomerPoints> {
  const entries = await deps.db.pointsEntry.findMany({
    where: { customerId },
    include: { sale: { select: { number: true } } },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  const balance = await pointsBalance(deps.db, customerId);
  const soon = new Date(deps.now().getTime() + EXPIRY_WARNING_DAYS * 86_400_000);
  const expiring = await deps.db.pointsEntry.findMany({
    where: { customerId, type: 'EARN', expiresAt: { gt: deps.now(), lte: soon } },
    orderBy: { expiresAt: 'asc' },
  });
  // Solo tiene sentido avisar de lo que realmente le queda.
  const expiringSoon = Math.min(
    expiring.reduce((total, e) => total + e.points, 0),
    Math.max(balance, 0),
  );
  return {
    balance,
    expiringSoon,
    expiringOn: expiringSoon > 0 ? (expiring[0]?.expiresAt?.toISOString() ?? null) : null,
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      points: e.points,
      reason: e.reason,
      saleNumber: e.sale?.number ?? null,
      expiresAt: e.expiresAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export async function getCustomerPoints(
  deps: CoreDeps,
  p: StaffPrincipal,
  customerId: string,
): Promise<CustomerPoints> {
  requirePermission(p, 'customers:read');
  const customer = await deps.db.customer.findFirst({
    where: { id: customerId, organizationId: p.organizationId },
    select: { id: true },
  });
  if (!customer) throw Errors.notFound('No encontramos ese cliente.');
  return customerPoints(deps, customerId);
}

/** Ajuste manual: solo admin y con motivo obligatorio (lo exige también la base). */
export async function adjustPoints(
  deps: CoreDeps,
  p: StaffPrincipal,
  customerId: string,
  rawBody: AdjustPointsBody,
  meta: RequestMeta,
): Promise<CustomerPoints> {
  requirePermission(p, 'loyalty:adjust');
  const body = adjustPointsBody.parse(rawBody);
  const customer = await deps.db.customer.findFirst({
    where: { id: customerId, organizationId: p.organizationId, anonymizedAt: null },
  });
  if (!customer) throw Errors.notFound('No encontramos ese cliente.');

  await deps.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`points:${customerId}`}, 0))`;
    await tx.pointsEntry.create({
      data: {
        organizationId: p.organizationId,
        customerId,
        type: 'ADJUST',
        points: body.points,
        createdAt: deps.now(),
        reason: body.reason,
        createdById: p.userId,
        // Única por ajuste: dos ajustes al mismo cliente en el mismo instante son válidos
        // (el reloj no alcanza para distinguirlos) y cada uno queda auditado aparte.
        idempotencyKey: `adjust:${randomUUID()}`,
      },
    });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'POINTS_ADJUSTED',
      entityType: 'Customer',
      entityId: customerId,
      summary: `${body.points > 0 ? '+' : ''}${body.points} puntos a ${customer.firstName} ${customer.lastName}`.trim(),
      after: { points: body.points },
      reason: body.reason,
      meta,
    });
  });
  return customerPoints(deps, customerId);
}

// ---------------------------------------------------------------------------
// Canje en el cobro
// ---------------------------------------------------------------------------

/** Qué puede canjear el cliente en esta venta. */
export async function saleLoyalty(deps: CoreDeps, p: StaffPrincipal, saleId: string): Promise<SaleLoyalty> {
  requirePermission(p, 'sales:charge');
  const sale = await deps.db.sale.findFirst({
    where: { id: saleId, organizationId: p.organizationId },
    include: { items: true, rewardRedemptions: { where: { status: 'APPLIED' }, include: { reward: true } } },
  });
  if (!sale) throw Errors.notFound('No encontramos esa venta.');
  const rule = await loyaltyRule(deps.db, p.organizationId);

  const redemptions = sale.rewardRedemptions.map((r) => ({
    id: r.id,
    rewardName: r.reward.name,
    pointsSpent: r.pointsSpent,
    saleItemId: r.saleItemId,
  }));
  if (!sale.customerId || !rule.enabled) {
    return { customerId: sale.customerId, balance: 0, rewards: [], redemptions };
  }

  const balance = await pointsBalance(deps.db, sale.customerId);
  const rewards = await deps.db.reward.findMany({
    where: { organizationId: p.organizationId, active: true, archivedAt: null },
    orderBy: { pointsCost: 'asc' },
  });
  const usedItems = new Set(sale.rewardRedemptions.map((r) => r.saleItemId).filter(Boolean));

  return {
    customerId: sale.customerId,
    balance,
    redemptions,
    rewards: rewards.map((reward) => ({
      id: reward.id,
      name: reward.name,
      pointsCost: reward.pointsCost,
      type: reward.type,
      affordable: balance >= reward.pointsCost,
      applicableItemIds: sale.items
        .filter((item) => !usedItems.has(item.id) && item.type !== 'TIP')
        .filter((item) => rewardDiscountFor(reward, item) !== null)
        .map((item) => item.id),
    })),
  };
}

/**
 * Canjea una recompensa en la venta: descuenta los puntos y aplica el descuento en la línea.
 * Toma el lock del cliente: dos cobros a la vez no pueden gastar el mismo saldo.
 */
export async function redeemReward(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
  rawBody: RedeemRewardBody,
): Promise<SaleLoyalty> {
  requirePermission(p, 'sales:charge');
  const body = redeemRewardBody.parse(rawBody);
  const now = deps.now();

  await deps.db.$transaction(async (tx) => {
    const sale = await tx.sale.findFirstOrThrow({ where: { id: saleId, organizationId: p.organizationId } });
    if (!sale.customerId) throw Errors.invalid('Para canjear puntos hay que elegir el cliente.');
    if (sale.status !== 'OPEN') throw Errors.conflict('La venta ya no está abierta.');
    // Orden fijo cliente → venta: sin deadlocks.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`points:${sale.customerId}`}, 0))`;
    await lockSale(tx, saleId);

    const rule = await loyaltyRule(tx, p.organizationId);
    if (!rule.enabled) throw Errors.conflict('El programa de puntos está apagado.');
    const reward = await tx.reward.findFirst({
      where: { id: body.rewardId, organizationId: p.organizationId, active: true, archivedAt: null },
    });
    if (!reward) throw Errors.invalid('Esa recompensa ya no está disponible.');

    const balance = await pointsBalance(tx, sale.customerId);
    if (balance < reward.pointsCost) {
      throw Errors.conflict(`Le faltan ${reward.pointsCost - balance} puntos para esa recompensa.`);
    }

    // Se busca la línea: la indicada, o la primera a la que aplique.
    const items = await tx.saleItem.findMany({ where: { saleId }, orderBy: { createdAt: 'asc' } });
    const used = new Set(
      (await tx.rewardRedemption.findMany({ where: { saleId, status: 'APPLIED' } }))
        .map((r) => r.saleItemId)
        .filter(Boolean),
    );
    const candidates = items.filter((i) => !used.has(i.id) && i.type !== 'TIP');
    const item = body.saleItemId
      ? candidates.find((i) => i.id === body.saleItemId)
      : candidates.find((i) => rewardDiscountFor(reward, i) !== null);
    if (!item) throw Errors.invalid('No hay ninguna línea de la venta donde aplicar esa recompensa.');
    const discount = rewardDiscountFor(reward, item);
    if (discount === null) throw Errors.invalid('Esa recompensa no aplica a esa línea.');
    if (discount <= 0n) throw Errors.invalid('Esa línea ya está en $0.');

    const entry = await tx.pointsEntry.create({
      data: {
        organizationId: p.organizationId,
        customerId: sale.customerId,
        branchId: sale.branchId,
        type: 'REDEEM',
        points: -reward.pointsCost,
        createdAt: now,
        saleId,
        reason: reward.name,
        createdById: p.userId,
        idempotencyKey: `redeem:${saleId}:${reward.id}:${now.toISOString()}`,
      },
    });
    const newDiscount = item.discountCents + discount;
    await tx.saleItem.update({
      where: { id: item.id },
      data: {
        discountCents: newDiscount,
        totalCents: BigInt(item.quantity) * item.unitPriceCents - newDiscount,
        discountReason: reward.name,
      },
    });
    await tx.rewardRedemption.create({
      data: {
        organizationId: p.organizationId,
        branchId: sale.branchId,
        customerId: sale.customerId,
        rewardId: reward.id,
        saleId,
        saleItemId: item.id,
        pointsSpent: reward.pointsCost,
        discountCents: discount,
        createdAt: now,
        pointsEntryId: entry.id,
        redeemedById: p.userId,
      },
    });
    await recalcSaleTotals(tx, saleId);
  });
  return saleLoyalty(deps, p, saleId);
}

/** Deshace un canje antes de cobrar: devuelve los puntos y saca el descuento. */
export async function undoRedemption(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
  redemptionId: string,
): Promise<SaleLoyalty> {
  requirePermission(p, 'sales:charge');
  const now = deps.now();
  await deps.db.$transaction(async (tx) => {
    const redemption = await tx.rewardRedemption.findFirstOrThrow({
      where: { id: redemptionId, saleId, organizationId: p.organizationId },
      include: { reward: true },
    });
    if (redemption.status !== 'APPLIED') throw Errors.conflict('Ese canje ya se deshizo.');
    const sale = await lockSale(tx, saleId);
    if (sale.status !== 'OPEN') throw Errors.conflict('La venta ya está cobrada: anulala para revertirla.');

    const back = await tx.pointsEntry.create({
      data: {
        organizationId: p.organizationId,
        customerId: redemption.customerId,
        branchId: redemption.branchId,
        type: 'REVERSAL',
        points: redemption.pointsSpent,
        createdAt: now,
        saleId,
        reversesEntryId: redemption.pointsEntryId,
        reason: 'Se deshizo el canje',
        createdById: p.userId,
        idempotencyKey: `redemption-undo:${redemption.id}`,
      },
    });
    await tx.rewardRedemption.update({
      where: { id: redemption.id },
      data: { status: 'REVERSED', reversedAt: now, reversalEntryId: back.id },
    });

    if (redemption.saleItemId) {
      const item = await tx.saleItem.findUniqueOrThrow({ where: { id: redemption.saleItemId } });
      // Se saca exactamente lo que el canje puso: recalcularlo daría menos, porque la línea ya
      // está descontada (un 20 % sobre el precio ya rebajado no es el mismo número).
      const discount = redemption.discountCents;
      const restored = item.discountCents - discount < 0n ? 0n : item.discountCents - discount;
      await tx.saleItem.update({
        where: { id: item.id },
        data: {
          discountCents: restored,
          totalCents: BigInt(item.quantity) * item.unitPriceCents - restored,
          discountReason: restored > 0n ? item.discountReason : null,
        },
      });
    }
    await recalcSaleTotals(tx, saleId);
  });
  return saleLoyalty(deps, p, saleId);
}

async function recalcSaleTotals(tx: Parameters<typeof lockSale>[0], saleId: string) {
  const items = await tx.saleItem.findMany({ where: { saleId } });
  const subtotal = items.reduce((a, i) => a + BigInt(i.quantity) * i.unitPriceCents, 0n);
  const discount = items.reduce((a, i) => a + i.discountCents, 0n);
  await tx.sale.update({
    where: { id: saleId },
    data: { subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount },
  });
}

/** Lo que ve el cliente en "Mis puntos": saldo, movimientos y qué le falta para cada recompensa. */
export async function myPoints(deps: CoreDeps, p: CustomerPrincipal): Promise<MyPoints> {
  const rule = await loyaltyRule(deps.db, p.organizationId);
  const points = await customerPoints(deps, p.customerId);
  const rewards = rule.enabled
    ? await deps.db.reward.findMany({
        where: { organizationId: p.organizationId, active: true, archivedAt: null },
        orderBy: { pointsCost: 'asc' },
      })
    : [];
  return {
    enabled: rule.enabled,
    balance: points.balance,
    expiringSoon: points.expiringSoon,
    expiringOn: points.expiringOn,
    entries: points.entries,
    rewards: rewards.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      pointsCost: r.pointsCost,
      affordable: points.balance >= r.pointsCost,
      missingPoints: Math.max(r.pointsCost - points.balance, 0),
    })),
  };
}
