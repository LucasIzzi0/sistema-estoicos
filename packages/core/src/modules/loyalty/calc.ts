/**
 * Cálculos puros de puntos (docs/fase-0/01-arquitectura.md §11). Sin base ni red: se testean solos.
 *
 * Regla general: X puntos (`pointsPerStep`) por cada $Y (`spendStepCents`). Un servicio puede
 * tener su propio valor fijo (`pointsOverride`). Las propinas nunca suman.
 */
export interface LoyaltyRule {
  pointsPerStep: number;
  spendStepCents: bigint;
  /** Si los productos también suman. */
  earnOnProducts: boolean;
  /** Meses hasta que vencen (null = no vencen). */
  expiryMonths: number | null;
}

export interface EarnLine {
  type: 'SERVICE' | 'PRODUCT' | 'TIP';
  /** Lo cobrado en la línea, después de descuentos. */
  totalCents: bigint;
  quantity: number;
  /** Puntos fijos por unidad, si el servicio o producto los define. */
  pointsOverride: number | null;
}

/**
 * Puntos que gana una venta. Las líneas con puntos propios usan ese valor por unidad; el resto
 * suma por monto. Las propinas no dan puntos (P22: son de la casa).
 */
export function pointsForSale(lines: EarnLine[], rule: LoyaltyRule): number {
  let fromOverrides = 0;
  let amount = 0n;
  for (const line of lines) {
    if (line.type === 'TIP') continue;
    if (line.type === 'PRODUCT' && !rule.earnOnProducts) continue;
    if (line.pointsOverride !== null) {
      fromOverrides += line.pointsOverride * line.quantity;
      continue;
    }
    amount += line.totalCents;
  }
  if (rule.spendStepCents <= 0n || rule.pointsPerStep <= 0) return fromOverrides;
  const steps = amount / rule.spendStepCents;
  return fromOverrides + Number(steps) * rule.pointsPerStep;
}

/** Cuándo vencen los puntos ganados ahora (null = no vencen). */
export function expiryFor(now: Date, months: number | null): Date | null {
  if (!months) return null;
  const expiry = new Date(now);
  expiry.setMonth(expiry.getMonth() + months);
  return expiry;
}

export interface LedgerEntry {
  points: number;
  expiresAt: Date | null;
  createdAt: Date;
}

/** Saldo = suma del ledger. Nunca se edita un número: se agregan filas. */
export function balanceOf(entries: { points: number }[]): number {
  return entries.reduce((total, e) => total + e.points, 0);
}

/**
 * Cuántos puntos hay que vencer ahora (FIFO por fecha de vencimiento):
 *
 *   a vencer = máx(0, Σ acreditaciones vencidas − Σ débitos)
 *
 * Los débitos incluyen los vencimientos anteriores, así que **correrlo dos veces da 0 la
 * segunda vez**. Y nunca vence más que el saldo disponible.
 */
export function pointsToExpire(entries: LedgerEntry[], now: Date): number {
  const expiredCredits = entries
    .filter((e) => e.points > 0 && e.expiresAt !== null && e.expiresAt <= now)
    .reduce((total, e) => total + e.points, 0);
  const debits = entries.filter((e) => e.points < 0).reduce((total, e) => total - e.points, 0);
  const balance = balanceOf(entries);
  return Math.max(0, Math.min(expiredCredits - debits, Math.max(balance, 0)));
}

export type RewardKind = 'FREE_SERVICE' | 'FREE_PRODUCT' | 'FIXED_DISCOUNT' | 'PERCENT_DISCOUNT';

export interface RewardRule {
  type: RewardKind;
  serviceId: string | null;
  productId: string | null;
  discountFixedCents: bigint | null;
  discountPercentBps: number | null;
}

/**
 * Cuánto descuenta una recompensa sobre una línea. Nunca más que la línea, y las líneas ya
 * descontadas no se vuelven a descontar por debajo de cero.
 */
export function rewardDiscountFor(
  reward: RewardRule,
  line: { serviceId: string | null; productId: string | null; totalCents: bigint; unitPriceCents: bigint },
): bigint | null {
  switch (reward.type) {
    case 'FREE_SERVICE':
      if (!reward.serviceId || line.serviceId !== reward.serviceId) return null;
      // Gratis una unidad: nunca más que lo que queda por cobrar en la línea.
      return line.unitPriceCents > line.totalCents ? line.totalCents : line.unitPriceCents;
    case 'FREE_PRODUCT':
      if (!reward.productId || line.productId !== reward.productId) return null;
      return line.unitPriceCents > line.totalCents ? line.totalCents : line.unitPriceCents;
    case 'FIXED_DISCOUNT': {
      const fixed = reward.discountFixedCents ?? 0n;
      return fixed > line.totalCents ? line.totalCents : fixed;
    }
    case 'PERCENT_DISCOUNT': {
      const bps = BigInt(reward.discountPercentBps ?? 0);
      return (line.totalCents * bps) / 10_000n;
    }
  }
}

/**
 * Base de comisión cuando la línea se pagó con puntos (P27): por defecto el **precio de lista**,
 * para que el barbero no pierda plata y apoye el programa.
 */
export function commissionBaseForRedeemedLine(
  base: 'LIST_PRICE' | 'CHARGED_AMOUNT',
  line: { grossCents: bigint; chargedCents: bigint },
): bigint {
  return base === 'LIST_PRICE' ? line.grossCents : line.chargedCents;
}
