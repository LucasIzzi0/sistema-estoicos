import type { Tx } from '@estoicos/db';
import type { CoreDeps } from '../../deps';
import { isUniqueViolation } from '../../errors';
import type { CoreConfig } from '../../deps';
import type { PointsPayload } from '../notifications/messages';
import { queueNotification } from '../notifications/outbox';
import { balanceOf, expiryFor, pointsForSale, pointsToExpire, type LoyaltyRule } from './calc';

/**
 * Ledger de puntos (docs/fase-0/01-arquitectura.md §11). Reglas de oro:
 *  - **El saldo es la suma de las filas.** Nunca se edita un número: se agregan filas.
 *  - La base bloquea UPDATE y DELETE sobre la tabla (trigger de solo inserción).
 *  - Cada fila lleva una clave única: un webhook repetido o un doble clic no acredita dos veces.
 */
export async function loyaltyRule(tx: Tx, organizationId: string): Promise<LoyaltyRule & { enabled: boolean }> {
  const settings = await tx.organizationSettings.findUnique({ where: { organizationId } });
  return {
    enabled: settings?.loyaltyEnabled ?? true,
    pointsPerStep: settings?.loyaltyPointsPerStep ?? 1,
    spendStepCents: settings?.loyaltySpendStepCents ?? 100_000n,
    earnOnProducts: settings?.loyaltyEarnOnProducts ?? true,
    expiryMonths: settings?.loyaltyPointsExpiryMonths ?? 12,
  };
}

/** Saldo actual del cliente. */
export async function pointsBalance(tx: Tx, customerId: string): Promise<number> {
  const rows = await tx.pointsEntry.findMany({ where: { customerId }, select: { points: true } });
  return balanceOf(rows);
}

/**
 * Acredita los puntos de una venta recién pagada. Se llama DENTRO de la transacción que cierra
 * la venta (punto único de consistencia), así que o pasa todo o no pasa nada.
 * Clave `earn:<venta>`: si la transacción se repite, no acredita dos veces.
 */
export async function earnPointsForSale(
  tx: Tx,
  input: { saleId: string; now: Date; config?: CoreConfig },
): Promise<{ points: number; notificationId: string | null } | null> {
  const sale = await tx.sale.findUniqueOrThrow({
    where: { id: input.saleId },
    include: {
      items: {
        include: {
          service: { select: { pointsOverride: true } },
          product: { select: { pointsOverride: true } },
        },
      },
    },
  });
  if (!sale.customerId) return null;
  const rule = await loyaltyRule(tx, sale.organizationId);
  if (!rule.enabled) return null;

  const points = pointsForSale(
    sale.items.map((i) => ({
      type: i.type,
      totalCents: i.totalCents,
      quantity: i.quantity,
      pointsOverride: i.service?.pointsOverride ?? i.product?.pointsOverride ?? null,
    })),
    rule,
  );
  if (points <= 0) return null;

  try {
    await tx.pointsEntry.create({
      data: {
        organizationId: sale.organizationId,
        customerId: sale.customerId,
        branchId: sale.branchId,
        type: 'EARN',
        points,
        createdAt: input.now,
        expiresAt: expiryFor(input.now, rule.expiryMonths),
        saleId: sale.id,
        idempotencyKey: `earn:${sale.id}`,
      },
    });
  } catch (error) {
    // Ya estaban acreditados.
    if (isUniqueViolation(error)) return null;
    throw error;
  }

  // Aviso al cliente: cuántos sumó, cuánto tiene y qué puede canjear.
  let notificationId: string | null = null;
  if (input.config) {
    const balance = await pointsBalance(tx, sale.customerId);
    const rewards = await tx.reward.findMany({
      where: { organizationId: sale.organizationId, active: true, archivedAt: null },
      orderBy: { pointsCost: 'asc' },
    });
    const unlocked = [...rewards].reverse().find((r) => r.pointsCost <= balance) ?? null;
    const next = rewards.find((r) => r.pointsCost > balance) ?? null;
    const payload: PointsPayload = {
      orgName: (await tx.organization.findUniqueOrThrow({ where: { id: sale.organizationId } })).name,
      customerFirstName:
        (await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } })).firstName || 'cliente',
      points,
      balance,
      unlockedReward: unlocked?.name ?? null,
      nextReward: next ? { name: next.name, missing: next.pointsCost - balance } : null,
      pointsUrl: `${input.config.appPublicUrl}/mi-cuenta/puntos`,
    };
    notificationId = await queueNotification(tx, input.config, {
      type: 'POINTS_CREDITED',
      dedupeKey: `points:${sale.id}`,
      customerId: sale.customerId,
      organizationId: sale.organizationId,
      branchId: sale.branchId,
      saleId: sale.id,
      payload,
      now: input.now,
    });
  }
  return { points, notificationId };
}

/**
 * Anula los puntos de una venta anulada: revierte lo ganado y **devuelve** lo canjeado.
 * Si el cliente ya gastó los puntos ganados, el saldo puede quedar negativo (P43).
 */
export async function reversePointsForSale(tx: Tx, input: { saleId: string; now: Date }): Promise<void> {
  const earned = await tx.pointsEntry.findFirst({
    where: { saleId: input.saleId, type: 'EARN' },
    include: { reversals: true },
  });
  if (earned && earned.reversals.length === 0) {
    await tx.pointsEntry.create({
      data: {
        organizationId: earned.organizationId,
        customerId: earned.customerId,
        branchId: earned.branchId,
        type: 'REVERSAL',
        points: -earned.points,
        createdAt: input.now,
        saleId: input.saleId,
        reversesEntryId: earned.id,
        reason: 'Venta anulada',
        idempotencyKey: `reversal:${earned.id}`,
      },
    });
  }

  // Los canjes se devuelven: el cliente recupera sus puntos.
  const redemptions = await tx.rewardRedemption.findMany({
    where: { saleId: input.saleId, status: 'APPLIED' },
    include: { pointsEntry: true },
  });
  for (const redemption of redemptions) {
    const back = await tx.pointsEntry.create({
      data: {
        organizationId: redemption.organizationId,
        customerId: redemption.customerId,
        branchId: redemption.branchId,
        type: 'REVERSAL',
        points: redemption.pointsSpent,
        createdAt: input.now,
        saleId: input.saleId,
        reversesEntryId: redemption.pointsEntryId,
        reason: 'Venta anulada: se devuelven los puntos del canje',
        idempotencyKey: `redemption-reversal:${redemption.id}`,
      },
    });
    await tx.rewardRedemption.update({
      where: { id: redemption.id },
      data: { status: 'REVERSED', reversedAt: input.now, reversalEntryId: back.id },
    });
  }
}

/**
 * Vence los puntos de un cliente. La fórmula es idempotente (ver `pointsToExpire`): correrlo dos
 * veces el mismo día no vence de más. La clave incluye la fecha.
 */
export async function expirePointsFor(
  deps: CoreDeps,
  customerId: string,
  now: Date,
): Promise<{ expired: number }> {
  return deps.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`points:${customerId}`}, 0))`;
    const entries = await tx.pointsEntry.findMany({
      where: { customerId },
      select: { points: true, expiresAt: true, createdAt: true },
    });
    const toExpire = pointsToExpire(entries, now);
    if (toExpire <= 0) return { expired: 0 };

    const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    try {
      await tx.pointsEntry.create({
        data: {
          organizationId: customer.organizationId,
          customerId,
          type: 'EXPIRE',
          points: -toExpire,
          createdAt: now,
          reason: 'Vencimiento',
          idempotencyKey: `expire:${customerId}:${now.toISOString().slice(0, 10)}`,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { expired: 0 };
      throw error;
    }
    return { expired: toExpire };
  });
}

/** Clientes con puntos ya vencidos sin registrar (los recorre el job diario). */
export async function customersWithExpiredPoints(deps: CoreDeps, now: Date, limit = 500): Promise<string[]> {
  const rows = await deps.db.pointsEntry.findMany({
    where: { type: 'EARN', expiresAt: { lte: now } },
    select: { customerId: true },
    distinct: ['customerId'],
    take: limit,
  });
  return rows.map((r) => r.customerId);
}
